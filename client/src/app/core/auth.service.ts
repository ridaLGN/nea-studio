import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { catchError, throwError } from 'rxjs';
import type { Role, User } from './models';

const KEY = 'nea.token';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  readonly token = signal<string | null>(read());
  readonly user = signal<User | null>(null);
  readonly ready = signal(false);
  readonly isStaff = computed(() => ['ADMIN', 'MANAGER', 'EMPLOYEE'].includes(this.user()?.role ?? ''));
  readonly isManager = computed(() => ['ADMIN', 'MANAGER'].includes(this.user()?.role ?? ''));

  can(permission: string) {
    return !!this.user()?.permissions.includes(permission);
  }

  /** Restores the session on startup */
  async init() {
    if (this.token()) {
      try {
        this.user.set(await firstValueFrom(this.http.get<User>('/api/auth/me')));
      } catch {
        this.clear();
      }
    }
    this.ready.set(true);
  }

  async login(email: string, password: string) {
    const r = await firstValueFrom(this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password }));
    this.setSession(r.token, r.user);
    return r.user;
  }

  async claim(body: { reference: string; phone: string; email: string; password: string }) {
    const r = await firstValueFrom(this.http.post<{ token: string; user: User }>('/api/auth/claim', body));
    this.setSession(r.token, r.user);
    return r.user;
  }

  setSession(token: string, user: User) {
    try { localStorage.setItem(KEY, token); } catch { /* storage unavailable */ }
    this.token.set(token);
    this.user.set(user);
  }

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    this.token.set(null);
    this.user.set(null);
  }

  logout() {
    this.clear();
    this.router.navigateByUrl('/');
  }

  homeFor(role: Role | undefined) {
    return role === 'CUSTOMER' ? '/account' : role === 'EMPLOYEE' ? '/staff' : role ? '/admin' : '/';
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const r = token && req.url.startsWith('/api') ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(r).pipe(
    catchError((err) => {
      if (err.status === 401 && token && !req.url.includes('/auth/login')) auth.clear();
      return throwError(() => err);
    }),
  );
};

/** Route guard: `data: { roles: [...] }` */
export const roleGuard: CanActivateFn = async (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.ready()) await auth.init();
  const user = auth.user();
  if (!user) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  const roles = (route.data['roles'] as Role[] | undefined) ?? [];
  if (roles.length && !roles.includes(user.role)) return router.createUrlTree([auth.homeFor(user.role)]);
  return true;
};

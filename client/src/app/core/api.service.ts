import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { setSalonTz } from './format';
import type { Appointment, Category, LoyaltySummary, Paged, PublicEmployee, PublicSettings, Service, SlotsResponse } from './models';

type Q = Record<string, string | number | boolean | null | undefined>;
const params = (q: Q = {}) => {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
};

/** Thin promise-based wrapper around the REST API. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  readonly settings = signal<PublicSettings | null>(null);

  get<T>(url: string, q?: Q) { return firstValueFrom(this.http.get<T>(url, { params: params(q) })); }
  post<T>(url: string, body: unknown = {}) { return firstValueFrom(this.http.post<T>(url, body)); }
  patch<T>(url: string, body: unknown) { return firstValueFrom(this.http.patch<T>(url, body)); }
  put<T>(url: string, body: unknown) { return firstValueFrom(this.http.put<T>(url, body)); }
  delete<T>(url: string) { return firstValueFrom(this.http.delete<T>(url)); }
  upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(this.http.post<{ url: string }>('/api/admin/uploads', fd));
  }

  // ---- public ----
  async loadSettings() {
    const s = await this.get<PublicSettings>('/api/public/settings');
    setSalonTz(s.timezone, s.tzTransitions);
    this.settings.set(s);
    return s;
  }
  categories() { return this.get<Category[]>('/api/public/categories'); }
  services(category?: string) { return this.get<Service[]>('/api/public/services', { category }); }
  employees() { return this.get<PublicEmployee[]>('/api/public/employees'); }
  availability(serviceId: string, date: string, employeeId?: string | null) {
    return this.get<SlotsResponse>('/api/public/availability', { serviceId, date, employeeId: employeeId ?? 'any' });
  }
  book(body: unknown) { return this.post<Appointment>('/api/public/bookings', body); }

  // ---- customer ----
  myLoyalty() { return this.get<LoyaltySummary>('/api/me/loyalty'); }

  // ---- admin ----
  appointments(q: Q) { return this.get<Paged<Appointment>>('/api/admin/appointments', q); }
}

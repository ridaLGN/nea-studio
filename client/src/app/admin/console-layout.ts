import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { RealtimeService } from '../core/realtime.service';
import { Avatar, Icon, Logo } from '../shared/ui';

/** Shell for employees, managers and administrators. Menu items depend on permissions. */
@Component({
  selector: 'nea-console-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo, Icon, Avatar],
  template: `
    <div class="min-h-screen lg:pl-64">
      <aside class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brown px-4 py-6 transition-transform lg:translate-x-0" [class.-translate-x-full]="!open()">
        <a routerLink="/" class="px-3"><ui-logo [light]="true" /></a>
        <p class="mt-2 px-3 text-[0.65rem] uppercase tracking-[0.3em] text-ivory/40">{{ roleLabel() }}</p>
        <nav class="mt-8 flex-1 space-y-1 overflow-y-auto">
          @for (item of items(); track item.path) {
            @if (item.section) { <p class="px-3 pb-1 pt-5 text-[0.6rem] uppercase tracking-[0.3em] text-ivory/35">{{ item.section }}</p> }
            <a [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: item.exact ?? false }" class="side-link" (click)="open.set(false)">
              <ui-icon [name]="item.icon" [size]="17" />{{ item.label }}
            </a>
          }
        </nav>
        <div class="mt-4 flex items-center gap-3 rounded-2xl bg-white/5 p-3">
          <ui-avatar [name]="displayName()" [src]="auth.user()?.employee?.photoUrl" [size]="34" color="#A0674B" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-ivory">{{ displayName() }}</p>
            <p class="truncate text-[0.7rem] text-ivory/50">{{ auth.user()?.email }}</p>
          </div>
          <button class="text-ivory/60 hover:text-white" (click)="auth.logout()" title="Sign out"><ui-icon name="logout" [size]="17" /></button>
        </div>
      </aside>
      @if (open()) { <div class="fixed inset-0 z-30 bg-brown/40 lg:hidden" (click)="open.set(false)"></div> }

      <header class="sticky top-0 z-20 flex items-center gap-3 border-b border-cream bg-ivory/90 px-4 py-3 backdrop-blur lg:hidden">
        <button class="icon-btn" (click)="open.set(true)" aria-label="Menu"><ui-icon name="menu" /></button>
        <ui-logo [small]="true" />
      </header>

      <main class="mx-auto max-w-[1500px] px-4 py-6 md:px-8 md:py-8"><router-outlet /></main>
    </div>
  `,
})
export class ConsoleLayout {
  auth = inject(AuthService);
  open = signal(false);
  constructor() {
    inject(RealtimeService); // connect the socket as staff
  }
  displayName = computed(() => {
    const u = this.auth.user();
    return u?.employee ? `${u.employee.firstName} ${u.employee.lastName}` : (u?.email.split('@')[0] ?? '');
  });
  roleLabel = computed(() => ({ ADMIN: 'Administrator', MANAGER: 'Manager', EMPLOYEE: 'Team', CUSTOMER: '' })[this.auth.user()?.role ?? 'CUSTOMER']);
  items = computed(() => {
    const a = this.auth;
    const list: { path: string; label: string; icon: string; exact?: boolean; section?: string; show: boolean }[] = [
      { path: '/admin', label: 'Overview', icon: 'chart', exact: true, section: 'Management', show: a.isManager() },
      { path: '/admin/availability', label: 'Availability', icon: 'calendar', show: a.can('availability.view') },
      { path: '/admin/appointments', label: 'Appointments', icon: 'list', show: a.can('appointments.view_all') },
      { path: '/admin/customers', label: 'Customers', icon: 'users', show: a.can('customers.view') },
      { path: '/admin/loyalty', label: 'Loyalty', icon: 'gift', show: a.can('loyalty.manage') },
      { path: '/admin/employees', label: 'Team & schedules', icon: 'scissors', section: 'Salon', show: a.can('employees.manage') },
      { path: '/admin/services', label: 'Services & prices', icon: 'sparkles', show: a.can('services.manage') },
      { path: '/admin/notifications', label: 'Notifications', icon: 'bell', show: a.can('notifications.view') },
      { path: '/admin/settings', label: 'Settings', icon: 'settings', show: a.can('settings.manage') },
      { path: '/admin/audit', label: 'Audit log', icon: 'shield', show: a.can('audit.view') },
      { path: '/staff', label: 'My day', icon: 'clock', exact: true, section: 'Front desk', show: !!a.user()?.employee },
      { path: '/staff/scan', label: 'Scan QR code', icon: 'scan', show: a.can('qr.scan') },
    ];
    return list.filter((i) => i.show);
  });
}

import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { dateShort, dateTime, mad } from '../core/format';
import type { Appointment, LoyaltySummary, Paged } from '../core/models';
import { Empty, Icon, Modal, StatusBadge, Stat } from '../shared/ui';
import { LoyaltyCard } from '../shared/loyalty-card';
import { AppointmentDrawer, QuickCreate, type QuickPrefill } from './appointment-tools';

interface Row { id: string; customerNumber: string; fullName: string; phone: string; email: string | null; isDemo: boolean; hasAccount: boolean; totalVisits: number; lastVisit: string | null; nextAppointment: string | null; stamps: number; availableRewards: number[] }

@Component({
  selector: 'nea-customers',
  imports: [FormsModule, RouterLink, Icon, Empty, Modal],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">CRM</p><h1 class="title-lg mt-1">Customers</h1></div>
      @if (auth.can('customers.manage')) { <button class="btn-primary" (click)="adding.set(true)"><ui-icon name="plus" [size]="16" /> New customer</button> }
    </div>
    <div class="relative mt-6 max-w-md"><ui-icon name="search" [size]="15" class="absolute left-3.5 top-3 text-taupe" /><input class="input !pl-9" placeholder="Name, phone, email or customer ID" [(ngModel)]="q" (ngModelChange)="search()" /></div>

    <div class="card mt-4 overflow-x-auto">
      <table class="table">
        <thead><tr><th>Customer</th><th>Contact</th><th class="text-right">Visits</th><th>Last visit</th><th>Next appointment</th><th>Loyalty</th></tr></thead>
        <tbody>
          @for (c of page()?.items; track c.id) {
            <tr>
              <td><a [routerLink]="[c.id]" class="font-medium hover:text-burgundy">{{ c.fullName }}</a><p class="text-xs text-taupe">{{ c.customerNumber }} @if (c.hasAccount) { · account } @if (c.isDemo) { <span class="badge-demo ml-1">demo</span> }</p></td>
              <td class="text-xs"><p>{{ c.phone }}</p><p class="text-taupe">{{ c.email }}</p></td>
              <td class="text-right">{{ c.totalVisits }}</td>
              <td>{{ c.lastVisit ? dateShort(c.lastVisit) : '—' }}</td>
              <td>{{ c.nextAppointment ? dateTime(c.nextAppointment) : '—' }}</td>
              <td><span class="text-xs">{{ c.stamps }} stamps</span> @for (r of c.availableRewards; track $index) { <span class="badge-confirmed ml-1">-{{ r }}%</span> }</td>
            </tr>
          }
        </tbody>
      </table>
      @if (page()?.items?.length === 0) { <ui-empty title="No customers found" icon="users" /> }
    </div>
    @if (page(); as p) {
      <div class="mt-4 flex items-center justify-between text-sm text-taupe">
        <span>{{ p.total }} customers</span>
        <div class="flex gap-2"><button class="btn-outline btn-sm" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Previous</button><button class="btn-outline btn-sm" [disabled]="p.page * p.pageSize >= p.total" (click)="go(p.page + 1)">Next</button></div>
      </div>
    }

    <ui-modal [open]="adding()" title="New customer" (closed)="adding.set(false)">
      <form class="space-y-3" (ngSubmit)="create()">
        <input class="input" placeholder="Full name" name="n" [(ngModel)]="nc.fullName" required />
        <input class="input" placeholder="Phone" name="p" [(ngModel)]="nc.phone" required />
        <input class="input" placeholder="Email (optional)" name="e" [(ngModel)]="nc.email" />
        <textarea class="input" placeholder="Notes" name="no" [(ngModel)]="nc.notes"></textarea>
        <div class="flex justify-end"><button class="btn-primary">Create</button></div>
      </form>
    </ui-modal>
  `,
})
export class CustomersPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  q = '';
  pageNo = 1;
  page = signal<Paged<Row> | null>(null);
  adding = signal(false);
  nc = { fullName: '', phone: '', email: '', notes: '' };
  dateShort = dateShort;
  dateTime = dateTime;
  private t: ReturnType<typeof setTimeout> | null = null;
  constructor() { this.load(); }
  search() { this.pageNo = 1; if (this.t) clearTimeout(this.t); this.t = setTimeout(() => this.load(), 250); }
  go(p: number) { this.pageNo = p; this.load(); }
  async load() { this.page.set(await this.api.get<Paged<Row>>('/api/admin/customers', { q: this.q, page: this.pageNo })); }
  async create() {
    try {
      await this.api.post('/api/admin/customers', this.nc);
      this.toast.success('Customer created');
      this.adding.set(false);
      this.nc = { fullName: '', phone: '', email: '', notes: '' };
      this.load();
    } catch (e) { this.toast.error(e); }
  }
}

interface CustomerDetail {
  id: string; customerNumber: string; fullName: string; phone: string; email: string | null; notes: string | null; isDemo: boolean; createdAt: string;
  account: { email: string; lastLoginAt: string | null } | null; qrCode: string; totalSpentMad: number; appointments: Appointment[]; loyalty: LoyaltySummary;
}

@Component({
  selector: 'nea-customer-detail',
  imports: [FormsModule, RouterLink, Icon, StatusBadge, Stat, LoyaltyCard, AppointmentDrawer, QuickCreate],
  template: `
    <a routerLink="/admin/customers" class="btn-ghost btn-sm -ml-3"><ui-icon name="chevron-left" [size]="15" /> Customers</a>
    @if (c(); as c) {
      <div class="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="eyebrow">{{ c.customerNumber }} @if (c.isDemo) { <span class="badge-demo ml-2">demo</span> }</p>
          <h1 class="title-lg mt-1">{{ c.fullName }}</h1>
          <p class="mt-1 text-sm text-taupe">{{ c.phone }}{{ c.email ? ' · ' + c.email : '' }} · client since {{ dateShort(c.createdAt) }}{{ c.account ? ' · has an online account' : '' }}</p>
        </div>
        @if (auth.can('appointments.manage')) { <button class="btn-primary" (click)="book()"><ui-icon name="plus" [size]="16" /> Book for {{ c.fullName.split(' ')[0] }}</button> }
      </div>

      <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <ui-stat label="Visits" [value]="completed()" icon="check" accent="green" />
        <ui-stat label="Total spent" [value]="mad(c.totalSpentMad)" icon="card" />
        <ui-stat label="Last visit" [value]="lastVisit() ? dateShort(lastVisit()!) : '—'" icon="calendar" accent="grey" />
        <ui-stat label="Next appointment" [value]="next() ? dateShort(next()!.startAt) : '—'" icon="clock" accent="orange" />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-5">
        <div class="space-y-6 xl:col-span-3">
          <div class="card overflow-x-auto">
            <div class="px-5 pt-5"><p class="eyebrow">Appointment history</p></div>
            <table class="table mt-2">
              <thead><tr><th>Date</th><th>Service</th><th>With</th><th>Status</th><th class="text-right">Paid</th></tr></thead>
              <tbody>
                @for (a of c.appointments; track a.id) {
                  <tr class="cursor-pointer" (click)="openId.set(a.id)"><td class="whitespace-nowrap">{{ dateTime(a.startAt) }}</td><td>{{ a.service.name }}</td><td>{{ a.employee.firstName }}</td><td><ui-status [status]="a.status" /></td><td class="text-right">{{ a.paidMad ? mad(a.paidMad) : '—' }}</td></tr>
                }
              </tbody>
            </table>
          </div>
          @if (auth.can('customers.manage')) {
            <form class="card-pad space-y-3" (ngSubmit)="save()">
              <p class="eyebrow">Profile & notes</p>
              <div class="grid gap-3 sm:grid-cols-3">
                <input class="input" name="n" [(ngModel)]="edit.fullName" placeholder="Full name" />
                <input class="input" name="p" [(ngModel)]="edit.phone" placeholder="Phone" />
                <input class="input" name="e" [(ngModel)]="edit.email" placeholder="Email" />
              </div>
              <textarea class="input" rows="3" name="no" [(ngModel)]="edit.notes" placeholder="Private notes (preferences, allergies…)"></textarea>
              <div class="flex justify-end"><button class="btn-primary btn-sm">Save</button></div>
            </form>
          }
        </div>
        <div class="space-y-6 xl:col-span-2">
          <nea-loyalty-card [card]="c.loyalty" [qr]="c.qrCode" />
          @if (auth.can('loyalty.manage')) {
            <div class="card-pad">
              <p class="eyebrow mb-3">Adjust stamps</p>
              <div class="flex gap-2">
                <input type="number" class="input !w-24" [(ngModel)]="delta" />
                <input class="input" placeholder="Reason (required, audited)" [(ngModel)]="reason" />
              </div>
              <div class="mt-3 flex gap-2">
                <button class="btn-outline btn-sm" (click)="adjust(1)"><ui-icon name="plus" [size]="14" /> Add</button>
                <button class="btn-danger btn-sm" (click)="adjust(-1)"><ui-icon name="minus" [size]="14" /> Remove</button>
                @if (auth.can('customers.manage')) { <button class="btn-ghost btn-sm ml-auto" (click)="rotate()" title="Invalidate the current QR code"><ui-icon name="refresh" [size]="14" /> New QR</button> }
              </div>
            </div>
          }
          <div class="card-pad">
            <p class="eyebrow mb-3">Rewards</p>
            @for (r of c.loyalty.rewards; track r.id) {
              <div class="flex items-center justify-between border-b border-cream py-2 text-sm last:border-0">
                <span>-{{ r.discountPercent }}% · {{ r.name }}</span>
                <span class="text-xs text-taupe">{{ r.status === 'AVAILABLE' ? (r.expiresAt ? 'until ' + dateShort(r.expiresAt) : 'available') : r.status === 'REDEEMED' ? 'used ' + (r.redeemedOn ?? '') : 'expired' }}</span>
              </div>
            } @empty { <p class="text-sm text-taupe">No rewards yet.</p> }
          </div>
        </div>
      </div>
    }
    <nea-appointment-drawer [appointmentId]="openId()" (closed)="openId.set(null)" (changed)="load()" />
    <nea-quick-create [open]="creating()" [prefill]="prefill()" (closed)="creating.set(false)" (created)="load()" />
  `,
})
export class CustomerDetailPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  id = input.required<string>();
  c = signal<CustomerDetail | null>(null);
  openId = signal<string | null>(null);
  creating = signal(false);
  prefill = signal<QuickPrefill | null>(null);
  edit = { fullName: '', phone: '', email: '', notes: '' };
  delta = 1;
  reason = '';
  dateShort = dateShort; dateTime = dateTime; mad = mad;
  completed = () => this.c()?.appointments.filter((a) => a.status === 'COMPLETED').length ?? 0;
  lastVisit = () => this.c()?.appointments.find((a) => a.status === 'COMPLETED')?.startAt ?? null;
  next = () => [...(this.c()?.appointments ?? [])].filter((a) => ['PENDING', 'CONFIRMED'].includes(a.status) && new Date(a.startAt) > new Date()).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;

  constructor() {
    effect(() => { this.id(); untracked(() => this.load()); });
  }
  async load() {
    const c = await this.api.get<CustomerDetail>(`/api/admin/customers/${this.id()}`);
    this.c.set(c);
    this.edit = { fullName: c.fullName, phone: c.phone, email: c.email ?? '', notes: c.notes ?? '' };
  }
  book() {
    this.prefill.set({ customerId: this.c()!.id, customerName: this.c()!.fullName });
    this.creating.set(true);
  }
  async save() {
    try { await this.api.patch(`/api/admin/customers/${this.id()}`, this.edit); this.toast.success('Customer saved'); this.load(); } catch (e) { this.toast.error(e); }
  }
  async adjust(sign: 1 | -1) {
    if (this.reason.trim().length < 3) return this.toast.show('Please give a reason (it is recorded in the audit log)', 'error');
    try {
      const r = await this.api.post<{ newRewards: number }>(`/api/admin/loyalty/customers/${this.id()}/stamps`, { delta: sign * Math.abs(this.delta || 1), reason: this.reason });
      this.toast.success(sign > 0 ? 'Stamps added' : 'Stamps removed');
      if (r.newRewards) this.toast.show('A reward was unlocked', 'success');
      this.reason = '';
      this.load();
    } catch (e) { this.toast.error(e); }
  }
  async rotate() {
    if (!confirm('Generate a new QR code? The old one will stop working.')) return;
    try { await this.api.post(`/api/admin/customers/${this.id()}/rotate-qr`); this.toast.success('New QR code generated'); this.load(); } catch (e) { this.toast.error(e); }
  }
}

import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { dateLong, dateShort, dateTime, mad, time } from '../core/format';
import type { Appointment, LoyaltySummary } from '../core/models';
import { Empty, Icon, Modal, StatusBadge } from '../shared/ui';
import { LoyaltyCard } from '../shared/loyalty-card';
import { SlotPicker, type PickedSlot } from '../shared/slot-picker';

interface Profile { id: string; customerNumber: string; fullName: string; phone: string; email: string | null; qrCode: string }
interface Notif { id: string; type: string; channel: string; status: string; subject: string | null; createdAt: string }

@Component({
  selector: 'nea-account',
  imports: [FormsModule, RouterLink, Icon, StatusBadge, Empty, Modal, LoyaltyCard, SlotPicker],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-10 md:px-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="eyebrow">My space</p>
          <h1 class="title-lg mt-2">Hello, {{ firstName() }}</h1>
        </div>
        <div class="flex gap-2"><a routerLink="/booking" class="btn-primary btn-sm"><ui-icon name="plus" [size]="15" /> New booking</a><button class="btn-ghost btn-sm" (click)="auth.logout()"><ui-icon name="logout" [size]="15" /> Sign out</button></div>
      </div>

      <div class="mt-8 flex gap-1 overflow-x-auto">
        @for (t of tabs; track t.id) { <button class="tab shrink-0" [class.active]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button> }
      </div>

      <!-- Overview -->
      @if (tab() === 'overview') {
        <div class="mt-8 grid gap-6 lg:grid-cols-5 animate-fade-up">
          <div class="lg:col-span-3">
            @if (card()) { <nea-loyalty-card [card]="card()!" [qr]="profile()?.qrCode ?? null" /> }
            <p class="mt-3 text-center text-xs text-taupe">Show this QR code at the reception — your visit is stamped automatically.</p>
          </div>
          <div class="space-y-6 lg:col-span-2">
            <div class="card-pad">
              <p class="eyebrow">Next appointment</p>
              @if (upcoming()[0]; as n) {
                <p class="mt-3 font-display text-2xl">{{ n.service.name }}</p>
                <p class="mt-1 text-sm text-taupe">{{ dateLong(n.startAt) }} · {{ time(n.startAt) }}</p>
                <p class="text-sm text-taupe">with {{ n.employee.name }}</p>
                <div class="mt-3"><ui-status [status]="n.status" /></div>
              } @else {
                <p class="mt-3 text-sm text-taupe">No upcoming appointment.</p>
                <a routerLink="/booking" class="btn-outline btn-sm mt-4">Book now</a>
              }
            </div>
            <div class="card-pad">
              <p class="eyebrow">Available rewards</p>
              @for (r of availableRewards(); track r.id) {
                <div class="mt-3 flex items-center justify-between rounded-xl bg-burgundy-soft px-4 py-3">
                  <span class="font-display text-2xl text-burgundy">-{{ r.discountPercent }}%</span>
                  <span class="text-xs text-taupe">{{ r.expiresAt ? 'until ' + dateShort(r.expiresAt) : 'no expiry' }}</span>
                </div>
              } @empty { <p class="mt-3 text-sm text-taupe">Keep visiting to unlock your first reward.</p> }
              @if (availableRewards().length) { <p class="mt-3 text-xs text-taupe">Mention it at the reception: it is applied when your visit is validated.</p> }
            </div>
          </div>
        </div>
      }

      <!-- Appointments -->
      @if (tab() === 'appointments') {
        <div class="mt-8 space-y-8 animate-fade-up">
          <div>
            <h2 class="title-md mb-4">Upcoming</h2>
            @for (a of upcoming(); track a.id) {
              <div class="card mb-3 flex flex-wrap items-center gap-4 p-5">
                <div class="w-16 text-center"><p class="font-display text-3xl leading-none">{{ dayNum(a.startAt) }}</p><p class="text-xs uppercase text-taupe">{{ month(a.startAt) }}</p></div>
                <div class="min-w-0 flex-1">
                  <p class="font-display text-xl">{{ a.service.name }}</p>
                  <p class="text-sm text-taupe">{{ time(a.startAt) }} · {{ a.employee.name }} · {{ a.reference }}</p>
                </div>
                <ui-status [status]="a.status" />
                <div class="flex gap-2">
                  <button class="btn-outline btn-sm" (click)="moving.set(a)">Reschedule</button>
                  <button class="btn-danger btn-sm" (click)="cancel(a)">Cancel</button>
                </div>
              </div>
            } @empty { <ui-empty title="No upcoming appointment" icon="calendar"><a routerLink="/booking" class="btn-primary btn-sm">Book now</a></ui-empty> }
          </div>
          <div>
            <h2 class="title-md mb-4">History</h2>
            <div class="card overflow-x-auto">
              <table class="table">
                <thead><tr><th>Date</th><th>Service</th><th>With</th><th>Status</th><th class="text-right">Price</th></tr></thead>
                <tbody>
                  @for (a of past(); track a.id) {
                    <tr><td>{{ dateTime(a.startAt) }}</td><td>{{ a.service.name }}</td><td>{{ a.employee.firstName }}</td><td><ui-status [status]="a.status" /></td>
                      <td class="text-right">{{ mad(a.priceMad - a.discountMad) }} @if (a.discountMad) { <span class="text-xs text-burgundy">(-{{ a.discountPercent }}%)</span> }</td></tr>
                  } @empty { <tr><td colspan="5" class="text-center text-taupe">No past appointments yet.</td></tr> }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      }

      <!-- Loyalty -->
      @if (tab() === 'loyalty' && card(); as c) {
        <div class="mt-8 grid gap-6 lg:grid-cols-2 animate-fade-up">
          <div>
            <nea-loyalty-card [card]="c" [qr]="profile()?.qrCode ?? null" />
            <div class="card-pad mt-6">
              <p class="eyebrow mb-3">How it works</p>
              @for (m of c.milestones; track m.id) {
                <p class="flex items-center justify-between border-b border-cream py-2 text-sm last:border-0"><span>{{ m.stampsRequired }} validated visits</span><span class="font-medium text-burgundy">-{{ m.discountPercent }}%{{ m.validityDays ? ' · valid ' + m.validityDays + ' days' : '' }}</span></p>
              }
              <p class="mt-3 text-xs text-taupe">Only completed appointments earn stamps. Cancelled or missed appointments do not.</p>
            </div>
          </div>
          <div class="space-y-6">
            <div class="card-pad">
              <p class="eyebrow mb-3">Rewards & discounts</p>
              @for (r of c.rewards; track r.id) {
                <div class="flex items-center justify-between border-b border-cream py-3 text-sm last:border-0">
                  <div><p class="font-medium">-{{ r.discountPercent }}% · {{ r.name }}</p><p class="text-xs text-taupe">Unlocked {{ dateShort(r.unlockedAt) }}{{ r.redeemedOn ? ' · used on ' + r.redeemedOn : '' }}</p></div>
                  <span [class]="r.status === 'AVAILABLE' ? 'badge-confirmed' : r.status === 'REDEEMED' ? 'badge-completed' : 'badge-cancelled'">{{ r.status === 'AVAILABLE' ? 'Available' : r.status === 'REDEEMED' ? 'Used' : 'Expired' }}</span>
                </div>
              } @empty { <p class="text-sm text-taupe">No rewards yet.</p> }
            </div>
            <div class="card-pad">
              <p class="eyebrow mb-3">Stamp history</p>
              @for (h of c.history; track h.id) {
                <div class="flex items-center justify-between border-b border-cream py-2.5 text-sm last:border-0" [class.opacity-50]="h.revokedAt">
                  <span>{{ h.appointment ? h.appointment.service : (h.reason || 'Manual adjustment') }}</span>
                  <span class="text-xs text-taupe">{{ dateShort(h.createdAt) }} · +{{ h.value }}{{ h.revokedAt ? ' (removed)' : '' }}</span>
                </div>
              } @empty { <p class="text-sm text-taupe">Your first stamp arrives after your first validated visit.</p> }
            </div>
          </div>
        </div>
      }

      <!-- Profile -->
      @if (tab() === 'profile' && profile(); as p) {
        <div class="mt-8 grid gap-6 md:grid-cols-2 animate-fade-up">
          <form class="card-pad space-y-4" (ngSubmit)="saveProfile()">
            <p class="eyebrow">Personal information</p>
            <div><label class="label" for="fn">Full name</label><input id="fn" class="input" name="fullName" [(ngModel)]="edit.fullName" required /></div>
            <div><label class="label" for="em">Email</label><input id="em" class="input" type="email" name="email" [(ngModel)]="edit.email" /></div>
            <div><label class="label">Phone</label><input class="input" [value]="p.phone" disabled /><p class="mt-1 text-xs text-taupe">To change your phone number, please contact the salon.</p></div>
            <div><label class="label">Customer ID</label><input class="input" [value]="p.customerNumber" disabled /></div>
            <button class="btn-primary">Save</button>
          </form>
          <div class="space-y-6">
            <div class="card-pad text-center">
              <p class="eyebrow">My QR code</p>
              <img [src]="p.qrCode" alt="My QR code" class="mx-auto mt-4 size-52" />
              <p class="mt-2 text-xs text-taupe">The code contains no personal data — only a private identifier.</p>
            </div>
            <form class="card-pad space-y-3" (ngSubmit)="changePassword()">
              <p class="eyebrow">Password</p>
              <input class="input" type="password" name="cur" [(ngModel)]="pwd.current" placeholder="Current password" autocomplete="current-password" required />
              <input class="input" type="password" name="new" [(ngModel)]="pwd.next" placeholder="New password (8+ characters)" minlength="8" autocomplete="new-password" required />
              <button class="btn-outline">Change password</button>
            </form>
          </div>
        </div>
      }

      <!-- Notifications -->
      @if (tab() === 'notifications') {
        <div class="card mt-8 divide-y divide-cream animate-fade-up">
          @for (n of notifications(); track n.id) {
            <div class="flex items-center justify-between gap-4 p-4 text-sm">
              <div class="flex items-center gap-3"><ui-icon [name]="n.channel === 'EMAIL' ? 'mail' : 'phone'" class="text-taupe" /><span>{{ n.subject }}</span></div>
              <span class="shrink-0 text-xs text-taupe">{{ dateShort(n.createdAt) }} · {{ n.status === 'SENT' ? 'Sent' : n.status === 'NOT_CONFIGURED' ? 'Not sent (channel not set up)' : n.status.toLowerCase() }}</span>
            </div>
          } @empty { <ui-empty title="No notifications" icon="bell" /> }
        </div>
      }
    </section>

    <ui-modal [open]="!!moving()" title="Reschedule" eyebrow="Choose a new time" (closed)="moving.set(null)" [wide]="true">
      @if (moving(); as m) {
        <nea-slot-picker [serviceId]="m.service.id" [employeeId]="m.employee.id" (picked)="newSlot.set($event)" />
        <div class="mt-5 flex justify-end gap-2"><button class="btn-ghost" (click)="moving.set(null)">Close</button><button class="btn-primary" [disabled]="!newSlot()" (click)="reschedule()">Confirm new time</button></div>
      }
    </ui-modal>
  `,
})
export class AccountPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'loyalty', label: 'Loyalty card' },
    { id: 'profile', label: 'Profile' },
    { id: 'notifications', label: 'Notifications' },
  ];
  tab = signal('overview');
  profile = signal<Profile | null>(null);
  card = signal<LoyaltySummary | null>(null);
  appts = signal<Appointment[]>([]);
  notifications = signal<Notif[]>([]);
  moving = signal<Appointment | null>(null);
  newSlot = signal<PickedSlot | null>(null);
  edit = { fullName: '', email: '' };
  pwd = { current: '', next: '' };
  firstName = computed(() => (this.profile()?.fullName ?? this.auth.user()?.customer?.fullName ?? '').split(' ')[0]);
  upcoming = computed(() => this.appts().filter((a) => ['PENDING', 'CONFIRMED'].includes(a.status) && new Date(a.endAt) > new Date()).sort((a, b) => a.startAt.localeCompare(b.startAt)));
  past = computed(() => this.appts().filter((a) => !this.upcoming().includes(a)));
  availableRewards = computed(() => this.card()?.rewards.filter((r) => r.status === 'AVAILABLE') ?? []);
  dateLong = dateLong; dateShort = dateShort; dateTime = dateTime; time = time; mad = mad;
  dayNum = (iso: string) => dateShort(iso).split(' ')[0];
  month = (iso: string) => dateShort(iso).split(' ')[1];

  constructor() {
    this.load();
  }

  async load() {
    const [p, c, a, n] = await Promise.all([
      this.api.get<Profile>('/api/me/profile'),
      this.api.myLoyalty(),
      this.api.get<Appointment[]>('/api/me/appointments'),
      this.api.get<Notif[]>('/api/me/notifications'),
    ]);
    this.profile.set(p);
    this.edit = { fullName: p.fullName, email: p.email ?? '' };
    this.card.set(c);
    this.appts.set(a);
    this.notifications.set(n);
  }

  async cancel(a: Appointment) {
    if (!confirm(`Cancel ${a.service.name} on ${dateLong(a.startAt)}?`)) return;
    try {
      await this.api.post(`/api/me/appointments/${a.id}/cancel`, {});
      this.toast.success('Appointment cancelled');
      this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async reschedule() {
    try {
      await this.api.post(`/api/me/appointments/${this.moving()!.id}/reschedule`, { startAt: this.newSlot()!.startAt });
      this.toast.success('Appointment moved');
      this.moving.set(null);
      this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async saveProfile() {
    try {
      await this.api.patch('/api/me/profile', { fullName: this.edit.fullName, ...(this.edit.email ? { email: this.edit.email } : {}) });
      this.toast.success('Profile saved');
      this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async changePassword() {
    try {
      await this.api.post('/api/auth/change-password', { currentPassword: this.pwd.current, newPassword: this.pwd.next });
      this.pwd = { current: '', next: '' };
      this.toast.success('Password changed');
    } catch (e) {
      this.toast.error(e);
    }
  }
}

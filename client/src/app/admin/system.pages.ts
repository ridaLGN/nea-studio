import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { dateTime, hhmm, labelDay, toMinute, WEEKDAYS } from '../core/format';
import { Empty, Icon } from '../shared/ui';

interface Integration { channel: string; configured: boolean }

// ===========================================================================
// Notifications log
// ===========================================================================
interface Notif { id: string; channel: string; type: string; status: string; recipient: string; subject: string | null; error: string | null; createdAt: string; sentAt: string | null; customer: { fullName: string } | null }

@Component({
  selector: 'nea-notifications',
  imports: [FormsModule, Icon, Empty],
  template: `
    <p class="eyebrow">System</p>
    <h1 class="title-lg mt-1">Notifications</h1>
    <div class="mt-6 grid gap-3 md:grid-cols-2">
      @for (i of integrations(); track i.channel) {
        <div class="card-pad flex items-center gap-4">
          <span class="flex size-10 items-center justify-center rounded-full" [class]="i.configured ? 'bg-free text-free-strong' : 'bg-pending-soft text-pending'"><ui-icon [name]="i.channel === 'EMAIL' ? 'mail' : 'phone'" /></span>
          <div>
            <p class="font-medium">{{ i.channel === 'EMAIL' ? 'Email (SMTP)' : 'WhatsApp Business' }} — {{ i.configured ? 'connected' : 'not configured' }}</p>
            <p class="text-xs text-taupe">{{ i.configured ? 'Messages are delivered and their status is tracked.' : 'Messages are logged with status NOT_CONFIGURED and are not sent. See README for the required credentials.' }}</p>
          </div>
        </div>
      }
    </div>
    <div class="mt-6 flex flex-wrap gap-2">
      @for (s of ['', 'SENT', 'FAILED', 'NOT_CONFIGURED', 'QUEUED']; track s) {
        <button class="tab" [class.active]="status === s" (click)="status = s; load()">{{ s ? s.replace('_', ' ').toLowerCase() : 'all' }} @if (count(s); as c) { <span class="ml-1 opacity-60">{{ c }}</span> }</button>
      }
    </div>
    <div class="card mt-4 overflow-x-auto">
      <table class="table">
        <thead><tr><th>Date</th><th>Type</th><th>Channel</th><th>Recipient</th><th>Status</th></tr></thead>
        <tbody>
          @for (n of items(); track n.id) {
            <tr>
              <td class="whitespace-nowrap">{{ dateTime(n.createdAt) }}</td>
              <td><p>{{ n.subject }}</p><p class="text-xs text-taupe">{{ n.type.replaceAll('_', ' ').toLowerCase() }}</p></td>
              <td>{{ n.channel.toLowerCase() }}</td>
              <td class="text-xs">{{ n.customer?.fullName }}<br /><span class="text-taupe">{{ n.recipient }}</span></td>
              <td><span [class]="n.status === 'SENT' ? 'badge-completed' : n.status === 'FAILED' ? 'badge-noshow' : n.status === 'NOT_CONFIGURED' ? 'badge-pending' : 'badge-neutral'">{{ n.status.replace('_', ' ').toLowerCase() }}</span>
                @if (n.error) { <p class="mt-1 max-w-xs text-[0.65rem] text-taupe">{{ n.error }}</p> }</td>
            </tr>
          }
        </tbody>
      </table>
      @if (!items().length) { <ui-empty title="No notifications" icon="bell" /> }
    </div>
  `,
})
export class NotificationsPage {
  private api = inject(ApiService);
  items = signal<Notif[]>([]);
  integrations = signal<Integration[]>([]);
  byStatus = signal<{ status: string; _count: number }[]>([]);
  status = '';
  dateTime = dateTime;
  count = (s: string) => (s ? this.byStatus().find((b) => b.status === s)?._count : this.byStatus().reduce((a, b) => a + b._count, 0)) ?? 0;
  constructor() { this.load(); }
  async load() {
    const r = await this.api.get<{ items: Notif[]; integrations: Integration[]; byStatus: { status: string; _count: number }[] }>('/api/admin/notifications', { status: this.status });
    this.items.set(r.items); this.integrations.set(r.integrations); this.byStatus.set(r.byStatus);
  }
}

// ===========================================================================
// Business settings
// ===========================================================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Settings = Record<string, any>;

@Component({
  selector: 'nea-settings',
  imports: [FormsModule, Icon],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">System</p><h1 class="title-lg mt-1">Business settings</h1></div>
      <button class="btn-primary" (click)="save()"><ui-icon name="check" [size]="16" /> Save settings</button>
    </div>
    @if (s(); as s) {
      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <div class="card-pad space-y-3">
          <p class="eyebrow">Salon</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div><label class="label">Name</label><input class="input" [(ngModel)]="s['name']" /></div>
            <div><label class="label">Tagline</label><input class="input" [(ngModel)]="s['tagline']" /></div>
            <div class="sm:col-span-2"><label class="label">Address</label><input class="input" [(ngModel)]="s['address']" /></div>
            <div><label class="label">City</label><input class="input" [(ngModel)]="s['city']" /></div>
            <div><label class="label">Phone</label><input class="input" [(ngModel)]="s['phone']" /></div>
            <div><label class="label">Email</label><input class="input" [(ngModel)]="s['email']" /></div>
            <div><label class="label">Instagram handle</label><input class="input" [(ngModel)]="s['instagram']" placeholder="neastudio" /></div>
            <div><label class="label">Currency</label><input class="input" [(ngModel)]="s['currency']" maxlength="3" /></div>
            <div><label class="label">Timezone</label><input class="input" [(ngModel)]="s['timezone']" /></div>
            <div class="sm:col-span-2 flex items-center gap-3"><label class="label !mb-0">Logo</label><label class="btn-outline btn-sm cursor-pointer"><ui-icon name="upload" [size]="14" /> Upload<input type="file" accept="image/*" class="hidden" (change)="uploadLogo($event)" /></label>@if (s['logoUrl']) { <img [src]="s['logoUrl']" class="h-10" alt="logo" /> }</div>
          </div>
        </div>

        <div class="card-pad space-y-3">
          <p class="eyebrow">Booking rules</p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div><label class="label">Slot interval (min)</label><input class="input" type="number" [(ngModel)]="s['slotIntervalMinutes']" /></div>
            <div><label class="label">Buffer between appointments (min)</label><input class="input" type="number" [(ngModel)]="s['bufferMinutes']" /></div>
            <div><label class="label">Minimum notice (min)</label><input class="input" type="number" [(ngModel)]="s['minNoticeMinutes']" /></div>
            <div><label class="label">Book up to (days ahead)</label><input class="input" type="number" [(ngModel)]="s['maxAdvanceDays']" /></div>
            <div><label class="label">Free cancellation until (hours before)</label><input class="input" type="number" [(ngModel)]="s['cancellationNoticeHours']" /></div>
          </div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" [(ngModel)]="s['autoConfirmOnline']" /> Confirm online bookings automatically (otherwise “pending”)</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" [(ngModel)]="s['allowOnlineCancellation']" /> Customers can cancel / reschedule online</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" [(ngModel)]="s['employeesCanComplete']" /> Employees can validate their own appointments</label>
          <div><label class="label">Cancellation policy (shown to customers)</label><textarea class="input" rows="3" [(ngModel)]="s['cancellationPolicyText']"></textarea></div>
        </div>

        <div class="card-pad space-y-3">
          <p class="eyebrow">Loyalty</p>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" [(ngModel)]="s['loyaltyEnabled']" /> Loyalty programme enabled</label>
          <div class="grid gap-3 sm:grid-cols-3">
            <div><label class="label">Stamps per visit</label><input class="input" type="number" min="1" [(ngModel)]="s['stampsPerVisit']" /></div>
            <div><label class="label">Cycle length (stamps)</label><input class="input" type="number" min="1" [(ngModel)]="s['loyaltyCycleStamps']" /></div>
            <div><label class="label">Circles on card</label><input class="input" type="number" min="4" max="20" [(ngModel)]="s['loyaltyCardSlots']" /></div>
          </div>
          <p class="text-xs text-taupe">Discount milestones are managed on the Loyalty page.</p>
        </div>

        <div class="card-pad">
          <div class="flex items-center justify-between"><p class="eyebrow">Opening hours</p><button class="btn-outline btn-sm" (click)="saveHours()">Save hours</button></div>
          <div class="mt-3 divide-y divide-cream">
            @for (o of hours(); track o.weekday) {
              <div class="flex items-center gap-3 py-2.5">
                <span class="w-28 text-sm">{{ WEEKDAYS[o.weekday - 1] }}</span>
                <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" class="checkbox" [(ngModel)]="o.open" />Open</label>
                @if (o.open) { <input type="time" class="input !w-28 !py-1.5" [(ngModel)]="o.from" step="900" /><span class="text-taupe">–</span><input type="time" class="input !w-28 !py-1.5" [(ngModel)]="o.to" step="900" /> } @else { <span class="text-sm text-taupe">Closed</span> }
              </div>
            }
          </div>
          <p class="eyebrow mb-2 mt-6">Closure days (public holidays…)</p>
          <div class="flex gap-2"><input type="date" class="input" [(ngModel)]="closure.date" /><input class="input" placeholder="Reason" [(ngModel)]="closure.reason" /><button class="btn-primary btn-sm" (click)="addClosure()">Add</button></div>
          @for (c of closures(); track c.id) {
            <div class="flex items-center justify-between border-b border-cream py-2 text-sm last:border-0"><span>{{ labelDay(c.date) }} <span class="text-taupe">{{ c.reason }}</span></span><button class="icon-btn size-7" (click)="removeClosure(c.id)"><ui-icon name="trash" [size]="14" /></button></div>
          }
        </div>

        <div class="card-pad xl:col-span-2">
          <p class="eyebrow mb-3">Integrations</p>
          @for (i of integrations(); track i.channel) {
            <p class="flex items-center gap-2 py-1 text-sm"><span class="size-2 rounded-full" [class]="i.configured ? 'bg-free-strong' : 'bg-pending'"></span>{{ i.channel === 'EMAIL' ? 'Email (SMTP)' : 'WhatsApp Business Cloud API' }}: {{ i.configured ? 'configured' : 'not configured — set the environment variables listed in the README' }}</p>
          }
        </div>
      </div>
    }
  `,
})
export class SettingsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  WEEKDAYS = WEEKDAYS;
  labelDay = (d: string) => labelDay(d);
  s = signal<Settings | null>(null);
  hours = signal<{ weekday: number; open: boolean; from: string; to: string }[]>([]);
  closures = signal<{ id: string; date: string; reason: string | null }[]>([]);
  integrations = signal<Integration[]>([]);
  closure = { date: '', reason: '' };
  constructor() { this.load(); }
  async load() {
    const r = await this.api.get<{ settings: Settings; openingHours: { weekday: number; isClosed: boolean; openMinute: number; closeMinute: number }[]; closures: { id: string; date: string; reason: string | null }[]; integrations: Integration[] }>('/api/admin/settings');
    this.s.set({ ...r.settings });
    this.hours.set(r.openingHours.map((o) => ({ weekday: o.weekday, open: !o.isClosed, from: hhmm(o.openMinute), to: hhmm(o.closeMinute) })));
    this.closures.set(r.closures);
    this.integrations.set(r.integrations);
  }
  async save() {
    const { id: _id, updatedAt: _u, ...body } = this.s()!;
    for (const k of ['slotIntervalMinutes', 'bufferMinutes', 'minNoticeMinutes', 'maxAdvanceDays', 'cancellationNoticeHours', 'stampsPerVisit', 'loyaltyCycleStamps', 'loyaltyCardSlots']) body[k] = Number(body[k]);
    for (const k of ['tagline', 'logoUrl', 'address', 'phone', 'email', 'instagram', 'cancellationPolicyText']) if (body[k] === '') body[k] = null;
    try { await this.api.patch('/api/admin/settings', body); await this.api.loadSettings(); this.toast.success('Settings saved'); } catch (e) { this.toast.error(e); }
  }
  async uploadLogo(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { const r = await this.api.upload(f); this.s.update((s) => ({ ...s!, logoUrl: r.url })); } catch (e) { this.toast.error(e); }
  }
  async saveHours() {
    try {
      await this.api.put('/api/admin/opening-hours', this.hours().map((o) => ({ weekday: o.weekday, isClosed: !o.open, openMinute: toMinute(o.from), closeMinute: toMinute(o.to) })));
      await this.api.loadSettings();
      this.toast.success('Opening hours saved');
    } catch (e) { this.toast.error(e); }
  }
  async addClosure() {
    if (!this.closure.date) return;
    try { await this.api.post('/api/admin/closures', { date: this.closure.date, reason: this.closure.reason || undefined }); this.closure = { date: '', reason: '' }; this.load(); } catch (e) { this.toast.error(e); }
  }
  async removeClosure(id: string) { try { await this.api.delete(`/api/admin/closures/${id}`); this.load(); } catch (e) { this.toast.error(e); } }
}

// ===========================================================================
// Audit log
// ===========================================================================
interface Log { id: string; action: string; entityType: string; entityId: string | null; details: unknown; ip: string | null; createdAt: string; actor: string | null }

@Component({
  selector: 'nea-audit',
  imports: [JsonPipe],
  template: `
    <p class="eyebrow">System</p>
    <h1 class="title-lg mt-1">Audit log</h1>
    <p class="mt-2 text-sm text-taupe">Every sensitive operation (bookings, status changes, loyalty adjustments, settings, logins) is recorded here.</p>
    <div class="card mt-6 overflow-x-auto">
      <table class="table">
        <thead><tr><th>Date</th><th>Action</th><th>Entity</th><th>By</th><th>Details</th></tr></thead>
        <tbody>
          @for (l of items(); track l.id) {
            <tr>
              <td class="whitespace-nowrap">{{ dateTime(l.createdAt) }}</td>
              <td><span class="badge-neutral">{{ l.action.replaceAll('_', ' ').toLowerCase() }}</span></td>
              <td class="text-xs">{{ l.entityType }}<br /><span class="font-mono text-taupe">{{ l.entityId }}</span></td>
              <td class="text-xs">{{ l.actor ?? 'customer / system' }}<br /><span class="text-taupe">{{ l.ip }}</span></td>
              <td class="max-w-sm"><code class="block truncate text-[0.65rem] text-taupe" [title]="l.details | json">{{ l.details | json }}</code></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <div class="mt-4 flex items-center justify-between text-sm text-taupe">
      <span>{{ total() }} entries</span>
      <div class="flex gap-2"><button class="btn-outline btn-sm" [disabled]="page() <= 1" (click)="go(page() - 1)">Previous</button><button class="btn-outline btn-sm" [disabled]="page() * 50 >= total()" (click)="go(page() + 1)">Next</button></div>
    </div>
  `,
})
export class AuditPage {
  private api = inject(ApiService);
  items = signal<Log[]>([]);
  total = signal(0);
  page = signal(1);
  dateTime = dateTime;
  constructor() { this.load(); }
  go(p: number) { this.page.set(p); this.load(); }
  async load() {
    const r = await this.api.get<{ total: number; items: Log[] }>('/api/admin/audit-logs', { page: this.page() });
    this.items.set(r.items);
    this.total.set(r.total);
  }
}

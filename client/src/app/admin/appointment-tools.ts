import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { dateLong, dateTime, mad, time, isoDay, STATUS_LABEL } from '../core/format';
import type { Appointment, Service } from '../core/models';
import { Avatar, Icon, Modal, Spinner, StatusBadge } from '../shared/ui';
import { SlotPicker, type PickedSlot } from '../shared/slot-picker';

interface Detail extends Appointment {
  history: { id: string; action: string; fromStatus: string | null; toStatus: string | null; createdAt: string; actor: string; details: Record<string, unknown> | null }[];
  availableRewards: { id: string; discountPercent: number; expiresAt: string | null }[];
}

/** Cached public service list (with qualified employees) shared by admin tools */
let servicesCache: Promise<Service[]> | null = null;
export function loadServices(api: ApiService) {
  servicesCache ??= api.services();
  return servicesCache;
}

// ===========================================================================
// Appointment drawer
// ===========================================================================
@Component({
  selector: 'nea-appointment-drawer',
  imports: [FormsModule, RouterLink, Modal, Icon, Avatar, StatusBadge, Spinner, SlotPicker],
  template: `
    <ui-modal [open]="!!appointmentId()" [drawer]="true" [title]="a()?.service?.name ?? 'Appointment'" [eyebrow]="a()?.reference ?? ''" (closed)="closed.emit()">
      @if (!a()) {
        <div class="flex justify-center py-16"><ui-spinner /></div>
      } @else {
        @let d = a()!;
        <div class="space-y-6">
          <div class="flex items-center justify-between">
            <ui-status [status]="d.status" />
            <span class="text-xs text-taupe">{{ d.source === 'ONLINE' ? 'Booked online' : 'Booked by the salon' }} · {{ dateTime(d.createdAt) }}</span>
          </div>

          <div class="card-pad space-y-3 text-sm">
            <p class="flex items-center gap-3"><ui-icon name="calendar" class="text-taupe" />{{ dateLong(d.startAt) }}</p>
            <p class="flex items-center gap-3"><ui-icon name="clock" class="text-taupe" />{{ time(d.startAt) }} – {{ time(d.endAt) }} ({{ d.durationMinutes }} min)</p>
            <p class="flex items-center gap-3"><ui-avatar [name]="d.employee.name" [src]="d.employee.photoUrl" [color]="d.employee.color" [size]="22" />{{ d.employee.name }}</p>
            <p class="flex items-center gap-3"><ui-icon name="card" class="text-taupe" />{{ mad(d.priceMad) }}
              @if (d.discountMad) { <span class="text-burgundy">· -{{ d.discountPercent }}% ({{ mad(d.discountMad) }})</span> }
              @if (d.paidMad) { <span class="badge-completed">Paid {{ mad(d.paidMad) }}</span> }
            </p>
          </div>

          <div class="card-pad text-sm">
            <p class="eyebrow mb-3">Customer</p>
            <a [routerLink]="['/admin/customers', d.customer.id]" class="font-display text-xl hover:text-burgundy" (click)="closed.emit()">{{ d.customer.fullName }}</a>
            <p class="text-taupe">{{ d.customer.customerNumber }} · {{ d.customer.phone }}</p>
            @if (d.customer.email) { <p class="text-taupe">{{ d.customer.email }}</p> }
          </div>

          <div>
            <label class="label" for="notes">Notes</label>
            <textarea id="notes" class="input" rows="2" [(ngModel)]="notes" (blur)="saveNotes()"></textarea>
          </div>

          @if (d.status === 'PENDING' || d.status === 'CONFIRMED') {
            <!-- Validate -->
            <div class="rounded-2xl border border-burgundy/20 bg-burgundy-soft/40 p-5">
              <p class="font-medium">Validate the visit</p>
              <p class="mt-1 text-xs text-taupe">Marks the appointment completed, records the payment and adds the loyalty stamp (once).</p>
              <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label class="label">Reward</label>
                  <select class="select" [(ngModel)]="rewardId">
                    <option [ngValue]="null">No discount</option>
                    @for (r of d.availableRewards; track r.id) { <option [ngValue]="r.id">-{{ r.discountPercent }}% loyalty reward</option> }
                  </select>
                </div>
                <div>
                  <label class="label">Payment</label>
                  <select class="select" [(ngModel)]="paymentMethod">
                    <option value="CASH">Cash</option><option value="CARD">Card</option><option value="TRANSFER">Transfer</option><option value="OTHER">Other</option><option [ngValue]="null">Not paid yet</option>
                  </select>
                </div>
              </div>
              <button class="btn-primary mt-4 w-full" [disabled]="busy()" (click)="complete()"><ui-icon name="check" [size]="16" /> Validate & stamp card</button>
            </div>

            <div class="flex flex-wrap gap-2">
              @if (d.status === 'PENDING') { <button class="btn-outline btn-sm" (click)="setStatus('CONFIRMED')"><ui-icon name="check" [size]="14" /> Confirm</button> }
              <button class="btn-outline btn-sm" (click)="moving.set(!moving())"><ui-icon name="calendar" [size]="14" /> Reschedule</button>
              <button class="btn-outline btn-sm" (click)="setStatus('NO_SHOW')">No-show</button>
              <button class="btn-danger btn-sm" (click)="cancel()"><ui-icon name="x" [size]="14" /> Cancel</button>
            </div>

            @if (moving()) {
              <div class="card-pad animate-fade-up">
                <label class="label">Team member</label>
                <select class="select mb-4" [(ngModel)]="moveEmployee">
                  @for (e of qualified(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }
                </select>
                <nea-slot-picker mode="admin" [serviceId]="d.service.id" [employeeId]="moveEmployee" [excludeAppointmentId]="d.id" [initialDate]="day(d.startAt)" (picked)="moveSlot.set($event)" />
                <button class="btn-primary mt-4 w-full" [disabled]="!moveSlot() || busy()" (click)="reschedule()">Move appointment{{ moveSlot() ? ' to ' + moveSlot()!.time : '' }}</button>
              </div>
            }
          }
          @if (d.status === 'NO_SHOW') { <button class="btn-outline btn-sm" (click)="setStatus('CONFIRMED')">Restore (customer did come)</button> }
          @if (d.cancellationReason) { <p class="text-sm text-taupe">Cancellation reason: {{ d.cancellationReason }}</p> }

          <div>
            <p class="eyebrow mb-3">History</p>
            <ol class="relative space-y-4 border-l border-cream pl-5">
              @for (h of d.history; track h.id) {
                <li class="text-sm">
                  <span class="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-beige"></span>
                  <p>{{ describe(h) }}</p>
                  <p class="text-xs text-taupe">{{ dateTime(h.createdAt) }} · {{ h.actor }}</p>
                </li>
              }
            </ol>
          </div>
        </div>
      }
    </ui-modal>
  `,
})
export class AppointmentDrawer {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  appointmentId = input<string | null>(null);
  closed = output<void>();
  changed = output<void>();
  a = signal<Detail | null>(null);
  services = signal<Service[]>([]);
  busy = signal(false);
  moving = signal(false);
  moveSlot = signal<PickedSlot | null>(null);
  moveEmployee: string | null = null;
  notes = '';
  rewardId: string | null = null;
  paymentMethod: string | null = 'CASH';
  qualified = computed(() => this.services().find((s) => s.id === this.a()?.service.id)?.employees ?? []);
  dateLong = dateLong; dateTime = dateTime; time = time; mad = mad;
  day = (iso: string) => isoDay(new Date(iso));

  constructor() {
    loadServices(this.api).then((s) => this.services.set(s));
    effect(() => {
      const id = this.appointmentId();
      untracked(() => {
        this.a.set(null);
        this.moving.set(false);
        if (id) this.load(id);
      });
    });
  }

  async load(id = this.appointmentId()!) {
    const d = await this.api.get<Detail>(`/api/admin/appointments/${id}`);
    this.a.set(d);
    this.notes = d.notes ?? '';
    this.rewardId = null;
    this.moveEmployee = d.employee.id;
  }

  private async act(fn: () => Promise<unknown>, ok: string) {
    this.busy.set(true);
    try {
      await fn();
      this.toast.success(ok);
      await this.load();
      this.changed.emit();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  setStatus(status: string) {
    return this.act(() => this.api.post(`/api/admin/appointments/${this.a()!.id}/status`, { status }), `Marked as ${STATUS_LABEL[status].toLowerCase()}`);
  }
  cancel() {
    const reason = prompt('Reason for cancellation (optional)');
    if (reason === null) return;
    return this.act(() => this.api.post(`/api/admin/appointments/${this.a()!.id}/status`, { status: 'CANCELLED', reason: reason || undefined }), 'Appointment cancelled');
  }
  complete() {
    return this.act(async () => {
      const r = await this.api.post<{ stamped: boolean; newRewards: { discountPercent: number }[] }>(`/api/admin/appointments/${this.a()!.id}/complete`, { rewardId: this.rewardId, paymentMethod: this.paymentMethod });
      if (r.newRewards.length) this.toast.show(`🎉 Reward unlocked: -${r.newRewards.map((x) => x.discountPercent).join('%, -')}%`, 'success');
    }, 'Visit validated — loyalty card stamped');
  }
  reschedule() {
    return this.act(() => this.api.post(`/api/admin/appointments/${this.a()!.id}/reschedule`, { startAt: this.moveSlot()!.startAt, employeeId: this.moveEmployee }), 'Appointment moved').then(() => this.moving.set(false));
  }
  async saveNotes() {
    if ((this.a()?.notes ?? '') === this.notes) return;
    try {
      await this.api.patch(`/api/admin/appointments/${this.a()!.id}`, { notes: this.notes || null });
      this.toast.success('Notes saved');
    } catch (e) {
      this.toast.error(e);
    }
  }
  describe(h: Detail['history'][number]) {
    if (h.action === 'CREATED') return `Created (${STATUS_LABEL[h.toStatus ?? ''] ?? ''})`;
    if (h.action === 'RESCHEDULED') return 'Rescheduled';
    if (h.action === 'COMPLETED') return 'Visit validated · stamp added';
    if (h.action === 'CANCELLED') return 'Cancelled';
    if (h.action === 'UPDATED') return 'Details updated';
    return `${STATUS_LABEL[h.fromStatus ?? ''] ?? ''} → ${STATUS_LABEL[h.toStatus ?? ''] ?? ''}`;
  }
}

// ===========================================================================
// Quick appointment creation
// ===========================================================================
export interface QuickPrefill { serviceId?: string; employeeId?: string | null; date?: string; time?: string; customerId?: string; customerName?: string }
interface CustomerHit { id: string; fullName: string; customerNumber: string; phone: string }

@Component({
  selector: 'nea-quick-create',
  imports: [FormsModule, Modal, Icon, SlotPicker],
  template: `
    <ui-modal [open]="open()" title="New appointment" eyebrow="Quick booking" [wide]="true" (closed)="closed.emit()">
      <div class="space-y-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label">Service</label>
            <select class="select" [ngModel]="serviceId()" (ngModelChange)="serviceId.set($event)">
              <option [ngValue]="null" disabled>Choose…</option>
              @for (s of services(); track s.id) { <option [ngValue]="s.id">{{ s.name }} · {{ s.durationMinutes }} min</option> }
            </select>
          </div>
          <div>
            <label class="label">Team member</label>
            <select class="select" [ngModel]="employeeId()" (ngModelChange)="employeeId.set($event)">
              <option [ngValue]="null">Any available</option>
              @for (e of qualified(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }
            </select>
          </div>
        </div>

        @if (serviceId()) {
          @if (fixed(); as f) {
            <div class="flex items-center justify-between rounded-xl bg-cream/70 px-4 py-3 text-sm">
              <span><ui-icon name="clock" [size]="15" class="mr-1 align-[-3px] text-taupe" /> {{ f.date }} at <b>{{ f.time }}</b></span>
              <button class="btn-ghost btn-sm" (click)="fixed.set(null)">Change time</button>
            </div>
          } @else {
            <nea-slot-picker mode="admin" [serviceId]="serviceId()!" [employeeId]="employeeId()" [initialDate]="prefill()?.date ?? null" (picked)="slot.set($event)" />
          }
        }

        <div>
          <label class="label">Customer</label>
          @if (customer(); as c) {
            <div class="flex items-center justify-between rounded-xl border border-cream bg-white px-4 py-3 text-sm">
              <span><b>{{ c.fullName }}</b> <span class="text-taupe">{{ c.customerNumber }}</span></span>
              <button class="btn-ghost btn-sm" (click)="customer.set(null)">Change</button>
            </div>
          } @else {
            <div class="segmented mb-3"><button [class.active]="!isNew()" (click)="isNew.set(false)">Existing</button><button [class.active]="isNew()" (click)="isNew.set(true)">New customer</button></div>
            @if (!isNew()) {
              <input class="input" placeholder="Search by name, phone or customer ID" [ngModel]="q()" (ngModelChange)="search($event)" />
              @if (hits().length) {
                <div class="mt-2 divide-y divide-cream rounded-xl border border-cream bg-white">
                  @for (h of hits(); track h.id) { <button class="block w-full px-4 py-2.5 text-left text-sm hover:bg-ivory" (click)="customer.set(h)">{{ h.fullName }} <span class="text-taupe">· {{ h.phone }}</span></button> }
                </div>
              }
            } @else {
              <div class="grid gap-3 sm:grid-cols-3">
                <input class="input" placeholder="Full name" [(ngModel)]="newCustomer.fullName" />
                <input class="input" placeholder="Phone" [(ngModel)]="newCustomer.phone" inputmode="tel" />
                <input class="input" placeholder="Email (optional)" [(ngModel)]="newCustomer.email" />
              </div>
            }
          }
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <div class="sm:col-span-2"><label class="label">Notes</label><input class="input" [(ngModel)]="notes" /></div>
          <div><label class="label">Status</label><select class="select" [(ngModel)]="status"><option value="CONFIRMED">Confirmed</option><option value="PENDING">Pending</option></select></div>
        </div>

        <div class="flex justify-end gap-2">
          <button class="btn-ghost" (click)="closed.emit()">Cancel</button>
          <button class="btn-primary" [disabled]="busy() || !canSubmit()" (click)="submit()">Create appointment</button>
        </div>
      </div>
    </ui-modal>
  `,
})
export class QuickCreate {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  open = input(false);
  prefill = input<QuickPrefill | null>(null);
  closed = output<void>();
  created = output<Appointment>();

  services = signal<Service[]>([]);
  serviceId = signal<string | null>(null);
  employeeId = signal<string | null>(null);
  fixed = signal<{ date: string; time: string } | null>(null);
  slot = signal<PickedSlot | null>(null);
  customer = signal<CustomerHit | null>(null);
  isNew = signal(false);
  q = signal('');
  hits = signal<CustomerHit[]>([]);
  busy = signal(false);
  newCustomer = { fullName: '', phone: '', email: '' };
  notes = '';
  status = 'CONFIRMED';
  qualified = computed(() => this.services().find((s) => s.id === this.serviceId())?.employees ?? []);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    loadServices(this.api).then((s) => this.services.set(s));
    effect(() => {
      if (!this.open()) return;
      const p = this.prefill();
      untracked(() => {
        this.serviceId.set(p?.serviceId ?? null);
        this.employeeId.set(p?.employeeId ?? null);
        this.fixed.set(p?.date && p?.time ? { date: p.date, time: p.time } : null);
        this.slot.set(null);
        this.customer.set(p?.customerId ? { id: p.customerId, fullName: p.customerName ?? 'Customer', customerNumber: '', phone: '' } : null);
        this.isNew.set(false);
        this.q.set('');
        this.hits.set([]);
        this.newCustomer = { fullName: '', phone: '', email: '' };
        this.notes = '';
        this.status = 'CONFIRMED';
      });
    });
  }

  canSubmit = computed(() => !!this.serviceId() && (!!this.fixed() || !!this.slot()));

  search(v: string) {
    this.q.set(v);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => this.hits.set(v.trim().length >= 2 ? await this.api.get<CustomerHit[]>('/api/staff/customers/search', { q: v }) : []), 250);
  }

  async submit() {
    const f = this.fixed();
    const s = this.slot();
    const body: Record<string, unknown> = {
      serviceId: this.serviceId(),
      employeeId: this.employeeId(),
      notes: this.notes || undefined,
      status: this.status,
      ...(f ? { date: f.date, time: f.time } : { startAt: s!.startAt }),
    };
    if (this.customer()) body['customerId'] = this.customer()!.id;
    else if (this.isNew() && this.newCustomer.fullName && this.newCustomer.phone) body['customer'] = this.newCustomer;
    else return this.toast.show('Select an existing customer or enter a new one', 'error');
    this.busy.set(true);
    try {
      const a = await this.api.post<Appointment>('/api/admin/appointments', body);
      this.toast.success(`Appointment ${a.reference} created`);
      this.created.emit(a);
      this.closed.emit();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

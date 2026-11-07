import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { addDays, hhmm, isoDay, labelDay, time, WEEKDAYS, mad } from '../core/format';
import type { Appointment, Block, Interval } from '../core/models';
import { Empty, Icon, StatusBadge } from '../shared/ui';

interface MyDay {
  date: string;
  day: { status: string; reason?: string | null; window: Interval | null; blocks: Block[]; free: Interval[] };
  appointments: Appointment[];
  schedule: {
    workingHours: { weekday: number; startMinute: number; endMinute: number }[];
    breaks: { weekday: number; startMinute: number; endMinute: number; label: string }[];
    absences: { id: string; type: string; startDate: string; endDate: string; reason: string | null }[];
    services: string[];
  };
}

/** Employee dashboard: own schedule, appointments, free time, working hours, breaks and days off. */
@Component({
  selector: 'nea-staff-day',
  imports: [FormsModule, RouterLink, Icon, StatusBadge, Empty],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">My day</p><h1 class="title-lg mt-1">{{ labelDay(date(), { weekday: 'long', day: 'numeric', month: 'long' }) }}</h1></div>
      <div class="flex items-center gap-2">
        <button class="icon-btn bg-white" (click)="date.set(addDays(date(), -1))"><ui-icon name="chevron-left" /></button>
        <button class="btn-outline btn-sm" (click)="date.set(today)">Today</button>
        <button class="icon-btn bg-white" (click)="date.set(addDays(date(), 1))"><ui-icon name="chevron-right" /></button>
        @if (auth.can('qr.scan')) { <a routerLink="/staff/scan" class="btn-primary btn-sm"><ui-icon name="scan" [size]="15" /> Scan a client</a> }
      </div>
    </div>

    @if (data(); as d) {
      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <div class="space-y-3 xl:col-span-2">
          @if (d.day.status !== 'WORKING') {
            <div class="card-pad text-center" [class.cal-absent]="d.day.status === 'ABSENT'"><p class="font-display text-2xl">{{ d.day.status === 'ABSENT' ? 'Absent' : d.day.status === 'SALON_CLOSED' ? 'Salon closed' : 'Day off' }}</p>@if (d.day.reason) { <p class="text-sm text-taupe">{{ d.day.reason }}</p> }</div>
          } @else {
            <p class="text-sm text-taupe">Working {{ hhmm(d.day.window!.start) }} – {{ hhmm(d.day.window!.end) }} · {{ active().length }} appointment{{ active().length === 1 ? '' : 's' }} · {{ freeMinutes() }} min free</p>
          }
          @for (item of timeline(); track item.key) {
            @if (item.kind === 'appt') {
              @let a = item.appt!;
              <div class="card flex flex-wrap items-center gap-4 p-4" [class.border-l-4]="true" [class.!border-l-burgundy]="a.status === 'CONFIRMED'" [class.!border-l-pending]="a.status === 'PENDING'" [class.opacity-60]="a.status === 'COMPLETED' || a.status === 'CANCELLED'">
                <div class="w-16"><p class="font-display text-2xl leading-none">{{ time(a.startAt) }}</p><p class="text-xs text-taupe">{{ a.durationMinutes }} min</p></div>
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ a.customer.fullName }}</p>
                  <p class="text-sm text-taupe">{{ a.service.name }} · {{ a.customer.phone }}</p>
                  @if (a.notes) { <p class="mt-1 text-xs italic text-brown/70">“{{ a.notes }}”</p> }
                </div>
                <ui-status [status]="a.status" />
                @if (a.status === 'PENDING' || a.status === 'CONFIRMED') {
                  <div class="flex flex-wrap gap-2">
                    @if (a.status === 'PENDING') { <button class="btn-outline btn-sm" (click)="setStatus(a, 'CONFIRMED')">Confirm</button> }
                    @if (canComplete(a)) { <button class="btn-primary btn-sm" (click)="complete(a)"><ui-icon name="check" [size]="14" /> Validate</button> }
                    @if (isPast(a)) { <button class="btn-ghost btn-sm" (click)="setStatus(a, 'NO_SHOW')">No-show</button> }
                  </div>
                }
              </div>
            } @else if (item.kind === 'break') {
              <div class="flex items-center gap-3 rounded-2xl cal-break px-4 py-2.5 text-sm"><ui-icon name="coffee" [size]="15" />{{ hhmm(item.start) }} – {{ hhmm(item.end) }} · {{ item.label }}</div>
            } @else {
              <div class="flex items-center gap-3 rounded-2xl cal-slot-free px-4 py-2.5 text-sm text-free-strong"><ui-icon name="clock" [size]="15" />Free {{ hhmm(item.start) }} – {{ hhmm(item.end) }} ({{ item.end - item.start }} min)</div>
            }
          } @empty { @if (d.day.status === 'WORKING') { <ui-empty title="No appointments" icon="calendar" /> } }
        </div>

        <aside class="space-y-6">
          <div class="card-pad">
            <p class="eyebrow mb-3">My weekly hours</p>
            @for (wd of [1, 2, 3, 4, 5, 6, 7]; track wd) {
              <div class="flex justify-between border-b border-cream py-2 text-sm last:border-0">
                <span>{{ WEEKDAYS[wd - 1] }}</span>
                <span class="text-right text-taupe">{{ hoursFor(d, wd) }}</span>
              </div>
            }
          </div>
          <div class="card-pad">
            <p class="eyebrow mb-3">Upcoming days off</p>
            @for (a of d.schedule.absences; track a.id) { <p class="py-1 text-sm"><span class="badge-noshow mr-2">{{ a.type.toLowerCase() }}</span>{{ labelDay(a.startDate) }}{{ a.endDate !== a.startDate ? ' → ' + labelDay(a.endDate) : '' }}</p> }
            @empty { <p class="text-sm text-taupe">None planned.</p> }
          </div>
          <div class="card-pad"><p class="eyebrow mb-2">My services</p><p class="text-sm text-taupe">{{ d.schedule.services.join(' · ') }}</p></div>
        </aside>
      </div>
    }
  `,
})
export class StaffDayPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  WEEKDAYS = WEEKDAYS; hhmm = hhmm; time = time; addDays = addDays; mad = mad;
  labelDay = (d: string, o?: Intl.DateTimeFormatOptions) => labelDay(d, o);
  today = isoDay();
  date = signal(isoDay());
  data = signal<MyDay | null>(null);
  active = computed(() => (this.data()?.appointments ?? []).filter((a) => a.status !== 'CANCELLED'));
  freeMinutes = computed(() => (this.data()?.day.free ?? []).reduce((s, f) => s + f.end - f.start, 0));
  /** appointments, breaks and free gaps merged chronologically */
  timeline = computed(() => {
    const d = this.data();
    if (!d) return [];
    const items: { key: string; kind: 'appt' | 'break' | 'free'; start: number; end: number; label?: string; appt?: Appointment }[] = [];
    for (const a of d.appointments) {
      const m = Number(time(a.startAt).slice(0, 2)) * 60 + Number(time(a.startAt).slice(3));
      items.push({ key: a.id, kind: 'appt', start: m, end: m + a.durationMinutes, appt: a });
    }
    for (const b of d.day.blocks.filter((x) => x.kind !== 'APPOINTMENT')) items.push({ key: 'b' + b.start, kind: 'break', start: b.start, end: b.end, label: b.label });
    for (const f of d.day.free) if (f.end - f.start >= 15) items.push({ key: 'f' + f.start, kind: 'free', start: f.start, end: f.end });
    return items.sort((x, y) => x.start - y.start);
  });

  constructor() {
    effect(() => { this.date(); untracked(() => this.load()); });
    const rt = inject(RealtimeService);
    const sub = rt.appointments$.subscribe((c) => { if (c.employeeId === this.auth.user()?.employee?.id) this.load(); });
    const sub2 = rt.availability$.subscribe((c) => { if (RealtimeService.affects(c, this.date())) this.load(); });
    inject(DestroyRef).onDestroy(() => { sub.unsubscribe(); sub2.unsubscribe(); });
  }
  async load() {
    try { this.data.set(await this.api.get<MyDay>('/api/staff/my-day', { date: this.date() })); } catch (e) { this.toast.error(e); }
  }
  hoursFor(d: MyDay, wd: number) {
    const w = d.schedule.workingHours.find((x) => x.weekday === wd);
    if (!w) return 'Off';
    const b = d.schedule.breaks.filter((x) => x.weekday === wd).map((x) => `${hhmm(x.startMinute)}–${hhmm(x.endMinute)}`);
    return `${hhmm(w.startMinute)}–${hhmm(w.endMinute)}${b.length ? ' · break ' + b.join(', ') : ''}`;
  }
  isPast(a: Appointment) { return new Date(a.startAt) < new Date(); }
  canComplete(a: Appointment) { return this.auth.can('appointments.complete') && this.date() <= this.today && !!a; }
  async setStatus(a: Appointment, status: string) {
    try { await this.api.post(`/api/staff/appointments/${a.id}/status`, { status }); this.toast.success('Updated'); this.load(); } catch (e) { this.toast.error(e); }
  }
  async complete(a: Appointment) {
    const method = prompt('Payment method: CASH, CARD, TRANSFER or leave empty if not paid yet', 'CASH');
    if (method === null) return;
    try {
      const r = await this.api.post<{ newRewards: unknown[] }>(`/api/staff/appointments/${a.id}/complete`, { paymentMethod: method.trim().toUpperCase() || null });
      this.toast.success('Visit validated — loyalty stamp added');
      if (r.newRewards.length) this.toast.show('🎉 The client unlocked a reward', 'success');
      this.load();
    } catch (e) { this.toast.error(e); }
  }
}

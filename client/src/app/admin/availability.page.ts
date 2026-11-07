import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass } from '@angular/common';
import { ApiService } from '../core/api.service';
import { RealtimeService } from '../core/realtime.service';
import { addDays, hhmm, isoDay, labelDay, startOfWeek, time, toMinute, STATUS_LABEL, mad } from '../core/format';
import type { Appointment, Block, Interval, Service } from '../core/models';
import { Avatar, Icon, Spinner, Stat } from '../shared/ui';
import { AppointmentDrawer, QuickCreate, loadServices, type QuickPrefill } from './appointment-tools';

type View = 'day' | 'week' | 'month' | 'timeline';
type State = 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'ABSENT' | 'OFF' | 'NOT_STARTED' | 'FINISHED';
interface Column {
  employee: { id: string; name: string; firstName: string; title: string | null; photoUrl: string | null; color: string };
  status: 'WORKING' | 'OFF' | 'ABSENT' | 'UNAVAILABLE' | 'SALON_CLOSED';
  reason: string | null;
  state: State;
  window: Interval | null;
  blocks: Block[];
  free: Interval[];
  capacityMinutes: number;
  bookedMinutes: number;
}
interface DayData {
  date: string;
  isToday: boolean;
  nowMinute: number | null;
  opening: { isClosed: boolean; openMinute: number; closeMinute: number } | null;
  stats: { working: number; available: number; busy: number; onBreak: number; absent: number; appointments: number; freeSlots: number; slotReferenceMinutes: number; occupancy: number; nextAvailable: { employeeId: string; time: string } | null };
  columns: Column[];
  appointments: Appointment[];
  upcoming: Appointment[];
}
interface RangeData {
  employees: { id: string; name: string; firstName: string; color: string; photoUrl: string | null }[];
  days: { date: string; working: number; absent: number; capacityMinutes: number; freeMinutes: number; appointments: number; occupancy: number; employees: { employeeId: string; status: string; window: Interval | null }[] }[];
  appointments: Appointment[];
}
interface SearchResult {
  date: string;
  service: { id: string; name: string; durationMinutes: number };
  slots: { time: string; startAt: string; employeeIds: string[] }[];
  recommendations: { id: string; name: string; color: string; photoUrl: string | null; status: string; slots: string[]; next: { date: string; time: string; startAt: string }[] }[];
  earliest: { date: string; time: string; employeeId: string; employeeName: string } | null;
}

const STATE_LABEL: Record<State, string> = { AVAILABLE: 'Available', BUSY: 'With a client', ON_BREAK: 'On break', ABSENT: 'Absent', OFF: 'Day off', NOT_STARTED: 'Starts later', FINISHED: 'Finished' };
const STATE_CLS: Record<State, string> = {
  AVAILABLE: 'bg-free text-free-strong', BUSY: 'bg-burgundy-soft text-burgundy', ON_BREAK: 'bg-cream text-brown', ABSENT: 'bg-absent-soft text-absent',
  OFF: 'bg-cream text-taupe', NOT_STARTED: 'bg-cream text-taupe', FINISHED: 'bg-cream text-taupe',
};

@Component({
  selector: 'nea-availability',
  imports: [FormsModule, NgClass, Icon, Avatar, Stat, Spinner, AppointmentDrawer, QuickCreate],
  template: `
    <!-- Header -->
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="eyebrow flex items-center gap-2"><span class="relative flex size-2"><span class="absolute inline-flex size-full animate-ping rounded-full bg-free-strong opacity-60"></span><span class="relative inline-flex size-2 rounded-full bg-free-strong"></span></span>Live availability</p>
        <h1 class="title-lg mt-1">{{ headerLabel() }}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="segmented">
          @for (v of views; track v.id) { <button [class.active]="view() === v.id" (click)="view.set(v.id)">{{ v.label }}</button> }
        </div>
        <div class="flex items-center gap-1 rounded-full bg-white p-1 shadow-sm">
          <button class="icon-btn size-8" (click)="move(-1)" aria-label="Previous"><ui-icon name="chevron-left" /></button>
          <button class="btn-ghost btn-sm" (click)="date.set(today())">Today</button>
          <input type="date" class="rounded-full px-2 py-1 text-sm outline-none" [ngModel]="date()" (ngModelChange)="$event && date.set($event)" />
          <button class="icon-btn size-8" (click)="move(1)" aria-label="Next"><ui-icon name="chevron-right" /></button>
        </div>
        <button class="btn-primary" (click)="openCreate({ date: date() })"><ui-icon name="plus" [size]="16" /> New appointment</button>
      </div>
    </div>

    <!-- Stats -->
    @if (day(); as d) {
      <div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        <ui-stat label="Working" [value]="d.stats.working" icon="users" accent="grey" />
        <ui-stat label="Available now" [value]="d.isToday ? d.stats.available : '—'" icon="check" accent="green" />
        <ui-stat label="Busy" [value]="d.isToday ? d.stats.busy : '—'" icon="scissors" />
        <ui-stat label="On break" [value]="d.isToday ? d.stats.onBreak : '—'" icon="coffee" accent="grey" />
        <ui-stat label="Absent" [value]="d.stats.absent" icon="alert" accent="red" />
        <ui-stat label="Appointments" [value]="d.stats.appointments" icon="calendar" />
        <ui-stat label="Free slots" [value]="d.stats.freeSlots" [hint]="'of ' + d.stats.slotReferenceMinutes + ' min'" icon="clock" accent="green" />
        <ui-stat label="Occupancy" [value]="d.stats.occupancy + '%'" icon="chart" accent="orange" />
        <ui-stat label="Next available" [value]="d.stats.nextAvailable?.time ?? '—'" [hint]="nextName()" icon="sparkles" accent="green" />
      </div>
    }

    <!-- Filters & legend -->
    <div class="mt-6 flex flex-wrap items-center gap-3">
      <div class="flex flex-wrap gap-1.5">
        @for (e of allEmployees(); track e.id) {
          <button class="flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition" [class]="isShown(e.id) ? 'border-brown/20 bg-white' : 'border-transparent bg-cream/60 opacity-50'" (click)="toggleEmployee(e.id)">
            <ui-avatar [name]="e.name" [src]="e.photoUrl" [color]="e.color" [size]="22" />{{ e.firstName }}
          </button>
        }
      </div>
      <select class="select !w-auto !py-1.5 text-xs" [ngModel]="serviceFilter()" (ngModelChange)="serviceFilter.set($event)">
        <option [ngValue]="''">All services</option>
        @for (s of services(); track s.id) { <option [ngValue]="s.id">{{ s.name }}</option> }
      </select>
      <select class="select !w-auto !py-1.5 text-xs" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
        <option [ngValue]="''">Active statuses</option>
        @for (s of statuses; track s) { <option [ngValue]="s">{{ statusLabel[s] }}</option> }
      </select>
      <div class="relative"><ui-icon name="search" [size]="14" class="absolute left-3 top-2.5 text-taupe" /><input class="input !w-52 !py-1.5 !pl-8 text-xs" placeholder="Customer or reference" [ngModel]="search()" (ngModelChange)="search.set($event)" /></div>
      <div class="ml-auto flex flex-wrap items-center gap-3 text-[0.7rem] text-taupe">
        <span class="flex items-center gap-1.5"><span class="size-3 rounded bg-burgundy"></span>Confirmed</span>
        <span class="flex items-center gap-1.5"><span class="size-3 rounded bg-pending"></span>Pending</span>
        <span class="flex items-center gap-1.5"><span class="size-3 rounded cal-slot-free border border-free-strong/30"></span>Free</span>
        <span class="flex items-center gap-1.5"><span class="size-3 rounded cal-break"></span>Break / off</span>
        <span class="flex items-center gap-1.5"><span class="size-3 rounded cal-absent border border-absent/30"></span>Absent</span>
      </div>
    </div>

    <div class="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div class="min-w-0">
        @if (loading() && !day() && !range()) { <div class="card flex justify-center py-24"><ui-spinner /></div> }

        <!-- ===================== DAY ===================== -->
        @if (view() === 'day' && day(); as d) {
          @if (!columns().length) { <div class="card-pad text-center text-taupe">No team members selected.</div> }
          @else {
          <div class="card overflow-x-auto">
            <div class="flex min-w-max">
              <!-- time gutter -->
              <div class="sticky left-0 z-20 w-14 shrink-0 bg-white">
                <div class="h-20 border-b border-cream"></div>
                <div class="relative" [style.height.px]="(end() - start()) * PX">
                  @for (h of hours(); track h) { <span class="absolute right-2 -translate-y-1/2 text-[0.65rem] text-taupe" [style.top.px]="(h - start()) * PX">{{ hhmm(h) }}</span> }
                </div>
              </div>
              @for (c of columns(); track c.employee.id) {
                <div class="w-44 shrink-0 border-l border-cream md:w-52">
                  <div class="flex h-20 items-center gap-2.5 border-b border-cream px-3">
                    <ui-avatar [name]="c.employee.name" [src]="c.employee.photoUrl" [color]="c.employee.color" [size]="36" />
                    <div class="min-w-0">
                      <p class="truncate text-sm font-medium">{{ c.employee.name }}</p>
                      <span class="badge mt-1" [ngClass]="stateCls(c)">{{ stateLabel(c) }}</span>
                      @if (c.window) { <p class="mt-0.5 text-[0.65rem] text-taupe">{{ hhmm(c.window.start) }}–{{ hhmm(c.window.end) }} · {{ occ(c) }}%</p> }
                    </div>
                  </div>
                  <div class="relative" [style.height.px]="(end() - start()) * PX">
                    @for (h of hours(); track h) { <div class="absolute inset-x-0 border-t border-cream/70" [style.top.px]="(h - start()) * PX"></div> }
                    @if (c.status !== 'WORKING') {
                      <div class="absolute inset-0 flex items-start justify-center pt-6" [ngClass]="c.status === 'ABSENT' || c.status === 'UNAVAILABLE' ? 'cal-absent' : 'cal-break'">
                        <span class="rounded-full bg-white/90 px-3 py-1 text-xs" [class.text-absent]="c.status === 'ABSENT' || c.status === 'UNAVAILABLE'">{{ offLabel(c) }}</span>
                      </div>
                    } @else {
                      @if (c.window!.start > start()) { <div class="absolute inset-x-0 top-0 cal-break opacity-70" [style.height.px]="(c.window!.start - start()) * PX"></div> }
                      @if (c.window!.end < end()) { <div class="absolute inset-x-0 bottom-0 cal-break opacity-70" [style.top.px]="(c.window!.end - start()) * PX"></div> }
                      @for (f of c.free; track f.start) {
                        <button class="group absolute inset-x-1 rounded-lg cal-slot-free border border-free-strong/15 text-left transition hover:border-free-strong/50" [style.top.px]="(f.start - start()) * PX + 1" [style.height.px]="(f.end - f.start) * PX - 2" (click)="clickFree(c, f, $event)" [title]="'Free ' + hhmm(f.start) + '–' + hhmm(f.end) + ' · click to book'">
                          @if ((f.end - f.start) >= 20) { <span class="absolute left-2 top-1 text-[0.65rem] font-medium text-free-strong opacity-70 group-hover:opacity-100">Free {{ hhmm(f.start) }}</span> }
                          <span class="absolute right-2 top-1 hidden text-free-strong group-hover:block"><ui-icon name="plus" [size]="14" /></span>
                        </button>
                      }
                      @for (b of c.blocks; track b.start) {
                        <div class="absolute inset-x-1 flex items-start rounded-lg cal-break px-2 pt-1 text-[0.65rem] text-brown/70" [style.top.px]="(b.start - start()) * PX + 1" [style.height.px]="(b.end - b.start) * PX - 2"><ui-icon name="coffee" [size]="12" class="mr-1" />{{ b.label }}</div>
                      }
                    }
                    @for (a of apptsFor(c.employee.id); track a.id) {
                      <button class="absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1 text-left text-[0.7rem] leading-tight shadow-sm transition hover:z-10 hover:shadow-lg" [ngClass]="'appt-' + a.status" [class.opacity-30]="!matches(a)"
                              [style.top.px]="(a.startMinute! - start()) * PX + 1" [style.height.px]="Math.max(18, (a.endMinute! - a.startMinute!) * PX - 2)" (click)="openId.set(a.id)">
                        <p class="font-medium">{{ time(a.startAt) }} · {{ a.customer.fullName }}</p>
                        <p class="opacity-80">{{ a.service.name }}</p>
                        @if (a.status === 'COMPLETED') { <ui-icon name="check" [size]="12" class="absolute right-1.5 top-1.5" /> }
                      </button>
                    }
                    @if (d.isToday && d.nowMinute !== null && d.nowMinute >= start() && d.nowMinute <= end()) {
                      <div class="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-absent" [style.top.px]="(d.nowMinute - start()) * PX"><span class="absolute -left-1 -top-1.5 size-2.5 rounded-full bg-absent"></span></div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
          }
        }

        <!-- ===================== TIMELINE ===================== -->
        @if (view() === 'timeline' && day(); as d) {
          <div class="card overflow-x-auto">
            <div class="min-w-max">
              <div class="flex border-b border-cream">
                <div class="sticky left-0 z-20 w-44 shrink-0 bg-white"></div>
                <div class="relative h-8" [style.width.px]="(end() - start()) * PXH">
                  @for (h of hours(); track h) { <span class="absolute top-2 -translate-x-1/2 text-[0.65rem] text-taupe" [style.left.px]="(h - start()) * PXH">{{ hhmm(h) }}</span> }
                </div>
              </div>
              @for (c of columns(); track c.employee.id) {
                <div class="flex border-b border-cream last:border-0">
                  <div class="sticky left-0 z-20 flex w-44 shrink-0 items-center gap-2 bg-white px-3 py-2">
                    <ui-avatar [name]="c.employee.name" [src]="c.employee.photoUrl" [color]="c.employee.color" [size]="30" />
                    <div class="min-w-0"><p class="truncate text-sm">{{ c.employee.firstName }}</p><span class="badge" [ngClass]="stateCls(c)">{{ stateLabel(c) }}</span></div>
                  </div>
                  <div class="relative h-16" [style.width.px]="(end() - start()) * PXH" [ngClass]="c.status === 'ABSENT' || c.status === 'UNAVAILABLE' ? 'cal-absent' : c.status !== 'WORKING' ? 'cal-break' : ''">
                    @for (h of hours(); track h) { <div class="absolute inset-y-0 border-l border-cream/70" [style.left.px]="(h - start()) * PXH"></div> }
                    @if (c.status === 'WORKING') {
                      @for (f of c.free; track f.start) {
                        <button class="absolute inset-y-2 rounded-md cal-slot-free border border-free-strong/15 hover:border-free-strong/50" [style.left.px]="(f.start - start()) * PXH" [style.width.px]="(f.end - f.start) * PXH" (click)="clickFreeH(c, f, $event)" [title]="'Free ' + hhmm(f.start) + '–' + hhmm(f.end)"></button>
                      }
                      @for (b of c.blocks; track b.start) { <div class="absolute inset-y-2 rounded-md cal-break" [style.left.px]="(b.start - start()) * PXH" [style.width.px]="(b.end - b.start) * PXH" [title]="b.label"></div> }
                    } @else { <span class="absolute left-3 top-5 text-xs">{{ offLabel(c) }}</span> }
                    @for (a of apptsFor(c.employee.id); track a.id) {
                      <button class="absolute inset-y-1.5 overflow-hidden rounded-md px-1.5 text-left text-[0.65rem] leading-tight" [ngClass]="'appt-' + a.status" [class.opacity-30]="!matches(a)" [style.left.px]="(a.startMinute! - start()) * PXH" [style.width.px]="(a.endMinute! - a.startMinute!) * PXH - 1" (click)="openId.set(a.id)" [title]="a.customer.fullName + ' · ' + a.service.name">
                        <p class="mt-1 truncate font-medium">{{ a.customer.fullName }}</p><p class="truncate opacity-80">{{ time(a.startAt) }}</p>
                      </button>
                    }
                    @if (d.isToday && d.nowMinute !== null && d.nowMinute >= start() && d.nowMinute <= end()) { <div class="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-absent" [style.left.px]="(d.nowMinute - start()) * PXH"></div> }
                  </div>
                </div>
              }
            </div>
          </div>
        }

        <!-- ===================== WEEK ===================== -->
        @if (view() === 'week' && range(); as r) {
          <div class="card overflow-x-auto">
            <div class="flex min-w-max">
              <div class="sticky left-0 z-20 w-12 shrink-0 bg-white">
                <div class="h-16 border-b border-cream"></div>
                <div class="relative" [style.height.px]="(end() - start()) * PXW">
                  @for (h of hours(); track h) { <span class="absolute right-1.5 -translate-y-1/2 text-[0.6rem] text-taupe" [style.top.px]="(h - start()) * PXW">{{ hhmm(h) }}</span> }
                </div>
              </div>
              @for (dd of r.days; track dd.date) {
                <div class="shrink-0 border-l border-cream" [style.width.px]="Math.max(130, weekLanes().length * 44)">
                  <button class="flex h-16 w-full flex-col justify-center border-b border-cream px-2 text-left hover:bg-ivory" [class.bg-burgundy-soft]="dd.date === today()" (click)="date.set(dd.date); view.set('day')">
                    <span class="text-xs font-medium">{{ dayLabel(dd.date) }}</span>
                    <span class="text-[0.65rem] text-taupe">{{ dd.appointments }} appt · {{ dd.occupancy }}%</span>
                    <span class="mt-1 h-1 w-full rounded-full bg-cream"><span class="block h-1 rounded-full bg-burgundy" [style.width.%]="dd.occupancy"></span></span>
                  </button>
                  <div class="relative flex" [style.height.px]="(end() - start()) * PXW">
                    @for (h of hours(); track h) { <div class="absolute inset-x-0 border-t border-cream/60" [style.top.px]="(h - start()) * PXW"></div> }
                    @for (e of weekLanes(); track e.id) {
                      @let st = laneStatus(dd, e.id);
                      <div class="relative flex-1 border-l border-cream/40 first:border-0" [ngClass]="st?.status === 'ABSENT' || st?.status === 'UNAVAILABLE' ? 'cal-absent' : st?.status !== 'WORKING' ? 'cal-break opacity-60' : ''">
                        @if (st?.status === 'WORKING' && st?.window) {
                          <div class="absolute inset-x-0.5 rounded bg-free/60" [style.top.px]="(st!.window!.start - start()) * PXW" [style.height.px]="(st!.window!.end - st!.window!.start) * PXW"></div>
                        }
                        @for (a of weekAppts(dd.date, e.id); track a.id) {
                          <button class="absolute inset-x-0.5 overflow-hidden rounded border-l-[3px] px-0.5 text-left text-[0.55rem] leading-tight" [ngClass]="'appt-' + a.status" [class.opacity-30]="!matches(a)" [style.borderLeftColor]="e.color"
                                  [style.top.px]="(a.startMinute! - start()) * PXW" [style.height.px]="Math.max(10, (a.endMinute! - a.startMinute!) * PXW - 1)" (click)="openId.set(a.id)" [title]="time(a.startAt) + ' ' + a.customer.fullName + ' · ' + a.service.name + ' · ' + e.firstName">{{ time(a.startAt) }}</button>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>
          <p class="mt-2 text-xs text-taupe">Each day is split into one lane per team member ({{ laneNames() }}). Click a day to open it.</p>
        }

        <!-- ===================== MONTH ===================== -->
        @if (view() === 'month' && range(); as r) {
          <div class="card overflow-hidden">
            <div class="grid grid-cols-7 border-b border-cream bg-ivory/60 text-center text-[0.65rem] uppercase tracking-widest text-taupe">
              @for (w of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; track w) { <div class="py-2">{{ w }}</div> }
            </div>
            <div class="grid grid-cols-7">
              @for (dd of r.days; track dd.date) {
                <button class="min-h-24 border-b border-r border-cream p-2 text-left transition hover:bg-ivory md:min-h-28" [class.opacity-40]="dd.date.slice(0, 7) !== date().slice(0, 7)" (click)="date.set(dd.date); view.set('day')">
                  <span class="flex size-7 items-center justify-center rounded-full text-sm" [class]="dd.date === today() ? 'bg-burgundy text-white' : ''">{{ +dd.date.slice(8) }}</span>
                  @if (dd.working === 0 && dd.absent === 0) { <p class="mt-2 text-[0.65rem] text-taupe">Closed</p> }
                  @else {
                    <p class="mt-1.5 text-xs"><b>{{ dd.appointments }}</b> <span class="text-taupe">appt</span></p>
                    <div class="mt-1.5 h-1.5 rounded-full bg-free"><div class="h-1.5 rounded-full" [class]="dd.occupancy > 85 ? 'bg-absent' : dd.occupancy > 60 ? 'bg-pending' : 'bg-burgundy'" [style.width.%]="dd.occupancy"></div></div>
                    <p class="mt-1 text-[0.6rem] text-taupe">{{ dd.occupancy }}% booked</p>
                    @if (dd.absent) { <span class="mt-1 inline-block rounded-full bg-absent-soft px-1.5 text-[0.6rem] text-absent">{{ dd.absent }} absent</span> }
                  }
                </button>
              }
            </div>
          </div>
        }
      </div>

      <!-- ===================== Side panel: search engine + coming next ===================== -->
      <aside class="space-y-6">
        <div class="card-pad">
          <p class="eyebrow">Smart search</p>
          <h2 class="mt-1 font-display text-2xl">Find an available slot</h2>
          <div class="mt-4 space-y-3">
            <select class="select" [(ngModel)]="sq.serviceId" (ngModelChange)="sq.durationMinutes = null">
              <option [ngValue]="''" disabled>Service…</option>
              @for (s of services(); track s.id) { <option [ngValue]="s.id">{{ s.name }} · {{ s.durationMinutes }} min</option> }
            </select>
            <div class="grid grid-cols-2 gap-2">
              <input type="date" class="input" [(ngModel)]="sq.date" />
              <input type="time" class="input" [(ngModel)]="sq.preferredTime" step="900" title="Preferred time" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <select class="select" [(ngModel)]="sq.employeeId">
                <option [ngValue]="''">Any qualified</option>
                @for (e of qualifiedFor(sq.serviceId); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }
              </select>
              <input type="number" class="input" min="5" step="5" placeholder="Duration (min)" [(ngModel)]="sq.durationMinutes" title="Override duration" />
            </div>
            <button class="btn-primary w-full" [disabled]="!sq.serviceId || searching()" (click)="runSearch()"><ui-icon name="search" [size]="15" /> Search availability</button>
          </div>

          @if (result(); as res) {
            <div class="mt-5 space-y-4 animate-fade-up">
              @if (res.earliest; as e) {
                <button class="w-full rounded-2xl bg-burgundy p-4 text-left text-white" (click)="openCreate({ serviceId: res.service.id, employeeId: e.employeeId, date: e.date, time: e.time })">
                  <p class="text-[0.65rem] uppercase tracking-widest text-white/70">Earliest available</p>
                  <p class="font-display text-2xl">{{ dayLabel(e.date) }} · {{ e.time }}</p>
                  <p class="text-sm text-white/80">with {{ e.employeeName }} — click to book</p>
                </button>
              } @else { <p class="rounded-xl bg-cream px-4 py-3 text-sm">No availability in the next 14 days.</p> }

              <div>
                <p class="label">{{ dayLabel(res.date) }}{{ sq.preferredTime ? ' · closest to ' + sq.preferredTime : '' }}</p>
                <div class="flex flex-wrap gap-1.5">
                  @for (s of res.slots.slice(0, 18); track s.startAt) {
                    <button class="rounded-lg border border-cream bg-white px-2.5 py-1 text-xs hover:border-burgundy" (click)="openCreate({ serviceId: res.service.id, employeeId: s.employeeIds.length === 1 ? s.employeeIds[0] : (sq.employeeId || null), date: res.date, time: s.time })">{{ s.time }}</button>
                  } @empty { <p class="text-xs text-taupe">No free time on this date.</p> }
                </div>
              </div>

              <div class="space-y-3">
                <p class="label">Qualified team members</p>
                @for (r of res.recommendations; track r.id) {
                  <div class="rounded-xl border border-cream p-3">
                    <div class="flex items-center gap-2"><ui-avatar [name]="r.name" [src]="r.photoUrl" [color]="r.color" [size]="26" /><span class="text-sm font-medium">{{ r.name }}</span><span class="ml-auto text-[0.65rem] text-taupe">{{ r.slots.length }} slots this day</span></div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      @for (n of r.next; track n.startAt) {
                        <button class="rounded-lg bg-free px-2 py-1 text-[0.7rem] text-free-strong hover:bg-free-strong hover:text-white" (click)="openCreate({ serviceId: res.service.id, employeeId: r.id, date: n.date, time: n.time })">{{ dayLabel(n.date) }} {{ n.time }}</button>
                      } @empty { <span class="text-xs text-taupe">No availability soon</span> }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        @if (day(); as d) {
          <div class="card-pad">
            <p class="eyebrow mb-3">Coming next</p>
            @for (a of d.upcoming; track a.id) {
              <button class="flex w-full items-center gap-3 border-b border-cream py-2.5 text-left last:border-0 hover:opacity-80" (click)="openId.set(a.id)">
                <span class="w-12 font-display text-lg">{{ time(a.startAt) }}</span>
                <span class="min-w-0 flex-1"><span class="block truncate text-sm">{{ a.customer.fullName }}</span><span class="block truncate text-xs text-taupe">{{ a.service.name }} · {{ a.employee.firstName }}</span></span>
                <span class="size-2 rounded-full" [class]="a.status === 'PENDING' ? 'bg-pending' : 'bg-burgundy'"></span>
              </button>
            } @empty { <p class="text-sm text-taupe">Nothing else scheduled{{ d.isToday ? ' today' : '' }}.</p> }
          </div>
        }
      </aside>
    </div>

    <nea-appointment-drawer [appointmentId]="openId()" (closed)="openId.set(null)" (changed)="reload()" />
    <nea-quick-create [open]="creating()" [prefill]="prefill()" (closed)="creating.set(false)" (created)="reload()" />
  `,
})
export class AvailabilityPage {
  private api = inject(ApiService);
  readonly PX = 1.5; // px per minute (day view)
  readonly PXH = 2.2; // timeline
  readonly PXW = 0.75; // week view
  readonly Math = Math;
  hhmm = hhmm;
  time = time;
  mad = mad;
  statusLabel = STATUS_LABEL;
  statuses = ['CONFIRMED', 'PENDING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
  views: { id: View; label: string }[] = [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'timeline', label: 'Timeline' }];

  today = signal(isoDay());
  date = signal(isoDay());
  view = signal<View>('day');
  day = signal<DayData | null>(null);
  range = signal<RangeData | null>(null);
  loading = signal(false);
  services = signal<Service[]>([]);
  hidden = signal<Set<string>>(new Set());
  serviceFilter = signal('');
  statusFilter = signal('');
  search = signal('');
  openId = signal<string | null>(null);
  creating = signal(false);
  prefill = signal<QuickPrefill | null>(null);
  result = signal<SearchResult | null>(null);
  searching = signal(false);
  sq = { serviceId: '', date: isoDay(), preferredTime: '', employeeId: '', durationMinutes: null as number | null };

  allEmployees = computed(() => this.day()?.columns.map((c) => c.employee) ?? this.range()?.employees ?? []);
  columns = computed(() => (this.day()?.columns ?? []).filter((c) => !this.hidden().has(c.employee.id)));
  weekLanes = computed(() => (this.range()?.employees ?? []).filter((e) => !this.hidden().has(e.id)));
  laneNames = computed(() => this.weekLanes().map((e) => e.firstName).join(', '));
  start = computed(() => {
    const d = this.day();
    const mins = [d?.opening && !d.opening.isClosed ? d.opening.openMinute : 540, ...(d?.columns.filter((c) => c.window).map((c) => c.window!.start) ?? [])];
    return Math.floor(Math.min(...mins) / 60) * 60;
  });
  end = computed(() => {
    const d = this.day();
    const mins = [d?.opening && !d.opening.isClosed ? d.opening.closeMinute : 1200, ...(d?.columns.filter((c) => c.window).map((c) => c.window!.end) ?? [])];
    return Math.ceil(Math.max(...mins) / 60) * 60;
  });
  hours = computed(() => Array.from({ length: (this.end() - this.start()) / 60 + 1 }, (_, i) => this.start() + i * 60));
  headerLabel = computed(() => {
    const v = this.view();
    if (v === 'month') return labelDay(this.date(), { month: 'long', year: 'numeric' });
    if (v === 'week') { const s = startOfWeek(this.date()); return `${labelDay(s, { day: 'numeric', month: 'short' })} – ${labelDay(addDays(s, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`; }
    return labelDay(this.date(), { weekday: 'long', day: 'numeric', month: 'long' });
  });
  nextName = computed(() => {
    const n = this.day()?.stats.nextAvailable;
    return n ? (this.day()?.columns.find((c) => c.employee.id === n.employeeId)?.employee.firstName ?? '') : '';
  });

  private seq = 0;
  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    loadServices(this.api).then((s) => this.services.set(s));
    effect(() => {
      this.date(); this.view();
      untracked(() => this.reload());
    });
    // live updates from bookings anywhere (public site, staff, other managers)
    const rt = inject(RealtimeService);
    const subs = [rt.appointments$.subscribe(() => this.reloadSoon()), rt.availability$.subscribe(() => this.reloadSoon())];
    const tick = setInterval(() => { this.today.set(isoDay()); this.reload(); }, 60_000); // keeps the now-line & states current
    inject(DestroyRef).onDestroy(() => { subs.forEach((s) => s.unsubscribe()); clearInterval(tick); });
  }

  reloadSoon() {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.reload(), 350);
  }

  async reload() {
    const id = ++this.seq;
    this.loading.set(true);
    try {
      const v = this.view();
      // the day payload also feeds the stats and the "coming next" list
      const dayReq = this.api.get<DayData>('/api/admin/availability/day', { date: this.date() });
      let rangeReq: Promise<RangeData> | null = null;
      if (v === 'week') { const s = startOfWeek(this.date()); rangeReq = this.api.get<RangeData>('/api/admin/availability/range', { from: s, to: addDays(s, 6) }); }
      if (v === 'month') { const s = startOfWeek(this.date().slice(0, 8) + '01'); rangeReq = this.api.get<RangeData>('/api/admin/availability/range', { from: s, to: addDays(s, 41) }); }
      const [d, r] = await Promise.all([dayReq, rangeReq]);
      if (id !== this.seq) return;
      this.day.set(d);
      this.range.set(r);
    } finally {
      if (id === this.seq) this.loading.set(false);
    }
  }

  move(n: number) {
    const v = this.view();
    if (v === 'month') {
      const d = new Date(this.date() + 'T12:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + n, 1);
      this.date.set(d.toISOString().slice(0, 10));
    } else this.date.set(addDays(this.date(), v === 'week' ? 7 * n : n));
  }

  isShown(id: string) { return !this.hidden().has(id); }
  toggleEmployee(id: string) {
    const s = new Set(this.hidden());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.hidden.set(s);
  }

  /** status filter decides which appointments are drawn; service/search filters dim non-matching ones */
  private visible(a: Appointment) {
    const st = this.statusFilter();
    return st ? a.status === st : a.status !== 'CANCELLED';
  }
  matches(a: Appointment) {
    const q = this.search().trim().toLowerCase();
    return (!this.serviceFilter() || a.service.id === this.serviceFilter()) && (!q || a.customer.fullName.toLowerCase().includes(q) || a.reference.toLowerCase().includes(q));
  }
  apptsFor(employeeId: string) {
    return (this.day()?.appointments ?? []).filter((a) => a.employee.id === employeeId && this.visible(a));
  }
  weekAppts(date: string, employeeId: string) {
    return (this.range()?.appointments ?? []).filter((a) => a.date === date && a.employee.id === employeeId && this.visible(a));
  }
  laneStatus(dd: RangeData['days'][number], employeeId: string) {
    return dd.employees.find((e) => e.employeeId === employeeId);
  }

  stateLabel(c: Column) { return this.day()?.isToday ? STATE_LABEL[c.state] : c.status === 'WORKING' ? 'Working' : STATE_LABEL[c.state]; }
  stateCls(c: Column) { return this.day()?.isToday ? STATE_CLS[c.state] : c.status === 'WORKING' ? STATE_CLS.AVAILABLE : STATE_CLS[c.state]; }
  offLabel(c: Column) {
    return c.status === 'ABSENT' ? `Absent${c.reason ? ' · ' + c.reason.toLowerCase() : ''}` : c.status === 'UNAVAILABLE' ? `Unavailable${c.reason ? ' · ' + c.reason : ''}` : c.status === 'SALON_CLOSED' ? 'Salon closed' : 'Day off';
  }
  occ(c: Column) { return c.capacityMinutes ? Math.round((c.bookedMinutes / c.capacityMinutes) * 100) : 0; }
  dayLabel(d: string) { return labelDay(d); }

  /** Click inside a free interval => quick booking at the clicked time (snapped to 15 min) */
  clickFree(c: Column, f: Interval, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.bookAt(c, f, f.start + (ev.clientY - rect.top) / this.PX);
  }
  clickFreeH(c: Column, f: Interval, ev: MouseEvent) {
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.bookAt(c, f, f.start + (ev.clientX - rect.left) / this.PXH);
  }
  private bookAt(c: Column, f: Interval, minute: number) {
    let m = Math.floor(minute / 15) * 15;
    m = Math.max(f.start, Math.min(m, f.end - 15));
    const svc = this.serviceFilter() || undefined;
    this.openCreate({ employeeId: c.employee.id, date: this.date(), time: hhmm(m), serviceId: svc });
  }

  openCreate(p: QuickPrefill) {
    this.prefill.set(p);
    this.creating.set(true);
  }

  qualifiedFor(serviceId: string) { return this.services().find((s) => s.id === serviceId)?.employees ?? []; }

  async runSearch() {
    this.searching.set(true);
    try {
      this.result.set(await this.api.get<SearchResult>('/api/admin/availability/search', {
        serviceId: this.sq.serviceId, date: this.sq.date, preferredTime: this.sq.preferredTime || undefined, employeeId: this.sq.employeeId || undefined, durationMinutes: this.sq.durationMinutes || undefined,
      }));
    } finally {
      this.searching.set(false);
    }
  }
  protected readonly toMinute = toMinute;
}

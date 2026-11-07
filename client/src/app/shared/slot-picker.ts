import { Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ApiService } from '../core/api.service';
import { RealtimeService } from '../core/realtime.service';
import { ToastService } from '../core/toast.service';
import { addDays, isoDay, labelDay } from '../core/format';
import type { Slot } from '../core/models';
import { Icon, Spinner } from './ui';

export interface PickedSlot { date: string; time: string; startAt: string; employeeIds: string[] }

/**
 * Date strip + live time slots. Slots always come from the server's availability engine and
 * refresh automatically when another booking changes the calendar (WebSocket).
 */
@Component({
  selector: 'nea-slot-picker',
  imports: [Icon, Spinner],
  template: `
    <div class="flex items-center gap-2">
      <button class="icon-btn shrink-0" (click)="shift(-7)" [disabled]="start() <= today()" aria-label="Previous week"><ui-icon name="chevron-left" /></button>
      <div class="flex flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        @for (d of days(); track d) {
          <button (click)="date.set(d)"
                  class="flex min-w-[3.8rem] flex-1 flex-col items-center rounded-2xl border px-2 py-2.5 transition"
                  [class]="d === date() ? 'border-burgundy bg-burgundy text-white shadow-md' : 'border-cream bg-white hover:border-beige'">
            <span class="text-[0.65rem] uppercase tracking-widest opacity-70">{{ label(d, { weekday: 'short' }) }}</span>
            <span class="font-display text-xl leading-tight">{{ label(d, { day: 'numeric' }) }}</span>
            <span class="text-[0.6rem] opacity-60">{{ label(d, { month: 'short' }) }}</span>
          </button>
        }
      </div>
      <button class="icon-btn shrink-0" (click)="shift(7)" aria-label="Next week"><ui-icon name="chevron-right" /></button>
    </div>

    <div class="mt-5 min-h-32">
      @if (loading()) {
        <div class="flex justify-center py-10"><ui-spinner /></div>
      } @else if (error()) {
        <p class="rounded-xl bg-absent-soft px-4 py-3 text-sm text-absent">{{ error() }}</p>
      } @else if (!slots().length) {
        <div class="rounded-2xl bg-cream/60 px-5 py-8 text-center">
          <p class="font-display text-xl">No availability on this day</p>
          <p class="mt-1 text-sm text-taupe">Please choose another date{{ employeeId() ? ' or another team member' : '' }}.</p>
        </div>
      } @else {
        @for (g of groups(); track g.name) {
          @if (g.slots.length) {
            <p class="eyebrow mb-2 mt-4 first:mt-0">{{ g.name }}</p>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              @for (s of g.slots; track s.startAt) {
                <button (click)="pick(s)" class="rounded-xl border py-2.5 text-sm font-medium transition"
                        [class]="selected() === s.startAt ? 'border-burgundy bg-burgundy text-white' : 'border-cream bg-white hover:border-burgundy hover:text-burgundy'">{{ s.time }}</button>
              }
            </div>
          }
        }
      }
    </div>
  `,
})
export class SlotPicker {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  serviceId = input.required<string>();
  employeeId = input<string | null>(null);
  /** admin mode uses the staff search engine (no notice period, can exclude an appointment being moved) */
  mode = input<'public' | 'admin'>('public');
  excludeAppointmentId = input<string | null>(null);
  initialDate = input<string | null>(null);
  picked = output<PickedSlot | null>();

  today = signal(isoDay());
  start = signal(isoDay());
  date = signal(isoDay());
  slots = signal<Slot[]>([]);
  loading = signal(false);
  error = signal('');
  selected = signal<string | null>(null);
  days = computed(() => Array.from({ length: 7 }, (_, i) => addDays(this.start(), i)));
  groups = computed(() => [
    { name: 'Morning', slots: this.slots().filter((s) => s.minute < 720) },
    { name: 'Afternoon', slots: this.slots().filter((s) => s.minute >= 720 && s.minute < 1020) },
    { name: 'Evening', slots: this.slots().filter((s) => s.minute >= 1020) },
  ]);
  label = (d: string, o: Intl.DateTimeFormatOptions) => labelDay(d, o);
  private seq = 0;

  constructor() {
    effect(() => {
      const d = this.initialDate();
      if (d) untracked(() => { this.date.set(d); this.start.set(d < this.today() ? this.today() : d); });
    });
    effect(() => {
      // reload when service / employee / date change
      this.serviceId(); this.employeeId(); this.date();
      untracked(() => { this.selected.set(null); this.picked.emit(null); this.load(); });
    });
    const sub = inject(RealtimeService).availability$.subscribe((c) => {
      if (RealtimeService.affects(c, this.date())) this.load(true);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  shift(n: number) {
    const s = addDays(this.start(), n);
    this.start.set(s < this.today() ? this.today() : s);
    this.date.set(this.start());
  }

  async load(live = false) {
    const id = ++this.seq;
    if (!live) this.loading.set(true);
    this.error.set('');
    try {
      const r =
        this.mode() === 'admin'
          ? await this.api.get<{ slots: Slot[] }>('/api/admin/availability/search', { serviceId: this.serviceId(), date: this.date(), employeeId: this.employeeId(), excludeAppointmentId: this.excludeAppointmentId(), days: 1 })
          : await this.api.availability(this.serviceId(), this.date(), this.employeeId());
      if (id !== this.seq) return;
      const slots = [...r.slots].sort((a, b) => a.minute - b.minute);
      this.slots.set(slots);
      const sel = this.selected();
      if (sel && !slots.some((s) => s.startAt === sel)) {
        this.selected.set(null);
        this.picked.emit(null);
        this.toast.show('The time you selected was just booked by someone else. Please choose another one.', 'info');
      }
    } catch (e) {
      if (id === this.seq) this.error.set((e as { error?: { error?: { message?: string } } }).error?.error?.message ?? 'Could not load availability');
    } finally {
      if (id === this.seq) this.loading.set(false);
    }
  }

  pick(s: Slot) {
    this.selected.set(s.startAt);
    this.picked.emit({ date: this.date(), time: s.time, startAt: s.startAt, employeeIds: s.employeeIds });
  }
}

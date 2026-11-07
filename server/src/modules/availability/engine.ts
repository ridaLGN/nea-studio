/**
 * Pure availability engine — no I/O, fully unit-tested.
 * All values are minutes since local midnight (salon timezone) for ONE calendar day.
 */

export interface Interval {
  start: number;
  end: number;
}

export type BlockKind = 'BREAK' | 'UNAVAILABLE' | 'APPOINTMENT';
export interface Block extends Interval {
  kind: BlockKind;
  label?: string;
  appointmentId?: string;
}

export type DayStatus = 'WORKING' | 'OFF' | 'ABSENT' | 'UNAVAILABLE' | 'SALON_CLOSED';

export interface DayInput {
  salon: { isClosed: boolean; open: number; close: number } | null; // null => no opening hours configured => closed
  salonClosure: boolean;
  working: Interval | null; // employee's regular hours for the weekday
  breaks: (Interval & { label?: string })[];
  absence: { type: string; reason?: string | null } | null;
  exceptions: { type: 'CUSTOM_HOURS' | 'UNAVAILABLE'; start: number | null; end: number | null; reason?: string | null }[];
  appointments: (Interval & { id: string })[]; // active appointments only
  bufferMinutes: number;
}

export interface DayAvailability {
  status: DayStatus;
  reason?: string | null;
  window: Interval | null; // effective working window (intersected with opening hours)
  blocks: Block[];
  free: Interval[];
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const s = Math.max(a.start, b.start);
  const e = Math.min(a.end, b.end);
  return e > s ? { start: s, end: e } : null;
}

/** window minus blocks -> sorted disjoint free intervals */
export function subtract(window: Interval, blocks: Interval[]): Interval[] {
  const sorted = blocks
    .map((b) => intersect(b, window))
    .filter((b): b is Interval => !!b)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of sorted) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

export function computeDay(input: DayInput): DayAvailability {
  const empty = (status: DayStatus, reason?: string | null): DayAvailability => ({ status, reason, window: null, blocks: [], free: [] });

  if (input.salonClosure || !input.salon || input.salon.isClosed) return empty('SALON_CLOSED');
  if (input.absence) return empty('ABSENT', input.absence.reason ?? input.absence.type);

  const fullDayOff = input.exceptions.find((e) => e.type === 'UNAVAILABLE' && (e.start == null || e.end == null));
  if (fullDayOff) return empty('UNAVAILABLE', fullDayOff.reason);

  const custom = input.exceptions.find((e) => e.type === 'CUSTOM_HOURS' && e.start != null && e.end != null);
  const base = custom ? { start: custom.start!, end: custom.end! } : input.working;
  if (!base) return empty('OFF');

  const window = intersect(base, { start: input.salon.open, end: input.salon.close });
  if (!window) return empty('OFF');

  const blocks: Block[] = [
    // Regular breaks do not apply on custom-hours days only if they fall outside the window (handled by subtract)
    ...input.breaks.map((b) => ({ start: b.start, end: b.end, kind: 'BREAK' as const, label: b.label ?? 'Break' })),
    ...input.exceptions
      .filter((e) => e.type === 'UNAVAILABLE' && e.start != null && e.end != null)
      .map((e) => ({ start: e.start!, end: e.end!, kind: 'UNAVAILABLE' as const, label: e.reason ?? 'Unavailable' })),
    ...input.appointments.map((a) => ({
      start: a.start - input.bufferMinutes,
      end: a.end + input.bufferMinutes,
      kind: 'APPOINTMENT' as const,
      appointmentId: a.id,
    })),
  ];

  return { status: 'WORKING', window, blocks, free: subtract(window, blocks) };
}

/**
 * Bookable start times for a service of `duration` minutes.
 * Candidates = grid points (every `step` minutes from the window start) + the start of each free gap,
 * so a gap that begins off-grid (e.g. after a 50-min service) is never wasted.
 */
export function slotsFor(day: DayAvailability, duration: number, step: number, earliestStart = -Infinity): number[] {
  if (day.status !== 'WORKING' || !day.window || duration <= 0) return [];
  const out = new Set<number>();
  for (const f of day.free) {
    const first = Math.max(f.start, Math.ceil(earliestStart));
    // grid aligned to the working window start
    const gridStart = day.window.start + Math.ceil((first - day.window.start) / step) * step;
    if (f.start >= first && f.start + duration <= f.end) out.add(f.start);
    for (let s = gridStart; s + duration <= f.end; s += step) if (s >= first) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

/** True when [start, start+duration) fits entirely inside a free interval. */
export function fits(day: DayAvailability, start: number, duration: number): boolean {
  return day.status === 'WORKING' && day.free.some((f) => f.start <= start && start + duration <= f.end);
}

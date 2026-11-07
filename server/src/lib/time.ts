import { DateTime } from 'luxon';

export const DEFAULT_TZ = 'Africa/Casablanca';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string) {
  return DATE_RE.test(s) && DateTime.fromISO(s).isValid;
}

/** Local wall-clock (date + minutes since midnight) in tz -> UTC Date. DST-safe. */
export function localToUtc(date: string, minute: number, tz = DEFAULT_TZ): Date {
  const dayOffset = Math.floor(minute / 1440);
  const m = minute - dayOffset * 1440;
  return DateTime.fromISO(date, { zone: tz })
    .plus({ days: dayOffset })
    .set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 })
    .toUTC()
    .toJSDate();
}

/** UTC Date -> { date, minute } in tz */
export function utcToLocal(d: Date, tz = DEFAULT_TZ): { date: string; minute: number } {
  const dt = DateTime.fromJSDate(d, { zone: tz });
  return { date: dt.toISODate()!, minute: dt.hour * 60 + dt.minute };
}

export function todayLocal(tz = DEFAULT_TZ, now = new Date()): string {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
}
/** ISO weekday 1=Mon..7=Sun */
export function weekdayOf(date: string): number {
  return DateTime.fromISO(date).weekday;
}
export function addDays(date: string, n: number): string {
  return DateTime.fromISO(date).plus({ days: n }).toISODate()!;
}
export function diffDays(a: string, b: string): number {
  return Math.round(DateTime.fromISO(b).diff(DateTime.fromISO(a), 'days').days);
}
/** Range of UTC instants covering a local calendar day */
export function dayBoundsUtc(date: string, tz = DEFAULT_TZ) {
  const start = DateTime.fromISO(date, { zone: tz }).startOf('day');
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate() };
}
/** Postgres DATE columns map to JS Date at UTC midnight */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function hhmm(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function formatLocal(d: Date, tz = DEFAULT_TZ, fmt = "cccc d LLLL yyyy, HH:mm") {
  return DateTime.fromJSDate(d, { zone: tz }).setLocale('en-GB').toFormat(fmt);
}

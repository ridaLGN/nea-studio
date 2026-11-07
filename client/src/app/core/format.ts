/**
 * All dates are shown in the salon's timezone, whatever the device timezone.
 * Browser timezone databases can be outdated (some still treat Africa/Casablanca as UTC+0),
 * so we apply the UTC-offset transitions published by the server instead of `timeZone: …`.
 */
export let SALON_TZ = 'Africa/Casablanca';
let transitions: { from: number; offset: number }[] = [{ from: -Infinity, offset: 60 }];
export function setSalonTz(tz: string, tzTransitions?: { from: string; offset: number }[]) {
  SALON_TZ = tz;
  if (tzTransitions?.length) transitions = tzTransitions.map((t, i) => ({ from: i === 0 ? -Infinity : Date.parse(t.from), offset: t.offset }));
}
/** offset (minutes) of the salon timezone at an instant */
export function offsetAt(ms: number) {
  let off = transitions[0].offset;
  for (const t of transitions) if (t.from <= ms) off = t.offset; else break;
  return off;
}
/** Shifts an instant so that formatting it in UTC yields salon wall-clock time */
const shift = (d: Date) => new Date(d.getTime() + offsetAt(d.getTime()) * 60_000);

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, locale = 'en-GB') {
  const key = locale + JSON.stringify(opts);
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }));
  const f = cache.get(key)!;
  return { format: (d: Date) => f.format(shift(d)) };
}

export const mad = (v: number | null | undefined) =>
  `${new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v ?? 0)} MAD`;

export const time = (iso: string | Date) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const dateShort = (iso: string | Date) => fmt({ day: 'numeric', month: 'short' }).format(new Date(iso));
export const dateLong = (iso: string | Date) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
export const dateTime = (iso: string | Date) => fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

/** YYYY-MM-DD of an instant in salon time */
export function isoDay(d: Date = new Date()): string {
  return fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(d);
}
/** Pure calendar arithmetic on YYYY-MM-DD strings (timezone independent) */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(date: string): number {
  const w = new Date(date + 'T12:00:00Z').getUTCDay();
  return w === 0 ? 7 : w;
}
export function startOfWeek(date: string) {
  return addDays(date, 1 - weekday(date));
}
export function labelDay(date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const toMinute = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};
export const STATUS_BADGE: Record<string, string> = {
  PENDING: 'badge-pending',
  CONFIRMED: 'badge-confirmed',
  COMPLETED: 'badge-completed',
  CANCELLED: 'badge-cancelled',
  NO_SHOW: 'badge-noshow',
};
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

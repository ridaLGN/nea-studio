import { describe, expect, it } from 'vitest';
import { computeDay, slotsFor, fits, subtract, type DayInput } from '../src/modules/availability/engine.js';

const base = (over: Partial<DayInput> = {}): DayInput => ({
  salon: { isClosed: false, open: 540, close: 1200 }, // 09:00–20:00
  salonClosure: false,
  working: { start: 600, end: 1080 }, // 10:00–18:00
  breaks: [{ start: 780, end: 840, label: 'Lunch' }], // 13:00–14:00
  absence: null,
  exceptions: [],
  appointments: [],
  bufferMinutes: 0,
  ...over,
});

describe('availability engine', () => {
  it('subtracts blocks from a window', () => {
    expect(subtract({ start: 0, end: 100 }, [{ start: 20, end: 30 }, { start: 25, end: 50 }, { start: 90, end: 200 }])).toEqual([
      { start: 0, end: 20 },
      { start: 50, end: 90 },
    ]);
  });

  it('respects working hours and breaks', () => {
    const day = computeDay(base());
    expect(day.status).toBe('WORKING');
    expect(day.free).toEqual([{ start: 600, end: 780 }, { start: 840, end: 1080 }]);
    const slots = slotsFor(day, 60, 30);
    expect(slots[0]).toBe(600);
    expect(slots).toContain(720); // 12:00–13:00 fits
    expect(slots).not.toContain(750); // 12:30 would overlap lunch
    expect(slots).toContain(840);
    expect(slots.at(-1)).toBe(1020); // last 60-min slot ends exactly at 18:00
  });

  it('never offers a slot whose service duration overflows the working day', () => {
    const slots = slotsFor(computeDay(base()), 120, 15);
    expect(Math.max(...slots) + 120).toBeLessThanOrEqual(1080);
  });

  it('intersects employee hours with salon opening hours', () => {
    const day = computeDay(base({ salon: { isClosed: false, open: 660, close: 1020 } }));
    expect(day.window).toEqual({ start: 660, end: 1020 });
  });

  it('returns no slots when the salon is closed, on closures, days off and absences', () => {
    expect(computeDay(base({ salon: { isClosed: true, open: 0, close: 0 } })).status).toBe('SALON_CLOSED');
    expect(computeDay(base({ salonClosure: true })).status).toBe('SALON_CLOSED');
    expect(computeDay(base({ working: null })).status).toBe('OFF');
    const absent = computeDay(base({ absence: { type: 'SICK' } }));
    expect(absent.status).toBe('ABSENT');
    expect(slotsFor(absent, 30, 15)).toEqual([]);
  });

  it('blocks existing appointments (with optional buffer)', () => {
    const appts = [{ id: 'a', start: 660, end: 720 }];
    const day = computeDay(base({ appointments: appts }));
    expect(fits(day, 660, 30)).toBe(false);
    expect(fits(day, 630, 30)).toBe(true);
    expect(fits(day, 640, 30)).toBe(false); // overlaps 11:00
    const buffered = computeDay(base({ appointments: appts, bufferMinutes: 15 }));
    expect(fits(buffered, 630, 30)).toBe(false); // ends at 11:00, but needs 15 min buffer
    expect(fits(buffered, 735, 30)).toBe(true);
  });

  it('applies exceptional hours and temporary unavailability', () => {
    const custom = computeDay(base({ exceptions: [{ type: 'CUSTOM_HOURS', start: 900, end: 1140 }] }));
    expect(custom.window).toEqual({ start: 900, end: 1140 });
    const blocked = computeDay(base({ exceptions: [{ type: 'UNAVAILABLE', start: 600, end: 720 }] }));
    expect(fits(blocked, 600, 30)).toBe(false);
    expect(fits(blocked, 720, 30)).toBe(true);
    expect(computeDay(base({ exceptions: [{ type: 'UNAVAILABLE', start: null, end: null }] })).status).toBe('UNAVAILABLE');
  });

  it('offers the start of an off-grid gap and honours the earliest start', () => {
    const day = computeDay(base({ appointments: [{ id: 'x', start: 600, end: 650 }] }));
    const slots = slotsFor(day, 30, 30);
    expect(slots).toContain(650); // right after a 50-min service
    expect(slotsFor(day, 30, 30, 900).every((s) => s >= 900)).toBe(true);
  });
});

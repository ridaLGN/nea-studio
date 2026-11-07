import type { AppointmentStatus, SalonSettings } from '@prisma/client';
import { prisma, type Db, badRequest, notFound, conflict } from '../../lib/core.js';
import { addDays, dayBoundsUtc, diffDays, localToUtc, todayLocal, toDbDate, utcToLocal, weekdayOf, hhmm } from '../../lib/time.js';
import { getSettings } from '../settings/settings.service.js';
import { computeDay, fits, slotsFor, type DayAvailability } from './engine.js';

/** Statuses that occupy an employee's time (must match the DB exclusion constraint). */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED'];

export interface EmployeeDay extends DayAvailability {
  employeeId: string;
  date: string;
}

/** Loads everything needed and computes the day for each employee. */
export async function loadDays(
  db: Db,
  date: string,
  employeeIds: string[],
  opts: { excludeAppointmentId?: string; settings?: SalonSettings } = {},
): Promise<Map<string, EmployeeDay>> {
  const settings = opts.settings ?? (await getSettings(db));
  const tz = settings.timezone;
  const weekday = weekdayOf(date);
  const dbDate = toDbDate(date);
  const { start, end } = dayBoundsUtc(date, tz);

  const [opening, closure, employees, appts] = await Promise.all([
    db.openingHour.findUnique({ where: { weekday } }),
    db.salonClosure.findUnique({ where: { date: dbDate } }),
    db.employee.findMany({
      where: { id: { in: employeeIds } },
      include: {
        workingHours: { where: { weekday } },
        breaks: { where: { weekday } },
        absences: { where: { startDate: { lte: dbDate }, endDate: { gte: dbDate } } },
        exceptions: { where: { date: dbDate } },
      },
    }),
    db.appointment.findMany({
      where: {
        employeeId: { in: employeeIds },
        status: { in: ACTIVE_STATUSES },
        startAt: { lt: end },
        endAt: { gt: start },
        ...(opts.excludeAppointmentId ? { id: { not: opts.excludeAppointmentId } } : {}),
      },
      select: { id: true, employeeId: true, startAt: true, endAt: true },
    }),
  ]);

  const toMin = (d: Date) => {
    const l = utcToLocal(d, tz);
    return l.date < date ? 0 : l.date > date ? 1440 : l.minute;
  };

  const result = new Map<string, EmployeeDay>();
  for (const e of employees) {
    const wh = e.workingHours[0];
    const day = e.isActive
      ? computeDay({
          salon: opening ? { isClosed: opening.isClosed, open: opening.openMinute, close: opening.closeMinute } : null,
          salonClosure: !!closure,
          working: wh ? { start: wh.startMinute, end: wh.endMinute } : null,
          breaks: e.breaks.map((b) => ({ start: b.startMinute, end: b.endMinute, label: b.label })),
          absence: e.absences[0] ? { type: e.absences[0].type, reason: e.absences[0].reason } : null,
          exceptions: e.exceptions.map((x) => ({ type: x.type, start: x.startMinute, end: x.endMinute, reason: x.reason })),
          appointments: appts.filter((a) => a.employeeId === e.id).map((a) => ({ id: a.id, start: toMin(a.startAt), end: toMin(a.endAt) })),
          bufferMinutes: settings.bufferMinutes,
        })
      : { status: 'OFF' as const, window: null, blocks: [], free: [] };
    result.set(e.id, { ...day, employeeId: e.id, date });
  }
  return result;
}

/** Earliest bookable minute on `date` given the notice period (or -Infinity for future days). */
function earliestMinute(settings: SalonSettings, date: string, enforceNotice: boolean, now = new Date()) {
  // public: now + notice period; staff: simply "not in the past"
  const limit = new Date(now.getTime() + (enforceNotice ? settings.minNoticeMinutes * 60_000 : 0));
  const l = utcToLocal(limit, settings.timezone);
  if (l.date < date) return -Infinity;
  if (l.date > date) return Infinity;
  return l.minute;
}

export interface PublicSlotQuery {
  serviceId: string;
  date: string;
  employeeId?: string | null; // null/undefined => any qualified employee
  enforceRules: boolean; // public bookings: notice period, advance window, no past
  excludeAppointmentId?: string;
  durationMinutes?: number; // override (availability search engine)
}

export async function qualifiedEmployees(db: Db, serviceId: string, onlyId?: string | null) {
  const service = await db.service.findUnique({ where: { id: serviceId } });
  if (!service) throw notFound('Service');
  const employees = await db.employee.findMany({
    where: { isActive: true, services: { some: { serviceId } }, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { firstName: 'asc' }],
  });
  return { service, employees };
}

/** Slots per employee for one date. */
export async function findSlots(q: PublicSlotQuery, db: Db = prisma) {
  const settings = await getSettings(db);
  const { service, employees } = await qualifiedEmployees(db, q.serviceId, q.employeeId);
  if (q.enforceRules && !service.isActive) throw badRequest('This service is not available for booking', 'SERVICE_INACTIVE');
  if (q.employeeId && employees.length === 0) throw badRequest('This employee does not perform this service', 'EMPLOYEE_NOT_QUALIFIED');

  const today = todayLocal(settings.timezone);
  const outOfRange = q.enforceRules && (q.date < today || diffDays(today, q.date) > settings.maxAdvanceDays);
  const days = outOfRange ? new Map<string, EmployeeDay>() : await loadDays(db, q.date, employees.map((e) => e.id), { settings, excludeAppointmentId: q.excludeAppointmentId });
  const earliest = earliestMinute(settings, q.date, q.enforceRules);

  const perEmployee = employees.map((e) => {
    const day = days.get(e.id);
    const slots = day ? slotsFor(day, q.durationMinutes ?? service.durationMinutes, settings.slotIntervalMinutes, earliest) : [];
    return { employee: { id: e.id, name: `${e.firstName} ${e.lastName}`, photoUrl: e.photoUrl, color: e.color }, status: day?.status ?? 'OFF', slots };
  });
  const union = [...new Set(perEmployee.flatMap((p) => p.slots))].sort((a, b) => a - b);
  return {
    date: q.date,
    service: { id: service.id, name: service.name, durationMinutes: q.durationMinutes ?? service.durationMinutes },
    slots: union.map((m) => ({
      time: hhmm(m),
      minute: m,
      startAt: localToUtc(q.date, m, settings.timezone).toISOString(),
      employeeIds: perEmployee.filter((p) => p.slots.includes(m)).map((p) => p.employee.id),
    })),
    employees: perEmployee.map((p) => ({ ...p.employee, status: p.status, slots: p.slots.map(hhmm) })),
  };
}

/** Server-side authority used inside the booking transaction. */
export async function assertSlotFree(
  db: Db,
  args: { employeeId: string; startAt: Date; durationMinutes: number; excludeAppointmentId?: string; enforceRules: boolean },
) {
  const settings = await getSettings(db);
  const local = utcToLocal(args.startAt, settings.timezone);
  if (args.enforceRules) {
    const today = todayLocal(settings.timezone);
    if (diffDays(today, local.date) > settings.maxAdvanceDays) throw badRequest(`Bookings open ${settings.maxAdvanceDays} days in advance`, 'OUTSIDE_BOOKING_WINDOW');
    if (args.startAt.getTime() < Date.now() + settings.minNoticeMinutes * 60_000)
      throw badRequest(`Bookings require at least ${settings.minNoticeMinutes} minutes notice`, 'TOO_LATE');
  } else if (args.startAt.getTime() < Date.now() - 15 * 60_000) {
    throw badRequest('Cannot book in the past', 'IN_THE_PAST');
  }
  const day = (await loadDays(db, local.date, [args.employeeId], { settings, excludeAppointmentId: args.excludeAppointmentId })).get(args.employeeId);
  if (!day || !fits(day, local.minute, args.durationMinutes)) {
    const reason =
      day?.status === 'ABSENT' ? 'The employee is absent on this date'
      : day?.status === 'SALON_CLOSED' ? 'The salon is closed on this date'
      : day?.status === 'OFF' || day?.status === 'UNAVAILABLE' ? 'The employee is not working at this time'
      : 'This time slot is no longer available';
    throw conflict(reason, 'SLOT_UNAVAILABLE');
  }
  return { settings, local };
}

/** Next available slots over the coming `days` days — used by smart recommendations. */
export async function nextAvailable(serviceId: string, fromDate: string, days: number, employeeId?: string | null, perEmployee = 3, enforceRules = true) {
  const out = new Map<string, { date: string; time: string; startAt: string }[]>();
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const r = await findSlots({ serviceId, date, employeeId, enforceRules });
    for (const e of r.employees) {
      const list = out.get(e.id) ?? [];
      for (const s of r.slots.filter((s) => s.employeeIds.includes(e.id))) {
        if (list.length >= perEmployee) break;
        list.push({ date, time: s.time, startAt: s.startAt });
      }
      out.set(e.id, list);
    }
    if ([...out.values()].every((l) => l.length >= perEmployee) && out.size > 0) break;
  }
  return out;
}

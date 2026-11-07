import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, parse, notFound, audit, customerNumber, qrToken, normalizePhone, conflict, num } from '../lib/core.js';
import { dayBoundsUtc, isIsoDate, todayLocal, utcToLocal, addDays, diffDays, hhmm, localToUtc, weekdayOf } from '../lib/time.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import {
  appointmentInclude, changeStatus, completeAppointment, createAppointment, rescheduleAppointment, updateAppointmentDetails, type Actor,
} from '../modules/appointments/appointments.service.js';
import { appointmentDto } from '../modules/appointments/appointments.dto.js';
import { findSlots, loadDays, nextAvailable } from '../modules/availability/availability.service.js';
import { slotsFor } from '../modules/availability/engine.js';
import { cardSummary, ensureCard, qrDataUrl } from '../modules/loyalty/loyalty.service.js';
import { getSettings } from '../modules/settings/settings.service.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN', 'MANAGER'));

const isoDate = z.string().refine(isIsoDate, 'Expected YYYY-MM-DD');
const actorOf = (req: { user?: Express.Request['user']; ip?: string }): Actor => ({ userId: req.user!.id, role: req.user!.role, employeeId: req.user!.employeeId, ip: req.ip });
const STATUS = z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);

// =====================================================================
// Real-time availability dashboard
// =====================================================================

adminRouter.get('/availability/day', requirePermission('availability.view'), async (req, res) => {
  const settings = await getSettings();
  const tz = settings.timezone;
  const date = typeof req.query.date === 'string' && isIsoDate(req.query.date) ? req.query.date : todayLocal(tz);
  const today = todayLocal(tz);
  const nowMin = date === today ? utcToLocal(new Date(), tz).minute : date < today ? 1440 : -1;
  const employees = await prisma.employee.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { firstName: 'asc' }] });
  const { start, end } = dayBoundsUtc(date, tz);
  const [days, appts, shortest] = await Promise.all([
    loadDays(prisma, date, employees.map((e) => e.id), { settings }),
    prisma.appointment.findMany({ where: { startAt: { gte: start, lt: end } }, include: appointmentInclude, orderBy: { startAt: 'asc' } }),
    prisma.service.findFirst({ where: { isActive: true }, orderBy: { durationMinutes: 'asc' } }),
  ]);
  const refDuration = shortest?.durationMinutes ?? 30;

  let capacity = 0, booked = 0, freeSlots = 0;
  let nextFree: { employeeId: string; time: string } | null = null;
  const columns = employees.map((e) => {
    const d = days.get(e.id)!;
    const breaks = d.blocks.filter((b) => b.kind !== 'APPOINTMENT');
    const apptBlocks = d.blocks.filter((b) => b.kind === 'APPOINTMENT');
    const cap = d.window ? d.window.end - d.window.start - breaks.reduce((s, b) => s + Math.max(0, Math.min(b.end, d.window!.end) - Math.max(b.start, d.window!.start)), 0) : 0;
    const bookedMin = apptBlocks.reduce((s, b) => s + (Math.min(b.end, d.window?.end ?? 0) - Math.max(b.start, d.window?.start ?? 0)), 0);
    capacity += cap;
    booked += Math.max(0, bookedMin - apptBlocks.length * 2 * settings.bufferMinutes);
    const futureSlots = slotsFor(d, refDuration, settings.slotIntervalMinutes, nowMin);
    freeSlots += d.free.reduce((s, f) => s + Math.floor((f.end - Math.max(f.start, nowMin)) / refDuration), 0);
    if (futureSlots.length) {
      const t = hhmm(futureSlots[0]);
      if (!nextFree || t < (nextFree as { time: string }).time) nextFree = { employeeId: e.id, time: t };
    }
    let state: 'AVAILABLE' | 'BUSY' | 'ON_BREAK' | 'ABSENT' | 'OFF' | 'NOT_STARTED' | 'FINISHED' = 'OFF';
    if (d.status === 'ABSENT' || d.status === 'UNAVAILABLE') state = 'ABSENT';
    else if (d.status === 'WORKING' && d.window) {
      if (nowMin < d.window.start) state = 'NOT_STARTED';
      else if (nowMin >= d.window.end) state = 'FINISHED';
      else {
        const busy = appts.some((a) => a.employeeId === e.id && ['PENDING', 'CONFIRMED', 'COMPLETED'].includes(a.status) && utcToLocal(a.startAt, tz).minute <= nowMin && utcToLocal(a.endAt, tz).minute > nowMin);
        const onBreak = breaks.some((b) => b.start <= nowMin && b.end > nowMin);
        state = busy ? 'BUSY' : onBreak ? 'ON_BREAK' : 'AVAILABLE';
      }
    }
    return {
      employee: { id: e.id, name: `${e.firstName} ${e.lastName}`, firstName: e.firstName, title: e.title, photoUrl: e.photoUrl, color: e.color },
      status: d.status,
      reason: d.reason ?? null,
      state,
      window: d.window,
      blocks: breaks,
      free: d.free,
      capacityMinutes: cap,
      bookedMinutes: bookedMin,
    };
  });
  const active = appts.filter((a) => a.status !== 'CANCELLED');
  const opening = await prisma.openingHour.findUnique({ where: { weekday: weekdayOf(date) } });
  res.json({
    date,
    isToday: date === today,
    nowMinute: date === today ? nowMin : null,
    opening,
    stats: {
      working: columns.filter((c) => c.status === 'WORKING').length,
      available: columns.filter((c) => c.state === 'AVAILABLE').length,
      busy: columns.filter((c) => c.state === 'BUSY').length,
      onBreak: columns.filter((c) => c.state === 'ON_BREAK').length,
      absent: columns.filter((c) => c.state === 'ABSENT').length,
      appointments: active.length,
      freeSlots,
      slotReferenceMinutes: refDuration,
      occupancy: capacity ? Math.round((booked / capacity) * 100) : 0,
      nextAvailable: nextFree,
    },
    columns,
    appointments: appts.map((a) => ({ ...appointmentDto(a), startMinute: utcToLocal(a.startAt, tz).minute, endMinute: utcToLocal(a.endAt, tz).minute })),
    upcoming: active.filter((a) => a.startAt > new Date() && a.status !== 'COMPLETED' && a.status !== 'NO_SHOW').slice(0, 6).map((a) => appointmentDto(a)),
  });
});

/** Week / month views */
adminRouter.get('/availability/range', requirePermission('availability.view'), async (req, res) => {
  const q = parse(z.object({ from: isoDate, to: isoDate, employeeId: z.string().optional() }), req.query);
  const span = diffDays(q.from, q.to);
  if (span < 0 || span > 42) throw conflict('Range must be between 1 and 43 days', 'BAD_RANGE');
  const settings = await getSettings();
  const employees = await prisma.employee.findMany({ where: { isActive: true, ...(q.employeeId ? { id: q.employeeId } : {}) }, orderBy: [{ sortOrder: 'asc' }, { firstName: 'asc' }] });
  const appts = await prisma.appointment.findMany({
    where: { startAt: { gte: dayBoundsUtc(q.from, settings.timezone).start, lt: dayBoundsUtc(q.to, settings.timezone).end }, ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    include: appointmentInclude,
    orderBy: { startAt: 'asc' },
  });
  const days = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(q.from, i);
    const m = await loadDays(prisma, date, employees.map((e) => e.id), { settings });
    let cap = 0, freeMin = 0, working = 0, absent = 0;
    for (const d of m.values()) {
      if (d.status === 'WORKING') working++;
      if (d.status === 'ABSENT' || d.status === 'UNAVAILABLE') absent++;
      if (d.window) cap += d.window.end - d.window.start - d.blocks.filter((b) => b.kind !== 'APPOINTMENT').reduce((s, b) => s + (b.end - b.start), 0);
      freeMin += d.free.reduce((s, f) => s + f.end - f.start, 0);
    }
    const dayAppts = appts.filter((a) => utcToLocal(a.startAt, settings.timezone).date === date && a.status !== 'CANCELLED');
    days.push({
      date, working, absent, capacityMinutes: cap, freeMinutes: freeMin, appointments: dayAppts.length,
      occupancy: cap ? Math.min(100, Math.round(((cap - freeMin) / cap) * 100)) : 0,
      employees: [...m.values()].map((d) => ({ employeeId: d.employeeId, status: d.status, window: d.window })),
    });
  }
  res.json({
    from: q.from, to: q.to,
    employees: employees.map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, firstName: e.firstName, color: e.color, photoUrl: e.photoUrl })),
    days,
    appointments: appts.map((a) => ({ ...appointmentDto(a), date: utcToLocal(a.startAt, settings.timezone).date, startMinute: utcToLocal(a.startAt, settings.timezone).minute, endMinute: utcToLocal(a.endAt, settings.timezone).minute })),
  });
});

/** Availability search engine + smart recommendations */
adminRouter.get('/availability/search', requirePermission('availability.view'), async (req, res) => {
  const q = parse(
    z.object({
      serviceId: z.string().min(1), date: isoDate.optional(), employeeId: z.string().optional(),
      preferredTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), durationMinutes: z.coerce.number().int().min(5).max(600).optional(),
      days: z.coerce.number().int().min(1).max(30).default(14),
    }),
    req.query,
  );
  const settings = await getSettings();
  const date = q.date ?? todayLocal(settings.timezone);
  const r = await findSlots({ serviceId: q.serviceId, date, employeeId: q.employeeId || null, enforceRules: false, durationMinutes: q.durationMinutes });
  let slots = r.slots;
  if (q.preferredTime) {
    const [h, m] = q.preferredTime.split(':').map(Number);
    const pref = h * 60 + m;
    slots = [...slots].sort((a, b) => Math.abs(a.minute - pref) - Math.abs(b.minute - pref));
  }
  const next = await nextAvailable(q.serviceId, date, q.days, q.employeeId || null, 3, false);
  const recommendations = r.employees.map((e) => ({ ...e, next: next.get(e.id) ?? [] }));
  const earliest = recommendations.flatMap((e) => e.next.map((n) => ({ ...n, employeeId: e.id, employeeName: e.name }))).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
  res.json({ ...r, slots, recommendations, earliest });
});

// =====================================================================
// Appointments
// =====================================================================

adminRouter.get('/appointments', requirePermission('appointments.view_all'), async (req, res) => {
  const q = parse(
    z.object({
      from: isoDate.optional(), to: isoDate.optional(), status: STATUS.optional(), employeeId: z.string().optional(), serviceId: z.string().optional(),
      q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }),
    req.query,
  );
  const settings = await getSettings();
  const where: Prisma.AppointmentWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.employeeId ? { employeeId: q.employeeId } : {}),
    ...(q.serviceId ? { serviceId: q.serviceId } : {}),
    ...(q.from || q.to
      ? { startAt: { ...(q.from ? { gte: dayBoundsUtc(q.from, settings.timezone).start } : {}), ...(q.to ? { lt: dayBoundsUtc(q.to, settings.timezone).end } : {}) } }
      : {}),
    ...(q.q
      ? { OR: [{ reference: { contains: q.q.toUpperCase() } }, { customer: { fullName: { contains: q.q, mode: 'insensitive' } } }, { customer: { phone: { contains: q.q.replace(/\D/g, '') || q.q } } }] }
      : {}),
  };
  const [total, list] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({ where, include: appointmentInclude, orderBy: { startAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ total, page: q.page, pageSize: q.pageSize, items: list.map((a) => appointmentDto(a)) });
});

adminRouter.get('/appointments/:id', requirePermission('appointments.view_all'), async (req, res) => {
  const a = await prisma.appointment.findUnique({ where: { id: (req.params.id as string) }, include: { ...appointmentInclude, history: { orderBy: { createdAt: 'asc' as const } } } });
  if (!a) throw notFound('Appointment');
  const rewards = await prisma.loyaltyReward.findMany({ where: { card: { customerId: a.customerId }, status: 'AVAILABLE' } });
  const actorIds = [...new Set(a.history.map((h) => h.actorUserId).filter(Boolean))] as string[];
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, email: true } });
  res.json({
    ...appointmentDto(a),
    history: a.history.map((h) => ({ ...h, actor: actors.find((x) => x.id === h.actorUserId)?.email ?? (h.actorUserId ? 'user' : 'Customer / system') })),
    availableRewards: rewards.map((r) => ({ id: r.id, discountPercent: r.discountPercent, expiresAt: r.expiresAt })),
  });
});

const createSchema = z.object({
  serviceId: z.string().min(1),
  employeeId: z.string().nullish(),
  startAt: z.string().datetime({ offset: true }).optional(),
  date: isoDate.optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  customerId: z.string().optional(),
  customer: z.object({ fullName: z.string().trim().min(2), phone: z.string().min(6), email: z.string().email().optional().or(z.literal('')) }).optional(),
  notes: z.string().max(500).optional(),
  status: z.enum(['PENDING', 'CONFIRMED']).optional(),
});

adminRouter.post('/appointments', requirePermission('appointments.manage'), async (req, res) => {
  const b = parse(createSchema, req.body);
  const settings = await getSettings();
  const startAt = b.startAt ? new Date(b.startAt) : b.date && b.time ? localToUtc(b.date, Number(b.time.slice(0, 2)) * 60 + Number(b.time.slice(3)), settings.timezone) : null;
  if (!startAt) throw conflict('startAt or date+time is required', 'VALIDATION_ERROR');
  const a = await createAppointment(
    { serviceId: b.serviceId, employeeId: b.employeeId || null, startAt, customerId: b.customerId, customer: b.customer ? { ...b.customer, email: b.customer.email || null } : undefined, notes: b.notes, source: 'ADMIN', status: b.status },
    actorOf(req),
  );
  res.status(201).json(appointmentDto(a));
});

adminRouter.patch('/appointments/:id', requirePermission('appointments.manage'), async (req, res) => {
  const b = parse(z.object({ notes: z.string().max(1000).nullable() }), req.body);
  res.json(appointmentDto(await updateAppointmentDetails((req.params.id as string), b, actorOf(req))));
});

adminRouter.post('/appointments/:id/reschedule', requirePermission('appointments.manage'), async (req, res) => {
  const b = parse(z.object({ startAt: z.string().datetime({ offset: true }), employeeId: z.string().nullish() }), req.body);
  res.json(appointmentDto(await rescheduleAppointment((req.params.id as string), { startAt: new Date(b.startAt), employeeId: b.employeeId || null }, actorOf(req))));
});

adminRouter.post('/appointments/:id/status', requirePermission('appointments.manage'), async (req, res) => {
  const b = parse(z.object({ status: STATUS.exclude(['COMPLETED']), reason: z.string().max(300).optional() }), req.body);
  res.json(appointmentDto(await changeStatus((req.params.id as string), b.status, actorOf(req), b.reason)));
});

adminRouter.post('/appointments/:id/complete', requirePermission('appointments.complete'), async (req, res) => {
  const b = parse(z.object({ rewardId: z.string().nullish(), paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']).nullish() }), req.body ?? {});
  const r = await completeAppointment((req.params.id as string), { rewardId: b.rewardId, paymentMethod: b.paymentMethod ?? null }, actorOf(req));
  res.json({ appointment: appointmentDto(r.appointment), stamped: r.stamped, newRewards: r.newRewards });
});

// =====================================================================
// CRM
// =====================================================================

adminRouter.get('/customers', requirePermission('customers.view'), async (req, res) => {
  const q = parse(z.object({ q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
  const digits = q.q?.replace(/\D/g, '') ?? '';
  const where: Prisma.CustomerWhereInput = q.q
    ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { customerNumber: { contains: q.q.toUpperCase() } }, ...(digits.length >= 3 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : [])] }
    : {};
  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const ids = customers.map((c) => c.id);
  const now = new Date();
  const [visits, lastVisits, nextAppts, stamps, rewards] = await Promise.all([
    prisma.appointment.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: 'COMPLETED' }, _count: true }),
    prisma.appointment.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: 'COMPLETED' }, _max: { startAt: true } }),
    prisma.appointment.groupBy({ by: ['customerId'], where: { customerId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now } }, _min: { startAt: true } }),
    prisma.loyaltyStamp.groupBy({ by: ['cardId'], where: { card: { customerId: { in: ids } }, revokedAt: null }, _sum: { value: true } }),
    prisma.loyaltyReward.findMany({ where: { card: { customerId: { in: ids } }, status: 'AVAILABLE' }, select: { discountPercent: true, card: { select: { customerId: true, id: true } } } }),
  ]);
  const cards = await prisma.loyaltyCard.findMany({ where: { customerId: { in: ids } }, select: { id: true, customerId: true } });
  res.json({
    total, page: q.page, pageSize: q.pageSize,
    items: customers.map((c) => {
      const cardId = cards.find((x) => x.customerId === c.id)?.id;
      return {
        id: c.id, customerNumber: c.customerNumber, fullName: c.fullName, phone: c.phone, email: c.email, isDemo: c.isDemo, createdAt: c.createdAt, hasAccount: !!c.userId,
        totalVisits: visits.find((v) => v.customerId === c.id)?._count ?? 0,
        lastVisit: lastVisits.find((v) => v.customerId === c.id)?._max.startAt ?? null,
        nextAppointment: nextAppts.find((v) => v.customerId === c.id)?._min.startAt ?? null,
        stamps: stamps.find((s) => s.cardId === cardId)?._sum.value ?? 0,
        availableRewards: rewards.filter((r) => r.card.customerId === c.id).map((r) => r.discountPercent),
      };
    }),
  });
});

const customerSchema = z.object({ fullName: z.string().trim().min(2).max(120), phone: z.string().min(6).max(30), email: z.string().trim().email().optional().or(z.literal('')), notes: z.string().max(2000).optional() });

adminRouter.post('/customers', requirePermission('customers.manage'), async (req, res) => {
  const b = parse(customerSchema, req.body);
  const phone = normalizePhone(b.phone);
  if (await prisma.customer.findUnique({ where: { phone } })) throw conflict('A customer with this phone number already exists', 'PHONE_TAKEN');
  const c = await prisma.customer.create({ data: { fullName: b.fullName, phone, email: b.email || null, notes: b.notes, customerNumber: customerNumber(), qrToken: qrToken() } });
  await ensureCard(prisma, c.id);
  await audit({ actorUserId: req.user!.id, action: 'CUSTOMER_CREATED', entityType: 'Customer', entityId: c.id, ip: req.ip });
  res.status(201).json(c);
});

adminRouter.get('/customers/:id', requirePermission('customers.view'), async (req, res) => {
  const c = await prisma.customer.findUnique({ where: { id: (req.params.id as string) }, include: { user: { select: { email: true, lastLoginAt: true } } } });
  if (!c) throw notFound('Customer');
  const [appointments, loyalty, payments] = await Promise.all([
    prisma.appointment.findMany({ where: { customerId: c.id }, include: appointmentInclude, orderBy: { startAt: 'desc' } }),
    cardSummary(c.id),
    prisma.payment.aggregate({ where: { appointment: { customerId: c.id }, status: 'PAID' }, _sum: { amountMad: true } }),
  ]);
  res.json({
    id: c.id, customerNumber: c.customerNumber, fullName: c.fullName, phone: c.phone, email: c.email, notes: c.notes, isDemo: c.isDemo, createdAt: c.createdAt,
    account: c.user, qrCode: await qrDataUrl(c.qrToken),
    totalSpentMad: num(payments._sum.amountMad),
    appointments: appointments.map((a) => appointmentDto(a)),
    loyalty,
  });
});

adminRouter.patch('/customers/:id', requirePermission('customers.manage'), async (req, res) => {
  const b = parse(customerSchema.partial(), req.body);
  const data: Prisma.CustomerUpdateInput = { ...b, ...(b.phone ? { phone: normalizePhone(b.phone) } : {}), ...(b.email !== undefined ? { email: b.email || null } : {}) };
  const c = await prisma.customer.update({ where: { id: (req.params.id as string) }, data });
  await audit({ actorUserId: req.user!.id, action: 'CUSTOMER_UPDATED', entityType: 'Customer', entityId: c.id, details: Object.keys(b), ip: req.ip });
  res.json(c);
});

/** Rotates the QR token (e.g. if a customer's QR was shared) */
adminRouter.post('/customers/:id/rotate-qr', requirePermission('customers.manage'), async (req, res) => {
  const c = await prisma.customer.update({ where: { id: (req.params.id as string) }, data: { qrToken: qrToken() } });
  await audit({ actorUserId: req.user!.id, action: 'CUSTOMER_QR_ROTATED', entityType: 'Customer', entityId: c.id, ip: req.ip });
  res.json({ qrCode: await qrDataUrl(c.qrToken) });
});

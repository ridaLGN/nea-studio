import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma, parse, notFound, normalizePhone, num } from '../lib/core.js';
import { isIsoDate, todayLocal } from '../lib/time.js';
import { isTest } from '../config/env.js';
import { getSettings, publicSettings } from '../modules/settings/settings.service.js';
import { findSlots } from '../modules/availability/availability.service.js';
import { appointmentInclude, changeStatus, createAppointment, rescheduleAppointment, type Actor } from '../modules/appointments/appointments.service.js';
import { appointmentDto } from '../modules/appointments/appointments.dto.js';

export const publicRouter = Router();

const bookingLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 10_000 : 30, standardHeaders: true, legacyHeaders: false });
const isoDate = z.string().refine(isIsoDate, 'Expected YYYY-MM-DD');

publicRouter.get('/settings', async (_req, res) => {
  const [s, opening] = await Promise.all([getSettings(), prisma.openingHour.findMany({ orderBy: { weekday: 'asc' } })]);
  res.json({ ...publicSettings(s), today: todayLocal(s.timezone), openingHours: opening });
});

publicRouter.get('/categories', async (_req, res) => {
  res.json(await prisma.serviceCategory.findMany({ orderBy: { sortOrder: 'asc' } }));
});

publicRouter.get('/services', async (req, res) => {
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const services = await prisma.service.findMany({
    where: { isActive: true, ...(category ? { category: { slug: category } } : {}) },
    include: { category: true, employees: { include: { employee: { select: { id: true, firstName: true, lastName: true, photoUrl: true, color: true, isActive: true } } } } },
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  res.json(
    services.map((s) => ({
      id: s.id, name: s.name, slug: s.slug, description: s.description, priceMad: num(s.priceMad), durationMinutes: s.durationMinutes,
      imageUrl: s.imageUrl, isDemo: s.isDemo, category: { id: s.category.id, name: s.category.name, slug: s.category.slug },
      employees: s.employees.filter((e) => e.employee.isActive).map((e) => ({ id: e.employee.id, name: `${e.employee.firstName} ${e.employee.lastName}`, photoUrl: e.employee.photoUrl, color: e.employee.color })),
    })),
  );
});

publicRouter.get('/employees', async (_req, res) => {
  const list = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, title: true, bio: true, photoUrl: true, color: true, isDemo: true, services: { select: { serviceId: true } } },
    orderBy: [{ sortOrder: 'asc' }, { firstName: 'asc' }],
  });
  res.json(list.map((e) => ({ ...e, services: e.services.map((s) => s.serviceId) })));
});

/** Available slots — computed server side, never trust the browser. */
publicRouter.get('/availability', async (req, res) => {
  const q = parse(z.object({ serviceId: z.string().min(1), date: isoDate, employeeId: z.string().optional() }), req.query);
  const r = await findSlots({ serviceId: q.serviceId, date: q.date, employeeId: q.employeeId && q.employeeId !== 'any' ? q.employeeId : null, enforceRules: true });
  res.json(r);
});

const bookingSchema = z.object({
  serviceId: z.string().min(1),
  employeeId: z.string().nullish(),
  startAt: z.string().datetime({ offset: true }),
  customer: z.object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(6).max(30),
    email: z.string().trim().email().max(200).optional().or(z.literal('')),
  }),
  notes: z.string().max(500).optional(),
});

publicRouter.post('/bookings', bookingLimiter, async (req, res) => {
  const b = parse(bookingSchema, req.body);
  const actor: Actor = { userId: req.user?.id ?? null, role: req.user?.role ?? null, customerId: req.user?.customerId, ip: req.ip };
  const appt = await createAppointment(
    {
      serviceId: b.serviceId,
      employeeId: b.employeeId && b.employeeId !== 'any' ? b.employeeId : null,
      startAt: new Date(b.startAt),
      // a signed-in customer always books for themself
      ...(req.user?.customerId ? { customerId: req.user.customerId } : { customer: { ...b.customer, email: b.customer.email || null } }),
      notes: b.notes,
      source: 'ONLINE',
    },
    actor,
  );
  res.status(201).json(appointmentDto(appt));
});

/** Manage a booking without an account: reference + phone act as a two-factor lookup. */
async function findByRefAndPhone(reference: string, phone: string) {
  const a = await prisma.appointment.findUnique({ where: { reference: reference.trim().toUpperCase() }, include: appointmentInclude });
  let p: string;
  try {
    p = normalizePhone(phone);
  } catch {
    throw notFound('Booking');
  }
  if (!a || a.customer.phone !== p) throw notFound('Booking'); // same error for both cases: no enumeration
  return a;
}
const lookup = z.object({ reference: z.string().min(4).max(20), phone: z.string().min(6).max(30) });

publicRouter.post('/bookings/lookup', bookingLimiter, async (req, res) => {
  const b = parse(lookup, req.body);
  res.json(appointmentDto(await findByRefAndPhone(b.reference, b.phone)));
});

publicRouter.post('/bookings/cancel', bookingLimiter, async (req, res) => {
  const b = parse(lookup.extend({ reason: z.string().max(300).optional() }), req.body);
  const a = await findByRefAndPhone(b.reference, b.phone);
  const u = await changeStatus(a.id, 'CANCELLED', { userId: null, role: null, customerId: a.customerId, ip: req.ip }, b.reason ?? 'Cancelled by customer');
  res.json(appointmentDto(u));
});

publicRouter.post('/bookings/reschedule', bookingLimiter, async (req, res) => {
  const b = parse(lookup.extend({ startAt: z.string().datetime({ offset: true }), employeeId: z.string().nullish() }), req.body);
  const a = await findByRefAndPhone(b.reference, b.phone);
  const u = await rescheduleAppointment(a.id, { startAt: new Date(b.startAt), employeeId: b.employeeId || null }, { userId: null, role: null, customerId: a.customerId, ip: req.ip });
  res.json(appointmentDto(u));
});

import { Router } from 'express';
import { z } from 'zod';
import { prisma, parse, notFound, forbidden, audit } from '../lib/core.js';
import { dayBoundsUtc, isIsoDate, todayLocal, fromDbDate } from '../lib/time.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { appointmentInclude, changeStatus, completeAppointment, type Actor } from '../modules/appointments/appointments.service.js';
import { appointmentDto } from '../modules/appointments/appointments.dto.js';
import { loadDays } from '../modules/availability/availability.service.js';
import { cardSummary } from '../modules/loyalty/loyalty.service.js';
import { getSettings } from '../modules/settings/settings.service.js';

/** Routes used by employees (and by managers/admins acting at the front desk). */
export const staffRouter = Router();
staffRouter.use(authenticate, requireRole('ADMIN', 'MANAGER', 'EMPLOYEE'));

const actorOf = (req: { user?: Express.Request['user']; ip?: string }): Actor => ({
  userId: req.user!.id, role: req.user!.role, employeeId: req.user!.employeeId, ip: req.ip,
});

/** The signed-in employee's day: timeline, free intervals and appointments. */
staffRouter.get('/my-day', async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw notFound('Employee profile');
  const settings = await getSettings();
  const date = typeof req.query.date === 'string' && isIsoDate(req.query.date) ? req.query.date : todayLocal(settings.timezone);
  const { start, end } = dayBoundsUtc(date, settings.timezone);
  const [day, appts, employee] = await Promise.all([
    loadDays(prisma, date, [employeeId], { settings }),
    prisma.appointment.findMany({ where: { employeeId, startAt: { gte: start, lt: end } }, include: appointmentInclude, orderBy: { startAt: 'asc' } }),
    prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      include: { workingHours: { orderBy: { weekday: 'asc' } }, breaks: true, absences: { where: { endDate: { gte: new Date() } }, orderBy: { startDate: 'asc' } }, services: { include: { service: { select: { name: true } } } } },
    }),
  ]);
  res.json({
    date,
    day: day.get(employeeId),
    appointments: appts.map((a) => appointmentDto(a)),
    schedule: {
      workingHours: employee.workingHours,
      breaks: employee.breaks,
      absences: employee.absences.map((a) => ({ ...a, startDate: fromDbDate(a.startDate), endDate: fromDbDate(a.endDate) })),
      services: employee.services.map((s) => s.service.name),
    },
  });
});

staffRouter.get('/my-appointments', async (req, res) => {
  const employeeId = req.user!.employeeId;
  if (!employeeId) throw notFound('Employee profile');
  const list = await prisma.appointment.findMany({
    where: { employeeId, startAt: { gte: new Date(Date.now() - 3600_000) }, status: { in: ['PENDING', 'CONFIRMED'] } },
    include: appointmentInclude,
    orderBy: { startAt: 'asc' },
    take: 50,
  });
  res.json(list.map((a) => appointmentDto(a)));
});

async function customerContext(customerId: string) {
  const settings = await getSettings();
  const today = todayLocal(settings.timezone);
  const { start } = dayBoundsUtc(today, settings.timezone);
  const [customer, appointments, loyalty] = await Promise.all([
    prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { id: true, fullName: true, customerNumber: true, phone: true, email: true, notes: true } }),
    prisma.appointment.findMany({ where: { customerId, startAt: { gte: start } }, include: appointmentInclude, orderBy: { startAt: 'asc' }, take: 10 }),
    cardSummary(customerId),
  ]);
  return { customer, appointments: appointments.map((a) => appointmentDto(a)), loyalty, today };
}

/** QR scan: the token is opaque — it reveals nothing without this authenticated lookup. */
staffRouter.post('/scan', requirePermission('qr.scan'), async (req, res) => {
  const b = parse(z.object({ code: z.string().min(10).max(200) }), req.body);
  const token = b.code.trim().replace(/^NEA:/, '');
  const c = await prisma.customer.findUnique({ where: { qrToken: token }, select: { id: true } });
  if (!c) throw notFound('Customer for this QR code');
  await audit({ actorUserId: req.user!.id, action: 'QR_SCANNED', entityType: 'Customer', entityId: c.id, ip: req.ip });
  res.json(await customerContext(c.id));
});

/** Manual alternative to scanning */
staffRouter.get('/customers/search', requirePermission('qr.scan'), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return res.json([]);
  const digits = q.replace(/\D/g, '');
  const list = await prisma.customer.findMany({
    where: {
      OR: [
        { fullName: { contains: q, mode: 'insensitive' } },
        { customerNumber: { contains: q.toUpperCase() } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits.replace(/^0/, '') } }] : []),
      ],
    },
    select: { id: true, fullName: true, customerNumber: true, phone: true },
    take: 10,
  });
  res.json(list);
});

staffRouter.get('/customers/:id/context', requirePermission('qr.scan'), async (req, res) => {
  res.json(await customerContext((req.params.id as string)));
});

staffRouter.post('/appointments/:id/complete', requirePermission('appointments.complete'), async (req, res) => {
  const b = parse(z.object({ rewardId: z.string().nullish(), paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'OTHER']).nullish() }), req.body ?? {});
  const r = await completeAppointment((req.params.id as string), { rewardId: b.rewardId, paymentMethod: b.paymentMethod ?? null }, actorOf(req));
  res.json({ appointment: appointmentDto(r.appointment), stamped: r.stamped, newRewards: r.newRewards });
});

staffRouter.post('/appointments/:id/status', async (req, res) => {
  const b = parse(z.object({ status: z.enum(['CONFIRMED', 'NO_SHOW']) }), req.body);
  if (req.user!.role === 'EMPLOYEE' && !req.user!.permissions.has('appointments.complete')) throw forbidden();
  res.json(appointmentDto(await changeStatus((req.params.id as string), b.status, actorOf(req))));
});

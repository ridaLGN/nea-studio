import { Router } from 'express';
import { z } from 'zod';
import { prisma, parse, notFound, audit } from '../lib/core.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { appointmentInclude, changeStatus, rescheduleAppointment, type Actor } from '../modules/appointments/appointments.service.js';
import { appointmentDto } from '../modules/appointments/appointments.dto.js';
import { cardSummary, qrDataUrl } from '../modules/loyalty/loyalty.service.js';

/** Customer self-service area — every query is scoped to req.user.customerId. */
export const meRouter = Router();
meRouter.use(authenticate, requireRole('CUSTOMER'));

const actorOf = (req: Parameters<Parameters<typeof meRouter.get>[1]>[0]): Actor => ({
  userId: req.user!.id, role: 'CUSTOMER', customerId: req.user!.customerId, ip: req.ip,
});
const customerId = (req: { user?: { customerId: string | null } }) => {
  if (!req.user?.customerId) throw notFound('Customer profile');
  return req.user.customerId;
};

meRouter.get('/profile', async (req, res) => {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: customerId(req) } });
  res.json({ id: c.id, customerNumber: c.customerNumber, fullName: c.fullName, phone: c.phone, email: c.email, createdAt: c.createdAt, qrCode: await qrDataUrl(c.qrToken) });
});

meRouter.patch('/profile', async (req, res) => {
  const b = parse(z.object({ fullName: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().optional() }), req.body);
  const c = await prisma.customer.update({ where: { id: customerId(req) }, data: b });
  await audit({ actorUserId: req.user!.id, action: 'CUSTOMER_PROFILE_UPDATED', entityType: 'Customer', entityId: c.id, details: b, ip: req.ip });
  res.json({ ok: true });
});

meRouter.get('/appointments', async (req, res) => {
  const list = await prisma.appointment.findMany({ where: { customerId: customerId(req) }, include: appointmentInclude, orderBy: { startAt: 'desc' } });
  res.json(list.map((a) => appointmentDto(a)));
});

meRouter.post('/appointments/:id/cancel', async (req, res) => {
  const b = parse(z.object({ reason: z.string().max(300).optional() }), req.body ?? {});
  res.json(appointmentDto(await changeStatus((req.params.id as string), 'CANCELLED', actorOf(req), b.reason ?? 'Cancelled by customer')));
});

meRouter.post('/appointments/:id/reschedule', async (req, res) => {
  const b = parse(z.object({ startAt: z.string().datetime({ offset: true }), employeeId: z.string().nullish() }), req.body);
  res.json(appointmentDto(await rescheduleAppointment((req.params.id as string), { startAt: new Date(b.startAt), employeeId: b.employeeId || null }, actorOf(req))));
});

meRouter.get('/loyalty', async (req, res) => {
  res.json(await cardSummary(customerId(req)));
});

meRouter.get('/notifications', async (req, res) => {
  const list = await prisma.notification.findMany({
    where: { customerId: customerId(req) },
    select: { id: true, type: true, channel: true, status: true, subject: true, createdAt: true, sentAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(list);
});

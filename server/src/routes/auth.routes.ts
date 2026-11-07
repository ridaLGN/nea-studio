import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma, parse, unauthorized, conflict, badRequest, normalizePhone, audit } from '../lib/core.js';
import { isTest } from '../config/env.js';
import { authenticate, signToken } from '../middleware/auth.js';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 10_000 : 20, standardHeaders: true, legacyHeaders: false });
const password = z.string().min(8, 'At least 8 characters').max(128);

async function profile(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { permissions: { include: { permission: true } } } }, customer: true, employee: true },
  });
  return {
    id: u.id,
    email: u.email,
    role: u.role.name,
    permissions: u.role.permissions.map((p) => p.permission.key),
    customer: u.customer ? { id: u.customer.id, fullName: u.customer.fullName, customerNumber: u.customer.customerNumber } : null,
    employee: u.employee ? { id: u.employee.id, firstName: u.employee.firstName, lastName: u.employee.lastName, photoUrl: u.employee.photoUrl } : null,
  };
}

authRouter.post('/login', limiter, async (req, res) => {
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }), req.body);
  const user = await prisma.user.findUnique({ where: { email: b.email }, include: { role: true } });
  // constant-ish time: always run bcrypt
  const ok = await bcrypt.compare(b.password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (!user || !ok || !user.isActive) {
    await audit({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id, details: { email: b.email }, ip: req.ip });
    throw unauthorized('Invalid email or password');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ actorUserId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, ip: req.ip });
  res.json({ token: signToken({ id: user.id, role: user.role.name }), user: await profile(user.id) });
});

/**
 * Customers book without an account. To open their loyalty account they "claim" it
 * by proving they own a booking: booking reference + the phone number used.
 */
authRouter.post('/claim', limiter, async (req, res) => {
  const b = parse(z.object({ reference: z.string().min(4), phone: z.string().min(6), email: z.string().trim().toLowerCase().email(), password }), req.body);
  let phone: string;
  try {
    phone = normalizePhone(b.phone);
  } catch {
    throw badRequest('Booking reference and phone number do not match', 'CLAIM_MISMATCH');
  }
  const appt = await prisma.appointment.findUnique({ where: { reference: b.reference.trim().toUpperCase() }, include: { customer: true } });
  if (!appt || appt.customer.phone !== phone) throw badRequest('Booking reference and phone number do not match', 'CLAIM_MISMATCH');
  if (appt.customer.userId) throw conflict('An account already exists for this customer. Please sign in.', 'ALREADY_CLAIMED');
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw conflict('This email is already used by another account', 'EMAIL_TAKEN');
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({ data: { email: b.email, passwordHash: await bcrypt.hash(b.password, 12), roleId: role.id } });
    await tx.customer.update({ where: { id: appt.customerId }, data: { userId: u.id, email: appt.customer.email ?? b.email } });
    await audit({ actorUserId: u.id, action: 'CUSTOMER_ACCOUNT_CLAIMED', entityType: 'Customer', entityId: appt.customerId, ip: req.ip }, tx);
    return u;
  });
  res.status(201).json({ token: signToken({ id: user.id, role: 'CUSTOMER' }), user: await profile(user.id) });
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await profile(req.user!.id));
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string().min(1), newPassword: password }), req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
  if (!(await bcrypt.compare(b.currentPassword, u.passwordHash))) throw badRequest('Current password is incorrect', 'WRONG_PASSWORD');
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(b.newPassword, 12) } });
  await audit({ actorUserId: u.id, action: 'PASSWORD_CHANGED', entityType: 'User', entityId: u.id, ip: req.ip });
  res.json({ ok: true });
});

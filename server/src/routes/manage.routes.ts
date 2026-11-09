import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { put } from '@vercel/blob';
import { env, isVercel } from '../config/env.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, parse, notFound, conflict, badRequest, audit, num, dec, AppError } from '../lib/core.js';
import { isIsoDate, toDbDate, fromDbDate, todayLocal } from '../lib/time.js';
import { emitAvailabilityChanged } from '../lib/realtime.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { getSettings } from '../modules/settings/settings.service.js';
import { adjustStamps, cardSummary, expireRewards } from '../modules/loyalty/loyalty.service.js';
import { providerStatus } from '../modules/notifications/notifications.service.js';

export const manageRouter = Router();
manageRouter.use(authenticate, requireRole('ADMIN', 'MANAGER'));

const isoDate = z.string().refine(isIsoDate, 'Expected YYYY-MM-DD');
const minute = z.number().int().min(0).max(1440);
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const changed = (employeeIds: string[]) => emitAvailabilityChanged({ dates: [], employeeIds });

// =====================================================================
// Uploads (images only)
// =====================================================================
// Two storage backends:
//  - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (required on Vercel: function filesystems are read-only/ephemeral)
//  - local disk (server/uploads) otherwise, for local development / classic servers
export const UPLOAD_DIR = path.resolve('uploads');
const useBlob = !!env.BLOB_READ_WRITE_TOKEN;
// Vercel caps request bodies at 4.5 MB, so keep uploads under it there
const MAX_UPLOAD = isVercel ? 4 * 1024 * 1024 : 5 * 1024 * 1024;
const uploadName = (original: string) => `${Date.now()}-${randomBytes(6).toString('hex')}${path.extname(original).toLowerCase()}`;
const upload = multer({
  storage: useBlob
    ? multer.memoryStorage()
    : multer.diskStorage({
        // created lazily on first upload (never at import time, which would crash on a read-only filesystem)
        destination: (_req, _file, cb) => mkdir(UPLOAD_DIR, { recursive: true }).then(() => cb(null, UPLOAD_DIR), (e) => cb(e as Error, UPLOAD_DIR)),
        filename: (_req, file, cb) => cb(null, uploadName(file.originalname)),
      }),
  limits: { fileSize: MAX_UPLOAD },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|avif)$/.test(file.mimetype)),
});
const uploadGuard = (_req: unknown, _res: unknown, next: () => void) => {
  if (isVercel && !useBlob) throw new AppError(503, 'UPLOADS_NOT_CONFIGURED', 'Image uploads need Vercel Blob: add BLOB_READ_WRITE_TOKEN to the project environment variables');
  next();
};
manageRouter.post('/uploads', requirePermission('services.manage'), uploadGuard, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest(`An image file (jpeg, png, webp, avif — max ${MAX_UPLOAD / 1024 / 1024} MB) is required`);
  if (useBlob) {
    const blob = await put(`uploads/${uploadName(req.file.originalname)}`, req.file.buffer, { access: 'public', contentType: req.file.mimetype, token: env.BLOB_READ_WRITE_TOKEN });
    return res.status(201).json({ url: blob.url });
  }
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// =====================================================================
// Employees & schedules
// =====================================================================
const employeeInclude = {
  services: { select: { serviceId: true } },
  workingHours: { orderBy: { weekday: 'asc' as const } },
  breaks: { orderBy: [{ weekday: 'asc' as const }, { startMinute: 'asc' as const }] },
  absences: { orderBy: { startDate: 'desc' as const } },
  exceptions: { orderBy: { date: 'desc' as const } },
  user: { select: { email: true, isActive: true } },
};
type EmpWithAll = Awaited<ReturnType<typeof loadEmployee>>;
async function loadEmployee(id: string) {
  const e = await prisma.employee.findUnique({ where: { id }, include: employeeInclude });
  if (!e) throw notFound('Employee');
  return e;
}
const employeeDto = (e: EmpWithAll) => ({
  ...e,
  services: e.services.map((s) => s.serviceId),
  absences: e.absences.map((a) => ({ ...a, startDate: fromDbDate(a.startDate), endDate: fromDbDate(a.endDate) })),
  exceptions: e.exceptions.map((x) => ({ ...x, date: fromDbDate(x.date) })),
});

manageRouter.get('/employees', requirePermission('availability.view'), async (_req, res) => {
  const list = await prisma.employee.findMany({ include: employeeInclude, orderBy: [{ sortOrder: 'asc' }, { firstName: 'asc' }] });
  res.json(list.map(employeeDto));
});
manageRouter.get('/employees/:id', requirePermission('availability.view'), async (req, res) => res.json(employeeDto(await loadEmployee((req.params.id as string)))));

const employeeSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).default(''),
  title: z.string().max(80).nullish(),
  bio: z.string().max(1000).nullish(),
  photoUrl: z.string().max(500).nullish(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  serviceIds: z.array(z.string()).optional(),
  // optional login account for the employee dashboard
  account: z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).optional(), role: z.enum(['EMPLOYEE', 'MANAGER']).default('EMPLOYEE') }).optional(),
});

async function upsertEmployeeAccount(employeeId: string, account: NonNullable<z.infer<typeof employeeSchema>['account']>, actorRole: string) {
  if (account.role === 'MANAGER' && actorRole !== 'ADMIN') throw badRequest('Only administrators can create manager accounts');
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const role = await prisma.role.findUniqueOrThrow({ where: { name: account.role } });
  const clash = await prisma.user.findUnique({ where: { email: account.email } });
  if (clash && clash.id !== emp.userId) throw conflict('This email is already used', 'EMAIL_TAKEN');
  if (emp.userId) {
    await prisma.user.update({ where: { id: emp.userId }, data: { email: account.email, roleId: role.id, ...(account.password ? { passwordHash: await bcrypt.hash(account.password, 12) } : {}) } });
  } else {
    if (!account.password) throw badRequest('A password is required to create the employee account');
    const u = await prisma.user.create({ data: { email: account.email, passwordHash: await bcrypt.hash(account.password, 12), roleId: role.id } });
    await prisma.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
  }
}

manageRouter.post('/employees', requirePermission('employees.manage'), async (req, res) => {
  const b = parse(employeeSchema, req.body);
  const { serviceIds, account, ...data } = b;
  const e = await prisma.employee.create({ data: { ...data, services: serviceIds ? { create: serviceIds.map((serviceId) => ({ serviceId })) } : undefined } });
  if (account) await upsertEmployeeAccount(e.id, account, req.user!.role);
  await audit({ actorUserId: req.user!.id, action: 'EMPLOYEE_CREATED', entityType: 'Employee', entityId: e.id, ip: req.ip });
  res.status(201).json(employeeDto(await loadEmployee(e.id)));
});

manageRouter.patch('/employees/:id', requirePermission('employees.manage'), async (req, res) => {
  const b = parse(employeeSchema.partial(), req.body);
  const { serviceIds, account, ...data } = b;
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: (req.params.id as string) }, data: { ...data, ...(data.firstName || data.lastName ? { isDemo: false } : {}) } });
    if (serviceIds) {
      await tx.employeeService.deleteMany({ where: { employeeId: (req.params.id as string) } });
      await tx.employeeService.createMany({ data: serviceIds.map((serviceId) => ({ employeeId: (req.params.id as string), serviceId })) });
    }
  });
  if (account) await upsertEmployeeAccount((req.params.id as string), account, req.user!.role);
  await audit({ actorUserId: req.user!.id, action: 'EMPLOYEE_UPDATED', entityType: 'Employee', entityId: (req.params.id as string), details: Object.keys(b), ip: req.ip });
  changed([(req.params.id as string)]);
  res.json(employeeDto(await loadEmployee((req.params.id as string))));
});

/** Replace the full weekly schedule (working hours + breaks) */
manageRouter.put('/employees/:id/schedule', requirePermission('employees.manage'), async (req, res) => {
  const day = z.object({ weekday: z.number().int().min(1).max(7), startMinute: minute, endMinute: minute });
  const b = parse(z.object({ workingHours: z.array(day), breaks: z.array(day.extend({ label: z.string().max(40).optional() })) }), req.body);
  for (const x of [...b.workingHours, ...b.breaks]) if (x.endMinute <= x.startMinute) throw badRequest('End time must be after start time');
  if (new Set(b.workingHours.map((w) => w.weekday)).size !== b.workingHours.length) throw badRequest('One working period per weekday');
  const id = (req.params.id as string);
  await prisma.$transaction([
    prisma.workingHour.deleteMany({ where: { employeeId: id } }),
    prisma.break.deleteMany({ where: { employeeId: id } }),
    prisma.workingHour.createMany({ data: b.workingHours.map((w) => ({ ...w, employeeId: id })) }),
    prisma.break.createMany({ data: b.breaks.map((w) => ({ ...w, label: w.label ?? 'Break', employeeId: id })) }),
  ]);
  await audit({ actorUserId: req.user!.id, action: 'SCHEDULE_UPDATED', entityType: 'Employee', entityId: id, details: b, ip: req.ip });
  changed([id]);
  res.json(employeeDto(await loadEmployee(id)));
});

manageRouter.post('/employees/:id/absences', requirePermission('employees.manage'), async (req, res) => {
  const b = parse(z.object({ type: z.enum(['VACATION', 'SICK', 'HOLIDAY', 'PERSONAL', 'TRAINING', 'OTHER']), startDate: isoDate, endDate: isoDate, reason: z.string().max(200).optional() }), req.body);
  if (b.endDate < b.startDate) throw badRequest('End date must be on or after start date');
  const a = await prisma.employeeAbsence.create({ data: { employeeId: (req.params.id as string), type: b.type, startDate: toDbDate(b.startDate), endDate: toDbDate(b.endDate), reason: b.reason } });
  // Inform the manager about appointments that now collide with the absence (they are NOT silently cancelled)
  const settings = await getSettings();
  const conflicts = await prisma.appointment.count({
    where: { employeeId: (req.params.id as string), status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: new Date(`${b.startDate}T00:00:00Z`), lt: new Date(new Date(`${b.endDate}T00:00:00Z`).getTime() + 86_400_000 + 3600_000) } },
  });
  await audit({ actorUserId: req.user!.id, action: 'ABSENCE_CREATED', entityType: 'Employee', entityId: (req.params.id as string), details: b, ip: req.ip });
  changed([(req.params.id as string)]);
  res.status(201).json({ absence: a, conflictingAppointments: conflicts, timezone: settings.timezone });
});
manageRouter.delete('/employees/:id/absences/:absenceId', requirePermission('employees.manage'), async (req, res) => {
  await prisma.employeeAbsence.delete({ where: { id: (req.params.absenceId as string), employeeId: (req.params.id as string) } });
  await audit({ actorUserId: req.user!.id, action: 'ABSENCE_DELETED', entityType: 'Employee', entityId: (req.params.id as string), ip: req.ip });
  changed([(req.params.id as string)]);
  res.status(204).end();
});

manageRouter.post('/employees/:id/exceptions', requirePermission('employees.manage'), async (req, res) => {
  const b = parse(z.object({ date: isoDate, type: z.enum(['CUSTOM_HOURS', 'UNAVAILABLE']), startMinute: minute.nullish(), endMinute: minute.nullish(), reason: z.string().max(200).optional() }), req.body);
  if (b.type === 'CUSTOM_HOURS' && (b.startMinute == null || b.endMinute == null)) throw badRequest('Custom hours need a start and end time');
  if (b.startMinute != null && b.endMinute != null && b.endMinute <= b.startMinute) throw badRequest('End time must be after start time');
  const x = await prisma.availabilityException.create({ data: { employeeId: (req.params.id as string), date: toDbDate(b.date), type: b.type, startMinute: b.startMinute ?? null, endMinute: b.endMinute ?? null, reason: b.reason } });
  await audit({ actorUserId: req.user!.id, action: 'EXCEPTION_CREATED', entityType: 'Employee', entityId: (req.params.id as string), details: b, ip: req.ip });
  emitAvailabilityChanged({ dates: [b.date], employeeIds: [(req.params.id as string)] });
  res.status(201).json(x);
});
manageRouter.delete('/employees/:id/exceptions/:exceptionId', requirePermission('employees.manage'), async (req, res) => {
  await prisma.availabilityException.delete({ where: { id: (req.params.exceptionId as string), employeeId: (req.params.id as string) } });
  changed([(req.params.id as string)]);
  res.status(204).end();
});

// Salon-wide closures & opening hours
manageRouter.get('/closures', async (_req, res) => {
  res.json((await prisma.salonClosure.findMany({ orderBy: { date: 'asc' } })).map((c) => ({ ...c, date: fromDbDate(c.date) })));
});
manageRouter.post('/closures', requirePermission('settings.manage'), async (req, res) => {
  const b = parse(z.object({ date: isoDate, reason: z.string().max(200).optional() }), req.body);
  const c = await prisma.salonClosure.upsert({ where: { date: toDbDate(b.date) }, update: { reason: b.reason }, create: { date: toDbDate(b.date), reason: b.reason } });
  emitAvailabilityChanged({ dates: [b.date], employeeIds: [] });
  res.status(201).json({ ...c, date: b.date });
});
manageRouter.delete('/closures/:id', requirePermission('settings.manage'), async (req, res) => {
  await prisma.salonClosure.delete({ where: { id: (req.params.id as string) } });
  changed([]);
  res.status(204).end();
});
manageRouter.put('/opening-hours', requirePermission('settings.manage'), async (req, res) => {
  const b = parse(z.array(z.object({ weekday: z.number().int().min(1).max(7), isClosed: z.boolean(), openMinute: minute, closeMinute: minute })).length(7), req.body);
  for (const d of b) if (!d.isClosed && d.closeMinute <= d.openMinute) throw badRequest('Closing time must be after opening time');
  await prisma.$transaction(b.map((d) => prisma.openingHour.upsert({ where: { weekday: d.weekday }, update: d, create: d })));
  await audit({ actorUserId: req.user!.id, action: 'OPENING_HOURS_UPDATED', entityType: 'SalonSettings', details: b, ip: req.ip });
  changed([]);
  res.json(await prisma.openingHour.findMany({ orderBy: { weekday: 'asc' } }));
});

// =====================================================================
// Services & categories
// =====================================================================
manageRouter.get('/services', async (_req, res) => {
  const list = await prisma.service.findMany({ include: { category: true, employees: { select: { employeeId: true } }, _count: { select: { appointments: true } } }, orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }] });
  res.json(list.map((s) => ({ ...s, priceMad: num(s.priceMad), priceMaxMad: s.priceMaxMad == null ? null : num(s.priceMaxMad), employees: s.employees.map((e) => e.employeeId), appointmentCount: s._count.appointments })));
});

const serviceSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  description: z.string().max(1000).nullish(),
  priceMad: z.number().min(0).max(100000),
  priceMaxMad: z.number().min(0).max(100000).nullish(),
  durationMinutes: z.number().int().min(5).max(600),
  imageUrl: z.string().max(500).nullish(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  employeeIds: z.array(z.string()).optional(),
});
manageRouter.post('/services', requirePermission('services.manage'), async (req, res) => {
  const b = parse(serviceSchema, req.body);
  const { employeeIds, priceMad, priceMaxMad, ...data } = b;
  if (priceMaxMad != null && priceMaxMad < priceMad) throw badRequest('The maximum price must be at least the minimum price');
  let slug = slugify(b.name);
  if (await prisma.service.findUnique({ where: { slug } })) slug += '-' + randomBytes(2).toString('hex');
  const s = await prisma.service.create({ data: { ...data, slug, priceMad: dec(priceMad), priceMaxMad: priceMaxMad == null ? null : dec(priceMaxMad), employees: employeeIds ? { create: employeeIds.map((employeeId) => ({ employeeId })) } : undefined } });
  await audit({ actorUserId: req.user!.id, action: 'SERVICE_CREATED', entityType: 'Service', entityId: s.id, details: { name: s.name, priceMad }, ip: req.ip });
  res.status(201).json({ ...s, priceMad: num(s.priceMad) });
});
manageRouter.patch('/services/:id', requirePermission('services.manage'), async (req, res) => {
  const b = parse(serviceSchema.partial(), req.body);
  const { employeeIds, priceMad, priceMaxMad, ...data } = b;
  const before = await prisma.service.findUnique({ where: { id: (req.params.id as string) } });
  if (!before) throw notFound('Service');
  const s = await prisma.$transaction(async (tx) => {
    const u = await tx.service.update({ where: { id: (req.params.id as string) }, data: { ...data, isDemo: false, ...(priceMad != null ? { priceMad: dec(priceMad) } : {}), ...(priceMaxMad !== undefined ? { priceMaxMad: priceMaxMad == null ? null : dec(priceMaxMad) } : {}) } });
    if (employeeIds) {
      await tx.employeeService.deleteMany({ where: { serviceId: u.id } });
      await tx.employeeService.createMany({ data: employeeIds.map((employeeId) => ({ serviceId: u.id, employeeId })) });
    }
    return u;
  });
  await audit({ actorUserId: req.user!.id, action: 'SERVICE_UPDATED', entityType: 'Service', entityId: s.id, details: { ...b, previousPrice: num(before.priceMad) }, ip: req.ip });
  changed([]);
  res.json({ ...s, priceMad: num(s.priceMad) });
});
manageRouter.delete('/services/:id', requirePermission('services.manage'), async (req, res) => {
  const used = await prisma.appointment.count({ where: { serviceId: (req.params.id as string) } });
  if (used) {
    // keep history intact: deactivate instead of deleting
    await prisma.service.update({ where: { id: (req.params.id as string) }, data: { isActive: false } });
    await audit({ actorUserId: req.user!.id, action: 'SERVICE_DEACTIVATED', entityType: 'Service', entityId: (req.params.id as string), ip: req.ip });
    return res.json({ deleted: false, deactivated: true, reason: `Service has ${used} appointment(s) in history` });
  }
  await prisma.service.delete({ where: { id: (req.params.id as string) } });
  await audit({ actorUserId: req.user!.id, action: 'SERVICE_DELETED', entityType: 'Service', entityId: (req.params.id as string), ip: req.ip });
  res.json({ deleted: true });
});

manageRouter.get('/categories', async (_req, res) => {
  res.json(await prisma.serviceCategory.findMany({ include: { _count: { select: { services: true } } }, orderBy: { sortOrder: 'asc' } }));
});
const categorySchema = z.object({ name: z.string().trim().min(2).max(60), description: z.string().max(300).nullish(), sortOrder: z.number().int().optional() });
manageRouter.post('/categories', requirePermission('services.manage'), async (req, res) => {
  const b = parse(categorySchema, req.body);
  res.status(201).json(await prisma.serviceCategory.create({ data: { ...b, slug: slugify(b.name) } }));
});
manageRouter.patch('/categories/:id', requirePermission('services.manage'), async (req, res) => {
  const b = parse(categorySchema.partial(), req.body);
  res.json(await prisma.serviceCategory.update({ where: { id: (req.params.id as string) }, data: { ...b, ...(b.name ? { slug: slugify(b.name) } : {}) } }));
});
manageRouter.delete('/categories/:id', requirePermission('services.manage'), async (req, res) => {
  if (await prisma.service.count({ where: { categoryId: (req.params.id as string) } })) throw conflict('Move or delete the services of this category first', 'CATEGORY_IN_USE');
  await prisma.serviceCategory.delete({ where: { id: (req.params.id as string) } });
  res.status(204).end();
});

// =====================================================================
// Loyalty
// =====================================================================
manageRouter.get('/loyalty/overview', requirePermission('loyalty.manage'), async (_req, res) => {
  await expireRewards();
  const settings = await getSettings();
  const rules = await prisma.loyaltyRule.findMany({ orderBy: { stampsRequired: 'asc' } });
  const [cards, byStatus, totals] = await Promise.all([
    prisma.loyaltyCard.count(),
    prisma.loyaltyReward.groupBy({ by: ['status'], _count: true }),
    prisma.loyaltyStamp.groupBy({ by: ['cardId'], where: { revokedAt: null }, _sum: { value: true } }),
  ]);
  const active = rules.filter((r) => r.isActive);
  const cycle = Math.max(settings.loyaltyCycleStamps, ...active.map((r) => r.stampsRequired), 1);
  // "close to a reward": within 2 stamps of the next milestone
  const close = totals
    .map((t) => {
      const inCycle = (t._sum.value ?? 0) % cycle;
      const next = active.find((r) => r.stampsRequired > inCycle);
      return next && next.stampsRequired - inCycle <= 2 ? { cardId: t.cardId, remaining: next.stampsRequired - inCycle, reward: next.discountPercent } : null;
    })
    .filter(Boolean) as { cardId: string; remaining: number; reward: number }[];
  const closeCards = await prisma.loyaltyCard.findMany({ where: { id: { in: close.map((c) => c.cardId) } }, include: { customer: { select: { id: true, fullName: true, customerNumber: true } } } });
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0;
  const recent = await prisma.rewardRedemption.findMany({ include: { reward: true, appointment: { select: { reference: true, customer: { select: { fullName: true, id: true } } } } }, orderBy: { createdAt: 'desc' }, take: 20 });
  res.json({
    settings: { loyaltyEnabled: settings.loyaltyEnabled, loyaltyCycleStamps: settings.loyaltyCycleStamps, loyaltyCardSlots: settings.loyaltyCardSlots, stampsPerVisit: settings.stampsPerVisit },
    rules,
    stats: { cards, unlocked: count('AVAILABLE') + count('REDEEMED') + count('EXPIRED'), available: count('AVAILABLE'), redeemed: count('REDEEMED'), expired: count('EXPIRED'), closeToReward: close.length },
    closeToReward: close.map((c) => ({ ...c, customer: closeCards.find((x) => x.id === c.cardId)?.customer })),
    redemptions: recent.map((r) => ({ id: r.id, createdAt: r.createdAt, discountPercent: r.reward.discountPercent, discountMad: num(r.discountAmountMad), reference: r.appointment.reference, customer: r.appointment.customer })),
  });
});

const ruleSchema = z.object({ name: z.string().trim().min(2).max(60), stampsRequired: z.number().int().min(1).max(100), discountPercent: z.number().int().min(1).max(100), validityDays: z.number().int().min(1).max(3650).nullable(), isActive: z.boolean().default(true) });
manageRouter.post('/loyalty/rules', requirePermission('loyalty.manage'), async (req, res) => {
  const b = parse(ruleSchema, req.body);
  const r = await prisma.loyaltyRule.create({ data: b });
  await audit({ actorUserId: req.user!.id, action: 'LOYALTY_RULE_CREATED', entityType: 'LoyaltyRule', entityId: r.id, details: b, ip: req.ip });
  res.status(201).json(r);
});
manageRouter.patch('/loyalty/rules/:id', requirePermission('loyalty.manage'), async (req, res) => {
  const b = parse(ruleSchema.partial(), req.body);
  const r = await prisma.loyaltyRule.update({ where: { id: (req.params.id as string) }, data: b });
  await audit({ actorUserId: req.user!.id, action: 'LOYALTY_RULE_UPDATED', entityType: 'LoyaltyRule', entityId: r.id, details: b, ip: req.ip });
  res.json(r);
});
manageRouter.delete('/loyalty/rules/:id', requirePermission('loyalty.manage'), async (req, res) => {
  const issued = await prisma.loyaltyReward.count({ where: { ruleId: (req.params.id as string) } });
  if (issued) {
    await prisma.loyaltyRule.update({ where: { id: (req.params.id as string) }, data: { isActive: false } });
    return res.json({ deleted: false, deactivated: true });
  }
  await prisma.loyaltyRule.delete({ where: { id: (req.params.id as string) } });
  await audit({ actorUserId: req.user!.id, action: 'LOYALTY_RULE_DELETED', entityType: 'LoyaltyRule', entityId: (req.params.id as string), ip: req.ip });
  res.json({ deleted: true });
});

manageRouter.get('/loyalty/customers/:customerId', requirePermission('loyalty.manage'), async (req, res) => res.json(await cardSummary((req.params.customerId as string))));
manageRouter.post('/loyalty/customers/:customerId/stamps', requirePermission('loyalty.manage'), async (req, res) => {
  const b = parse(z.object({ delta: z.number().int(), reason: z.string().trim().min(3).max(200) }), req.body);
  const r = await adjustStamps((req.params.customerId as string), b.delta, b.reason, req.user!.id, req.ip);
  res.json({ ...(await cardSummary((req.params.customerId as string))), newRewards: r.rewards.length });
});
manageRouter.patch('/loyalty/rewards/:id', requirePermission('loyalty.manage'), async (req, res) => {
  const b = parse(z.object({ expiresAt: z.string().datetime({ offset: true }).nullable() }), req.body);
  const r = await prisma.loyaltyReward.findUnique({ where: { id: (req.params.id as string) } });
  if (!r) throw notFound('Reward');
  if (r.status === 'REDEEMED') throw conflict('A redeemed reward cannot be modified', 'REWARD_REDEEMED');
  const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
  const u = await prisma.loyaltyReward.update({ where: { id: r.id }, data: { expiresAt, status: expiresAt && expiresAt < new Date() ? 'EXPIRED' : 'AVAILABLE' } });
  await audit({ actorUserId: req.user!.id, action: 'REWARD_EXPIRY_CHANGED', entityType: 'LoyaltyReward', entityId: r.id, details: { from: r.expiresAt, to: expiresAt }, ip: req.ip });
  res.json(u);
});

// =====================================================================
// Settings
// =====================================================================
manageRouter.get('/settings', requirePermission('settings.manage'), async (_req, res) => {
  const [s, opening, closures] = await Promise.all([getSettings(), prisma.openingHour.findMany({ orderBy: { weekday: 'asc' } }), prisma.salonClosure.findMany({ where: { date: { gte: toDbDate(todayLocal()) } }, orderBy: { date: 'asc' } })]);
  res.json({ settings: s, openingHours: opening, closures: closures.map((c) => ({ ...c, date: fromDbDate(c.date) })), integrations: providerStatus() });
});
const settingsSchema = z.object({
  name: z.string().min(2).max(80), tagline: z.string().max(160).nullish(), logoUrl: z.string().max(500).nullish(), address: z.string().max(200).nullish(), city: z.string().max(80),
  phone: z.string().max(30).nullish(), email: z.string().email().nullish().or(z.literal('')), instagram: z.string().max(80).nullish(),
  currency: z.string().length(3), timezone: z.string().refine((tz) => { try { Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'),
  slotIntervalMinutes: z.number().int().min(5).max(120), bufferMinutes: z.number().int().min(0).max(120), minNoticeMinutes: z.number().int().min(0).max(10080),
  maxAdvanceDays: z.number().int().min(1).max(365), autoConfirmOnline: z.boolean(), allowOnlineCancellation: z.boolean(), cancellationNoticeHours: z.number().int().min(0).max(720),
  cancellationPolicyText: z.string().max(2000).nullish(), loyaltyEnabled: z.boolean(), loyaltyCycleStamps: z.number().int().min(1).max(200), loyaltyCardSlots: z.number().int().min(4).max(20),
  stampsPerVisit: z.number().int().min(1).max(10), employeesCanComplete: z.boolean(),
}).partial();
manageRouter.patch('/settings', requirePermission('settings.manage'), async (req, res) => {
  const b = parse(settingsSchema, req.body);
  await getSettings();
  const s = await prisma.salonSettings.update({ where: { id: 1 }, data: { ...b, ...(b.email === '' ? { email: null } : {}) } });
  await audit({ actorUserId: req.user!.id, action: 'SETTINGS_UPDATED', entityType: 'SalonSettings', entityId: '1', details: b, ip: req.ip });
  changed([]);
  res.json(s);
});

// =====================================================================
// Notifications & audit
// =====================================================================
manageRouter.get('/notifications', requirePermission('notifications.view'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED', 'SKIPPED']).optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const where = q.status ? { status: q.status } : {};
  const [total, items, byStatus] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, include: { customer: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 30, take: 30 }),
    prisma.notification.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({ total, items, byStatus, integrations: providerStatus() });
});

manageRouter.get('/audit-logs', requirePermission('audit.view'), async (req, res) => {
  const q = parse(z.object({ entityType: z.string().optional(), entityId: z.string().optional(), page: z.coerce.number().int().min(1).default(1) }), req.query);
  const where = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
  const [total, items] = await Promise.all([prisma.auditLog.count({ where }), prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50 })]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.actorUserId).filter(Boolean))] as string[] } }, select: { id: true, email: true } });
  res.json({ total, items: items.map((i) => ({ ...i, actor: users.find((u) => u.id === i.actorUserId)?.email ?? null })) });
});

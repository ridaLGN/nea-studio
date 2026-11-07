import bcrypt from 'bcryptjs';
import request from 'supertest';
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/core.js';
import { createApp } from '../src/app.js';
import { seedBase } from '../prisma/seed.js';
import { localToUtc } from '../src/lib/time.js';

export const app = createApp();
export const TZ = 'Africa/Casablanca';
export const PASSWORD = 'Test-Password-123';

/** A Monday at least 3 days in the future (so notice periods never interfere). */
export function nextMonday(): string {
  let d = DateTime.now().setZone(TZ).plus({ days: 3 }).startOf('day');
  while (d.weekday !== 1) d = d.plus({ days: 1 });
  return d.toISODate()!;
}
export const at = (date: string, hhmm: string) => localToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
export const todayStr = () => DateTime.now().setZone(TZ).toISODate()!;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  process.env.SEED_ADMIN_PASSWORD = PASSWORD;
  process.env.SEED_ADMIN_EMAIL = 'admin@test.local';
  await seedBase(prisma);
  await prisma.salonSettings.update({ where: { id: 1 }, data: { minNoticeMinutes: 60, slotIntervalMinutes: 15, bufferMinutes: 0, cancellationNoticeHours: 24 } });
  // salon open every day 09:00–20:00 for deterministic tests
  await prisma.openingHour.updateMany({ data: { isClosed: false, openMinute: 540, closeMinute: 1200 } });
}

export async function fixtures() {
  await resetDb();
  const cat = await prisma.serviceCategory.create({ data: { name: 'Hair', slug: 'hair' } });
  const cut = await prisma.service.create({ data: { name: 'Cut', slug: 'cut', categoryId: cat.id, priceMad: new Prisma.Decimal(200), durationMinutes: 60 } });
  const nails = await prisma.service.create({ data: { name: 'Nails', slug: 'nails', categoryId: cat.id, priceMad: new Prisma.Decimal(100), durationMinutes: 30 } });
  const role = async (n: string) => (await prisma.role.findUniqueOrThrow({ where: { name: n } })).id;
  const hash = await bcrypt.hash(PASSWORD, 4);
  const mkEmployee = async (first: string, services: string[]) => {
    const user = await prisma.user.create({ data: { email: `${first.toLowerCase()}@test.local`, passwordHash: hash, roleId: await role('EMPLOYEE') } });
    return prisma.employee.create({
      data: {
        firstName: first, lastName: 'Test', userId: user.id,
        services: { create: services.map((serviceId) => ({ serviceId })) },
        // every day 10:00–18:00, lunch 13:00–14:00
        workingHours: { create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 600, endMinute: 1080 })) },
        breaks: { create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 780, endMinute: 840 })) },
      },
    });
  };
  const alice = await mkEmployee('Alice', [cut.id, nails.id]);
  const bea = await mkEmployee('Bea', [cut.id]);
  const nailsOnly = await mkEmployee('Nora', [nails.id]);
  const customerUser = await prisma.user.create({ data: { email: 'client@test.local', passwordHash: hash, roleId: await role('CUSTOMER') } });
  const customer = await prisma.customer.create({ data: { fullName: 'Client One', phone: '+212600000001', customerNumber: 'NC-TEST01', qrToken: 'qr-token-client-one-xxxxxxxx', userId: customerUser.id } });
  const other = await prisma.customer.create({ data: { fullName: 'Client Two', phone: '+212600000002', customerNumber: 'NC-TEST02', qrToken: 'qr-token-client-two-xxxxxxxx' } });
  return { cut, nails, alice, bea, nailsOnly, customer, other };
}

export async function login(email: string, password = PASSWORD) {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export const bookingBody = (serviceId: string, employeeId: string | null, startAt: Date, phone = '0600000099') => ({
  serviceId, employeeId, startAt: startAt.toISOString(), customer: { fullName: 'Walk In', phone, email: '' },
});

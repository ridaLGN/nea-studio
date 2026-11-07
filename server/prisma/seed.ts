/**
 * Seed: roles/permissions, salon settings, admin account — and clearly flagged DEMO data
 * (isDemo = true) so the system can be explored before real salon data is entered.
 *
 *   npm run db:seed             -> base data + demo data (demo only if no employees exist yet)
 *   SEED_DEMO=false npm run db:seed  -> base data only (production)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { randomBytes, randomInt } from 'node:crypto';

const prisma = new PrismaClient();
const TZ = 'Africa/Casablanca';

export const PERMISSIONS: Record<string, string> = {
  'dashboard.view': 'View management dashboard',
  'availability.view': 'View the real-time availability dashboard & search engine',
  'appointments.view_all': 'View every appointment',
  'appointments.manage': 'Create, edit, reschedule and cancel appointments',
  'appointments.complete': 'Validate (complete) appointments',
  'customers.view': 'View customer database',
  'customers.manage': 'Create and edit customers',
  'employees.manage': 'Manage employees, schedules and absences',
  'services.manage': 'Manage services, categories and prices',
  'loyalty.manage': 'Configure loyalty rules and adjust stamps',
  'settings.manage': 'Edit business settings',
  'analytics.view': 'View revenue and business analytics',
  'notifications.view': 'View notification logs',
  'audit.view': 'View audit logs',
  'qr.scan': 'Scan customer QR codes and look up customers',
};
const ALL = Object.keys(PERMISSIONS);
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN: ALL,
  MANAGER: ALL.filter((p) => p !== 'settings.manage' && p !== 'audit.view'),
  EMPLOYEE: ['qr.scan', 'appointments.complete'],
  CUSTOMER: [],
};

const code = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join('');

export async function seedBase(db: PrismaClient = prisma) {
  for (const [key, description] of Object.entries(PERMISSIONS)) await db.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  for (const [name, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await db.role.upsert({ where: { name }, update: {}, create: { name, description: `${name.toLowerCase()} role` } });
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    const ids = await db.permission.findMany({ where: { key: { in: perms } } });
    await db.rolePermission.createMany({ data: ids.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  }
  await db.salonSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'NÉA STUDIO',
      tagline: 'Beauty & wellbeing studio — Marrakech',
      city: 'Marrakech',
      address: 'Address to be configured in Settings',
      cancellationPolicyText: 'Appointments can be cancelled or rescheduled free of charge up to 24 hours in advance. Within 24 hours, please call the salon.',
    },
  });
  // Opening hours (DEMO defaults — edit in Settings): Mon–Sat 09:30–20:00, Sunday closed
  for (let wd = 1; wd <= 7; wd++)
    await db.openingHour.upsert({ where: { weekday: wd }, update: {}, create: { weekday: wd, isClosed: wd === 7, openMinute: 570, closeMinute: 1200 } });

  if ((await db.loyaltyRule.count()) === 0) {
    await db.loyaltyRule.createMany({
      data: [
        { name: 'Card complete', stampsRequired: 8, discountPercent: 20, validityDays: 90 },
        { name: 'Second card complete', stampsRequired: 16, discountPercent: 50, validityDays: 90 },
      ],
    });
  }

  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@neastudio.demo').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD must be set');
  const adminRole = await db.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash: await bcrypt.hash(password, 12), roleId: adminRole.id } });
}

async function seedDemo() {
  if ((await prisma.employee.count()) > 0) {
    console.log('Employees already exist — demo data skipped.');
    return;
  }
  const role = async (n: string) => (await prisma.role.findUniqueOrThrow({ where: { name: n } })).id;
  const staffPwd = await bcrypt.hash('NeaStaff!2026', 12);

  const cats = await Promise.all(
    [
      { name: 'Hair', slug: 'hair', description: 'Cuts, colour and styling', sortOrder: 1 },
      { name: 'Nails', slug: 'nails', description: 'Manicure and pedicure', sortOrder: 2 },
      { name: 'Skin care', slug: 'skin-care', description: 'Facials and treatments', sortOrder: 3 },
      { name: 'Make-up', slug: 'make-up', description: 'Make-up for every occasion', sortOrder: 4 },
    ].map((c) => prisma.serviceCategory.create({ data: c })),
  );
  const cat = (slug: string) => cats.find((c) => c.slug === slug)!.id;
  const DEMO = 'Demo service — replace with the salon’s real description and price.';
  const services = await Promise.all(
    [
      { name: 'Blow-dry', cat: 'hair', price: 150, dur: 45 },
      { name: 'Cut & blow-dry', cat: 'hair', price: 250, dur: 60 },
      { name: 'Colour', cat: 'hair', price: 450, dur: 120 },
      { name: 'Hair treatment', cat: 'hair', price: 300, dur: 60 },
      { name: 'Classic manicure', cat: 'nails', price: 120, dur: 45 },
      { name: 'Semi-permanent polish', cat: 'nails', price: 200, dur: 60 },
      { name: 'Pedicure', cat: 'nails', price: 180, dur: 60 },
      { name: 'Signature facial', cat: 'skin-care', price: 400, dur: 75 },
      { name: 'Express facial', cat: 'skin-care', price: 250, dur: 45 },
      { name: 'Event make-up', cat: 'make-up', price: 350, dur: 60 },
    ].map((s, i) =>
      prisma.service.create({
        data: { name: s.name, slug: s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), categoryId: cat(s.cat), priceMad: new Prisma.Decimal(s.price), durationMinutes: s.dur, description: DEMO, sortOrder: i, isDemo: true },
      }),
    ),
  );
  const svc = (name: string) => services.find((s) => s.name === name)!;

  const team = [
    { firstName: 'Salma', lastName: 'Demo', title: 'Senior hair stylist', color: '#783D43', off: 1, services: ['Blow-dry', 'Cut & blow-dry', 'Colour', 'Hair treatment'] },
    { firstName: 'Imane', lastName: 'Demo', title: 'Hair & make-up artist', color: '#A0674B', off: 3, services: ['Blow-dry', 'Cut & blow-dry', 'Event make-up'] },
    { firstName: 'Nadia', lastName: 'Demo', title: 'Nail technician', color: '#8C7A6B', off: 2, services: ['Classic manicure', 'Semi-permanent polish', 'Pedicure'] },
    { firstName: 'Yasmine', lastName: 'Demo', title: 'Aesthetician', color: '#5E4B43', off: 4, services: ['Signature facial', 'Express facial', 'Event make-up', 'Classic manicure'] },
  ];
  const employees = [];
  for (const [i, t] of team.entries()) {
    const user = await prisma.user.create({ data: { email: `${t.firstName.toLowerCase()}@neastudio.demo`, passwordHash: staffPwd, roleId: await role(i === 0 ? 'MANAGER' : 'EMPLOYEE') } });
    const e = await prisma.employee.create({
      data: {
        firstName: t.firstName, lastName: t.lastName, title: t.title, color: t.color, sortOrder: i, isDemo: true, userId: user.id,
        bio: 'Demo profile — replace with the real team member.',
        services: { create: t.services.map((n) => ({ serviceId: svc(n).id })) },
        // Works Mon–Sat except their weekly day off; 10:00–19:00 with a 13:00–14:00 lunch break
        workingHours: { create: [1, 2, 3, 4, 5, 6].filter((d) => d !== t.off).map((weekday) => ({ weekday, startMinute: 600, endMinute: 1140 })) },
        breaks: { create: [1, 2, 3, 4, 5, 6].filter((d) => d !== t.off).map((weekday) => ({ weekday, startMinute: 780, endMinute: 840, label: 'Lunch' })) },
      },
    });
    employees.push({ ...e, services: t.services });
  }
  // A demo absence next week for one employee
  const today = DateTime.now().setZone(TZ).startOf('day');
  const nextWeek = today.plus({ days: 7 });
  await prisma.employeeAbsence.create({ data: { employeeId: employees[2].id, type: 'VACATION', startDate: new Date(nextWeek.toISODate() + 'T00:00:00Z'), endDate: new Date(nextWeek.plus({ days: 2 }).toISODate() + 'T00:00:00Z'), reason: 'Demo absence' } });

  const names = ['Amina B.', 'Leila K.', 'Sofia M.', 'Hiba R.', 'Meryem T.', 'Kenza A.', 'Ghita E.', 'Rania L.', 'Zineb O.', 'Sara H.', 'Lina F.', 'Nour D.'];
  const customers = [];
  for (const [i, n] of names.entries()) {
    const c = await prisma.customer.create({
      data: { fullName: `${n} (demo)`, phone: `+2126000000${String(i + 10)}`, email: `client${i + 1}@example.com`, customerNumber: `NC-${code(6)}`, qrToken: randomBytes(24).toString('base64url'), isDemo: true },
    });
    await prisma.loyaltyCard.create({ data: { customerId: c.id } });
    customers.push(c);
  }
  // Demo customer account
  const custUser = await prisma.user.create({ data: { email: 'customer@neastudio.demo', passwordHash: await bcrypt.hash('NeaClient!2026', 12), roleId: await role('CUSTOMER') } });
  await prisma.customer.update({ where: { id: customers[0].id }, data: { userId: custUser.id } });

  const settings = await prisma.salonSettings.findUniqueOrThrow({ where: { id: 1 } });
  const rules = await prisma.loyaltyRule.findMany({ where: { isActive: true }, orderBy: { stampsRequired: 'asc' } });

  // Appointment generator: past 60 days (completed / some cancelled / no-show) + next 10 days (confirmed/pending).
  let created = 0;
  for (let d = -60; d <= 10; d++) {
    const day = today.plus({ days: d });
    const wd = day.weekday;
    if (wd === 7) continue;
    for (const e of employees) {
      const off = team.find((t) => t.firstName === e.firstName)!.off;
      if (wd === off) continue;
      if (d >= 7 && d <= 9 && e.id === employees[2].id) continue; // absent
      let minute = 600 + randomInt(0, 3) * 30;
      const perDay = d < 0 ? randomInt(2, 6) : d === 0 ? randomInt(3, 5) : randomInt(1, 4);
      for (let k = 0; k < perDay; k++) {
        const s = svc(e.services[randomInt(e.services.length)]);
        if (minute < 840 && minute + s.durationMinutes > 780) minute = 840; // skip lunch
        if (minute + s.durationMinutes > 1140) break;
        const startAt = day.set({ hour: Math.floor(minute / 60), minute: minute % 60 }).toUTC().toJSDate();
        const endAt = new Date(startAt.getTime() + s.durationMinutes * 60_000);
        const customer = customers[(created * 7 + k) % customers.length];
        const isPast = endAt.getTime() < Date.now();
        const roll = randomInt(100);
        const status = isPast ? (roll < 84 ? 'COMPLETED' : roll < 93 ? 'CANCELLED' : 'NO_SHOW') : roll < 70 ? 'CONFIRMED' : 'PENDING';
        await prisma.$transaction(async (tx) => {
          const a = await tx.appointment.create({
            data: {
              reference: `NEA-${code(6)}`, customerId: customer.id, employeeId: e.id, serviceId: s.id, startAt, endAt, status, isDemo: true,
              durationMinutes: s.durationMinutes, priceMad: s.priceMad, source: roll % 3 === 0 ? 'ADMIN' : 'ONLINE',
              completedAt: status === 'COMPLETED' ? endAt : null, cancelledAt: status === 'CANCELLED' ? new Date(startAt.getTime() - 86_400_000) : null,
              cancellationReason: status === 'CANCELLED' ? 'Demo cancellation' : null,
              createdAt: new Date(startAt.getTime() - randomInt(1, 14) * 86_400_000),
            },
          });
          await tx.appointmentHistory.create({ data: { appointmentId: a.id, action: 'CREATED', toStatus: status, details: { demo: true } } });
          if (status === 'COMPLETED') {
            await tx.payment.create({ data: { appointmentId: a.id, grossMad: s.priceMad, amountMad: s.priceMad, method: roll % 2 ? 'CARD' : 'CASH', createdAt: endAt } });
            const card = await tx.loyaltyCard.findUniqueOrThrow({ where: { customerId: customer.id } });
            await tx.loyaltyStamp.create({ data: { cardId: card.id, appointmentId: a.id, source: 'APPOINTMENT', value: 1, createdAt: endAt } });
            const total = (await tx.loyaltyStamp.aggregate({ where: { cardId: card.id, revokedAt: null }, _sum: { value: true } }))._sum.value ?? 0;
            const cycleLen = Math.max(settings.loyaltyCycleStamps, ...rules.map((r) => r.stampsRequired));
            for (let cycle = 0; cycle * cycleLen < total; cycle++)
              for (const r of rules)
                if (total >= cycle * cycleLen + r.stampsRequired)
                  await tx.loyaltyReward.upsert({
                    where: { cardId_ruleId_cycle: { cardId: card.id, ruleId: r.id, cycle } },
                    update: {},
                    create: { cardId: card.id, ruleId: r.id, cycle, discountPercent: r.discountPercent, unlockedAt: endAt, expiresAt: r.validityDays ? new Date(endAt.getTime() + r.validityDays * 86_400_000) : null },
                  });
          }
        });
        created++;
        minute += s.durationMinutes + randomInt(0, 3) * 15;
      }
    }
  }
  await prisma.loyaltyReward.updateMany({ where: { status: 'AVAILABLE', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  console.log(`Demo data: ${employees.length} employees, ${services.length} services, ${customers.length} customers, ${created} appointments.`);
}

async function main() {
  await seedBase();
  if (process.env.SEED_DEMO !== 'false') await seedDemo();
  console.log('Seed complete.');
}

// Only run when executed directly (tests import seedBase)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts')) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

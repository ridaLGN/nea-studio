import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, parse, num } from '../lib/core.js';
import { dayBoundsUtc, todayLocal, addDays } from '../lib/time.js';
import { authenticate, requirePermission, requireRole } from '../middleware/auth.js';
import { getSettings } from '../modules/settings/settings.service.js';
import { loadDays } from '../modules/availability/availability.service.js';

/**
 * Business analytics. All figures are computed from real records
 * (payments, appointments, customers) — nothing is invented.
 * Demo records can be excluded with ?excludeDemo=true.
 */
export const analyticsRouter = Router();
analyticsRouter.use(authenticate, requireRole('ADMIN', 'MANAGER'), requirePermission('analytics.view'));

analyticsRouter.get('/overview', async (req, res) => {
  const q = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30), excludeDemo: z.enum(['true', 'false']).default('false') }), req.query);
  const settings = await getSettings();
  const tz = settings.timezone;
  const today = todayLocal(tz);
  const demo = q.excludeDemo === 'true' ? Prisma.sql`AND a."isDemo" = false` : Prisma.empty;
  const demoC = q.excludeDemo === 'true' ? Prisma.sql`AND c."isDemo" = false` : Prisma.empty;
  const demoWhere = q.excludeDemo === 'true' ? { isDemo: false } : {};
  const { start: todayStart, end: todayEnd } = dayBoundsUtc(today, tz);
  const monthStart = dayBoundsUtc(today.slice(0, 8) + '01', tz).start;
  const rangeStart = dayBoundsUtc(addDays(today, -(q.days - 1)), tz).start;

  const [totals, todayCount, newCustomers, totalCustomers, monthRevenue, rewardsIssued, rewardsRedeemed] = await Promise.all([
    prisma.appointment.groupBy({ by: ['status'], where: demoWhere, _count: true }),
    prisma.appointment.count({ where: { ...demoWhere, startAt: { gte: todayStart, lt: todayEnd }, status: { not: 'CANCELLED' } } }),
    prisma.customer.count({ where: { ...demoWhere, createdAt: { gte: monthStart } } }),
    prisma.customer.count({ where: demoWhere }),
    prisma.payment.aggregate({ where: { status: 'PAID', createdAt: { gte: monthStart }, appointment: demoWhere }, _sum: { amountMad: true }, _avg: { amountMad: true }, _count: true }),
    prisma.loyaltyReward.count(),
    prisma.rewardRedemption.count(),
  ]);

  const revenueByMonth = await prisma.$queryRaw<{ month: string; revenue: number; count: number }[]>`
    SELECT to_char(date_trunc('month', p."createdAt" AT TIME ZONE ${tz}), 'YYYY-MM') AS month,
           SUM(p."amountMad")::float AS revenue, COUNT(*)::int AS count
    FROM payments p JOIN appointments a ON a.id = p."appointmentId"
    WHERE p.status = 'PAID' AND p."createdAt" >= now() - interval '12 months' ${demo}
    GROUP BY 1 ORDER BY 1`;

  const perDay = await prisma.$queryRaw<{ day: string; total: number; completed: number; cancelled: number }[]>`
    SELECT to_char((a."startAt" AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS day,
           COUNT(*) FILTER (WHERE a.status <> 'CANCELLED')::int AS total,
           COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
           COUNT(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled
    FROM appointments a
    WHERE a."startAt" >= ${rangeStart} AND a."startAt" < ${todayEnd} ${demo}
    GROUP BY 1 ORDER BY 1`;

  const popular = await prisma.$queryRaw<{ name: string; count: number; revenue: number }[]>`
    SELECT s.name, COUNT(a.id)::int AS count, COALESCE(SUM(p."amountMad"), 0)::float AS revenue
    FROM appointments a JOIN services s ON s.id = a."serviceId"
    LEFT JOIN payments p ON p."appointmentId" = a.id AND p.status = 'PAID'
    WHERE a.status <> 'CANCELLED' AND a."startAt" >= ${rangeStart} ${demo}
    GROUP BY s.name ORDER BY count DESC LIMIT 8`;

  const employeePerf = await prisma.$queryRaw<{ name: string; completed: number; noShow: number; revenue: number; color: string }[]>`
    SELECT e."firstName" || ' ' || e."lastName" AS name, e.color,
           COUNT(a.id) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
           COUNT(a.id) FILTER (WHERE a.status = 'NO_SHOW')::int AS "noShow",
           COALESCE(SUM(p."amountMad"), 0)::float AS revenue
    FROM employees e
    LEFT JOIN appointments a ON a."employeeId" = e.id AND a."startAt" >= ${rangeStart} ${demo}
    LEFT JOIN payments p ON p."appointmentId" = a.id AND p.status = 'PAID'
    GROUP BY e.id ORDER BY completed DESC`;

  const customerGrowth = await prisma.$queryRaw<{ month: string; count: number }[]>`
    SELECT to_char(date_trunc('month', c."createdAt" AT TIME ZONE ${tz}), 'YYYY-MM') AS month, COUNT(*)::int AS count
    FROM customers c WHERE c."createdAt" >= now() - interval '12 months' ${demoC}
    GROUP BY 1 ORDER BY 1`;

  // Retention: share of customers with ≥1 completed visit who came back at least twice
  const [retention] = await prisma.$queryRaw<{ returning: number; visited: number }[]>`
    SELECT COUNT(*) FILTER (WHERE n >= 2)::int AS returning, COUNT(*)::int AS visited
    FROM (SELECT a."customerId", COUNT(*) AS n FROM appointments a WHERE a.status = 'COMPLETED' ${demo} GROUP BY 1) t`;

  // Today's occupancy from the live availability engine
  const employees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true } });
  const days = await loadDays(prisma, today, employees.map((e) => e.id), { settings });
  let cap = 0, free = 0, working = 0;
  for (const d of days.values()) {
    if (d.status === 'WORKING') working++;
    if (d.window) cap += d.window.end - d.window.start - d.blocks.filter((b) => b.kind !== 'APPOINTMENT').reduce((s, b) => s + (b.end - b.start), 0);
    free += d.free.reduce((s, f) => s + f.end - f.start, 0);
  }
  const c = (s: string) => totals.find((t) => t.status === s)?._count ?? 0;

  res.json({
    currency: settings.currency,
    kpis: {
      totalAppointments: totals.reduce((s, t) => s + t._count, 0),
      todayAppointments: todayCount,
      completed: c('COMPLETED'),
      cancelled: c('CANCELLED'),
      noShow: c('NO_SHOW'),
      pending: c('PENDING'),
      totalCustomers,
      newCustomersThisMonth: newCustomers,
      monthlyRevenue: num(monthRevenue._sum.amountMad),
      averageBookingValue: Math.round(num(monthRevenue._avg.amountMad) * 100) / 100,
      paymentsThisMonth: monthRevenue._count,
      rewardsIssued,
      rewardsRedeemed,
      employeesWorkingToday: working,
      employeesActive: employees.length,
      occupancyToday: cap ? Math.round(((cap - free) / cap) * 100) : 0,
      retentionRate: retention?.visited ? Math.round((retention.returning / retention.visited) * 100) : 0,
    },
    charts: { revenueByMonth, perDay, popular, employeePerf, customerGrowth },
  });
});

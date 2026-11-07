import { env } from '../../config/env.js';
import { prisma, logger } from '../../lib/core.js';
import { expireRewards } from '../loyalty/loyalty.service.js';
import { notify } from './notifications.service.js';

/**
 * Periodic jobs: appointment reminders, reward expiry reminders and reward expiration.
 * Every job is idempotent (dedupe keys + status checks), so running it twice is harmless.
 */
export async function runJobsOnce(now = new Date()) {
  const horizon = new Date(now.getTime() + env.REMINDER_HOURS_BEFORE * 3600_000);
  const upcoming = await prisma.appointment.findMany({
    where: { status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gt: now, lte: horizon } },
    include: { customer: true, service: true, employee: true },
  });
  for (const a of upcoming) {
    await notify({
      type: 'APPOINTMENT_REMINDER', customerId: a.customerId, appointmentId: a.id, dedupeKey: `reminder:${a.id}:${a.startAt.toISOString()}`,
      data: { customerName: a.customer.fullName, serviceName: a.service.name, employeeName: a.employee.firstName, startAt: a.startAt, reference: a.reference },
    });
  }

  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const expiring = await prisma.loyaltyReward.findMany({ where: { status: 'AVAILABLE', expiresAt: { gt: now, lte: soon } }, include: { card: { include: { customer: true } } } });
  for (const r of expiring) {
    await notify({ type: 'REWARD_EXPIRING', customerId: r.card.customerId, dedupeKey: `reward-expiring:${r.id}`, data: { customerName: r.card.customer.fullName, discountPercent: r.discountPercent, expiresAt: r.expiresAt } });
  }
  const expired = await expireRewards();
  return { reminders: upcoming.length, expiringRewards: expiring.length, expired };
}

export function startJobs() {
  if (env.JOBS_ENABLED !== 'true') return;
  const tick = () => runJobsOnce().then((r) => logger.debug(r, 'jobs run')).catch((e) => logger.error({ err: e }, 'jobs failed'));
  setTimeout(tick, 10_000);
  setInterval(tick, 5 * 60_000).unref();
}

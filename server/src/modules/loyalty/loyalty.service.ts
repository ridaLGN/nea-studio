import type { SalonSettings } from '@prisma/client';
import QRCode from 'qrcode';
import { prisma, type Db, type Tx, badRequest, notFound, conflict, audit, isUniqueViolation } from '../../lib/core.js';
import { getSettings } from '../settings/settings.service.js';

export async function ensureCard(db: Db, customerId: string) {
  return db.loyaltyCard.upsert({ where: { customerId }, update: {}, create: { customerId } });
}

/** Sum of active (non-revoked) stamps */
export async function activeStampTotal(db: Db, cardId: string) {
  const r = await db.loyaltyStamp.aggregate({ where: { cardId, revokedAt: null }, _sum: { value: true } });
  return r._sum.value ?? 0;
}

/** Lazily expires rewards whose expiry date passed. */
export async function expireRewards(db: Db = prisma) {
  const r = await db.loyaltyReward.updateMany({ where: { status: 'AVAILABLE', expiresAt: { lt: new Date() } }, data: { status: 'EXPIRED' } });
  return r.count;
}

/**
 * Unlocks every milestone reached and not yet issued.
 * Uniqueness (cardId, ruleId, cycle) in the DB guarantees a milestone is issued once per cycle.
 */
export async function evaluateRewards(tx: Tx, cardId: string, settings: SalonSettings) {
  const rules = await tx.loyaltyRule.findMany({ where: { isActive: true }, orderBy: { stampsRequired: 'asc' } });
  if (!rules.length) return [];
  const total = await activeStampTotal(tx, cardId);
  const cycleLength = Math.max(settings.loyaltyCycleStamps, ...rules.map((r) => r.stampsRequired));
  const existing = await tx.loyaltyReward.findMany({ where: { cardId }, select: { ruleId: true, cycle: true } });
  const have = new Set(existing.map((e) => `${e.ruleId}:${e.cycle}`));
  const created = [];
  for (let cycle = 0; cycle * cycleLength < total; cycle++) {
    for (const rule of rules) {
      if (total < cycle * cycleLength + rule.stampsRequired || have.has(`${rule.id}:${cycle}`)) continue;
      const expiresAt = rule.validityDays ? new Date(Date.now() + rule.validityDays * 86_400_000) : null;
      created.push(await tx.loyaltyReward.create({ data: { cardId, ruleId: rule.id, cycle, discountPercent: rule.discountPercent, expiresAt } }));
    }
  }
  return created;
}

/** Awards the visit stamp for a completed appointment. Idempotent thanks to UNIQUE(appointmentId). */
export async function stampForAppointment(tx: Tx, appointmentId: string, customerId: string, actorUserId: string | null, settings: SalonSettings) {
  if (!settings.loyaltyEnabled) return { stamp: null, rewards: [] };
  const card = await ensureCard(tx, customerId);
  const exists = await tx.loyaltyStamp.findUnique({ where: { appointmentId } });
  if (exists) return { stamp: null, rewards: [] };
  try {
    const stamp = await tx.loyaltyStamp.create({
      data: { cardId: card.id, appointmentId, source: 'APPOINTMENT', value: settings.stampsPerVisit, createdByUserId: actorUserId },
    });
    const rewards = await evaluateRewards(tx, card.id, settings);
    return { stamp, rewards };
  } catch (e) {
    if (isUniqueViolation(e)) return { stamp: null, rewards: [] };
    throw e;
  }
}

/** Manual adjustment by an administrator, always audited. */
export async function adjustStamps(customerId: string, delta: number, reason: string, actorUserId: string, ip?: string) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 50) throw badRequest('delta must be a non-zero integer between -50 and 50');
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const card = await ensureCard(tx, customerId);
    let rewards: Awaited<ReturnType<typeof evaluateRewards>> = [];
    if (delta > 0) {
      await tx.loyaltyStamp.create({ data: { cardId: card.id, source: 'MANUAL', value: delta, reason, createdByUserId: actorUserId } });
      rewards = await evaluateRewards(tx, card.id, settings);
    } else {
      const total = await activeStampTotal(tx, card.id);
      if (total + delta < 0) throw conflict(`The card only has ${total} stamp(s)`, 'NOT_ENOUGH_STAMPS');
      // Revoke the most recent stamps; split a multi-value row if needed.
      let toRemove = -delta;
      const stamps = await tx.loyaltyStamp.findMany({ where: { cardId: card.id, revokedAt: null }, orderBy: { createdAt: 'desc' } });
      for (const s of stamps) {
        if (toRemove <= 0) break;
        if (s.value <= toRemove) {
          await tx.loyaltyStamp.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedByUserId: actorUserId, revokeReason: reason } });
          toRemove -= s.value;
        } else {
          await tx.loyaltyStamp.update({ where: { id: s.id }, data: { value: s.value - toRemove } });
          await tx.loyaltyStamp.create({
            data: { cardId: card.id, source: 'MANUAL', value: toRemove, reason: `Split of ${s.id}`, revokedAt: new Date(), revokedByUserId: actorUserId, revokeReason: reason },
          });
          toRemove = 0;
        }
      }
    }
    await audit({ actorUserId, action: delta > 0 ? 'LOYALTY_STAMPS_ADDED' : 'LOYALTY_STAMPS_REMOVED', entityType: 'LoyaltyCard', entityId: card.id, details: { delta, reason }, ip }, tx);
    return { cardId: card.id, rewards };
  });
}

export function qrPayload(token: string) {
  return `NEA:${token}`;
}
export async function qrDataUrl(token: string) {
  return QRCode.toDataURL(qrPayload(token), { margin: 1, width: 320, color: { dark: '#3D302B', light: '#FFFFFF' } });
}

/** Everything the digital card UI needs. */
export async function cardSummary(customerId: string, db: Db = prisma) {
  const [settings, customer] = await Promise.all([getSettings(db), db.customer.findUnique({ where: { id: customerId } })]);
  if (!customer) throw notFound('Customer');
  await expireRewards(db);
  const card = await ensureCard(db, customerId);
  const [total, rules, rewards, stamps] = await Promise.all([
    activeStampTotal(db, card.id),
    db.loyaltyRule.findMany({ where: { isActive: true }, orderBy: { stampsRequired: 'asc' } }),
    db.loyaltyReward.findMany({ where: { cardId: card.id }, include: { rule: true, redemption: { include: { appointment: { select: { reference: true } } } } }, orderBy: { unlockedAt: 'desc' } }),
    db.loyaltyStamp.findMany({ where: { cardId: card.id }, include: { appointment: { select: { reference: true, startAt: true, service: { select: { name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const cycleLength = Math.max(settings.loyaltyCycleStamps, ...rules.map((r) => r.stampsRequired), 1);
  const inCycle = total % cycleLength;
  const slots = settings.loyaltyCardSlots;
  const filled = inCycle === 0 && total > 0 ? 0 : inCycle % slots;
  const next = rules.find((r) => r.stampsRequired > inCycle);
  return {
    cardId: card.id,
    customerNumber: customer.customerNumber,
    customerName: customer.fullName,
    enabled: settings.loyaltyEnabled,
    totalStamps: total,
    cycleLength,
    stampsInCycle: inCycle,
    slots,
    filledSlots: filled,
    cardPage: Math.floor(inCycle / slots) + 1,
    cardPages: Math.ceil(cycleLength / slots),
    nextReward: next ? { name: next.name, discountPercent: next.discountPercent, stampsRequired: next.stampsRequired, remaining: next.stampsRequired - inCycle } : null,
    milestones: rules.map((r) => ({ id: r.id, name: r.name, stampsRequired: r.stampsRequired, discountPercent: r.discountPercent, validityDays: r.validityDays, reached: inCycle >= r.stampsRequired })),
    rewards: rewards.map((r) => ({
      id: r.id,
      name: r.rule.name,
      discountPercent: r.discountPercent,
      status: r.status,
      unlockedAt: r.unlockedAt,
      expiresAt: r.expiresAt,
      redeemedAt: r.redemption?.createdAt ?? null,
      redeemedOn: r.redemption?.appointment.reference ?? null,
    })),
    history: stamps.map((s) => ({
      id: s.id,
      source: s.source,
      value: s.value,
      reason: s.reason,
      createdAt: s.createdAt,
      revokedAt: s.revokedAt,
      revokeReason: s.revokeReason,
      appointment: s.appointment ? { reference: s.appointment.reference, service: s.appointment.service.name, startAt: s.appointment.startAt } : null,
    })),
  };
}

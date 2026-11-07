import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/core.js';
import { app, fixtures, login } from './helpers.js';

let f: Awaited<ReturnType<typeof fixtures>>;
let admin: string;

/** An appointment that took place earlier today (inserted directly, as if booked last week). */
let seq = 0;
async function pastAppointment(customerId: string, status: 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'NO_SHOW' = 'CONFIRMED') {
  // each appointment uses its own minute range today, far in the past of "now" but same local day is not required:
  const start = new Date(Date.now() - (2 + seq++) * 3600_000 * 0.25 - 3600_000);
  return prisma.appointment.create({
    data: {
      reference: `NEA-T${String(seq).padStart(5, '0')}`, customerId, employeeId: seq % 2 ? f.alice.id : f.bea.id, serviceId: f.cut.id,
      startAt: start, endAt: new Date(start.getTime() + 60_000), durationMinutes: 1, priceMad: 200, status,
    },
  });
}
const complete = (id: string, body: object = {}) => request(app).post(`/api/admin/appointments/${id}/complete`).set('Authorization', `Bearer ${admin}`).send(body);

beforeEach(async () => {
  f = await fixtures();
  seq = 0;
  admin = await login('admin@test.local');
});

describe('loyalty stamps', () => {
  it('awards exactly one stamp per completed appointment', async () => {
    const a = await pastAppointment(f.customer.id);
    const r = await complete(a.id, { paymentMethod: 'CASH' });
    expect(r.status).toBe(200);
    expect(r.body.stamped).toBe(true);
    const again = await complete(a.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_COMPLETED');
    expect(await prisma.loyaltyStamp.count({ where: { appointmentId: a.id } })).toBe(1);
    expect(await prisma.payment.count({ where: { appointmentId: a.id } })).toBe(1);
  });

  it('survives concurrent double validation (QR scanned twice)', async () => {
    const a = await pastAppointment(f.customer.id);
    const rs = await Promise.all([complete(a.id), complete(a.id), complete(a.id)]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.loyaltyStamp.count({ where: { appointmentId: a.id } })).toBe(1);
  });

  it('never awards stamps for cancelled or no-show appointments', async () => {
    const c = await pastAppointment(f.customer.id, 'CANCELLED');
    const n = await pastAppointment(f.customer.id, 'NO_SHOW');
    expect((await complete(c.id)).status).toBe(409);
    expect((await complete(n.id)).status).toBe(409);
    const ns = await pastAppointment(f.customer.id);
    await request(app).post(`/api/admin/appointments/${ns.id}/status`).set('Authorization', `Bearer ${admin}`).send({ status: 'NO_SHOW' }).expect(200);
    expect(await prisma.loyaltyStamp.count()).toBe(0);
  });

  it('unlocks the 20% reward at 8 stamps and the 50% reward at 16 — once each', async () => {
    for (let i = 0; i < 8; i++) await complete((await pastAppointment(f.customer.id)).id).expect(200);
    let rewards = await prisma.loyaltyReward.findMany({ where: { card: { customerId: f.customer.id } } });
    expect(rewards.map((r) => r.discountPercent)).toEqual([20]);
    for (let i = 0; i < 8; i++) await complete((await pastAppointment(f.customer.id)).id).expect(200);
    rewards = await prisma.loyaltyReward.findMany({ where: { card: { customerId: f.customer.id } }, orderBy: { discountPercent: 'asc' } });
    expect(rewards.map((r) => r.discountPercent)).toEqual([20, 50]);
    expect(rewards.every((r) => r.expiresAt && r.expiresAt > new Date())).toBe(true);
  });

  it('uses configurable rules (no hardcoded thresholds)', async () => {
    await prisma.loyaltyRule.updateMany({ data: { isActive: false } });
    await request(app).post('/api/admin/loyalty/rules').set('Authorization', `Bearer ${admin}`).send({ name: 'Quick', stampsRequired: 2, discountPercent: 10, validityDays: null }).expect(201);
    await prisma.salonSettings.update({ where: { id: 1 }, data: { loyaltyCycleStamps: 2 } });
    for (let i = 0; i < 4; i++) await complete((await pastAppointment(f.customer.id)).id).expect(200);
    const rewards = await prisma.loyaltyReward.findMany({ where: { card: { customerId: f.customer.id } } });
    expect(rewards).toHaveLength(2); // cycles 0 and 1
    expect(rewards.every((r) => r.discountPercent === 10 && r.expiresAt === null)).toBe(true);
  });
});

describe('reward redemption', () => {
  async function customerWithReward() {
    for (let i = 0; i < 8; i++) await complete((await pastAppointment(f.customer.id)).id).expect(200);
    return prisma.loyaltyReward.findFirstOrThrow({ where: { card: { customerId: f.customer.id }, status: 'AVAILABLE' } });
  }

  it('applies the discount server-side and redeems the reward once', async () => {
    const reward = await customerWithReward();
    const a = await pastAppointment(f.customer.id);
    const r = await complete(a.id, { rewardId: reward.id, paymentMethod: 'CARD' });
    expect(r.status).toBe(200);
    expect(r.body.appointment.discountMad).toBe(40); // 20% of 200 MAD
    expect(r.body.appointment.paidMad).toBe(160);
    expect((await prisma.loyaltyReward.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe('REDEEMED');
    const b = await pastAppointment(f.customer.id);
    const twice = await complete(b.id, { rewardId: reward.id });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('REWARD_UNAVAILABLE');
  });

  it("rejects another customer's reward and expired rewards", async () => {
    const reward = await customerWithReward();
    const foreign = await pastAppointment(f.other.id);
    expect((await complete(foreign.id, { rewardId: reward.id })).body.error.code).toBe('INVALID_REWARD');
    await prisma.loyaltyReward.update({ where: { id: reward.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const mine = await pastAppointment(f.customer.id);
    const r = await complete(mine.id, { rewardId: reward.id });
    expect(r.status).toBe(409);
    expect((await prisma.loyaltyReward.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe('EXPIRED');
  });
});

describe('manual stamp adjustments', () => {
  it('adds and removes stamps with an audit trail', async () => {
    const add = await request(app).post(`/api/admin/loyalty/customers/${f.customer.id}/stamps`).set('Authorization', `Bearer ${admin}`).send({ delta: 3, reason: 'Paper card migration' });
    expect(add.status).toBe(200);
    expect(add.body.totalStamps).toBe(3);
    const rm = await request(app).post(`/api/admin/loyalty/customers/${f.customer.id}/stamps`).set('Authorization', `Bearer ${admin}`).send({ delta: -2, reason: 'Correction' });
    expect(rm.body.totalStamps).toBe(1);
    const tooMany = await request(app).post(`/api/admin/loyalty/customers/${f.customer.id}/stamps`).set('Authorization', `Bearer ${admin}`).send({ delta: -5, reason: 'Correction' });
    expect(tooMany.status).toBe(409);
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ['LOYALTY_STAMPS_ADDED', 'LOYALTY_STAMPS_REMOVED'] } } });
    expect(logs).toHaveLength(2);
  });
});

describe('QR identification', () => {
  it('finds the customer from the opaque QR token for staff only', async () => {
    const staff = await login('alice@test.local');
    const r = await request(app).post('/api/staff/scan').set('Authorization', `Bearer ${staff}`).send({ code: `NEA:${f.customer.qrToken}` });
    expect(r.status).toBe(200);
    expect(r.body.customer.id).toBe(f.customer.id);
    expect(r.body.loyalty.slots).toBe(8);
    expect((await request(app).post('/api/staff/scan').send({ code: `NEA:${f.customer.qrToken}` })).status).toBe(401);
    expect((await request(app).post('/api/staff/scan').set('Authorization', `Bearer ${staff}`).send({ code: 'NEA:unknown-token-123' })).status).toBe(404);
  });
});

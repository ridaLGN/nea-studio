import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/core.js';
import { app, at, bookingBody, fixtures, login, nextMonday } from './helpers.js';

let f: Awaited<ReturnType<typeof fixtures>>;
let admin: string, employee: string, customer: string;
const day = nextMonday();

beforeAll(async () => {
  f = await fixtures();
  [admin, employee, customer] = await Promise.all([login('admin@test.local'), login('alice@test.local'), login('client@test.local')]);
});
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('authentication', () => {
  it('rejects bad credentials and tampered tokens', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'wrong' })).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth(admin.slice(0, -2) + 'xx'))).status).toBe(401);
    const me = await request(app).get('/api/auth/me').set(auth(admin));
    expect(me.body.role).toBe('ADMIN');
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('denies anonymous access to protected APIs', async () => {
    for (const url of ['/api/admin/appointments', '/api/admin/customers', '/api/admin/analytics/overview', '/api/me/profile', '/api/staff/my-day', '/api/admin/settings'])
      expect((await request(app).get(url)).status, url).toBe(401);
  });
});

describe('role-based access', () => {
  it('customers cannot reach staff or admin APIs', async () => {
    expect((await request(app).get('/api/admin/appointments').set(auth(customer))).status).toBe(403);
    expect((await request(app).post('/api/staff/scan').set(auth(customer)).send({ code: 'NEA:xxxxxxxxxxxx' })).status).toBe(403);
  });

  it('employees cannot reach admin APIs', async () => {
    for (const url of ['/api/admin/appointments', '/api/admin/customers', '/api/admin/settings', '/api/admin/analytics/overview', '/api/admin/availability/day'])
      expect((await request(app).get(url).set(auth(employee))).status, url).toBe(403);
    expect((await request(app).patch('/api/admin/settings').set(auth(employee)).send({ name: 'Hacked' })).status).toBe(403);
  });

  it('managers cannot edit business settings (admin only)', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
    await prisma.user.create({ data: { email: 'manager@test.local', passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.local' } })).passwordHash, roleId: role.id } });
    const manager = await login('manager@test.local');
    expect((await request(app).get('/api/admin/appointments').set(auth(manager))).status).toBe(200);
    expect((await request(app).patch('/api/admin/settings').set(auth(manager)).send({ name: 'X' })).status).toBe(403);
  });

  it("customers only see and change their own bookings", async () => {
    const mine = await request(app).post('/api/public/bookings').set(auth(customer)).send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00')));
    expect(mine.status).toBe(201);
    expect(mine.body.customer.id).toBe(f.customer.id); // signed-in booking is linked to the account, not the form
    const theirs = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.bea.id, at(day, '10:00'), '+212600000002'));
    const list = await request(app).get('/api/me/appointments').set(auth(customer));
    expect(list.body.map((a: { id: string }) => a.id)).toEqual([mine.body.id]);
    expect((await request(app).post(`/api/me/appointments/${theirs.body.id}/cancel`).set(auth(customer)).send({})).status).toBe(403);
  });

  it('employees can only complete their own appointments', async () => {
    const start = new Date(Date.now() - 2 * 3600_000);
    const beaAppt = await prisma.appointment.create({ data: { reference: 'NEA-SECBEA', customerId: f.other.id, employeeId: f.bea.id, serviceId: f.cut.id, startAt: start, endAt: new Date(start.getTime() + 60_000), durationMinutes: 1, priceMad: 200, status: 'CONFIRMED' } });
    expect((await request(app).post(`/api/staff/appointments/${beaAppt.id}/complete`).set(auth(employee)).send({})).status).toBe(403);
    const aliceStart = new Date(Date.now() - 3 * 3600_000);
    const aliceAppt = await prisma.appointment.create({ data: { reference: 'NEA-SECALI', customerId: f.other.id, employeeId: f.alice.id, serviceId: f.cut.id, startAt: aliceStart, endAt: new Date(aliceStart.getTime() + 60_000), durationMinutes: 1, priceMad: 200, status: 'CONFIRMED' } });
    expect((await request(app).post(`/api/staff/appointments/${aliceAppt.id}/complete`).set(auth(employee)).send({})).status).toBe(200);
  });

  it('validates input on the backend', async () => {
    const r = await request(app).post('/api/public/bookings').send({ serviceId: f.cut.id, startAt: 'tomorrow', customer: { fullName: 'x', phone: 'abc' } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    const phone = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '11:00'), 'not-a-phone'));
    expect(phone.body.error.code).toBe('INVALID_PHONE');
  });

  it('the account claim requires a matching booking reference and phone', async () => {
    const b = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '15:00'), '0600000055'));
    expect((await request(app).post('/api/auth/claim').send({ reference: b.body.reference, phone: '0600000056', email: 'new@test.local', password: 'Abcdefgh1' })).status).toBe(400);
    const ok = await request(app).post('/api/auth/claim').send({ reference: b.body.reference, phone: '0600000055', email: 'new@test.local', password: 'Abcdefgh1' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.role).toBe('CUSTOMER');
    expect((await request(app).post('/api/auth/claim').send({ reference: b.body.reference, phone: '0600000055', email: 'new2@test.local', password: 'Abcdefgh1' })).status).toBe(409);
  });
});

describe('Vercel cron endpoint', () => {
  it('rejects calls without the cron secret and runs jobs with it', async () => {
    expect((await request(app).get('/api/cron/jobs')).status).toBe(401);
    expect((await request(app).get('/api/cron/jobs').set('Authorization', 'Bearer wrong-secret-0123456789xx')).status).toBe(401);
    const ok = await request(app).get('/api/cron/jobs').set('Authorization', 'Bearer test-cron-secret-0123456789');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true });
    expect(ok.body).toHaveProperty('reminders');
  });
});

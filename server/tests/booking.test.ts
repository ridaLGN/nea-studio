import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/lib/core.js';
import { toDbDate, addDays } from '../src/lib/time.js';
import { app, at, bookingBody, fixtures, login, nextMonday } from './helpers.js';

let f: Awaited<ReturnType<typeof fixtures>>;
const day = nextMonday();
beforeEach(async () => {
  f = await fixtures();
});

describe('online booking', () => {
  it('books a free slot and returns a unique reference', async () => {
    const r = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00')));
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^NEA-[A-Z2-9]{6}$/);
    expect(r.body.status).toBe('PENDING');
    expect(r.body.priceMad).toBe(200); // price comes from the server, never from the client
    const customer = await prisma.customer.findUnique({ where: { phone: '+212600000099' } });
    expect(customer).not.toBeNull(); // created from phone number, no account needed
    expect(await prisma.loyaltyCard.count({ where: { customerId: customer!.id } })).toBe(1);
  });

  it('rejects a conflicting booking for the same employee and time', async () => {
    await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00'))).expect(201);
    const overlap = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:30'), '0600000098'));
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('removes booked times from the public availability', async () => {
    await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00'))).expect(201);
    const r = await request(app).get('/api/public/availability').query({ serviceId: f.cut.id, date: day, employeeId: f.alice.id });
    const times = r.body.slots.map((s: { time: string }) => s.time);
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('10:45');
    expect(times).toContain('11:00');
    expect(times).not.toContain('12:30'); // 60 min would cross lunch
  });

  it('rejects bookings during breaks, outside working hours, and when absent', async () => {
    expect((await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '13:00')))).status).toBe(409);
    expect((await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '17:30')))).status).toBe(409); // 60 min overflows 18:00
    expect((await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '09:00')))).status).toBe(409);
    await prisma.employeeAbsence.create({ data: { employeeId: f.alice.id, startDate: toDbDate(day), endDate: toDbDate(day), type: 'SICK' } });
    const r = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00')));
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/absent/i);
  });

  it('rejects employees not qualified for the service', async () => {
    const r = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.nailsOnly.id, at(day, '10:00')));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('EMPLOYEE_NOT_QUALIFIED');
  });

  it('assigns "any available employee" and falls back when one is busy', async () => {
    await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00'))).expect(201);
    const r = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, null, at(day, '10:00'), '0600000098'));
    expect(r.status).toBe(201);
    expect(r.body.employee.id).toBe(f.bea.id);
    const third = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, null, at(day, '10:00'), '0600000097'));
    expect(third.status).toBe(409); // both qualified employees taken
  });

  it('enforces the booking window (notice period, advance limit)', async () => {
    const soon = new Date(Date.now() + 10 * 60_000);
    expect((await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, soon))).status).toBe(400);
    expect((await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(addDays(day, 120), '10:00')))).status).toBe(400);
  });

  it('allows exactly one of many simultaneous bookings for the same slot', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '15:00'), `06000001${10 + i}`))),
    );
    const ok = attempts.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.appointment.count({ where: { employeeId: f.alice.id } })).toBe(1);
  });

  it('the database itself refuses overlapping active appointments', async () => {
    const base = { customerId: f.customer.id, employeeId: f.alice.id, serviceId: f.cut.id, priceMad: 200, durationMinutes: 60, status: 'CONFIRMED' as const };
    await prisma.appointment.create({ data: { ...base, reference: 'NEA-DBTST1', startAt: at(day, '16:00'), endAt: at(day, '17:00') } });
    await expect(prisma.appointment.create({ data: { ...base, reference: 'NEA-DBTST2', startAt: at(day, '16:30'), endAt: at(day, '17:30') } })).rejects.toThrow(/appointments_no_overlap|23P01|exclusion/i);
  });
});

describe('cancellation and rescheduling', () => {
  it('lets a guest cancel with reference + phone and frees the slot', async () => {
    const b = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '11:00'))).expect(201);
    const wrong = await request(app).post('/api/public/bookings/cancel').send({ reference: b.body.reference, phone: '0611111111' });
    expect(wrong.status).toBe(404);
    const c = await request(app).post('/api/public/bookings/cancel').send({ reference: b.body.reference, phone: '0600000099' });
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('CANCELLED');
    await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '11:00'), '0600000098')).expect(201);
    const hist = await prisma.appointmentHistory.findMany({ where: { appointmentId: b.body.id } });
    expect(hist.map((h) => h.action)).toEqual(['CREATED', 'CANCELLED']);
  });

  it('blocks guest cancellation inside the cancellation window', async () => {
    const soon = new Date(Date.now() + 3 * 3600_000);
    const admin = await login('admin@test.local');
    await prisma.employee.update({ where: { id: f.alice.id }, data: { workingHours: { deleteMany: {}, create: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) }, breaks: { deleteMany: {} } } });
    await prisma.openingHour.updateMany({ data: { openMinute: 0, closeMinute: 1440 } });
    const created = await request(app).post('/api/admin/appointments').set('Authorization', `Bearer ${admin}`).send({ serviceId: f.nails.id, employeeId: f.alice.id, startAt: new Date(Math.ceil(soon.getTime() / 900_000) * 900_000).toISOString(), customerId: f.other.id });
    expect(created.status).toBe(201);
    const r = await request(app).post('/api/public/bookings/cancel').send({ reference: created.body.reference, phone: '+212600000002' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('CANCELLATION_WINDOW');
  });

  it('reschedules to a free slot, rejects a taken one, and records history', async () => {
    const a = await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '10:00'))).expect(201);
    await request(app).post('/api/public/bookings').send(bookingBody(f.cut.id, f.alice.id, at(day, '15:00'), '0600000098')).expect(201);
    const taken = await request(app).post('/api/public/bookings/reschedule').send({ reference: a.body.reference, phone: '0600000099', startAt: at(day, '15:30').toISOString() });
    expect(taken.status).toBe(409);
    const ok = await request(app).post('/api/public/bookings/reschedule').send({ reference: a.body.reference, phone: '0600000099', startAt: at(day, '16:00').toISOString() });
    expect(ok.status).toBe(200);
    expect(new Date(ok.body.startAt).toISOString()).toBe(at(day, '16:00').toISOString());
    // can move within its own previous slot (excludes itself)
    const self = await request(app).post('/api/public/bookings/reschedule').send({ reference: a.body.reference, phone: '0600000099', startAt: at(day, '16:30').toISOString() });
    expect(self.status).toBe(200);
    expect((await prisma.appointmentHistory.findMany({ where: { appointmentId: a.body.id } })).filter((h) => h.action === 'RESCHEDULED')).toHaveLength(2);
  });
});

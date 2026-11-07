import { Prisma, type AppointmentStatus, type BookingSource, type PaymentMethod } from '@prisma/client';
import {
  prisma, type Tx, AppError, badRequest, conflict, forbidden, notFound, audit,
  bookingReference, customerNumber, qrToken, normalizePhone, isOverlapViolation, isUniqueViolation, percentOf,
} from '../../lib/core.js';
import { emitAppointmentChanged, emitAvailabilityChanged } from '../../lib/realtime.js';
import { todayLocal, utcToLocal } from '../../lib/time.js';
import { assertSlotFree, loadDays, qualifiedEmployees } from '../availability/availability.service.js';
import { fits } from '../availability/engine.js';
import { getSettings } from '../settings/settings.service.js';
import { ensureCard, expireRewards, stampForAppointment } from '../loyalty/loyalty.service.js';
import { notifyLater } from '../notifications/notifications.service.js';

export interface Actor {
  userId: string | null;
  role: string | null;
  employeeId?: string | null;
  customerId?: string | null;
  ip?: string;
}

export const appointmentInclude = {
  customer: { select: { id: true, fullName: true, phone: true, email: true, customerNumber: true } },
  employee: { select: { id: true, firstName: true, lastName: true, color: true, photoUrl: true } },
  service: { select: { id: true, name: true, durationMinutes: true, category: { select: { name: true } } } },
  redemption: { select: { discountAmountMad: true, reward: { select: { discountPercent: true } } } },
  payments: { select: { amountMad: true, grossMad: true, discountMad: true, method: true, status: true, createdAt: true } },
} satisfies Prisma.AppointmentInclude;

const ALLOWED: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW', 'COMPLETED'],
  CONFIRMED: ['PENDING', 'CANCELLED', 'NO_SHOW', 'COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: ['CONFIRMED'], // allow correcting a mistaken no-show
};

/** Serialises all writes touching one employee's calendar (released at COMMIT/ROLLBACK). */
async function lockEmployee(tx: Tx, employeeId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'employee:' + employeeId}))`;
}

function broadcast(a: { id: string; reference: string; status: string; employeeId: string; startAt: Date }, action: string, extra: { employeeId: string; startAt: Date }[] = []) {
  const all = [a, ...extra];
  emitAvailabilityChanged({ dates: [...new Set(all.map((x) => utcToLocal(x.startAt).date))], employeeIds: [...new Set(all.map((x) => x.employeeId))] });
  emitAppointmentChanged({ id: a.id, reference: a.reference, status: a.status, action, employeeId: a.employeeId, date: utcToLocal(a.startAt).date });
}

async function runBookingTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  } catch (e) {
    if (isOverlapViolation(e)) throw conflict('This time slot was just taken. Please choose another one.', 'SLOT_UNAVAILABLE');
    throw e;
  }
}

async function upsertCustomer(tx: Tx, c: { fullName: string; phone: string; email?: string | null }) {
  const phone = normalizePhone(c.phone);
  const existing = await tx.customer.findUnique({ where: { phone } });
  if (existing) {
    // Keep existing data; only fill a missing email (never overwrite identity from an anonymous form)
    if (!existing.email && c.email) return tx.customer.update({ where: { id: existing.id }, data: { email: c.email } });
    return existing;
  }
  for (let i = 0; i < 5; i++) {
    try {
      const created = await tx.customer.create({ data: { fullName: c.fullName.trim(), phone, email: c.email || null, customerNumber: customerNumber(), qrToken: qrToken() } });
      await ensureCard(tx, created.id);
      return created;
    } catch (e) {
      if (!isUniqueViolation(e) || i === 4) throw e;
    }
  }
  throw new Error('unreachable');
}

export interface CreateInput {
  serviceId: string;
  employeeId?: string | null; // null => any available
  startAt: Date;
  customerId?: string;
  customer?: { fullName: string; phone: string; email?: string | null };
  notes?: string | null;
  source: BookingSource;
  status?: AppointmentStatus;
}

export async function createAppointment(input: CreateInput, actor: Actor) {
  const settings = await getSettings();
  const enforceRules = input.source === 'ONLINE';
  const { service, employees } = await qualifiedEmployees(prisma, input.serviceId, input.employeeId);
  if (!service.isActive && enforceRules) throw badRequest('This service is not available for booking', 'SERVICE_INACTIVE');
  if (!employees.length) throw badRequest(input.employeeId ? 'This employee does not perform this service' : 'No employee performs this service', 'EMPLOYEE_NOT_QUALIFIED');
  if (!input.customerId && !input.customer) throw badRequest('Customer details are required');

  // Candidate order for "any employee": least busy that day first.
  let candidates = employees.map((e) => e.id);
  if (!input.employeeId && candidates.length > 1) {
    const date = utcToLocal(input.startAt, settings.timezone).date;
    const days = await loadDays(prisma, date, candidates, { settings });
    const local = utcToLocal(input.startAt, settings.timezone).minute;
    const load = (id: string) => (days.get(id)?.blocks ?? []).filter((b) => b.kind === 'APPOINTMENT').reduce((s, b) => s + (b.end - b.start), 0);
    candidates = candidates.filter((id) => days.get(id) && fits(days.get(id)!, local, service.durationMinutes)).sort((a, b) => load(a) - load(b));
    if (!candidates.length) throw conflict('No employee is available at this time', 'SLOT_UNAVAILABLE');
  }

  let lastError: unknown;
  for (const employeeId of candidates) {
    try {
      const appt = await runBookingTx(async (tx) => {
        await lockEmployee(tx, employeeId);
        await assertSlotFree(tx, { employeeId, startAt: input.startAt, durationMinutes: service.durationMinutes, enforceRules });
        const customer = input.customerId ? await tx.customer.findUnique({ where: { id: input.customerId } }) : await upsertCustomer(tx, input.customer!);
        if (!customer) throw notFound('Customer');
        const status: AppointmentStatus = input.status ?? (enforceRules ? (settings.autoConfirmOnline ? 'CONFIRMED' : 'PENDING') : 'CONFIRMED');
        let created;
        for (let i = 0; ; i++) {
          try {
            created = await tx.appointment.create({
              data: {
                reference: bookingReference(),
                customerId: customer.id,
                employeeId,
                serviceId: service.id,
                startAt: input.startAt,
                endAt: new Date(input.startAt.getTime() + service.durationMinutes * 60_000),
                durationMinutes: service.durationMinutes,
                priceMad: service.priceMad,
                status,
                source: input.source,
                notes: input.notes ?? null,
                createdByUserId: actor.userId,
              },
              include: appointmentInclude,
            });
            break;
          } catch (e) {
            if (!isUniqueViolation(e) || i >= 4) throw e; // reference collision -> retry
          }
        }
        await tx.appointmentHistory.create({ data: { appointmentId: created.id, action: 'CREATED', toStatus: status, actorUserId: actor.userId, details: { source: input.source } } });
        await audit({ actorUserId: actor.userId, action: 'APPOINTMENT_CREATED', entityType: 'Appointment', entityId: created.id, details: { reference: created.reference, source: input.source }, ip: actor.ip }, tx);
        return created;
      });
      broadcast(appt, 'CREATED');
      notifyLater({
        type: 'APPOINTMENT_CONFIRMATION', customerId: appt.customerId, appointmentId: appt.id, dedupeKey: `confirm:${appt.id}`,
        data: { customerName: appt.customer.fullName, serviceName: appt.service.name, employeeName: appt.employee.firstName, startAt: appt.startAt, reference: appt.reference },
      });
      return appt;
    } catch (e) {
      lastError = e;
      // with "any employee", try the next qualified person on conflicts only
      if (!(e instanceof AppError && e.code === 'SLOT_UNAVAILABLE') || input.employeeId) throw e;
    }
  }
  throw lastError;
}

async function getForUpdate(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${id} FOR UPDATE`;
  const a = await tx.appointment.findUnique({ where: { id }, include: appointmentInclude });
  if (!a) throw notFound('Appointment');
  return a;
}

/** Customers can only touch their own bookings; employees only their own appointments. */
export function assertCanAccess(a: { customerId: string; employeeId: string }, actor: Actor) {
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER') return;
  if (actor.role === 'EMPLOYEE' && actor.employeeId === a.employeeId) return;
  if ((actor.role === 'CUSTOMER' || actor.role === null) && actor.customerId === a.customerId) return;
  throw forbidden();
}

function assertCustomerCanChange(a: { startAt: Date }, settings: Awaited<ReturnType<typeof getSettings>>, actor: Actor) {
  if (actor.role === 'ADMIN' || actor.role === 'MANAGER' || actor.role === 'EMPLOYEE') return;
  if (!settings.allowOnlineCancellation) throw forbidden('Online changes are disabled. Please call the salon.');
  if (a.startAt.getTime() - Date.now() < settings.cancellationNoticeHours * 3600_000)
    throw new AppError(422, 'CANCELLATION_WINDOW', `Changes must be made at least ${settings.cancellationNoticeHours} hours before the appointment. Please call the salon.`);
}

export async function rescheduleAppointment(id: string, input: { startAt: Date; employeeId?: string | null }, actor: Actor) {
  const settings = await getSettings();
  const before = await prisma.appointment.findUnique({ where: { id } });
  if (!before) throw notFound('Appointment');
  assertCanAccess(before, actor);
  assertCustomerCanChange(before, settings, actor);
  if (!['PENDING', 'CONFIRMED'].includes(before.status)) throw conflict(`A ${before.status.toLowerCase()} appointment cannot be rescheduled`, 'INVALID_STATUS');
  const employeeId = input.employeeId ?? before.employeeId;
  if (actor.role === 'CUSTOMER' || actor.role === null) {
    if (employeeId !== before.employeeId) {
      const q = await qualifiedEmployees(prisma, before.serviceId, employeeId);
      if (!q.employees.length) throw badRequest('This employee does not perform this service', 'EMPLOYEE_NOT_QUALIFIED');
    }
  } else {
    const q = await qualifiedEmployees(prisma, before.serviceId, employeeId);
    if (!q.employees.length) throw badRequest('This employee does not perform this service', 'EMPLOYEE_NOT_QUALIFIED');
  }
  const enforceRules = actor.role === 'CUSTOMER' || actor.role === null;

  const updated = await runBookingTx(async (tx) => {
    // lock both calendars in a stable order to avoid deadlocks
    for (const e of [...new Set([before.employeeId, employeeId])].sort()) await lockEmployee(tx, e);
    const a = await getForUpdate(tx, id);
    await assertSlotFree(tx, { employeeId, startAt: input.startAt, durationMinutes: a.durationMinutes, excludeAppointmentId: id, enforceRules });
    const u = await tx.appointment.update({
      where: { id },
      data: { startAt: input.startAt, endAt: new Date(input.startAt.getTime() + a.durationMinutes * 60_000), employeeId },
      include: appointmentInclude,
    });
    await tx.appointmentHistory.create({
      data: { appointmentId: id, action: 'RESCHEDULED', actorUserId: actor.userId, details: { from: { startAt: a.startAt, employeeId: a.employeeId }, to: { startAt: u.startAt, employeeId } } },
    });
    await audit({ actorUserId: actor.userId, action: 'APPOINTMENT_RESCHEDULED', entityType: 'Appointment', entityId: id, details: { from: a.startAt, to: u.startAt }, ip: actor.ip }, tx);
    return u;
  });
  broadcast(updated, 'RESCHEDULED', [{ employeeId: before.employeeId, startAt: before.startAt }]);
  notifyLater({
    type: 'APPOINTMENT_RESCHEDULED', customerId: updated.customerId, appointmentId: id,
    data: { customerName: updated.customer.fullName, serviceName: updated.service.name, employeeName: updated.employee.firstName, startAt: updated.startAt, reference: updated.reference },
  });
  return updated;
}

/** Status changes other than completion (which has its own atomic workflow). */
export async function changeStatus(id: string, to: Exclude<AppointmentStatus, 'COMPLETED'>, actor: Actor, reason?: string | null) {
  const settings = await getSettings();
  const updated = await prisma.$transaction(async (tx) => {
    const a = await getForUpdate(tx, id);
    assertCanAccess(a, actor);
    if (to === 'CANCELLED') assertCustomerCanChange(a, settings, actor);
    else if (actor.role === 'CUSTOMER' || actor.role === null) throw forbidden();
    if (actor.role === 'EMPLOYEE' && to !== 'CONFIRMED' && to !== 'NO_SHOW') throw forbidden('Employees may only confirm or mark no-show');
    if (a.status === to) return a;
    if (!ALLOWED[a.status].includes(to)) throw conflict(`Cannot change a ${a.status} appointment to ${to}`, 'INVALID_TRANSITION');
    if (to === 'CONFIRMED' && a.status === 'NO_SHOW') {
      // re-activating: the slot must still be free
      await lockEmployee(tx, a.employeeId);
      await assertSlotFree(tx, { employeeId: a.employeeId, startAt: a.startAt, durationMinutes: a.durationMinutes, excludeAppointmentId: a.id, enforceRules: false }).catch(() => {
        throw conflict('The time slot is no longer free', 'SLOT_UNAVAILABLE');
      });
    }
    const u = await tx.appointment.update({
      where: { id },
      data: { status: to, ...(to === 'CANCELLED' ? { cancelledAt: new Date(), cancellationReason: reason ?? null } : {}) },
      include: appointmentInclude,
    });
    await tx.appointmentHistory.create({ data: { appointmentId: id, action: to === 'CANCELLED' ? 'CANCELLED' : 'STATUS_CHANGED', fromStatus: a.status, toStatus: to, actorUserId: actor.userId, details: reason ? { reason } : undefined } });
    await audit({ actorUserId: actor.userId, action: `APPOINTMENT_${to}`, entityType: 'Appointment', entityId: id, details: { from: a.status, reason }, ip: actor.ip }, tx);
    return u;
  });
  broadcast(updated, to);
  if (to === 'CANCELLED')
    notifyLater({
      type: 'APPOINTMENT_CANCELLATION', customerId: updated.customerId, appointmentId: id,
      data: { customerName: updated.customer.fullName, serviceName: updated.service.name, startAt: updated.startAt, reference: updated.reference, reason },
    });
  return updated;
}

export interface CompleteInput {
  rewardId?: string | null;
  paymentMethod?: PaymentMethod | null; // null => don't record a payment now
}

/**
 * Marks an appointment completed, optionally redeems one reward, records payment,
 * and awards the loyalty stamp — atomically. Calling twice is rejected (no double stamp).
 */
export async function completeAppointment(id: string, input: CompleteInput, actor: Actor) {
  const settings = await getSettings();
  if (actor.role === 'EMPLOYEE' && !settings.employeesCanComplete) throw forbidden('Employees are not allowed to complete appointments');
  await expireRewards();
  const result = await prisma.$transaction(async (tx) => {
    const a = await getForUpdate(tx, id);
    assertCanAccess(a, actor);
    if (actor.role === 'CUSTOMER' || actor.role === null) throw forbidden();
    if (a.status === 'COMPLETED') throw conflict('This appointment is already completed', 'ALREADY_COMPLETED');
    if (!['PENDING', 'CONFIRMED'].includes(a.status)) throw conflict(`A ${a.status} appointment cannot be completed`, 'INVALID_TRANSITION');
    if (utcToLocal(a.startAt, settings.timezone).date > todayLocal(settings.timezone)) throw conflict('Future appointments cannot be completed yet', 'NOT_YET');

    let discount = new Prisma.Decimal(0);
    if (input.rewardId) {
      const reward = await tx.loyaltyReward.findUnique({ where: { id: input.rewardId }, include: { card: true } });
      if (!reward || reward.card.customerId !== a.customerId) throw badRequest('This reward does not belong to the customer', 'INVALID_REWARD');
      if (reward.status !== 'AVAILABLE') throw conflict(`This reward is ${reward.status.toLowerCase()}`, 'REWARD_UNAVAILABLE');
      if (reward.expiresAt && reward.expiresAt < new Date()) throw conflict('This reward has expired', 'REWARD_EXPIRED');
      discount = Prisma.Decimal.min(percentOf(a.priceMad, reward.discountPercent), a.priceMad);
      await tx.rewardRedemption.create({ data: { rewardId: reward.id, appointmentId: a.id, discountAmountMad: discount, redeemedByUserId: actor.userId } });
      // conditional update guards against a concurrent redemption
      const r = await tx.loyaltyReward.updateMany({ where: { id: reward.id, status: 'AVAILABLE' }, data: { status: 'REDEEMED' } });
      if (r.count !== 1) throw conflict('This reward was already redeemed', 'REWARD_UNAVAILABLE');
    }
    if (input.paymentMethod) {
      await tx.payment.create({
        data: { appointmentId: a.id, grossMad: a.priceMad, discountMad: discount, amountMad: a.priceMad.minus(discount), method: input.paymentMethod, recordedByUserId: actor.userId },
      });
    }
    const u = await tx.appointment.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() }, include: appointmentInclude });
    await tx.appointmentHistory.create({ data: { appointmentId: id, action: 'COMPLETED', fromStatus: a.status, toStatus: 'COMPLETED', actorUserId: actor.userId, details: { rewardId: input.rewardId ?? null, discount: discount.toString() } } });
    const loyalty = await stampForAppointment(tx, a.id, a.customerId, actor.userId, settings);
    await audit({ actorUserId: actor.userId, action: 'APPOINTMENT_COMPLETED', entityType: 'Appointment', entityId: id, details: { stamped: !!loyalty.stamp, rewardsUnlocked: loyalty.rewards.length, discount: discount.toString() }, ip: actor.ip }, tx);
    return { appointment: u, stamped: !!loyalty.stamp, newRewards: loyalty.rewards };
  });
  broadcast(result.appointment, 'COMPLETED');
  for (const r of result.newRewards)
    notifyLater({ type: 'REWARD_UNLOCKED', customerId: result.appointment.customerId, dedupeKey: `reward:${r.id}`, data: { customerName: result.appointment.customer.fullName, discountPercent: r.discountPercent, expiresAt: r.expiresAt } });
  return result;
}

/** Admin edit of non-scheduling fields */
export async function updateAppointmentDetails(id: string, data: { notes?: string | null }, actor: Actor) {
  const a = await prisma.appointment.update({ where: { id }, data: { notes: data.notes }, include: appointmentInclude });
  await prisma.appointmentHistory.create({ data: { appointmentId: id, action: 'UPDATED', actorUserId: actor.userId, details: data } });
  return a;
}

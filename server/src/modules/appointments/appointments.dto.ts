import type { Prisma } from '@prisma/client';
import { num } from '../../lib/core.js';
import { appointmentInclude } from './appointments.service.js';

type A = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

export function appointmentDto(a: A, opts: { includeContact?: boolean } = { includeContact: true }) {
  const paid = a.payments.filter((p) => p.status === 'PAID');
  return {
    id: a.id,
    reference: a.reference,
    status: a.status,
    source: a.source,
    startAt: a.startAt,
    endAt: a.endAt,
    durationMinutes: a.durationMinutes,
    priceMad: num(a.priceMad),
    discountMad: num(a.redemption?.discountAmountMad),
    discountPercent: a.redemption?.reward.discountPercent ?? null,
    paidMad: paid.reduce((s, p) => s + num(p.amountMad), 0),
    notes: a.notes,
    cancellationReason: a.cancellationReason,
    cancelledAt: a.cancelledAt,
    completedAt: a.completedAt,
    createdAt: a.createdAt,
    customer: {
      id: a.customer.id,
      fullName: a.customer.fullName,
      customerNumber: a.customer.customerNumber,
      ...(opts.includeContact ? { phone: a.customer.phone, email: a.customer.email } : {}),
    },
    employee: { id: a.employee.id, name: `${a.employee.firstName} ${a.employee.lastName}`, firstName: a.employee.firstName, color: a.employee.color, photoUrl: a.employee.photoUrl },
    service: { id: a.service.id, name: a.service.name, durationMinutes: a.service.durationMinutes, category: a.service.category.name },
  };
}

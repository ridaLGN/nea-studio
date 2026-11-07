import type { SalonSettings } from '@prisma/client';
import { prisma, type Db } from '../../lib/core.js';

export async function getSettings(db: Db = prisma): Promise<SalonSettings> {
  return (await db.salonSettings.findUnique({ where: { id: 1 } })) ?? (await db.salonSettings.create({ data: { id: 1 } }));
}

export function publicSettings(s: SalonSettings) {
  return {
    name: s.name,
    tagline: s.tagline,
    logoUrl: s.logoUrl,
    address: s.address,
    city: s.city,
    phone: s.phone,
    email: s.email,
    instagram: s.instagram,
    currency: s.currency,
    timezone: s.timezone,
    maxAdvanceDays: s.maxAdvanceDays,
    minNoticeMinutes: s.minNoticeMinutes,
    allowOnlineCancellation: s.allowOnlineCancellation,
    cancellationNoticeHours: s.cancellationNoticeHours,
    cancellationPolicyText: s.cancellationPolicyText,
    loyaltyEnabled: s.loyaltyEnabled,
    loyaltyCardSlots: s.loyaltyCardSlots,
  };
}

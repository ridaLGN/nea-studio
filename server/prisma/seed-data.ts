/**
 * Reference data shared by the development seed (seed.ts) and the production seed (seed-production.ts).
 * Pure constants: no imports, no side effects (safe to import from any script).
 */

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

/** Initial salon settings (row id = 1). Everything else uses the schema defaults. Editable in Admin → Settings. */
export const INITIAL_SETTINGS = {
  name: 'NÉA STUDIO',
  tagline: 'Beauty & wellbeing studio — Marrakech',
  city: 'Marrakech',
  cancellationPolicyText:
    'Appointments can be cancelled or rescheduled free of charge up to 24 hours in advance. Within 24 hours, please call the salon.',
};

/** Opening hours, ISO weekday 1 = Monday … 7 = Sunday. Mon–Sat 09:30–20:00, Sunday closed. Editable in Settings. */
export const INITIAL_OPENING_HOURS = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  isClosed: weekday === 7,
  openMinute: 570,
  closeMinute: 1200,
}));

/** Loyalty milestones (consistent with the schema defaults loyaltyCardSlots = 8, loyaltyCycleStamps = 16). */
export const INITIAL_LOYALTY_RULES = [
  { name: 'Card complete', stampsRequired: 8, discountPercent: 20, validityDays: 90 },
  { name: 'Second card complete', stampsRequired: 16, discountPercent: 50, validityDays: 90 },
];

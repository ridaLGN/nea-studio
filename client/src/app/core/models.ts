export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'CUSTOMER';
export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface User {
  id: string;
  email: string;
  role: Role;
  permissions: string[];
  customer: { id: string; fullName: string; customerNumber: string } | null;
  employee: { id: string; firstName: string; lastName: string; photoUrl: string | null } | null;
}

export interface PublicSettings {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  currency: string;
  timezone: string;
  today: string;
  maxAdvanceDays: number;
  minNoticeMinutes: number;
  allowOnlineCancellation: boolean;
  cancellationNoticeHours: number;
  cancellationPolicyText: string | null;
  loyaltyEnabled: boolean;
  loyaltyCardSlots: number;
  openingHours: { weekday: number; isClosed: boolean; openMinute: number; closeMinute: number }[];
  tzTransitions: { from: string; offset: number }[];
  realtime?: 'websocket' | 'polling';
}

export interface Category { id: string; name: string; slug: string; description: string | null; sortOrder: number }
export interface EmployeeRef { id: string; name: string; photoUrl: string | null; color: string }
export interface Service {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceMad: number;
  priceMaxMad: number | null;
  durationMinutes: number;
  imageUrl: string | null;
  isDemo: boolean;
  category: { id: string; name: string; slug: string };
  employees: EmployeeRef[];
}
export interface PublicEmployee { id: string; firstName: string; lastName: string; title: string | null; bio: string | null; photoUrl: string | null; color: string; isDemo: boolean; services: string[] }

export interface Slot { time: string; minute: number; startAt: string; employeeIds: string[] }
export interface SlotsResponse {
  date: string;
  service: { id: string; name: string; durationMinutes: number };
  slots: Slot[];
  employees: (EmployeeRef & { status: string; slots: string[] })[];
}

export interface Appointment {
  id: string;
  reference: string;
  status: AppointmentStatus;
  source: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  priceMad: number;
  discountMad: number;
  discountPercent: number | null;
  paidMad: number;
  notes: string | null;
  cancellationReason: string | null;
  completedAt: string | null;
  createdAt: string;
  customer: { id: string; fullName: string; customerNumber: string; phone?: string; email?: string | null };
  employee: { id: string; name: string; firstName: string; color: string; photoUrl: string | null };
  service: { id: string; name: string; durationMinutes: number; category: string };
  startMinute?: number;
  endMinute?: number;
  date?: string;
}

export interface LoyaltySummary {
  cardId: string;
  customerNumber: string;
  customerName: string;
  enabled: boolean;
  totalStamps: number;
  cycleLength: number;
  stampsInCycle: number;
  slots: number;
  filledSlots: number;
  cardPage: number;
  cardPages: number;
  nextReward: { name: string; discountPercent: number; stampsRequired: number; remaining: number } | null;
  milestones: { id: string; name: string; stampsRequired: number; discountPercent: number; validityDays: number | null; reached: boolean }[];
  rewards: { id: string; name: string; discountPercent: number; status: 'AVAILABLE' | 'REDEEMED' | 'EXPIRED'; unlockedAt: string; expiresAt: string | null; redeemedAt: string | null; redeemedOn: string | null }[];
  history: { id: string; source: string; value: number; reason: string | null; createdAt: string; revokedAt: string | null; revokeReason: string | null; appointment: { reference: string; service: string; startAt: string } | null }[];
}

export interface Paged<T> { total: number; page: number; pageSize: number; items: T[] }
export interface Interval { start: number; end: number }
export interface Block extends Interval { kind: 'BREAK' | 'UNAVAILABLE' | 'APPOINTMENT'; label?: string }

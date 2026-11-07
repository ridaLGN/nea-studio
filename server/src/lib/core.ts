// Small shared primitives: prisma client, logger, errors, validation, ids, phone, money, audit.
import { PrismaClient, Prisma } from '@prisma/client';
import pino from 'pino';
import { randomBytes, randomInt } from 'node:crypto';
import type { ZodTypeAny, z } from 'zod';
import { env } from '../config/env.js';

// ---------- Prisma ----------
export const prisma = new PrismaClient();
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

// ---------- Logger ----------
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  redact: ['req.headers.authorization', '*.password', '*.passwordHash'],
});

// ---------- Errors ----------
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, code = 'BAD_REQUEST', details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string, code = 'CONFLICT') => new AppError(409, code, msg);

/** Postgres exclusion-constraint violation raised by appointments_no_overlap */
export function isOverlapViolation(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? '');
  return m.includes('appointments_no_overlap') || m.includes('23P01');
}
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

// ---------- Validation ----------
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', 'VALIDATION_ERROR', r.error.flatten());
  return r.data;
}

// ---------- Identifiers ----------
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export function randomCode(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
export const bookingReference = () => `NEA-${randomCode(6)}`;
export const customerNumber = () => `NC-${randomCode(6)}`;
export const qrToken = () => randomBytes(24).toString('base64url');

// ---------- Phone ----------
/** Normalises Moroccan / international phone numbers to E.164 (+212…) */
export function normalizePhone(input: string): string {
  let p = input.replace(/[\s.\-()]/g, '');
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (/^0[5-7]\d{8}$/.test(p)) p = '+212' + p.slice(1);
  else if (/^212\d{9}$/.test(p)) p = '+' + p;
  if (!/^\+\d{8,15}$/.test(p)) throw badRequest('Invalid phone number', 'INVALID_PHONE');
  return p;
}

// ---------- Money ----------
export const dec = (v: number | string) => new Prisma.Decimal(v);
export const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? 0 : Number(v));
export function percentOf(price: Prisma.Decimal, percent: number) {
  return price.mul(percent).div(100).toDecimalPlaces(2);
}

// ---------- Audit ----------
export async function audit(
  entry: { actorUserId?: string | null; action: string; entityType: string; entityId?: string | null; details?: unknown; ip?: string | null },
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      details: (entry.details ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: entry.ip ?? null,
    },
  });
}

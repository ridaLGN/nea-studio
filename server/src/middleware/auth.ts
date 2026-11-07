import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma, unauthorized, forbidden } from '../lib/core.js';

export type RoleName = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'CUSTOMER';

export interface AuthUser {
  id: string;
  email: string;
  role: RoleName;
  permissions: Set<string>;
  customerId: string | null;
  employeeId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: { id: string; role: string }) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

async function loadUser(token: string): Promise<AuthUser | null> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: String(payload.sub) },
    include: { role: { include: { permissions: { include: { permission: true } } } }, customer: true, employee: true },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role.name as RoleName,
    permissions: new Set(user.role.permissions.map((p) => p.permission.key)),
    customerId: user.customer?.id ?? null,
    employeeId: user.employee?.id ?? null,
  };
}

function bearer(req: Request) {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/** Requires a valid token. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (!token) throw unauthorized();
  const user = await loadUser(token);
  if (!user) throw unauthorized('Session expired or invalid');
  req.user = user;
  next();
}

/** Attaches the user when a valid token is present; never fails. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearer(req);
  if (token) req.user = (await loadUser(token)) ?? undefined;
  next();
}

export const requireRole =
  (...roles: RoleName[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

export const requirePermission =
  (...keys: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!keys.every((k) => req.user!.permissions.has(k))) throw forbidden();
    next();
  };

export const can = (req: Request, key: string) => !!req.user?.permissions.has(key);

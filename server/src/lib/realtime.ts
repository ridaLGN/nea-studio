import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let io: Server | null = null;
const STAFF_ROLES = new Set(['ADMIN', 'MANAGER', 'EMPLOYEE']);

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CORS_ORIGIN.split(','), credentials: true } });
  io.on('connection', (socket) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return;
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as { role?: string };
      if (payload.role && STAFF_ROLES.has(payload.role)) socket.join('staff');
    } catch {
      /* invalid token -> stays an anonymous public socket */
    }
  });
  return io;
}

/** Public & non-sensitive: tells every client which days/employees must refresh availability. */
export function emitAvailabilityChanged(payload: { dates: string[]; employeeIds: string[] }) {
  io?.emit('availability:changed', payload);
}

/** Staff room only: appointment change summary (no customer PII). */
export function emitAppointmentChanged(payload: { id: string; reference: string; status: string; action: string; employeeId: string; date: string }) {
  io?.to('staff').emit('appointment:changed', payload);
}

import { Injectable, effect, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { AuthService } from './auth.service';
import { ApiService } from './api.service';

export interface AvailabilityChange { dates: string[]; employeeIds: string[] }
export interface AppointmentChange { id: string; reference: string; status: string; action: string; employeeId: string; date: string }

/** Refresh interval when WebSockets are unavailable (e.g. Vercel serverless) */
const POLL_MS = 20_000;

/**
 * Live synchronisation between the admin dashboard, the employee dashboard and the public booking site.
 *
 * - "websocket" mode (local / classic server): Socket.IO; the server broadcasts "availability:changed"
 *   to everyone and "appointment:changed" to staff only.
 * - "polling" mode (Vercel, announced by GET /api/public/settings): no socket; a refresh signal is emitted
 *   every 20 s while the tab is visible, and subscribers reload from the API.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private api = inject(ApiService);
  private socket: Socket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly availability$ = new Subject<AvailabilityChange>();
  readonly appointments$ = new Subject<AppointmentChange>();
  connected = false;

  constructor() {
    if (this.api.settings()?.realtime === 'polling') {
      this.startPolling();
      return;
    }
    // reconnect with the new token whenever the session changes
    effect(() => {
      const token = this.auth.token();
      this.socket?.disconnect();
      this.socket = io({ path: '/socket.io', auth: token ? { token } : {}, transports: ['websocket', 'polling'] });
      this.socket.on('connect', () => (this.connected = true));
      this.socket.on('disconnect', () => (this.connected = false));
      this.socket.on('availability:changed', (p: AvailabilityChange) => this.availability$.next(p));
      this.socket.on('appointment:changed', (p: AppointmentChange) => this.appointments$.next(p));
    });
  }

  private startPolling() {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      this.availability$.next({ dates: [], employeeIds: [] }); // "something may have changed: reload"
    };
    this.timer = setInterval(tick, POLL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && tick());
  }

  /** true when a change may affect `date` (empty dates = global change such as settings) */
  static affects(change: AvailabilityChange, date: string) {
    return change.dates.length === 0 || change.dates.includes(date);
  }
}

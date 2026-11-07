import { Injectable, effect, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { io, type Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface AvailabilityChange { dates: string[]; employeeIds: string[] }
export interface AppointmentChange { id: string; reference: string; status: string; action: string; employeeId: string; date: string }

/**
 * Live synchronisation between the admin dashboard, the employee dashboard and the public booking site.
 * The server broadcasts "availability:changed" to everyone and "appointment:changed" to staff only.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private auth = inject(AuthService);
  private socket: Socket | null = null;
  readonly availability$ = new Subject<AvailabilityChange>();
  readonly appointments$ = new Subject<AppointmentChange>();
  connected = false;

  constructor() {
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

  /** true when a change may affect `date` (empty dates = global change such as settings) */
  static affects(change: AvailabilityChange, date: string) {
    return change.dates.length === 0 || change.dates.includes(date);
  }
}

import { Component, inject, input, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { dateLong, mad, time } from '../core/format';
import type { Appointment } from '../core/models';
import { Icon, StatusBadge } from '../shared/ui';
import { SlotPicker, type PickedSlot } from '../shared/slot-picker';

/** Guests manage a booking with reference + phone number (no account required). */
@Component({
  selector: 'nea-manage-booking',
  imports: [FormsModule, RouterLink, Icon, StatusBadge, SlotPicker],
  template: `
    <section class="mx-auto max-w-2xl px-4 pt-14 md:px-8">
      <p class="eyebrow">Your booking</p>
      <h1 class="title-lg mt-3">Manage my appointment</h1>

      @if (!appt()) {
        <form class="card-pad mt-8 space-y-4" (ngSubmit)="lookup()">
          <div><label class="label" for="r">Booking reference</label><input id="r" class="input uppercase tracking-widest" name="ref" [(ngModel)]="ref" placeholder="NEA-XXXXXX" required /></div>
          <div><label class="label" for="ph">Phone number used for the booking</label><input id="ph" class="input" name="phone" [(ngModel)]="phone" inputmode="tel" required /></div>
          <button class="btn-primary w-full" [disabled]="busy()">Find my booking</button>
          <p class="text-center text-xs text-taupe">Have an account? <a routerLink="/login" class="text-burgundy underline">Sign in</a> to see all your appointments.</p>
        </form>
      } @else {
        @let a = appt()!;
        <div class="card-pad mt-8">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-display text-3xl">{{ a.service.name }}</p>
              <p class="mt-1 text-sm text-taupe">with {{ a.employee.name }}</p>
            </div>
            <ui-status [status]="a.status" />
          </div>
          <div class="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <p class="flex items-center gap-2"><ui-icon name="calendar" class="text-taupe" />{{ dateLong(a.startAt) }}</p>
            <p class="flex items-center gap-2"><ui-icon name="clock" class="text-taupe" />{{ time(a.startAt) }} – {{ time(a.endAt) }}</p>
            <p class="flex items-center gap-2"><ui-icon name="card" class="text-taupe" />{{ mad(a.priceMad) }}</p>
            <p class="flex items-center gap-2"><ui-icon name="qr" class="text-taupe" />{{ a.reference }}</p>
          </div>
          @if (a.status === 'PENDING' || a.status === 'CONFIRMED') {
            <div class="mt-6 flex flex-wrap gap-3">
              <button class="btn-outline" (click)="rescheduling.set(!rescheduling())"><ui-icon name="calendar" [size]="16" /> Reschedule</button>
              <button class="btn-danger" (click)="cancel()" [disabled]="busy()"><ui-icon name="x" [size]="16" /> Cancel appointment</button>
            </div>
            @if (s()?.cancellationPolicyText) { <p class="mt-4 text-xs text-taupe">{{ s()?.cancellationPolicyText }}</p> }
          }
        </div>
        @if (rescheduling()) {
          <div class="card-pad mt-6 animate-fade-up">
            <h2 class="title-md mb-5">Choose a new time</h2>
            <nea-slot-picker [serviceId]="a.service.id" [employeeId]="a.employee.id" (picked)="newSlot.set($event)" />
            <div class="mt-5 flex justify-end"><button class="btn-primary" [disabled]="!newSlot() || busy()" (click)="reschedule()">Move my appointment</button></div>
          </div>
        }
        <button class="btn-ghost mt-6" (click)="appt.set(null)">Look up another booking</button>
      }
    </section>
  `,
})
export class ManageBookingPage implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  s = this.api.settings;
  refParam = input<string | undefined>(undefined, { alias: 'ref' });
  ref = '';
  phone = '';
  appt = signal<Appointment | null>(null);
  busy = signal(false);
  rescheduling = signal(false);
  newSlot = signal<PickedSlot | null>(null);
  dateLong = dateLong;
  time = time;
  mad = mad;

  ngOnInit() {
    this.ref = this.refParam() ?? '';
  }

  private async run(fn: () => Promise<Appointment>, ok?: string) {
    this.busy.set(true);
    try {
      this.appt.set(await fn());
      if (ok) this.toast.success(ok);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
  lookup() { return this.run(() => this.api.post('/api/public/bookings/lookup', { reference: this.ref, phone: this.phone })); }
  cancel() {
    if (!confirm('Cancel this appointment?')) return;
    return this.run(() => this.api.post('/api/public/bookings/cancel', { reference: this.ref, phone: this.phone }), 'Your appointment has been cancelled.');
  }
  async reschedule() {
    await this.run(() => this.api.post('/api/public/bookings/reschedule', { reference: this.ref, phone: this.phone, startAt: this.newSlot()!.startAt }), 'Your appointment has been moved.');
    this.rescheduling.set(false);
  }
}

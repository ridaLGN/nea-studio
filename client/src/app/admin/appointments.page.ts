import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { RealtimeService } from '../core/realtime.service';
import { dateTime, mad, STATUS_LABEL } from '../core/format';
import type { Appointment, Paged, Service } from '../core/models';
import { Avatar, Empty, Icon, StatusBadge } from '../shared/ui';
import { AppointmentDrawer, QuickCreate, loadServices } from './appointment-tools';

@Component({
  selector: 'nea-appointments',
  imports: [FormsModule, Icon, StatusBadge, Avatar, Empty, AppointmentDrawer, QuickCreate],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">Management</p><h1 class="title-lg mt-1">Appointments</h1></div>
      <button class="btn-primary" (click)="creating.set(true)"><ui-icon name="plus" [size]="16" /> New appointment</button>
    </div>

    <div class="card-pad mt-6 grid gap-3 md:grid-cols-6">
      <div class="relative md:col-span-2"><ui-icon name="search" [size]="15" class="absolute left-3.5 top-3 text-taupe" /><input class="input !pl-9" placeholder="Reference, customer name or phone" [(ngModel)]="f.q" (ngModelChange)="reset()" /></div>
      <input type="date" class="input" [(ngModel)]="f.from" (ngModelChange)="reset()" title="From" />
      <input type="date" class="input" [(ngModel)]="f.to" (ngModelChange)="reset()" title="To" />
      <select class="select" [(ngModel)]="f.status" (ngModelChange)="reset()"><option value="">All statuses</option>@for (s of statuses; track s) { <option [value]="s">{{ label[s] }}</option> }</select>
      <select class="select" [(ngModel)]="f.serviceId" (ngModelChange)="reset()"><option value="">All services</option>@for (s of services(); track s.id) { <option [value]="s.id">{{ s.name }}</option> }</select>
    </div>

    <div class="card mt-4 overflow-x-auto">
      <table class="table">
        <thead><tr><th>Date</th><th>Customer</th><th>Service</th><th>Team member</th><th>Status</th><th class="text-right">Price</th><th>Ref.</th></tr></thead>
        <tbody>
          @for (a of page()?.items; track a.id) {
            <tr class="cursor-pointer" (click)="openId.set(a.id)">
              <td class="whitespace-nowrap">{{ dateTime(a.startAt) }}</td>
              <td><p>{{ a.customer.fullName }}</p><p class="text-xs text-taupe">{{ a.customer.phone }}</p></td>
              <td>{{ a.service.name }}</td>
              <td><span class="flex items-center gap-2"><ui-avatar [name]="a.employee.name" [src]="a.employee.photoUrl" [color]="a.employee.color" [size]="24" />{{ a.employee.firstName }}</span></td>
              <td><ui-status [status]="a.status" /></td>
              <td class="whitespace-nowrap text-right">{{ mad(a.priceMad - a.discountMad) }}</td>
              <td class="font-mono text-xs text-taupe">{{ a.reference }}</td>
            </tr>
          }
        </tbody>
      </table>
      @if (page()?.items?.length === 0) { <ui-empty title="No appointments match" icon="calendar" /> }
    </div>
    @if (page(); as p) {
      <div class="mt-4 flex items-center justify-between text-sm text-taupe">
        <span>{{ p.total }} appointment{{ p.total === 1 ? '' : 's' }}</span>
        <div class="flex gap-2">
          <button class="btn-outline btn-sm" [disabled]="p.page <= 1" (click)="go(p.page - 1)">Previous</button>
          <button class="btn-outline btn-sm" [disabled]="p.page * p.pageSize >= p.total" (click)="go(p.page + 1)">Next</button>
        </div>
      </div>
    }

    <nea-appointment-drawer [appointmentId]="openId()" (closed)="openId.set(null)" (changed)="load()" />
    <nea-quick-create [open]="creating()" (closed)="creating.set(false)" (created)="load()" />
  `,
})
export class AppointmentsPage {
  private api = inject(ApiService);
  statuses = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
  label = STATUS_LABEL;
  dateTime = dateTime;
  mad = mad;
  f = { q: '', from: '', to: '', status: '', serviceId: '' };
  pageNo = 1;
  page = signal<Paged<Appointment> | null>(null);
  services = signal<Service[]>([]);
  openId = signal<string | null>(null);
  creating = signal(false);
  private t: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    loadServices(this.api).then((s) => this.services.set(s));
    this.load();
    const sub = inject(RealtimeService).appointments$.subscribe(() => this.load());
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
  reset() {
    this.pageNo = 1;
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(() => this.load(), 250);
  }
  go(p: number) {
    this.pageNo = p;
    this.load();
  }
  async load() {
    this.page.set(await this.api.appointments({ ...this.f, page: this.pageNo, pageSize: 25 }));
  }
}

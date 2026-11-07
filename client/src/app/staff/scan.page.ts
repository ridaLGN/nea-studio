import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { dateLong, isoDay, mad, time } from '../core/format';
import type { Appointment, LoyaltySummary } from '../core/models';
import { Icon, StatusBadge } from '../shared/ui';
import { LoyaltyCard } from '../shared/loyalty-card';
import { QrScanner } from '../shared/qr-scanner';

interface Context {
  customer: { id: string; fullName: string; customerNumber: string; phone: string; email: string | null; notes: string | null };
  appointments: Appointment[];
  loyalty: LoyaltySummary;
  today: string;
}

/**
 * Front-desk workflow: scan the client's QR → profile → today's appointment → validate.
 * Validation completes the appointment and stamps the card exactly once (enforced by the server).
 */
@Component({
  selector: 'nea-scan',
  imports: [FormsModule, Icon, StatusBadge, LoyaltyCard, QrScanner],
  template: `
    <p class="eyebrow">Front desk</p>
    <h1 class="title-lg mt-1">Client check-in</h1>

    <div class="mt-6 grid gap-6 lg:grid-cols-5">
      <div class="space-y-4 lg:col-span-2">
        <nea-qr-scanner (scanned)="onScan($event)" />
        <div class="card-pad">
          <p class="label">Or search manually</p>
          <input class="input" placeholder="Name, phone or customer ID" [ngModel]="q()" (ngModelChange)="search($event)" />
          @for (h of hits(); track h.id) {
            <button class="mt-2 block w-full rounded-xl border border-cream px-4 py-2.5 text-left text-sm hover:border-burgundy" (click)="open(h.id)">{{ h.fullName }} <span class="text-taupe">· {{ h.customerNumber }} · {{ h.phone }}</span></button>
          }
        </div>
      </div>

      <div class="lg:col-span-3">
        @if (ctx(); as c) {
          <div class="space-y-5 animate-fade-up">
            <div class="card-pad">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="eyebrow">{{ c.customer.customerNumber }}</p>
                  <p class="font-display text-3xl">{{ c.customer.fullName }}</p>
                  <p class="text-sm text-taupe">{{ c.customer.phone }}{{ c.customer.email ? ' · ' + c.customer.email : '' }}</p>
                </div>
                <button class="icon-btn" (click)="ctx.set(null)"><ui-icon name="x" /></button>
              </div>
              @if (c.customer.notes) { <p class="mt-3 rounded-xl bg-cream/60 px-3 py-2 text-sm">{{ c.customer.notes }}</p> }
            </div>

            @for (a of c.appointments; track a.id) {
              <div class="card-pad" [class.!border-burgundy]="isToday(a)">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p class="text-xs text-taupe">{{ isToday(a) ? 'Today' : dateLong(a.startAt) }} · {{ time(a.startAt) }} · {{ a.employee.name }}</p>
                    <p class="font-display text-2xl">{{ a.service.name }}</p>
                    <p class="text-sm text-taupe">{{ mad(a.priceMad) }}</p>
                  </div>
                  <ui-status [status]="a.status" />
                </div>
                @if (isToday(a) && (a.status === 'PENDING' || a.status === 'CONFIRMED')) {
                  @if (canValidate(a)) {
                    <div class="mt-4 grid gap-3 sm:grid-cols-3">
                      <select class="select" [(ngModel)]="rewardId">
                        <option [ngValue]="null">No discount</option>
                        @for (r of available(); track r.id) { <option [ngValue]="r.id">Use -{{ r.discountPercent }}% reward</option> }
                      </select>
                      <select class="select" [(ngModel)]="payment"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="TRANSFER">Transfer</option><option [ngValue]="null">Not paid yet</option></select>
                      <button class="btn-primary" [disabled]="busy()" (click)="validate(a)"><ui-icon name="check" [size]="16" /> Validate visit</button>
                    </div>
                  } @else {
                    <p class="mt-3 text-sm text-taupe">This appointment is with {{ a.employee.firstName }} — they or a manager can validate it.</p>
                  }
                }
              </div>
            } @empty { <div class="card-pad text-sm text-taupe">No appointment today or upcoming for this client.</div> }

            <nea-loyalty-card [card]="c.loyalty" />
          </div>
        } @else {
          <div class="card-pad flex h-full min-h-72 flex-col items-center justify-center text-center">
            <span class="flex size-14 items-center justify-center rounded-full bg-burgundy-soft text-burgundy"><ui-icon name="qr" [size]="24" /></span>
            <p class="mt-4 font-display text-2xl">Scan the client's QR code</p>
            <p class="mt-1 max-w-sm text-sm text-taupe">It is shown in their account. Their profile, today's appointment and loyalty card appear here.</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class ScanPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  ctx = signal<Context | null>(null);
  q = signal('');
  hits = signal<{ id: string; fullName: string; customerNumber: string; phone: string }[]>([]);
  busy = signal(false);
  rewardId: string | null = null;
  payment: string | null = 'CASH';
  dateLong = dateLong; time = time; mad = mad;
  private t: ReturnType<typeof setTimeout> | null = null;

  available = () => this.ctx()?.loyalty.rewards.filter((r) => r.status === 'AVAILABLE') ?? [];
  isToday = (a: Appointment) => isoDay(new Date(a.startAt)) === this.ctx()?.today;
  canValidate(a: Appointment) {
    const u = this.auth.user();
    if (!this.auth.can('appointments.complete')) return false;
    return u?.role !== 'EMPLOYEE' || u.employee?.id === a.employee.id;
  }

  async onScan(code: string) {
    try {
      this.set(await this.api.post<Context>('/api/staff/scan', { code }));
      this.toast.success('Client identified');
    } catch (e) { this.toast.error(e); }
  }
  async open(id: string) {
    this.hits.set([]);
    this.q.set('');
    try { this.set(await this.api.get<Context>(`/api/staff/customers/${id}/context`)); } catch (e) { this.toast.error(e); }
  }
  private set(c: Context) {
    this.ctx.set(c);
    this.rewardId = null;
    this.payment = 'CASH';
  }
  search(v: string) {
    this.q.set(v);
    if (this.t) clearTimeout(this.t);
    this.t = setTimeout(async () => this.hits.set(v.trim().length >= 2 ? await this.api.get('/api/staff/customers/search', { q: v }) : []), 250);
  }
  async validate(a: Appointment) {
    this.busy.set(true);
    try {
      const r = await this.api.post<{ stamped: boolean; newRewards: { discountPercent: number }[] }>(`/api/staff/appointments/${a.id}/complete`, { rewardId: this.rewardId, paymentMethod: this.payment });
      this.toast.success(r.stamped ? 'Visit validated — stamp added to the card' : 'Visit validated');
      if (r.newRewards.length) this.toast.show(`🎉 Reward unlocked: -${r.newRewards[0].discountPercent}%`, 'success');
      await this.open(this.ctx()!.customer.id);
    } catch (e) { this.toast.error(e); } finally { this.busy.set(false); }
  }
}

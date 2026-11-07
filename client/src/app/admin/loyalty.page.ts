import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { dateShort, mad } from '../core/format';
import { Icon, Stat } from '../shared/ui';

interface Rule { id: string; name: string; stampsRequired: number; discountPercent: number; validityDays: number | null; isActive: boolean }
interface Overview {
  settings: { loyaltyEnabled: boolean; loyaltyCycleStamps: number; loyaltyCardSlots: number; stampsPerVisit: number };
  rules: Rule[];
  stats: { cards: number; unlocked: number; available: number; redeemed: number; expired: number; closeToReward: number };
  closeToReward: { cardId: string; remaining: number; reward: number; customer?: { id: string; fullName: string; customerNumber: string } }[];
  redemptions: { id: string; createdAt: string; discountPercent: number; discountMad: number; reference: string; customer: { id: string; fullName: string } }[];
}

@Component({
  selector: 'nea-loyalty-admin',
  imports: [FormsModule, RouterLink, Icon, Stat],
  template: `
    <p class="eyebrow">Loyalty programme</p>
    <h1 class="title-lg mt-1">Digital loyalty cards</h1>
    @if (o(); as o) {
      <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <ui-stat label="Loyalty cards" [value]="o.stats.cards" icon="card" />
        <ui-stat label="Close to a reward" [value]="o.stats.closeToReward" hint="≤ 2 visits away" icon="sparkles" accent="orange" />
        <ui-stat label="Rewards unlocked" [value]="o.stats.unlocked" icon="gift" />
        <ui-stat label="Available now" [value]="o.stats.available" icon="check" accent="green" />
        <ui-stat label="Redeemed" [value]="o.stats.redeemed" icon="heart" accent="grey" />
        <ui-stat label="Expired" [value]="o.stats.expired" icon="clock" accent="red" />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <div class="card-pad">
          <div class="flex items-center justify-between"><p class="eyebrow">Reward milestones</p><button class="btn-outline btn-sm" (click)="addRule()"><ui-icon name="plus" [size]="14" /> Milestone</button></div>
          <div class="mt-4 space-y-3">
            @for (r of rules(); track r.id || $index) {
              <div class="grid grid-cols-2 items-end gap-2 rounded-xl border border-cream p-3 sm:grid-cols-6">
                <div class="col-span-2"><label class="label">Name</label><input class="input" [(ngModel)]="r.name" /></div>
                <div><label class="label">Stamps</label><input class="input" type="number" min="1" [(ngModel)]="r.stampsRequired" /></div>
                <div><label class="label">Discount %</label><input class="input" type="number" min="1" max="100" [(ngModel)]="r.discountPercent" /></div>
                <div><label class="label">Valid (days)</label><input class="input" type="number" min="1" placeholder="∞" [(ngModel)]="r.validityDays" /></div>
                <div class="flex items-center gap-1">
                  <label class="flex items-center gap-1 text-xs"><input type="checkbox" class="checkbox" [(ngModel)]="r.isActive" />On</label>
                  <button class="icon-btn" (click)="saveRule(r)" title="Save"><ui-icon name="check" [size]="16" /></button>
                  @if (r.id) { <button class="icon-btn" (click)="deleteRule(r)" title="Delete"><ui-icon name="trash" [size]="15" /></button> }
                </div>
              </div>
            }
          </div>
          <p class="mt-4 text-xs leading-relaxed text-taupe">A stamp is earned only when an appointment is validated (completed). Milestones count stamps within a cycle of <b>{{ o.settings.loyaltyCycleStamps }}</b> stamps; after the cycle the card starts again. The card displays {{ o.settings.loyaltyCardSlots }} circles. Change these values in Settings.</p>
        </div>

        <div class="space-y-6">
          <div class="card-pad">
            <p class="eyebrow mb-3">Customers close to a reward</p>
            @for (c of o.closeToReward; track c.cardId) {
              <a [routerLink]="['/admin/customers', c.customer?.id]" class="flex items-center justify-between border-b border-cream py-2.5 text-sm last:border-0 hover:text-burgundy">
                <span>{{ c.customer?.fullName }}</span><span class="text-xs text-taupe">{{ c.remaining }} visit{{ c.remaining > 1 ? 's' : '' }} to -{{ c.reward }}%</span>
              </a>
            } @empty { <p class="text-sm text-taupe">No customer is within 2 visits of a reward.</p> }
          </div>
          <div class="card-pad">
            <p class="eyebrow mb-3">Recent redemptions</p>
            @for (r of o.redemptions; track r.id) {
              <div class="flex items-center justify-between border-b border-cream py-2.5 text-sm last:border-0">
                <a [routerLink]="['/admin/customers', r.customer.id]" class="hover:text-burgundy">{{ r.customer.fullName }}</a>
                <span class="text-xs text-taupe">-{{ r.discountPercent }}% · {{ mad(r.discountMad) }} · {{ r.reference }} · {{ dateShort(r.createdAt) }}</span>
              </div>
            } @empty { <p class="text-sm text-taupe">No reward redeemed yet.</p> }
          </div>
        </div>
      </div>
    }
  `,
})
export class LoyaltyAdminPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  o = signal<Overview | null>(null);
  rules = signal<Rule[]>([]);
  mad = mad;
  dateShort = dateShort;
  constructor() { this.load(); }
  async load() {
    const o = await this.api.get<Overview>('/api/admin/loyalty/overview');
    this.o.set(o);
    this.rules.set(o.rules.map((r) => ({ ...r })));
  }
  addRule() { this.rules.update((r) => [...r, { id: '', name: 'New milestone', stampsRequired: 8, discountPercent: 10, validityDays: 90, isActive: true }]); }
  async saveRule(r: Rule) {
    const body = { name: r.name, stampsRequired: Number(r.stampsRequired), discountPercent: Number(r.discountPercent), validityDays: r.validityDays ? Number(r.validityDays) : null, isActive: r.isActive };
    try {
      if (r.id) await this.api.patch(`/api/admin/loyalty/rules/${r.id}`, body); else await this.api.post('/api/admin/loyalty/rules', body);
      this.toast.success('Milestone saved — applies to future stamps');
      this.load();
    } catch (e) { this.toast.error(e); }
  }
  async deleteRule(r: Rule) {
    if (!confirm('Delete this milestone? If rewards were already issued it will be deactivated.')) return;
    try { await this.api.delete(`/api/admin/loyalty/rules/${r.id}`); this.load(); } catch (e) { this.toast.error(e); }
  }
}

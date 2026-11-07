import { Component, computed, input } from '@angular/core';
import type { LoyaltySummary } from '../core/models';
import { Logo } from './ui';

/** The digital version of the salon's paper card: 8 stamp circles + 20 % / 50 % rewards (configurable). */
@Component({
  selector: 'nea-loyalty-card',
  imports: [Logo],
  template: `
    @let c = card();
    <div class="relative overflow-hidden rounded-[1.75rem] bg-burgundy p-6 text-ivory shadow-[var(--shadow-lift)] md:p-8" style="background-image: radial-gradient(120% 90% at 100% 0%, rgba(255,255,255,.14) 0%, transparent 55%), linear-gradient(150deg,#7f444a 0%,#5E2F34 100%)">
      <div class="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full border border-white/10"></div>
      <div class="pointer-events-none absolute -right-4 -top-4 size-32 rounded-full border border-white/10"></div>

      <div class="relative flex items-start justify-between gap-4">
        <div>
          <ui-logo [light]="true" />
          <p class="mt-5 eyebrow !text-ivory/60">Loyalty card</p>
          <p class="font-display text-2xl md:text-3xl leading-tight">{{ c.customerName }}</p>
          <p class="mt-1 text-xs tracking-[0.25em] text-ivory/60">{{ c.customerNumber }}</p>
        </div>
        @if (qr()) {
          <div class="shrink-0 rounded-2xl bg-white p-2 shadow-lg">
            <img [src]="qr()" alt="Personal QR code" class="size-24 md:size-28" />
          </div>
        }
      </div>

      <div class="relative mt-7 grid grid-cols-4 gap-3 md:gap-4" [style.grid-template-columns]="'repeat(' + cols() + ', minmax(0, 1fr))'">
        @for (s of stamps(); track s.index) {
          <div class="relative flex aspect-square items-center justify-center rounded-full border transition-all duration-500"
               [class]="s.filled ? 'border-ivory bg-ivory text-burgundy shadow-[0_0_0_4px_rgba(247,243,237,.12)]' : 'border-ivory/35 border-dashed text-ivory/40'">
            @if (s.filled) { <span class="font-display text-lg md:text-xl">N</span> } @else { <span class="text-[0.65rem]">{{ s.number }}</span> }
            @if (s.reward) {
              <span class="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-ivory px-1.5 text-[0.6rem] font-semibold text-burgundy">-{{ s.reward }}%</span>
            }
          </div>
        }
      </div>

      <div class="relative mt-7 flex flex-wrap items-end justify-between gap-3 text-sm">
        <div>
          <p class="text-ivory/60 text-xs">Validated visits</p>
          <p class="font-display text-2xl">{{ c.stampsInCycle }} <span class="text-base text-ivory/60">/ {{ c.cycleLength }}</span></p>
        </div>
        @if (c.nextReward) {
          <p class="text-right text-ivory/80">{{ c.nextReward.remaining }} visit{{ c.nextReward.remaining > 1 ? 's' : '' }} until <b class="font-medium text-white">-{{ c.nextReward.discountPercent }}%</b></p>
        }
        @if (c.cardPages > 1) { <p class="w-full text-[0.65rem] tracking-[0.2em] text-ivory/50">CARD {{ c.cardPage }} OF {{ c.cardPages }}</p> }
      </div>
    </div>
  `,
})
export class LoyaltyCard {
  card = input.required<LoyaltySummary>();
  qr = input<string | null>(null);
  cols = computed(() => Math.min(this.card().slots, 4));
  stamps = computed(() => {
    const c = this.card();
    const pageStart = (c.cardPage - 1) * c.slots; // stamps before this card page
    return Array.from({ length: c.slots }, (_, i) => {
      const number = pageStart + i + 1;
      return { index: i, number, filled: i < c.filledSlots, reward: c.milestones.find((m) => m.stampsRequired === number)?.discountPercent ?? null };
    });
  });
}

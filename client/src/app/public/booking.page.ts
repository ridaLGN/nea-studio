import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService, errorMessage } from '../core/toast.service';
import { dateLong, mad, time } from '../core/format';
import type { Appointment, Category, Service } from '../core/models';
import { Avatar, Icon } from '../shared/ui';
import { SlotPicker, type PickedSlot } from '../shared/slot-picker';

type Step = 1 | 2 | 3 | 4 | 5;

/**
 * Booking flow: service → team member (or any) → date & live time slots → details → summary → confirmation.
 * Every rule (availability, price, qualifications, double-booking) is enforced again by the server.
 */
@Component({
  selector: 'nea-booking',
  imports: [FormsModule, RouterLink, Icon, Avatar, SlotPicker],
  template: `
    <section class="mx-auto max-w-5xl px-4 pt-12 md:px-8">
      @if (!done()) {
        <p class="eyebrow">Online booking</p>
        <h1 class="title-lg mt-3">Book your moment</h1>

        <!-- progress -->
        <ol class="mt-8 flex gap-2">
          @for (st of steps; track st.n) {
            <li class="flex-1">
              <button class="w-full text-left disabled:cursor-default" [disabled]="st.n >= step()" (click)="go(st.n)">
                <span class="block h-1 rounded-full transition-colors" [class]="st.n <= step() ? 'bg-burgundy' : 'bg-cream'"></span>
                <span class="mt-2 hidden text-xs sm:block" [class]="st.n === step() ? 'text-brown font-medium' : 'text-taupe'">{{ st.n }}. {{ st.label }}</span>
              </button>
            </li>
          }
        </ol>

        <div class="mt-8 grid gap-8 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <!-- 1 · service -->
            @if (step() === 1) {
              <div class="animate-fade-up">
                <h2 class="title-md">Choose a service</h2>
                <div class="mt-5 flex flex-wrap gap-2">
                  <button class="tab" [class.active]="cat() === null" (click)="cat.set(null)">All</button>
                  @for (c of categories(); track c.id) { <button class="tab" [class.active]="cat() === c.id" (click)="cat.set(c.id)">{{ c.name }}</button> }
                </div>
                <div class="mt-5 space-y-3">
                  @for (sv of visibleServices(); track sv.id) {
                    <button (click)="chooseService(sv)" class="card flex w-full items-center justify-between gap-4 p-5 text-left transition hover:border-burgundy" [class.!border-burgundy]="service()?.id === sv.id">
                      <div>
                        <p class="font-display text-xl">{{ sv.name }}</p>
                        <p class="mt-0.5 text-xs text-taupe">{{ sv.category.name }} · {{ sv.durationMinutes }} min</p>
                      </div>
                      <span class="shrink-0 font-medium text-burgundy">{{ mad(sv.priceMad) }}</span>
                    </button>
                  }
                </div>
              </div>
            }

            <!-- 2 · employee -->
            @if (step() === 2 && service(); as sv) {
              <div class="animate-fade-up">
                <h2 class="title-md">Who would you like?</h2>
                <div class="mt-5 grid gap-3 sm:grid-cols-2">
                  <button (click)="chooseEmployee(null)" class="card flex items-center gap-4 p-5 text-left transition hover:border-burgundy" [class.!border-burgundy]="employeeId() === null && step2Touched()">
                    <span class="flex size-12 items-center justify-center rounded-full bg-burgundy-soft text-burgundy"><ui-icon name="sparkles" /></span>
                    <div><p class="font-display text-xl">Any available</p><p class="text-xs text-taupe">The most availability</p></div>
                  </button>
                  @for (e of sv.employees; track e.id) {
                    <button (click)="chooseEmployee(e.id)" class="card flex items-center gap-4 p-5 text-left transition hover:border-burgundy" [class.!border-burgundy]="employeeId() === e.id">
                      <ui-avatar [name]="e.name" [src]="e.photoUrl" [color]="e.color" [size]="48" />
                      <div><p class="font-display text-xl">{{ e.name }}</p><p class="text-xs text-taupe">{{ titleOf(e.id) }}</p></div>
                    </button>
                  }
                </div>
              </div>
            }

            <!-- 3 · date & time -->
            @if (step() === 3 && service(); as sv) {
              <div class="animate-fade-up">
                <h2 class="title-md">Pick a date & time</h2>
                <p class="mt-1 text-sm text-taupe">Times update live as other clients book.</p>
                <div class="mt-6"><nea-slot-picker [serviceId]="sv.id" [employeeId]="employeeId()" (picked)="slot.set($event)" /></div>
                <div class="mt-6 flex justify-end"><button class="btn-primary" [disabled]="!slot()" (click)="step.set(4)">Continue <ui-icon name="arrow" [size]="16" /></button></div>
              </div>
            }

            <!-- 4 · details -->
            @if (step() === 4) {
              <form class="animate-fade-up space-y-4" (ngSubmit)="step.set(5)" #f="ngForm">
                <h2 class="title-md">Your details</h2>
                @if (auth.user()?.customer) {
                  <p class="rounded-xl bg-cream/70 px-4 py-3 text-sm">Booking as <b>{{ auth.user()?.customer?.fullName }}</b> — the appointment will be added to your account.</p>
                } @else {
                  <p class="text-sm text-taupe">No account needed — your phone number identifies your bookings and loyalty card.</p>
                  <div><label class="label" for="n">Full name</label><input id="n" class="input" name="fullName" [(ngModel)]="form.fullName" required minlength="2" autocomplete="name" /></div>
                  <div class="grid gap-4 sm:grid-cols-2">
                    <div><label class="label" for="p">Phone</label><input id="p" class="input" name="phone" [(ngModel)]="form.phone" required minlength="9" placeholder="06 12 34 56 78" autocomplete="tel" inputmode="tel" /></div>
                    <div><label class="label" for="e">Email <span class="normal-case tracking-normal">(optional)</span></label><input id="e" class="input" type="email" name="email" [(ngModel)]="form.email" email autocomplete="email" /></div>
                  </div>
                }
                <div><label class="label" for="no">Note for the team <span class="normal-case tracking-normal">(optional)</span></label><textarea id="no" class="input" rows="3" name="notes" [(ngModel)]="form.notes" maxlength="500"></textarea></div>
                <div class="flex justify-end"><button class="btn-primary" type="submit" [disabled]="!auth.user()?.customer && f.invalid">Review booking <ui-icon name="arrow" [size]="16" /></button></div>
              </form>
            }

            <!-- 5 · summary -->
            @if (step() === 5 && service(); as sv) {
              <div class="animate-fade-up">
                <h2 class="title-md">Confirm your appointment</h2>
                <div class="card-pad mt-5 space-y-3 text-sm">
                  <p class="flex justify-between"><span class="text-taupe">Service</span><span>{{ sv.name }}</span></p>
                  <p class="flex justify-between"><span class="text-taupe">With</span><span>{{ employeeName() }}</span></p>
                  <p class="flex justify-between"><span class="text-taupe">Date</span><span>{{ slot() ? dateLong(slot()!.startAt) : '' }}</span></p>
                  <p class="flex justify-between"><span class="text-taupe">Time</span><span>{{ slot()?.time }} · {{ sv.durationMinutes }} min</span></p>
                  <p class="flex justify-between"><span class="text-taupe">Name</span><span>{{ auth.user()?.customer?.fullName || form.fullName }}</span></p>
                  @if (!auth.user()?.customer) { <p class="flex justify-between"><span class="text-taupe">Phone</span><span>{{ form.phone }}</span></p> }
                  <div class="divider !my-4"></div>
                  <p class="flex justify-between text-base"><span>Total (paid at the salon)</span><span class="font-medium text-burgundy">{{ mad(sv.priceMad) }}</span></p>
                </div>
                @if (s()?.cancellationPolicyText) { <p class="mt-4 text-xs leading-relaxed text-taupe">{{ s()?.cancellationPolicyText }}</p> }
                <div class="mt-6 flex justify-end"><button class="btn-primary btn-lg" (click)="confirm()" [disabled]="submitting()">{{ submitting() ? 'Booking…' : 'Confirm booking' }}</button></div>
              </div>
            }
          </div>

          <!-- summary aside -->
          <aside class="h-fit lg:sticky lg:top-24">
            <div class="panel p-5 text-sm">
              <p class="eyebrow mb-3">Your selection</p>
              <p class="font-display text-xl">{{ service()?.name || 'No service yet' }}</p>
              @if (service(); as sv) { <p class="text-taupe">{{ sv.durationMinutes }} min · {{ mad(sv.priceMad) }}</p> }
              @if (step() > 2) { <p class="mt-3 flex items-center gap-2"><ui-icon name="user" [size]="15" class="text-taupe" />{{ employeeName() }}</p> }
              @if (slot(); as sl) { <p class="mt-2 flex items-center gap-2"><ui-icon name="calendar" [size]="15" class="text-taupe" />{{ dateLong(sl.startAt) }}, {{ sl.time }}</p> }
            </div>
          </aside>
        </div>
      } @else {
        <!-- 6 · confirmation -->
        @let a = done()!;
        <div class="mx-auto max-w-xl py-10 text-center animate-fade-up">
          <span class="mx-auto flex size-16 items-center justify-center rounded-full bg-burgundy text-white"><ui-icon name="check" [size]="28" /></span>
          <p class="eyebrow mt-6">{{ a.status === 'CONFIRMED' ? 'Confirmed' : 'Booking received' }}</p>
          <h1 class="title-lg mt-2">See you soon, {{ a.customer.fullName.split(' ')[0] }}</h1>
          <p class="mt-4 text-brown/75">{{ a.service.name }} with {{ a.employee.firstName }} — {{ dateLong(a.startAt) }} at {{ time(a.startAt) }}.</p>
          @if (a.status === 'PENDING') { <p class="mt-2 text-sm text-taupe">The salon will confirm your appointment shortly.</p> }
          <div class="card-pad mx-auto mt-8 max-w-sm">
            <p class="eyebrow">Booking reference</p>
            <p class="mt-2 font-display text-4xl tracking-[0.12em] text-burgundy">{{ a.reference }}</p>
            <p class="mt-2 text-xs text-taupe">Keep it to manage or cancel your booking.</p>
          </div>
          <div class="mt-8 flex flex-wrap justify-center gap-3">
            @if (auth.user()?.customer) {
              <a routerLink="/account" class="btn-primary">Go to my account</a>
            } @else {
              <a routerLink="/account/create" [queryParams]="{ ref: a.reference }" class="btn-primary"><ui-icon name="gift" [size]="16" /> Open my loyalty card</a>
            }
            <a routerLink="/booking/manage" [queryParams]="{ ref: a.reference }" class="btn-outline">Manage booking</a>
          </div>
        </div>
      }
    </section>
  `,
})
export class BookingPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  s = this.api.settings;
  /** ?service=… pre-selection (component input binding) */
  serviceParam = input<string | undefined>(undefined, { alias: 'service' });

  steps = [
    { n: 1, label: 'Service' },
    { n: 2, label: 'Team member' },
    { n: 3, label: 'Date & time' },
    { n: 4, label: 'Details' },
    { n: 5, label: 'Confirm' },
  ];
  step = signal<Step>(1);
  categories = signal<Category[]>([]);
  services = signal<Service[]>([]);
  titles = signal<Record<string, string>>({});
  cat = signal<string | null>(null);
  service = signal<Service | null>(null);
  employeeId = signal<string | null>(null);
  step2Touched = signal(false);
  slot = signal<PickedSlot | null>(null);
  submitting = signal(false);
  done = signal<Appointment | null>(null);
  form = { fullName: '', phone: '', email: '', notes: '' };
  visibleServices = computed(() => this.services().filter((s) => !this.cat() || s.category.id === this.cat()));
  employeeName = computed(() => {
    const id = this.employeeId();
    return id ? (this.service()?.employees.find((e) => e.id === id)?.name ?? '') : 'Any available team member';
  });
  mad = mad;
  dateLong = dateLong;
  time = time;

  constructor() {
    this.api.categories().then((c) => this.categories.set(c));
    this.api.employees().then((list) => this.titles.set(Object.fromEntries(list.map((e) => [e.id, e.title ?? '']))));
    this.api.services().then((list) => {
      this.services.set(list);
      const pre = list.find((s) => s.id === this.serviceParam());
      if (pre) this.chooseService(pre);
    });
  }

  titleOf(id: string) { return this.titles()[id] ?? ''; }
  go(n: number) { this.step.set(n as Step); }
  chooseService(s: Service) {
    this.service.set(s);
    this.employeeId.set(null);
    this.slot.set(null);
    this.step.set(2);
  }
  chooseEmployee(id: string | null) {
    this.employeeId.set(id);
    this.step2Touched.set(true);
    this.slot.set(null);
    this.step.set(3);
  }

  async confirm() {
    const sv = this.service();
    const sl = this.slot();
    if (!sv || !sl) return;
    this.submitting.set(true);
    try {
      const a = await this.api.book({
        serviceId: sv.id,
        employeeId: this.employeeId(),
        startAt: sl.startAt,
        customer: this.auth.user()?.customer ? undefined : { fullName: this.form.fullName, phone: this.form.phone, email: this.form.email },
        notes: this.form.notes || undefined,
      });
      this.done.set(a);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      this.toast.error(e);
      if ((e as { status?: number }).status === 409) {
        this.slot.set(null);
        this.step.set(3);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  protected readonly errorMessage = errorMessage;
}

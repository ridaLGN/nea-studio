import { Component, inject, input, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { Icon } from '../shared/ui';

@Component({
  selector: 'nea-login',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="mx-auto max-w-md px-4 pt-16">
      <p class="eyebrow text-center">Welcome back</p>
      <h1 class="title-lg mt-3 text-center">Sign in</h1>
      <form class="card-pad mt-8 space-y-4" (ngSubmit)="submit()">
        <div><label class="label" for="em">Email</label><input id="em" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="username" /></div>
        <div><label class="label" for="pw">Password</label><input id="pw" class="input" type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" /></div>
        <button class="btn-primary w-full" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <div class="mt-6 rounded-2xl bg-cream/60 p-5 text-sm">
        <p class="font-medium">New client?</p>
        <p class="mt-1 text-taupe">Book first — then open your account with your booking reference to access your loyalty card.</p>
        <div class="mt-3 flex gap-2"><a routerLink="/booking" class="btn-primary btn-sm">Book</a><a routerLink="/account/create" class="btn-outline btn-sm">I have a reference</a></div>
      </div>
    </section>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  next = input<string | undefined>();
  email = '';
  password = '';
  busy = signal(false);

  async submit() {
    this.busy.set(true);
    try {
      const u = await this.auth.login(this.email, this.password);
      this.router.navigateByUrl(this.next() || this.auth.homeFor(u.role));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'nea-claim',
  imports: [FormsModule, RouterLink, Icon],
  template: `
    <section class="mx-auto max-w-md px-4 pt-16">
      <div class="flex justify-center"><span class="flex size-14 items-center justify-center rounded-full bg-burgundy-soft text-burgundy"><ui-icon name="gift" [size]="24" /></span></div>
      <h1 class="title-lg mt-4 text-center">Open my loyalty account</h1>
      <p class="mt-3 text-center text-sm text-taupe">Use the reference of one of your bookings and the phone number you booked with. Your visits, stamps and rewards will appear in your account.</p>
      <form class="card-pad mt-8 space-y-4" (ngSubmit)="submit()">
        <div><label class="label" for="r">Booking reference</label><input id="r" class="input uppercase tracking-widest" name="reference" [(ngModel)]="reference" required placeholder="NEA-XXXXXX" /></div>
        <div><label class="label" for="p">Phone number</label><input id="p" class="input" name="phone" [(ngModel)]="phone" required inputmode="tel" /></div>
        <div><label class="label" for="e">Email (for signing in)</label><input id="e" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="email" /></div>
        <div><label class="label" for="w">Choose a password</label><input id="w" class="input" type="password" name="password" [(ngModel)]="password" required minlength="8" autocomplete="new-password" /><p class="mt-1 text-xs text-taupe">At least 8 characters.</p></div>
        <button class="btn-primary w-full" [disabled]="busy()">Create my account</button>
        <p class="text-center text-xs text-taupe">Already have one? <a routerLink="/login" class="text-burgundy underline">Sign in</a></p>
      </form>
    </section>
  `,
})
export class ClaimPage implements OnInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);
  ref = input<string | undefined>();
  reference = '';
  phone = '';
  email = '';
  password = '';
  busy = signal(false);
  ngOnInit() {
    this.reference = this.ref() ?? '';
  }
  async submit() {
    this.busy.set(true);
    try {
      await this.auth.claim({ reference: this.reference, phone: this.phone, email: this.email, password: this.password });
      this.toast.success('Welcome! Your loyalty card is ready.');
      this.router.navigateByUrl('/account');
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}

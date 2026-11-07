import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { hhmm, WEEKDAYS } from '../core/format';
import { Icon, Logo } from '../shared/ui';

@Component({
  selector: 'nea-public-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo, Icon],
  template: `
    <header class="sticky top-0 z-40 border-b border-cream/70 bg-ivory/85 backdrop-blur-md">
      <div class="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-4 py-3 md:px-8">
        <a routerLink="/" aria-label="NÉA STUDIO home"><ui-logo /></a>
        <nav class="hidden items-center gap-8 lg:flex">
          @for (l of links; track l.path) {
            <a [routerLink]="l.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: l.path === '/' }" class="nav-link">{{ l.label }}</a>
          }
        </nav>
        <div class="flex items-center gap-2">
          <a [routerLink]="accountLink()" class="btn-ghost btn-sm hidden sm:inline-flex"><ui-icon name="user" [size]="16" />{{ auth.user() ? 'My space' : 'Sign in' }}</a>
          <a routerLink="/booking" class="btn-primary btn-sm">Book now</a>
          <button class="icon-btn lg:hidden" (click)="menu.set(!menu())" aria-label="Menu"><ui-icon [name]="menu() ? 'x' : 'menu'" /></button>
        </div>
      </div>
      @if (menu()) {
        <nav class="border-t border-cream bg-ivory px-4 pb-6 pt-2 lg:hidden animate-fade">
          @for (l of links; track l.path) {
            <a [routerLink]="l.path" (click)="menu.set(false)" class="block border-b border-cream/70 py-3.5 font-display text-2xl">{{ l.label }}</a>
          }
          <a [routerLink]="accountLink()" (click)="menu.set(false)" class="block py-3.5 font-display text-2xl">{{ auth.user() ? 'My space' : 'Customer account' }}</a>
        </nav>
      }
    </header>

    <main><router-outlet /></main>

    <footer class="mt-24 bg-brown text-ivory">
      <div class="mx-auto grid max-w-7xl gap-10 px-4 py-16 md:grid-cols-4 md:px-8">
        <div class="md:col-span-1">
          <ui-logo [light]="true" />
          <p class="mt-5 max-w-xs text-sm text-ivory/60">{{ s()?.tagline || 'Beauty & wellbeing studio' }}</p>
        </div>
        <div>
          <p class="eyebrow !text-ivory/50 mb-4">Visit</p>
          <p class="text-sm text-ivory/80">{{ s()?.address }}</p>
          <p class="text-sm text-ivory/80">{{ s()?.city }}, Morocco</p>
          @if (s()?.phone) { <p class="mt-3 text-sm text-ivory/80">{{ s()?.phone }}</p> }
          @if (s()?.email) { <p class="text-sm text-ivory/80">{{ s()?.email }}</p> }
        </div>
        <div>
          <p class="eyebrow !text-ivory/50 mb-4">Opening hours</p>
          @for (o of hours(); track o.day) {
            <p class="flex justify-between gap-4 text-sm text-ivory/80"><span>{{ o.day }}</span><span>{{ o.hours }}</span></p>
          }
        </div>
        <div>
          <p class="eyebrow !text-ivory/50 mb-4">NÉA</p>
          <a routerLink="/booking" class="block py-1 text-sm text-ivory/80 hover:text-white">Book an appointment</a>
          <a routerLink="/booking/manage" class="block py-1 text-sm text-ivory/80 hover:text-white">Manage my booking</a>
          <a routerLink="/account" class="block py-1 text-sm text-ivory/80 hover:text-white">Loyalty card</a>
          <a routerLink="/login" class="block py-1 text-sm text-ivory/80 hover:text-white">Team sign-in</a>
          @if (s()?.instagram) { <a [href]="'https://instagram.com/' + s()?.instagram" target="_blank" rel="noopener" class="mt-3 inline-flex items-center gap-2 text-sm text-ivory/80 hover:text-white"><ui-icon name="instagram" [size]="16" />{{ '@' + s()?.instagram }}</a> }
        </div>
      </div>
      <div class="border-t border-white/10 py-5 text-center text-xs text-ivory/40">© {{ year }} {{ s()?.name || 'NÉA STUDIO' }} · Marrakech</div>
    </footer>
  `,
})
export class PublicLayout {
  auth = inject(AuthService);
  s = inject(ApiService).settings;
  menu = signal(false);
  year = new Date().getFullYear();
  links = [
    { path: '/', label: 'Home' },
    { path: '/services', label: 'Services' },
    { path: '/booking', label: 'Book' },
    { path: '/about', label: 'About' },
    { path: '/gallery', label: 'Gallery' },
    { path: '/contact', label: 'Contact' },
  ];
  accountLink = computed(() => (this.auth.user() ? this.auth.homeFor(this.auth.user()!.role) : '/login'));
  hours = computed(() =>
    (this.s()?.openingHours ?? []).map((o) => ({ day: WEEKDAYS[o.weekday - 1].slice(0, 3), hours: o.isClosed ? 'Closed' : `${hhmm(o.openMinute)} – ${hhmm(o.closeMinute)}` })),
  );
}

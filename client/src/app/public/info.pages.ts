import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { hhmm, WEEKDAYS } from '../core/format';
import type { PublicEmployee } from '../core/models';
import { Avatar, Icon, Photo } from '../shared/ui';

@Component({
  selector: 'nea-about',
  imports: [RouterLink, Photo, Avatar],
  template: `
    <section class="mx-auto max-w-7xl px-4 pt-14 md:px-8">
      <div class="grid items-center gap-12 md:grid-cols-2">
        <div>
          <p class="eyebrow">About</p>
          <h1 class="title-lg mt-3">A studio shaped by warmth and simplicity</h1>
          <p class="mt-6 leading-relaxed text-brown/75">{{ s()?.name || 'NÉA STUDIO' }} was imagined as a calm refuge in {{ s()?.city || 'Marrakech' }}: cream walls, a burgundy counter, warm light and natural wood. Here, beauty is a ritual of attention — unhurried, precise and personal.</p>
          <p class="mt-4 leading-relaxed text-brown/75">Our team combines technique and listening to create results that look like you, only more radiant.</p>
          <a routerLink="/booking" class="btn-primary mt-8">Book a visit</a>
        </div>
        <ui-photo class="h-[30rem] arch shadow-[var(--shadow-lift)]" src="/images/salon-reception.jpg" label="salon-reception.jpg" />
      </div>

      <h2 class="title-lg mt-24">The team</h2>
      <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        @for (e of team(); track e.id) {
          <div class="card-pad text-center">
            <div class="flex justify-center"><ui-avatar [name]="e.firstName + ' ' + e.lastName" [src]="e.photoUrl" [color]="e.color" [size]="88" /></div>
            <p class="mt-4 font-display text-2xl">{{ e.firstName }} {{ e.lastName }}</p>
            <p class="text-sm text-taupe">{{ e.title }}</p>
            @if (e.isDemo) { <span class="badge-demo mt-3">Demo profile</span> }
          </div>
        }
      </div>
    </section>
  `,
})
export class AboutPage {
  private api = inject(ApiService);
  s = this.api.settings;
  team = signal<PublicEmployee[]>([]);
  constructor() {
    this.api.employees().then((t) => this.team.set(t));
  }
}

@Component({
  selector: 'nea-gallery',
  imports: [Photo, Icon],
  template: `
    <section class="mx-auto max-w-7xl px-4 pt-14 md:px-8">
      <p class="eyebrow">Gallery</p>
      <h1 class="title-lg mt-3">Inside the studio</h1>
      <div class="mt-10 columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
        @for (p of photos; track p.src) {
          <button class="block w-full break-inside-avoid overflow-hidden rounded-[1.5rem] text-left" (click)="open.set(p.src)">
            <ui-photo [class]="p.h + ' transition duration-500 hover:scale-[1.03]'" [src]="p.src" [tone]="p.tone" [label]="p.src.replace('/images/', '')" />
          </button>
        }
      </div>
      <p class="mt-6 text-sm text-taupe">Add the salon photographs to <code>client/public/images/</code> with the file names shown to replace these placeholders.</p>
    </section>
    @if (open()) {
      <div class="overlay flex items-center justify-center p-4" (click)="open.set(null)">
        <ui-photo class="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-3xl aspect-[4/3]" [src]="open()!" />
        <button class="absolute right-6 top-6 icon-btn bg-white"><ui-icon name="x" /></button>
      </div>
    }
  `,
})
export class GalleryPage {
  open = signal<string | null>(null);
  photos: { src: string; h: string; tone: 'warm' | 'cream' | 'deep' }[] = [
    { src: '/images/salon-hero.jpg', h: 'h-96', tone: 'warm' },
    { src: '/images/salon-reception.jpg', h: 'h-64', tone: 'deep' },
    { src: '/images/salon-interior.jpg', h: 'h-80', tone: 'cream' },
    { src: '/images/products-1.jpg', h: 'h-72', tone: 'warm' },
    { src: '/images/salon-2.jpg', h: 'h-96', tone: 'cream' },
    { src: '/images/salon-3.jpg', h: 'h-64', tone: 'deep' },
    { src: '/images/products-2.jpg', h: 'h-80', tone: 'cream' },
    { src: '/images/products-3.jpg', h: 'h-72', tone: 'warm' },
  ];
}

@Component({
  selector: 'nea-contact',
  imports: [RouterLink, Icon],
  template: `
    <section class="mx-auto max-w-5xl px-4 pt-14 md:px-8">
      <p class="eyebrow">Contact</p>
      <h1 class="title-lg mt-3">We would love to welcome you</h1>
      <div class="mt-10 grid gap-6 md:grid-cols-2">
        <div class="card-pad space-y-5">
          <p class="flex items-start gap-3"><ui-icon name="map" class="mt-0.5 text-burgundy" /><span>{{ s()?.address }}<br />{{ s()?.city }}, Morocco</span></p>
          @if (s()?.phone) { <a [href]="'tel:' + s()?.phone" class="flex items-center gap-3 hover:text-burgundy"><ui-icon name="phone" class="text-burgundy" />{{ s()?.phone }}</a> }
          @if (s()?.email) { <a [href]="'mailto:' + s()?.email" class="flex items-center gap-3 hover:text-burgundy"><ui-icon name="mail" class="text-burgundy" />{{ s()?.email }}</a> }
          @if (s()?.instagram) { <a [href]="'https://instagram.com/' + s()?.instagram" target="_blank" rel="noopener" class="flex items-center gap-3 hover:text-burgundy"><ui-icon name="instagram" class="text-burgundy" />{{ '@' + s()?.instagram }}</a> }
          @if (!s()?.phone && !s()?.email) { <p class="text-sm text-taupe">Contact details will appear here once configured in Settings.</p> }
          <a routerLink="/booking" class="btn-primary">Book online</a>
        </div>
        <div class="card-pad">
          <p class="eyebrow mb-4">Opening hours</p>
          @for (o of hours(); track o.day) {
            <p class="flex justify-between border-b border-cream py-2.5 text-sm last:border-0"><span>{{ o.day }}</span><span [class.text-taupe]="o.closed">{{ o.hours }}</span></p>
          }
        </div>
      </div>
    </section>
  `,
})
export class ContactPage {
  s = inject(ApiService).settings;
  hours = computed(() =>
    (this.s()?.openingHours ?? []).map((o) => ({ day: WEEKDAYS[o.weekday - 1], closed: o.isClosed, hours: o.isClosed ? 'Closed' : `${hhmm(o.openMinute)} – ${hhmm(o.closeMinute)}` })),
  );
}

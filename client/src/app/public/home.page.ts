import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { mad } from '../core/format';
import type { Service } from '../core/models';
import { Icon, Photo } from '../shared/ui';

@Component({
  selector: 'nea-home',
  imports: [RouterLink, Icon, Photo],
  template: `
    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div class="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:grid-cols-12 md:px-8 md:pb-24 md:pt-16">
        <div class="md:col-span-6 animate-fade-up">
          <p class="eyebrow">Beauty & wellbeing · {{ s()?.city || 'Marrakech' }}</p>
          <h1 class="title-xl mt-5">The art of<br /><em class="text-burgundy">feeling beautiful</em></h1>
          <p class="mt-6 max-w-md text-lg leading-relaxed text-brown/75">
            Welcome to {{ s()?.name || 'NÉA STUDIO' }} — a warm, quiet space of cream walls, soft light and attentive hands, where every visit is a moment for yourself.
          </p>
          <div class="mt-9 flex flex-wrap gap-3">
            <a routerLink="/booking" class="btn-primary btn-lg">Book an appointment <ui-icon name="arrow" [size]="16" /></a>
            <a routerLink="/services" class="btn-outline btn-lg">Discover our services</a>
          </div>
          <div class="mt-10 flex items-center gap-6 text-sm text-taupe">
            <span class="flex items-center gap-2"><ui-icon name="clock" [size]="16" /> Book online 24/7</span>
            <span class="flex items-center gap-2"><ui-icon name="gift" [size]="16" /> Digital loyalty card</span>
          </div>
        </div>
        <div class="relative md:col-span-6">
          <div class="grid grid-cols-5 gap-4">
            <ui-photo class="col-span-3 h-[26rem] arch shadow-[var(--shadow-lift)] md:h-[34rem]" src="/images/salon-hero.jpg" alt="NÉA STUDIO reception" label="salon-hero.jpg" />
            <div class="col-span-2 flex flex-col gap-4 pt-16">
              <ui-photo class="h-48 rounded-[1.5rem] md:h-60" src="/images/salon-2.jpg" tone="cream" label="salon-2.jpg" />
              <ui-photo class="h-40 rounded-[1.5rem] md:h-52" src="/images/salon-3.jpg" tone="deep" label="salon-3.jpg" />
            </div>
          </div>
          <div class="absolute -bottom-6 left-6 card flex items-center gap-3 px-5 py-4 animate-fade-up">
            <span class="flex size-10 items-center justify-center rounded-full bg-burgundy-soft text-burgundy"><ui-icon name="calendar" /></span>
            <div><p class="text-sm font-medium">Real-time availability</p><p class="text-xs text-taupe">Choose your time, confirmed instantly</p></div>
          </div>
        </div>
      </div>
    </section>

    <!-- Featured services -->
    <section class="bg-cream/50 py-20">
      <div class="mx-auto max-w-7xl px-4 md:px-8">
        <div class="flex flex-wrap items-end justify-between gap-6">
          <div><p class="eyebrow">Signature care</p><h2 class="title-lg mt-3">Featured services</h2></div>
          <a routerLink="/services" class="btn-ghost">All services <ui-icon name="arrow" [size]="16" /></a>
        </div>
        <div class="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          @for (sv of featured(); track sv.id) {
            <a [routerLink]="['/booking']" [queryParams]="{ service: sv.id }" class="group card overflow-hidden transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
              <ui-photo class="h-48" [src]="sv.imageUrl || '/images/service-' + sv.category.slug + '.jpg'" [tone]="$index % 2 ? 'cream' : 'warm'" />
              <div class="p-5">
                <p class="eyebrow">{{ sv.category.name }}</p>
                <h3 class="mt-1 font-display text-2xl">{{ sv.name }}</h3>
                <div class="mt-4 flex items-center justify-between text-sm">
                  <span class="text-taupe">{{ sv.durationMinutes }} min</span>
                  <span class="font-medium text-burgundy">{{ mad(sv.priceMad) }}</span>
                </div>
              </div>
            </a>
          } @empty {
            @for (i of [1, 2, 3, 4]; track i) { <div class="card h-72 skeleton"></div> }
          }
        </div>
        @if (hasDemo()) { <p class="mt-6 text-center text-xs text-taupe">Services and prices shown are demo data and will be replaced with the salon's real menu.</p> }
      </div>
    </section>

    <!-- About -->
    <section class="mx-auto grid max-w-7xl items-center gap-12 px-4 py-24 md:grid-cols-2 md:px-8">
      <ui-photo class="h-[28rem] rounded-[2rem] shadow-[var(--shadow-soft)]" src="/images/salon-interior.jpg" tone="cream" label="salon-interior.jpg" />
      <div>
        <p class="eyebrow">About the studio</p>
        <h2 class="title-lg mt-3">A minimalist sanctuary,<br />warm and personal</h2>
        <p class="mt-6 leading-relaxed text-brown/75">Behind our burgundy reception counter, the studio unfolds in soft cream tones, natural wood and gentle lighting. It is a place designed to slow down — where our team takes the time to listen, advise and care for you.</p>
        <a routerLink="/about" class="btn-outline mt-8">Our story</a>
      </div>
    </section>

    <!-- Why -->
    <section class="bg-brown py-20 text-ivory">
      <div class="mx-auto max-w-7xl px-4 md:px-8">
        <p class="eyebrow !text-ivory/50">Why NÉA</p>
        <h2 class="title-lg mt-3 !text-ivory">Every detail, considered</h2>
        <div class="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          @for (w of why; track w.title) {
            <div class="border-t border-white/15 pt-6">
              <ui-icon [name]="w.icon" [size]="22" />
              <h3 class="mt-4 font-display text-2xl">{{ w.title }}</h3>
              <p class="mt-2 text-sm leading-relaxed text-ivory/65">{{ w.text }}</p>
            </div>
          }
        </div>
      </div>
    </section>

    <!-- Products -->
    <section class="mx-auto max-w-7xl px-4 py-24 md:px-8">
      <div class="grid items-center gap-12 md:grid-cols-12">
        <div class="md:col-span-5">
          <p class="eyebrow">The beauty shelf</p>
          <h2 class="title-lg mt-3">Professional care to take home</h2>
          <p class="mt-6 leading-relaxed text-brown/75">Our team selects the products used in the studio and can recommend the right routine for your hair and skin. Ask at the reception during your visit.</p>
        </div>
        <div class="grid grid-cols-3 gap-4 md:col-span-7">
          <ui-photo class="h-56 rounded-[1.5rem] md:h-72" src="/images/products-1.jpg" label="products-1.jpg" />
          <ui-photo class="mt-10 h-56 rounded-[1.5rem] md:h-72" src="/images/products-2.jpg" tone="cream" label="products-2.jpg" />
          <ui-photo class="h-56 rounded-[1.5rem] md:h-72" src="/images/products-3.jpg" tone="deep" label="products-3.jpg" />
        </div>
      </div>
    </section>

    <!-- Testimonials -->
    <section class="bg-cream/50 py-20">
      <div class="mx-auto max-w-5xl px-4 text-center md:px-8">
        <p class="eyebrow">Kind words</p>
        <h2 class="title-lg mt-3">What our clients say</h2>
        <div class="mt-10 min-h-40">
          <p class="font-display text-2xl italic leading-relaxed md:text-3xl">“{{ testimonials[t()].quote }}”</p>
          <p class="mt-5 text-sm text-taupe">— {{ testimonials[t()].name }}</p>
        </div>
        <div class="mt-6 flex justify-center gap-2">
          @for (x of testimonials; track $index) {
            <button class="h-1.5 rounded-full transition-all" [class]="t() === $index ? 'w-8 bg-burgundy' : 'w-3 bg-beige'" (click)="t.set($index)" [attr.aria-label]="'Testimonial ' + ($index + 1)"></button>
          }
        </div>
        <p class="mt-6 text-xs text-taupe">Sample testimonials — replace with real client reviews.</p>
      </div>
    </section>

    <!-- Instagram -->
    <section class="mx-auto max-w-7xl px-4 py-24 md:px-8">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div><p class="eyebrow">Instagram</p><h2 class="title-lg mt-3">{{ s()?.instagram ? '@' + s()?.instagram : 'Follow the studio' }}</h2></div>
        @if (s()?.instagram) { <a [href]="'https://instagram.com/' + s()?.instagram" target="_blank" rel="noopener" class="btn-outline"><ui-icon name="instagram" [size]="16" /> Follow us</a> }
      </div>
      <div class="mt-10 grid grid-cols-3 gap-3 md:grid-cols-6">
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <ui-photo class="aspect-square rounded-2xl" [src]="'/images/instagram-' + i + '.jpg'" [tone]="i % 3 === 0 ? 'deep' : i % 2 ? 'warm' : 'cream'" />
        }
      </div>
      @if (!s()?.instagram) { <p class="mt-4 text-xs text-taupe">Add the salon's Instagram handle in Settings and drop images named instagram-1.jpg … instagram-6.jpg in /public/images.</p> }
    </section>

    <!-- Location -->
    <section class="mx-auto max-w-7xl px-4 md:px-8">
      <div class="card grid overflow-hidden md:grid-cols-2">
        <div class="p-8 md:p-12">
          <p class="eyebrow">Visit us</p>
          <h2 class="title-lg mt-3">{{ s()?.name || 'NÉA STUDIO' }}</h2>
          <div class="mt-8 space-y-4 text-sm">
            <p class="flex items-start gap-3"><ui-icon name="map" class="mt-0.5 text-burgundy" />{{ s()?.address }}, {{ s()?.city }}</p>
            @if (s()?.phone) { <p class="flex items-center gap-3"><ui-icon name="phone" class="text-burgundy" />{{ s()?.phone }}</p> }
            @if (s()?.email) { <p class="flex items-center gap-3"><ui-icon name="mail" class="text-burgundy" />{{ s()?.email }}</p> }
          </div>
          <div class="mt-8 flex flex-wrap gap-3"><a routerLink="/booking" class="btn-primary">Book now</a><a routerLink="/contact" class="btn-outline">Contact</a></div>
        </div>
        <div class="min-h-72 bg-cream">
          <iframe class="h-full min-h-72 w-full border-0 grayscale-[0.4]" loading="lazy" [src]="mapUrl()" title="Map"></iframe>
        </div>
      </div>
    </section>
  `,
})
export class HomePage {
  private api = inject(ApiService);
  s = this.api.settings;
  services = signal<Service[]>([]);
  featured = computed(() => {
    const byCat = new Map<string, Service>();
    for (const sv of this.services()) if (!byCat.has(sv.category.id)) byCat.set(sv.category.id, sv);
    return [...byCat.values(), ...this.services()].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  });
  hasDemo = computed(() => this.services().some((s) => s.isDemo));
  mad = mad;
  t = signal(0);
  testimonials = [
    { quote: 'A real moment of calm in the middle of the city. I leave every time feeling lighter.', name: 'Sample client' },
    { quote: 'Booking online takes a minute and my loyalty card is always on my phone.', name: 'Sample client' },
    { quote: 'Beautiful space, attentive team — the kind of details that make you come back.', name: 'Sample client' },
  ];
  why = [
    { icon: 'heart', title: 'Attentive care', text: 'Time to listen, advise and personalise every treatment.' },
    { icon: 'leaf', title: 'Quality products', text: 'Professional products selected by our team.' },
    { icon: 'clock', title: 'On time', text: 'Live availability — your appointment is reserved just for you.' },
    { icon: 'gift', title: 'Rewarded loyalty', text: 'Every visit earns a stamp towards exclusive discounts.' },
  ];
  private sanitizer = inject(DomSanitizer);
  /** Keyless Google Maps embed of the configured address (constant host, encoded query => safe) */
  mapUrl = computed(() => {
    const q = encodeURIComponent(`${this.s()?.name ?? 'NÉA STUDIO'} ${this.s()?.address ?? ''} ${this.s()?.city ?? 'Marrakech'}`);
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.google.com/maps?q=${q}&output=embed`);
  });

  constructor() {
    this.api.services().then((s) => this.services.set(s));
    const id = setInterval(() => this.t.update((x) => (x + 1) % this.testimonials.length), 7000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}

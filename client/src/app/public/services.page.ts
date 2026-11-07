import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { mad, priceRange } from '../core/format';
import type { Category, Service } from '../core/models';
import { Avatar, Icon, Photo } from '../shared/ui';

@Component({
  selector: 'nea-services',
  imports: [RouterLink, Icon, Photo, Avatar],
  template: `
    <section class="mx-auto max-w-7xl px-4 pt-14 md:px-8">
      <p class="eyebrow">Our menu</p>
      <h1 class="title-lg mt-3">Services</h1>
      <p class="mt-4 max-w-xl text-brown/70">Choose a treatment, see who performs it and book the time that suits you.</p>

      <div class="mt-10 flex flex-wrap gap-2">
        <button class="tab" [class.active]="cat() === null" (click)="cat.set(null)">All</button>
        @for (c of categories(); track c.id) {
          <button class="tab" [class.active]="cat() === c.slug" (click)="cat.set(c.slug)">{{ c.name }}</button>
        }
      </div>

      <div class="mt-8 grid gap-6 md:grid-cols-2">
        @for (sv of filtered(); track sv.id) {
          <article class="card flex flex-col overflow-hidden sm:flex-row animate-fade-up">
            <ui-photo class="h-48 sm:h-auto sm:w-48 shrink-0" [src]="sv.imageUrl || '/images/service-' + sv.category.slug + '.jpg'" [tone]="$index % 2 ? 'cream' : 'warm'" />
            <div class="flex flex-1 flex-col p-6">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="eyebrow">{{ sv.category.name }}</p>
                  <h2 class="mt-1 font-display text-2xl">{{ sv.name }}</h2>
                </div>
                @if (sv.isDemo) { <span class="badge-demo">Demo</span> }
              </div>
              <p class="mt-2 flex-1 text-sm leading-relaxed text-brown/70">{{ sv.description }}</p>
              <div class="mt-4 flex items-center gap-4 text-sm">
                <span class="flex items-center gap-1.5 text-taupe"><ui-icon name="clock" [size]="15" />{{ sv.durationMinutes }} min</span>
                <span class="font-medium text-burgundy">{{ priceRange(sv) }}</span>
              </div>
              <div class="mt-5 flex items-center justify-between gap-3">
                <div class="flex -space-x-2" [title]="names(sv)">
                  @for (e of sv.employees; track e.id) { <ui-avatar [name]="e.name" [src]="e.photoUrl" [color]="e.color" [size]="30" /> }
                </div>
                <a routerLink="/booking" [queryParams]="{ service: sv.id }" class="btn-primary btn-sm">Book</a>
              </div>
            </div>
          </article>
        } @empty {
          <p class="text-taupe">No services in this category yet.</p>
        }
      </div>
    </section>
  `,
})
export class ServicesPage {
  private api = inject(ApiService);
  categories = signal<Category[]>([]);
  services = signal<Service[]>([]);
  cat = signal<string | null>(null);
  filtered = computed(() => this.services().filter((s) => !this.cat() || s.category.slug === this.cat()));
  mad = mad;
  priceRange = priceRange;
  names = (s: Service) => s.employees.map((e) => e.name).join(', ');
  constructor() {
    this.api.categories().then((c) => this.categories.set(c));
    this.api.services().then((s) => this.services.set(s));
  }
}

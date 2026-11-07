import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { ToastService } from '../core/toast.service';
import { STATUS_BADGE, STATUS_LABEL, initials } from '../core/format';

// ---------------------------------------------------------------------------
// Icons — a small, consistent 1.5px stroke set (24×24)
// ---------------------------------------------------------------------------
const ICONS: Record<string, string> = {
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  clock: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  users: 'M16 21a6 6 0 0 0-12 0M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21a6 6 0 0 0-4-5.6M16 3.1a4 4 0 0 1 0 7.8',
  scissors: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  sparkles: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3ZM19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17Z',
  qr: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4',
  scan: 'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
  chart: 'M3 3v18h18M7 16l4-5 4 3 5-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z',
  gift: 'M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7ZM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7Z',
  map: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0ZM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 6l-10 7L2 6',
  instagram: 'M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5ZM16 11.4A4 4 0 1 1 12.6 8a4 4 0 0 1 3.4 3.4ZM17.5 6.5h.01',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  card: 'M2 5h20v14H2zM2 10h20',
  refresh: 'M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  coffee: 'M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4ZM6 2v2M10 2v2M14 2v2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
  timeline: 'M3 6h8M7 12h12M5 18h9',
  leaf: 'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10ZM2 21c0-3 1.9-5.4 5.1-6',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};

@Component({
  selector: 'ui-icon',
  template: `<svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path()" /></svg>`,
  host: { class: 'inline-flex shrink-0' },
})
export class Icon {
  name = input.required<string>();
  size = input(18);
  stroke = input(1.5);
  path = computed(() => ICONS[this.name()] ?? ICONS['sparkles']);
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-logo',
  template: `
    <span class="inline-flex flex-col leading-none" [class.text-ivory]="light()">
      <span class="font-display tracking-[0.32em]" [class]="small() ? 'text-lg' : 'text-2xl'">NÉA</span>
      <span class="text-[0.55rem] tracking-[0.6em] mt-0.5 opacity-70 pl-0.5">STUDIO</span>
    </span>
  `,
})
export class Logo {
  light = input(false);
  small = input(false);
}

// ---------------------------------------------------------------------------
// Badges & avatars
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-status',
  template: `<span [class]="cls()">{{ label() }}</span>`,
})
export class StatusBadge {
  status = input.required<string>();
  cls = computed(() => STATUS_BADGE[this.status()] ?? 'badge-neutral');
  label = computed(() => STATUS_LABEL[this.status()] ?? this.status());
}

@Component({
  selector: 'ui-avatar',
  template: `
    @if (src() && !failed()) {
      <img [src]="src()" [alt]="name()" (error)="failed.set(true)" class="rounded-full object-cover ring-2 ring-white" [style.width.px]="size()" [style.height.px]="size()" />
    } @else {
      <span class="inline-flex items-center justify-center rounded-full font-medium text-white ring-2 ring-white" [style.width.px]="size()" [style.height.px]="size()" [style.background]="color()" [style.fontSize.px]="size() * 0.38">{{ ini() }}</span>
    }
  `,
  host: { class: 'inline-flex shrink-0' },
})
export class Avatar {
  name = input('');
  src = input<string | null | undefined>(null);
  color = input('#783D43');
  size = input(36);
  failed = signal(false);
  ini = computed(() => initials(this.name()));
}

// ---------------------------------------------------------------------------
// Photo slot: shows the real salon photo when present in /public/images,
// otherwise an elegant arch-shaped placeholder in the brand palette.
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-photo',
  imports: [Icon],
  template: `
    @if (!failed()) {
      <img [src]="src()" [alt]="alt()" (error)="failed.set(true)" class="h-full w-full object-cover" loading="lazy" />
    } @else {
      <div class="relative h-full w-full overflow-hidden" [style.background]="bg()">
        <div class="absolute inset-0 grain opacity-60"></div>
        <div class="absolute left-1/2 top-[18%] h-[70%] w-[46%] -translate-x-1/2 arch border border-white/50 bg-white/10"></div>
        <div class="absolute bottom-[12%] left-[12%] right-[12%] h-[14%] rounded-t-2xl bg-burgundy/80 shadow-lg"></div>
        <div class="absolute bottom-[26%] left-[20%] h-[18%] w-[2px] bg-white/40"></div>
        <div class="absolute bottom-[26%] right-[20%] h-[18%] w-[2px] bg-white/40"></div>
        @if (label()) {
          <span class="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[0.65rem] text-brown"><ui-icon name="camera" [size]="12" />{{ label() }}</span>
        }
      </div>
    }
  `,
  host: { class: 'block overflow-hidden' },
})
export class Photo {
  src = input.required<string>();
  alt = input('NÉA STUDIO');
  label = input<string>('');
  tone = input<'warm' | 'cream' | 'deep'>('warm');
  failed = signal(false);
  bg = computed(() =>
    this.tone() === 'deep'
      ? 'linear-gradient(160deg,#5E4B43 0%,#3D302B 100%)'
      : this.tone() === 'cream'
        ? 'linear-gradient(160deg,#F7F3ED 0%,#D8C6B2 100%)'
        : 'linear-gradient(160deg,#EDE5D9 0%,#C9AE94 55%,#A0674B 100%)',
  );
  constructor() {
    effect(() => {
      this.src();
      this.failed.set(false);
    });
  }
}

// ---------------------------------------------------------------------------
// Modal & drawer
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-modal',
  imports: [Icon, NgClass],
  template: `
    @if (open()) {
      <div class="overlay" (click)="closed.emit()"></div>
      <div [ngClass]="drawer() ? 'drawer' : 'modal'" [class.!max-w-3xl]="wide()" role="dialog" aria-modal="true">
        <div class="flex items-start justify-between gap-4" [class.p-6]="drawer()" [class.pb-4]="drawer()" [class.mb-4]="!drawer()" [class.border-b]="drawer()" [class.border-cream]="drawer()" [class.sticky]="drawer()" [class.top-0]="drawer()" [class.bg-ivory]="drawer()" [class.z-10]="drawer()">
          <div>
            @if (eyebrow()) { <p class="eyebrow mb-1">{{ eyebrow() }}</p> }
            <h2 class="title-md">{{ title() }}</h2>
          </div>
          <button class="icon-btn" (click)="closed.emit()" aria-label="Close"><ui-icon name="x" /></button>
        </div>
        <div [class.px-6]="drawer()" [class.pb-8]="drawer()" [class.pt-4]="drawer()"><ng-content /></div>
      </div>
    }
  `,
})
export class Modal {
  open = input(false);
  title = input('');
  eyebrow = input('');
  drawer = input(false);
  wide = input(false);
  closed = output<void>();
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-toasts',
  imports: [Icon],
  template: `
    <div class="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2 md:left-auto md:right-6 md:translate-x-0">
      @for (t of toast.toasts(); track t.id) {
        <div class="card flex items-start gap-3 px-4 py-3 animate-fade-up" [class.!border-absent/30]="t.kind === 'error'">
          <span class="mt-0.5" [class.text-free-strong]="t.kind === 'success'" [class.text-absent]="t.kind === 'error'" [class.text-burgundy]="t.kind === 'info'">
            <ui-icon [name]="t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'bell'" />
          </span>
          <p class="flex-1 text-sm">{{ t.text }}</p>
          <button class="text-taupe hover:text-brown" (click)="toast.dismiss(t.id)"><ui-icon name="x" [size]="14" /></button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  toast = inject(ToastService);
}

// ---------------------------------------------------------------------------
// Stat card / empty state / spinner
// ---------------------------------------------------------------------------
@Component({
  selector: 'ui-stat',
  imports: [Icon],
  template: `
    <div class="card-pad h-full">
      <div class="flex items-center justify-between">
        <p class="eyebrow">{{ label() }}</p>
        @if (icon()) { <span class="flex size-8 items-center justify-center rounded-full" [class]="accentCls()"><ui-icon [name]="icon()" [size]="16" /></span> }
      </div>
      <p class="mt-3 font-display text-3xl md:text-4xl leading-none">{{ value() }}</p>
      @if (hint()) { <p class="mt-2 text-xs text-taupe">{{ hint() }}</p> }
    </div>
  `,
})
export class Stat {
  label = input.required<string>();
  value = input<string | number | null>('—');
  hint = input('');
  icon = input('');
  accent = input<'burgundy' | 'green' | 'orange' | 'grey' | 'red'>('burgundy');
  accentCls = computed(
    () =>
      ({
        burgundy: 'bg-burgundy-soft text-burgundy',
        green: 'bg-free text-free-strong',
        orange: 'bg-pending-soft text-pending',
        grey: 'bg-cream text-brown',
        red: 'bg-absent-soft text-absent',
      })[this.accent()],
  );
}

@Component({
  selector: 'ui-empty',
  imports: [Icon],
  template: `
    <div class="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <span class="flex size-12 items-center justify-center rounded-full bg-cream text-taupe"><ui-icon [name]="icon()" /></span>
      <p class="font-display text-xl">{{ title() }}</p>
      @if (text()) { <p class="max-w-sm text-sm text-taupe">{{ text() }}</p> }
      <ng-content />
    </div>
  `,
})
export class Empty {
  title = input('Nothing here yet');
  text = input('');
  icon = input('sparkles');
}

@Component({
  selector: 'ui-spinner',
  template: `<span class="inline-block size-5 animate-spin rounded-full border-2 border-beige border-t-burgundy"></span>`,
})
export class Spinner {}


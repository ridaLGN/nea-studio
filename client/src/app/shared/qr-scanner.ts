import { Component, ElementRef, OnDestroy, output, signal, viewChild } from '@angular/core';
import jsQR from 'jsqr';
import { Icon } from './ui';

/** Mobile-friendly camera QR scanner (rear camera, works on phones over HTTPS or localhost). */
@Component({
  selector: 'nea-qr-scanner',
  imports: [Icon],
  template: `
    <div class="relative aspect-square w-full overflow-hidden rounded-3xl bg-brown">
      <video #video class="h-full w-full object-cover" playsinline muted [class.opacity-0]="!active()"></video>
      @if (active()) {
        <div class="pointer-events-none absolute inset-[14%] rounded-3xl border-2 border-ivory/80 shadow-[0_0_0_999px_rgba(61,48,43,.45)]">
          <div class="absolute inset-x-4 top-1/2 h-px bg-burgundy shadow-[0_0_12px_2px_rgba(120,61,67,.8)] animate-pulse"></div>
        </div>
      } @else {
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-ivory">
          <span class="flex size-16 items-center justify-center rounded-full bg-white/10"><ui-icon name="scan" [size]="28" /></span>
          @if (error()) { <p class="max-w-xs text-sm text-ivory/80">{{ error() }}</p> }
          <button class="btn-primary" (click)="start()"><ui-icon name="camera" [size]="16" /> Open camera</button>
        </div>
      }
    </div>
    @if (active()) {
      <div class="mt-3 flex justify-center"><button class="btn-outline btn-sm" (click)="stop()">Stop camera</button></div>
    }
    <canvas #canvas class="hidden"></canvas>
  `,
})
export class QrScanner implements OnDestroy {
  scanned = output<string>();
  active = signal(false);
  error = signal('');
  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async start() {
    this.error.set('');
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set('Camera access requires HTTPS (or localhost). Use the manual search below.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const v = this.video().nativeElement;
      v.srcObject = this.stream;
      await v.play();
      this.active.set(true);
      this.loop();
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.error.set(name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser settings.' : 'No camera available on this device. Use the manual search below.');
    }
  }

  private loop = () => {
    if (!this.active()) return;
    const v = this.video().nativeElement;
    if (v.readyState === v.HAVE_ENOUGH_DATA) {
      const c = this.canvas().nativeElement;
      const w = Math.min(640, v.videoWidth);
      const h = Math.round((v.videoHeight / v.videoWidth) * w);
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        navigator.vibrate?.(80);
        this.stop();
        this.scanned.emit(code.data);
        return;
      }
    }
    this.timer = setTimeout(this.loop, 180);
  };

  stop() {
    this.active.set(false);
    if (this.timer) clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  ngOnDestroy() {
    this.stop();
  }
}

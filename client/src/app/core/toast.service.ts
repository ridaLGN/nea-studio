import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  success(text: string) { this.show(text, 'success'); }
  error(err: unknown) { this.show(errorMessage(err), 'error', 6000); }
  dismiss(id: number) { this.toasts.update((t) => t.filter((x) => x.id !== id)); }
}

/** Extracts the backend's `{ error: { message } }` shape */
export function errorMessage(err: unknown): string {
  const e = err as { error?: { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } }; message?: string; status?: number };
  if (e?.status === 0) return 'The server cannot be reached. Please check your connection.';
  const fields = e?.error?.error?.details?.fieldErrors;
  if (fields && Object.keys(fields).length) return Object.entries(fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ');
  return e?.error?.error?.message ?? e?.message ?? 'Something went wrong';
}

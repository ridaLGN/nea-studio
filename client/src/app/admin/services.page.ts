import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { mad } from '../core/format';
import { Icon, Modal, Photo } from '../shared/ui';

interface Svc { id: string; name: string; description: string | null; priceMad: number; durationMinutes: number; imageUrl: string | null; isActive: boolean; isDemo: boolean; sortOrder: number; categoryId: string; category: { id: string; name: string; slug: string }; employees: string[]; appointmentCount: number }
interface Cat { id: string; name: string; description: string | null; sortOrder: number; _count: { services: number } }
interface Emp { id: string; firstName: string; lastName: string }

@Component({
  selector: 'nea-services-admin',
  imports: [FormsModule, Icon, Modal, Photo],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">Salon</p><h1 class="title-lg mt-1">Services & prices</h1></div>
      <div class="flex gap-2"><button class="btn-outline" (click)="catOpen.set(true)"><ui-icon name="layers" [size]="16" /> Categories</button><button class="btn-primary" (click)="openEdit(null)"><ui-icon name="plus" [size]="16" /> New service</button></div>
    </div>
    @if (hasDemo()) { <p class="mt-4 rounded-xl bg-pending-soft px-4 py-3 text-sm">Services marked <span class="badge-demo">demo</span> are placeholders. Edit them with the salon's real names, durations and prices (saving clears the demo flag).</p> }

    @for (c of cats(); track c.id) {
      <h2 class="title-md mt-10">{{ c.name }}</h2>
      <div class="card mt-3 overflow-x-auto">
        <table class="table">
          <thead><tr><th class="w-16"></th><th>Service</th><th class="text-right">Duration</th><th class="text-right">Price</th><th>Team</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (s of byCat(c.id); track s.id) {
              <tr [class.opacity-50]="!s.isActive">
                <td><ui-photo class="size-12 rounded-xl" [src]="s.imageUrl || '/images/service-' + s.category.slug + '.jpg'" /></td>
                <td><p class="font-medium">{{ s.name }} @if (s.isDemo) { <span class="badge-demo ml-1">demo</span> }</p><p class="max-w-md truncate text-xs text-taupe">{{ s.description }}</p></td>
                <td class="text-right">{{ s.durationMinutes }} min</td>
                <td class="text-right font-medium">{{ mad(s.priceMad) }}</td>
                <td class="text-xs">{{ teamNames(s) }}</td>
                <td><span [class]="s.isActive ? 'badge-completed' : 'badge-cancelled'">{{ s.isActive ? 'Active' : 'Inactive' }}</span></td>
                <td class="text-right"><button class="icon-btn" (click)="openEdit(s)"><ui-icon name="edit" [size]="16" /></button></td>
              </tr>
            } @empty { <tr><td colspan="7" class="text-center text-taupe">No services in this category.</td></tr> }
          </tbody>
        </table>
      </div>
    }

    <ui-modal [open]="editing()" [title]="form.id ? 'Edit service' : 'New service'" (closed)="editing.set(false)" [wide]="true">
      <form class="space-y-4" (ngSubmit)="save()">
        <div class="grid gap-3 sm:grid-cols-2">
          <div><label class="label">Name</label><input class="input" name="n" [(ngModel)]="form.name" required /></div>
          <div><label class="label">Category</label><select class="select" name="c" [(ngModel)]="form.categoryId" required>@for (c of cats(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }</select></div>
          <div><label class="label">Price (MAD)</label><input class="input" type="number" min="0" step="5" name="p" [(ngModel)]="form.priceMad" required /></div>
          <div><label class="label">Duration (minutes)</label><input class="input" type="number" min="5" step="5" name="d" [(ngModel)]="form.durationMinutes" required /></div>
        </div>
        <div><label class="label">Description</label><textarea class="input" rows="3" name="de" [(ngModel)]="form.description"></textarea></div>
        <div class="flex items-center gap-4">
          <ui-photo class="size-20 rounded-2xl" [src]="form.imageUrl || '/images/none.jpg'" />
          <label class="btn-outline btn-sm cursor-pointer"><ui-icon name="upload" [size]="14" /> Upload photo<input type="file" accept="image/*" class="hidden" (change)="upload($event)" /></label>
          @if (form.imageUrl) { <button type="button" class="btn-ghost btn-sm" (click)="form.imageUrl = null">Remove</button> }
        </div>
        <div>
          <label class="label">Qualified team members</label>
          <div class="flex flex-wrap gap-2">
            @for (e of employees(); track e.id) {
              <label class="flex items-center gap-2 rounded-full border border-cream px-3 py-1.5 text-sm"><input type="checkbox" class="checkbox" [checked]="form.employeeIds.includes(e.id)" (change)="toggleEmp(e.id)" />{{ e.firstName }} {{ e.lastName }}</label>
            }
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" name="a" [(ngModel)]="form.isActive" /> Bookable online</label>
        <div class="flex justify-between">
          @if (form.id) { <button type="button" class="btn-danger btn-sm" (click)="remove()"><ui-icon name="trash" [size]="14" /> Delete</button> } @else { <span></span> }
          <button class="btn-primary">Save</button>
        </div>
      </form>
    </ui-modal>

    <ui-modal [open]="catOpen()" title="Categories" (closed)="catOpen.set(false)">
      <div class="space-y-2">
        @for (c of cats(); track c.id) {
          <div class="flex items-center gap-2">
            <input class="input" [value]="c.name" #n /><input class="input !w-20" type="number" [value]="c.sortOrder" #o />
            <button class="icon-btn" (click)="saveCat(c.id, n.value, +o.value)"><ui-icon name="check" [size]="16" /></button>
            <button class="icon-btn" (click)="deleteCat(c.id)" [disabled]="c._count.services > 0" [title]="c._count.services ? 'Has services' : 'Delete'"><ui-icon name="trash" [size]="16" /></button>
          </div>
        }
        <div class="flex gap-2 pt-3"><input class="input" placeholder="New category" #nc /><button class="btn-primary btn-sm" (click)="addCat(nc.value); nc.value = ''">Add</button></div>
      </div>
    </ui-modal>
  `,
})
export class ServicesAdminPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  services = signal<Svc[]>([]);
  cats = signal<Cat[]>([]);
  employees = signal<Emp[]>([]);
  editing = signal(false);
  catOpen = signal(false);
  hasDemo = computed(() => this.services().some((s) => s.isDemo));
  form = this.blank();
  mad = mad;
  byCat = (id: string) => this.services().filter((s) => s.categoryId === id);
  teamNames = (s: Svc) => this.employees().filter((e) => s.employees.includes(e.id)).map((e) => e.firstName).join(', ') || '—';

  constructor() { this.load(); }
  blank() { return { id: '', name: '', categoryId: '', priceMad: 0, durationMinutes: 60, description: '', imageUrl: null as string | null, isActive: true, employeeIds: [] as string[] }; }
  async load() {
    const [s, c, e] = await Promise.all([this.api.get<Svc[]>('/api/admin/services'), this.api.get<Cat[]>('/api/admin/categories'), this.api.get<Emp[]>('/api/admin/employees')]);
    this.services.set(s); this.cats.set(c); this.employees.set(e);
  }
  openEdit(s: Svc | null) {
    this.form = s ? { id: s.id, name: s.name, categoryId: s.categoryId, priceMad: s.priceMad, durationMinutes: s.durationMinutes, description: s.description ?? '', imageUrl: s.imageUrl, isActive: s.isActive, employeeIds: [...s.employees] } : { ...this.blank(), categoryId: this.cats()[0]?.id ?? '' };
    this.editing.set(true);
  }
  toggleEmp(id: string) { this.form.employeeIds = this.form.employeeIds.includes(id) ? this.form.employeeIds.filter((x) => x !== id) : [...this.form.employeeIds, id]; }
  async upload(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { this.form.imageUrl = (await this.api.upload(f)).url; this.form = { ...this.form }; } catch (e) { this.toast.error(e); }
  }
  async save() {
    const { id, ...body } = this.form;
    const payload = { ...body, priceMad: Number(body.priceMad), durationMinutes: Number(body.durationMinutes), description: body.description || null, isDemo: undefined };
    try {
      if (id) await this.api.patch(`/api/admin/services/${id}`, payload); else await this.api.post('/api/admin/services', payload);
      this.toast.success('Service saved');
      this.editing.set(false);
      this.load();
    } catch (e) { this.toast.error(e); }
  }
  async remove() {
    if (!confirm('Delete this service? If it has booking history it will be deactivated instead.')) return;
    try {
      const r = await this.api.delete<{ deleted: boolean; reason?: string }>(`/api/admin/services/${this.form.id}`);
      this.toast.success(r.deleted ? 'Service deleted' : `Service deactivated (${r.reason})`);
      this.editing.set(false);
      this.load();
    } catch (e) { this.toast.error(e); }
  }
  async addCat(name: string) { if (!name.trim()) return; try { await this.api.post('/api/admin/categories', { name, sortOrder: this.cats().length + 1 }); this.load(); } catch (e) { this.toast.error(e); } }
  async saveCat(id: string, name: string, sortOrder: number) { try { await this.api.patch(`/api/admin/categories/${id}`, { name, sortOrder }); this.toast.success('Category saved'); this.load(); } catch (e) { this.toast.error(e); } }
  async deleteCat(id: string) { try { await this.api.delete(`/api/admin/categories/${id}`); this.load(); } catch (e) { this.toast.error(e); } }
}

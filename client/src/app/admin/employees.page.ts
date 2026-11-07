import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { hhmm, labelDay, toMinute, WEEKDAYS } from '../core/format';
import { Avatar, Icon, Modal } from '../shared/ui';

interface Emp {
  id: string; firstName: string; lastName: string; title: string | null; bio: string | null; photoUrl: string | null; color: string; isActive: boolean; isDemo: boolean; sortOrder: number;
  services: string[];
  workingHours: { weekday: number; startMinute: number; endMinute: number }[];
  breaks: { weekday: number; startMinute: number; endMinute: number; label: string }[];
  absences: { id: string; type: string; startDate: string; endDate: string; reason: string | null }[];
  exceptions: { id: string; date: string; type: 'CUSTOM_HOURS' | 'UNAVAILABLE'; startMinute: number | null; endMinute: number | null; reason: string | null }[];
  user: { email: string; isActive: boolean } | null;
}
interface AdminService { id: string; name: string; category: { name: string } }

@Component({
  selector: 'nea-employees',
  imports: [FormsModule, RouterLink, Icon, Avatar, Modal],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">Salon</p><h1 class="title-lg mt-1">Team & schedules</h1></div>
      <button class="btn-primary" (click)="adding.set(true)"><ui-icon name="plus" [size]="16" /> Add team member</button>
    </div>
    <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      @for (e of list(); track e.id) {
        <a [routerLink]="[e.id]" class="card-pad transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)]" [class.opacity-50]="!e.isActive">
          <div class="flex items-center gap-3">
            <ui-avatar [name]="e.firstName + ' ' + e.lastName" [src]="e.photoUrl" [color]="e.color" [size]="52" />
            <div><p class="font-display text-xl">{{ e.firstName }} {{ e.lastName }}</p><p class="text-xs text-taupe">{{ e.title }}</p></div>
          </div>
          <div class="mt-4 flex flex-wrap gap-1">
            @for (d of [1, 2, 3, 4, 5, 6, 7]; track d) {
              <span class="flex size-7 items-center justify-center rounded-full text-[0.65rem]" [class]="works(e, d) ? 'bg-burgundy-soft text-burgundy' : 'bg-cream text-taupe'">{{ WEEKDAYS[d - 1].slice(0, 2) }}</span>
            }
          </div>
          <p class="mt-3 text-xs text-taupe">{{ e.services.length }} services · {{ e.user ? e.user.email : 'no login' }} @if (!e.isActive) { · inactive } @if (e.isDemo) { <span class="badge-demo ml-1">demo</span> }</p>
        </a>
      }
    </div>

    <ui-modal [open]="adding()" title="New team member" (closed)="adding.set(false)">
      <form class="space-y-3" (ngSubmit)="create()">
        <div class="grid grid-cols-2 gap-3"><input class="input" placeholder="First name" name="f" [(ngModel)]="ne.firstName" required /><input class="input" placeholder="Last name" name="l" [(ngModel)]="ne.lastName" required /></div>
        <input class="input" placeholder="Title (e.g. Hair stylist)" name="t" [(ngModel)]="ne.title" />
        <p class="label !mt-4">Login for the employee dashboard (optional)</p>
        <div class="grid grid-cols-2 gap-3"><input class="input" placeholder="Email" name="e" [(ngModel)]="ne.email" /><input class="input" type="password" placeholder="Temporary password" name="p" [(ngModel)]="ne.password" /></div>
        <p class="text-xs text-taupe">Schedules and services are configured on the next screen.</p>
        <div class="flex justify-end"><button class="btn-primary">Create</button></div>
      </form>
    </ui-modal>
  `,
})
export class EmployeesPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private router = inject(Router);
  WEEKDAYS = WEEKDAYS;
  list = signal<Emp[]>([]);
  adding = signal(false);
  ne = { firstName: '', lastName: '', title: '', email: '', password: '' };
  works = (e: Emp, d: number) => e.workingHours.some((w) => w.weekday === d);
  constructor() { this.load(); }
  async load() { this.list.set(await this.api.get<Emp[]>('/api/admin/employees')); }
  async create() {
    try {
      const e = await this.api.post<Emp>('/api/admin/employees', {
        firstName: this.ne.firstName, lastName: this.ne.lastName, title: this.ne.title || null,
        ...(this.ne.email ? { account: { email: this.ne.email, password: this.ne.password, role: 'EMPLOYEE' } } : {}),
      });
      this.toast.success('Team member added');
      this.router.navigate(['/admin/employees', e.id]);
    } catch (err) { this.toast.error(err); }
  }
}

interface DayRow { weekday: number; works: boolean; start: string; end: string; breaks: { start: string; end: string; label: string }[] }

@Component({
  selector: 'nea-employee-detail',
  imports: [FormsModule, RouterLink, Icon, Avatar],
  template: `
    <a routerLink="/admin/employees" class="btn-ghost btn-sm -ml-3"><ui-icon name="chevron-left" [size]="15" /> Team</a>
    @if (e(); as e) {
      <div class="mt-2 flex flex-wrap items-center gap-4">
        <ui-avatar [name]="e.firstName + ' ' + e.lastName" [src]="e.photoUrl" [color]="e.color" [size]="64" />
        <div><h1 class="title-lg">{{ e.firstName }} {{ e.lastName }}</h1><p class="text-sm text-taupe">{{ e.title }}</p></div>
      </div>

      <div class="mt-8 grid gap-6 xl:grid-cols-2">
        <!-- Profile -->
        <form class="card-pad space-y-3" (ngSubmit)="saveProfile()">
          <p class="eyebrow">Profile</p>
          <div class="grid grid-cols-2 gap-3"><input class="input" name="f" [(ngModel)]="p.firstName" placeholder="First name" /><input class="input" name="l" [(ngModel)]="p.lastName" placeholder="Last name" /></div>
          <input class="input" name="t" [(ngModel)]="p.title" placeholder="Title" />
          <textarea class="input" rows="2" name="b" [(ngModel)]="p.bio" placeholder="Short bio"></textarea>
          <div class="flex flex-wrap items-center gap-3">
            <label class="btn-outline btn-sm cursor-pointer"><ui-icon name="upload" [size]="14" /> Photo<input type="file" accept="image/*" class="hidden" (change)="upload($event)" /></label>
            <label class="flex items-center gap-2 text-sm">Colour <input type="color" name="c" [(ngModel)]="p.color" class="h-8 w-10 rounded border border-cream" /></label>
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="checkbox" name="a" [(ngModel)]="p.isActive" /> Active</label>
          </div>
          <p class="label !mt-4">Dashboard login</p>
          <div class="grid grid-cols-2 gap-3"><input class="input" name="em" [(ngModel)]="p.email" placeholder="Email" /><input class="input" type="password" name="pw" [(ngModel)]="p.password" placeholder="{{ e.user ? 'New password (optional)' : 'Password' }}" /></div>
          @if (auth.user()?.role === 'ADMIN') {
            <select class="select" name="r" [(ngModel)]="p.role"><option value="EMPLOYEE">Employee</option><option value="MANAGER">Manager</option></select>
          }
          <div class="flex justify-end"><button class="btn-primary btn-sm">Save profile</button></div>
        </form>

        <!-- Services -->
        <div class="card-pad">
          <p class="eyebrow mb-3">Services performed</p>
          <div class="grid gap-2 sm:grid-cols-2">
            @for (s of services(); track s.id) {
              <label class="flex items-center gap-2 rounded-xl border border-cream px-3 py-2 text-sm"><input type="checkbox" class="checkbox" [checked]="svc().has(s.id)" (change)="toggleService(s.id)" />{{ s.name }} <span class="ml-auto text-[0.65rem] text-taupe">{{ s.category.name }}</span></label>
            }
          </div>
          <div class="mt-4 flex justify-end"><button class="btn-primary btn-sm" (click)="saveServices()">Save services</button></div>
        </div>

        <!-- Weekly schedule -->
        <div class="card-pad xl:col-span-2">
          <div class="flex items-center justify-between"><p class="eyebrow">Weekly schedule</p><button class="btn-primary btn-sm" (click)="saveSchedule()">Save schedule</button></div>
          <div class="mt-4 divide-y divide-cream">
            @for (d of week(); track d.weekday) {
              <div class="flex flex-wrap items-center gap-3 py-3">
                <label class="flex w-36 items-center gap-2 text-sm"><input type="checkbox" class="checkbox" [(ngModel)]="d.works" />{{ WEEKDAYS[d.weekday - 1] }}</label>
                @if (d.works) {
                  <input type="time" class="input !w-28 !py-1.5" [(ngModel)]="d.start" step="900" /> <span class="text-taupe">–</span> <input type="time" class="input !w-28 !py-1.5" [(ngModel)]="d.end" step="900" />
                  @for (b of d.breaks; track $index) {
                    <span class="flex items-center gap-1 rounded-xl bg-cream px-2 py-1 text-xs"><ui-icon name="coffee" [size]="12" />
                      <input type="time" class="w-20 bg-transparent" [(ngModel)]="b.start" step="900" />–<input type="time" class="w-20 bg-transparent" [(ngModel)]="b.end" step="900" />
                      <button class="text-taupe hover:text-absent" (click)="d.breaks.splice($index, 1)"><ui-icon name="x" [size]="12" /></button></span>
                  }
                  <button class="btn-ghost btn-sm" (click)="d.breaks.push({ start: '13:00', end: '14:00', label: 'Break' })"><ui-icon name="plus" [size]="13" /> Break</button>
                } @else { <span class="text-sm text-taupe">Day off</span> }
              </div>
            }
          </div>
        </div>

        <!-- Absences -->
        <div class="card-pad">
          <p class="eyebrow mb-3">Absences & holidays</p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <select class="select" [(ngModel)]="abs.type"><option value="VACATION">Vacation</option><option value="HOLIDAY">Holiday</option><option value="SICK">Sick</option><option value="PERSONAL">Personal</option><option value="TRAINING">Training</option><option value="OTHER">Other</option></select>
            <input type="date" class="input" [(ngModel)]="abs.startDate" /><input type="date" class="input" [(ngModel)]="abs.endDate" />
            <button class="btn-primary btn-sm" (click)="addAbsence()">Add</button>
          </div>
          <input class="input mt-2" placeholder="Note (optional)" [(ngModel)]="abs.reason" />
          <div class="mt-4 divide-y divide-cream">
            @for (a of e.absences; track a.id) {
              <div class="flex items-center justify-between py-2.5 text-sm">
                <span><span class="badge-noshow mr-2">{{ a.type.toLowerCase() }}</span>{{ labelDay(a.startDate) }}{{ a.endDate !== a.startDate ? ' → ' + labelDay(a.endDate) : '' }} <span class="text-taupe">{{ a.reason }}</span></span>
                <button class="icon-btn size-7" (click)="removeAbsence(a.id)"><ui-icon name="trash" [size]="14" /></button>
              </div>
            } @empty { <p class="text-sm text-taupe">No absences recorded.</p> }
          </div>
        </div>

        <!-- Exceptions -->
        <div class="card-pad">
          <p class="eyebrow mb-3">Exceptional hours & temporary unavailability</p>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input type="date" class="input" [(ngModel)]="ex.date" />
            <select class="select" [(ngModel)]="ex.type"><option value="UNAVAILABLE">Unavailable</option><option value="CUSTOM_HOURS">Special hours</option></select>
            <div class="flex gap-1"><input type="time" class="input !px-2" [(ngModel)]="ex.start" step="900" /><input type="time" class="input !px-2" [(ngModel)]="ex.end" step="900" /></div>
          </div>
          <div class="mt-2 flex gap-2"><input class="input" placeholder="Reason (optional)" [(ngModel)]="ex.reason" /><button class="btn-primary btn-sm" (click)="addException()">Add</button></div>
          <p class="mt-1 text-xs text-taupe">Leave times empty with “Unavailable” to block the whole day.</p>
          <div class="mt-4 divide-y divide-cream">
            @for (x of e.exceptions; track x.id) {
              <div class="flex items-center justify-between py-2.5 text-sm">
                <span><span [class]="x.type === 'UNAVAILABLE' ? 'badge-noshow' : 'badge-confirmed'" class="mr-2">{{ x.type === 'UNAVAILABLE' ? 'unavailable' : 'special hours' }}</span>{{ labelDay(x.date) }} {{ x.startMinute !== null ? hhmm(x.startMinute) + '–' + hhmm(x.endMinute!) : 'all day' }} <span class="text-taupe">{{ x.reason }}</span></span>
                <button class="icon-btn size-7" (click)="removeException(x.id)"><ui-icon name="trash" [size]="14" /></button>
              </div>
            } @empty { <p class="text-sm text-taupe">None.</p> }
          </div>
        </div>
      </div>
    }
  `,
})
export class EmployeeDetailPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  id = input.required<string>();
  WEEKDAYS = WEEKDAYS; hhmm = hhmm; labelDay = (d: string) => labelDay(d);
  e = signal<Emp | null>(null);
  services = signal<AdminService[]>([]);
  svc = signal<Set<string>>(new Set());
  week = signal<DayRow[]>([]);
  p = { firstName: '', lastName: '', title: '', bio: '', color: '#783D43', isActive: true, photoUrl: null as string | null, email: '', password: '', role: 'EMPLOYEE' };
  abs = { type: 'VACATION', startDate: '', endDate: '', reason: '' };
  ex = { date: '', type: 'UNAVAILABLE', start: '', end: '', reason: '' };
  hasAccount = computed(() => !!this.e()?.user);

  constructor() {
    this.api.get<AdminService[]>('/api/admin/services').then((s) => this.services.set(s));
    effect(() => { this.id(); untracked(() => this.load()); });
  }

  async load() {
    const e = await this.api.get<Emp>(`/api/admin/employees/${this.id()}`);
    this.e.set(e);
    this.svc.set(new Set(e.services));
    this.p = { firstName: e.firstName, lastName: e.lastName, title: e.title ?? '', bio: e.bio ?? '', color: e.color, isActive: e.isActive, photoUrl: e.photoUrl, email: e.user?.email ?? '', password: '', role: 'EMPLOYEE' };
    this.week.set(
      [1, 2, 3, 4, 5, 6, 7].map((wd) => {
        const w = e.workingHours.find((x) => x.weekday === wd);
        return { weekday: wd, works: !!w, start: hhmm(w?.startMinute ?? 600), end: hhmm(w?.endMinute ?? 1140), breaks: e.breaks.filter((b) => b.weekday === wd).map((b) => ({ start: hhmm(b.startMinute), end: hhmm(b.endMinute), label: b.label })) };
      }),
    );
  }

  private async act(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); this.toast.success(ok); await this.load(); } catch (err) { this.toast.error(err); }
  }
  saveProfile() {
    const { email, password, role, ...rest } = this.p;
    return this.act(() => this.api.patch(`/api/admin/employees/${this.id()}`, { ...rest, title: rest.title || null, bio: rest.bio || null, ...(email ? { account: { email, ...(password ? { password } : {}), role } } : {}) }), 'Profile saved');
  }
  async upload(ev: Event) {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { const r = await this.api.upload(f); this.p.photoUrl = r.url; await this.saveProfile(); } catch (err) { this.toast.error(err); }
  }
  toggleService(id: string) { const s = new Set(this.svc()); if (s.has(id)) s.delete(id); else s.add(id); this.svc.set(s); }
  saveServices() { return this.act(() => this.api.patch(`/api/admin/employees/${this.id()}`, { serviceIds: [...this.svc()] }), 'Services saved'); }
  saveSchedule() {
    const days = this.week().filter((d) => d.works);
    return this.act(() => this.api.put(`/api/admin/employees/${this.id()}/schedule`, {
      workingHours: days.map((d) => ({ weekday: d.weekday, startMinute: toMinute(d.start), endMinute: toMinute(d.end) })),
      breaks: days.flatMap((d) => d.breaks.map((b) => ({ weekday: d.weekday, startMinute: toMinute(b.start), endMinute: toMinute(b.end), label: b.label }))),
    }), 'Schedule saved — availability updated everywhere');
  }
  async addAbsence() {
    if (!this.abs.startDate) return this.toast.show('Choose a start date', 'error');
    try {
      const r = await this.api.post<{ conflictingAppointments: number }>(`/api/admin/employees/${this.id()}/absences`, { ...this.abs, endDate: this.abs.endDate || this.abs.startDate, reason: this.abs.reason || undefined });
      this.toast.success('Absence added');
      if (r.conflictingAppointments) this.toast.show(`⚠ ${r.conflictingAppointments} existing appointment(s) fall in this period — reschedule them from the calendar.`, 'error');
      this.abs = { type: 'VACATION', startDate: '', endDate: '', reason: '' };
      this.load();
    } catch (err) { this.toast.error(err); }
  }
  removeAbsence(id: string) { return this.act(() => this.api.delete(`/api/admin/employees/${this.id()}/absences/${id}`), 'Absence removed'); }
  addException() {
    if (!this.ex.date) return this.toast.show('Choose a date', 'error');
    return this.act(() => this.api.post(`/api/admin/employees/${this.id()}/exceptions`, {
      date: this.ex.date, type: this.ex.type, startMinute: this.ex.start ? toMinute(this.ex.start) : null, endMinute: this.ex.end ? toMinute(this.ex.end) : null, reason: this.ex.reason || undefined,
    }), 'Exception added').then(() => (this.ex = { date: '', type: 'UNAVAILABLE', start: '', end: '', reason: '' }));
  }
  removeException(id: string) { return this.act(() => this.api.delete(`/api/admin/employees/${this.id()}/exceptions/${id}`), 'Exception removed'); }
}

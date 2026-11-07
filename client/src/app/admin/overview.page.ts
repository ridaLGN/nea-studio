import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ApiService } from '../core/api.service';
import { labelDay, mad } from '../core/format';
import { Icon, Stat } from '../shared/ui';
import { ChartView, PALETTE } from '../shared/chart';

interface Overview {
  currency: string;
  kpis: Record<string, number>;
  charts: {
    revenueByMonth: { month: string; revenue: number; count: number }[];
    perDay: { day: string; total: number; completed: number; cancelled: number }[];
    popular: { name: string; count: number; revenue: number }[];
    employeePerf: { name: string; completed: number; noShow: number; revenue: number; color: string }[];
    customerGrowth: { month: string; count: number }[];
  };
}

@Component({
  selector: 'nea-overview',
  imports: [RouterLink, Stat, Icon, ChartView],
  template: `
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div><p class="eyebrow">Management</p><h1 class="title-lg mt-1">Overview</h1></div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="segmented">
          @for (d of [30, 90, 365]; track d) { <button [class.active]="days() === d" (click)="days.set(d); load()">{{ d === 365 ? '12 months' : d + ' days' }}</button> }
        </div>
        <label class="flex items-center gap-2 text-xs text-taupe"><input type="checkbox" class="checkbox" [checked]="excludeDemo()" (change)="excludeDemo.set(!excludeDemo()); load()" /> Exclude demo data</label>
        <a routerLink="/admin/availability" class="btn-primary btn-sm"><ui-icon name="calendar" [size]="15" /> Live calendar</a>
      </div>
    </div>

    @if (hasDemo()) {
      <p class="mt-4 rounded-xl bg-pending-soft px-4 py-3 text-sm text-brown"><b>Demo data is included.</b> These figures come from generated sample records (flagged “demo”) — they are not real business results. Tick “Exclude demo data” to see only real activity.</p>
    }

    @if (data(); as d) {
      @let k = d.kpis;
      <div class="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <ui-stat label="Revenue this month" [value]="mad(k['monthlyRevenue'])" [hint]="k['paymentsThisMonth'] + ' payments'" icon="card" />
        <ui-stat label="Avg. booking value" [value]="mad(k['averageBookingValue'])" icon="chart" accent="orange" />
        <ui-stat label="Today" [value]="k['todayAppointments']" hint="appointments" icon="calendar" />
        <ui-stat label="Occupancy today" [value]="k['occupancyToday'] + '%'" [hint]="k['employeesWorkingToday'] + ' of ' + k['employeesActive'] + ' working'" icon="clock" accent="green" />
        <ui-stat label="Customers" [value]="k['totalCustomers']" [hint]="'+' + k['newCustomersThisMonth'] + ' this month'" icon="users" accent="grey" />
        <ui-stat label="Retention" [value]="k['retentionRate'] + '%'" hint="came back 2+ times" icon="heart" />
        <ui-stat label="All appointments" [value]="k['totalAppointments']" [hint]="k['pending'] + ' pending'" icon="list" accent="grey" />
        <ui-stat label="Completed" [value]="k['completed']" icon="check" accent="green" />
        <ui-stat label="Cancelled" [value]="k['cancelled']" [hint]="k['noShow'] + ' no-shows'" icon="x" accent="red" />
        <ui-stat label="Rewards issued" [value]="k['rewardsIssued']" icon="gift" />
        <ui-stat label="Rewards redeemed" [value]="k['rewardsRedeemed']" icon="sparkles" accent="orange" />
        <ui-stat label="Team active" [value]="k['employeesActive']" icon="scissors" accent="grey" />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <div class="card-pad xl:col-span-2"><p class="eyebrow">Revenue over time (MAD)</p><ui-chart class="mt-4 block" [config]="revenueChart()" /></div>
        <div class="card-pad"><p class="eyebrow">Most popular services</p><ui-chart class="mt-4 block" [config]="popularChart()" /></div>
        <div class="card-pad xl:col-span-2"><p class="eyebrow">Appointments per day</p><ui-chart class="mt-4 block" [config]="perDayChart()" /></div>
        <div class="card-pad"><p class="eyebrow">New customers per month</p><ui-chart class="mt-4 block" [config]="growthChart()" /></div>
        <div class="card-pad xl:col-span-3">
          <p class="eyebrow mb-4">Team performance · last {{ days() }} days</p>
          <div class="overflow-x-auto">
            <table class="table">
              <thead><tr><th>Team member</th><th class="text-right">Completed</th><th class="text-right">No-shows</th><th class="text-right">Revenue</th><th class="w-1/3"></th></tr></thead>
              <tbody>
                @for (e of d.charts.employeePerf; track e.name) {
                  <tr>
                    <td class="flex items-center gap-2"><span class="size-2.5 rounded-full" [style.background]="e.color"></span>{{ e.name }}</td>
                    <td class="text-right">{{ e.completed }}</td><td class="text-right">{{ e.noShow }}</td><td class="text-right">{{ mad(e.revenue) }}</td>
                    <td><div class="h-1.5 rounded-full bg-cream"><div class="h-1.5 rounded-full bg-burgundy" [style.width.%]="maxRevenue() ? (e.revenue / maxRevenue()) * 100 : 0"></div></div></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    }
  `,
})
export class OverviewPage {
  private api = inject(ApiService);
  data = signal<Overview | null>(null);
  days = signal(30);
  excludeDemo = signal(false);
  hasDemo = signal(false);
  mad = mad;
  maxRevenue = computed(() => Math.max(0, ...(this.data()?.charts.employeePerf.map((e) => e.revenue) ?? [])));

  revenueChart = computed<ChartConfiguration>(() => {
    const r = this.data()?.charts.revenueByMonth ?? [];
    return { type: 'bar', data: { labels: r.map((x) => labelDay(x.month + '-01', { month: 'short', year: '2-digit' })), datasets: [{ label: 'Revenue', data: r.map((x) => x.revenue), backgroundColor: '#783D43', borderRadius: 8, maxBarThickness: 36 }] }, options: { plugins: { legend: { display: false } } } };
  });
  perDayChart = computed<ChartConfiguration>(() => {
    const r = this.data()?.charts.perDay ?? [];
    return {
      type: 'line',
      data: {
        labels: r.map((x) => labelDay(x.day, { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Booked', data: r.map((x) => x.total), borderColor: '#783D43', backgroundColor: 'rgba(120,61,67,.08)', fill: true, tension: 0.35, pointRadius: 0 },
          { label: 'Completed', data: r.map((x) => x.completed), borderColor: '#A0674B', tension: 0.35, pointRadius: 0 },
          { label: 'Cancelled', data: r.map((x) => x.cancelled), borderColor: '#A89A8B', borderDash: [4, 4], tension: 0.35, pointRadius: 0 },
        ],
      },
    };
  });
  popularChart = computed<ChartConfiguration>(() => {
    const r = this.data()?.charts.popular ?? [];
    return { type: 'doughnut', data: { labels: r.map((x) => x.name), datasets: [{ data: r.map((x) => x.count), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }] }, options: { cutout: '62%', plugins: { legend: { position: 'bottom' } } } };
  });
  growthChart = computed<ChartConfiguration>(() => {
    const r = this.data()?.charts.customerGrowth ?? [];
    return { type: 'bar', data: { labels: r.map((x) => labelDay(x.month + '-01', { month: 'short' })), datasets: [{ label: 'New customers', data: r.map((x) => x.count), backgroundColor: '#D8C6B2', borderRadius: 8, maxBarThickness: 28 }] }, options: { plugins: { legend: { display: false } } } };
  });

  constructor() {
    this.load();
    this.api.services().then((s) => this.hasDemo.set(s.some((x) => x.isDemo)));
  }

  async load() {
    this.data.set(await this.api.get<Overview>('/api/admin/analytics/overview', { days: this.days(), excludeDemo: this.excludeDemo() }));
  }
}

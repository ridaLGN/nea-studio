import { Component, ElementRef, effect, input, viewChild, OnDestroy } from '@angular/core';
import { Chart, registerables, type ChartConfiguration } from 'chart.js';

// ---------------------------------------------------------------------------
// Chart.js wrapper (brand palette)
// ---------------------------------------------------------------------------
Chart.register(...registerables);
Chart.defaults.font.family = 'Jost, sans-serif';
Chart.defaults.color = '#A89A8B';
Chart.defaults.borderColor = '#EDE5D9';
export const PALETTE = ['#783D43', '#A0674B', '#A89A8B', '#5E4B43', '#D8C6B2', '#C08A7C', '#8C7A6B', '#3D302B'];

@Component({
  selector: 'ui-chart',
  template: `<div class="relative" [style.height.px]="height()"><canvas #c></canvas></div>`,
})
export class ChartView implements OnDestroy {
  config = input.required<ChartConfiguration>();
  height = input(260);
  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('c');
  private chart: Chart | null = null;
  constructor() {
    effect(() => {
      const cfg = this.config();
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, {
        ...cfg,
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 10, usePointStyle: true } } }, ...cfg.options },
      });
    });
  }
  ngOnDestroy() {
    this.chart?.destroy();
  }
}

<script lang="ts">
  // A line chart (uPlot) with one y-axis, a crosshair with live values in the
  // legend, and a marker at the current animation frame. Click to seek.
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { ui } from '../state/ui.svelte';

  let {
    x,
    xLabel,
    series,
    unit,
    marker = -1,
    height = 200,
    onseek,
  }: {
    x: number[];
    xLabel: string;
    series: { label: string; values: number[]; slot: number }[];
    unit: string;
    marker?: number;
    /** Plot area height in px (the legend adds about 30 px). */
    height?: number;
    onseek?: (index: number) => void;
  } = $props();

  let host: HTMLDivElement;
  let plot: uPlot | null = null;
  let themeTick = $state(0);
  let markerIndex = -1;

  const css = (name: string) => getComputedStyle(host).getPropertyValue(name).trim();

  function options(width: number, height: number): uPlot.Options {
    const ink = css('--text-muted');
    const grid = css('--chart-grid');
    const axisLine = css('--chart-axis');
    const font = `11px ${css('--font-ui') || 'system-ui'}`;
    const axis = (label: string): uPlot.Axis => ({
      label,
      stroke: ink,
      font,
      labelFont: `600 ${font}`,
      grid: { stroke: grid, width: 1 },
      ticks: { stroke: axisLine, width: 1, size: 4 },
      gap: 4,
    });
    return {
      width,
      height,
      padding: [8, 12, 0, 4],
      legend: { show: true, live: true },
      cursor: { drag: { x: false, y: false }, points: { size: 8, width: 2 } },
      scales: { x: { time: false } },
      axes: [axis(xLabel), { ...axis(unit), size: 56 }],
      series: [
        { label: xLabel, value: (_u, v) => (v == null ? '–' : fmt(v)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: css(`--series-${(s.slot % 8) + 1}`),
          width: 2,
          points: { show: false },
          value: (_u: uPlot, v: number | null) => (v == null ? '–' : `${fmt(v)} ${unit}`),
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            if (markerIndex < 0 || markerIndex >= x.length) return;
            const px = Math.round(u.valToPos(x[markerIndex]!, 'x', true));
            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = css('--accent');
            ctx.lineWidth = 1.5 * devicePixelRatio;
            ctx.beginPath();
            ctx.moveTo(px, u.bbox.top);
            ctx.lineTo(px, u.bbox.top + u.bbox.height);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };
  }

  function fmt(v: number): string {
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(3);
    return Number(v.toPrecision(5)).toString();
  }

  // Rebuild on structural changes (series, axes, theme); update data in place otherwise.
  $effect(() => {
    void themeTick;
    void ui.theme;
    const data: uPlot.AlignedData = [x, ...series.map((s) => s.values)];
    const width = host.clientWidth || 400;
    plot?.destroy();
    plot = new uPlot(options(width, height), data, host);
    plot.over.addEventListener('click', () => {
      const idx = plot?.cursor.idx;
      if (idx != null) onseek?.(idx);
    });
    return () => {
      plot?.destroy();
      plot = null;
    };
  });

  $effect(() => {
    markerIndex = marker;
    plot?.redraw(false, false);
  });

  $effect(() => {
    const ro = new ResizeObserver(() => plot?.setSize({ width: host.clientWidth, height }));
    ro.observe(host);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onTheme = () => themeTick++;
    mq.addEventListener('change', onTheme);
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', onTheme);
    };
  });
</script>

<div class="chart" bind:this={host}></div>

<style>
  .chart {
    width: 100%;
    min-width: 0;
  }

  .chart :global(.u-legend) {
    color: var(--text);
    font-size: var(--text-sm);
    text-align: left;
  }

  .chart :global(.u-legend .u-marker) {
    border-radius: 2px;
  }

  .chart :global(.u-legend th) {
    font-weight: 500;
  }

  .chart :global(.u-legend td) {
    font-variant-numeric: tabular-nums;
  }

  .chart :global(.u-over) {
    cursor: crosshair;
  }
</style>

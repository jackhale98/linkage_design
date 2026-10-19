<script lang="ts">
  import Chart from './Chart.svelte';
  import { isOscillating, isRoller } from '../../core/cam/types';
  import { emptyCam } from '../../core/cam/types';
  import { store } from '../state/project.svelte';
  import { camUi, type CamPlotKey } from '../state/cam.svelte';
  import { ui } from '../state/ui.svelte';

  const cam = $derived(camUi.cam ?? emptyCam());
  const a = $derived(camUi.analysis);
  const L = $derived(store.project.meta.length_unit);
  const F = $derived(store.project.meta.force_unit);
  const S = $derived(isOscillating(cam.follower) ? '°' : L);

  const qs = $derived(
    (
      [
        { key: 's', label: 'Displacement', unit: S, group: 'Follower motion (SVAJ)' },
        { key: 'v', label: 'Velocity', unit: `${S}/s`, group: 'Follower motion (SVAJ)' },
        { key: 'a', label: 'Acceleration', unit: `${S}/s²`, group: 'Follower motion (SVAJ)' },
        { key: 'j', label: 'Jerk', unit: `${S}/s³`, group: 'Follower motion (SVAJ)' },
        { key: 'pressure', label: 'Pressure angle', unit: '°', group: 'Geometry' },
        ...(isRoller(cam.follower)
          ? [{ key: 'rhoPitch', label: 'Pitch curve radius', unit: L, group: 'Geometry' }]
          : []),
        { key: 'rhoSurface', label: 'Cam surface radius', unit: L, group: 'Geometry' },
        { key: 'force', label: 'Contact force', unit: F, group: 'Forces' },
        { key: 'torque', label: 'Cam shaft torque', unit: `${F}·${L}`, group: 'Forces' },
      ] as { key: CamPlotKey; label: string; unit: string; group: string }[]
    ).map((q, i) => ({ ...q, slot: i })),
  );
  const groups = $derived(
    [...new Set(qs.map((q) => q.group))].map((g) => ({ name: g, items: qs.filter((q) => q.group === g) })),
  );
  const x = $derived(a.samples.map((s) => (camUi.xAxis === 'time' ? s.time : s.angle)));
  const xLabel = $derived(camUi.xAxis === 'time' ? 'Time (s)' : 'Cam angle (°)');

  // One chart per unit, so every chart has a single y-axis.
  const charts = $derived.by(() => {
    const selected = qs.filter((q) => camUi.plotKeys.includes(q.key));
    return [...new Set(selected.map((q) => q.unit))].map((unit) => ({
      unit,
      series: selected
        .filter((q) => q.unit === unit)
        .map((q) => ({
          label: q.label,
          slot: q.slot,
          // Straight stretches have infinite radius: leave them out of the plot.
          values: a.samples.map((s) => (Number.isFinite(s[q.key]) ? s[q.key] : NaN)),
        })),
    }));
  });
</script>

{#if !a.ok}
  <p class="empty">
    {a.issues.find((i) => i.severity === 'error')?.message ?? 'Define the cam to see its plots.'}
  </p>
{:else}
  <div class="plots">
    <aside class="picker" aria-label="Quantities">
      <div class="xaxis" role="radiogroup" aria-label="X axis">
        <span class="muted">X axis</span>
        <button
          role="radio"
          aria-checked={camUi.xAxis === 'angle'}
          class:on={camUi.xAxis === 'angle'}
          onclick={() => (camUi.xAxis = 'angle')}>Cam angle</button
        >
        <button
          role="radio"
          aria-checked={camUi.xAxis === 'time'}
          class:on={camUi.xAxis === 'time'}
          onclick={() => (camUi.xAxis = 'time')}>Time</button
        >
      </div>
      {#each groups as g (g.name)}
        <details open>
          <summary>{g.name}</summary>
          {#each g.items as q (q.key)}
            <label class="q">
              <input
                type="checkbox"
                checked={camUi.plotKeys.includes(q.key)}
                onchange={() => camUi.togglePlot(q.key)}
              />
              <span
                class="sw"
                style:background={camUi.plotKeys.includes(q.key)
                  ? `var(--series-${(q.slot % 8) + 1})`
                  : 'transparent'}
              ></span>
              <span>{q.label}</span>
              <span class="unit">{q.unit}</span>
            </label>
          {/each}
        </details>
      {/each}
    </aside>
    <div class="charts">
      {#if charts.length === 0}
        <p class="empty">Pick quantities on the left to plot them over one revolution.</p>
      {/if}
      {#each charts as c (c.unit)}
        <Chart
          {x}
          {xLabel}
          series={c.series}
          unit={c.unit}
          marker={camUi.sampleIndex}
          height={Math.max(120, (ui.dockHeight - 100) / Math.min(charts.length, 2))}
          onseek={(i) => {
            camUi.pause();
            camUi.angle = a.samples[i]?.angle ?? 0;
          }}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .empty {
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  .plots {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr);
    gap: var(--space-4);
    height: 100%;
  }

  .picker {
    min-height: 0;
    overflow-y: auto;
    padding-right: var(--space-2);
    border-right: 1px solid var(--border);
    font-size: var(--text-sm);
  }

  .xaxis {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-bottom: var(--space-2);
  }

  .xaxis span {
    margin-right: var(--space-1);
  }

  .xaxis button {
    height: 24px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    cursor: pointer;
  }

  .xaxis button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  summary {
    padding: 4px 0;
    font-weight: 600;
    cursor: pointer;
  }

  .q {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0 2px 12px;
    cursor: pointer;
  }

  .q input {
    accent-color: var(--accent);
  }

  .sw {
    width: 10px;
    height: 3px;
    border-radius: 2px;
  }

  .unit {
    margin-left: auto;
    color: var(--text-faint);
  }

  .charts {
    display: grid;
    gap: var(--space-3);
    align-content: start;
    min-width: 0;
    overflow-y: auto;
  }

  @media (max-width: 720px) {
    .plots {
      grid-template-columns: 1fr;
    }
    .picker {
      max-height: 160px;
      border-right: 0;
    }
  }
</style>

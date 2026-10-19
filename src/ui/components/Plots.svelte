<script lang="ts">
  import Chart from './Chart.svelte';
  import { inputValue, series, timeOf } from '../../core/mechanism/analysis';
  import { forceSeries } from '../../core/forces/analysis';
  import { store } from '../state/project.svelte';
  import { motionUi } from '../state/motion.svelte';
  import { ui } from '../state/ui.svelte';

  const result = $derived(motionUi.result);
  const data = $derived(result.data);
  // Force quantities (driver effort, joint forces, springs) come after the kinematic ones.
  const qs = $derived([...motionUi.forceQuantities, ...motionUi.quantities]);
  const isForce = (key: string) => /^[dfs]:/.test(key);
  const groups = $derived(
    [...new Set(qs.map((q) => q.group))].map((g) => ({ name: g, items: qs.filter((q) => q.group === g) })),
  );

  /** The point or link a quantity is about, to highlight on the canvas. */
  function target(key: string): string | null {
    const [kind, id] = key.split(':');
    if (kind === 'p' || kind === 'b') return id ?? null;
    if (kind === 'f' || kind === 'j') return result.model.joints.find((j) => j.id === id)?.point ?? null;
    return null;
  }

  $effect(() => {
    if (data) motionUi.ensureDefaultPlot(ui.workspace === 'forces');
  });

  const rotary = $derived(result.model.driver?.type === 'rotary');
  const xLabel = $derived(
    motionUi.xAxis === 'time'
      ? 'Time (s)'
      : rotary
        ? `Driver angle (${store.project.meta.angle_unit === 'deg' ? '°' : 'rad'})`
        : `Actuator length (${store.project.meta.length_unit})`,
  );
  // Against the input, a there-and-back cycle plots as two curves over the
  // outward inputs: out, and back (the return frames in reverse).
  const split = $derived(!!data?.cycle && motionUi.xAxis === 'input');
  const nOut = $derived(split ? (motionUi.frames.length + 1) / 2 : motionUi.frames.length);
  const x = $derived(
    data
      ? motionUi.frames
          .slice(0, nOut)
          .map((f) => (motionUi.xAxis === 'time' ? timeOf(data, f) : inputValue(data, f)))
      : [],
  );
  const marker = $derived(
    split && motionUi.frameIndex >= nOut ? 2 * nOut - 2 - motionUi.frameIndex : motionUi.frameIndex,
  );

  // One chart per unit, so every chart has a single y-axis.
  const charts = $derived.by(() => {
    if (!data) return [];
    const selected = motionUi.plotKeys.map((k) => qs.find((q) => q.key === k)).filter((q) => q !== undefined);
    const units = [...new Set(selected.map((q) => q!.unit))];
    return units.map((unit) => ({
      unit,
      series: selected
        .filter((q) => q!.unit === unit)
        .flatMap((q) => {
          const values = isForce(q!.key) ? forceSeries(motionUi.forces, q!.key) : series(data, q!.key);
          const slot = motionUi.plotSlots[q!.key] ?? 0;
          if (!split) return [{ label: q!.label, values, slot }];
          // The turnaround point belongs to the way out; leave it off the way back so a load
          // that flips there doesn't draw a false vertical line.
          const back = Array.from({ length: nOut }, (_, i) =>
            i === nOut - 1 ? NaN : values[2 * nOut - 2 - i]!,
          );
          return [
            { label: `${q!.label} (out)`, values: values.slice(0, nOut), slot },
            { label: `${q!.label} (back)`, values: back, slot, dash: true },
          ];
        }),
    }));
  });
</script>

{#if !data}
  <p class="empty">
    {result.issues.find((i) => i.severity === 'error')?.message ??
      result.issues[0]?.message ??
      'Plots appear here once the mechanism has links, a ground pivot and a driver.'}
  </p>
{:else}
  <div class="plots">
    <aside class="picker" aria-label="Quantities to plot">
      <div class="xaxis" role="radiogroup" aria-label="Horizontal axis">
        <span class="muted">X axis</span>
        <button
          role="radio"
          aria-checked={motionUi.xAxis === 'input'}
          class:on={motionUi.xAxis === 'input'}
          onclick={() => (motionUi.xAxis = 'input')}>Input</button
        >
        <button
          role="radio"
          aria-checked={motionUi.xAxis === 'time'}
          class:on={motionUi.xAxis === 'time'}
          onclick={() => (motionUi.xAxis = 'time')}>Time</button
        >
      </div>
      {#each groups as g (g.name)}
        <details
          open={g.items.some((q) => motionUi.plotKeys.includes(q.key)) || g === groups[0]}
          onmouseenter={() => (motionUi.hover = target(g.items[0]!.key))}
          onmouseleave={() => (motionUi.hover = null)}
        >
          <summary>{g.name}</summary>
          {#each g.items as q (q.key)}
            {@const slot = motionUi.plotSlots[q.key]}
            <label class="q">
              <input
                type="checkbox"
                checked={motionUi.plotKeys.includes(q.key)}
                onchange={() => motionUi.togglePlot(q.key)}
              />
              <span
                class="sw"
                style:background={slot === undefined ? 'transparent' : `var(--series-${(slot % 8) + 1})`}
              ></span>
              <span>{q.short}</span>
              <span class="unit">{q.unit}</span>
            </label>
          {/each}
        </details>
      {/each}
    </aside>
    <div class="charts">
      {#if charts.length === 0}
        <p class="empty">Pick quantities on the left to plot them against the driver input or time.</p>
      {/if}
      {#each charts as c (c.unit)}
        <Chart
          {x}
          {xLabel}
          series={c.series}
          unit={c.unit}
          {marker}
          height={Math.max(120, ui.dockHeight - 100 - (charts.length > 1 ? 40 : 0))}
          onseek={(i) => {
            motionUi.pause();
            motionUi.seek(i);
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

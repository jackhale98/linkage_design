<script lang="ts">
  import Icon from './Icon.svelte';
  import { resultsTable, summarize } from '../../core/mechanism/analysis';
  import { forcesTable, summarizeForces } from '../../core/forces/analysis';
  import { stringifyCsv, BOM } from '../../core/csv/rfc4180';
  import { projectFileName } from '../../core/model/project';
  import { downloadText } from '../lib/files';
  import { store } from '../state/project.svelte';
  import { motionUi } from '../state/motion.svelte';

  const result = $derived(motionUi.result);
  const data = $derived(result.data);
  const summary = $derived(data ? summarize(data, store.project.mechanism.motion.trace) : null);
  const angleUnit = $derived(store.project.meta.angle_unit === 'deg' ? '°' : ' rad');
  const len = $derived(store.project.meta.length_unit);
  const fmt = (v: number, d = 1) => Number(v.toFixed(d)).toString();
  const forceSummary = $derived(data ? summarizeForces(data, motionUi.forces) : null);
  const F = $derived(store.project.meta.force_unit);
  const rotary = $derived(result.model.driver?.type === 'rotary');
  const effortUnit = $derived(rotary ? `${F}·${len}` : F);
  const inputUnit = $derived(rotary ? angleUnit : ` ${len}`);
  const sig = (v: number) => {
    const a = Math.abs(v);
    return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(3);
  };

  function exportForces() {
    if (!data) return;
    const u = { force: F, length: len };
    downloadText(
      projectFileName(store.project, '_forces'),
      BOM + stringifyCsv(forcesTable(data, store.project.forces, motionUi.forces, u)),
    );
  }

  function exportCsv() {
    if (!data) return;
    const text = BOM + stringifyCsv(resultsTable(data));
    downloadText(projectFileName(store.project, '_kinematics'), text);
  }
</script>

{#if !data || !summary}
  <p class="empty">
    {result.issues.find((i) => i.severity === 'error')?.message ??
      'Results appear here once the mechanism moves: range of motion, Grashof type, transmission angles and peak speeds.'}
  </p>
{:else}
  <div class="results">
    <section class="card">
      <h3>Range of motion</h3>
      <p class="big">{summary.rangeText}</p>
      {#if summary.cycleTime}
        <p class="muted">
          {summary.fullRotation ? 'One revolution' : 'Sweep'} takes {fmt(summary.cycleTime, 3)} s at the set speed.
        </p>
      {/if}
    </section>

    {#if summary.grashof}
      {@const g = summary.grashof}
      <section class="card">
        <h3>Four-bar (Grashof)</h3>
        <p class="big">{g.text}</p>
        <p class="muted num">
          Ground {fmt(g.lengths.ground, 3)} · crank {fmt(g.lengths.crank, 3)} · coupler {fmt(
            g.lengths.coupler,
            3,
          )} · rocker {fmt(g.lengths.rocker, 3)}
          {len}
        </p>
      </section>
    {/if}

    {#if summary.jointAngles.length}
      <section class="card wide">
        <h3>Joint angles (transmission)</h3>
        <table>
          <thead><tr><th>Joint</th><th>Min</th><th>Max</th><th>Worst deviation from 90°</th></tr></thead>
          <tbody>
            {#each summary.jointAngles as j (j.id)}
              {@const worstDeg = angleUnit === '°' ? j.worst : (j.worst * 180) / Math.PI}
              <tr>
                <td>{j.id} at {j.point}</td>
                <td class="num">{fmt(j.min)}{angleUnit}</td>
                <td class="num">{fmt(j.max)}{angleUnit}</td>
                <td class="num" class:warn={worstDeg > 50}>
                  {fmt(j.worst)}{angleUnit}
                  {#if worstDeg > 50}<Icon name="alert" size={13} /> poor force transmission{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small">
          Keep transmission angles within about 40°–140° (deviation under 50°) for smooth running.
        </p>
      </section>
    {/if}

    {#if summary.extremes.length}
      <section class="card">
        <h3>Traced points: peaks</h3>
        <table>
          <tbody>
            {#each summary.extremes as e (e.key)}
              <tr><td>Max {e.label}</td><td class="num">{fmt(e.max, 2)} {e.unit}</td></tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if forceSummary}
      {@const fs = forceSummary}
      <section class="card">
        <h3>
          {rotary ? 'Input torque' : 'Actuator force'} ({store.project.forces.mode === 'static'
            ? 'static'
            : 'with inertia'})
        </h3>
        <p class="big num">{sig(fs.effort.min)} to {sig(fs.effort.max)} {effortUnit}</p>
        <p class="muted num">
          RMS {sig(fs.effort.rms)}
          {effortUnit} · peak at {fmt(fs.effort.atMax)}{inputUnit} · peak power {sig(fs.power.peak)} W
        </p>
      </section>
      <section class="card wide">
        <h3>Joint forces (peak over the cycle)</h3>
        <table>
          <thead><tr><th>Joint</th><th>Peak force</th><th>At input</th></tr></thead>
          <tbody>
            {#each fs.joints as j (j.id)}
              <tr>
                <td>{j.id} at {j.point}</td>
                <td class="num">{sig(j.max)} {F}</td>
                <td class="num">{fmt(j.at)}{inputUnit}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small">
          Power balance (virtual work) {fs.balance < 1e-6 ? 'verified' : 'NOT satisfied'}: max relative error {fs.balance.toExponential(
            1,
          )}.
        </p>
      </section>
    {/if}

    <section class="card export">
      <h3>Export</h3>
      <p class="muted small">
        Positions, velocities and accelerations of every point, and angles and rates of every link, for each
        step of the sweep. One header row, units in the column names.
      </p>
      <button class="btn primary" onclick={exportCsv}><Icon name="download" /> Kinematics CSV</button>
      {#if forceSummary}
        <button class="btn outline" onclick={exportForces}><Icon name="download" /> Forces CSV</button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .empty {
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  .results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--space-3);
    align-items: start;
  }

  .card {
    display: grid;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
  }

  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  p {
    margin: 0;
  }

  .big {
    font-size: var(--text-lg);
    font-weight: 600;
  }

  .small {
    font-size: var(--text-sm);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
  }

  th,
  td {
    padding: 3px 4px;
    border-bottom: 1px solid var(--border);
  }

  .warn {
    color: var(--warning);
  }

  .wide {
    grid-column: span 2;
  }

  @media (max-width: 720px) {
    .wide {
      grid-column: auto;
    }
  }

  .export .btn {
    justify-self: start;
  }
</style>

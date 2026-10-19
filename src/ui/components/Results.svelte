<script lang="ts">
  import Icon from './Icon.svelte';
  import JointLabel from './JointLabel.svelte';
  import { pointName } from '../../core/mechanism/names';
  import { formatValue as sig } from '../lib/format';
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
  const outJoint = $derived(result.model.joints.find((j) => j.id === store.project.forces.outputJoint));
  const rangeText = (r: { min: number; max: number }) =>
    sig(r.min) === sig(r.max) ? sig(r.min) : `${sig(r.min)} to ${sig(r.max)}`;
  /** Hovering a row highlights its joint on the canvas. */
  const hover = (point: string | null) => () => (motionUi.hover = point);
  const noJointForces = $derived(
    !!forceSummary && forceSummary.joints.every((j) => j.max === 0) && forceSummary.effort.rms > 0,
  );

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
          {summary.fullRotation ? 'One revolution' : data.cycle ? 'The cycle (there and back)' : 'The sweep'} takes
          {fmt(summary.cycleTime, 3)} s at the set speed.
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
              <tr onmouseenter={hover(j.point)} onmouseleave={hover(null)}>
                <td><JointLabel model={result.model} id={j.id} /></td>
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
      {@const solveOutput = !!fs.output}
      <section class="card">
        <h3>
          {rotary ? 'Input torque' : 'Actuator force'}
          ({solveOutput ? 'given' : store.project.forces.mode === 'static' ? 'static' : 'with inertia'})
        </h3>
        {#if solveOutput}
          <p class="big num">{sig(store.project.forces.input)} {effortUnit}</p>
        {:else}
          <p class="big num">{sig(fs.effort.min)} to {sig(fs.effort.max)} {effortUnit}</p>
          <p class="muted num">
            RMS {sig(fs.effort.rms)}
            {effortUnit} · peak at {fmt(fs.effort.atMax)}{inputUnit}{fs.effort.atBack
              ? ' (on the way back)'
              : ''} · peak power {sig(fs.power.peak)} W
          </p>
        {/if}
        {#if fs.inputForce}
          <p class="muted num">
            As a force at {pointName(result.model, store.project.forces.inputPoint)}:
            {rangeText(fs.inputForce)}
            {F}
          </p>
        {/if}
      </section>
      {#if fs.output}
        {@const rotaryOut = outJoint?.type === 'revolute'}
        <section class="card">
          <h3>Output {rotaryOut ? 'torque' : 'force'}</h3>
          {#if outJoint}<p class="muted"><JointLabel model={result.model} id={outJoint.id} /></p>{/if}
          <p class="big num">typically {sig(fs.output.typical)} {rotaryOut ? `${F}·${len}` : F}</p>
          <p class="muted num">
            Range {rangeText(fs.output)}
            {#if fs.output.ma}· mechanical advantage {rangeText(fs.output.ma)}×{/if}
          </p>
          {#if fs.output.deadPoints.length}
            <p class="warn small">
              <Icon name="alert" size={13} /> The output stops and reverses at {fs.output.deadPoints
                .map((v) => `${fmt(v)}${inputUnit}`)
                .join(', ')}: near there its {rotaryOut ? 'torque' : 'force'} grows without bound (a dead point).
            </p>
          {/if}
          {#if fs.outputForce}
            <p class="muted num">
              As a force at {pointName(result.model, store.project.forces.outputPoint)}:
              {rangeText(fs.outputForce)}
              {F}
            </p>
          {/if}
        </section>
      {/if}
      <section class="card wide">
        <h3>Joint forces (peak over the cycle)</h3>
        <table>
          <thead><tr><th>Joint</th><th>Peak force</th><th>At input</th></tr></thead>
          <tbody>
            {#each fs.joints as j (j.id)}
              <tr onmouseenter={hover(j.point)} onmouseleave={hover(null)}>
                <td><JointLabel model={result.model} id={j.id} /></td>
                <td class="num">{sig(j.max)} {F}</td>
                <td class="num"
                  >{j.max === 0 ? '–' : `${fmt(j.at)}${inputUnit}${j.atBack ? ' (back)' : ''}`}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
        {#if noJointForces}
          <p class="note small">
            <Icon name="info" size={13} /> No joint carries any force: every load acts on the driven link, so the
            driver cancels it directly. To see what an input torque produces elsewhere, set Forces → Solve for to
            Output from input; or put the load where it is resisted, such as on the output link.
          </p>
        {/if}
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

  tbody tr:hover {
    background: var(--accent-soft);
  }

  .note {
    display: flex;
    gap: 6px;
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
  }

  .note :global(svg) {
    flex: none;
    margin-top: 2px;
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

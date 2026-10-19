<script lang="ts">
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import { BODY_COLORS, GROUND, type DriverType } from '../../core/mechanism/types';
  import { defaultRange } from '../../core/mechanism/motion';
  import { store } from '../state/project.svelte';
  import { motionUi } from '../state/motion.svelte';

  let { mode }: { mode: 'mechanism' | 'motion' } = $props();

  const project = $derived(store.project);
  const mech = $derived(project.mechanism);
  const r = $derived(motionUi.result);
  const model = $derived(r.model);
  const d = $derived(mech.driver);
  const angleUnit = $derived(project.meta.angle_unit === 'deg' ? '°' : 'rad');
  const lengthUnit = $derived(project.meta.length_unit);
  const def = $derived(defaultRange(project, model));

  const bodyOf = (line: string) => mech.bodies.find((b) => b.lines.includes(line));
  const lineLabel = (l: string) => {
    const b = bodyOf(l);
    return b ? `${l} · ${b.name}` : model.groundLines.has(l) ? `${l} · ground` : l;
  };
  const movingLines = $derived(model.bodies.flatMap((b) => b.lines));
  const refLines = $derived([...movingLines, ...model.groundLines]);
  const pointOptions = $derived(
    [...new Set([...model.bodies.flatMap((b) => b.points), ...model.groundPoints])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    ),
  );
  const pointLabel = (p: string) => {
    const label = project.sketch.points.find((x) => x.id === p)?.label;
    return label ? `${p} · ${label}` : p;
  };

  const selBodies = $derived(motionUi.selection.filter((id) => mech.bodies.some((b) => b.id === id)));
  const selPoint = $derived(
    motionUi.selection.length === 1 && !selBodies.length ? motionUi.selection[0]! : null,
  );
  const body = $derived(selBodies.length === 1 ? mech.bodies.find((b) => b.id === selBodies[0]) : undefined);
  const jointsAt = $derived(selPoint ? mech.joints.filter((j) => j.point === selPoint) : []);
  const bodyName = (id: string) =>
    id === GROUND ? 'ground' : (mech.bodies.find((b) => b.id === id)?.name ?? id);

  const statusOk = $derived(
    r.issues.every((i) => i.severity !== 'error') && r.mobility === 1 && !!model.driver,
  );
  const errors = $derived(r.issues);
  const types: { id: DriverType; label: string }[] = [
    { id: 'none', label: 'None' },
    { id: 'rotary', label: 'Rotary' },
    { id: 'linear', label: 'Linear' },
  ];

  function chooseType(t: DriverType) {
    if (t === d.type) return;
    if (t === 'rotary') motionUi.setDriver({ type: t, line: d.line || movingLines[0] || '', lineRef: '' });
    else if (t === 'linear')
      motionUi.setDriver({
        type: t,
        pointA: d.pointA || pointOptions[0] || '',
        pointB: d.pointB || pointOptions[1] || '',
      });
    else motionUi.setDriver({ type: t });
  }
</script>

<header>
  <h2>{mode === 'mechanism' ? 'Mechanism' : 'Motion'}</h2>
  <p class="status" class:ok={statusOk}>
    <Icon name={statusOk ? 'check' : 'info'} size={16} />
    {#if model.bodies.length === 0}
      No links yet
    {:else}
      {r.mobility} degree{r.mobility === 1 ? '' : 's'} of freedom{model.driver ? ' · driven' : ''}
    {/if}
  </p>
  {#each errors as e, i (i)}
    <p class="issue {e.severity}"><Icon name="alert" size={15} /><span>{e.message}</span></p>
  {/each}
  {#if motionUi.testQ}
    <p class="test">
      <span>Showing a test pose you dragged.</span>
      <button class="btn outline" onclick={() => (motionUi.testPose = null)}>Back to drawn pose</button>
    </p>
  {/if}
</header>

<section>
  <h3>Driver</h3>
  <div class="seg" role="radiogroup" aria-label="Driver type">
    {#each types as t (t.id)}
      <button
        role="radio"
        aria-checked={d.type === t.id}
        class:on={d.type === t.id}
        onclick={() => chooseType(t.id)}
      >
        {t.label}
      </button>
    {/each}
  </div>
  {#if d.type === 'rotary'}
    <label class="field">
      <span>Driven line (its angle is the input)</span>
      <select
        class="select"
        value={d.line}
        onchange={(e) => motionUi.setDriver({ line: e.currentTarget.value })}
      >
        {#each movingLines as l (l)}<option value={l}>{lineLabel(l)}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Angle measured from</span>
      <select
        class="select"
        value={d.lineRef}
        onchange={(e) => motionUi.setDriver({ lineRef: e.currentTarget.value })}
      >
        <option value="">+x axis (ground)</option>
        {#each refLines.filter((l) => l !== d.line) as l (l)}<option value={l}>{lineLabel(l)}</option>{/each}
      </select>
    </label>
  {:else if d.type === 'linear'}
    <div class="grid2">
      <label class="field">
        <span>Actuator from</span>
        <select
          class="select"
          value={d.pointA}
          onchange={(e) => motionUi.setDriver({ pointA: e.currentTarget.value })}
        >
          {#each pointOptions as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>to</span>
        <select
          class="select"
          value={d.pointB}
          onchange={(e) => motionUi.setDriver({ pointB: e.currentTarget.value })}
        >
          {#each pointOptions as p (p)}<option value={p}>{pointLabel(p)}</option>{/each}
        </select>
      </label>
    </div>
  {:else}
    <p class="muted small">
      Pick the input that moves the mechanism: a rotary crank, or a linear actuator between two points. You
      can also select a dimension in the Sketch and choose “Use as driver”.
    </p>
  {/if}
  {#if d.type !== 'none'}
    {@const unit = d.type === 'rotary' ? angleUnit : lengthUnit}
    <div class="grid2">
      <NumberField
        label="Sweep from"
        {unit}
        value={d.start ?? def.start}
        oncommit={(v) => motionUi.setDriver({ start: v })}
      />
      <NumberField
        label="to"
        {unit}
        value={d.end ?? def.end}
        oncommit={(v) => motionUi.setDriver({ end: v })}
      />
      <NumberField
        label="Steps"
        value={d.steps}
        oncommit={(v) => motionUi.setDriver({ steps: Math.max(2, Math.min(5000, Math.round(v))) })}
      />
      <NumberField
        label="Speed"
        unit={d.type === 'rotary' ? 'rpm' : `${lengthUnit}/s`}
        value={d.speed}
        oncommit={(v) => motionUi.setDriver({ speed: v })}
      />
    </div>
    {#if !r.res?.fullRotation}
      <label class="check">
        <input
          type="checkbox"
          checked={d.returnStroke}
          onchange={(e) => motionUi.setDriver({ returnStroke: e.currentTarget.checked })}
        />
        There and back: include the return stroke
      </label>
    {/if}
  {/if}
</section>

{#if body}
  <section>
    <h3>Link {body.id}</h3>
    <label class="field">
      <span>Name</span>
      <input
        class="input"
        value={body.name}
        oninput={(e) => motionUi.updateBody(body.id, { name: e.currentTarget.value })}
      />
    </label>
    <div class="swatches" role="radiogroup" aria-label="Colour">
      {#each BODY_COLORS as c (c)}
        <button
          role="radio"
          aria-checked={body.color === c}
          aria-label={`Colour ${c}`}
          class="swatch"
          class:on={body.color === c}
          style:background={c}
          onclick={() => motionUi.updateBody(body.id, { color: c })}
        ></button>
      {/each}
    </div>
    <label class="check">
      <input
        type="checkbox"
        checked={body.ground}
        onchange={(e) => motionUi.updateBody(body.id, { ground: e.currentTarget.checked })}
      />
      Fixed to ground
    </label>
    <p class="muted small">Lines: {body.lines.join(', ')}</p>
    {#if body.lines.length > 1}
      <button class="btn outline" onclick={() => motionUi.split(body.id)}>Split into separate links</button>
    {/if}
  </section>
{:else if selBodies.length > 1}
  <section>
    <h3>{selBodies.length} links selected</h3>
    <button class="btn primary" onclick={() => motionUi.merge(selBodies)}>Merge into one rigid link</button>
    <p class="muted small">Merged lines move together as one rigid body, e.g. a ternary coupler plate.</p>
  </section>
{:else if selPoint}
  <section>
    <h3>Point {pointLabel(selPoint)}</h3>
    {#if !model.groundPoints.has(selPoint)}
      <label class="check">
        <input
          type="checkbox"
          checked={mech.motion.trace.includes(selPoint)}
          onchange={(e) => motionUi.setTrace(selPoint, e.currentTarget.checked)}
        />
        Trace its path
      </label>
    {:else}
      <p class="muted small">Ground point (fixed).</p>
    {/if}
    {#each jointsAt as j (j.id)}
      <div class="joint">
        <span><strong>{j.id}</strong> · {bodyName(j.bodyA)} – {bodyName(j.bodyB)}</span>
        {#if j.type === 'revolute'}
          <span class="muted">Revolute (pin)</span>
        {:else}
          <select
            class="select"
            value={j.type}
            onchange={(e) => motionUi.setJointType(j.id, e.currentTarget.value as 'slider')}
          >
            <option value="pin_in_slot">Pin in slot (free to rotate)</option>
            <option value="slider">Slider block (no rotation)</option>
          </select>
        {/if}
      </div>
    {/each}
  </section>
{/if}

<section>
  <h3>Links <span class="count">{mech.bodies.length}</span></h3>
  <ul class="list">
    {#each mech.bodies as b (b.id)}
      <li>
        <button
          class="row"
          class:selected={motionUi.selection.includes(b.id)}
          onclick={(e) =>
            (motionUi.selection = e.shiftKey
              ? motionUi.selection.includes(b.id)
                ? motionUi.selection.filter((x) => x !== b.id)
                : [...motionUi.selection, b.id]
              : [b.id])}
        >
          <span class="dot" style:background={b.color}></span>
          <span class="name">{b.name}</span>
          <span class="muted">{b.ground ? 'ground' : b.lines.join(' ')}</span>
        </button>
      </li>
    {/each}
  </ul>
  {#if mode === 'mechanism' && mech.bodies.length > 1}
    <p class="muted small">Shift-click links to select several, then merge them into one rigid link.</p>
  {/if}
</section>

{#if mode === 'motion'}
  <section>
    <h3>Display</h3>
    <label class="check"><input type="checkbox" bind:checked={motionUi.showTraces} /> Show traced paths</label
    >
    <label class="check"
      ><input type="checkbox" bind:checked={motionUi.showVelocity} /> Show velocity vectors</label
    >
    <p class="muted small">Click a point on the canvas to trace its path or plot it.</p>
  </section>
{/if}

<style>
  header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .status.ok {
    color: var(--success);
  }

  .issue {
    display: flex;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .issue :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .issue.error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .issue.warning {
    background: var(--warning-soft);
    color: var(--warning);
  }

  h3 {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .count {
    color: var(--text-faint);
  }

  section {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2) var(--space-3);
  }

  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 3px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .seg button {
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    cursor: pointer;
  }

  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px var(--border);
  }

  .small {
    margin: 0;
    font-size: var(--text-sm);
  }

  .test {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    cursor: pointer;
  }

  .check input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .swatch {
    width: 22px;
    height: 22px;
    border: 2px solid var(--surface);
    border-radius: 50%;
    box-shadow: 0 0 0 1px var(--border);
    cursor: pointer;
  }

  .swatch.on {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .list {
    display: grid;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 6px var(--space-2);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    font-size: var(--text-sm);
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.selected {
    background: var(--accent-soft);
  }

  .dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }

  .name {
    flex: 1;
    font-weight: 500;
  }

  .joint {
    display: grid;
    gap: var(--space-1);
    font-size: var(--text-sm);
  }
</style>

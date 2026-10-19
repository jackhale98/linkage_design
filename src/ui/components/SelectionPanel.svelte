<script lang="ts">
  import { CONSTRAINT_DEFS, isDimension } from '../../core/sketch/constraints';
  import { applicableConstraints } from '../../core/sketch/edit';
  import type { ConstraintType } from '../../core/sketch/types';
  import NumberField from './NumberField.svelte';
  import Icon from './Icon.svelte';
  import { store } from '../state/project.svelte';
  import { RELATION_KEYS, sketchUi } from '../state/sketch.svelte';

  const sketch = $derived(store.project.sketch);
  const meta = $derived(store.project.meta);
  const sel = $derived(sketchUi.selection);
  const single = $derived(sel.length === 1 ? sel[0]! : null);
  const point = $derived(single ? sketch.points.find((p) => p.id === single) : undefined);
  const line = $derived(single ? sketch.lines.find((l) => l.id === single) : undefined);
  const constraint = $derived(single ? sketch.constraints.find((c) => c.id === single) : undefined);
  const a = $derived(sketchUi.analysis);
  const angleSym = $derived(meta.angle_unit === 'deg' ? '°' : 'rad');

  const geom = $derived(sketchUi.geometrySelection);
  const applicable = $derived(geom.length === sel.length ? applicableConstraints(sketch, geom) : []);
  const dims = $derived(applicable.filter((t) => CONSTRAINT_DEFS[t].value));
  const relations = $derived(applicable.filter((t) => !CONSTRAINT_DEFS[t].value));

  const lineInfo = $derived.by(() => {
    if (!line) return null;
    const p1 = sketch.points.find((p) => p.id === line.p1)!;
    const p2 = sketch.points.find((p) => p.id === line.p2)!;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) / (meta.angle_unit === 'deg' ? Math.PI / 180 : 1);
    return { len, ang };
  });

  const bad = $derived(constraint && (a.redundant.has(constraint.id) || a.unsatisfied.has(constraint.id)));

  function title(): string {
    if (point) return `Point ${point.id}`;
    if (line) return `Line ${line.id}`;
    if (constraint) return `${CONSTRAINT_DEFS[constraint.type].label} ${constraint.id}`;
    return `${sel.length} items selected`;
  }

  function add(t: ConstraintType) {
    sketchUi.addConstraint(t, geom);
  }

  const fmt = (v: number) => (Math.abs(v) < 1e-9 ? '0' : v.toFixed(3).replace(/\.?0+$/, ''));
</script>

<header>
  <h2>{title()}</h2>
  {#if point}
    <p class="muted">
      {point.fixed
        ? 'Fixed in place'
        : a.freePoints.has(point.id)
          ? 'Free to move (under-defined)'
          : 'Fully defined'}
    </p>
  {:else if constraint}
    <p class="muted">On {constraint.refs.join(', ')}</p>
  {/if}
</header>

{#if bad}
  <p class="warn">
    <Icon name="alert" size={16} />
    {a.unsatisfied.has(constraint!.id)
      ? 'This constraint conflicts with others and is not satisfied.'
      : 'This constraint duplicates others. Delete it or make it a reference.'}
  </p>
{/if}

{#if point}
  <section class="grid2">
    <NumberField
      label="X"
      unit={meta.length_unit}
      value={point.x}
      oncommit={(v) => sketchUi.movePoint(point.id, v, point.y)}
    />
    <NumberField
      label="Y"
      unit={meta.length_unit}
      value={point.y}
      oncommit={(v) => sketchUi.movePoint(point.id, point.x, v)}
    />
  </section>
  <section>
    <label class="check">
      <input
        type="checkbox"
        checked={point.fixed}
        onchange={(e) => sketchUi.setFixed(point.id, e.currentTarget.checked)}
      />
      Fixed (anchored to ground)
    </label>
    <label class="field">
      <span>Label</span>
      <input
        class="input"
        value={point.label}
        placeholder="e.g. O2, crank pin"
        oninput={(e) => sketchUi.setLabel(point.id, e.currentTarget.value)}
      />
    </label>
  </section>
{:else if line && lineInfo}
  <section>
    <dl>
      <dt>From</dt>
      <dd>{line.p1}</dd>
      <dt>To</dt>
      <dd>{line.p2}</dd>
      <dt>Length</dt>
      <dd class="num">{fmt(lineInfo.len)} {meta.length_unit}</dd>
      <dt>Angle</dt>
      <dd class="num">{fmt(lineInfo.ang)}{angleSym}</dd>
    </dl>
    <label class="check">
      <input
        type="checkbox"
        checked={line.construction}
        onchange={(e) => sketchUi.setConstruction(line.id, e.currentTarget.checked)}
      />
      Construction geometry
    </label>
  </section>
{:else if constraint && isDimension(constraint)}
  {@const angle = CONSTRAINT_DEFS[constraint.type].value === 'angle'}
  <section>
    <NumberField
      label="Value"
      unit={angle ? angleSym : meta.length_unit}
      value={angle && constraint.refs.length === 2 ? Math.abs(constraint.value ?? 0) : constraint.value}
      disabled={constraint.reference}
      oncommit={(v) => sketchUi.setDimension(constraint.id, v)}
    />
    <label class="check">
      <input
        type="checkbox"
        checked={constraint.reference}
        onchange={(e) => {
          if (!sketchUi.setReference(constraint.id, e.currentTarget.checked))
            e.currentTarget.checked = constraint.reference;
        }}
      />
      Reference (measured, doesn't drive geometry)
    </label>
  </section>
{/if}

{#if dims.length || relations.length}
  <section>
    <h3>Add</h3>
    <div class="actions">
      {#each [...dims, ...relations] as t (t)}
        <button
          class="btn outline action"
          onclick={() => add(t)}
          title={CONSTRAINT_DEFS[t].label + (RELATION_KEYS[t] ? ` (${RELATION_KEYS[t]})` : '')}
        >
          <span class="sym">{CONSTRAINT_DEFS[t].symbol}</span>
          <span class="lbl">{CONSTRAINT_DEFS[t].label}</span>
          {#if RELATION_KEYS[t]}<kbd>{RELATION_KEYS[t]}</kbd>{/if}
        </button>
      {/each}
    </div>
  </section>
{:else if geom.length > 0 && geom.length === sel.length}
  <p class="muted small">No constraints apply to this combination. Select one or two items.</p>
{/if}

<section>
  <button class="btn outline danger" onclick={() => sketchUi.deleteSelection()}>Delete <kbd>Del</kbd></button>
</section>

<style>
  header h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }

  header p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  section {
    display: grid;
    gap: var(--space-3);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .grid2 {
    grid-template-columns: 1fr 1fr;
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

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-1);
  }

  .action {
    justify-content: flex-start;
    height: 32px;
    padding: 0 var(--space-2);
  }

  .sym {
    width: 20px;
    color: var(--accent);
    font-weight: 700;
    text-align: center;
  }

  .lbl {
    flex: 1;
    text-align: left;
  }

  .danger {
    justify-self: start;
    color: var(--danger);
  }

  .warn {
    display: flex;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .small {
    margin: 0;
    font-size: var(--text-sm);
  }
</style>

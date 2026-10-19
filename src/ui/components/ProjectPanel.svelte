<script lang="ts">
  import {
    ANGLE_UNITS,
    FORCE_UNITS,
    LENGTH_UNITS,
    convertUnits,
    type AngleUnit,
    type ForceUnit,
    type LengthUnit,
  } from '../../core/model/project';
  import { store } from '../state/project.svelte';

  const meta = $derived(store.project.meta);

  const PRESETS = [
    { label: 'mm · N', length: 'mm', force: 'N' },
    { label: 'm · N', length: 'm', force: 'N' },
    { label: 'in · lbf', length: 'in', force: 'lbf' },
  ] as const;

  /** Change units, converting stored values so the physical geometry is unchanged. */
  function setUnits(length: LengthUnit, angle: AngleUnit, force: ForceUnit) {
    if (length === meta.length_unit && angle === meta.angle_unit && force === meta.force_unit) return;
    store.update((p) => {
      convertUnits(p, length, angle);
      p.meta.force_unit = force;
    });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso || '—' : d.toLocaleString();
  }
</script>

<section>
  <h3>Units</h3>
  <div class="presets" role="group" aria-label="Unit system">
    {#each PRESETS as p (p.label)}
      <button
        class="btn outline preset"
        class:active={meta.length_unit === p.length && meta.force_unit === p.force}
        onclick={() => setUnits(p.length, meta.angle_unit, p.force)}
      >
        {p.label}
      </button>
    {/each}
  </div>
  <div class="row">
    <label class="field">
      <span>Length</span>
      <select
        class="select"
        value={meta.length_unit}
        onchange={(e) => setUnits(e.currentTarget.value as LengthUnit, meta.angle_unit, meta.force_unit)}
      >
        {#each LENGTH_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Force</span>
      <select
        class="select"
        value={meta.force_unit}
        onchange={(e) => setUnits(meta.length_unit, meta.angle_unit, e.currentTarget.value as ForceUnit)}
      >
        {#each FORCE_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Angle</span>
      <select
        class="select"
        value={meta.angle_unit}
        onchange={(e) => setUnits(meta.length_unit, e.currentTarget.value as AngleUnit, meta.force_unit)}
      >
        {#each ANGLE_UNITS as u (u)}<option value={u}>{u}</option>{/each}
      </select>
    </label>
  </div>
  <p class="hint muted">Changing units converts existing values; the geometry stays the same size.</p>
</section>

<section>
  <label class="field">
    <span>Notes</span>
    <textarea
      class="textarea"
      rows="4"
      placeholder="Design intent, assumptions, revision notes…"
      value={meta.notes}
      oninput={(e) => store.update((p) => (p.meta.notes = e.currentTarget.value), 'meta.notes')}></textarea>
  </label>
</section>

<section class="dates">
  <dl>
    <dt>Created</dt>
    <dd class="num">{formatDate(meta.created)}</dd>
    <dt>Modified</dt>
    <dd class="num">{formatDate(meta.modified)}</dd>
  </dl>
</section>

<style>
  h3 {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  section {
    padding-top: var(--space-4);
    border-top: 1px solid var(--border);
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .preset {
    height: 30px;
    padding: 0;
    font-size: var(--text-sm);
  }

  .preset.active {
    border-color: var(--accent);
  }

  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }

  .hint {
    margin: var(--space-2) 0 0;
    font-size: var(--text-xs);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--text-sm);
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
  }
</style>

<script lang="ts">
  import { ANGLE_UNITS, FORCE_UNITS, LENGTH_UNITS } from '../../core/model/project';
  import { store } from '../state/project.svelte';

  const meta = $derived(store.project.meta);

  const PRESETS = [
    { label: 'mm · N', length: 'mm', force: 'N' },
    { label: 'm · N', length: 'm', force: 'N' },
    { label: 'in · lbf', length: 'in', force: 'lbf' },
  ] as const;

  function setField<K extends 'length_unit' | 'force_unit' | 'angle_unit' | 'notes'>(key: K, value: string) {
    store.update((p) => ((p.meta[key] as string) = value), key === 'notes' ? 'meta.notes' : undefined);
  }

  function applyPreset(length: (typeof LENGTH_UNITS)[number], force: (typeof FORCE_UNITS)[number]) {
    store.update((p) => {
      p.meta.length_unit = length;
      p.meta.force_unit = force;
    });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso || '—' : d.toLocaleString();
  }
</script>

<aside class="inspector" aria-label="Properties">
  <header>
    <h2>Project</h2>
    <p class="muted">Nothing selected. These settings apply to the whole project.</p>
  </header>

  <section>
    <h3>Units</h3>
    <div class="presets" role="group" aria-label="Unit system">
      {#each PRESETS as p (p.label)}
        <button
          class="btn outline preset"
          class:active={meta.length_unit === p.length && meta.force_unit === p.force}
          onclick={() => applyPreset(p.length, p.force)}
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
          onchange={(e) => setField('length_unit', e.currentTarget.value)}
        >
          {#each LENGTH_UNITS as u (u)}<option value={u}>{u}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Force</span>
        <select
          class="select"
          value={meta.force_unit}
          onchange={(e) => setField('force_unit', e.currentTarget.value)}
        >
          {#each FORCE_UNITS as u (u)}<option value={u}>{u}</option>{/each}
        </select>
      </label>
      <label class="field">
        <span>Angle</span>
        <select
          class="select"
          value={meta.angle_unit}
          onchange={(e) => setField('angle_unit', e.currentTarget.value)}
        >
          {#each ANGLE_UNITS as u (u)}<option value={u}>{u}</option>{/each}
        </select>
      </label>
    </div>
  </section>

  <section>
    <label class="field">
      <span>Notes</span>
      <textarea
        class="textarea"
        rows="4"
        placeholder="Design intent, assumptions, revision notes…"
        value={meta.notes}
        oninput={(e) => setField('notes', e.currentTarget.value)}></textarea>
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
</aside>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: var(--inspector-w);
    height: 100%;
    padding: var(--space-4);
    overflow-y: auto;
    border-left: 1px solid var(--border);
    background: var(--surface);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: 600;
  }

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  header p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
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

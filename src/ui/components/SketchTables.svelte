<script lang="ts">
  import { evaluateExpression } from '../../core/expr';
  import { CONSTRAINT_DEFS, isDimension } from '../../core/sketch/constraints';
  import { formatPlain } from '../lib/sketchLayout';
  import { store } from '../state/project.svelte';
  import { sketchUi } from '../state/sketch.svelte';

  const sketch = $derived(store.project.sketch);
  const a = $derived(sketchUi.analysis);
  const selected = $derived(new Set(sketchUi.selection));

  /** Commit an expression from a table cell; restore the cell on bad input. */
  function commitNumber(e: Event, current: number | undefined, apply: (v: number) => void) {
    const el = e.currentTarget as HTMLInputElement;
    try {
      apply(evaluateExpression(el.value));
    } catch {
      /* fall through to restore */
    }
    el.value = current === undefined ? '' : formatPlain(current);
  }

  function select(id: string, e: MouseEvent) {
    if ((e.target as HTMLElement).closest('input')) return;
    sketchUi.selection = e.shiftKey
      ? selected.has(id)
        ? sketchUi.selection.filter((x) => x !== id)
        : [...sketchUi.selection, id]
      : [id];
  }

  const len = (id: string) => {
    const l = sketch.lines.find((x) => x.id === id)!;
    const p = sketch.points.find((x) => x.id === l.p1)!;
    const q = sketch.points.find((x) => x.id === l.p2)!;
    return Math.hypot(q.x - p.x, q.y - p.y);
  };
</script>

{#if sketch.points.length === 0}
  <p class="empty">
    The sketch is empty. Points, lines and constraints you draw appear here as editable tables.
  </p>
{:else}
  <div class="tables">
    <section>
      <h3>Points <span class="count">{sketch.points.length}</span></h3>
      <table>
        <thead>
          <tr
            ><th>ID</th><th>X ({store.project.meta.length_unit})</th><th>Y</th><th>Fixed</th><th>Label</th
            ></tr
          >
        </thead>
        <tbody>
          {#each sketch.points as p (p.id)}
            <tr class:selected={selected.has(p.id)} onclick={(e) => select(p.id, e)}>
              <td class="id" class:free={a.freePoints.has(p.id)}>{p.id}</td>
              <td>
                <input
                  class="cell num"
                  value={formatPlain(p.x)}
                  aria-label={`${p.id} x`}
                  onchange={(e) => commitNumber(e, p.x, (v) => sketchUi.movePoint(p.id, v, p.y))}
                />
              </td>
              <td>
                <input
                  class="cell num"
                  value={formatPlain(p.y)}
                  aria-label={`${p.id} y`}
                  onchange={(e) => commitNumber(e, p.y, (v) => sketchUi.movePoint(p.id, p.x, v))}
                />
              </td>
              <td class="c">
                <input
                  type="checkbox"
                  checked={p.fixed}
                  aria-label={`${p.id} fixed`}
                  onchange={(e) => {
                    if (!sketchUi.setFixed(p.id, e.currentTarget.checked)) e.currentTarget.checked = p.fixed;
                  }}
                />
              </td>
              <td>
                <input
                  class="cell"
                  value={p.label}
                  aria-label={`${p.id} label`}
                  oninput={(e) => sketchUi.setLabel(p.id, e.currentTarget.value)}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section>
      <h3>Lines <span class="count">{sketch.lines.length}</span></h3>
      <table>
        <thead><tr><th>ID</th><th>From</th><th>To</th><th>Length</th><th>Constr.</th></tr></thead>
        <tbody>
          {#each sketch.lines as l (l.id)}
            <tr class:selected={selected.has(l.id)} onclick={(e) => select(l.id, e)}>
              <td class="id">{l.id}</td>
              <td>{l.p1}</td>
              <td>{l.p2}</td>
              <td class="num r">{formatPlain(Number(len(l.id).toFixed(4)))}</td>
              <td class="c">
                <input
                  type="checkbox"
                  checked={l.construction}
                  aria-label={`${l.id} construction`}
                  onchange={(e) => sketchUi.setConstruction(l.id, e.currentTarget.checked)}
                />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section>
      <h3>Constraints <span class="count">{sketch.constraints.length}</span></h3>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>On</th><th>Value</th><th>Ref.</th></tr></thead>
        <tbody>
          {#each sketch.constraints as c (c.id)}
            {@const bad = a.redundant.has(c.id) || a.unsatisfied.has(c.id)}
            <tr class:selected={selected.has(c.id)} class:bad onclick={(e) => select(c.id, e)}>
              <td class="id">{c.id}</td>
              <td>{CONSTRAINT_DEFS[c.type].label}</td>
              <td>{c.refs.join(', ')}</td>
              <td>
                {#if isDimension(c)}
                  <input
                    class="cell num"
                    value={c.value === undefined ? '' : formatPlain(c.value)}
                    disabled={c.reference}
                    aria-label={`${c.id} value`}
                    onchange={(e) => commitNumber(e, c.value, (v) => sketchUi.setDimension(c.id, v))}
                  />
                {/if}
              </td>
              <td class="c">
                {#if isDimension(c)}
                  <input
                    type="checkbox"
                    checked={c.reference}
                    aria-label={`${c.id} reference`}
                    onchange={(e) => {
                      if (!sketchUi.setReference(c.id, e.currentTarget.checked))
                        e.currentTarget.checked = c.reference;
                    }}
                  />
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
{/if}

<style>
  .empty {
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  .tables {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-4);
    align-items: start;
  }

  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .count {
    color: var(--text-faint);
    font-weight: 500;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th {
    position: sticky;
    top: 0;
    padding: 4px 6px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
    white-space: nowrap;
  }

  td {
    padding: 1px 6px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  tr {
    cursor: default;
  }

  tbody tr:hover {
    background: var(--surface-hover);
  }

  tr.selected {
    background: var(--accent-soft);
  }

  tr.bad td {
    color: var(--danger);
  }

  .id {
    font-weight: 600;
  }

  .id.free {
    color: var(--geom-under);
  }

  .c {
    text-align: center;
  }

  .r {
    text-align: right;
  }

  .cell {
    width: 100%;
    min-width: 60px;
    height: 24px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
  }

  .cell:hover:not(:disabled) {
    border-color: var(--border);
  }

  .cell:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
  }

  .cell:disabled {
    color: var(--text-muted);
  }

  input[type='checkbox'] {
    accent-color: var(--accent);
  }
</style>

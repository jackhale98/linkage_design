<script lang="ts">
  import { store } from '../state/project.svelte';
  import { sketchState, sketchUi } from '../state/sketch.svelte';
  import { ui } from '../state/ui.svelte';

  const state = $derived(sketchState(store.project.sketch, sketchUi.analysis));
  const a = $derived(sketchUi.analysis);
  const text = $derived(
    state === 'over'
      ? `Over-defined (${new Set([...a.redundant, ...a.unsatisfied]).size})`
      : state === 'full'
        ? 'Fully defined'
        : state === 'under'
          ? `${a.dof} degree${a.dof === 1 ? '' : 's'} of freedom`
          : 'Empty sketch',
  );
  const title = $derived(
    state === 'over'
      ? 'Some constraints conflict or duplicate others. See Messages.'
      : state === 'under'
        ? 'Blue geometry can still move. Add constraints or dimensions to define it.'
        : state === 'full'
          ? 'Every point is fixed by constraints and dimensions.'
          : 'Draw points and lines to start.',
  );
</script>

<button
  class="status {state}"
  {title}
  onclick={() => state === 'over' && ui.openDock('messages')}
  data-testid="sketch-status"
>
  <span class="dot"></span>{text}
</button>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-sm);
    color: var(--text);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: default;
  }

  .status.over {
    cursor: pointer;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .under .dot {
    background: var(--geom-under);
  }

  .full .dot {
    background: var(--success);
  }

  .over .dot {
    background: var(--geom-over);
  }

  .over {
    color: var(--geom-over);
  }
</style>

<script lang="ts">
  import { motionUi } from '../state/motion.svelte';
  import { ui } from '../state/ui.svelte';

  const r = $derived(motionUi.result);
  const error = $derived(r.issues.find((i) => i.severity === 'error'));
  const state = $derived(
    r.model.bodies.length === 0 ? 'empty' : error ? 'over' : !r.model.driver ? 'under' : 'full',
  );
  const text = $derived(
    state === 'empty'
      ? 'No links'
      : error
        ? r.mobility === 0
          ? 'Locked'
          : r.mobility === 1
            ? 'Cannot move'
            : `${r.mobility} DOF`
        : !r.model.driver
          ? `${r.mobility} DOF · no driver`
          : r.res?.fullRotation
            ? 'Full rotation'
            : 'Ready',
  );
</script>

<button
  class="status {state}"
  title={error?.message ?? r.issues[0]?.message ?? 'The mechanism moves with one driver.'}
  onclick={() => (ui.inspectorOpen = true)}
  data-testid="mechanism-status"
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

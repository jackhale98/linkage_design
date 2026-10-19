<script lang="ts">
  import type { Workspace } from '../state/ui.svelte';

  let {
    workspace,
    sketchEmpty,
    hint,
    onexample,
  }: { workspace: Workspace; sketchEmpty: boolean; hint: string; onexample: () => void } = $props();

  const INTRO: Record<Exclude<Workspace, 'sketch'>, { title: string; text: string }> = {
    mechanism: {
      title: 'Mechanism',
      text: 'Group sketch geometry into rigid links, mark the ground, set joint types and pick the driver.',
    },
    motion: {
      title: 'Motion',
      text: 'Sweep the driver to animate the mechanism, trace coupler curves, and plot positions, velocities, accelerations and transmission angles.',
    },
    forces: {
      title: 'Forces',
      text: 'Apply forces, torques, gravity and springs to get the reaction at every joint and the required input torque or force.',
    },
    cam: {
      title: 'Cam',
      text: 'Define a motion program and follower to generate the cam profile, with SVAJ, pressure angle, curvature and undercut checks.',
    },
  };
</script>

{#if workspace === 'sketch'}
  {#if sketchEmpty}
    <div class="card">
      <h2>Start a sketch</h2>
      <p>Draw the mechanism’s geometry, then add constraints and dimensions until it’s fully defined.</p>
      <ul class="keys">
        <li><kbd>L</kbd> Line</li>
        <li><kbd>P</kbd> Point</li>
        <li><kbd>D</kbd> Dimension</li>
        <li><kbd>Esc</kbd> Select</li>
      </ul>
      <button class="btn outline" onclick={onexample}>Load the four-bar example</button>
    </div>
  {:else if hint}
    <div class="hint" role="status">{hint}</div>
  {/if}
{:else}
  {@const intro = INTRO[workspace]}
  <div class="card">
    <div class="head">
      <h2>{intro.title}</h2>
      <span class="tag">In development</span>
    </div>
    <p>{intro.text}</p>
    <p class="muted small">The sketch is shown read-only here. Edit it in the Sketch workspace.</p>
  </div>
{/if}

<style>
  .card {
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-md);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .tag {
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  p {
    margin: var(--space-2) 0 0;
  }

  .small {
    font-size: var(--text-sm);
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    padding: 0;
    list-style: none;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .hint {
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    padding: 6px 14px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--text) 82%, transparent);
    color: var(--canvas-bg);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>

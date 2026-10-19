<script lang="ts">
  import type { Workspace } from '../state/ui.svelte';

  let { workspace }: { workspace: Workspace } = $props();

  const INTRO: Record<Workspace, { title: string; text: string }> = {
    sketch: {
      title: 'Sketch',
      text: 'Draw points and lines, then add constraints and dimensions to define the mechanism geometry.',
    },
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

  const intro = $derived(INTRO[workspace]);
</script>

<div class="card">
  <div class="head">
    <h2>{intro.title}</h2>
    <span class="tag">In development</span>
  </div>
  <p>{intro.text}</p>
  <p class="muted small">
    Available now: pan and zoom the canvas, set project units and notes, and save or open project CSV files.
  </p>
</div>

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
</style>

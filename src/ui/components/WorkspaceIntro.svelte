<script lang="ts">
  import type { Workspace } from '../state/ui.svelte';

  let {
    workspace,
    sketchEmpty,
    hint,
    mechanismReady,
    hasLinks,
    onexample,
    camEmpty = false,
    oncamstart = () => {},
    oncamexample = () => {},
  }: {
    workspace: Workspace;
    sketchEmpty: boolean;
    hint: string;
    mechanismReady: boolean;
    hasLinks: boolean;
    onexample: () => void;
    camEmpty?: boolean;
    oncamstart?: () => void;
    oncamexample?: () => void;
  } = $props();
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
{:else if workspace === 'mechanism' || workspace === 'motion' || workspace === 'forces'}
  {#if !hasLinks}
    <div class="card">
      <h2>{workspace === 'mechanism' ? 'Mechanism' : workspace === 'motion' ? 'Motion' : 'Forces'}</h2>
      <p>
        Every line you draw in the Sketch becomes a link; fixed points and construction lines touching them
        are ground. Draw a linkage first, or start from an example.
      </p>
      <button class="btn outline" onclick={onexample}>Load the four-bar example</button>
    </div>
  {:else if workspace === 'mechanism'}
    <div class="hint" role="status">
      Drag a link to move the mechanism by hand · click to edit it · shift-click several to merge them
    </div>
  {:else if !mechanismReady}
    <div class="hint" role="status">Set a driver in the panel on the right to animate the mechanism</div>
  {:else if workspace === 'forces'}
    <div class="hint" role="status">Orange: loads · purple: joint reactions and output · teal: input</div>
  {/if}
{:else if workspace === 'cam' && camEmpty}
  <div class="card">
    <h2>Cam design</h2>
    <p>
      Lay out the follower's motion as rises, dwells and returns, pick a follower, and get the cam profile
      with its pressure angle, curvature, undercut and force checks.
    </p>
    <div class="actions">
      <button class="btn primary" onclick={oncamstart}>Start from dwell, rise, dwell, return</button>
      <button class="btn outline" onclick={oncamexample}>Load the cam example</button>
    </div>
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

  h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  p {
    margin: var(--space-2) 0 0;
  }

  .card .btn {
    margin-top: var(--space-3);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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

  .keys + .btn {
    margin-top: 0;
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

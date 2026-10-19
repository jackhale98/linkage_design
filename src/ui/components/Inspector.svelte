<script lang="ts">
  import ProjectPanel from './ProjectPanel.svelte';
  import SelectionPanel from './SelectionPanel.svelte';
  import MechanismPanel from './MechanismPanel.svelte';
  import { sketchUi } from '../state/sketch.svelte';
  import { ui } from '../state/ui.svelte';
</script>

<aside class="inspector" aria-label="Properties">
  {#if ui.workspace === 'mechanism' || ui.workspace === 'motion'}
    <MechanismPanel mode={ui.workspace} />
  {:else if ui.workspace === 'sketch' && sketchUi.selection.length}
    <SelectionPanel />
  {:else}
    <header>
      <h2>Project</h2>
      <p class="muted">Nothing selected. These settings apply to the whole project.</p>
    </header>
    <ProjectPanel />
  {/if}
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

  header p {
    margin: var(--space-1) 0 0;
    font-size: var(--text-sm);
  }
</style>

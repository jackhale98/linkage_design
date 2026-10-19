<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { sketchUi, type SketchTool } from '../state/sketch.svelte';

  /** Drawing tools are only offered where the sketch can be edited. */
  let { editable = true }: { editable?: boolean } = $props();

  const TOOLS: { id: SketchTool; icon: IconName; label: string; key: string; edit?: boolean }[] = [
    { id: 'select', icon: 'select', label: 'Select', key: 'Esc' },
    { id: 'pan', icon: 'pan', label: 'Pan', key: 'hold Space' },
    { id: 'point', icon: 'point', label: 'Point', key: 'P', edit: true },
    { id: 'line', icon: 'line', label: 'Line', key: 'L', edit: true },
    { id: 'dimension', icon: 'dimension', label: 'Dimension', key: 'D', edit: true },
  ];
  const tools = $derived(TOOLS.filter((t) => editable || !t.edit));
</script>

<div class="rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
  {#each tools as t, i (t.id)}
    {#if i === 2}<span class="sep"></span>{/if}
    <button
      class="btn icon tool"
      class:active={sketchUi.tool === t.id}
      aria-pressed={sketchUi.tool === t.id}
      title={`${t.label} (${t.key})`}
      aria-label={t.label}
      onclick={() => sketchUi.setTool(t.id)}
    >
      <Icon name={t.icon} size={20} />
    </button>
  {/each}
</div>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    width: var(--rail-w);
    padding: var(--space-2) 0;
    border-right: 1px solid var(--border);
    background: var(--surface);
  }

  .sep {
    width: 24px;
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--border);
  }

  .tool {
    width: 38px;
    height: 38px;
    border-radius: var(--radius-lg);
  }
</style>

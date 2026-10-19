<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';

  type Tool = 'select' | 'pan';
  let { tool = $bindable<Tool>('select') }: { tool?: Tool } = $props();

  const TOOLS: { id: Tool; icon: IconName; label: string; key: string }[] = [
    { id: 'select', icon: 'select', label: 'Select', key: 'V' },
    { id: 'pan', icon: 'pan', label: 'Pan', key: 'H' },
  ];
</script>

<div class="rail" role="toolbar" aria-label="Tools" aria-orientation="vertical">
  {#each TOOLS as t (t.id)}
    <button
      class="btn icon tool"
      class:active={tool === t.id}
      aria-pressed={tool === t.id}
      title={`${t.label} (${t.key})`}
      aria-label={t.label}
      onclick={() => (tool = t.id)}
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

  .tool {
    width: 38px;
    height: 38px;
    border-radius: var(--radius-lg);
  }
</style>

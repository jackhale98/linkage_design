<script lang="ts">
  import Icon from './Icon.svelte';
  import { toasts } from '../state/toasts.svelte';

  const ICON = { info: 'info', success: 'check', warning: 'alert', error: 'alert' } as const;
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="toast {t.kind}">
      <Icon name={ICON[t.kind]} size={16} />
      <span class="msg">{t.message}</span>
      {#if t.action}
        {@const action = t.action}
        <button
          class="btn action"
          onclick={() => {
            action.run();
            toasts.dismiss(t.id);
          }}>{action.label}</button
        >
      {/if}
      <button class="btn icon close" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: var(--space-5);
    z-index: 50;
    display: grid;
    gap: var(--space-2);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 280px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 6px 6px 6px var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    pointer-events: auto;
    animation: rise var(--duration) var(--ease);
  }

  .toast.success :global(svg:first-child) {
    color: var(--success);
  }

  .toast.warning :global(svg:first-child) {
    color: var(--warning);
  }

  .toast.error :global(svg:first-child) {
    color: var(--danger);
  }

  .msg {
    flex: 1;
  }

  .action {
    height: 28px;
    color: var(--accent);
  }

  .close {
    width: 28px;
    height: 28px;
    color: var(--text-muted);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>

<script lang="ts">
  import Icon from './Icon.svelte';
  import { formatDiagnostic } from '../../core/csv/diagnostics';
  import type { ImportReport } from '../state/project.svelte';

  let { report, onclose }: { report: ImportReport | null; onclose: () => void } = $props();

  const SHOWN = 50;
  let dialog: HTMLDialogElement;

  $effect(() => {
    if (report && !dialog.open) dialog.showModal();
    else if (!report && dialog.open) dialog.close();
  });
</script>

<dialog bind:this={dialog} {onclose} aria-labelledby="import-error-title">
  {#if report}
    <header>
      <span class="icon"><Icon name="alert" size={20} /></span>
      <div>
        <h2 id="import-error-title">Couldn't open {report.fileName}</h2>
        <p class="muted">
          Your current project hasn't changed. Fix these problems in the file and try again.
        </p>
      </div>
    </header>
    <ol>
      {#each report.errors.slice(0, SHOWN) as d, i (i)}
        <li>{formatDiagnostic(d)}</li>
      {/each}
    </ol>
    {#if report.errors.length > SHOWN}
      <p class="muted">…and {report.errors.length - SHOWN} more.</p>
    {/if}
    <footer>
      <button class="btn primary" onclick={() => dialog.close()}>Close</button>
    </footer>
  {/if}
</dialog>

<style>
  dialog {
    width: min(560px, calc(100vw - 32px));
    max-height: min(80vh, 640px);
    padding: var(--space-5);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-lg);
  }

  dialog::backdrop {
    background: rgb(10 12 16 / 0.45);
  }

  header {
    display: flex;
    gap: var(--space-3);
  }

  .icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--danger-soft);
    color: var(--danger);
  }

  h2 {
    margin: 0;
    font-size: var(--text-lg);
    overflow-wrap: anywhere;
  }

  header p {
    margin: var(--space-1) 0 0;
  }

  ol {
    max-height: 340px;
    margin: var(--space-4) 0 0;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-6);
    overflow: auto;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  li + li {
    margin-top: var(--space-1);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4);
  }
</style>

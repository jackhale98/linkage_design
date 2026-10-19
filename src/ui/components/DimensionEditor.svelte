<script lang="ts">
  import { evaluateExpression } from '../../core/expr';
  import { formatPlain } from '../lib/sketchLayout';
  import type { Size, View } from '../lib/view';
  import { CONSTRAINT_DEFS } from '../../core/sketch/constraints';
  import { store } from '../state/project.svelte';
  import { sketchUi } from '../state/sketch.svelte';

  let { id, view, size }: { id: string; view: View; size: Size } = $props();

  const c = $derived(store.project.sketch.constraints.find((x) => x.id === id));
  const pos = $derived(sketchUi.labelScreenPos(id, view, size));
  const kind = $derived(c ? CONSTRAINT_DEFS[c.type].value : null);
  const initial = $derived(
    c?.value === undefined || !kind
      ? ''
      : formatPlain(kind === 'angle' && c.refs.length === 2 ? Math.abs(c.value) : c.value),
  );

  let input = $state<HTMLInputElement>();
  let error = $state('');
  let done = false;

  $effect(() => {
    input?.focus();
    input?.select();
  });

  /** Apply the typed value. On blur, a bad value is dropped rather than left pending. */
  function commit(fromBlur = false) {
    if (done || !input) return;
    const text = input.value;
    if (text.trim() === initial) {
      close();
      return;
    }
    let value: number;
    try {
      value = evaluateExpression(text);
    } catch (e) {
      if (fromBlur) close();
      else error = (e as Error).message;
      return;
    }
    if (sketchUi.setDimension(id, value) || fromBlur) close();
    else error = 'Not applied';
  }

  function close() {
    done = true;
    sketchUi.editing = null;
  }

  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }
</script>

{#if c && pos}
  <div class="editor" style:left={`${pos[0]}px`} style:top={`${pos[1]}px`}>
    <input
      bind:this={input}
      class="input num"
      value={initial}
      aria-label={`${CONSTRAINT_DEFS[c.type].label} value`}
      onkeydown={onKey}
      onblur={() => commit(true)}
      oninput={() => (error = '')}
      spellcheck="false"
      autocomplete="off"
    />
    {#if kind === 'angle'}<span class="unit">{store.project.meta.angle_unit === 'deg' ? '°' : 'rad'}</span
      >{/if}
    {#if error}<div class="error" role="alert">{error}</div>{/if}
  </div>
{/if}

<style>
  .editor {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    transform: translate(-50%, -50%);
  }

  .input {
    width: 96px;
    min-height: 28px;
    padding: 2px 6px;
    border-color: var(--accent);
    box-shadow: var(--shadow-md);
    text-align: center;
    font-weight: 600;
  }

  .unit {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .error {
    position: absolute;
    top: 100%;
    left: 50%;
    margin-top: 4px;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    background: var(--danger);
    color: #fff;
    font-size: var(--text-xs);
    white-space: nowrap;
    transform: translateX(-50%);
  }
</style>

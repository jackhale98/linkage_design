<script lang="ts">
  // A numeric input that accepts expressions ("2*25+10") and commits on Enter or blur.
  import { evaluateExpression } from '../../core/expr';
  import { formatPlain } from '../lib/sketchLayout';

  let {
    value,
    label,
    unit = '',
    disabled = false,
    oncommit,
  }: {
    value: number | undefined;
    label: string;
    unit?: string;
    disabled?: boolean;
    oncommit: (v: number) => void;
  } = $props();

  const shown = $derived(value === undefined || !Number.isFinite(value) ? '' : formatPlain(value));
  let invalid = $state(false);

  function commit(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    if (el.value.trim() === shown) return;
    try {
      const v = evaluateExpression(el.value);
      invalid = false;
      oncommit(v);
    } catch {
      invalid = true;
      return;
    }
    el.value = shown; // reflect what the model accepted
  }
</script>

<label class="field">
  <span>{label}</span>
  <div class="wrap">
    <input
      class="input num"
      class:invalid
      value={shown}
      {disabled}
      aria-label={label}
      aria-invalid={invalid}
      spellcheck="false"
      autocomplete="off"
      onchange={commit}
      onkeydown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          (e.currentTarget as HTMLInputElement).value = shown;
          invalid = false;
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      oninput={() => (invalid = false)}
    />
    {#if unit}<span class="unit">{unit}</span>{/if}
  </div>
</label>

<style>
  .wrap {
    position: relative;
  }

  .input {
    padding-right: 34px;
  }

  .input.invalid {
    border-color: var(--danger);
  }

  .unit {
    position: absolute;
    top: 50%;
    right: 8px;
    color: var(--text-faint);
    font-size: var(--text-sm);
    transform: translateY(-50%);
    pointer-events: none;
  }
</style>

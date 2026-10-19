<script lang="ts">
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import { store } from '../state/project.svelte';
  import { ui, WORKSPACES } from '../state/ui.svelte';

  import { EXAMPLES } from '../../examples';

  let {
    onNew,
    onOpen,
    onSave,
    onExample,
  }: { onNew: () => void; onOpen: () => void; onSave: () => void; onExample: (file: string) => void } =
    $props();

  let menu: HTMLDetailsElement;

  const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const themeIcon = $derived(ui.theme === 'light' ? 'sun' : ui.theme === 'dark' ? 'moon' : 'system');
  const themeLabel = $derived(`Theme: ${ui.theme} (click to change)`);

  function rename(e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    store.update((p) => (p.meta.name = value), 'meta.name');
  }
</script>

<header class="topbar">
  <div class="brand">
    <Logo />
    <div class="titles">
      <span class="app">Linkage Design</span>
      <input
        class="name"
        aria-label="Project name"
        value={store.project.meta.name}
        oninput={rename}
        onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        spellcheck="false"
      />
    </div>
  </div>

  <div class="tabs" role="tablist" aria-label="Workspaces">
    {#each WORKSPACES as w (w.id)}
      <button
        role="tab"
        class="tab"
        aria-selected={ui.workspace === w.id}
        title={`${w.label} (${w.key})`}
        onclick={() => (ui.workspace = w.id)}
      >
        {w.label}
      </button>
    {/each}
  </div>

  <div class="actions">
    <button
      class="btn icon"
      title={`Undo (${mod}Z)`}
      aria-label="Undo"
      disabled={!store.canUndo}
      onclick={() => store.undo()}
    >
      <Icon name="undo" />
    </button>
    <button
      class="btn icon"
      title={`Redo (${mod}Shift+Z)`}
      aria-label="Redo"
      disabled={!store.canRedo}
      onclick={() => store.redo()}
    >
      <Icon name="redo" />
    </button>
    <span class="sep"></span>
    <button class="btn icon" title="New project" aria-label="New project" onclick={onNew}>
      <Icon name="new" />
    </button>
    <details class="menu" bind:this={menu}>
      <summary class="btn" title="Example mechanisms">
        <Icon name="examples" /><span class="label">Examples</span>
      </summary>
      <div class="menu-list" role="menu">
        {#each EXAMPLES as ex (ex.file)}
          <button
            role="menuitem"
            class="menu-item"
            onclick={() => {
              menu.open = false;
              onExample(ex.file);
            }}
          >
            <strong>{ex.name}</strong>
            <span class="muted">{ex.description}</span>
          </button>
        {/each}
      </div>
    </details>
    <button class="btn" title={`Open project CSV (${mod}O)`} onclick={onOpen}>
      <Icon name="open" /><span class="label">Open</span>
    </button>
    <button class="btn primary" title={`Save project as CSV (${mod}S)`} onclick={onSave}>
      <Icon name="save" /><span class="label">Save CSV</span>
    </button>
    <span class="sep"></span>
    <button class="btn icon" title={themeLabel} aria-label={themeLabel} onclick={() => ui.cycleTheme()}>
      <Icon name={themeIcon} />
    </button>
    <button
      class="btn icon inspector-toggle"
      class:active={ui.inspectorOpen}
      title="Properties"
      aria-label="Toggle properties panel"
      onclick={() => (ui.inspectorOpen = !ui.inspectorOpen)}
    >
      <Icon name="panel" />
    </button>
    <a
      class="btn icon source-link"
      href="https://github.com/jackhale98/linkage_design"
      target="_blank"
      rel="noopener"
      title="Source code on GitHub"
      aria-label="Source code on GitHub"
    >
      <Icon name="code" />
    </a>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    height: var(--topbar-h);
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    flex: 1 1 0;
  }

  .titles {
    display: grid;
    min-width: 0;
    line-height: 1.15;
  }

  .app {
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  .name {
    min-width: 0;
    max-width: 260px;
    margin-left: -4px;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    font-size: var(--text-lg);
    font-weight: 600;
    text-overflow: ellipsis;
  }

  .name:hover {
    border-color: var(--border);
  }

  .name:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--surface);
  }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }

  .tab {
    height: 30px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    cursor: pointer;
    transition:
      background var(--duration) var(--ease),
      color var(--duration) var(--ease);
  }

  .tab:hover {
    color: var(--text);
  }

  .tab[aria-selected='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow:
      var(--shadow-sm),
      0 0 0 1px var(--border);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    flex: 1 1 0;
  }

  .actions a {
    color: inherit;
    text-decoration: none;
  }

  .menu {
    position: relative;
  }

  .menu summary {
    list-style: none;
  }

  .menu summary::-webkit-details-marker {
    display: none;
  }

  .menu[open] summary {
    background: var(--surface-active);
  }

  .menu-list {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 40;
    display: grid;
    width: 300px;
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
  }

  .menu-item {
    display: grid;
    gap: 2px;
    padding: var(--space-2) var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--surface-hover);
  }

  .menu-item span {
    font-size: var(--text-sm);
  }

  .sep {
    width: 1px;
    height: 20px;
    margin: 0 var(--space-1);
    background: var(--border);
  }

  .inspector-toggle {
    display: none;
  }

  @media (max-width: 1100px) {
    .label {
      display: none;
    }
    .btn.primary {
      width: 32px;
      padding: 0;
    }
  }

  @media (max-width: 900px) {
    .inspector-toggle {
      display: inline-flex;
    }
    .app {
      display: none;
    }
  }

  @media (max-width: 520px) {
    .source-link {
      display: none;
    }
  }

  @media (max-width: 720px) {
    .topbar {
      flex-wrap: wrap;
      height: auto;
      padding: var(--space-2);
      row-gap: var(--space-2);
    }
    .tabs {
      order: 3;
      width: 100%;
      overflow-x: auto;
    }
    .tab {
      flex: 1 0 auto;
    }
  }
</style>

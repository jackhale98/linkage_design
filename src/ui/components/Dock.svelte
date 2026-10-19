<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { formatDiagnostic } from '../../core/csv/diagnostics';
  import SketchTables from './SketchTables.svelte';
  import { CONSTRAINT_DEFS } from '../../core/sketch/constraints';
  import { store } from '../state/project.svelte';
  import { sketchUi } from '../state/sketch.svelte';
  import { ui, type DockTab } from '../state/ui.svelte';

  const TABS: { id: DockTab; label: string; icon: IconName }[] = [
    { id: 'plots', label: 'Plots', icon: 'plot' },
    { id: 'tables', label: 'Tables', icon: 'table' },
    { id: 'results', label: 'Results', icon: 'results' },
    { id: 'messages', label: 'Messages', icon: 'messages' },
  ];

  const EMPTY: Record<'plots' | 'results', string> = {
    plots:
      'Plots of position, velocity, acceleration and forces against the driver input will appear here once a mechanism moves.',
    results: 'Summaries such as range of motion, Grashof type, peak forces and cam checks will appear here.',
  };

  const report = $derived(store.lastImport);

  /** Constraints the solver flags: conflicting (unsatisfied) or duplicating others (redundant). */
  const issues = $derived(
    store.project.sketch.constraints
      .filter((c) => sketchUi.analysis.unsatisfied.has(c.id) || sketchUi.analysis.redundant.has(c.id))
      .map((c) => ({
        id: c.id,
        text: sketchUi.analysis.unsatisfied.has(c.id)
          ? `${c.id} (${CONSTRAINT_DEFS[c.type].label.toLowerCase()} on ${c.refs.join(', ')}) conflicts with other constraints and isn't satisfied`
          : `${c.id} (${CONSTRAINT_DEFS[c.type].label.toLowerCase()} on ${c.refs.join(', ')}) duplicates other constraints; delete it or make it a reference`,
      })),
  );
  const messageCount = $derived((report ? report.errors.length + report.warnings.length : 0) + issues.length);

  const MIN_H = 120;
  let dragStart: { y: number; h: number } | null = null;

  function startResize(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart = { y: e.clientY, h: ui.dockHeight };
  }

  function resize(e: PointerEvent) {
    if (!dragStart) return;
    const max = window.innerHeight * 0.7;
    ui.dockHeight = Math.min(max, Math.max(MIN_H, dragStart.h + dragStart.y - e.clientY));
  }

  function endResize() {
    dragStart = null;
  }

  function onResizeKey(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') ui.dockHeight = Math.min(window.innerHeight * 0.7, ui.dockHeight + 20);
    else if (e.key === 'ArrowDown') ui.dockHeight = Math.max(MIN_H, ui.dockHeight - 20);
    else return;
    e.preventDefault();
  }

  function selectTab(id: DockTab) {
    if (ui.dockTab === id && ui.dockOpen) ui.dockOpen = false;
    else ui.openDock(id);
  }
</script>

<section class="dock" class:open={ui.dockOpen} style:height={ui.dockOpen ? `${ui.dockHeight}px` : undefined}>
  {#if ui.dockOpen}
    <!-- A focusable separator is the ARIA "window splitter" pattern; Svelte's a11y rules don't model it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      aria-valuenow={Math.round(ui.dockHeight)}
      aria-valuemin={MIN_H}
      tabindex="0"
      onpointerdown={startResize}
      onpointermove={resize}
      onpointerup={endResize}
      onpointercancel={endResize}
      onkeydown={onResizeKey}
    ></div>
  {/if}
  <div class="bar">
    <div class="tabs" role="tablist" aria-label="Panels">
      {#each TABS as t (t.id)}
        <button
          role="tab"
          class="tab"
          aria-selected={ui.dockOpen && ui.dockTab === t.id}
          onclick={() => selectTab(t.id)}
        >
          <Icon name={t.icon} size={16} />
          {t.label}
          {#if t.id === 'messages' && messageCount > 0}
            <span class="badge" class:error={report && !report.ok}>{messageCount}</span>
          {/if}
        </button>
      {/each}
    </div>
    <button
      class="btn icon"
      title={ui.dockOpen ? 'Collapse panel' : 'Expand panel'}
      aria-label={ui.dockOpen ? 'Collapse panel' : 'Expand panel'}
      onclick={() => (ui.dockOpen = !ui.dockOpen)}
    >
      <Icon name={ui.dockOpen ? 'chevronDown' : 'chevronUp'} />
    </button>
  </div>

  {#if ui.dockOpen}
    <div class="content" role="tabpanel">
      {#if ui.dockTab === 'tables'}
        <SketchTables />
      {:else if ui.dockTab === 'messages'}
        {#if issues.length}
          <p class="summary"><Icon name="alert" size={16} /> The sketch is over-defined.</p>
          <ul class="messages">
            {#each issues as m (m.id)}
              <li class="error">
                <Icon name="alert" size={15} />
                <button class="link" onclick={() => (sketchUi.selection = [m.id])}>{m.text}</button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if !report && !issues.length}
          <p class="empty">
            No messages. Warnings and errors from opening files and from the solver appear here.
          </p>
        {:else if report}
          <p class="summary">
            {#if report.ok}
              <Icon name="check" size={16} /> Opened <strong>{report.fileName}</strong>
              {report.warnings.length ? `with ${report.warnings.length} warning(s)` : 'with no problems'}.
            {:else}
              <Icon name="alert" size={16} /> Couldn't open <strong>{report.fileName}</strong>. Your project
              was not changed.
            {/if}
          </p>
          <ul class="messages">
            {#each report.errors as d, i (i)}
              <li class="error"><Icon name="alert" size={15} /><span>{formatDiagnostic(d)}</span></li>
            {/each}
            {#each report.warnings as d, i (i)}
              <li class="warning"><Icon name="info" size={15} /><span>{formatDiagnostic(d)}</span></li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="empty">{EMPTY[ui.dockTab as 'plots' | 'results']}</p>
      {/if}
    </div>
  {/if}
</section>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .resize {
    position: absolute;
    top: -4px;
    left: 0;
    right: 0;
    height: 8px;
    cursor: ns-resize;
    z-index: 2;
  }

  .resize:hover,
  .resize:focus-visible {
    background: linear-gradient(transparent 3px, var(--accent) 3px, var(--accent) 5px, transparent 5px);
    outline: none;
  }

  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 var(--space-2);
  }

  .open .bar {
    border-bottom: 1px solid var(--border);
  }

  .tabs {
    display: flex;
    gap: 2px;
    overflow-x: auto;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    cursor: pointer;
  }

  .tab:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .tab[aria-selected='true'] {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .badge {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 18px;
    text-align: center;
  }

  .badge.error {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .content {
    flex: 1;
    overflow: auto;
    padding: var(--space-3) var(--space-4);
  }

  .empty {
    max-width: 560px;
    margin: var(--space-2) 0;
    color: var(--text-muted);
  }

  .summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
  }

  .messages {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--text-sm);
  }

  .messages li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: 6px var(--space-2);
    border-radius: var(--radius-sm);
  }

  .messages li :global(svg) {
    flex: none;
    margin-top: 1px;
  }

  .messages li.error {
    color: var(--danger);
  }

  .messages li.warning :global(svg) {
    color: var(--warning);
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .link:hover {
    text-decoration: underline;
  }

  .messages li:nth-child(odd) {
    background: var(--surface-2);
  }
</style>

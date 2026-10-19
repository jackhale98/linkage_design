<script lang="ts">
  import TopBar from './ui/components/TopBar.svelte';
  import ToolRail from './ui/components/ToolRail.svelte';
  import Viewport from './ui/components/Viewport.svelte';
  import Inspector from './ui/components/Inspector.svelte';
  import Dock from './ui/components/Dock.svelte';
  import Toasts from './ui/components/Toasts.svelte';
  import ImportErrorDialog from './ui/components/ImportErrorDialog.svelte';
  import WorkspaceIntro from './ui/components/WorkspaceIntro.svelte';
  import SketchLayer from './ui/components/SketchLayer.svelte';
  import SketchStatus from './ui/components/SketchStatus.svelte';
  import DimensionEditor from './ui/components/DimensionEditor.svelte';
  import Icon from './ui/components/Icon.svelte';
  import fourBarExample from './examples/four-bar.csv?raw';
  import { newProject, projectFileName } from './core/model/project';
  import { applicableConstraints } from './core/sketch/edit';
  import type { ConstraintType } from './core/sketch/types';
  import type { CanvasPointer, PointerResult } from './ui/lib/canvasEvents';
  import { downloadText, pickFile, readText } from './ui/lib/files';
  import { store, type ImportReport } from './ui/state/project.svelte';
  import { toasts } from './ui/state/toasts.svelte';
  import { ui, WORKSPACES } from './ui/state/ui.svelte';
  import { RELATION_KEYS, sketchUi } from './ui/state/sketch.svelte';
  import { tick } from 'svelte';

  let viewport: Viewport;
  const editable = $derived(ui.workspace === 'sketch');
  const drawing = $derived(['point', 'line', 'dimension'].includes(sketchUi.tool));
  let failedImport = $state<ImportReport | null>(null);
  let dragDepth = $state(0);

  // ------------------------------------------------------------ startup

  if (store.restoreAutosave()) {
    toasts.show('Restored your last session.', 'info', { label: 'Start new', run: newFile });
  }

  // ------------------------------------------------------------ effects

  $effect(() => {
    const root = document.documentElement;
    if (ui.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = ui.theme;
  });

  $effect(() => {
    // Track every UI preference, then persist.
    void [ui.workspace, ui.theme, ui.dockTab, ui.dockOpen, ui.dockHeight];
    ui.persist();
  });

  $effect(() => {
    void JSON.stringify(store.project);
    const t = setTimeout(() => store.autosave(), 400);
    return () => clearTimeout(t);
  });

  // Mouse clicks shouldn't leave toolbar buttons focused, or a later Enter/Space
  // would press them again. Keyboard activation (detail === 0) keeps focus.
  function blurClickedButton(e: MouseEvent) {
    if (e.detail === 0) return;
    const b = (e.target as Element | null)?.closest('button');
    if (b && !b.closest('dialog')) b.blur();
  }

  // Drawing tools only exist in the Sketch workspace.
  $effect(() => {
    if (!editable && sketchUi.tool !== 'select' && sketchUi.tool !== 'pan') sketchUi.setTool('select');
  });

  $effect(() => {
    document.title = `${store.project.meta.name || 'Untitled'} · Linkage Design`;
  });

  // ------------------------------------------------------------ file actions

  async function fitSoon() {
    await tick();
    viewport?.fit();
  }

  function onCanvas(ev: CanvasPointer): PointerResult {
    if (editable) return sketchUi.pointer(ev);
    return ev.type === 'down' ? 'pan' : undefined;
  }

  function loadExample() {
    store.importText('four-bar.csv', fourBarExample);
    sketchUi.selection = [];
    void fitSoon();
    toasts.show('Loaded the four-bar example. Double-click a dimension to change it.', 'success', {
      label: 'Undo',
      run: () => store.undo(),
    });
  }

  function newFile() {
    store.replace(newProject());
    sketchUi.selection = [];
    sketchUi.editing = null;
    store.lastImport = null;
    toasts.show('Started a new project.', 'info', { label: 'Undo', run: () => store.undo() });
  }

  function save() {
    downloadText(projectFileName(store.project), store.exportText());
  }

  async function openFile(file: File) {
    let text: string;
    try {
      text = await readText(file);
    } catch (e) {
      toasts.show(`Couldn't read ${file.name}: ${(e as Error).message}`, 'error');
      return;
    }
    const report = store.importText(file.name, text);
    if (!report.ok) {
      failedImport = report;
      return;
    }
    sketchUi.selection = [];
    sketchUi.editing = null;
    void fitSoon();
    if (report.warnings.length) {
      toasts.show(`Opened ${file.name} with ${report.warnings.length} warning(s).`, 'warning', {
        label: 'View',
        run: () => ui.openDock('messages'),
      });
    } else {
      toasts.show(`Opened ${file.name}.`, 'success', { label: 'Undo', run: () => store.undo() });
    }
  }

  async function open() {
    const file = await pickFile();
    if (file) await openFile(file);
  }

  // ------------------------------------------------------------ drag & drop

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
  }

  function onDragOver(e: DragEvent) {
    if (hasFiles(e)) e.preventDefault();
  }

  function onDragLeave(e: DragEvent) {
    if (hasFiles(e)) dragDepth = Math.max(0, dragDepth - 1);
  }

  function onDrop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const file = e.dataTransfer?.files[0];
    if (file) void openFile(file);
  }

  // ------------------------------------------------------------ keyboard

  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = !!target.closest('input, textarea, select, [contenteditable]');
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod && key === 's') {
      e.preventDefault();
      save();
    } else if (mod && key === 'o') {
      e.preventDefault();
      void open();
    } else if (typing) {
      return; // let fields keep their own undo and keys
    } else if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (mod && key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (mod && key === 'a' && editable) {
      e.preventDefault();
      sketchUi.selectAll();
    } else if (e.key === 'Escape') {
      if (sketchUi.escape()) e.preventDefault();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && editable) {
      e.preventDefault();
      sketchUi.deleteSelection();
    } else if (!mod && !e.altKey) {
      shortcut(e);
    }
  }

  function shortcut(e: KeyboardEvent) {
    const key = e.key.toUpperCase();
    const ws = WORKSPACES.find((w) => w.key === e.key);
    if (ws) {
      ui.workspace = ws.id;
      return;
    }
    if (key === 'F') return viewport.fit();
    if (!editable) return;
    if (key === 'G') return sketchUi.toggleGridSnap();
    // With geometry selected, relation keys apply constraints; otherwise they pick tools.
    const geom = sketchUi.geometrySelection;
    if (geom.length && geom.length === sketchUi.selection.length) {
      const applicable = applicableConstraints(store.project.sketch, geom);
      const t = (Object.keys(RELATION_KEYS) as ConstraintType[]).find(
        (k) => RELATION_KEYS[k] === key && applicable.includes(k),
      );
      if (t) {
        sketchUi.addConstraint(t, geom);
        return;
      }
    }
    if (key === 'P') sketchUi.setTool('point');
    else if (key === 'L') sketchUi.setTool('line');
    else if (key === 'D') sketchUi.setTool('dimension');
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  onclick={blurClickedButton}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
/>

<div class="app" class:inspector-open={ui.inspectorOpen}>
  <div class="top"><TopBar onNew={newFile} onOpen={open} onSave={save} /></div>
  <div class="rail"><ToolRail {editable} /></div>
  <main class="canvas">
    <Viewport
      bind:this={viewport}
      unit={store.project.meta.length_unit}
      panMode={sketchUi.tool === 'pan'}
      cursor={editable && drawing ? 'crosshair' : 'default'}
      onpointer={onCanvas}
      extents={() => sketchUi.extents()}
    >
      {#snippet content({ view, size })}
        <SketchLayer
          {view}
          {size}
          sketch={store.project.sketch}
          analysis={sketchUi.analysis}
          angleUnit={store.project.meta.angle_unit}
          angleScale={sketchUi.ctx.angleScale}
          selection={editable ? sketchUi.selection : []}
          hover={editable ? sketchUi.hover : null}
          pending={sketchUi.pending}
          draft={editable && sketchUi.tool === 'line' ? sketchUi.draft : null}
          cursor={editable && sketchUi.tool === 'point' ? sketchUi.cursor : null}
          editing={sketchUi.editing}
        />
      {/snippet}
      {#snippet overlay({ view, size })}
        {#if sketchUi.editing && editable}
          {#key sketchUi.editing}
            <DimensionEditor id={sketchUi.editing} {view} {size} />
          {/key}
        {/if}
      {/snippet}
      {#snippet badge()}
        <SketchStatus />
      {/snippet}
      {#snippet hudRight()}
        {#if editable}
          <button
            class="btn icon"
            class:active={sketchUi.gridSnap}
            aria-pressed={sketchUi.gridSnap}
            title={`Snap to grid (G): ${sketchUi.gridSnap ? 'on' : 'off'}`}
            aria-label="Snap to grid"
            onclick={() => sketchUi.toggleGridSnap()}
          >
            <Icon name="magnet" />
          </button>
        {/if}
      {/snippet}
      <WorkspaceIntro
        workspace={ui.workspace}
        sketchEmpty={store.project.sketch.points.length === 0}
        hint={sketchUi.hint}
        onexample={loadExample}
      />
    </Viewport>
  </main>
  <div class="inspector"><Inspector /></div>
  <div class="dock"><Dock /></div>
</div>

{#if dragDepth > 0}
  <div class="drop" aria-hidden="true">
    <div class="drop-card">Drop a project CSV to open it</div>
  </div>
{/if}

<ImportErrorDialog report={failedImport} onclose={() => (failedImport = null)} />
<Toasts />

<style>
  .app {
    display: grid;
    grid-template-columns: var(--rail-w) minmax(0, 1fr) auto;
    grid-template-rows: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top top'
      'rail canvas inspector'
      'dock dock dock';
    height: 100%;
  }

  .top {
    grid-area: top;
  }

  .rail {
    grid-area: rail;
    display: flex;
  }

  .canvas {
    grid-area: canvas;
    min-height: 0;
  }

  .inspector {
    grid-area: inspector;
    min-height: 0;
  }

  .dock {
    grid-area: dock;
  }

  @media (max-width: 900px) {
    .app {
      grid-template-columns: var(--rail-w) minmax(0, 1fr);
      grid-template-areas:
        'top top'
        'rail canvas'
        'dock dock';
    }

    .inspector {
      position: fixed;
      top: var(--topbar-h);
      right: 0;
      bottom: 0;
      z-index: 20;
      visibility: hidden;
      transform: translateX(100%);
      transition:
        transform var(--duration) var(--ease),
        visibility 0s linear var(--duration);
    }

    .inspector-open .inspector {
      visibility: visible;
      box-shadow: var(--shadow-lg);
      transform: none;
      transition: transform var(--duration) var(--ease);
    }
  }

  .drop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 3px dashed var(--accent);
    pointer-events: none;
  }

  .drop-card {
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-lg);
    font-weight: 600;
  }
</style>

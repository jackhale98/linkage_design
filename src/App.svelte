<script lang="ts">
  import TopBar from './ui/components/TopBar.svelte';
  import ToolRail from './ui/components/ToolRail.svelte';
  import Viewport from './ui/components/Viewport.svelte';
  import Inspector from './ui/components/Inspector.svelte';
  import Dock from './ui/components/Dock.svelte';
  import Toasts from './ui/components/Toasts.svelte';
  import ImportErrorDialog from './ui/components/ImportErrorDialog.svelte';
  import WorkspaceIntro from './ui/components/WorkspaceIntro.svelte';
  import { newProject, projectFileName } from './core/model/project';
  import { downloadText, pickFile, readText } from './ui/lib/files';
  import { store, type ImportReport } from './ui/state/project.svelte';
  import { toasts } from './ui/state/toasts.svelte';
  import { ui, WORKSPACES } from './ui/state/ui.svelte';

  let tool = $state<'select' | 'pan'>('select');
  let viewport: Viewport;
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

  $effect(() => {
    document.title = `${store.project.meta.name || 'Untitled'} · Linkage Design`;
  });

  // ------------------------------------------------------------ file actions

  function newFile() {
    store.replace(newProject());
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
    } else if (!mod && !e.altKey) {
      const ws = WORKSPACES.find((w) => w.key === e.key);
      if (ws) ui.workspace = ws.id;
      else if (key === 'f') viewport.fit();
      else if (key === 'v') tool = 'select';
      else if (key === 'h') tool = 'pan';
    }
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  ondragenter={onDragEnter}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
/>

<div class="app" class:inspector-open={ui.inspectorOpen}>
  <div class="top"><TopBar onNew={newFile} onOpen={open} onSave={save} /></div>
  <div class="rail"><ToolRail bind:tool /></div>
  <main class="canvas">
    <Viewport bind:this={viewport} {tool} unit={store.project.meta.length_unit}>
      <WorkspaceIntro workspace={ui.workspace} />
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

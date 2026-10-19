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
  import MechanismLayer from './ui/components/MechanismLayer.svelte';
  import MechanismStatus from './ui/components/MechanismStatus.svelte';
  import MotionBar from './ui/components/MotionBar.svelte';
  import ForceLayer from './ui/components/ForceLayer.svelte';
  import FreedomMarks from './ui/components/FreedomMarks.svelte';
  import CamLayer from './ui/components/CamLayer.svelte';
  import CamBar from './ui/components/CamBar.svelte';
  import { camUi } from './ui/state/cam.svelte';
  import { forceOverlay } from './ui/lib/forceOverlay';
  import { EXAMPLES } from './examples';
  import { motionUi } from './ui/state/motion.svelte';
  import { evaluate } from './core/mechanism/analysis';
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
  /** Workspaces that show the mechanism (links and joints) rather than the sketch. */
  const mechView = $derived(
    ui.workspace === 'mechanism' || ui.workspace === 'motion' || ui.workspace === 'forces',
  );
  const animated = $derived(ui.workspace === 'motion' || ui.workspace === 'forces');
  const camView = $derived(ui.workspace === 'cam');
  // The sweep position where there is one to follow; otherwise a hand-dragged test pose, or the drawn pose.
  const pose = $derived.by(() => {
    if (!mechView) return null;
    if (animated && motionUi.frames.length > 1) return motionUi.poseAt(motionUi.displayFrame);
    const q = motionUi.testQ;
    return q ? motionUi.poseAtQ(q) : motionUi.poseAt(null);
  });
  const sketchFreedom = $derived(
    store.project.sketch.points.flatMap((p) => {
      const f = sketchUi.analysis.freedom.get(p.id);
      return f ? [{ id: p.id, at: [p.x, p.y] as [number, number], ...f }] : [];
    }),
  );
  const traces = $derived(ui.workspace === 'motion' && motionUi.showTraces ? motionUi.tracePaths() : []);
  const forceView = $derived(
    ui.workspace === 'forces'
      ? forceOverlay(
          motionUi.result,
          store.project.mechanism.bodies,
          store.project.forces,
          motionUi.forces,
          motionUi.displayFrame,
          motionUi.frameIndex,
          { length: store.project.meta.length_unit, force: store.project.meta.force_unit },
          { loads: motionUi.showLoads, reactions: motionUi.showReactions },
        )
      : null,
  );
  const vectors = $derived.by(() => {
    // Read the motion result only where it's shown, so sketching doesn't re-run the sweep.
    if (!animated || !motionUi.showVelocity) return [];
    const data = motionUi.result.data;
    const f = motionUi.displayFrame;
    if (!data || !f) return [];
    const pts = store.project.mechanism.motion.trace;
    const vs = pts.map((p) => [p, evaluate(data, f, `p:${p}:vx`), evaluate(data, f, `p:${p}:vy`)] as const);
    // Scale so the fastest point in the whole sweep draws about 80 px long.
    const vmax = Math.max(
      1e-12,
      ...pts.flatMap((p) => motionUi.frames.map((fr) => evaluate(data, fr, `p:${p}:v`))),
    );
    return vs
      .filter(([, vx, vy]) => Number.isFinite(vx) && Number.isFinite(vy))
      .map(([p, vx, vy]) => ({
        point: p,
        v: [(vx / vmax) * 80, (vy / vmax) * 80] as [number, number],
        color: 'var(--text)',
      }));
  });
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

  // Refit when the view switches between the sketch and the mechanism (traces can be larger).
  let lastView: string | null = null;
  $effect(() => {
    const kind = camView ? 'cam' : mechView ? 'mech' : 'sketch';
    if (lastView !== null && lastView !== kind) void fitSoon();
    lastView = kind;
  });

  // Stop playback when leaving the animated workspaces.
  $effect(() => {
    if (!animated) motionUi.pause();
    if (!camView) camUi.pause();
  });

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
    if (camView) return ev.type === 'down' ? 'pan' : undefined;
    if (mechView && pose && sketchUi.tool !== 'pan') return motionUi.pointer(ev, pose);
    return ev.type === 'down' ? 'pan' : undefined;
  }

  function extents() {
    if (camView) return camUi.extents() ?? { minX: -60, minY: -60, maxX: 60, maxY: 60 };
    return mechView ? (motionUi.extents() ?? sketchUi.extents()) : sketchUi.extents();
  }

  function loadExample(file = 'four-bar.csv') {
    const ex = EXAMPLES.find((e) => e.file === file)!;
    store.importText(ex.file, ex.text);
    if (ex.workspace) ui.workspace = ex.workspace;
    camUi.angle = 0;
    sketchUi.selection = [];
    motionUi.selection = [];
    motionUi.plotKeys = [];
    motionUi.plotSlots = {};
    motionUi.phase = 0;
    void fitSoon();
    const hint =
      ui.workspace === 'sketch' ? 'Double-click a dimension to change it, or open Motion to animate.' : '';
    toasts.show(`Loaded “${ex.name}”. ${hint}`, 'success', { label: 'Undo', run: () => store.undo() });
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
    } else if (e.key === ' ' && (animated || camView)) {
      e.preventDefault();
      if (camView) camUi.toggle();
      else motionUi.toggle();
    } else if (e.key === 'Escape') {
      if (!editable) motionUi.selection = [];
      else if (sketchUi.escape()) e.preventDefault();
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
  <div class="top"><TopBar onNew={newFile} onOpen={open} onSave={save} onExample={loadExample} /></div>
  <div class="rail"><ToolRail {editable} /></div>
  <main class="canvas">
    <Viewport
      bind:this={viewport}
      unit={store.project.meta.length_unit}
      panMode={sketchUi.tool === 'pan'}
      cursor={editable && drawing ? 'crosshair' : 'default'}
      onpointer={onCanvas}
      {extents}
      spacePan={!animated}
    >
      {#snippet content({ view, size })}
        {#if camView}
          {#if camUi.cam}
            <CamLayer {view} {size} cam={camUi.cam} analysis={camUi.analysis} index={camUi.sampleIndex} />
          {/if}
        {:else if mechView && pose && motionUi.result.model.bodies.length}
          <MechanismLayer
            {view}
            {size}
            model={motionUi.result.model}
            {pose}
            labels={motionUi.result.model.pointNames}
            selection={motionUi.selection}
            hover={motionUi.hover}
            {traces}
            {vectors}
            loose={motionUi.result.freedom?.bodies}
          />
          {#if motionUi.result.freedom}
            <FreedomMarks {view} {size} points={motionUi.result.freedom.points} tone="over" />
          {/if}
          {#if forceView}<ForceLayer {view} {size} overlay={forceView} values={!motionUi.playing} />{/if}
        {:else}
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
          {#if editable && sketchUi.showFreedom}
            <FreedomMarks {view} {size} points={sketchFreedom} />
          {/if}
        {/if}
      {/snippet}
      {#snippet overlay({ view, size })}
        {#if sketchUi.editing && editable}
          {#key sketchUi.editing}
            <DimensionEditor id={sketchUi.editing} {view} {size} />
          {/key}
        {/if}
      {/snippet}
      {#snippet badge()}
        {#if mechView}<MechanismStatus />{:else if !camView}<SketchStatus />{/if}
      {/snippet}
      {#snippet bottom()}
        {#if animated}<MotionBar />{:else if camView}<CamBar />{/if}
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
        mechanismReady={mechView && !!motionUi.result.data}
        hasLinks={mechView && motionUi.result.model.bodies.length > 0}
        onexample={() => loadExample()}
        camEmpty={store.project.cams.length === 0}
        oncamstart={() => {
          camUi.addCam();
          void fitSoon();
        }}
        oncamexample={() => loadExample('cam.csv')}
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

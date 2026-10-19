<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { CanvasPointer, PointerResult } from '../lib/canvasEvents';
  import {
    fitBox,
    formatCoord,
    gridPath,
    gridSpacing,
    panBy,
    screenToWorld,
    worldToScreen,
    zoomAt,
    type Size,
    type View,
  } from '../lib/view';

  export interface ViewCtx {
    view: View;
    size: Size;
  }

  type Box = { minX: number; minY: number; maxX: number; maxY: number };

  let {
    unit = 'mm',
    panMode = false,
    cursor = 'default',
    onpointer,
    extents,
    content,
    overlay,
    hudRight,
    badge,
    bottom,
    spacePan = true,
    children,
  }: {
    unit?: string;
    /** Left-drag always pans (pan tool). */
    panMode?: boolean;
    cursor?: string;
    onpointer?: (ev: CanvasPointer) => PointerResult;
    /** World box to fit; the default home view is used when undefined. */
    extents?: () => Box | undefined;
    content?: Snippet<[ViewCtx]>;
    overlay?: Snippet<[ViewCtx]>;
    hudRight?: Snippet;
    badge?: Snippet;
    /** Bottom-centre overlay (e.g. playback controls). */
    bottom?: Snippet;
    /** Hold Space to pan (off where Space has another job). */
    spacePan?: boolean;
    children?: Snippet;
  } = $props();

  const HOME: Box = { minX: -40, minY: -40, maxX: 240, maxY: 160 };

  let host: HTMLDivElement;
  let size = $state({ width: 0, height: 0 });
  let view = $state<View>({ cx: 100, cy: 60, scale: 3 });
  let fitted = false;
  let pointer = $state<[number, number] | null>(null);
  let panning = $state(false);
  let spaceDown = $state(false);

  const grid = $derived(gridSpacing(view.scale));
  const minorPath = $derived(size.width ? gridPath(view, size, grid.minor, grid.major) : '');
  const majorPath = $derived(size.width ? gridPath(view, size, grid.major) : '');
  const origin = $derived(worldToScreen(view, size, 0, 0));
  const scaleBarPx = $derived(grid.major * view.scale);
  const ctx = $derived<ViewCtx>({ view, size });

  export function fit(): void {
    if (size.width && size.height) view = fitBox(size, extents?.() ?? HOME);
  }

  function zoomBy(factor: number) {
    view = zoomAt(view, size, size.width / 2, size.height / 2, factor);
  }

  $effect(() => {
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      size = { width: entry.contentRect.width, height: entry.contentRect.height };
      if (!fitted && size.width > 0 && size.height > 0) {
        fitted = true;
        fit();
      }
    });
    ro.observe(host);

    // Wheel must be non-passive to stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      if (fromOverlay(e)) return;
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // Mouse wheels and trackpad pinch (ctrlKey) zoom; two-finger trackpad scrolls pan.
      const isMouseWheel =
        e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
      if (e.ctrlKey || isMouseWheel) {
        const lines = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
        view = zoomAt(view, size, sx, sy, Math.exp((-e.deltaY * lines) / (e.ctrlKey ? 100 : 500)));
      } else {
        view = panBy(view, -e.deltaX, -e.deltaY);
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spacePan) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, button, [contenteditable]') || t.isContentEditable))
        return;
      if (e.type === 'keydown') e.preventDefault();
      spaceDown = e.type === 'keydown';
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      ro.disconnect();
      host.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  });

  // Pointer handling. A press either pans the view (one pointer pans, two
  // pinch-zoom) or is handed to `onpointer` until release.
  // Plain Map on purpose: pointer tracking is event bookkeeping, not rendered state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const pointers = new Map<number, [number, number]>();
  let pinch: { dist: number; mid: [number, number] } | null = null;
  let mode: 'none' | 'pan' | 'handler' = 'none';
  let tap: { x: number; y: number } | null = null;

  function local(e: MouseEvent): [number, number] {
    const rect = host.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** Events from overlaid controls (zoom buttons, cards, editors) must not reach the canvas. */
  function fromOverlay(e: Event): boolean {
    return !!(e.target as Element | null)?.closest('.hud, .overlay-top, .overlay, .overlay-bottom, .badge');
  }

  function canvasEvent(type: CanvasPointer['type'], e: MouseEvent): CanvasPointer {
    const [sx, sy] = local(e);
    const [wx, wy] = screenToWorld(view, size, sx, sy);
    return {
      type,
      sx,
      sy,
      wx,
      wy,
      view,
      size,
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      mod: e.ctrlKey || e.metaKey,
    };
  }

  function startPan(e: PointerEvent, allowTap: boolean) {
    mode = 'pan';
    panning = true;
    tap = allowTap ? { x: e.clientX, y: e.clientY } : null;
  }

  function onPointerDown(e: PointerEvent) {
    if (fromOverlay(e)) return;
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    e.preventDefault();
    if (pointers.size === 2) {
      // Second finger: switch to pinch, ending whatever the first finger started.
      if (mode === 'handler') onpointer?.(canvasEvent('up', e));
      const [a, b] = [...pointers.values()] as [[number, number], [number, number]];
      pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      startPan(e, false);
      return;
    }
    if (e.button === 1 || spaceDown || panMode) {
      startPan(e, false);
      return;
    }
    const r = onpointer ? onpointer(canvasEvent('down', e)) : e.button === 0 ? 'pan' : undefined;
    if (r === 'handled') mode = 'handler';
    else if (r === 'pan') startPan(e, e.button === 0);
    else mode = 'none';
  }

  function onPointerMove(e: PointerEvent) {
    const p = local(e);
    if (e.pointerType !== 'touch') pointer = screenToWorld(view, size, p[0], p[1]);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType !== 'touch' && !fromOverlay(e)) onpointer?.(canvasEvent('move', e));
      return;
    }
    pointers.set(e.pointerId, p);
    if (mode === 'handler') {
      onpointer?.(canvasEvent('move', e));
    } else if (mode === 'pan') {
      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()] as [[number, number], [number, number]];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let v = panBy(view, mid[0] - pinch.mid[0], mid[1] - pinch.mid[1]);
        if (pinch.dist > 0) v = zoomAt(v, size, mid[0], mid[1], dist / pinch.dist);
        view = v;
        pinch = { dist, mid };
      } else if (pointers.size === 1) {
        view = panBy(view, p[0] - prev[0], p[1] - prev[1]);
      }
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 3) tap = null;
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size > 0) return;
    if (mode === 'handler') onpointer?.(canvasEvent('up', e));
    else if (mode === 'pan' && tap && e.type === 'pointerup') onpointer?.(canvasEvent('tap', e));
    mode = 'none';
    tap = null;
    panning = false;
  }

  function onDblClick(e: MouseEvent) {
    if (fromOverlay(e)) return;
    if (onpointer?.(canvasEvent('dblclick', e)) !== 'handled' && !onpointer) fit();
  }

  function onLeave(e: PointerEvent) {
    pointer = null;
    if (mode === 'none') onpointer?.(canvasEvent('leave', e));
  }
</script>

<div
  class="viewport"
  class:panning
  class:can-pan={panMode || spaceDown}
  style:cursor={panning || panMode || spaceDown ? undefined : cursor}
  bind:this={host}
  role="application"
  aria-label="Drawing canvas. Drag to pan, scroll to zoom."
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={onLeave}
  ondblclick={onDblClick}
  oncontextmenu={(e) => !fromOverlay(e) && e.preventDefault()}
>
  <svg width={size.width} height={size.height} class="canvas">
    <path d={minorPath} class="grid-minor" />
    <path d={majorPath} class="grid-major" />
    <path d={`M${origin[0]} 0V${size.height}M0 ${origin[1]}H${size.width}`} class="axis" />
    <g transform={`translate(${origin[0]} ${origin[1]})`} class="origin">
      <path d="M0 0h28M0 0v-28" />
      <path d="M24 -3l5 3-5 3M-3 -24l3 -5 3 5" class="tips" />
      <text x="32" y="4">x</text>
      <text x="-3" y="-33">y</text>
    </g>
    {#if size.width}{@render content?.(ctx)}{/if}
  </svg>

  {#if overlay && size.width}
    <div class="overlay">{@render overlay(ctx)}</div>
  {/if}

  {#if children}
    <div class="overlay-top">{@render children()}</div>
  {/if}

  {#if badge}
    <div class="badge">{@render badge()}</div>
  {/if}

  {#if bottom}
    <div class="overlay-bottom">{@render bottom()}</div>
  {/if}

  <div class="hud left">
    <div class="scalebar" style:width={`${scaleBarPx}px`}><span>{grid.major} {unit}</span></div>
    <div class="coords num" aria-live="off">
      {#if pointer}
        <span>X {formatCoord(pointer[0], view.scale)}</span>
        <span>Y {formatCoord(pointer[1], view.scale)}</span>
      {:else}
        <span class="muted">Scroll to zoom · drag to pan</span>
      {/if}
    </div>
  </div>

  <div class="hud right">
    {@render hudRight?.()}
    <button class="btn icon" title="Zoom out" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.25)}>
      <Icon name="zoomOut" />
    </button>
    <button class="btn icon" title="Zoom in" aria-label="Zoom in" onclick={() => zoomBy(1.25)}>
      <Icon name="zoomIn" />
    </button>
    <button class="btn icon" title="Fit view (F)" aria-label="Fit view" onclick={fit}>
      <Icon name="fit" />
    </button>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    height: 100%;
    overflow: hidden;
    background: var(--canvas-bg);
    touch-action: none;
    user-select: none;
    cursor: default;
  }

  .viewport.can-pan {
    cursor: grab;
  }

  .viewport.panning {
    cursor: grabbing;
  }

  .canvas {
    position: absolute;
    inset: 0;
    display: block;
  }

  .grid-minor {
    stroke: var(--grid-minor);
    stroke-width: 1;
  }

  .grid-major {
    stroke: var(--grid-major);
    stroke-width: 1;
  }

  .axis {
    stroke: var(--axis);
    stroke-width: 1;
  }

  .origin path {
    stroke: var(--text-muted);
    stroke-width: 1.5;
    fill: none;
  }

  .origin .tips {
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .origin text {
    fill: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .overlay-top {
    position: absolute;
    top: var(--space-4);
    left: 50%;
    width: min(520px, calc(100% - 2 * var(--space-4)));
    transform: translateX(-50%);
    pointer-events: none;
  }

  .overlay-top :global(*) {
    pointer-events: auto;
  }

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .overlay :global(*) {
    pointer-events: auto;
  }

  .overlay-bottom {
    position: absolute;
    bottom: 60px;
    left: 50%;
    display: flex;
    justify-content: center;
    width: min(560px, calc(100% - 2 * var(--space-4)));
    transform: translateX(-50%);
  }

  .badge {
    position: absolute;
    top: var(--space-3);
    right: var(--space-3);
  }

  .hud {
    position: absolute;
    bottom: var(--space-3);
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-sm);
  }

  .hud.left {
    left: var(--space-3);
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    min-height: 34px;
  }

  .hud.right {
    right: var(--space-3);
  }

  .coords {
    display: flex;
    gap: var(--space-3);
    min-width: 150px;
    font-size: var(--text-sm);
  }

  .scalebar {
    position: relative;
    height: 6px;
    border: 1.5px solid var(--text-muted);
    border-top: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .scalebar span {
    position: absolute;
    bottom: 5px;
    left: 50%;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .hud.left {
    padding-top: 14px;
  }

  @media (max-width: 600px) {
    .coords {
      display: none;
    }
  }
</style>

<script lang="ts">
  import type { SketchAnalysis } from '../../core/sketch/solver';
  import type { Sketch } from '../../core/sketch/types';
  import { layoutSketch } from '../lib/sketchLayout';
  import { worldToScreen, type Size, type View } from '../lib/view';
  import type { LineDraft, Snap } from '../state/sketch.svelte';

  let {
    view,
    size,
    sketch,
    analysis,
    angleUnit,
    angleScale,
    selection = [],
    hover = null,
    pending = [],
    draft = null,
    cursor = null,
    editing = null,
  }: {
    view: View;
    size: Size;
    sketch: Sketch;
    analysis: SketchAnalysis;
    angleUnit: string;
    angleScale: number;
    selection?: string[];
    hover?: string | null;
    pending?: string[];
    draft?: LineDraft | null;
    cursor?: Snap | null;
    editing?: string | null;
  } = $props();

  const layout = $derived(layoutSketch({ sketch, analysis, view, size, angleUnit, angleScale }));
  const selected = $derived(new Set([...selection, ...pending]));
  const S = (p: [number, number]) => worldToScreen(view, size, p[0], p[1]);

  const draftLine = $derived.by(() => {
    if (!draft?.start) return null;
    const a = S(draft.start.pos);
    const b = S(draft.end.pos);
    return { a, b };
  });
  const snapMark = $derived.by(() => {
    const s = draft ? draft.end : cursor;
    if (!s || s.kind === 'free') return null;
    const [x, y] = S(s.pos);
    return { x, y, kind: s.kind };
  });
</script>

<g class="sketch">
  {#each layout.lines as l (l.id)}
    {#if selected.has(l.id) || hover === l.id}
      <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} class="halo" class:selected={selected.has(l.id)} />
    {/if}
    <line
      x1={l.x1}
      y1={l.y1}
      x2={l.x2}
      y2={l.y2}
      class="line {l.status}"
      class:construction={l.construction}
      data-id={l.id}
    />
  {/each}

  {#each layout.dims as d (d.id)}
    <g
      class="dim"
      class:bad={d.bad}
      class:reference={d.reference}
      class:selected={selected.has(d.id)}
      class:hover={hover === d.id}
      data-id={d.id}
    >
      <path d={d.lines} class="dim-lines" />
      <path d={d.arrows} class="dim-arrows" />
      {#if editing !== d.id}
        <text x={d.lx} y={d.ly} class="dim-text">{d.text}</text>
      {/if}
    </g>
  {/each}

  {#each layout.glyphs as g (g.key)}
    <g
      class="glyph"
      class:bad={g.bad}
      class:selected={selected.has(g.id)}
      class:hover={hover === g.id}
      transform={`translate(${g.x} ${g.y})`}
      data-id={g.id}
    >
      <rect x="-8" y="-8" width="16" height="16" rx="4" />
      <text y="0.5">{g.symbol}</text>
    </g>
  {/each}

  {#each layout.points as p (p.id)}
    {#if p.fixed}
      <g class="ground {p.status}" transform={`translate(${p.x} ${p.y})`}>
        <path d="M0 0L-7 10H7Z" />
        <path d="M-9 10H9M-7 10l-3 4M-2 10l-3 4M3 10l-3 4M8 10l-3 4" class="hatch" />
      </g>
    {/if}
    <circle
      cx={p.x}
      cy={p.y}
      r={selected.has(p.id) || hover === p.id ? 5 : 3.5}
      class="point {p.status}"
      class:selected={selected.has(p.id)}
      class:hover={hover === p.id}
      data-id={p.id}
    />
  {/each}

  {#if draftLine}
    <line x1={draftLine.a[0]} y1={draftLine.a[1]} x2={draftLine.b[0]} y2={draftLine.b[1]} class="draft" />
    {#if draft?.infer}
      <g
        class="glyph infer"
        transform={`translate(${(draftLine.a[0] + draftLine.b[0]) / 2} ${(draftLine.a[1] + draftLine.b[1]) / 2 - 16})`}
      >
        <rect x="-8" y="-8" width="16" height="16" rx="4" />
        <text y="0.5">{draft.infer === 'horizontal' ? 'H' : 'V'}</text>
      </g>
    {/if}
    <circle cx={draftLine.b[0]} cy={draftLine.b[1]} r="3.5" class="draft-point" />
  {/if}

  {#if snapMark}
    {#if snapMark.kind === 'point'}
      <circle cx={snapMark.x} cy={snapMark.y} r="8" class="snap" />
    {:else}
      <path
        d={`M${snapMark.x - 5} ${snapMark.y - 5}L${snapMark.x + 5} ${snapMark.y + 5}M${snapMark.x + 5} ${snapMark.y - 5}L${snapMark.x - 5} ${snapMark.y + 5}`}
        class="snap"
      />
    {/if}
  {:else if cursor && !draft}
    {@const c = S(cursor.pos)}
    <circle cx={c[0]} cy={c[1]} r="3.5" class="draft-point" />
  {/if}
</g>

<style>
  .line {
    stroke-width: 2;
    stroke-linecap: round;
  }

  .under {
    stroke: var(--geom-under);
  }

  .full {
    stroke: var(--geom-full);
  }

  .over {
    stroke: var(--geom-over);
  }

  .line.construction {
    stroke-width: 1.25;
    stroke-dasharray: 6 4;
    opacity: 0.8;
  }

  .halo {
    stroke: var(--accent);
    stroke-width: 7;
    stroke-linecap: round;
    opacity: 0.18;
  }

  .halo.selected {
    opacity: 0.35;
  }

  .point {
    fill: var(--canvas-bg);
    stroke-width: 1.75;
  }

  .point.selected {
    fill: var(--accent);
    stroke: var(--accent);
  }

  .point.hover:not(.selected) {
    stroke: var(--accent);
  }

  .ground path {
    fill: none;
    stroke-width: 1.25;
  }

  .ground .hatch {
    stroke-width: 1;
  }

  .dim-lines {
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 1;
  }

  .dim-arrows {
    fill: var(--text-muted);
  }

  .dim-text {
    fill: var(--text);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--canvas-bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    cursor: pointer;
  }

  .dim.reference .dim-text {
    fill: var(--text-muted);
    font-weight: 500;
  }

  .dim.bad .dim-lines {
    stroke: var(--geom-over);
  }

  .dim.bad .dim-arrows,
  .dim.bad .dim-text {
    fill: var(--geom-over);
  }

  .dim.selected .dim-lines,
  .dim.hover .dim-lines {
    stroke: var(--accent);
  }

  .dim.selected .dim-arrows,
  .dim.selected .dim-text,
  .dim.hover .dim-text {
    fill: var(--accent);
  }

  .glyph rect {
    fill: var(--surface);
    stroke: var(--border-strong);
    stroke-width: 1;
  }

  .glyph text {
    fill: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .glyph.bad rect {
    stroke: var(--geom-over);
  }

  .glyph.bad text {
    fill: var(--geom-over);
  }

  .glyph.selected rect,
  .glyph.hover rect {
    stroke: var(--accent);
  }

  .glyph.selected rect {
    fill: var(--accent-soft);
  }

  .glyph.selected text {
    fill: var(--accent);
  }

  .glyph.infer rect {
    fill: var(--accent-soft);
    stroke: var(--accent);
  }

  .glyph.infer text {
    fill: var(--accent);
  }

  .draft {
    stroke: var(--accent);
    stroke-width: 1.75;
    stroke-dasharray: 5 4;
  }

  .draft-point {
    fill: var(--accent);
  }

  .snap {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
  }
</style>

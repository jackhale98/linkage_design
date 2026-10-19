// Screen-space layout of a sketch: what to draw and where, plus hit testing
// against exactly what was drawn. Pure functions (no DOM) so it's testable.

import { CONSTRAINT_DEFS, isDimension, wrapAngle } from '../../core/sketch/constraints';
import type { SketchAnalysis } from '../../core/sketch/solver';
import type { Sketch, SketchConstraint } from '../../core/sketch/types';
import { worldToScreen, screenToWorld, type Size, type View } from './view';

export type Status = 'under' | 'full' | 'over';

export interface LPoint {
  id: string;
  x: number;
  y: number;
  status: Status;
  fixed: boolean;
}

export interface LLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  status: Status;
  construction: boolean;
}

export interface LGlyph {
  key: string;
  id: string;
  x: number;
  y: number;
  symbol: string;
  bad: boolean;
}

export interface LDim {
  id: string;
  /** Extension and dimension lines (stroked). */
  lines: string;
  /** Arrowheads (filled). */
  arrows: string;
  lx: number;
  ly: number;
  text: string;
  bad: boolean;
  reference: boolean;
}

export interface Layout {
  points: LPoint[];
  lines: LLine[];
  glyphs: LGlyph[];
  dims: LDim[];
}

export type Hit = { kind: 'point' | 'line' | 'constraint'; id: string };

type Vec = [number, number];

const DEFAULT_DIM_OFFSET_PX = 28;
const ARROW_LEN = 8;
const ARROW_HALF = 3;

export function formatValue(value: number, kind: 'length' | 'angle', angleUnit: string): string {
  if (kind === 'angle') {
    if (angleUnit === 'deg') return `${trim(value, 2)}°`;
    return `${trim(value, 4)} rad`;
  }
  return trim(value, 3);
}

/** Plain number for editing: up to 6 decimals, trailing zeros removed. */
export function formatPlain(value: number): string {
  return trim(value, 6);
}

function trim(v: number, decimals: number): string {
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

function arrow(tip: Vec, dir: Vec): string {
  // Triangle pointing along dir with its tip at `tip`.
  const [dx, dy] = dir;
  const bx = tip[0] - dx * ARROW_LEN;
  const by = tip[1] - dy * ARROW_LEN;
  const nx = -dy * ARROW_HALF;
  const ny = dx * ARROW_HALF;
  return `M${tip[0]} ${tip[1]}L${bx + nx} ${by + ny}L${bx - nx} ${by - ny}Z`;
}

function unit(v: Vec): Vec {
  const n = Math.hypot(v[0], v[1]);
  return n > 1e-12 ? [v[0] / n, v[1] / n] : [1, 0];
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

export interface LayoutInput {
  sketch: Sketch;
  analysis: SketchAnalysis;
  view: View;
  size: Size;
  angleUnit: string;
  angleScale: number;
}

export function layoutSketch(input: LayoutInput): Layout {
  const { sketch, analysis, view, size } = input;
  const S = (x: number, y: number): Vec => worldToScreen(view, size, x, y);
  const lineById = new Map(sketch.lines.map((l) => [l.id, l]));

  const bad = new Set([...analysis.redundant, ...analysis.unsatisfied]);
  const overEntities = new Set<string>();
  for (const c of sketch.constraints) if (bad.has(c.id)) c.refs.forEach((r) => overEntities.add(r));

  const pointStatus = (id: string): Status =>
    overEntities.has(id) ? 'over' : analysis.freePoints.has(id) ? 'under' : 'full';

  const points: LPoint[] = sketch.points.map((p) => {
    const [x, y] = S(p.x, p.y);
    return { id: p.id, x, y, status: pointStatus(p.id), fixed: p.fixed };
  });
  const screenPt = new Map(points.map((p) => [p.id, [p.x, p.y] as Vec]));

  const lines: LLine[] = [];
  for (const l of sketch.lines) {
    const a = screenPt.get(l.p1);
    const b = screenPt.get(l.p2);
    if (!a || !b) continue;
    const status: Status = overEntities.has(l.id)
      ? 'over'
      : pointStatus(l.p1) === 'under' || pointStatus(l.p2) === 'under'
        ? 'under'
        : 'full';
    lines.push({ id: l.id, x1: a[0], y1: a[1], x2: b[0], y2: b[1], status, construction: l.construction });
  }
  const screenLine = (id: string): [Vec, Vec] | undefined => {
    const l = lineById.get(id);
    const a = l && screenPt.get(l.p1);
    const b = l && screenPt.get(l.p2);
    return a && b ? [a, b] : undefined;
  };

  // ---------------------------------------------------------------- glyphs
  const glyphs: LGlyph[] = [];
  const stack = new Map<string, number>();
  const nextSlot = (anchor: string) => {
    const k = stack.get(anchor) ?? 0;
    stack.set(anchor, k + 1);
    return k;
  };
  for (const c of sketch.constraints) {
    if (isDimension(c)) continue;
    const symbol = CONSTRAINT_DEFS[c.type].symbol;
    const anchors =
      c.type === 'parallel' || c.type === 'perpendicular' || c.type === 'equal' ? c.refs : [c.refs[0]!];
    for (const anchor of anchors) {
      const slot = nextSlot(anchor);
      let pos: Vec | undefined;
      const ln = screenLine(anchor);
      if (ln) {
        const d = unit(sub(ln[1], ln[0]));
        const n: Vec = [d[1], -d[0]];
        const mid = mul(add(ln[0], ln[1]), 0.5);
        pos = add(add(mid, mul(n[1] > 0 ? mul(n, -1) : n, 14)), mul(d, slot * 18));
      } else {
        const p = screenPt.get(anchor);
        if (p) pos = [p[0] + 14 + slot * 18, p[1] - 14];
      }
      if (pos)
        glyphs.push({ key: `${c.id}:${anchor}`, id: c.id, x: pos[0], y: pos[1], symbol, bad: bad.has(c.id) });
    }
  }

  // ---------------------------------------------------------------- dimensions
  const dims: LDim[] = [];
  for (const c of sketch.constraints) {
    if (!isDimension(c) || c.value === undefined) continue;
    const d = layoutDimension(c, input, screenPt, screenLine);
    if (d) dims.push({ ...d, bad: bad.has(c.id) });
  }
  return { points, lines, glyphs, dims };
}

/** World-space label position of a dimension, using its stored offset or a default. */
function labelWorld(c: SketchConstraint, anchorWorld: Vec, defaultOffsetWorld: Vec): Vec {
  if (c.labelDx !== undefined && c.labelDy !== undefined)
    return [anchorWorld[0] + c.labelDx, anchorWorld[1] + c.labelDy];
  return add(anchorWorld, defaultOffsetWorld);
}

/** The world point dimension label offsets are measured from. */
export function dimensionAnchor(c: SketchConstraint, sketch: Sketch): Vec | undefined {
  const pts = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as Vec]));
  const lines = new Map(sketch.lines.map((l) => [l.id, l]));
  const ends = (id: string): [Vec, Vec] | undefined => {
    const l = lines.get(id);
    const a = l && pts.get(l.p1);
    const b = l && pts.get(l.p2);
    return a && b ? [a, b] : undefined;
  };
  const [a, b] = c.refs;
  if (c.type === 'angle') {
    const la = ends(a!);
    if (!la) return undefined;
    if (b === undefined) return la[0];
    const lb = ends(b);
    if (!lb) return undefined;
    return intersect(la, lb) ?? mul(add(la[1], lb[0]), 0.5);
  }
  const pa = pts.get(a!);
  if (b === undefined) {
    const la = ends(a!);
    return la ? mul(add(la[0], la[1]), 0.5) : undefined;
  }
  const pb = pts.get(b);
  if (pa && pb) return mul(add(pa, pb), 0.5);
  const lb = ends(b);
  if (pa && lb) return mul(add(pa, foot(pa, lb)), 0.5);
  return undefined;
}

function foot(p: Vec, [a, b]: [Vec, Vec]): Vec {
  const d = sub(b, a);
  const t = dot(sub(p, a), d) / Math.max(dot(d, d), 1e-24);
  return add(a, mul(d, t));
}

function intersect([a, b]: [Vec, Vec], [c, d]: [Vec, Vec]): Vec | undefined {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12 * Math.max(dot(r, r), dot(s, s))) return undefined;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return add(a, mul(r, t));
}

function layoutDimension(
  c: SketchConstraint,
  input: LayoutInput,
  screenPt: Map<string, Vec>,
  screenLine: (id: string) => [Vec, Vec] | undefined,
): Omit<LDim, 'bad'> | undefined {
  const { sketch, view, size, angleUnit } = input;
  const kind = CONSTRAINT_DEFS[c.type].value!;
  const text = c.reference
    ? `(${formatValue(Math.abs(c.value!), kind, angleUnit)})`
    : formatValue(kind === 'angle' && c.refs.length === 2 ? Math.abs(c.value!) : c.value!, kind, angleUnit);
  const anchorW = dimensionAnchor(c, sketch);
  if (!anchorW) return undefined;
  const toScreen = (w: Vec) => worldToScreen(view, size, w[0], w[1]);
  const px = 1 / view.scale; // one screen pixel in world units
  const [a, b] = c.refs;

  if (c.type === 'angle') {
    const la = screenLine(a!);
    if (!la) return undefined;
    const vertex = toScreen(anchorW);
    // Angles here are world angles (counterclockwise); screen y points down.
    const lineAngle = Math.atan2(-(la[1][1] - la[0][1]), la[1][0] - la[0][0]);
    const start = b === undefined ? 0 : lineAngle;
    const sweep = b === undefined ? lineAngle : wrapAngle((c.value ?? 0) * input.angleScale);
    const mid = start + sweep / 2;
    const defaultW: Vec = mul([Math.cos(mid), Math.sin(mid)], 40 * px);
    const lw = labelWorld(c, anchorW, defaultW);
    const label = toScreen(lw);
    const r = Math.max(Math.hypot(label[0] - vertex[0], label[1] - vertex[1]), 16);
    const at = (ang: number): Vec => [vertex[0] + r * Math.cos(ang), vertex[1] - r * Math.sin(ang)];
    const p0 = at(start);
    const p1 = at(start + sweep);
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    const sweepFlag = sweep > 0 ? 0 : 1;
    let lines = `M${p0[0]} ${p0[1]}A${r} ${r} 0 ${large} ${sweepFlag} ${p1[0]} ${p1[1]}`;
    if (b === undefined) lines += `M${vertex[0]} ${vertex[1]}H${vertex[0] + r + 10}`; // horizontal reference ray
    const tangent = (ang: number, sgn: number): Vec => unit([-Math.sin(ang) * sgn, -Math.cos(ang) * sgn]);
    const s = Math.sign(sweep) || 1;
    const arrows =
      Math.abs(sweep) * r > 2 * ARROW_LEN + 4
        ? arrow(p1, tangent(start + sweep, s)) + arrow(p0, tangent(start, -s))
        : '';
    return { id: c.id, lines, arrows, lx: label[0], ly: label[1], text, reference: c.reference };
  }

  // Linear dimensions: find the two measured screen points.
  let A: Vec | undefined;
  let B: Vec | undefined;
  if (b === undefined) {
    const l = screenLine(a!);
    if (l) [A, B] = l;
  } else {
    A = screenPt.get(a!);
    B = screenPt.get(b) ?? (A && screenLine(b) ? foot(A, screenLine(b)!) : undefined);
  }
  if (!A || !B) return undefined;

  let dir: Vec;
  if (c.type === 'hdistance') dir = [B[0] >= A[0] ? 1 : -1, 0];
  else if (c.type === 'vdistance') dir = [0, B[1] >= A[1] ? 1 : -1];
  else dir = unit(sub(B, A));
  const normal: Vec = [dir[1], -dir[0]];

  // Default offset: perpendicular, on the "up/left" side on screen.
  const nUp: Vec = normal[1] > 0 || (normal[1] === 0 && normal[0] < 0) ? mul(normal, -1) : normal;
  const defaultW: Vec = [nUp[0] * DEFAULT_DIM_OFFSET_PX * px, -nUp[1] * DEFAULT_DIM_OFFSET_PX * px];
  const label = toScreen(labelWorld(c, anchorW, defaultW));

  // Dimension line passes through the label, parallel to dir.
  let A2: Vec;
  let B2: Vec;
  if (c.type === 'hdistance') {
    A2 = [A[0], label[1]];
    B2 = [B[0], label[1]];
  } else if (c.type === 'vdistance') {
    A2 = [label[0], A[1]];
    B2 = [label[0], B[1]];
  } else {
    const t = dot(sub(label, A), normal);
    A2 = add(A, mul(normal, t));
    B2 = add(B, mul(normal, t));
  }
  const ext = (from: Vec, to: Vec) => {
    const d = sub(to, from);
    const len = Math.hypot(d[0], d[1]);
    if (len < 1) return '';
    const u = mul(d, 1 / len);
    const s = add(from, mul(u, Math.min(4, len)));
    const e = add(to, mul(u, 5));
    return `M${s[0]} ${s[1]}L${e[0]} ${e[1]}`;
  };
  // Extend the dimension line to reach the label if it sits outside.
  const span = sub(B2, A2);
  const spanLen = Math.hypot(span[0], span[1]);
  const along = spanLen > 0 ? dot(sub(label, A2), span) / spanLen : 0;
  const lineStart = along < 0 ? add(A2, mul(unit(span), along - 12)) : A2;
  const lineEnd = along > spanLen ? add(A2, mul(unit(span), along + 12)) : B2;
  const lines = ext(A, A2) + ext(B, B2) + `M${lineStart[0]} ${lineStart[1]}L${lineEnd[0]} ${lineEnd[1]}`;
  const u = spanLen > 0 ? unit(span) : dir;
  const inside = spanLen > 2 * ARROW_LEN + 6;
  const arrows = inside ? arrow(A2, mul(u, -1)) + arrow(B2, u) : arrow(A2, u) + arrow(B2, mul(u, -1));
  return { id: c.id, lines, arrows, lx: label[0], ly: label[1], text, reference: c.reference };
}

/** Label offset (world units, relative to the dimension's anchor) for a label dragged to a screen point. */
export function labelOffsetFor(
  c: SketchConstraint,
  sketch: Sketch,
  view: View,
  size: Size,
  sx: number,
  sy: number,
): { labelDx: number; labelDy: number } | undefined {
  const anchor = dimensionAnchor(c, sketch);
  if (!anchor) return undefined;
  const [wx, wy] = screenToWorld(view, size, sx, sy);
  return { labelDx: wx - anchor[0], labelDy: wy - anchor[1] };
}

function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / Math.max(dot(d, d), 1e-24)));
  const q = add(a, mul(d, t));
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/**
 * Topmost item under a screen point: dimension labels and relation glyphs,
 * then points, then lines. `geometryOnly` ignores labels and glyphs.
 */
export function hitTest(
  layout: Layout,
  sx: number,
  sy: number,
  exclude?: Set<string>,
  geometryOnly = false,
): Hit | null {
  const p: Vec = [sx, sy];
  for (const d of geometryOnly ? [] : layout.dims) {
    const halfW = d.text.length * 3.6 + 8;
    if (Math.abs(sx - d.lx) <= halfW && Math.abs(sy - d.ly) <= 11) return { kind: 'constraint', id: d.id };
  }
  for (const g of geometryOnly ? [] : layout.glyphs)
    if (Math.abs(sx - g.x) <= 8 && Math.abs(sy - g.y) <= 8) return { kind: 'constraint', id: g.id };
  let best: Hit | null = null;
  let bestD = 9;
  for (const pt of layout.points) {
    if (exclude?.has(pt.id)) continue;
    const d = Math.hypot(pt.x - sx, pt.y - sy);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'point', id: pt.id };
    }
  }
  if (best) return best;
  bestD = 8;
  for (const l of layout.lines) {
    if (exclude?.has(l.id)) continue;
    const d = distToSegment(p, [l.x1, l.y1], [l.x2, l.y2]);
    if (d < bestD) {
      bestD = d;
      best = { kind: 'line', id: l.id };
    }
  }
  return best;
}

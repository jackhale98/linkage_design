// Sketch editing operations. Each mutates the sketch in place, re-solves,
// and either succeeds or leaves the sketch exactly as it was.
//
// Policy: the sketch is kept free of over-definition.
// - A constraint that adds nothing (already implied) is refused; a dimension
//   that adds nothing becomes a reference (driven) dimension instead.
// - A constraint that can't be satisfied together with the others is refused.
// - Older constraints made fully redundant by a new one are removed
//   (relations) or turned into references (dimensions), and reported.

import { RowSpace } from '../math/linalg';
import { CONSTRAINT_DEFS, isDimension, matchesSignature, measure, refKinds, rowCount } from './constraints';
import {
  activeConstraints,
  analyze,
  applyPositions,
  freePoints,
  solve,
  solveDrag,
  SketchSystem,
  type DragTarget,
  type SolverContext,
} from './solver';
import type { ConstraintType, Sketch, SketchConstraint } from './types';

export type EditResult = { ok: true; notes: string[] } | { ok: false; reason: string };

const ok = (notes: string[] = []): EditResult => ({ ok: true, notes });
const fail = (reason: string): EditResult => ({ ok: false, reason });

/** Next free ID with the given prefix, e.g. P7 after P1..P6. */
export function nextId(sketch: Sketch, prefix: string): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const list of [sketch.points, sketch.lines, sketch.constraints]) {
    for (const e of list) {
      const m = re.exec(e.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return `${prefix}${max + 1}`;
}

function snapshot(sketch: Sketch): string {
  return JSON.stringify(sketch);
}

function restore(sketch: Sketch, snap: string): void {
  const s = JSON.parse(snap) as Sketch;
  sketch.points = s.points;
  sketch.lines = s.lines;
  sketch.constraints = s.constraints;
}

function rankOf(sketch: Sketch, ctx: SolverContext, constraints: SketchConstraint[]): number {
  const sys = new SketchSystem(sketch, ctx, constraints);
  const space = new RowSpace(1e-7);
  let rank = 0;
  for (const row of sys.evaluate(sys.q0()).J) if (space.add(row)) rank++;
  return rank;
}

function isSatisfied(sketch: Sketch, ctx: SolverContext, c: SketchConstraint): boolean {
  const sys = new SketchSystem(sketch, ctx, [c]);
  return sys.residual(sys.q0()).every((v) => Math.abs(v) <= sys.tol * 1e3);
}

/** Solve and write positions back. Returns false (sketch untouched) if unsolvable. */
export function resolve(sketch: Sketch, ctx: SolverContext): boolean {
  const sys = new SketchSystem(sketch, ctx);
  if (sys.constraints.length === 0) return true;
  const res = solve(sys);
  if (!res.ok || collapsesLine(sys, sys.q0(), res.q)) return false;
  applyPositions(sketch, sys, res.q);
  refreshReferences(sketch, ctx);
  return true;
}

/**
 * True if a solution shrinks a line to zero length. Such "solutions" satisfy
 * contradictory constraints (e.g. a line both horizontal and vertical) by
 * degenerating the geometry, so they count as conflicts.
 */
function collapsesLine(sys: SketchSystem, before: number[], after: number[]): boolean {
  const g0 = sys.geometry(before);
  const g1 = sys.geometry(after);
  const tiny = 1e-6 * Math.max(sys.S, 1e-9);
  return sys.sketch.lines.some((l) => {
    const len = (g: ReturnType<SketchSystem['geometry']>) => {
      const [a, b] = g.line(l.id);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
    return len(g1) < tiny && len(g0) >= tiny;
  });
}

/** Update reference dimensions to their measured values. */
export function refreshReferences(sketch: Sketch, ctx: SolverContext): void {
  const sys = new SketchSystem(sketch, ctx, []);
  const geo = sys.geometry(sys.q0());
  for (const c of sketch.constraints) {
    if (!c.reference || !isDimension(c)) continue;
    const kinds = refKinds(sketch, c.refs);
    if (kinds.some((k) => k === undefined)) continue;
    c.value = measure(c, geo, ctx.angleScale);
  }
}

/** Remove relations / convert dimensions that are fully implied by the others. Never touches `keep`. */
function cleanupRedundant(sketch: Sketch, ctx: SolverContext, keep: string): string[] {
  const notes: string[] = [];
  for (;;) {
    const active = activeConstraints(sketch);
    const full = rankOf(sketch, ctx, active);
    // Fast path: independent rows mean nothing is redundant.
    if (full === active.reduce((n, c) => n + rowCount(c), 0)) return notes;
    const victim = [...active].reverse().find(
      (c) =>
        c.id !== keep &&
        rankOf(
          sketch,
          ctx,
          active.filter((x) => x !== c),
        ) === full,
    );
    if (!victim) return notes;
    const label = CONSTRAINT_DEFS[victim.type].label.toLowerCase();
    if (isDimension(victim)) {
      victim.reference = true;
      notes.push(`${victim.id} (${label}) is now a reference dimension: the geometry already defines it`);
    } else {
      sketch.constraints = sketch.constraints.filter((c) => c !== victim);
      notes.push(`Removed ${victim.id} (${label}): it's now implied by other constraints`);
    }
  }
}

export function addPoint(sketch: Sketch, x: number, y: number): string {
  const id = nextId(sketch, 'P');
  sketch.points.push({ id, x, y, fixed: false, label: '', extras: {} });
  return id;
}

export function addLine(sketch: Sketch, p1: string, p2: string, construction = false): string {
  const id = nextId(sketch, 'L');
  sketch.lines.push({ id, p1, p2, construction, extras: {} });
  return id;
}

export interface NewConstraint {
  type: ConstraintType;
  refs: string[];
  value?: number;
  reference?: boolean;
  labelDx?: number;
  labelDy?: number;
}

/** Add a constraint or dimension. On success `id` is the new constraint's ID. */
export function addConstraint(
  sketch: Sketch,
  nc: NewConstraint,
  ctx: SolverContext,
): EditResult & { id?: string } {
  const def = CONSTRAINT_DEFS[nc.type];
  const kinds = refKinds(sketch, nc.refs);
  if (kinds.some((k) => k === undefined)) return fail('It refers to geometry that no longer exists');
  if (!matchesSignature(nc.type, kinds as ('point' | 'line')[]))
    return fail(`${def.label} can't be applied to that selection`);
  if (new Set(nc.refs).size !== nc.refs.length) return fail('Pick two different items');
  if (nc.type === 'coincident' || nc.type === 'point_on_line' || nc.type === 'midpoint') {
    const lineOf = sketch.lines.find((l) => l.id === nc.refs[1]);
    if (lineOf && (lineOf.p1 === nc.refs[0] || lineOf.p2 === nc.refs[0]))
      return fail('That point is already an endpoint of the line');
  }

  const snap = snapshot(sketch);
  const id = nextId(sketch, 'C');
  const c: SketchConstraint = {
    id,
    type: nc.type,
    refs: nc.refs.slice(),
    reference: !!nc.reference,
    labelDx: nc.labelDx,
    labelDy: nc.labelDy,
    extras: {},
  };
  if (def.value) {
    const sys = new SketchSystem(sketch, ctx, []);
    const current = measure(c, sys.geometry(sys.q0()), ctx.angleScale);
    c.value = nc.value ?? current;
    if (def.value === 'length' && !(c.value > 0)) return fail('Lengths must be greater than zero');
    if (
      c.type === 'angle' &&
      nc.value !== undefined &&
      c.refs.length === 2 &&
      Math.sign(nc.value) !== Math.sign(current) &&
      current !== 0
    ) {
      // Angle between lines: keep the current turning direction for the typed magnitude.
      c.value = -nc.value;
    }
  }

  const before = rankOf(sketch, ctx, activeConstraints(sketch));
  sketch.constraints.push(c);
  if (!c.reference) {
    const after = rankOf(sketch, ctx, activeConstraints(sketch));
    // Rows that add no rank are either implied (already satisfied) or in conflict
    // (unsatisfied); a conflict is caught by the solve below.
    if (after === before && isSatisfied(sketch, ctx, c)) {
      if (!isDimension(c)) {
        restore(sketch, snap);
        return fail(`${def.label} is already implied by the existing constraints`);
      }
      c.reference = true;
      refreshReferences(sketch, ctx);
      return {
        ok: true,
        notes: [`Added ${id} as a reference dimension: the geometry is already defined`],
        id,
      };
    }
  }
  if (!resolve(sketch, ctx)) {
    restore(sketch, snap);
    return fail(`${def.label} conflicts with the existing constraints`);
  }
  const notes = cleanupRedundant(sketch, ctx, id);
  refreshReferences(sketch, ctx);
  return { ok: true, notes, id };
}

/** Change a driving dimension's value and re-solve. */
export function setDimensionValue(sketch: Sketch, id: string, value: number, ctx: SolverContext): EditResult {
  const c = sketch.constraints.find((x) => x.id === id);
  if (!c || !isDimension(c)) return fail('Not a dimension');
  const kind = CONSTRAINT_DEFS[c.type].value;
  if (!Number.isFinite(value)) return fail('Enter a number');
  if (kind === 'length' && !(value > 0)) return fail('Lengths must be greater than zero');
  if (c.reference) return fail(`${c.id} is a reference dimension; make it driving to edit it`);
  const snap = snapshot(sketch);
  if (
    c.type === 'angle' &&
    c.refs.length === 2 &&
    c.value !== undefined &&
    Math.sign(value) !== Math.sign(c.value) &&
    c.value !== 0
  ) {
    value = -value;
  }
  c.value = value;
  if (!resolve(sketch, ctx)) {
    restore(sketch, snap);
    return fail(`Can't reach that value: it conflicts with other constraints`);
  }
  return ok();
}

/** Switch a dimension between driving and reference. */
export function setReference(sketch: Sketch, id: string, reference: boolean, ctx: SolverContext): EditResult {
  const c = sketch.constraints.find((x) => x.id === id);
  if (!c || !isDimension(c)) return fail('Not a dimension');
  if (c.reference === reference) return ok();
  if (reference) {
    c.reference = true;
    refreshReferences(sketch, ctx);
    return ok();
  }
  const before = rankOf(sketch, ctx, activeConstraints(sketch));
  c.reference = false;
  const after = rankOf(sketch, ctx, activeConstraints(sketch));
  if (after === before) {
    c.reference = true;
    return fail(`${c.id} can't drive the geometry: other constraints already define it`);
  }
  return ok();
}

export function setFixed(sketch: Sketch, pointId: string, fixed: boolean, ctx: SolverContext): EditResult {
  const p = sketch.points.find((x) => x.id === pointId);
  if (!p) return fail('Point not found');
  if (p.fixed === fixed) return ok();
  p.fixed = fixed;
  if (fixed && analyze(sketch, ctx).redundant.size > 0) {
    p.fixed = false;
    return fail(`${p.id} is already fully defined by its constraints`);
  }
  return ok();
}

/** Drag points toward targets. Returns false if nothing could move. */
export function dragPoints(sketch: Sketch, targets: DragTarget[], ctx: SolverContext): boolean {
  const movable = targets.filter((t) => !sketch.points.find((p) => p.id === t.point)?.fixed);
  if (movable.length === 0) return false;
  const sys = new SketchSystem(sketch, ctx);
  if (sys.constraints.length === 0) {
    for (const t of movable) {
      const p = sketch.points.find((x) => x.id === t.point)!;
      p.x = t.x;
      p.y = t.y;
    }
    return true;
  }
  // Fully defined points can't move; skip the solve (which would only add round-off).
  const free = freePoints(sys);
  if (!movable.some((t) => free.has(t.point))) return false;
  const q0 = sys.q0();
  const res = solveDrag(sys, movable, q0);
  if (!res.ok || collapsesLine(sys, q0, res.q)) return false;
  if (res.q.every((v, i) => Math.abs(v - q0[i]!) <= 1e-6 * sys.S)) return false;
  applyPositions(sketch, sys, res.q);
  refreshReferences(sketch, ctx);
  return true;
}

/**
 * Delete points, lines and/or constraints. Lines using a deleted point go too;
 * endpoints left unused by any line or constraint are removed; constraints
 * referring to removed geometry are removed.
 */
export function deleteEntities(sketch: Sketch, ids: Iterable<string>): void {
  const del = new Set(ids);
  sketch.constraints = sketch.constraints.filter((c) => !del.has(c.id));
  const delPoints = new Set(sketch.points.filter((p) => del.has(p.id)).map((p) => p.id));
  const removedLines = sketch.lines.filter(
    (l) => del.has(l.id) || delPoints.has(l.p1) || delPoints.has(l.p2),
  );
  sketch.lines = sketch.lines.filter((l) => !removedLines.includes(l));
  const gone = new Set([...delPoints, ...removedLines.map((l) => l.id)]);
  sketch.constraints = sketch.constraints.filter((c) => !c.refs.some((r) => gone.has(r)));
  // Endpoints of removed lines that nothing else uses.
  const used = new Set<string>();
  for (const l of sketch.lines) used.add(l.p1).add(l.p2);
  for (const c of sketch.constraints) for (const r of c.refs) used.add(r);
  const orphans = new Set(
    removedLines.flatMap((l) => [l.p1, l.p2]).filter((p) => !used.has(p) && !delPoints.has(p)),
  );
  sketch.points = sketch.points.filter((p) => !delPoints.has(p.id) && !orphans.has(p.id));
}

/** Constraint types that can be applied to the given selection (in display order). */
export function applicableConstraints(sketch: Sketch, refs: string[]): ConstraintType[] {
  const kinds = refKinds(sketch, refs);
  if (kinds.some((k) => k === undefined)) return [];
  return (Object.keys(CONSTRAINT_DEFS) as ConstraintType[]).filter((t) =>
    matchesSignature(t, kinds as ('point' | 'line')[]),
  );
}

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addConstraint,
  addLine,
  addPoint,
  applicableConstraints,
  deleteEntities,
  dragPoints,
  setDimensionValue,
  setFixed,
  setReference,
} from '../../../src/core/sketch/edit';
import { analyze } from '../../../src/core/sketch/solver';
import { emptySketch, type Sketch } from '../../../src/core/sketch/types';

const ctx = { angleScale: Math.PI / 180 };

const pt = (s: Sketch, id: string) => s.points.find((p) => p.id === id)!;
const dist = (s: Sketch, a: string, b: string) =>
  Math.hypot(pt(s, a).x - pt(s, b).x, pt(s, a).y - pt(s, b).y);

function mustAdd(
  s: Sketch,
  ...args: Parameters<typeof addConstraint> extends [Sketch, infer N, unknown] ? [N] : never
) {
  const r = addConstraint(s, args[0], ctx);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

/** Four-bar sketch: O2 (fixed) - A - B - O4, roughly drawn, then dimensioned. */
function fourBar(): Sketch {
  const s = emptySketch();
  const o2 = addPoint(s, 0, 0);
  const o4 = addPoint(s, 148, 3);
  const a = addPoint(s, 22, 44);
  const b = addPoint(s, 118, 85);
  s.points[0]!.fixed = true;
  addLine(s, o2, o4, true); // L1 ground (construction)
  addLine(s, o2, a); // L2 crank
  addLine(s, a, b); // L3 coupler
  addLine(s, b, o4); // L4 rocker
  mustAdd(s, { type: 'horizontal', refs: ['L1'] });
  mustAdd(s, { type: 'distance', refs: ['L1'], value: 150 });
  mustAdd(s, { type: 'distance', refs: ['L2'], value: 50 });
  mustAdd(s, { type: 'distance', refs: ['L3'], value: 110 });
  mustAdd(s, { type: 'distance', refs: ['L4'], value: 90 });
  return s;
}

describe('sketch editing', () => {
  let s: Sketch;
  beforeEach(() => {
    s = fourBar();
  });

  it('solves a dimensioned four-bar and reports one remaining DOF', () => {
    expect(pt(s, 'P2').y).toBeCloseTo(0, 9);
    expect(dist(s, 'P1', 'P2')).toBeCloseTo(150, 9);
    expect(dist(s, 'P1', 'P3')).toBeCloseTo(50, 9);
    expect(dist(s, 'P3', 'P4')).toBeCloseTo(110, 9);
    expect(dist(s, 'P4', 'P2')).toBeCloseTo(90, 9);
    const a = analyze(s, ctx);
    expect(a.dof).toBe(1);
    expect([...a.freePoints].sort()).toEqual(['P3', 'P4']);
    expect(a.redundant.size).toBe(0);
    expect(a.unsatisfied.size).toBe(0);
  });

  it('becomes fully defined with a crank angle and stays on the drawn branch', () => {
    mustAdd(s, { type: 'angle', refs: ['L2'], value: 60 });
    const a = analyze(s, ctx);
    expect(a.dof).toBe(0);
    expect(a.freePoints.size).toBe(0);
    expect(pt(s, 'P3').x).toBeCloseTo(25, 9);
    expect(pt(s, 'P3').y).toBeCloseTo(50 * Math.sin(Math.PI / 3), 9);
    expect(pt(s, 'P4').y).toBeGreaterThan(0); // B stays above the ground line as drawn
  });

  it('refuses a relation that is already implied', () => {
    const before = JSON.stringify(s);
    const r = addConstraint(s, { type: 'horizontal', refs: ['P1', 'P2'] }, ctx);
    expect(r).toEqual({ ok: false, reason: 'Horizontal is already implied by the existing constraints' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('adds a redundant dimension as a reference', () => {
    const r = mustAdd(s, { type: 'distance', refs: ['P1', 'P2'], value: 150 });
    const c = s.constraints.find((x) => x.id === r.id)!;
    expect(c.reference).toBe(true);
    expect(c.value).toBeCloseTo(150, 9);
    expect(r.notes[0]).toMatch(/reference dimension/);
  });

  it('refuses a conflicting constraint and leaves the sketch unchanged', () => {
    const before = JSON.stringify(s);
    const r = addConstraint(s, { type: 'angle', refs: ['L1'], value: 30 }, ctx);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('refuses an impossible dimension value and keeps the old one', () => {
    const before = JSON.stringify(s);
    const r = setDimensionValue(s, 'C3', 400, ctx); // crank longer than everything else combined
    expect(r.ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('reaches large dimension changes', () => {
    mustAdd(s, { type: 'angle', refs: ['L2'], value: 60 });
    expect(setDimensionValue(s, 'C3', 75, ctx).ok).toBe(true);
    expect(dist(s, 'P1', 'P3')).toBeCloseTo(75, 9);
    expect(setDimensionValue(s, 'C6', 100, ctx).ok).toBe(true);
    expect(Math.atan2(pt(s, 'P3').y, pt(s, 'P3').x) * (180 / Math.PI)).toBeCloseTo(100, 7);
    expect(dist(s, 'P3', 'P4')).toBeCloseTo(110, 9);
  });

  it('drags under-constrained geometry while keeping constraints exact', () => {
    const ok = dragPoints(s, [{ point: 'P3', x: -10, y: 49 }], ctx);
    expect(ok).toBe(true);
    expect(dist(s, 'P1', 'P3')).toBeCloseTo(50, 8);
    expect(dist(s, 'P3', 'P4')).toBeCloseTo(110, 8);
    expect(dist(s, 'P4', 'P2')).toBeCloseTo(90, 8);
    expect(pt(s, 'P3').x).toBeLessThan(0);
    expect(pt(s, 'P2').x).toBeCloseTo(150, 9); // fully defined points don't move
  });

  it('does not drag fixed points', () => {
    expect(dragPoints(s, [{ point: 'P1', x: 10, y: 10 }], ctx)).toBe(false);
  });

  it('removes a relation made redundant by a stronger one', () => {
    const m = addPoint(s, 70, 70);
    mustAdd(s, { type: 'point_on_line', refs: [m, 'L3'] });
    const r = mustAdd(s, { type: 'midpoint', refs: [m, 'L3'] });
    expect(r.notes).toEqual([expect.stringMatching(/^Removed C\d+ \(point on line\)/)]);
    expect(s.constraints.some((c) => c.type === 'point_on_line')).toBe(false);
    const A = pt(s, 'P3');
    const B = pt(s, 'P4');
    expect(pt(s, m).x).toBeCloseTo((A.x + B.x) / 2, 9);
  });

  it('switches dimensions between driving and reference', () => {
    mustAdd(s, { type: 'angle', refs: ['L2'], value: 60 });
    const extra = mustAdd(s, { type: 'distance', refs: ['P1', 'P4'] }).id!;
    expect(s.constraints.find((c) => c.id === extra)!.reference).toBe(true);
    expect(setReference(s, extra, false, ctx).ok).toBe(false);
    expect(setReference(s, 'C6', true, ctx).ok).toBe(true);
    expect(setReference(s, extra, false, ctx).ok).toBe(true);
    expect(analyze(s, ctx).dof).toBe(0);
  });

  it('refuses to fix an already-defined point', () => {
    mustAdd(s, { type: 'angle', refs: ['L2'], value: 60 });
    expect(setFixed(s, 'P3', true, ctx).ok).toBe(false);
    expect(pt(s, 'P3').fixed).toBe(false);
  });

  it('deletes geometry with its constraints and orphaned endpoints', () => {
    deleteEntities(s, ['L3']);
    expect(s.lines.map((l) => l.id)).toEqual(['L1', 'L2', 'L4']);
    expect(s.constraints.some((c) => c.refs.includes('L3'))).toBe(false);
    expect(s.points).toHaveLength(4); // A and B are still used by other lines
    deleteEntities(s, ['P1']);
    expect(s.lines.map((l) => l.id)).toEqual(['L4']);
    expect(s.points.map((p) => p.id).sort()).toEqual(['P2', 'P4']);
  });

  it('lists applicable constraints for a selection', () => {
    expect(applicableConstraints(s, ['L2', 'L3'])).toEqual(['angle', 'parallel', 'perpendicular', 'equal']);
    expect(applicableConstraints(s, ['P3', 'L1'])).toEqual(['distance', 'point_on_line', 'midpoint']);
    expect(applicableConstraints(s, ['nope'])).toEqual([]);
  });

  it('keeps the typed angle in the existing turning direction', () => {
    const r = mustAdd(s, { type: 'angle', refs: ['L1', 'L4'] });
    const c = s.constraints.find((x) => x.id === r.id)!;
    const sign = Math.sign(c.value!);
    expect(setDimensionValue(s, c.id, 60, ctx).ok).toBe(true);
    expect(c.value).toBeCloseTo(sign * 60, 9);
  });
});

describe('degenerate solutions', () => {
  it('refuses constraints that would collapse a line to zero length', () => {
    const s = emptySketch();
    const a = addPoint(s, 0, 0);
    const b = addPoint(s, 40, 30);
    addLine(s, a, b);
    expect(addConstraint(s, { type: 'vertical', refs: ['L1'] }, ctx).ok).toBe(true);
    const before = JSON.stringify(s);
    const r = addConstraint(s, { type: 'horizontal', refs: ['L1'] }, ctx);
    expect(r).toEqual({ ok: false, reason: 'Horizontal conflicts with the existing constraints' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('treats a drag of fully defined geometry as no change', () => {
    const s = fourBar();
    mustAdd(s, { type: 'angle', refs: ['L2'], value: 60 });
    const before = JSON.stringify(s);
    expect(dragPoints(s, [{ point: 'P4', x: 200, y: 200 }], ctx)).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });
});

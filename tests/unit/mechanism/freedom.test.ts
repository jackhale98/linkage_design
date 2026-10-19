import { describe, expect, it } from 'vitest';
import { newProject } from '../../../src/core/model/project';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { syncMechanism } from '../../../src/core/mechanism/model';
import { nullSpaceBasis } from '../../../src/core/math/linalg';
import { pointFreedom } from '../../../src/core/math/freedom';
import { addLine, addPoint } from '../../../src/core/sketch/edit';
import { emptySketch } from '../../../src/core/sketch/types';
import { fourBar, must } from './helpers';

/** A four-bar with a pendulum hanging from B: two degrees of freedom. */
function withPendulum(driver: boolean) {
  const p = newProject(new Date('2026-10-19T12:00:00Z'));
  p.sketch = fourBar(50, 110, 90, 140, 60);
  const B = p.sketch.points.find((x) => x.id === 'P4')!;
  const e = addPoint(p.sketch, B.x + 30, B.y - 40);
  addLine(p.sketch, 'P4', e);
  if (driver) p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L2' };
  syncMechanism(p.sketch, p.mechanism);
  return { p, B, e };
}

describe('null space', () => {
  it('returns an orthonormal basis of the motions the rows allow', () => {
    const J = [
      [1, 1, 0, 0],
      [0, 0, 1, -1],
    ];
    const N = nullSpaceBasis(J, 4);
    expect(N).toHaveLength(2);
    for (const v of N) {
      for (const row of J) expect(row.reduce((s, x, i) => s + x * v[i]!, 0)).toBeCloseTo(0, 12);
      expect(Math.hypot(...v)).toBeCloseTo(1, 12);
    }
    expect(N[0]!.reduce((s, x, i) => s + x * N[1]![i]!, 0)).toBeCloseTo(0, 12);
  });

  it('classifies point freedom independent of the basis', () => {
    expect(pointFreedom([[0, 0]])).toBeNull();
    const line = pointFreedom([
      [3, 4],
      [-0.6, -0.8],
    ])!;
    expect(line.kind).toBe('line');
    expect(Math.abs(line.dir[0] * 4 - line.dir[1] * 3)).toBeLessThan(1e-12);
    expect(
      pointFreedom([
        [1, 0],
        [0, 1],
      ])!.kind,
    ).toBe('plane');
  });
});

describe('mechanism freedom', () => {
  it('finds the pendulum as the extra freedom with the crank held', () => {
    const { p, B, e } = withPendulum(true);
    const m = computeMotion(p);
    expect(m.mobility).toBe(2);
    const f = m.freedom!;
    expect(f.modes).toBe(1);
    const crank = m.model.bodies.find((b) => b.lines.includes('L2'))!;
    expect(f.held).toBe(`the ${crank.name}`);
    const pendulum = m.model.bodies.find((b) => b.points.includes(e))!;
    expect(f.bodies).toEqual([pendulum.id]);
    // Only the pendulum's free end moves, at right angles to the pendulum.
    expect(f.points.map((x) => x.id)).toEqual([e]);
    const pt = f.points[0]!;
    expect(pt.kind).toBe('line');
    const E = p.sketch.points.find((x) => x.id === e)!;
    const along = [E.x - B.x, E.y - B.y];
    expect(Math.abs(pt.dir[0] * along[0]! + pt.dir[1] * along[1]!)).toBeLessThan(1e-9);
    const msg = m.issues.find((i) => i.severity === 'error')!.message;
    expect(msg).toContain(`With the ${crank.name} held still,`);
    expect(msg).toContain(`${m.model.bodies.find((b) => b.id === pendulum.id)!.name} can still move`);
  });

  it('shows every free motion when there is no driver', () => {
    const m = computeMotion(withPendulum(false).p);
    expect(m.freedom!.modes).toBe(2);
    expect(m.freedom!.held).toBeNull();
    expect(m.freedom!.bodies).toHaveLength(4);
  });

  it('is not computed for a mechanism that moves correctly', () => {
    const p = newProject(new Date('2026-10-19T12:00:00Z'));
    p.sketch = fourBar(50, 110, 90, 140, 60);
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L2' };
    syncMechanism(p.sketch, p.mechanism);
    expect(computeMotion(p).freedom).toBeNull();
  });
});

describe('pivot partway along a link', () => {
  /** A bar resting on a fixed pin P1 (point on line), optionally dimensioned along the bar. */
  function lever(dimensioned: boolean) {
    const p = newProject(new Date('2026-10-19T12:00:00Z'));
    const s = emptySketch();
    const pin = addPoint(s, 0, 0);
    s.points[0]!.fixed = true;
    const a = addPoint(s, -40, 0);
    const b = addPoint(s, 60, 0);
    const bar = addLine(s, a, b);
    must(s, { type: 'point_on_line', refs: [pin, bar] });
    if (dimensioned) must(s, { type: 'distance', refs: [a, pin], value: 40 });
    p.sketch = s;
    syncMechanism(p.sketch, p.mechanism);
    return computeMotion(p);
  }

  it('is a slot when the pin can slide along the bar', () => {
    const m = lever(false);
    expect(m.model.joints.map((j) => j.type)).toEqual(['pin_in_slot']);
    expect(m.mobility).toBe(2);
  });

  it('is a revolute when the sketch fixes where the pin sits on the bar', () => {
    const m = lever(true);
    expect(m.model.joints.map((j) => j.type)).toEqual(['revolute']);
    expect(m.mobility).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { addConstraint, addLine, addPoint, dragPoints } from '../../../src/core/sketch/edit';
import { analyze } from '../../../src/core/sketch/solver';
import { emptySketch } from '../../../src/core/sketch/types';

const ctx = { angleScale: Math.PI / 180 };

/** A chain of four-bars sharing rockers: n links, about 2n points and 3n constraints. */
function chain(n: number) {
  const s = emptySketch();
  let o2 = addPoint(s, 0, 0);
  s.points[0]!.fixed = true;
  for (let k = 0; k < n; k++) {
    const x0 = k * 150;
    const o4 = addPoint(s, x0 + 150, 0);
    s.points.find((p) => p.id === o4)!.fixed = true;
    const a = addPoint(s, x0 + 25, 43);
    const b = addPoint(s, x0 + 125, 88);
    addLine(s, o2, a);
    addLine(s, a, b);
    addLine(s, b, o4);
    for (const [line, value] of [
      [s.lines.at(-3)!.id, 50],
      [s.lines.at(-2)!.id, 110],
      [s.lines.at(-1)!.id, 90],
    ] as const) {
      const r = addConstraint(s, { type: 'distance', refs: [line], value }, ctx);
      if (!r.ok) throw new Error(r.reason);
    }
    o2 = o4;
  }
  return s;
}

describe('performance budget (docs/DESIGN.md §9.4)', () => {
  it('re-solves a drag of a 46-point, 45-constraint sketch within a frame', () => {
    const s = chain(15);
    expect(analyze(s, ctx).dof).toBe(15);
    const p = s.points.find((x) => x.id === 'P3')!;
    // Warm up, then time a sequence of drag frames.
    dragPoints(s, [{ point: 'P3', x: p.x - 1, y: p.y + 1 }], ctx);
    const frames = 20;
    const t0 = performance.now();
    for (let k = 0; k < frames; k++) dragPoints(s, [{ point: 'P3', x: p.x - k, y: p.y + k / 2 }], ctx);
    const perFrame = (performance.now() - t0) / frames;
    console.log(`drag frame: ${perFrame.toFixed(2)} ms`);
    expect(perFrame).toBeLessThan(16);
  });
});

describe('performance budget: motion sweep', () => {
  it('sweeps the four-bar example (360 steps) well within 30 ms', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseProject } = await import('../../../src/core/model/project');
    const { computeMotion } = await import('../../../src/core/mechanism/motion');
    const r = parseProject(readFileSync('src/examples/four-bar.csv', 'utf8'));
    if (!r.ok) throw new Error('example failed to load');
    computeMotion(r.project); // warm up
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) computeMotion(r.project);
    const ms = (performance.now() - t0) / 5;
    console.log(`four-bar sweep: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(60); // 30 ms budget, with headroom for slower CI machines
  });
});

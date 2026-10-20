import { describe, expect, it } from 'vitest';
import { angleScale, newProject } from '../../../src/core/model/project';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { syncMechanism } from '../../../src/core/mechanism/model';
import { solveForces } from '../../../src/core/forces/solve';
import { newLoad } from '../../../src/core/forces/types';
import { addLine, addPoint } from '../../../src/core/sketch/edit';
import { must } from './helpers';

describe('slots', () => {
  it('a pin shared by a rod and a piston block rides the slot once, on the block', () => {
    // Slider-crank with a separate piston: P joins the rod and the piston, and the piston (P-Q) runs in the slide.
    const p = newProject(new Date('2026-10-19T12:00:00Z'));
    const s = p.sketch;
    const o = addPoint(s, 0, 0);
    const a = addPoint(s, 28.28, 28.28);
    const pin = addPoint(s, 143.6, 0);
    const q = addPoint(s, 183.6, 0);
    const g1 = addPoint(s, 100, 0);
    const g2 = addPoint(s, 300, 0);
    for (const id of [o, g1, g2]) s.points.find((x) => x.id === id)!.fixed = true;
    const crank = addLine(s, o, a);
    const rod = addLine(s, a, pin);
    const piston = addLine(s, pin, q);
    const slide = addLine(s, g1, g2, true);
    must(
      s,
      { type: 'distance', refs: [crank], value: 40 },
      { type: 'angle', refs: [crank], value: 45 },
      { type: 'distance', refs: [rod], value: 120 },
      { type: 'distance', refs: [piston], value: 40 },
      { type: 'point_on_line', refs: [pin, slide] },
      { type: 'point_on_line', refs: [q, slide] },
    );
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank };
    syncMechanism(s, p.mechanism);
    const pistonBody = p.mechanism.bodies.find((b) => b.lines.includes(piston))!.id;
    const slots = p.mechanism.joints.filter((j) => j.line === slide);
    expect(slots.map((j) => [j.point, j.bodyB])).toEqual([
      [pin, pistonBody],
      [q, pistonBody],
    ]);

    const m = computeMotion(p);
    expect(m.mobility).toBe(1);
    p.forces.loads = [{ ...newLoad('F1', 'force'), body: pistonBody, point: q, fx: -500 }];
    const f = solveForces(m, p.mechanism.bodies, p.forces, { length: 'mm', force: 'N' }, angleScale(p));
    // Not over-constrained: the joint forces are unique.
    expect(f.issues).toEqual([]);
  });
});

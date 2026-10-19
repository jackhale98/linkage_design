import { addConstraint, addLine, addPoint } from '../../../src/core/sketch/edit';
import { emptySketch, type Sketch } from '../../../src/core/sketch/types';
import { emptyMechanism, type MechanismData } from '../../../src/core/mechanism/types';
import { buildModel, syncMechanism } from '../../../src/core/mechanism/model';
import { KinematicSystem } from '../../../src/core/mechanism/kinematics';

export const ctx = { angleScale: Math.PI / 180 };

export function must(s: Sketch, ...ncs: Parameters<typeof addConstraint>[1][]) {
  for (const nc of ncs) {
    const r = addConstraint(s, nc, ctx);
    if (!r.ok) throw new Error(r.reason);
  }
}

export interface Built {
  sketch: Sketch;
  mech: MechanismData;
  sys: KinematicSystem;
}

export function build(sketch: Sketch, mech: MechanismData): Built {
  syncMechanism(sketch, mech);
  return { sketch, mech, sys: new KinematicSystem(buildModel(sketch, mech)) };
}

/**
 * Four-bar O2-A-B-O4: crank a (L2), coupler b (L3), rocker c (L4), ground d
 * (construction L1, horizontal). Crank at theta2 (degrees).
 */
export function fourBar(a: number, b: number, c: number, d: number, theta2: number): Sketch {
  const s = emptySketch();
  const o2 = addPoint(s, 0, 0);
  const o4 = addPoint(s, d, 0);
  const t = (theta2 * Math.PI) / 180;
  const A: [number, number] = [a * Math.cos(t), a * Math.sin(t)];
  // B: circle intersection, upper branch (open configuration).
  const dx = d - A[0];
  const dy = -A[1];
  const L = Math.hypot(dx, dy);
  const along = (b * b - c * c + L * L) / (2 * L);
  const h = Math.sqrt(b * b - along * along);
  const B: [number, number] = [
    A[0] + (along * dx) / L - (h * dy) / L,
    A[1] + (along * dy) / L + (h * dx) / L,
  ];
  const pa = addPoint(s, ...A);
  const pb = addPoint(s, ...B);
  s.points[0]!.fixed = true;
  addLine(s, o2, o4, true); // L1 ground
  addLine(s, o2, pa); // L2 crank
  addLine(s, pa, pb); // L3 coupler
  addLine(s, pb, o4); // L4 rocker
  must(s, { type: 'horizontal', refs: ['L1'] }, { type: 'distance', refs: ['L1'], value: d });
  return s;
}

export function rotaryDriver(
  mech: MechanismData,
  line: string,
  start: number,
  end: number,
  steps: number,
  lineRef = '',
) {
  mech.driver = { ...mech.driver, type: 'rotary', line, lineRef, start, end, steps, speed: 60 };
}

export { emptyMechanism };

/** Central-difference check helper. */
export function centralDiff(f: (t: number) => number, t: number, h: number): { d1: number; d2: number } {
  const fp = f(t + h);
  const fm = f(t - h);
  const f0 = f(t);
  return { d1: (fp - fm) / (2 * h), d2: (fp - 2 * f0 + fm) / (h * h) };
}

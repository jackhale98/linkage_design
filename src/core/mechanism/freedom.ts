// Where a mechanism's extra degrees of freedom are: the links that can still
// move with the driver held, and how each of their points can move.

import { pointFreedom, type PointFreedom } from '../math/freedom';
import type { KinematicSystem } from './kinematics';
import type { MechanismModel } from './model';

type Vec = [number, number];

export interface MechanismFreedom {
  /** Number of independent motions found. */
  modes: number;
  /** What was held still while finding them ("the Crank", "the actuator"), if anything. */
  held: string | null;
  /** Links that can still move. */
  bodies: string[];
  /** Points of those links that move, and how. */
  points: ({ id: string; at: Vec } & PointFreedom)[];
}

export function mechanismFreedom(model: MechanismModel, sys: KinematicSystem): MechanismFreedom {
  const q = sys.q0();
  const d = model.driver;
  const modes = sys.freeModes(q, !!d);
  const tol = 1e-6;
  const bodies: string[] = [];
  const points: MechanismFreedom['points'] = [];
  const seen = new Set<string>();
  for (const b of model.bodies) {
    let moves = false;
    const i = sys.bodyIndex.get(b.id);
    if (i !== undefined) for (const v of modes) if (Math.abs(v[3 * i + 2]!) * sys.scale > tol) moves = true;
    for (const p of b.points) {
      const a = sys.attach(p, b.id);
      const f = pointFreedom(
        modes.map((v) => sys.vel(q, v, a)),
        tol,
      );
      if (!f) continue;
      moves = true;
      if (seen.has(p)) continue;
      seen.add(p);
      points.push({ id: p, at: model.positions.get(p)!, ...f });
    }
    if (moves) bodies.push(b.id);
  }
  const held = !d
    ? null
    : d.type === 'rotary'
      ? `the ${model.bodies.find((b) => b.id === d.body)?.name ?? 'driven link'}`
      : 'the actuator';
  return { modes: modes.length, held, bodies, points };
}

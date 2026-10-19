// Where a mechanism's extra degrees of freedom are: the links that can still
// move with the driver held, and how each of their points can move.

import { pointFreedom, type PointFreedom } from '../math/freedom';
import type { Sketch } from '../sketch/types';
import { GROUND } from './types';
import type { KinematicSystem } from './kinematics';
import type { MechanismModel } from './model';

type Vec = [number, number];

export interface MechanismFreedom {
  /** Number of independent motions found. */
  modes: number;
  /** What was held still while finding them ("Crank", "the actuator"), if anything. */
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
      ? (model.bodies.find((b) => b.id === d.body)?.name ?? 'the driven link')
      : 'the actuator';
  return { modes: modes.length, held, bodies, points };
}

/**
 * Sketch constraints that hold some of these links in place but aren't part
 * of the mechanism: they span links (or a link and ground) rather than sitting
 * inside one, so they only set the drawn pose. These explain why a sketch can
 * look fully defined while the mechanism still moves freely. The driver's own
 * angle or length is left out, and so are relations that become joints.
 */
export function poseConstraints(sketch: Sketch, model: MechanismModel, loose: string[]): string[] {
  const looseSet = new Set(loose);
  const owners = (ref: string): string[] => {
    for (const b of model.bodies) if (b.lines.includes(ref)) return [b.id];
    if (model.groundLines.has(ref)) return [GROUND];
    if (model.groundPoints.has(ref)) return [GROUND];
    return model.pointBodies.get(ref) ?? [];
  };
  const d = model.driver;
  return sketch.constraints
    .filter((c) => {
      if (c.reference || c.type === 'point_on_line' || c.type === 'coincident') return false;
      if (d?.type === 'rotary' && c.refs.includes(d.line)) return false;
      if (d?.type === 'linear' && c.refs.includes(d.pointA) && c.refs.includes(d.pointB)) return false;
      const sets = c.refs.map(owners);
      // Inside one link (or ground): rigid geometry, kept by the mechanism.
      const common = sets.reduce((acc, s) => acc.filter((b) => s.includes(b)));
      if (common.length) return false;
      return sets.some((s) => s.some((b) => looseSet.has(b)));
    })
    .map((c) => c.id);
}

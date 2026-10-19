// Kinetostatic analysis (docs/DESIGN.md §6).
//
// With the motion known, the equations of motion in Lagrange-multiplier form
//   M q'' + Phi_q^T lambda = Q_applied
// give the multipliers from one linear solve per position:
//   Phi_q^T lambda = Q_applied + Q_inertia,   Q_inertia = -M q''
// (inertia is applied d'Alembert-style at each centre of mass, so the body
// reference points need not be centres of mass). The constraint forces are
// Q_c = -Phi_q^T lambda; summing a joint's rows gives the force (and moment)
// that joint exerts on each body. The driver row gives the input torque or
// actuator force.
//
// Units: lengths, forces and angles in project units; mass in kg (N) or
// lb (lbf). Power is reported in watts.

import { solveDamped, solveSquare, RowSpace } from '../math/linalg';
import type { MotionResult } from '../mechanism/motion';
import { reachable } from '../mechanism/analysis';
import type { Attach } from '../mechanism/kinematics';
import type { Frame } from '../mechanism/sweep';
import { GROUND, type Body } from '../mechanism/types';
import { inertiaFactor, weightPerMass, type ForceUnits, type ForcesData } from './types';

type Vec = [number, number];

const LENGTH_M = { mm: 0.001, m: 1, in: 0.0254 } as const;
const FORCE_N = { N: 1, lbf: 4.4482216152605 } as const;

export interface JointForce {
  /** Force on body B (the joint's second body) from body A, global components. */
  fx: number;
  fy: number;
  /** Moment on body B about the joint point (slider blocks resist rotation). */
  moment: number;
  /** Body the force acts on. */
  on: string;
}

export interface ForceFrame {
  joints: Map<string, JointForce>;
  /** Rotary: torque the driver applies to the driven link (CCW +). Linear: actuator force (+ pushes apart). */
  driver: number;
  /** Driver power (W): + when the driver does work on the mechanism. */
  power: number;
  /** Spring tension (springs) or torque (torsion), by load ID. */
  springs: Map<string, number>;
  /** Virtual-work balance residual, relative to the largest power term (should be ~0). */
  balance: number;
}

export interface ForceResult {
  frames: ForceFrame[];
  /** Constraints are redundant: the reactions shown are one of many possible (minimum-norm). */
  indeterminate: boolean;
  issues: string[];
}

interface MassProps {
  mass: number;
  com: Vec;
  inertia: number;
}

/** Length-weighted centroid of a body's lines in the drawn pose. */
export function centroid(body: Body, ends: Map<string, [string, string]>, pos: Map<string, Vec>): Vec {
  let L = 0;
  let cx = 0;
  let cy = 0;
  for (const l of body.lines) {
    const [a, b] = ends.get(l) ?? [];
    const pa = a && pos.get(a);
    const pb = b && pos.get(b);
    if (!pa || !pb) continue;
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    L += len;
    cx += (len * (pa[0] + pb[0])) / 2;
    cy += (len * (pa[1] + pb[1])) / 2;
  }
  if (L === 0) {
    const [a] = ends.get(body.lines[0]!) ?? [];
    return (a ? pos.get(a) : undefined) ?? [0, 0];
  }
  return [cx / L, cy / L];
}

/**
 * Mass properties of a body made of uniform slender bars with the given mass
 * per unit length: mass, centre of mass and inertia about it.
 */
export function barMassProperties(
  body: Body,
  ends: Map<string, [string, string]>,
  pos: Map<string, Vec>,
  massPerLength: number,
): { mass: number; comX: number; comY: number; inertia: number } {
  const bars = body.lines.flatMap((l) => {
    const [a, b] = ends.get(l) ?? [];
    const pa = a && pos.get(a);
    const pb = b && pos.get(b);
    if (!pa || !pb) return [];
    const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    return [{ m: massPerLength * len, len, c: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] as Vec }];
  });
  const mass = bars.reduce((s, b) => s + b.m, 0);
  const com = centroid(body, ends, pos);
  const inertia = bars.reduce(
    (s, b) => s + b.m * ((b.len * b.len) / 12 + (b.c[0] - com[0]) ** 2 + (b.c[1] - com[1]) ** 2),
    0,
  );
  return { mass, comX: com[0], comY: com[1], inertia };
}

export function solveForces(
  motion: MotionResult,
  bodies: Body[],
  forces: ForcesData,
  units: ForceUnits,
  angleScale: number,
): ForceResult {
  const issues: string[] = [];
  const empty: ForceResult = { frames: [], indeterminate: false, issues };
  const { sys, res, data } = motion;
  if (!res || !data || !sys.driver) return empty;
  const frames = reachable(res);
  if (!frames.length) return empty;

  const fI = inertiaFactor(units);
  const wPerM = weightPerMass(units);
  const toWatts = LENGTH_M[units.length] * FORCE_N[units.force];
  const rate = data.rate;
  const moving = new Set(sys.bodyIds);

  // Mass properties of moving bodies, attached at their centres of mass.
  const mp = new Map<string, MassProps & { at: Attach }>();
  for (const b of bodies) {
    if (!moving.has(b.id) || !b.mass) continue;
    const c = centroid(b, sys.model.lineEnds, sys.model.positions);
    const com: Vec = [b.comX ?? c[0], b.comY ?? c[1]];
    mp.set(b.id, { mass: b.mass, com, inertia: b.inertia ?? 0, at: sys.attachPosition(com, b.id) });
  }

  // Where each point is attached for loads (its first moving body, else ground).
  const owner = (p: string) =>
    sys.model.groundPoints.has(p) ? GROUND : (sys.model.pointBodies.get(p)?.[0] ?? undefined);

  const rows = sys.rowOwners();
  const driverRow = rows.findIndex((r) => r.kind === 'rotary' || r.kind === 'linear');

  // Redundant constraints make the reactions non-unique.
  {
    const space = new RowSpace(1e-8);
    let rank = 0;
    for (const row of sys.jacobian(sys.q0())) if (space.add(row)) rank++;
    if (rank < rows.length) {
      issues.push(
        'The mechanism is over-constrained (redundant joints), so joint forces are not unique; the values shown are one possible (minimum-norm) distribution.',
      );
    }
  }
  const indeterminate = issues.length > 0;

  for (const l of forces.loads) {
    if (l.type === 'force' && l.body && !moving.has(l.body) && l.body !== GROUND)
      issues.push(`Load ${l.id} is on ${l.body}, which isn't a moving link; it is ignored`);
  }

  const out: ForceFrame[] = frames.map((f) => frameForces(f));
  return { frames: out, indeterminate, issues };

  function frameForces(f: Frame): ForceFrame {
    const n = sys.n;
    const Q = new Array<number>(n).fill(0);
    const refPos = (i: number): Vec => [f.q[3 * i]!, f.q[3 * i + 1]!];
    const addForce = (body: string, at: Vec, F: Vec) => {
      const i = sys.bodyIndex.get(body);
      if (i === undefined) return; // ground or unknown: reacted by the frame
      const r = refPos(i);
      Q[3 * i]! += F[0];
      Q[3 * i + 1]! += F[1];
      Q[3 * i + 2]! += (at[0] - r[0]) * F[1] - (at[1] - r[1]) * F[0];
    };
    const addTorque = (body: string, T: number) => {
      const i = sys.bodyIndex.get(body);
      if (i !== undefined) Q[3 * i + 2]! += T;
    };
    const phi = (body: string) => {
      const i = sys.bodyIndex.get(body);
      return i === undefined ? 0 : f.q[3 * i + 2]!;
    };
    const pointPos = (p: string): Vec | undefined => {
      const b = owner(p);
      return b === undefined ? undefined : sys.pos(f.q, sys.attach(p, b));
    };

    const springs = new Map<string, number>();
    for (const l of forces.loads) {
      if (l.type === 'force') {
        const at = l.body && moving.has(l.body) ? sys.pos(f.q, sys.attach(l.point, l.body)) : undefined;
        if (!at) continue;
        let F: Vec = [l.fx, l.fy];
        if (l.frame === 'body') {
          const a = phi(l.body);
          F = [Math.cos(a) * l.fx - Math.sin(a) * l.fy, Math.sin(a) * l.fx + Math.cos(a) * l.fy];
        }
        addForce(l.body, at, F);
      } else if (l.type === 'torque') {
        addTorque(l.body, l.torque);
      } else if (l.type === 'spring') {
        const pa = pointPos(l.point);
        const pb = pointPos(l.pointB);
        const ba = owner(l.point);
        const bb = owner(l.pointB);
        if (!pa || !pb || !ba || !bb) continue;
        const d: Vec = [pa[0] - pb[0], pa[1] - pb[1]];
        const len = Math.max(Math.hypot(d[0], d[1]), 1e-12);
        const p0a = sys.model.positions.get(l.point)!;
        const p0b = sys.model.positions.get(l.pointB)!;
        const free = l.free ?? Math.hypot(p0a[0] - p0b[0], p0a[1] - p0b[1]);
        const tension = l.k * (len - free) + l.preload;
        springs.set(l.id, tension);
        const e: Vec = [d[0] / len, d[1] / len];
        addForce(ba, pa, [-tension * e[0], -tension * e[1]]);
        addForce(bb, pb, [tension * e[0], tension * e[1]]);
      } else if (l.type === 'torsion') {
        const j = sys.model.joints.find((x) => x.id === l.joint);
        if (!j || j.type !== 'revolute') continue;
        const rel = phi(j.a) - phi(j.b); // relative rotation from the drawn pose (rad)
        const free = (l.free ?? 0) * angleScale;
        const T = (l.k * (rel - free)) / angleScale + l.preload;
        springs.set(l.id, T);
        addTorque(j.a, -T);
        addTorque(j.b, T);
      }
    }

    // Gravity and (kinetostatic) inertia at each centre of mass.
    for (const [id, m] of mp) {
      const com = sys.pos(f.q, m.at);
      if (forces.gravity) addForce(id, com, [0, -m.mass * wPerM]);
      if (forces.mode === 'kinetostatic') {
        const a = sys.acc(f.q, f.qd, f.qdd, m.at);
        const i = sys.bodyIndex.get(id)!;
        const alpha = f.qdd[3 * i + 2]! * rate * rate;
        addForce(id, com, [-m.mass * a[0] * rate * rate * fI, -m.mass * a[1] * rate * rate * fI]);
        addTorque(id, -m.inertia * alpha * fI);
      }
    }

    // Phi_q^T lambda = Q: a direct solve when square (the usual case); least
    // squares (minimum-norm) when constraints are redundant.
    const J = sys.jacobian(f.q);
    const JT = Array.from({ length: n }, (_, c) => J.map((row) => row[c]!));
    const lambda = (!indeterminate && J.length === n && solveSquare(JT, Q)) || solveDamped(JT, Q, 1e-12);

    // Constraint force on each body from each joint: -(rows of Phi_q)^T lambda.
    const joints = new Map<string, JointForce>();
    for (const j of sys.model.joints) {
      const target = j.b !== GROUND ? j.b : j.a;
      const sign = j.b !== GROUND ? 1 : -1; // report the force on B (negated if B is ground)
      const i = sys.bodyIndex.get(target);
      if (i === undefined) continue;
      let fx = 0;
      let fy = 0;
      let mz = 0;
      rows.forEach((r, k) => {
        if (r.joint !== j.id) return;
        const row = J[k]!;
        fx -= row[3 * i]! * lambda[k]!;
        fy -= row[3 * i + 1]! * lambda[k]!;
        mz -= row[3 * i + 2]! * lambda[k]!;
      });
      // Moment about the joint point rather than the body reference point.
      const P = sys.pos(f.q, sys.attach(j.point, target));
      const r = refPos(i);
      mz -= (P[0] - r[0]) * fy - (P[1] - r[1]) * fx;
      joints.set(j.id, { fx: sign * fx, fy: sign * fy, moment: sign * mz, on: j.b !== GROUND ? j.b : j.a });
    }

    // Driver effort: the generalized force its row applies to the driven body.
    let driver = 0;
    if (driverRow >= 0) {
      const lam = lambda[driverRow]!;
      if (sys.driver!.type === 'rotary') {
        const i = sys.bodyIndex.get(sys.driver!.body)!;
        driver = -J[driverRow]![3 * i + 2]! * lam;
      } else {
        driver = -lam; // force on point A along (A - B): + pushes the ends apart
      }
    }
    const power = driver * rate * toWatts;

    // Virtual-work check: the driver's power balances the power of all other loads.
    let loadPower = 0;
    let scale = Math.abs(driver * rate);
    for (let k = 0; k < n; k++) {
      const term = Q[k]! * f.qd[k]! * rate;
      loadPower += term;
      scale = Math.max(scale, Math.abs(term));
    }
    const balance = scale > 0 ? Math.abs(loadPower + driver * rate) / scale : 0;
    return { joints, driver, power, springs, balance };
  }
}

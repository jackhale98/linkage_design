// World-space force overlay for one frame: applied loads, gravity, joint
// reactions, torques, springs and centres of mass. Pure, for the ForceLayer.

import type { ForceResult } from '../../core/forces/solve';
import { weightPerMass, type ForceUnits, type ForcesData } from '../../core/forces/types';
import type { MotionResult } from '../../core/mechanism/motion';
import type { Frame } from '../../core/mechanism/sweep';
import { GROUND, type Body } from '../../core/mechanism/types';
import { centroid } from '../../core/forces/solve';
import { jointNames } from '../../core/mechanism/names';
import { formatValue } from './format';

type Vec = [number, number];

export interface Arrow {
  key: string;
  at: Vec;
  F: Vec;
  kind: 'applied' | 'gravity' | 'reaction' | 'output';
  label: string;
}

export interface TorqueMark {
  key: string;
  at: Vec;
  T: number;
  kind: 'applied' | 'driver' | 'output';
  label: string;
}

export interface ForceOverlay {
  arrows: Arrow[];
  torques: TorqueMark[];
  springs: { key: string; a: Vec; b: Vec }[];
  coms: Vec[];
  /** Largest force magnitude over the whole sweep (for a stable arrow scale). */
  maxForce: number;
}

const fmt = formatValue;

export function forceOverlay(
  motion: MotionResult,
  bodies: Body[],
  forces: ForcesData,
  result: ForceResult,
  frame: Frame | null,
  index: number,
  units: ForceUnits,
  show: { loads: boolean; reactions: boolean },
): ForceOverlay | null {
  const ff = result.frames[index];
  if (!frame || !ff) return null;
  const { sys, model } = motion;
  const F = units.force;
  const torqueUnit = `${F}·${units.length}`;
  const phi = (b: string) => {
    const i = sys.bodyIndex.get(b);
    return i === undefined ? 0 : frame.q[3 * i + 2]!;
  };
  const pointAt = (p: string, body?: string): Vec | undefined => {
    const b = body ?? (model.groundPoints.has(p) ? GROUND : model.pointBodies.get(p)?.[0]);
    return b === undefined ? undefined : sys.pos(frame.q, sys.attach(p, b));
  };
  const comOf = (b: Body): Vec => {
    const c = centroid(b, model.lineEnds, model.positions);
    return sys.pos(frame.q, sys.attachPosition([b.comX ?? c[0], b.comY ?? c[1]], b.id));
  };

  let maxForce = 1e-12;
  for (const fr of result.frames)
    for (const r of fr.joints.values()) maxForce = Math.max(maxForce, Math.hypot(r.fx, r.fy));

  const arrows: Arrow[] = [];
  const torques: TorqueMark[] = [];
  const springs: ForceOverlay['springs'] = [];
  const coms: Vec[] = [];
  const moving = bodies.filter((b) => sys.bodyIndex.has(b.id));

  if (show.loads) {
    for (const l of forces.loads) {
      if (l.type === 'force') {
        const at = sys.bodyIndex.has(l.body) ? pointAt(l.point, l.body) : undefined;
        if (!at) continue;
        let v: Vec = [l.fx, l.fy];
        if (l.frame === 'body') {
          const a = phi(l.body);
          v = [Math.cos(a) * l.fx - Math.sin(a) * l.fy, Math.sin(a) * l.fx + Math.cos(a) * l.fy];
        }
        arrows.push({ key: l.id, at, F: v, kind: 'applied', label: `${l.id} ${fmt(Math.hypot(...v))} ${F}` });
      } else if (l.type === 'torque') {
        const b = moving.find((x) => x.id === l.body);
        if (b)
          torques.push({
            key: l.id,
            at: comOf(b),
            T: l.torque,
            kind: 'applied',
            label: `${l.id} ${fmt(l.torque)} ${torqueUnit}`,
          });
      } else if (l.type === 'spring') {
        const a = pointAt(l.point);
        const b = pointAt(l.pointB);
        if (a && b) springs.push({ key: l.id, a, b });
      }
    }
    for (const b of moving) {
      if (!b.mass) continue;
      const c = comOf(b);
      coms.push(c);
      if (forces.gravity)
        arrows.push({
          key: `g:${b.id}`,
          at: c,
          F: [0, -b.mass * weightPerMass(units)],
          kind: 'gravity',
          label: '',
        });
    }
  }
  if (show.reactions) {
    const names = jointNames(model);
    for (const j of model.joints) {
      const r = ff.joints.get(j.id);
      const at = r && pointAt(j.point, r.on);
      if (!r || !at || (r.fx === 0 && r.fy === 0)) continue;
      arrows.push({
        key: `r:${j.id}`,
        at,
        F: [r.fx, r.fy],
        kind: 'reaction',
        label: `${names.get(j.id)!.short} ${fmt(Math.hypot(r.fx, r.fy))} ${F}`,
      });
    }
  }
  const d = sys.driver;
  if (d?.type === 'rotary') {
    const pivot = model.joints.find(
      (j) =>
        j.type === 'revolute' &&
        (j.a === d.body || j.b === d.body) &&
        (j.a === d.refBody || j.b === d.refBody),
    );
    const at = pivot && pointAt(pivot.point, d.body);
    if (at)
      torques.push({
        key: 'driver',
        at,
        T: ff.driver,
        kind: 'driver',
        label: `Input ${fmt(ff.driver)} ${torqueUnit}`,
      });
  } else if (d?.type === 'linear') {
    const a = pointAt(d.pointA, d.bodyA);
    const b = pointAt(d.pointB, d.bodyB);
    if (a && b) {
      const len = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const e: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      arrows.push({
        key: 'driver',
        at: b,
        F: [e[0] * ff.driver, e[1] * ff.driver],
        kind: 'applied',
        label: `Actuator ${fmt(ff.driver)} ${F}`,
      });
    }
  }

  // Solving for the output: what it delivers, at the output joint.
  const oj = forces.solveFor === 'output' ? model.joints.find((j) => j.id === forces.outputJoint) : undefined;
  if (oj && Number.isFinite(ff.output)) {
    const body = oj.a === GROUND ? oj.b : oj.a;
    const at = pointAt(oj.point, body);
    if (at && oj.type === 'revolute')
      torques.push({
        key: 'output',
        at,
        T: ff.output,
        kind: 'output',
        label: `Output ${fmt(ff.output)} ${torqueUnit}`,
      });
    else if (at) {
      const [p1, p2] = model.lineEnds.get(oj.line)!;
      const a = model.positions.get(p1)!;
      const b = model.positions.get(p2)!;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const u: Vec = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      arrows.push({
        key: 'output',
        at,
        F: [u[0] * ff.output, u[1] * ff.output],
        kind: 'output',
        label: `Output ${fmt(ff.output)} ${F}`,
      });
    }
  }

  for (const a of arrows) maxForce = Math.max(maxForce, Math.hypot(...a.F));
  return { arrows, torques, springs, coms, maxForce };
}

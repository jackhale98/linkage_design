// World-space force overlay for one frame: applied loads, gravity, joint
// reactions, torques, springs and centres of mass. Pure, for the ForceLayer.

import type { ForceResult } from '../../core/forces/solve';
import { weightPerMass, type ForceUnits, type ForcesData } from '../../core/forces/types';
import type { MotionResult } from '../../core/mechanism/motion';
import type { Frame } from '../../core/mechanism/sweep';
import { GROUND, type Body } from '../../core/mechanism/types';
import { centroid } from '../../core/forces/solve';

type Vec = [number, number];

export interface Arrow {
  key: string;
  at: Vec;
  F: Vec;
  kind: 'applied' | 'gravity' | 'reaction';
  label: string;
}

export interface TorqueMark {
  key: string;
  at: Vec;
  T: number;
  kind: 'applied' | 'driver';
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

/** Formats a value, showing round-off below `noise` as 0. */
const fmt = (v: number, noise = 0) => {
  const a = Math.abs(v);
  if (a <= noise) return '0';
  return a >= 1000 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toPrecision(3);
};

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

  // Sweep-wide scales: values a million times smaller are round-off.
  let maxForce = 1e-12;
  let maxEffort = 0;
  for (const fr of result.frames) {
    for (const r of fr.joints.values()) maxForce = Math.max(maxForce, Math.hypot(r.fx, r.fy));
    maxEffort = Math.max(maxEffort, Math.abs(fr.driver));
  }
  const fNoise = maxForce * 1e-6;
  const eNoise = maxEffort * 1e-6;

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
    for (const j of model.joints) {
      const r = ff.joints.get(j.id);
      const at = r && pointAt(j.point, r.on);
      if (!r || !at) continue;
      arrows.push({
        key: `r:${j.id}`,
        at,
        F: [r.fx, r.fy],
        kind: 'reaction',
        label: `${j.id} ${fmt(Math.hypot(r.fx, r.fy), fNoise)} ${F}`,
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
        label: `Input ${fmt(ff.driver, eNoise)} ${torqueUnit}`,
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
        label: `Actuator ${fmt(ff.driver, eNoise)} ${F}`,
      });
    }
  }

  for (const a of arrows) maxForce = Math.max(maxForce, Math.hypot(...a.F));
  return { arrows, torques, springs, coms, maxForce };
}

// Derived kinematic quantities from a sweep, for plots, summaries and export.
//
// Units: lengths in the project length unit, angles in the project angle
// unit, time in seconds. Velocities and accelerations assume the driver
// moves at constant speed from the sweep start to its end.

import { formatNumber } from '../csv/values';
import type { KinematicSystem } from './kinematics';
import type { Frame, SweepResult } from './sweep';
import { GROUND } from './types';

export interface MotionUnits {
  length: string;
  angle: 'deg' | 'rad';
}

export interface Quantity {
  key: string;
  label: string;
  unit: string;
  group: string;
}

export interface MotionData {
  sys: KinematicSystem;
  res: SweepResult;
  /** Driver input rate in solver units per second (signed: + when moving from start to end). */
  rate: number;
  units: MotionUnits;
}

type Vec = [number, number];

const angleFactor = (u: MotionUnits) => (u.angle === 'deg' ? 180 / Math.PI : 1);

/** Driver speed in solver units per second, from the stored speed (rpm or length/s). */
export function driverRate(type: 'rotary' | 'linear', speed: number, start: number, end: number): number {
  const sign = end >= start ? 1 : -1;
  return sign * Math.abs(type === 'rotary' ? (speed * 2 * Math.PI) / 60 : speed);
}

/** The body a point is reported on (its first moving body, or ground). */
function ownerOf(sys: KinematicSystem, point: string): string {
  if (sys.model.groundPoints.has(point)) return GROUND;
  return sys.model.pointBodies.get(point)?.[0] ?? GROUND;
}

/** Revolute joints between two moving bodies: their included angle is the transmission angle. */
export function angleJoints(sys: KinematicSystem) {
  return sys.model.joints
    .filter((j) => j.type === 'revolute')
    .map((j) => {
      const other = (body: string) => {
        if (body === GROUND) return undefined;
        const b = sys.model.bodies.find((x) => x.id === body);
        return b?.points.find((p) => p !== j.point);
      };
      return { joint: j, pa: other(j.a), pb: other(j.b) };
    })
    .filter((x) => x.pa !== undefined && x.pb !== undefined);
}

export function quantities(sys: KinematicSystem, units: MotionUnits): Quantity[] {
  const L = units.length;
  const A = units.angle === 'deg' ? '°' : 'rad';
  const W = units.angle === 'deg' ? '°/s' : 'rad/s';
  const AL = units.angle === 'deg' ? '°/s²' : 'rad/s²';
  const out: Quantity[] = [];
  const points = [...new Set(sys.model.bodies.flatMap((b) => b.points))].filter(
    (p) => !sys.model.groundPoints.has(p),
  );
  points.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const p of points) {
    const g = `Point ${p}`;
    out.push(
      { key: `p:${p}:x`, label: `${p} x`, unit: L, group: g },
      { key: `p:${p}:y`, label: `${p} y`, unit: L, group: g },
      { key: `p:${p}:v`, label: `${p} speed`, unit: `${L}/s`, group: g },
      { key: `p:${p}:vx`, label: `${p} vx`, unit: `${L}/s`, group: g },
      { key: `p:${p}:vy`, label: `${p} vy`, unit: `${L}/s`, group: g },
      { key: `p:${p}:a`, label: `${p} acceleration`, unit: `${L}/s²`, group: g },
      { key: `p:${p}:ax`, label: `${p} ax`, unit: `${L}/s²`, group: g },
      { key: `p:${p}:ay`, label: `${p} ay`, unit: `${L}/s²`, group: g },
    );
  }
  for (const b of sys.model.bodies) {
    const g = `${b.name} (${b.id})`;
    out.push(
      { key: `b:${b.id}:angle`, label: `${b.name} angle`, unit: A, group: g },
      { key: `b:${b.id}:omega`, label: `${b.name} angular velocity`, unit: W, group: g },
      { key: `b:${b.id}:alpha`, label: `${b.name} angular acceleration`, unit: AL, group: g },
    );
  }
  for (const { joint } of angleJoints(sys)) {
    out.push({
      key: `j:${joint.id}:angle`,
      label: `Joint ${joint.id} angle (at ${joint.point})`,
      unit: A,
      group: 'Joint angles',
    });
  }
  return out;
}

/** Evaluate one quantity at one frame. */
export function evaluate(data: MotionData, f: Frame, key: string): number {
  const { sys, rate, units } = data;
  const [kind, id, what] = key.split(':') as [string, string, string];
  const k = angleFactor(units);
  if (kind === 'p') {
    const a = sys.attach(id, ownerOf(sys, id));
    if (what === 'x' || what === 'y') return sys.pos(f.q, a)[what === 'x' ? 0 : 1];
    if (what.startsWith('v')) {
      const v = sys.vel(f.q, f.qd, a);
      const vx = v[0] * rate;
      const vy = v[1] * rate;
      return what === 'vx' ? vx : what === 'vy' ? vy : Math.hypot(vx, vy);
    }
    const acc = sys.acc(f.q, f.qd, f.qdd, a);
    const ax = acc[0] * rate * rate;
    const ay = acc[1] * rate * rate;
    return what === 'ax' ? ax : what === 'ay' ? ay : Math.hypot(ax, ay);
  }
  if (kind === 'b') {
    const i = sys.bodyIndex.get(id);
    if (i === undefined) return NaN;
    if (what === 'angle') {
      const b = sys.model.bodies[i]!;
      const ends = sys.model.lineEnds.get(b.lines[0]!)!;
      const pa = sys.pos(f.q, sys.attach(ends[0], b.id));
      const pb = sys.pos(f.q, sys.attach(ends[1], b.id));
      return Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * k;
    }
    if (what === 'omega') return f.qd[3 * i + 2]! * rate * k;
    return f.qdd[3 * i + 2]! * rate * rate * k;
  }
  if (kind === 'j') {
    const aj = angleJoints(sys).find((x) => x.joint.id === id);
    if (!aj) return NaN;
    const at = sys.pos(f.q, sys.attach(aj.joint.point, aj.joint.a));
    const pa = sys.pos(f.q, sys.attach(aj.pa!, aj.joint.a));
    const pb = sys.pos(f.q, sys.attach(aj.pb!, aj.joint.b));
    const u: Vec = [pa[0] - at[0], pa[1] - at[1]];
    const v: Vec = [pb[0] - at[0], pb[1] - at[1]];
    const c = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
    return Math.acos(Math.max(-1, Math.min(1, c))) * k;
  }
  return NaN;
}

/** Reachable frames in sweep order. */
export function reachable(res: SweepResult): Frame[] {
  return res.frames.filter((f): f is Frame => f !== null);
}

/** Driver input in user units. */
export function inputValue(data: MotionData, f: Frame): number {
  return data.sys.driver?.type === 'rotary' ? f.t * angleFactor(data.units) : f.t;
}

/** Time (s) since the first reachable frame. */
export function timeOf(data: MotionData, f: Frame): number {
  const first = reachable(data.res)[0];
  if (!first || data.rate === 0) return 0;
  return (f.t - first.t) / data.rate;
}

/** Unwrap angle jumps of 360 degrees (2 pi) in a series. */
export function unwrap(values: number[], period: number): number[] {
  const out = values.slice();
  for (let k = 1; k < out.length; k++) {
    const d = out[k]! - out[k - 1]!;
    if (d > period / 2) for (let j = k; j < out.length; j++) out[j]! -= period;
    else if (d < -period / 2) for (let j = k; j < out.length; j++) out[j]! += period;
  }
  return out;
}

export function series(data: MotionData, key: string): number[] {
  const vals = reachable(data.res).map((f) => evaluate(data, f, key));
  return key.endsWith(':angle') && key.startsWith('b:')
    ? unwrap(vals, data.units.angle === 'deg' ? 360 : 2 * Math.PI)
    : vals;
}

// ---------------------------------------------------------------- summary

export interface GrashofResult {
  type: 'crank-rocker' | 'double-crank' | 'double-rocker' | 'change-point' | 'triple-rocker';
  text: string;
  lengths: { ground: number; crank: number; coupler: number; rocker: number };
}

/** Grashof classification, if the mechanism is a four-bar with a driven ground-pivoted crank. */
export function grashof(sys: KinematicSystem): GrashofResult | null {
  const m = sys.model;
  if (m.bodies.length !== 3 || m.joints.length !== 4 || m.joints.some((j) => j.type !== 'revolute'))
    return null;
  const groundPivots = m.joints.filter((j) => j.a === GROUND || j.b === GROUND);
  if (groundPivots.length !== 2) return null;
  const pos = (p: string) => m.positions.get(p)!;
  const len = (a: string, b: string) => Math.hypot(pos(a)[0] - pos(b)[0], pos(a)[1] - pos(b)[1]);
  // Each link's kinematic length runs between its two joints (a coupler may be a plate with more points).
  const jointPoints = (id: string) => m.joints.filter((j) => j.a === id || j.b === id).map((j) => j.point);
  if (m.bodies.some((b) => jointPoints(b.id).length !== 2)) return null;
  const ground = len(groundPivots[0]!.point, groundPivots[1]!.point);
  const bodyLen = (id: string) => {
    const [p, q] = jointPoints(id);
    return len(p!, q!);
  };
  const crankId = m.driver?.type === 'rotary' && m.driver.refBody === GROUND ? m.driver.body : undefined;
  const grounded = groundPivots.map((j) => (j.a === GROUND ? j.b : j.a));
  const crank = crankId && grounded.includes(crankId) ? crankId : grounded[0]!;
  const rocker = grounded.find((b) => b !== crank)!;
  const coupler = m.bodies.find((b) => b.id !== crank && b.id !== rocker)!.id;
  const L = { ground, crank: bodyLen(crank), coupler: bodyLen(coupler), rocker: bodyLen(rocker) };
  const all = [L.ground, L.crank, L.coupler, L.rocker];
  const sorted = [...all].sort((a, b) => a - b);
  const sl = sorted[0]! + sorted[3]!;
  const pq = sorted[1]! + sorted[2]!;
  if (Math.abs(sl - pq) <= 1e-6 * sorted[3]!)
    return {
      type: 'change-point',
      text: 'Change-point (S + L = P + Q): passes through flat positions where motion is undefined',
      lengths: L,
    };
  if (sl > pq)
    return { type: 'triple-rocker', text: 'Non-Grashof triple rocker: no link can turn fully', lengths: L };
  const shortest = sorted[0]!;
  if (L.ground === shortest)
    return {
      type: 'double-crank',
      text: 'Grashof double-crank (drag link): both grounded links turn fully',
      lengths: L,
    };
  if (L.coupler === shortest)
    return { type: 'double-rocker', text: 'Grashof double-rocker: only the coupler turns fully', lengths: L };
  const which = L.crank === shortest ? 'the crank' : 'the rocker';
  return { type: 'crank-rocker', text: `Grashof crank-rocker: ${which} turns fully`, lengths: L };
}

export interface MotionSummary {
  rangeText: string;
  fullRotation: boolean;
  limits: { start?: number; end?: number };
  cycleTime?: number;
  grashof: GrashofResult | null;
  jointAngles: { id: string; point: string; min: number; max: number; worst: number }[];
  extremes: { key: string; label: string; unit: string; max: number }[];
}

export function summarize(data: MotionData, tracePoints: string[]): MotionSummary {
  const { res, units, sys } = data;
  const k = sys.driver?.type === 'rotary' ? angleFactor(units) : 1;
  const unit = sys.driver?.type === 'rotary' ? (units.angle === 'deg' ? '°' : ' rad') : ` ${units.length}`;
  const fmt = (v: number) => `${Number((v * k).toFixed(3))}${unit}`;
  const frames = reachable(res);
  let rangeText = 'No motion';
  if (res.fullRotation) rangeText = 'Turns a full revolution';
  else if (frames.length) {
    const lo = frames[0]!.t;
    const hi = frames[frames.length - 1]!.t;
    rangeText = `Moves from ${fmt(lo)} to ${fmt(hi)}`;
    const notes = [
      res.limits.start !== undefined ? `limit at ${fmt(res.limits.start)}` : '',
      res.limits.end !== undefined ? `limit at ${fmt(res.limits.end)}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    if (notes) rangeText += ` (${notes})`;
  }
  const cycleTime =
    frames.length > 1 && data.rate
      ? Math.abs((frames[frames.length - 1]!.t - frames[0]!.t) / data.rate)
      : undefined;

  // The angle at a joint on the driven link sweeps freely; it isn't a transmission angle.
  const driven = sys.driver?.type === 'rotary' ? sys.driver.body : undefined;
  const jointAngles = angleJoints(sys)
    .filter(({ joint }) => joint.a !== driven && joint.b !== driven)
    .map(({ joint }) => {
      const s = series(data, `j:${joint.id}:angle`);
      const right = units.angle === 'deg' ? 90 : Math.PI / 2;
      const min = Math.min(...s);
      const max = Math.max(...s);
      return {
        id: joint.id,
        point: joint.point,
        min,
        max,
        worst: Math.max(...s.map((v) => Math.abs(v - right))),
      };
    });

  const qs = quantities(sys, units);
  const extremes = tracePoints.flatMap((p) =>
    ['v', 'a']
      .map((w) => qs.find((q) => q.key === `p:${p}:${w}`))
      .filter((q): q is Quantity => !!q)
      .map((q) => ({ key: q.key, label: q.label, unit: q.unit, max: Math.max(...series(data, q.key)) })),
  );
  return {
    rangeText,
    fullRotation: res.fullRotation,
    limits: res.limits,
    cycleTime,
    grashof: grashof(sys),
    jointAngles,
    extremes,
  };
}

/** Kinematics table for CSV export: one row per reachable frame. */
export function resultsTable(data: MotionData): string[][] {
  const qs = quantities(data.sys, data.units);
  const inputUnit =
    data.sys.driver?.type === 'rotary' ? (data.units.angle === 'deg' ? 'deg' : 'rad') : data.units.length;
  const unitLabel = (u: string) => u.replace('°', 'deg').replace('²', '^2');
  const header = [
    'input [' + inputUnit + ']',
    'time [s]',
    ...qs.map((q) => `${q.label.replace(/\s+/g, '_')} [${unitLabel(q.unit)}]`),
  ];
  const cols = qs.map((q) => series(data, q.key));
  const frames = reachable(data.res);
  const rows = frames.map((f, i) => [
    formatNumber(inputValue(data, f)),
    formatNumber(timeOf(data, f)),
    ...cols.map((c) => formatNumber(c[i]!)),
  ]);
  return [header, ...rows];
}

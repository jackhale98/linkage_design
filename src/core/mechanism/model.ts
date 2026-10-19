// From sketch + mechanism data to a kinematic model.
//
// - Bodies are groups of sketch lines. Any non-construction line not in a
//   body becomes its own body (a binary link) when the data is synced.
// - Ground is every fixed point, every point of a construction line connected
//   (through other construction lines) to a fixed point, and every point of a
//   body marked ground. A body touching two or more ground points is locked
//   to ground.
// - Joints: a revolute wherever two bodies (or a body and ground) share a
//   point; a pin-in-slot wherever a sketch point_on_line constraint ties a
//   point of one body to a line of another (a slider when its record says so).
// - The driver is the one input that moves the mechanism.

import type { Sketch } from '../sketch/types';
import { BODY_COLORS, GROUND, type Body, type DriverSpec, type JointType, type MechanismData } from './types';

export interface MBody {
  id: string;
  name: string;
  color: string;
  lines: string[];
  points: string[];
}

export interface MJoint {
  id: string;
  type: JointType;
  point: string;
  line: string;
  /** Body carrying the slot line (or the first body for revolutes); GROUND for ground. */
  a: string;
  b: string;
}

export type ResolvedDriver =
  | {
      type: 'rotary';
      line: string;
      lineRef: string;
      body: string;
      refBody: string;
      /** Design value of the input (radians): angle(line) - angle(lineRef). */
      t0: number;
    }
  | { type: 'linear'; pointA: string; pointB: string; bodyA: string; bodyB: string; t0: number };

export interface MechanismIssue {
  severity: 'error' | 'warning';
  message: string;
}

export interface MechanismModel {
  /** Moving bodies. */
  bodies: MBody[];
  groundPoints: Set<string>;
  /** Lines that belong to ground. */
  groundLines: Set<string>;
  /** For each point, the moving bodies it belongs to. */
  pointBodies: Map<string, string[]>;
  joints: MJoint[];
  driver: ResolvedDriver | null;
  /** The actuator line of a linear driver (not part of any body). */
  actuatorLine: string | null;
  issues: MechanismIssue[];
  positions: Map<string, [number, number]>;
  /** End points of every sketch line. */
  lineEnds: Map<string, [string, string]>;
}

function lineEnds(sketch: Sketch): Map<string, [string, string]> {
  return new Map(sketch.lines.map((l) => [l.id, [l.p1, l.p2]]));
}

/** The line joining two points, if any. */
function lineBetween(sketch: Sketch, a: string, b: string): string | undefined {
  return sketch.lines.find((l) => (l.p1 === a && l.p2 === b) || (l.p1 === b && l.p2 === a))?.id;
}

function actuatorLineOf(sketch: Sketch, driver: DriverSpec): string | null {
  if (driver.type !== 'linear' || !driver.pointA || !driver.pointB) return null;
  return lineBetween(sketch, driver.pointA, driver.pointB) ?? null;
}

/** Construction lines connected to fixed points (the drawn "ground" geometry). */
function groundConstruction(sketch: Sketch, exclude: string | null): Set<string> {
  const fixed = new Set(sketch.points.filter((p) => p.fixed).map((p) => p.id));
  const reached = new Set(fixed);
  const lines = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of sketch.lines) {
      if (!l.construction || l.id === exclude || lines.has(l.id)) continue;
      if (reached.has(l.p1) || reached.has(l.p2)) {
        lines.add(l.id);
        reached.add(l.p1);
        reached.add(l.p2);
        grew = true;
      }
    }
  }
  return lines;
}

function nextBodyId(bodies: Body[]): string {
  let max = 0;
  for (const b of bodies) {
    const m = /^B(\d+)$/.exec(b.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `B${max + 1}`;
}

/**
 * Bring stored bodies and joints in line with the sketch: drop missing lines
 * and empty bodies, give every unassigned non-construction line its own body,
 * and refresh the joint list (keeping IDs and types of joints that still exist).
 * Idempotent.
 */
export function syncMechanism(sketch: Sketch, mech: MechanismData): void {
  const ends = lineEnds(sketch);
  const actuator = actuatorLineOf(sketch, mech.driver);
  const groundCons = groundConstruction(sketch, actuator);

  for (const b of mech.bodies) b.lines = b.lines.filter((l) => ends.has(l) && l !== actuator);
  // A line may belong to one body only: first claim wins.
  const claimed = new Set<string>();
  for (const b of mech.bodies) {
    b.lines = b.lines.filter((l) => !claimed.has(l));
    b.lines.forEach((l) => claimed.add(l));
  }
  mech.bodies = mech.bodies.filter((b) => b.lines.length > 0);

  for (const l of sketch.lines) {
    if (l.construction || claimed.has(l.id) || l.id === actuator || groundCons.has(l.id)) continue;
    const id = nextBodyId(mech.bodies);
    const n = mech.bodies.length;
    mech.bodies.push({
      id,
      name: `Link ${id.slice(1)}`,
      lines: [l.id],
      ground: false,
      color: BODY_COLORS[n % BODY_COLORS.length]!,
      extras: {},
    });
    claimed.add(l.id);
  }

  mech.motion.trace = mech.motion.trace.filter((p) => sketch.points.some((x) => x.id === p));

  const model = buildModel(sketch, mech);
  const stored = new Map(mech.joints.map((j) => [jointKey(j.point, j.line, j.bodyA, j.bodyB), j]));
  let max = 0;
  for (const j of mech.joints) {
    const m = /^J(\d+)$/.exec(j.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  mech.joints = model.joints.map((j) => {
    const prev = stored.get(jointKey(j.point, j.line, j.a, j.b));
    const type: JointType =
      j.type === 'revolute' ? 'revolute' : prev?.type === 'slider' ? 'slider' : 'pin_in_slot';
    return {
      id: prev?.id ?? `J${++max}`,
      type,
      point: j.point,
      line: j.line,
      bodyA: j.a,
      bodyB: j.b,
      extras: prev?.extras ?? {},
    };
  });
}

function jointKey(point: string, line: string, a: string, b: string): string {
  return line ? `${point}|${line}|${a}|${b}` : `${point}|${[a, b].sort().join('|')}`;
}

/** Derive the kinematic model. Does not modify its inputs. */
export function buildModel(sketch: Sketch, mech: MechanismData): MechanismModel {
  const issues: MechanismIssue[] = [];
  const ends = lineEnds(sketch);
  const positions = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as [number, number]]));
  const actuator = actuatorLineOf(sketch, mech.driver);
  const groundLines = groundConstruction(sketch, actuator);
  const groundPoints = new Set(sketch.points.filter((p) => p.fixed).map((p) => p.id));
  for (const l of groundLines) ends.get(l)!.forEach((p) => groundPoints.add(p));

  const bodyPoints = (b: Body) => [...new Set(b.lines.flatMap((l) => ends.get(l) ?? []))];
  let candidates = mech.bodies.filter((b) => b.lines.some((l) => ends.has(l)));

  // Bodies marked ground, or locked by two ground points, join ground (repeat until stable).
  for (let changed = true; changed;) {
    changed = false;
    candidates = candidates.filter((b) => {
      const pts = bodyPoints(b);
      const locked = b.ground || pts.filter((p) => groundPoints.has(p)).length >= 2;
      if (!locked) return true;
      pts.forEach((p) => groundPoints.add(p));
      b.lines.forEach((l) => groundLines.add(l));
      changed = true;
      return false;
    });
  }

  const bodies: MBody[] = candidates.map((b) => ({
    id: b.id,
    name: b.name,
    color: b.color,
    lines: b.lines.filter((l) => ends.has(l)),
    points: bodyPoints(b),
  }));
  const pointBodies = new Map<string, string[]>();
  for (const b of bodies) for (const p of b.points) pointBodies.set(p, [...(pointBodies.get(p) ?? []), b.id]);
  const lineBody = new Map<string, string>();
  for (const b of bodies) for (const l of b.lines) lineBody.set(l, b.id);
  for (const l of groundLines) lineBody.set(l, GROUND);

  // ---------------------------------------------------------------- joints
  const joints: MJoint[] = [];
  const stored = new Map(mech.joints.map((j) => [jointKey(j.point, j.line, j.bodyA, j.bodyB), j]));
  const idFor = (key: string) => stored.get(key)?.id ?? '';
  for (const [p, bs] of pointBodies) {
    const members = groundPoints.has(p) ? [GROUND, ...bs] : bs;
    for (let k = 1; k < members.length; k++) {
      const a = members[0]!;
      const b = members[k]!;
      joints.push({ id: idFor(jointKey(p, '', a, b)), type: 'revolute', point: p, line: '', a, b });
    }
  }
  for (const c of sketch.constraints) {
    if (c.type !== 'point_on_line' || c.reference) continue;
    const [p, l] = c.refs as [string, string];
    const lb = lineBody.get(l);
    if (!lb) continue;
    const owners = groundPoints.has(p) ? [GROUND] : (pointBodies.get(p) ?? []);
    for (const pb of owners) {
      if (pb === lb) continue;
      const key = jointKey(p, l, lb, pb);
      const type: JointType = stored.get(key)?.type === 'slider' ? 'slider' : 'pin_in_slot';
      joints.push({ id: idFor(key), type, point: p, line: l, a: lb, b: pb });
    }
  }

  // ---------------------------------------------------------------- driver
  const bodyOfLine = (l: string) => lineBody.get(l);
  const ownerOfPoint = (p: string) => (groundPoints.has(p) ? GROUND : pointBodies.get(p)?.[0]);
  const angleOf = (l: string) => {
    const [a, b] = ends.get(l)!;
    const pa = positions.get(a)!;
    const pb = positions.get(b)!;
    return Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);
  };
  let driver: ResolvedDriver | null = null;
  const d = mech.driver;
  if (d.type === 'rotary') {
    const body = d.line ? bodyOfLine(d.line) : undefined;
    const refBody = d.lineRef ? bodyOfLine(d.lineRef) : GROUND;
    if (!d.line || !ends.has(d.line))
      issues.push({ severity: 'error', message: 'The driver line no longer exists' });
    else if (!body || body === GROUND)
      issues.push({ severity: 'error', message: `The driver line ${d.line} must belong to a moving link` });
    else if (!refBody)
      issues.push({
        severity: 'error',
        message: `The driver's reference line ${d.lineRef} isn't part of a link or ground`,
      });
    else if (refBody === body)
      issues.push({ severity: 'error', message: 'The driver line and its reference are on the same link' });
    else
      driver = {
        type: 'rotary',
        line: d.line,
        lineRef: d.lineRef,
        body,
        refBody,
        t0: angleOf(d.line) - (d.lineRef ? angleOf(d.lineRef) : 0),
      };
  } else if (d.type === 'linear') {
    const ba = ownerOfPoint(d.pointA);
    const bb = ownerOfPoint(d.pointB);
    if (!positions.has(d.pointA) || !positions.has(d.pointB))
      issues.push({ severity: 'error', message: 'An actuator end point no longer exists' });
    else if (!ba || !bb)
      issues.push({ severity: 'error', message: 'Both actuator ends must be on links or ground' });
    else if (
      ba === bb &&
      (ba === GROUND ||
        (pointBodies.get(d.pointA) ?? []).some((x) => (pointBodies.get(d.pointB) ?? []).includes(x)))
    )
      issues.push({
        severity: 'error',
        message: 'The actuator ends are on the same link, so it cannot move',
      });
    else {
      const pa = positions.get(d.pointA)!;
      const pb = positions.get(d.pointB)!;
      driver = {
        type: 'linear',
        pointA: d.pointA,
        pointB: d.pointB,
        bodyA: ba,
        bodyB: bb,
        t0: Math.hypot(pb[0] - pa[0], pb[1] - pa[1]),
      };
    }
  }

  if (bodies.length === 0)
    issues.push({
      severity: 'warning',
      message: 'No moving links yet: draw lines in the sketch and fix at least one ground point',
    });
  else if (groundPoints.size === 0)
    issues.push({
      severity: 'warning',
      message: 'Nothing is grounded: fix at least one point (a ground pivot) in the sketch',
    });

  return {
    bodies,
    groundPoints,
    groundLines,
    pointBodies,
    joints,
    driver,
    actuatorLine: actuator,
    issues,
    positions,
    lineEnds: lineEnds(sketch),
  };
}

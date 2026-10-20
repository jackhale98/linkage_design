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
//   If the line is on a moving link and the sketch also fixes where the point
//   sits along it (a distance to a point of that link, or a midpoint), the
//   point can't slide: it is a pivot partway along the link, so the joint is
//   a revolute. (On a ground slide such a dimension just sets the drawn pose.)
// - The driver is the one input that moves the mechanism.

import type { Sketch } from '../sketch/types';
import { camPitchCurve, type PitchCurve } from '../cam/analysis';
import { fitMountAngle } from '../cam/curve';
import type { CamData } from '../cam/types';
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
  /** Cam and gear joints, resolved against the mechanism. */
  pairs: MPair[];
  /** Display name of every point: its sketch label, else its ID (unique). */
  pointNames: Map<string, string>;
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
export type MPair =
  | {
      id: string;
      type: 'gear';
      a: string;
      b: string;
      /** The link both gear centres pivot on (ground, or an arm). */
      carrier: string;
      pa: string;
      pb: string;
      /** Pitch radii, from the drawn centre distance split by the tooth counts. */
      ra: number;
      rb: number;
      za: number;
      zb: number;
      /** Pressure angle (rad). */
      pressure: number;
    }
  | {
      id: string;
      type: 'rack';
      /** Pinion link, pivoting on ground at pa. */
      a: string;
      /** Rack link. */
      b: string;
      pa: string;
      line: string;
      /** Pinion pitch radius: centre to the rack's pitch line. */
      r: number;
      za: number;
      /** Unit vector from the pinion centre to the pitch line, and the rack's direction of travel (normal turned +90°). */
      n: [number, number];
      e: [number, number];
      /** Pitch point at the drawn pose. */
      pitch: [number, number];
      pressure: number;
    }
  | {
      id: string;
      type: 'cam';
      camId: string;
      /** Cam link (or ground) and the cam centre on it. */
      a: string;
      pa: string;
      /** Follower link and the roller centre on it. */
      b: string;
      pb: string;
      /** Cam frame orientation at the drawn pose (rad). */
      alpha: number;
      curve: PitchCurve;
    };

export function buildModel(sketch: Sketch, mech: MechanismData, cams: CamData[] = []): MechanismModel {
  const issues: MechanismIssue[] = [];
  const ends = lineEnds(sketch);
  const positions = new Map(sketch.points.map((p) => [p.id, [p.x, p.y] as [number, number]]));
  const pointNames = displayNames(sketch);
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
  const pointsOfBody = (b: string) =>
    b === GROUND ? groundPoints : new Set(bodies.find((x) => x.id === b)?.points ?? []);
  /** The sketch fixes where p sits along line l (of body lb). */
  const located = (p: string, l: string, lb: string) => {
    const on = pointsOfBody(lb);
    return sketch.constraints.some(
      (c) =>
        !c.reference &&
        ((c.type === 'midpoint' && c.refs[0] === p && c.refs[1] === l) ||
          (c.type === 'distance' &&
            c.refs.length === 2 &&
            c.refs.includes(p) &&
            c.refs.some((q) => q !== p && on.has(q)))),
    );
  };
  for (const c of sketch.constraints) {
    if (c.type !== 'point_on_line' || c.reference) continue;
    const [p, l] = c.refs as [string, string];
    const lb = lineBody.get(l);
    if (!lb) continue;
    const owners = groundPoints.has(p) ? [GROUND] : (pointBodies.get(p) ?? []);
    // On a moving link, a dimensioned point is a pivot partway along it. On a
    // ground slide, a dimension only sets where the slider is drawn.
    const pinned = lb !== GROUND && located(p, l, lb);
    // Links pinned together at p ride in the slot once (more would be
    // redundant): prefer the one with another point on the line, the block.
    const others = owners.filter((b) => b !== lb);
    const onLine = (b: string) =>
      sketch.constraints.some(
        (k) =>
          k.type === 'point_on_line' &&
          !k.reference &&
          k.refs[1] === l &&
          k.refs[0] !== p &&
          pointsOfBody(b).has(k.refs[0]!),
      );
    const rider = owners.includes(lb) ? undefined : (others.find(onLine) ?? others[0]);
    for (const pb of rider ? [rider] : []) {
      if (pinned) {
        joints.push({
          id: idFor(jointKey(p, '', lb, pb)),
          type: 'revolute',
          point: p,
          line: '',
          a: lb,
          b: pb,
        });
        continue;
      }
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

  const pairs = resolvePairs(
    mech,
    cams,
    { bodies, joints, groundPoints, positions, lineEnds: lineEnds(sketch) },
    issues,
  );

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
    pairs,
    driver,
    actuatorLine: actuator,
    issues,
    positions,
    pointNames,
    lineEnds: lineEnds(sketch),
  };
}

/** Labels where they are unique and don't clash with an ID; IDs otherwise. */
function displayNames(sketch: Sketch): Map<string, string> {
  const ids = new Set(sketch.points.map((p) => p.id));
  const count = new Map<string, number>();
  for (const p of sketch.points) if (p.label) count.set(p.label, (count.get(p.label) ?? 0) + 1);
  return new Map(
    sketch.points.map((p) => {
      const ok = p.label && count.get(p.label) === 1 && (!ids.has(p.label) || p.label === p.id);
      return [p.id, ok ? p.label : p.label ? `${p.label} (${p.id})` : p.id];
    }),
  );
}

/** Check each cam and gear joint against the mechanism and work out its geometry. */
function resolvePairs(
  mech: MechanismData,
  cams: CamData[],
  m: {
    bodies: MBody[];
    joints: MJoint[];
    groundPoints: Set<string>;
    positions: Map<string, [number, number]>;
    lineEnds: Map<string, [string, string]>;
  },
  issues: MechanismIssue[],
): MPair[] {
  const out: MPair[] = [];
  const err = (id: string, message: string) =>
    issues.push({ severity: 'error', message: `${id}: ${message}` });
  const isBody = (b: string) => b === GROUND || m.bodies.some((x) => x.id === b);
  const onBody = (b: string, p: string) =>
    b === GROUND ? m.groundPoints.has(p) : !!m.bodies.find((x) => x.id === b)?.points.includes(p);
  const pos = (p: string) => m.positions.get(p);
  /** Links a body pivots on at a point (other side of its revolutes there). */
  const pivots = (b: string, p: string) =>
    m.joints
      .filter((j) => j.type === 'revolute' && j.point === p && (j.a === b || j.b === b))
      .map((j) => (j.a === b ? j.b : j.a));

  for (const r of mech.pairs) {
    if (!isBody(r.bodyA) || !isBody(r.bodyB)) {
      err(r.id, 'its links no longer exist');
      continue;
    }
    if (r.bodyA === r.bodyB) {
      err(r.id, 'needs two different links');
      continue;
    }
    const A = pos(r.pointA);
    if (!A || !onBody(r.bodyA, r.pointA)) {
      err(r.id, `point ${r.pointA} isn't on ${r.bodyA}`);
      continue;
    }
    const pressure = (r.pressure * Math.PI) / 180;
    if (r.type === 'gear') {
      const B = pos(r.pointB);
      if (!B || !onBody(r.bodyB, r.pointB)) {
        err(r.id, `point ${r.pointB} isn't on ${r.bodyB}`);
        continue;
      }
      const carriers = pivots(r.bodyA, r.pointA).filter((c) => pivots(r.bodyB, r.pointB).includes(c));
      if (r.bodyA === GROUND || r.bodyB === GROUND || !carriers.length) {
        err(r.id, 'both gears must turn on pivots at their centres, on the same link (ground or an arm)');
        continue;
      }
      const d = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (!(d > 0)) {
        err(r.id, 'the gear centres coincide');
        continue;
      }
      const ra = (d * r.teethA) / (r.teethA + r.teethB);
      out.push({
        id: r.id,
        type: 'gear',
        a: r.bodyA,
        b: r.bodyB,
        carrier: carriers[0]!,
        pa: r.pointA,
        pb: r.pointB,
        ra,
        rb: d - ra,
        za: r.teethA,
        zb: r.teethB,
        pressure,
      });
    } else if (r.type === 'rack') {
      const ends = m.lineEnds.get(r.line);
      const body = m.bodies.find((x) => x.id === r.bodyB);
      if (!ends || !body?.lines.includes(r.line)) {
        err(r.id, `pitch line ${r.line} isn't a line of the rack ${r.bodyB}`);
        continue;
      }
      if (!pivots(r.bodyA, r.pointA).includes(GROUND)) {
        err(r.id, 'the pinion must turn on a ground pivot at its centre');
        continue;
      }
      const L0 = pos(ends[0])!;
      const L1 = pos(ends[1])!;
      const len = Math.hypot(L1[0] - L0[0], L1[1] - L0[1]) || 1;
      const u: [number, number] = [(L1[0] - L0[0]) / len, (L1[1] - L0[1]) / len];
      const t = (A[0] - L0[0]) * u[0] + (A[1] - L0[1]) * u[1];
      const foot: [number, number] = [L0[0] + t * u[0], L0[1] + t * u[1]];
      const rr = Math.hypot(foot[0] - A[0], foot[1] - A[1]);
      if (!(rr > 0)) {
        err(r.id, 'the pinion centre is on the pitch line');
        continue;
      }
      const n: [number, number] = [(foot[0] - A[0]) / rr, (foot[1] - A[1]) / rr];
      out.push({
        id: r.id,
        type: 'rack',
        a: r.bodyA,
        b: r.bodyB,
        pa: r.pointA,
        line: r.line,
        r: rr,
        za: r.teethA,
        n,
        e: [-n[1], n[0]],
        pitch: foot,
        pressure,
      });
    } else {
      const B = pos(r.pointB);
      if (!B || !onBody(r.bodyB, r.pointB)) {
        err(r.id, `point ${r.pointB} isn't on ${r.bodyB}`);
        continue;
      }
      const cam = cams.find((c) => c.id === r.cam);
      if (!cam) {
        err(r.id, `cam ${r.cam || '(none)'} doesn't exist; design it in the Cam workspace`);
        continue;
      }
      const curve = camPitchCurve(cam);
      if ('message' in curve) {
        err(r.id, curve.message);
        continue;
      }
      const D: [number, number] = [B[0] - A[0], B[1] - A[1]];
      const alpha = r.angle !== undefined ? (r.angle * Math.PI) / 180 : fitMountAngle(curve, D);
      if (alpha === null) {
        err(
          r.id,
          `the roller at ${r.pointB} can't touch ${cam.id} at its drawn distance from the cam centre`,
        );
        continue;
      }
      out.push({
        id: r.id,
        type: 'cam',
        camId: cam.id,
        a: r.bodyA,
        pa: r.pointA,
        b: r.bodyB,
        pb: r.pointB,
        alpha,
        curve,
      });
    }
  }
  return out;
}

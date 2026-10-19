// Mechanism edits. Each mutates the data in place and re-syncs with the sketch.

import type { Sketch, SketchConstraint } from '../sketch/types';
import { syncMechanism } from './model';
import type { DriverSpec, JointType, MechanismData } from './types';

/** Merge bodies into the first one (a single rigid link). */
export function mergeBodies(sketch: Sketch, mech: MechanismData, ids: string[]): boolean {
  const bodies = ids.map((id) => mech.bodies.find((b) => b.id === id)).filter((b) => b !== undefined);
  if (bodies.length < 2) return false;
  const [keep, ...rest] = bodies;
  keep!.lines = [...keep!.lines, ...rest.flatMap((b) => b!.lines)];
  keep!.ground = bodies.some((b) => b!.ground);
  mech.bodies = mech.bodies.filter((b) => !rest.includes(b));
  syncMechanism(sketch, mech);
  return true;
}

/** Split a multi-line body back into one link per line. */
export function splitBody(sketch: Sketch, mech: MechanismData, id: string): boolean {
  const b = mech.bodies.find((x) => x.id === id);
  if (!b || b.lines.length < 2) return false;
  b.lines = b.lines.slice(0, 1);
  syncMechanism(sketch, mech);
  return true;
}

export function updateBody(
  sketch: Sketch,
  mech: MechanismData,
  id: string,
  patch: Partial<{ name: string; color: string; ground: boolean }>,
): boolean {
  const b = mech.bodies.find((x) => x.id === id);
  if (!b) return false;
  Object.assign(b, patch);
  syncMechanism(sketch, mech);
  return true;
}

export function setDriver(sketch: Sketch, mech: MechanismData, patch: Partial<DriverSpec>): void {
  const typeChanged = patch.type !== undefined && patch.type !== mech.driver.type;
  mech.driver = { ...mech.driver, ...patch };
  // A new driver type means the old range no longer applies.
  if (typeChanged && patch.start === undefined) delete mech.driver.start;
  if (typeChanged && patch.end === undefined) delete mech.driver.end;
  if (typeChanged && patch.speed === undefined) mech.driver.speed = mech.driver.type === 'linear' ? 10 : 60;
  syncMechanism(sketch, mech);
}

export function setJointType(sketch: Sketch, mech: MechanismData, id: string, type: JointType): boolean {
  const j = mech.joints.find((x) => x.id === id);
  if (!j || j.type === 'revolute' || type === 'revolute' || j.type === type) return false;
  j.type = type;
  syncMechanism(sketch, mech);
  return true;
}

export function setTrace(mech: MechanismData, point: string, on: boolean): boolean {
  const has = mech.motion.trace.includes(point);
  if (has === on) return false;
  mech.motion.trace = on ? [...mech.motion.trace, point] : mech.motion.trace.filter((p) => p !== point);
  return true;
}

/**
 * A driver that varies a sketch dimension: a line's angle (from +x or from
 * another line) or the distance between two points / a line's length.
 */
export function driverFromDimension(sketch: Sketch, c: SketchConstraint): Partial<DriverSpec> | null {
  const line = (id: string) => sketch.lines.find((l) => l.id === id);
  if (c.type === 'angle') {
    if (!line(c.refs[0]!)) return null;
    // Two-line angles are measured from line a to line b, so line b is driven.
    return c.refs.length === 2
      ? { type: 'rotary', line: c.refs[1]!, lineRef: c.refs[0]!, start: undefined, end: undefined }
      : { type: 'rotary', line: c.refs[0]!, lineRef: '', start: undefined, end: undefined };
  }
  if (c.type === 'distance') {
    if (c.refs.length === 1) {
      const l = line(c.refs[0]!);
      return l ? { type: 'linear', pointA: l.p1, pointB: l.p2, start: undefined, end: undefined } : null;
    }
    const [a, b] = c.refs;
    if (sketch.points.some((p) => p.id === a) && sketch.points.some((p) => p.id === b))
      return { type: 'linear', pointA: a!, pointB: b!, start: undefined, end: undefined };
  }
  return null;
}

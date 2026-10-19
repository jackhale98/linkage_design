// Human-readable names for points, links and joints, so results can say
// "A: Crank – Coupler" rather than "J9 at P3".

import type { MechanismModel, MJoint } from './model';
import { GROUND } from './types';

export interface JointName {
  /** Where it is: the point's name, plus the second link when several joints share the point. */
  short: string;
  /** What it joins, e.g. "Crank – Coupler" or "Link 4 in Link 6 slot". */
  links: string;
  /** Both, e.g. "A: Crank – Coupler". */
  long: string;
}

export function pointName(model: MechanismModel, p: string): string {
  return model.pointNames.get(p) ?? p;
}

export function bodyName(model: MechanismModel, id: string): string {
  return id === GROUND ? 'ground' : (model.bodies.find((b) => b.id === id)?.name ?? id);
}

export function jointNames(model: MechanismModel): Map<string, JointName> {
  const perPoint = new Map<string, number>();
  for (const j of model.joints) perPoint.set(j.point, (perPoint.get(j.point) ?? 0) + 1);
  return new Map(model.joints.map((j) => [j.id, nameOf(model, j, (perPoint.get(j.point) ?? 0) > 1)]));
}

function nameOf(model: MechanismModel, j: MJoint, shared: boolean): JointName {
  const p = pointName(model, j.point);
  const a = bodyName(model, j.a);
  const b = bodyName(model, j.b);
  const links =
    j.type === 'revolute' ? `${a} – ${b}` : `${b} in ${a} ${j.type === 'slider' ? 'slide' : 'slot'}`;
  const short = shared ? `${p} (${b})` : p;
  return { short, links, long: `${p}: ${links}` };
}

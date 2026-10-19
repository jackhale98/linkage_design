// Everything the Motion workspace needs, computed from the project.

import type { Project } from '../model/project';
import { driverRate, type MotionData } from './analysis';
import { KinematicSystem } from './kinematics';
import { buildModel, syncMechanism, type MechanismIssue, type MechanismModel } from './model';
import { sweep, type SweepResult } from './sweep';
import { mechanismFreedom, poseConstraints, type MechanismFreedom } from './freedom';

export interface MotionResult {
  model: MechanismModel;
  sys: KinematicSystem;
  /** Degrees of freedom without the driver. */
  mobility: number;
  /** Where the extra degrees of freedom are, when there are too many. */
  freedom: MechanismFreedom | null;
  /** Sweep range in user units (angle or length). */
  range: { start: number; end: number; steps: number };
  res: SweepResult | null;
  data: MotionData | null;
  issues: MechanismIssue[];
}

const DEG = Math.PI / 180;

/** Default sweep range in user units: a full turn for cranks, +/-20% for actuators. */
export function defaultRange(project: Project, model: MechanismModel): { start: number; end: number } {
  const d = model.driver;
  if (d?.type === 'linear') {
    const r = (v: number) => Number(v.toPrecision(3));
    return { start: r(d.t0 * 0.8), end: r(d.t0 * 1.2) };
  }
  return project.meta.angle_unit === 'deg' ? { start: 0, end: 360 } : { start: 0, end: 2 * Math.PI };
}

export function computeMotion(project: Project): MotionResult {
  // Work on a synced copy so stale body/joint data never breaks the analysis.
  const mech = structuredClone(project.mechanism);
  syncMechanism(project.sketch, mech);
  const model = buildModel(project.sketch, mech);
  const sys = new KinematicSystem(model);
  const issues = [...model.issues];
  const mobility = model.bodies.length ? sys.mobility() : 0;
  const spec = project.mechanism.driver;
  const def = defaultRange(project, model);
  const range = { start: spec.start ?? def.start, end: spec.end ?? def.end, steps: spec.steps };

  let freedom: MechanismFreedom | null = null;
  const blocked = issues.some((i) => i.severity === 'error') || model.bodies.length === 0;
  if (!blocked) {
    if (mobility === 0)
      issues.push({
        severity: 'error',
        message: 'The mechanism is locked (0 degrees of freedom): it is a rigid structure',
      });
    else if (mobility > 1) {
      freedom = mechanismFreedom(model, sys);
      const names = freedom.bodies.map((id) => model.bodies.find((b) => b.id === id)?.name ?? id);
      const where = !names.length
        ? ''
        : freedom.held
          ? ` With ${freedom.held} held still, ${list(names)} can still move (highlighted).`
          : ` The highlighted links (${list(names)}) can move independently.`;
      const pose = poseConstraints(project.sketch, model, freedom.bodies);
      const why = pose.length
        ? ` In the sketch, ${list(pose)} hold${pose.length === 1 ? 's' : ''} this in place, but ${pose.length === 1 ? 'it spans' : 'they span'} separate links, so ${pose.length === 1 ? 'it only sets' : 'they only set'} the drawn pose; the mechanism keeps only dimensions inside a link.`
        : '';
      issues.push({
        severity: 'error',
        message: `The mechanism has ${mobility} degrees of freedom; one driver can only control one.${where}${why} To remove ${mobility - 1}: merge links that should move as one, brace a four-sided loop with a diagonal link, or add a fixed pivot.`,
      });
    } else if (!model.driver)
      issues.push({ severity: 'warning', message: 'Choose a driver to animate the mechanism' });
  }
  if (blocked || mobility !== 1 || !model.driver)
    return { model, sys, mobility, freedom, range, res: null, data: null, issues };

  const toSolver = model.driver.type === 'rotary' && project.meta.angle_unit === 'deg' ? DEG : 1;
  const res = sweep(sys, { start: range.start * toSolver, end: range.end * toSolver, steps: range.steps });
  if (res.error) issues.push({ severity: 'error', message: res.error });
  const rate = driverRate(model.driver.type, spec.speed, range.start, range.end);
  const data: MotionData = {
    sys,
    res,
    rate,
    units: { length: project.meta.length_unit, angle: project.meta.angle_unit },
  };
  return { model, sys, mobility, freedom, range, res, data, issues };
}

/** "A", "A and B", "A, B and C". */
function list(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

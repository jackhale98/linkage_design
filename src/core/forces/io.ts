// Forces <-> CSV sections: [loads], [analysis].

import { Diagnostics } from '../csv/diagnostics';
import type { Delimiter } from '../csv/rfc4180';
import type { RawSection, SectionOut } from '../csv/sectioned';
import { readKeyValue, readTable, writeKeyValue, writeTable } from '../csv/table';
import type { MechanismData } from '../mechanism/types';
import type { Sketch } from '../sketch/types';
import { ANALYSIS_MODES, LOAD_FRAMES, LOAD_TYPES, SOLVE_FOR, emptyForces, type ForcesData } from './types';

const LOADS_SPEC = {
  id: { type: 'id', required: true },
  type: { type: 'enum', values: LOAD_TYPES, required: true },
  body: { type: 'ref' },
  point: { type: 'ref' },
  point_b: { type: 'ref' },
  joint: { type: 'ref' },
  fx: { type: 'number', default: 0 },
  fy: { type: 'number', default: 0 },
  frame: { type: 'enum', values: LOAD_FRAMES, default: 'global' },
  torque: { type: 'number', default: 0 },
  k: { type: 'number', default: 0, min: 0 },
  free: { type: 'number' },
  preload: { type: 'number', default: 0 },
  opposes: { type: 'bool' },
} as const;

const ANALYSIS_SPEC = {
  mode: { type: 'enum', values: ANALYSIS_MODES, default: 'kinetostatic' },
  gravity: { type: 'bool' },
  solve_for: { type: 'enum', values: SOLVE_FOR, default: 'input' },
  input: { type: 'number', default: 0 },
  output_joint: { type: 'ref' },
  input_point: { type: 'ref' },
  output_point: { type: 'ref' },
} as const;

export const FORCES_SECTIONS = ['loads', 'analysis'] as const;

export function writeForces(f: ForcesData): SectionOut[] {
  return [
    writeTable(
      'loads',
      LOADS_SPEC,
      f.loads.map((l) => ({ ...l, point_b: l.pointB, free: l.free, opposes: l.oppose })),
      'Loads: force (fx, fy at a point of a body), torque (on a body), spring (between two points: k, free length, preload tension), torsion (at a joint: k per angle unit, free angle, preload torque). Blank free = free at the drawn pose. opposes = 1: a force or torque that always resists the motion (its sign follows the direction of travel).',
    ),
    writeKeyValue(
      'analysis',
      ANALYSIS_SPEC,
      {
        mode: f.mode,
        gravity: f.gravity,
        solve_for: f.solveFor,
        input: f.input,
        output_joint: f.outputJoint,
        input_point: f.inputPoint,
        output_point: f.outputPoint,
        extras: f.extras,
      },
      'mode: static (applied loads only) or kinetostatic (plus inertia at the driver speed). gravity acts in -y. solve_for: input (find the input torque the loads need) or output (given the input torque, find the output at output_joint). input_point / output_point express those torques as forces at a point.',
    ),
  ];
}

export function readForces(
  sections: Map<string, RawSection>,
  sketch: Sketch,
  mech: MechanismData,
  delimiter: Delimiter,
  diag: Diagnostics,
): ForcesData {
  const f = emptyForces();
  const points = new Set(sketch.points.map((p) => p.id));
  const bodies = new Set(mech.bodies.map((b) => b.id));
  const joints = new Set(mech.joints.map((j) => j.id));
  const ls = sections.get('loads');
  if (ls) {
    for (const r of readTable(ls, LOADS_SPEC, delimiter, diag)) {
      const where = { line: r.srcLine, section: 'loads' };
      const need = (col: 'body' | 'point' | 'point_b' | 'joint', set: Set<string>, what: string) => {
        const v = r[col];
        if (!v) diag.error(`${r.type} needs a ${what}`, { ...where, column: col });
        else if (!set.has(v))
          diag.error(`${what[0]!.toUpperCase() + what.slice(1)} "${v}" doesn't exist`, {
            ...where,
            column: col,
          });
      };
      if (r.type === 'force') {
        need('body', bodies, 'body');
        need('point', points, 'point');
      } else if (r.type === 'torque') {
        need('body', bodies, 'body');
      } else if (r.type === 'spring') {
        need('point', points, 'point');
        need('point_b', points, 'point');
        if (r.free !== undefined && !(r.free > 0))
          diag.error('Free length must be greater than zero', { ...where, column: 'free' });
      } else if (r.type === 'torsion') {
        need('joint', joints, 'joint');
      }
      f.loads.push({
        id: r.id ?? '',
        type: r.type ?? 'force',
        body: r.body ?? '',
        point: r.point ?? '',
        pointB: r.point_b ?? '',
        joint: r.joint ?? '',
        fx: r.fx,
        fy: r.fy,
        frame: r.frame,
        torque: r.torque,
        k: r.k,
        free: r.free,
        preload: r.preload,
        oppose: r.opposes,
        extras: r.extras,
      });
    }
  }
  const a = readKeyValue(sections.get('analysis'), ANALYSIS_SPEC, delimiter, diag);
  f.mode = a.mode;
  f.gravity = a.gravity;
  f.solveFor = a.solve_for;
  f.input = a.input;
  f.outputJoint = a.output_joint ?? '';
  f.inputPoint = a.input_point ?? '';
  f.outputPoint = a.output_point ?? '';
  f.extras = a.extras;
  const where = { section: 'analysis' };
  if (f.outputJoint && !joints.has(f.outputJoint))
    diag.error(`Output joint "${f.outputJoint}" doesn't exist`, where);
  for (const p of [f.inputPoint, f.outputPoint])
    if (p && !points.has(p)) diag.error(`Point "${p}" doesn't exist`, where);
  return f;
}

// Mechanism <-> CSV sections: [bodies], [joints], [driver], [motion].

import { Diagnostics } from '../csv/diagnostics';
import type { Delimiter } from '../csv/rfc4180';
import type { RawSection, SectionOut } from '../csv/sectioned';
import { readKeyValue, readTable, writeKeyValue, writeTable } from '../csv/table';
import type { Sketch } from '../sketch/types';
import { BODY_COLORS, DRIVER_TYPES, GROUND, JOINT_TYPES, emptyMechanism, type MechanismData } from './types';

const BODIES_SPEC = {
  id: { type: 'id', required: true },
  name: { type: 'string' },
  lines: { type: 'idlist' },
  ground: { type: 'bool' },
  color: { type: 'string' },
  mass: { type: 'number', min: 0 },
  com_x: { type: 'number' },
  com_y: { type: 'number' },
  inertia: { type: 'number', min: 0 },
} as const;

const JOINTS_SPEC = {
  id: { type: 'id', required: true },
  type: { type: 'enum', values: JOINT_TYPES, required: true },
  point: { type: 'ref', required: true },
  line: { type: 'ref' },
  body_a: { type: 'ref', required: true },
  body_b: { type: 'ref', required: true },
} as const;

const DRIVER_SPEC = {
  type: { type: 'enum', values: DRIVER_TYPES, default: 'none' },
  line: { type: 'string' },
  line_ref: { type: 'string' },
  point_a: { type: 'string' },
  point_b: { type: 'string' },
  start: { type: 'number' },
  end: { type: 'number' },
  steps: { type: 'number', default: 360, min: 1, max: 100000, integer: true },
  speed: { type: 'number', default: 60 },
} as const;

const MOTION_SPEC = {
  trace: { type: 'string' },
} as const;

export const MECHANISM_SECTIONS = ['bodies', 'joints', 'driver', 'motion'] as const;

const clean = (v: number | undefined) => (v !== undefined && Math.abs(v) < 1e-9 ? 0 : v);

export function writeMechanism(m: MechanismData): SectionOut[] {
  const d = m.driver;
  return [
    writeTable(
      'bodies',
      BODIES_SPEC,
      m.bodies.map((b) => ({
        ...b,
        mass: b.mass,
        com_x: clean(b.comX),
        com_y: clean(b.comY),
        inertia: b.inertia,
      })),
      'Rigid bodies (links), each a group of sketch lines. ground = fixed to the frame.',
    ),
    writeTable(
      'joints',
      JOINTS_SPEC,
      m.joints.map((j) => ({ ...j, body_a: j.bodyA, body_b: j.bodyB })),
      'Joints, derived from the sketch. type may be changed between pin_in_slot and slider.',
    ),
    writeKeyValue(
      'driver',
      DRIVER_SPEC,
      {
        type: d.type,
        line: d.line,
        line_ref: d.lineRef,
        point_a: d.pointA,
        point_b: d.pointB,
        start: clean(d.start),
        end: clean(d.end),
        steps: d.steps,
        speed: d.speed,
        extras: d.extras,
      },
      'Driver: rotary (angle of a line, from +x or from line_ref) or linear (distance between two points). Speed in rpm or length/s.',
    ),
    writeKeyValue('motion', MOTION_SPEC, { trace: m.motion.trace.join(' '), extras: m.motion.extras }),
  ];
}

export function readMechanism(
  sections: Map<string, RawSection>,
  sketch: Sketch,
  delimiter: Delimiter,
  diag: Diagnostics,
): MechanismData {
  const m = emptyMechanism();
  const lineIds = new Set(sketch.lines.map((l) => l.id));
  const pointIds = new Set(sketch.points.map((p) => p.id));
  const taken = new Set([...pointIds, ...lineIds, ...sketch.constraints.map((c) => c.id)]);

  const bs = sections.get('bodies');
  if (bs) {
    m.bodies = readTable(bs, BODIES_SPEC, delimiter, diag).map((r, i) => {
      const where = { line: r.srcLine, section: 'bodies' };
      if (r.id && (taken.has(r.id) || r.id === GROUND)) diag.error(`ID "${r.id}" is already used`, where);
      const missing = r.lines.filter((l) => !lineIds.has(l));
      if (missing.length)
        diag.error(`Line ${missing.map((x) => `"${x}"`).join(', ')} doesn't exist`, {
          ...where,
          column: 'lines',
        });
      return {
        id: r.id ?? '',
        name: r.name || r.id || '',
        lines: r.lines,
        ground: r.ground,
        color: /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : BODY_COLORS[i % BODY_COLORS.length]!,
        mass: r.mass,
        comX: r.com_x,
        comY: r.com_y,
        inertia: r.inertia,
        extras: r.extras,
      };
    });
  }
  const bodyIds = new Set([GROUND, ...m.bodies.map((b) => b.id)]);

  const js = sections.get('joints');
  if (js) {
    // Joints are re-derived from the sketch; stored records only keep IDs and types.
    for (const r of readTable(js, JOINTS_SPEC, delimiter, diag)) {
      if (!r.type || !r.point || !r.body_a || !r.body_b) continue;
      if (!pointIds.has(r.point) || !bodyIds.has(r.body_a) || !bodyIds.has(r.body_b)) {
        diag.warn(`Joint ${r.id} refers to geometry that no longer exists; it will be recreated`, {
          line: r.srcLine,
          section: 'joints',
        });
        continue;
      }
      m.joints.push({
        id: r.id ?? '',
        type: r.type,
        point: r.point,
        line: r.line ?? '',
        bodyA: r.body_a,
        bodyB: r.body_b,
        extras: r.extras,
      });
    }
  }

  const ds = sections.get('driver');
  const dv = readKeyValue(ds, DRIVER_SPEC, delimiter, diag);
  m.driver = {
    type: dv.type,
    line: dv.line,
    lineRef: dv.line_ref,
    pointA: dv.point_a,
    pointB: dv.point_b,
    start: dv.start,
    end: dv.end,
    steps: dv.steps,
    speed: dv.speed,
    extras: dv.extras,
  };
  const where = { line: ds?.markerLine, section: 'driver' };
  if (dv.type === 'rotary') {
    if (!lineIds.has(dv.line))
      diag.error(`Driver line "${dv.line}" doesn't exist`, { ...where, column: 'line' });
    if (dv.line_ref && !lineIds.has(dv.line_ref))
      diag.error(`Reference line "${dv.line_ref}" doesn't exist`, { ...where, column: 'line_ref' });
  } else if (dv.type === 'linear') {
    for (const [k, v] of [
      ['point_a', dv.point_a],
      ['point_b', dv.point_b],
    ] as const)
      if (!pointIds.has(v)) diag.error(`Actuator point "${v}" doesn't exist`, { ...where, column: k });
  }

  const ms = sections.get('motion');
  const mv = readKeyValue(ms, MOTION_SPEC, delimiter, diag);
  const trace = mv.trace.split(/[\s;|]+/).filter(Boolean);
  for (const p of trace)
    if (!pointIds.has(p))
      diag.warn(`Traced point "${p}" doesn't exist; ignored`, {
        line: ms?.markerLine,
        section: 'motion',
        column: 'trace',
      });
  m.motion = { trace: trace.filter((p) => pointIds.has(p)), extras: mv.extras };
  return m;
}

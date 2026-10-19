// Cams <-> CSV sections: [cams] (one row of settings per cam) and
// [cam_segments] (each cam's motion program, in order). Files from before
// several cams were supported have a single [cam] key/value section; those
// still open, as cam C1.

import { Diagnostics } from '../csv/diagnostics';
import type { Delimiter } from '../csv/rfc4180';
import type { RawSection, SectionOut } from '../csv/sectioned';
import { readKeyValue, readTable, writeTable } from '../csv/table';
import { MOTION_LAWS } from './laws';
import { FOLLOWER_TYPES, ROTATIONS, SEGMENT_TYPES, emptyCam, type CamData } from './types';

const d = emptyCam();

const SETTINGS = {
  base_radius: { type: 'number', default: d.baseRadius, min: 0 },
  rotation: { type: 'enum', values: ROTATIONS, default: d.rotation },
  speed: { type: 'number', default: d.speed, min: 0 },
  follower: { type: 'enum', values: FOLLOWER_TYPES, default: d.follower },
  roller_radius: { type: 'number', default: d.rollerRadius, min: 0 },
  offset: { type: 'number', default: d.offset },
  pivot_distance: { type: 'number', default: d.pivotDistance, min: 0 },
  arm_length: { type: 'number', default: d.armLength, min: 0 },
  pressure_limit: { type: 'number', default: d.pressureLimit, min: 0, max: 90 },
  mass: { type: 'number', default: d.mass, min: 0 },
  spring_rate: { type: 'number', default: d.springRate, min: 0 },
  preload: { type: 'number', default: d.preload },
  load: { type: 'number', default: d.load },
  step: { type: 'number', default: d.step, min: 0.01, max: 10 },
} as const;

const CAMS_SPEC = {
  id: { type: 'id', required: true },
  name: { type: 'string' },
  ...SETTINGS,
} as const;

const SEGMENTS_SPEC = {
  cam: { type: 'ref' },
  id: { type: 'ref', required: true },
  type: { type: 'enum', values: SEGMENT_TYPES, required: true },
  duration: { type: 'number', required: true, min: 0 },
  lift: { type: 'number', default: 0, min: 0 },
  law: { type: 'enum', values: MOTION_LAWS, default: 'cycloidal' },
} as const;

export const CAM_SECTIONS = ['cams', 'cam', 'cam_segments'] as const;

export function writeCams(cams: CamData[]): SectionOut[] {
  if (!cams.length) return [];
  return [
    writeTable(
      'cams',
      CAMS_SPEC,
      cams.map((c) => ({
        id: c.id,
        name: c.name,
        base_radius: c.baseRadius,
        rotation: c.rotation,
        speed: c.speed,
        follower: c.follower,
        roller_radius: c.rollerRadius,
        offset: c.offset,
        pivot_distance: c.pivotDistance,
        arm_length: c.armLength,
        pressure_limit: c.pressureLimit,
        mass: c.mass,
        spring_rate: c.springRate,
        preload: c.preload,
        load: c.load,
        step: c.step,
        extras: c.extras,
      })),
      'Cams: lengths and forces in project units; angles in degrees. follower: translating_roller, translating_flat, oscillating_roller, oscillating_flat (pivot on +x at pivot_distance). Oscillating followers: mass is the arm inertia about the pivot, spring_rate per radian, preload and load are torques.',
    ),
    writeTable(
      'cam_segments',
      SEGMENTS_SPEC,
      cams.flatMap((c) => c.segments.map((s) => ({ cam: c.id, ...s }))),
      "Each cam's motion program, in order from 0°: rise / return / dwell, duration in degrees, lift in length (or degrees for oscillating followers). Durations must add up to 360°.",
    ),
  ];
}

type Settings = Omit<CamData, 'id' | 'name' | 'segments' | 'extras'>;

function settings(v: {
  base_radius: number;
  rotation: CamData['rotation'];
  speed: number;
  follower: CamData['follower'];
  roller_radius: number;
  offset: number;
  pivot_distance: number;
  arm_length: number;
  pressure_limit: number;
  mass: number;
  spring_rate: number;
  preload: number;
  load: number;
  step: number;
}): Settings {
  return {
    baseRadius: v.base_radius,
    rotation: v.rotation,
    speed: v.speed,
    follower: v.follower,
    rollerRadius: v.roller_radius,
    offset: v.offset,
    pivotDistance: v.pivot_distance,
    armLength: v.arm_length,
    pressureLimit: v.pressure_limit,
    mass: v.mass,
    springRate: v.spring_rate,
    preload: v.preload,
    load: v.load,
    step: v.step,
  };
}

export function readCams(
  sections: Map<string, RawSection>,
  delimiter: Delimiter,
  diag: Diagnostics,
): CamData[] {
  const cams: CamData[] = [];
  const table = sections.get('cams');
  const legacy = sections.get('cam');
  if (table) {
    for (const r of readTable(table, CAMS_SPEC, delimiter, diag))
      cams.push({
        id: r.id ?? '',
        name: r.name || r.id || '',
        ...settings(r),
        segments: [],
        extras: r.extras,
      });
  } else if (legacy) {
    const v = readKeyValue(legacy, SETTINGS, delimiter, diag);
    cams.push({ id: 'C1', name: 'Cam 1', ...settings(v), segments: [], extras: v.extras });
  }
  const segs = sections.get('cam_segments');
  if (segs) {
    for (const r of readTable(segs, SEGMENTS_SPEC, delimiter, diag)) {
      const where = { line: r.srcLine, section: 'cam_segments' };
      // Old single-cam files have no cam column.
      const camId = r.cam || (legacy && !table ? 'C1' : '');
      const cam = cams.find((c) => c.id === camId);
      if (!camId) diag.error('Say which cam this segment belongs to', { ...where, column: 'cam' });
      else if (!cam) diag.error(`Cam "${camId}" doesn't exist`, { ...where, column: 'cam' });
      else if (cam.segments.some((s) => s.id === r.id))
        diag.error(`Segment "${r.id}" appears twice in ${camId}`, { ...where, column: 'id' });
      else
        cam.segments.push({
          id: r.id ?? '',
          type: r.type ?? 'dwell',
          duration: r.duration ?? 0,
          lift: r.lift,
          law: r.law,
          extras: r.extras,
        });
    }
  }
  return cams;
}

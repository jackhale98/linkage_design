// Cam <-> CSV sections: [cam] (settings, key/value) and [cam_segments].

import { Diagnostics } from '../csv/diagnostics';
import type { Delimiter } from '../csv/rfc4180';
import type { RawSection, SectionOut } from '../csv/sectioned';
import { readKeyValue, readTable, writeKeyValue, writeTable } from '../csv/table';
import { MOTION_LAWS } from './laws';
import { FOLLOWER_TYPES, ROTATIONS, SEGMENT_TYPES, emptyCam, type CamData } from './types';

const d = emptyCam();

const CAM_SPEC = {
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

const SEGMENTS_SPEC = {
  id: { type: 'id', required: true },
  type: { type: 'enum', values: SEGMENT_TYPES, required: true },
  duration: { type: 'number', required: true, min: 0 },
  lift: { type: 'number', default: 0, min: 0 },
  law: { type: 'enum', values: MOTION_LAWS, default: 'cycloidal' },
} as const;

export const CAM_SECTIONS = ['cam', 'cam_segments'] as const;

/** True for an untouched cam (no program, default settings): its sections are left out of the file. */
function isDefault(c: CamData): boolean {
  const e = emptyCam();
  return (Object.keys(e) as (keyof CamData)[]).every((k) => JSON.stringify(c[k]) === JSON.stringify(e[k]));
}

export function writeCam(c: CamData): SectionOut[] {
  if (isDefault(c)) return [];
  return [
    writeKeyValue(
      'cam',
      CAM_SPEC,
      {
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
      },
      'Cam: lengths and forces in project units; angles in degrees. follower: translating_roller, translating_flat, oscillating_roller, oscillating_flat (pivot on +x at pivot_distance). Oscillating followers: mass is the arm inertia about the pivot, spring_rate per radian, preload and load are torques.',
    ),
    writeTable(
      'cam_segments',
      SEGMENTS_SPEC,
      c.segments,
      'Motion program, in order from 0°: rise / return / dwell, duration in degrees, lift in length (or degrees for oscillating followers). Durations must add up to 360°.',
    ),
  ];
}

export function readCam(sections: Map<string, RawSection>, delimiter: Delimiter, diag: Diagnostics): CamData {
  const v = readKeyValue(sections.get('cam'), CAM_SPEC, delimiter, diag);
  const segs = sections.get('cam_segments');
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
    extras: v.extras,
    segments: segs
      ? readTable(segs, SEGMENTS_SPEC, delimiter, diag).map((r) => ({
          id: r.id ?? '',
          type: r.type ?? 'dwell',
          duration: r.duration ?? 0,
          lift: r.lift,
          law: r.law,
          extras: r.extras,
        }))
      : [],
  };
}

// Cam data: settings, follower, motion program and follower loads.
//
// Units follow the project for lengths, forces and mass; cam angles
// (segment durations, oscillating lifts, pressure-angle limit) are always in
// degrees, as is usual for cam design.

import type { MotionLaw } from './laws';

export const SEGMENT_TYPES = ['rise', 'return', 'dwell'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];

export interface CamSegment {
  id: string;
  type: SegmentType;
  /** Cam angle the segment spans (degrees). */
  duration: number;
  /** Rise or return: length (translating follower) or degrees (oscillating follower). */
  lift: number;
  law: MotionLaw;
  extras: Record<string, string>;
}

export const FOLLOWER_TYPES = [
  'translating_roller',
  'translating_flat',
  'oscillating_roller',
  'oscillating_flat',
] as const;
export type FollowerType = (typeof FOLLOWER_TYPES)[number];

export const FOLLOWER_NAMES: Record<FollowerType, string> = {
  translating_roller: 'Translating roller',
  translating_flat: 'Translating flat-faced',
  oscillating_roller: 'Oscillating roller',
  oscillating_flat: 'Oscillating flat-faced',
};

export const ROTATIONS = ['ccw', 'cw'] as const;
export type Rotation = (typeof ROTATIONS)[number];

export interface CamData {
  /** Stable ID (C1, C2…) so cam joints in the mechanism can refer to it. */
  id: string;
  name: string;
  /** Base circle radius: the smallest cam radius (the cam surface at zero lift). */
  baseRadius: number;
  rotation: Rotation;
  /** Cam speed, rpm. */
  speed: number;
  follower: FollowerType;
  /** Roller radius (0 = knife edge). */
  rollerRadius: number;
  /** Translating followers: offset of the follower axis from the cam centre. */
  offset: number;
  /** Oscillating followers: distance from the cam centre to the follower pivot (on the +x axis). */
  pivotDistance: number;
  /** Oscillating roller: pivot to roller centre. */
  armLength: number;
  /** Pressure angle limit for the check (degrees). */
  pressureLimit: number;
  /** Translating: follower mass. Oscillating: moment of inertia about the pivot (mass x length^2). */
  mass: number;
  /** Return spring: force per length (translating) or torque per radian (oscillating). */
  springRate: number;
  /** Spring force (or torque) at zero lift. */
  preload: number;
  /** Constant load pressing the follower towards the cam: force (translating) or torque (oscillating). */
  load: number;
  /** Analysis step (degrees). */
  step: number;
  segments: CamSegment[];
  extras: Record<string, string>;
}

export function emptyCam(id = 'C1', name = 'Cam 1'): CamData {
  return {
    id,
    name,
    baseRadius: 40,
    rotation: 'ccw',
    speed: 60,
    follower: 'translating_roller',
    rollerRadius: 10,
    offset: 0,
    pivotDistance: 100,
    armLength: 80,
    pressureLimit: 30,
    mass: 0,
    springRate: 0,
    preload: 0,
    load: 0,
    step: 0.5,
    segments: [],
    extras: {},
  };
}

export const isOscillating = (f: FollowerType) => f.startsWith('oscillating');
export const isRoller = (f: FollowerType) => f.endsWith('roller');

/** A standard dwell-rise-dwell-return program to start from: 20 mm (or 20°) of lift. */
export function starterProgram(): CamSegment[] {
  const lift = 20;
  const seg = (id: string, type: CamSegment['type'], duration: number): CamSegment => ({
    id,
    type,
    duration,
    lift: type === 'dwell' ? 0 : lift,
    law: 'cycloidal',
    extras: {},
  });
  return [seg('S1', 'dwell', 60), seg('S2', 'rise', 120), seg('S3', 'dwell', 60), seg('S4', 'return', 120)];
}

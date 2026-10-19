// Mechanism data stored in the project: rigid bodies made of sketch lines,
// joint records, the driver and motion settings. Plain serialisable objects.

/** ID used for the ground (fixed frame) in joint records. */
export const GROUND = 'ground';

export interface Body {
  id: string;
  name: string;
  /** Sketch lines that make up the body (rigidly connected). */
  lines: string[];
  /** Explicitly fixed to ground. */
  ground: boolean;
  color: string;
  /** Mass (kg or lb); undefined = massless. */
  mass?: number;
  /** Centre of mass in the drawn pose; undefined = centroid of the body's lines. */
  comX?: number;
  comY?: number;
  /** Moment of inertia about the centre of mass (mass x length^2); undefined = 0. */
  inertia?: number;
  extras: Record<string, string>;
}

export const JOINT_TYPES = ['revolute', 'pin_in_slot', 'slider'] as const;
export type JointType = (typeof JOINT_TYPES)[number];

export interface JointRecord {
  id: string;
  type: JointType;
  /** The pin point (revolute) or the point riding in the slot. */
  point: string;
  /** Slot line (pin-in-slot and slider); empty for revolute. */
  line: string;
  /** Bodies joined (body IDs or "ground"). For slots, bodyA carries the line. */
  bodyA: string;
  bodyB: string;
  extras: Record<string, string>;
}

export const DRIVER_TYPES = ['none', 'rotary', 'linear'] as const;
export type DriverType = (typeof DRIVER_TYPES)[number];

export interface DriverSpec {
  type: DriverType;
  /** Rotary: the line whose angle is driven. */
  line: string;
  /** Rotary: angle measured from this line; empty = from the +x axis (ground). */
  lineRef: string;
  /** Linear: the two points whose distance is driven (an actuator). */
  pointA: string;
  pointB: string;
  /** Sweep range in project units (angle or length); undefined = default. */
  start?: number;
  end?: number;
  steps: number;
  /** rpm for rotary drivers, length units per second for linear drivers. */
  speed: number;
  extras: Record<string, string>;
}

export interface MotionSettings {
  /** Points whose paths are traced. */
  trace: string[];
  extras: Record<string, string>;
}

export interface MechanismData {
  bodies: Body[];
  joints: JointRecord[];
  driver: DriverSpec;
  motion: MotionSettings;
}

export function emptyDriver(): DriverSpec {
  return { type: 'none', line: '', lineRef: '', pointA: '', pointB: '', steps: 360, speed: 60, extras: {} };
}

export function emptyMechanism(): MechanismData {
  return { bodies: [], joints: [], driver: emptyDriver(), motion: { trace: [], extras: {} } };
}

/**
 * Categorical colours for bodies, in a fixed order validated for colour-vision
 * deficiency (adjacent pairs) on light and dark surfaces.
 */
export const BODY_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

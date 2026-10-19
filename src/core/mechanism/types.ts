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

/** Higher pairs: a cam with a roller follower, a gear mesh, a rack and pinion. */
export const PAIR_TYPES = ['cam', 'gear', 'rack'] as const;
export type PairType = (typeof PAIR_TYPES)[number];

/**
 * A cam or gear joint between two links. Unlike pins and slots these aren't
 * derived from the sketch: they are added in the Mechanism workspace.
 *
 * - cam: a cam (from the Cam workspace) on link A, centred at point A; a
 *   roller of the cam's design radius on link B, centred at point B.
 * - gear: gear A on link A centred at point A meshing with gear B on link B
 *   centred at point B (external mesh). Both centres pivot on one carrier.
 * - rack: pinion on link A centred at point A (pivoting on ground) driving
 *   the rack link B, whose pitch line is `line`.
 */
export interface PairRecord {
  id: string;
  type: PairType;
  bodyA: string;
  pointA: string;
  bodyB: string;
  pointB: string;
  /** Rack: the rack's pitch line (a line of link B). */
  line: string;
  /** Cam: the cam's ID in the Cam workspace. */
  cam: string;
  /** Cam: mount angle of the cam's 0° direction at the drawn pose (degrees); undefined = fit to the drawn roller. */
  angle?: number;
  /** Gear and rack: tooth counts (B unused for a rack). */
  teethA: number;
  teethB: number;
  /** Gear and rack: pressure angle (degrees). */
  pressure: number;
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
  /** A limited sweep runs there and back (a full cycle), not one way. */
  returnStroke: boolean;
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
  /** Cam and gear joints. */
  pairs: PairRecord[];
  driver: DriverSpec;
  motion: MotionSettings;
}

export function emptyDriver(): DriverSpec {
  return {
    type: 'none',
    line: '',
    lineRef: '',
    pointA: '',
    pointB: '',
    steps: 360,
    speed: 60,
    returnStroke: false,
    extras: {},
  };
}

export function emptyMechanism(): MechanismData {
  return { bodies: [], joints: [], pairs: [], driver: emptyDriver(), motion: { trace: [], extras: {} } };
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

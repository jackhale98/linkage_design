// Force analysis data: loads and analysis settings. Mass properties live on
// the bodies (see mechanism/types.ts).
//
// Units follow the project: lengths and forces in the project units, mass in
// kg (N projects) or lb (lbf projects), angles in the project angle unit.

export const LOAD_TYPES = ['force', 'torque', 'spring', 'torsion'] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const LOAD_FRAMES = ['global', 'body'] as const;
export type LoadFrame = (typeof LOAD_FRAMES)[number];

export interface Load {
  id: string;
  type: LoadType;
  /** Body the load acts on (force, torque). */
  body: string;
  /** Point of application (force) or first spring end (spring). */
  point: string;
  /** Second spring end (spring). */
  pointB: string;
  /** Joint carrying a torsion spring (torsion). */
  joint: string;
  /** Force components (force). */
  fx: number;
  fy: number;
  /** global: fixed direction; body: rotates with the body. */
  frame: LoadFrame;
  /** Torque, counterclockwise positive (torque). */
  torque: number;
  /** Stiffness: force per length (spring) or torque per angle unit (torsion). */
  k: number;
  /** Free length (spring) or free relative angle (torsion); undefined = free at the drawn pose. */
  free?: number;
  /** Preload: tension (spring) or torque (torsion) at the free length/angle. */
  preload: number;
  extras: Record<string, string>;
}

export const ANALYSIS_MODES = ['static', 'kinetostatic'] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export interface ForcesData {
  loads: Load[];
  /** static: applied loads only; kinetostatic: plus inertia at the driver speed. */
  mode: AnalysisMode;
  /** Gravity acts in -y (on bodies with mass). */
  gravity: boolean;
  extras: Record<string, string>;
}

export function emptyForces(): ForcesData {
  return { loads: [], mode: 'kinetostatic', gravity: false, extras: {} };
}

export function newLoad(id: string, type: LoadType): Load {
  return {
    id,
    type,
    body: '',
    point: '',
    pointB: '',
    joint: '',
    fx: 0,
    fy: 0,
    frame: 'global',
    torque: 0,
    k: 0,
    preload: 0,
    extras: {},
  };
}

const LENGTH_M = { mm: 0.001, m: 1, in: 0.0254 } as const;
const FORCE_N = { N: 1, lbf: 4.4482216152605 } as const;
const MASS_KG = { N: 1, lbf: 0.45359237 } as const;

export const STANDARD_GRAVITY = 9.80665; // m/s^2

export interface ForceUnits {
  length: keyof typeof LENGTH_M;
  force: keyof typeof FORCE_N;
}

/** Mass unit that pairs with the force unit. */
export function massUnit(u: ForceUnits): string {
  return u.force === 'N' ? 'kg' : 'lb';
}

/**
 * Factor converting mass x (length/s^2) to the project force unit, e.g.
 * kg x mm/s^2 -> N is 0.001. Also converts mass x length^2/s^2 to force x length.
 */
export function inertiaFactor(u: ForceUnits): number {
  return (LENGTH_M[u.length] * MASS_KG[u.force]) / FORCE_N[u.force];
}

/** Weight per unit mass, in project force units (e.g. 9.80665 N/kg, 1 lbf/lb). */
export function weightPerMass(u: ForceUnits): number {
  return (STANDARD_GRAVITY * MASS_KG[u.force]) / FORCE_N[u.force];
}

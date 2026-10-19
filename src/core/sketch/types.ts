// Sketch data: points, lines and constraints. Plain serialisable objects.
// Lengths are in the project length unit; angle values in the project angle unit.

export interface SketchPoint {
  id: string;
  x: number;
  y: number;
  /** Anchored in place (not moved by the solver). */
  fixed: boolean;
  label: string;
  extras: Record<string, string>;
}

export interface SketchLine {
  id: string;
  p1: string;
  p2: string;
  /** Construction geometry: helps define the sketch but isn't part of a body outline. */
  construction: boolean;
  extras: Record<string, string>;
}

export const CONSTRAINT_TYPES = [
  'coincident',
  'distance',
  'hdistance',
  'vdistance',
  'angle',
  'horizontal',
  'vertical',
  'parallel',
  'perpendicular',
  'point_on_line',
  'midpoint',
  'equal',
] as const;

export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  /** Referenced point/line IDs, in the order the type's signature expects. */
  refs: string[];
  /** Dimension value (dimensions only). */
  value?: number;
  /** Reference (driven) dimension: measured, not enforced. */
  reference: boolean;
  /** Dimension label offset from its anchor, in model units. */
  labelDx?: number;
  labelDy?: number;
  extras: Record<string, string>;
}

export interface Sketch {
  points: SketchPoint[];
  lines: SketchLine[];
  constraints: SketchConstraint[];
}

export function emptySketch(): Sketch {
  return { points: [], lines: [], constraints: [] };
}

export type EntityKind = 'point' | 'line';

// Constraint definitions: allowed reference signatures, residual equations
// with analytic gradients, and measurement of current values.
//
// Residuals are scaled to length units. Angular constraints are multiplied
// by a characteristic length `S` (fixed for the duration of a solve) so all
// rows are comparable in size.

import type { ConstraintType, EntityKind, Sketch, SketchConstraint } from './types';

export type ValueKind = 'length' | 'angle' | null;

export interface ConstraintDef {
  label: string;
  /** Short glyph shown on the canvas. */
  symbol: string;
  /** Allowed reference signatures. */
  signatures: EntityKind[][];
  value: ValueKind;
}

export const CONSTRAINT_DEFS: Record<ConstraintType, ConstraintDef> = {
  coincident: { label: 'Coincident', symbol: '●', signatures: [['point', 'point']], value: null },
  distance: {
    label: 'Distance',
    symbol: '↔',
    signatures: [['point', 'point'], ['line'], ['point', 'line']],
    value: 'length',
  },
  hdistance: { label: 'Horizontal distance', symbol: '↔', signatures: [['point', 'point']], value: 'length' },
  vdistance: { label: 'Vertical distance', symbol: '↕', signatures: [['point', 'point']], value: 'length' },
  angle: { label: 'Angle', symbol: '∠', signatures: [['line', 'line'], ['line']], value: 'angle' },
  horizontal: { label: 'Horizontal', symbol: 'H', signatures: [['line'], ['point', 'point']], value: null },
  vertical: { label: 'Vertical', symbol: 'V', signatures: [['line'], ['point', 'point']], value: null },
  parallel: { label: 'Parallel', symbol: '∥', signatures: [['line', 'line']], value: null },
  perpendicular: { label: 'Perpendicular', symbol: '⊥', signatures: [['line', 'line']], value: null },
  point_on_line: { label: 'Point on line', symbol: '⊸', signatures: [['point', 'line']], value: null },
  midpoint: { label: 'Midpoint', symbol: 'M', signatures: [['point', 'line']], value: null },
  equal: { label: 'Equal length', symbol: '=', signatures: [['line', 'line']], value: null },
};

export function isDimension(c: { type: ConstraintType }): boolean {
  return CONSTRAINT_DEFS[c.type].value !== null;
}

export function matchesSignature(type: ConstraintType, kinds: EntityKind[]): boolean {
  return CONSTRAINT_DEFS[type].signatures.some(
    (s) => s.length === kinds.length && s.every((k, i) => k === kinds[i]),
  );
}

/** Kind of each referenced entity, or undefined for unknown IDs. */
export function refKinds(sketch: Sketch, refs: string[]): (EntityKind | undefined)[] {
  const points = new Set(sketch.points.map((p) => p.id));
  const lines = new Set(sketch.lines.map((l) => l.id));
  return refs.map((r) => (points.has(r) ? 'point' : lines.has(r) ? 'line' : undefined));
}

// ------------------------------------------------------------------ geometry access

/** Point coordinates and their unknown indices (-1 when the point is fixed). */
export interface PointVar {
  x: number;
  y: number;
  ix: number;
  iy: number;
}

export interface GeometryAccess {
  point(id: string): PointVar;
  line(id: string): [PointVar, PointVar];
  kind(id: string): EntityKind | undefined;
}

/** One residual row with a sparse gradient. */
export interface Row {
  r: number;
  g: [number, number][];
}

function grad(g: [number, number][], p: PointVar, dx: number, dy: number) {
  if (p.ix >= 0) {
    g.push([p.ix, dx]);
    g.push([p.iy, dy]);
  }
}

const TWO_PI = 2 * Math.PI;
export function wrapAngle(a: number): number {
  return a - TWO_PI * Math.round(a / TWO_PI);
}

const sgn = (v: number) => (v < 0 ? -1 : 1);

/** Signed distance of P from line AB (positive to the left of A->B) and its gradients. */
function signedDistance(P: PointVar, A: PointVar, B: PointVar) {
  const ux = B.x - A.x;
  const uy = B.y - A.y;
  const wx = P.x - A.x;
  const wy = P.y - A.y;
  const c = ux * wy - uy * wx;
  const n = Math.max(Math.hypot(ux, uy), 1e-12);
  const s = c / n;
  // d(c): P: (-uy, ux); A: (uy - wy, wx - ux); B: (wy, -wx). d(n): A: -u/n; B: u/n.
  const k = c / (n * n * n);
  return {
    s,
    dP: [-uy / n, ux / n] as const,
    dA: [(uy - wy) / n + k * ux, (wx - ux) / n + k * uy] as const,
    dB: [wy / n - k * ux, -wx / n - k * uy] as const,
  };
}

function dir(A: PointVar, B: PointVar) {
  const ux = B.x - A.x;
  const uy = B.y - A.y;
  const n2 = Math.max(ux * ux + uy * uy, 1e-24);
  return { ux, uy, n: Math.sqrt(n2), n2, phi: Math.atan2(uy, ux) };
}

/**
 * Residual rows for a constraint.
 * @param angleScale converts the stored angle value to radians
 * @param S characteristic length for angular residuals
 */
export function constraintRows(
  c: SketchConstraint,
  geo: GeometryAccess,
  angleScale: number,
  S: number,
): Row[] {
  const [a, b] = c.refs as [string, string | undefined];
  const value = c.value ?? 0;
  switch (c.type) {
    case 'coincident': {
      const P = geo.point(a);
      const Q = geo.point(b!);
      const gx: [number, number][] = [];
      const gy: [number, number][] = [];
      grad(gx, P, 1, 0);
      grad(gx, Q, -1, 0);
      grad(gy, P, 0, 1);
      grad(gy, Q, 0, -1);
      return [
        { r: P.x - Q.x, g: gx },
        { r: P.y - Q.y, g: gy },
      ];
    }
    case 'distance': {
      if (b === undefined || geo.kind(b) === 'point') {
        const [P, Q] = b === undefined ? geo.line(a) : [geo.point(a), geo.point(b)];
        const dx = P.x - Q.x;
        const dy = P.y - Q.y;
        const d = Math.hypot(dx, dy);
        const [ex, ey] = d > 1e-12 ? [dx / d, dy / d] : [1, 0];
        const g: [number, number][] = [];
        grad(g, P, ex, ey);
        grad(g, Q, -ex, -ey);
        return [{ r: d - value, g }];
      }
      const P = geo.point(a);
      const [A, B] = geo.line(b);
      const sd = signedDistance(P, A, B);
      const s = sgn(sd.s);
      const g: [number, number][] = [];
      grad(g, P, s * sd.dP[0], s * sd.dP[1]);
      grad(g, A, s * sd.dA[0], s * sd.dA[1]);
      grad(g, B, s * sd.dB[0], s * sd.dB[1]);
      return [{ r: Math.abs(sd.s) - value, g }];
    }
    case 'hdistance':
    case 'vdistance': {
      const P = geo.point(a);
      const Q = geo.point(b!);
      const h = c.type === 'hdistance';
      const d = h ? Q.x - P.x : Q.y - P.y;
      const s = sgn(d);
      const g: [number, number][] = [];
      grad(g, P, h ? -s : 0, h ? 0 : -s);
      grad(g, Q, h ? s : 0, h ? 0 : s);
      return [{ r: Math.abs(d) - value, g }];
    }
    case 'angle': {
      const theta = value * angleScale;
      const [A, B] = geo.line(a);
      const u = dir(A, B);
      const g: [number, number][] = [];
      // d(phi)/dB = (-uy, ux)/|u|^2, d(phi)/dA = -that
      if (b === undefined) {
        grad(g, B, (S * -u.uy) / u.n2, (S * u.ux) / u.n2);
        grad(g, A, (S * u.uy) / u.n2, (S * -u.ux) / u.n2);
        return [{ r: S * wrapAngle(u.phi - theta), g }];
      }
      const [C, D] = geo.line(b);
      const v = dir(C, D);
      grad(g, D, (S * -v.uy) / v.n2, (S * v.ux) / v.n2);
      grad(g, C, (S * v.uy) / v.n2, (S * -v.ux) / v.n2);
      grad(g, B, (S * u.uy) / u.n2, (S * -u.ux) / u.n2);
      grad(g, A, (S * -u.uy) / u.n2, (S * u.ux) / u.n2);
      return [{ r: S * wrapAngle(v.phi - u.phi - theta), g }];
    }
    case 'horizontal':
    case 'vertical': {
      const [P, Q] = b === undefined ? geo.line(a) : [geo.point(a), geo.point(b)];
      const h = c.type === 'horizontal';
      const g: [number, number][] = [];
      grad(g, Q, h ? 0 : 1, h ? 1 : 0);
      grad(g, P, h ? 0 : -1, h ? -1 : 0);
      return [{ r: h ? Q.y - P.y : Q.x - P.x, g }];
    }
    case 'parallel':
    case 'perpendicular': {
      const [A, B] = geo.line(a);
      const [C, D] = geo.line(b!);
      const u = dir(A, B);
      const v = dir(C, D);
      const nn = u.n * v.n;
      let f: number;
      let fu: [number, number];
      let fv: [number, number];
      if (c.type === 'parallel') {
        f = (u.ux * v.uy - u.uy * v.ux) / nn;
        fu = [v.uy / nn - (f * u.ux) / u.n2, -v.ux / nn - (f * u.uy) / u.n2];
        fv = [-u.uy / nn - (f * v.ux) / v.n2, u.ux / nn - (f * v.uy) / v.n2];
      } else {
        f = (u.ux * v.ux + u.uy * v.uy) / nn;
        fu = [v.ux / nn - (f * u.ux) / u.n2, v.uy / nn - (f * u.uy) / u.n2];
        fv = [u.ux / nn - (f * v.ux) / v.n2, u.uy / nn - (f * v.uy) / v.n2];
      }
      const g: [number, number][] = [];
      grad(g, B, S * fu[0], S * fu[1]);
      grad(g, A, -S * fu[0], -S * fu[1]);
      grad(g, D, S * fv[0], S * fv[1]);
      grad(g, C, -S * fv[0], -S * fv[1]);
      return [{ r: S * f, g }];
    }
    case 'point_on_line': {
      const P = geo.point(a);
      const [A, B] = geo.line(b!);
      const sd = signedDistance(P, A, B);
      const g: [number, number][] = [];
      grad(g, P, sd.dP[0], sd.dP[1]);
      grad(g, A, sd.dA[0], sd.dA[1]);
      grad(g, B, sd.dB[0], sd.dB[1]);
      return [{ r: sd.s, g }];
    }
    case 'midpoint': {
      const P = geo.point(a);
      const [A, B] = geo.line(b!);
      const gx: [number, number][] = [];
      const gy: [number, number][] = [];
      grad(gx, P, 1, 0);
      grad(gx, A, -0.5, 0);
      grad(gx, B, -0.5, 0);
      grad(gy, P, 0, 1);
      grad(gy, A, 0, -0.5);
      grad(gy, B, 0, -0.5);
      return [
        { r: P.x - (A.x + B.x) / 2, g: gx },
        { r: P.y - (A.y + B.y) / 2, g: gy },
      ];
    }
    case 'equal': {
      const [A, B] = geo.line(a);
      const [C, D] = geo.line(b!);
      const u = dir(A, B);
      const v = dir(C, D);
      const g: [number, number][] = [];
      grad(g, B, u.ux / u.n, u.uy / u.n);
      grad(g, A, -u.ux / u.n, -u.uy / u.n);
      grad(g, D, -v.ux / v.n, -v.uy / v.n);
      grad(g, C, v.ux / v.n, v.uy / v.n);
      return [{ r: u.n - v.n, g }];
    }
  }
}

/** Number of residual rows a constraint contributes. */
export function rowCount(c: SketchConstraint): number {
  return c.type === 'coincident' || c.type === 'midpoint' ? 2 : 1;
}

/**
 * Current value of a dimension in project units (angles signed, in the
 * project angle unit; lengths non-negative).
 */
export function measure(c: SketchConstraint, geo: GeometryAccess, angleScale: number): number {
  const [a, b] = c.refs as [string, string | undefined];
  switch (c.type) {
    case 'distance': {
      if (b === undefined || geo.kind(b) === 'point') {
        const [P, Q] = b === undefined ? geo.line(a) : [geo.point(a), geo.point(b)];
        return Math.hypot(P.x - Q.x, P.y - Q.y);
      }
      const [A, B] = geo.line(b);
      return Math.abs(signedDistance(geo.point(a), A, B).s);
    }
    case 'hdistance':
      return Math.abs(geo.point(b!).x - geo.point(a).x);
    case 'vdistance':
      return Math.abs(geo.point(b!).y - geo.point(a).y);
    case 'angle': {
      const [A, B] = geo.line(a);
      const u = dir(A, B);
      if (b === undefined) return u.phi / angleScale;
      const [C, D] = geo.line(b);
      return wrapAngle(dir(C, D).phi - u.phi) / angleScale;
    }
    default:
      return NaN;
  }
}

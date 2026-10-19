// Sketch constraint solver (point-coordinate formulation).
//
// Unknowns are the x, y of every non-fixed point. Constraint residuals and
// analytic gradients come from constraints.ts.
//
// - project(): minimum-norm Newton steps. Moves the geometry as little as
//   possible to satisfy all constraints exactly.
// - drag: a Levenberg-Marquardt pass treats dragged points as soft targets
//   (plus a weak pull of every point toward where it was), then project()
//   restores exact constraint satisfaction.
// - continuation: if a direct solve fails (a big edit), the residual is
//   eased in by homotopy, Phi(q) - (1 - t) Phi(q0) = 0, for t from 0 to 1.

import {
  nullSpaceBasis,
  nullSpaceFreedom,
  normInf,
  RowSpace,
  solveDamped,
  solveMinNorm,
  type Matrix,
} from '../math/linalg';
import { pointFreedom, type PointFreedom } from '../math/freedom';
import {
  constraintRows,
  isDimension,
  measure,
  refKinds,
  matchesSignature,
  type GeometryAccess,
  type PointVar,
} from './constraints';
import type { Sketch, SketchConstraint } from './types';

export interface SolverContext {
  /** Converts stored angle values to radians (1 for rad, pi/180 for deg). */
  angleScale: number;
}

export type Positions = Map<string, [number, number]>;

/** The constraints the solver enforces: valid, driving (not reference) constraints. */
export function activeConstraints(sketch: Sketch): SketchConstraint[] {
  return sketch.constraints.filter((c) => {
    if (c.reference && isDimension(c)) return false;
    const kinds = refKinds(sketch, c.refs);
    if (kinds.some((k) => k === undefined)) return false;
    return matchesSignature(c.type, kinds as ('point' | 'line')[]);
  });
}

export class SketchSystem {
  readonly varIndex = new Map<string, number>();
  readonly fixedPos = new Map<string, [number, number]>();
  readonly n: number;
  readonly constraints: SketchConstraint[];
  readonly S: number;
  private readonly lineMap: Map<string, [string, string]>;
  private readonly kinds = new Map<string, 'point' | 'line'>();

  constructor(
    readonly sketch: Sketch,
    readonly ctx: SolverContext,
    constraints?: SketchConstraint[],
  ) {
    let n = 0;
    for (const p of sketch.points) {
      this.kinds.set(p.id, 'point');
      if (p.fixed) this.fixedPos.set(p.id, [p.x, p.y]);
      else {
        this.varIndex.set(p.id, n);
        n += 2;
      }
    }
    for (const l of sketch.lines) this.kinds.set(l.id, 'line');
    this.n = n;
    this.lineMap = new Map(sketch.lines.map((l) => [l.id, [l.p1, l.p2]]));
    this.constraints = constraints ?? activeConstraints(sketch);
    this.S = characteristicLength(sketch);
  }

  q0(): number[] {
    const q = new Array<number>(this.n);
    for (const p of this.sketch.points) {
      const i = this.varIndex.get(p.id);
      if (i !== undefined) {
        q[i] = p.x;
        q[i + 1] = p.y;
      }
    }
    return q;
  }

  geometry(q: number[]): GeometryAccess {
    const point = (id: string): PointVar => {
      const i = this.varIndex.get(id);
      if (i !== undefined) return { x: q[i]!, y: q[i + 1]!, ix: i, iy: i + 1 };
      const f = this.fixedPos.get(id);
      if (!f) throw new Error(`Unknown point ${id}`);
      return { x: f[0], y: f[1], ix: -1, iy: -1 };
    };
    return {
      point,
      line: (id) => {
        const l = this.lineMap.get(id);
        if (!l) throw new Error(`Unknown line ${id}`);
        return [point(l[0]), point(l[1])];
      },
      kind: (id) => this.kinds.get(id),
    };
  }

  /** Residuals and Jacobian; `owner[k]` is the index of the constraint that produced row k. */
  evaluate(q: number[]): { r: number[]; J: Matrix; owner: number[] } {
    const geo = this.geometry(q);
    const r: number[] = [];
    const J: Matrix = [];
    const owner: number[] = [];
    this.constraints.forEach((c, ci) => {
      for (const row of constraintRows(c, geo, this.ctx.angleScale, this.S)) {
        const Jrow = new Array<number>(this.n).fill(0);
        for (const [k, v] of row.g) Jrow[k]! += v;
        r.push(row.r);
        J.push(Jrow);
        owner.push(ci);
      }
    });
    return { r, J, owner };
  }

  residual(q: number[]): number[] {
    const geo = this.geometry(q);
    const r: number[] = [];
    for (const c of this.constraints)
      for (const row of constraintRows(c, geo, this.ctx.angleScale, this.S)) r.push(row.r);
    return r;
  }

  get tol(): number {
    return 1e-9 * Math.max(this.S, 1);
  }

  positions(q: number[]): Positions {
    const out: Positions = new Map();
    for (const p of this.sketch.points) {
      const i = this.varIndex.get(p.id);
      out.set(p.id, i === undefined ? [p.x, p.y] : [q[i]!, q[i + 1]!]);
    }
    return out;
  }
}

/** Typical size of the sketch, used to scale angular residuals and tolerances. */
export function characteristicLength(sketch: Sketch): number {
  if (sketch.points.length < 2) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of sketch.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(Math.hypot(maxX - minX, maxY - minY) / 4, 1e-3);
}

export interface SolveResult {
  ok: boolean;
  q: number[];
  residual: number;
  iterations: number;
}

/** Minimum-norm Newton projection onto the constraint set. `offset` supports homotopy. */
export function project(sys: SketchSystem, q0: number[], offset?: number[], maxIter = 50): SolveResult {
  let q = q0.slice();
  const res = (x: number[]) => {
    const r = sys.residual(x);
    if (offset) for (let k = 0; k < r.length; k++) r[k]! -= offset[k]!;
    return r;
  };
  let r = res(q);
  let err = normInf(r);
  let it = 0;
  while (err > sys.tol && it < maxIter) {
    it++;
    const { J } = sys.evaluate(q);
    const dq = solveMinNorm(
      J,
      r.map((v) => -v),
    );
    if (dq.some((v) => !Number.isFinite(v))) break;
    let alpha = 1;
    let accepted = false;
    for (let k = 0; k < 12; k++) {
      const qn = q.map((v, i) => v + alpha * dq[i]!);
      const rn = res(qn);
      const en = normInf(rn);
      if (en < err || k === 11) {
        accepted = en < err;
        if (accepted) {
          q = qn;
          r = rn;
          err = en;
        }
        break;
      }
      alpha /= 2;
    }
    if (!accepted) break;
  }
  return { ok: err <= sys.tol * 100, q, residual: err, iterations: it };
}

/** Solve from the current geometry, easing in by homotopy if a direct solve fails. */
export function solve(sys: SketchSystem, q0 = sys.q0()): SolveResult {
  const direct = project(sys, q0);
  if (direct.ok) return direct;
  const r0 = sys.residual(q0);
  for (const steps of [4, 16, 64]) {
    let q = q0;
    let ok = true;
    let total = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const offset = r0.map((v) => (1 - t) * v);
      const res = project(sys, q, offset, 30);
      total += res.iterations;
      if (!res.ok) {
        ok = false;
        break;
      }
      q = res.q;
    }
    if (ok) {
      const final = project(sys, q);
      return { ...final, iterations: total + final.iterations };
    }
  }
  return direct;
}

export interface DragTarget {
  point: string;
  x: number;
  y: number;
}

/** Move points toward targets while keeping all constraints satisfied. */
export function solveDrag(sys: SketchSystem, targets: DragTarget[], q0 = sys.q0()): SolveResult {
  const W = 100; // weight of hard constraints in the soft pass
  const EPS = 1e-3; // pull of every point toward its previous position
  const drag = targets.filter((t) => sys.varIndex.has(t.point));
  let q = q0.slice();
  const softResidual = (x: number[]) => {
    const r = sys.residual(x).map((v) => W * v);
    for (const t of drag) {
      const i = sys.varIndex.get(t.point)!;
      r.push(x[i]! - t.x, x[i + 1]! - t.y);
    }
    for (let k = 0; k < x.length; k++) r.push(EPS * (x[k]! - q0[k]!));
    return r;
  };
  const softJacobian = (x: number[]) => {
    const { J } = sys.evaluate(x);
    const rows = J.map((row) => row.map((v) => W * v));
    for (const t of drag) {
      const i = sys.varIndex.get(t.point)!;
      const rx = new Array<number>(sys.n).fill(0);
      const ry = new Array<number>(sys.n).fill(0);
      rx[i] = 1;
      ry[i + 1] = 1;
      rows.push(rx, ry);
    }
    for (let k = 0; k < x.length; k++) {
      const row = new Array<number>(sys.n).fill(0);
      row[k] = EPS;
      rows.push(row);
    }
    return rows;
  };
  let r = softResidual(q);
  let cost = r.reduce((s, v) => s + v * v, 0);
  let mu = 1e-3;
  for (let it = 0; it < 30; it++) {
    const J = softJacobian(q);
    const dq = solveDamped(
      J,
      r.map((v) => -v),
      mu,
    );
    const qn = q.map((v, i) => v + dq[i]!);
    const rn = softResidual(qn);
    const cn = rn.reduce((s, v) => s + v * v, 0);
    if (cn < cost) {
      const done = cost - cn < 1e-12 * Math.max(cost, 1e-12);
      q = qn;
      r = rn;
      cost = cn;
      mu = Math.max(mu / 3, 1e-9);
      if (done) break;
    } else {
      mu *= 4;
      if (mu > 1e8) break;
    }
  }
  const exact = project(sys, q);
  return exact.ok ? exact : project(sys, q0);
}

export interface SketchAnalysis {
  /** Remaining degrees of freedom. */
  dof: number;
  /** Points that can still move (under-constrained). */
  freePoints: Set<string>;
  /** How each free point can move: along one direction, or anywhere in the plane. */
  freedom: Map<string, PointFreedom>;
  /** Constraints that duplicate others (over-defining but consistent). */
  redundant: Set<string>;
  /** Constraints not satisfied by the current geometry (conflicting). */
  unsatisfied: Set<string>;
  /** Current values of all dimensions, in project units. */
  measured: Map<string, number>;
}

/** DOF, per-point freedom, redundancy and satisfaction at the current geometry. */
export function analyze(sketch: Sketch, ctx: SolverContext): SketchAnalysis {
  const sys = new SketchSystem(sketch, ctx);
  const q = sys.q0();
  const { r, J, owner } = sys.evaluate(q);

  const redundant = new Set<string>();
  const space = new RowSpace(1e-7);
  J.forEach((row, k) => {
    if (!space.add(row)) redundant.add(sys.constraints[owner[k]!]!.id);
  });

  const unsatisfied = new Set<string>();
  const tol = sys.tol * 1e3;
  r.forEach((v, k) => {
    if (Math.abs(v) > tol) unsatisfied.add(sys.constraints[owner[k]!]!.id);
  });

  const { dim, free } = nullSpaceFreedom(J, sys.n);
  const freePoints = new Set<string>();
  for (const [id, i] of sys.varIndex) if (free[i] || free[i + 1]) freePoints.add(id);
  const freedom = new Map<string, PointFreedom>();
  if (dim > 0) {
    const N = nullSpaceBasis(J, sys.n);
    for (const id of freePoints) {
      const i = sys.varIndex.get(id)!;
      const f = pointFreedom(N.map((v) => [v[i]!, v[i + 1]!] as [number, number]));
      if (f) freedom.set(id, f);
    }
  }

  const geo = sys.geometry(q);
  const measured = new Map<string, number>();
  for (const c of sketch.constraints) {
    if (!isDimension(c)) continue;
    const ks = refKinds(sketch, c.refs);
    if (ks.some((k) => k === undefined) || !matchesSignature(c.type, ks as ('point' | 'line')[])) continue;
    measured.set(c.id, measure(c, geo, ctx.angleScale));
  }
  return { dof: dim, freePoints, freedom, redundant, unsatisfied, measured };
}

/** Points that can still move under the active constraints, at the current geometry. */
export function freePoints(sys: SketchSystem): Set<string> {
  const { J } = sys.evaluate(sys.q0());
  const { free } = nullSpaceFreedom(J, sys.n);
  const out = new Set<string>();
  for (const [id, i] of sys.varIndex) if (free[i] || free[i + 1]) out.add(id);
  return out;
}

/** Write solved positions back into the sketch. */
export function applyPositions(sketch: Sketch, sys: SketchSystem, q: number[]): void {
  for (const p of sketch.points) {
    const i = sys.varIndex.get(p.id);
    if (i === undefined) continue;
    p.x = q[i]!;
    p.y = q[i + 1]!;
  }
}

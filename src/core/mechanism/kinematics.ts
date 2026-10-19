// Planar kinematics in body coordinates (docs/DESIGN.md §5.3).
//
// Each moving body i has q_i = (x_i, y_i, phi_i): the position of its
// reference point and its rotation from the drawn pose. A point P fixed on
// body i is at r_P = r_i + A(phi_i) s'_P, where s'_P is P's offset from the
// reference point in the drawn pose (so phi_i = 0 reproduces the drawing).
//
// For a driver input t:
//   position      Phi(q, t) = 0          Newton (minimum-norm steps)
//   velocity      Phi_q q'  = -Phi_t     q' = dq/dt
//   acceleration  Phi_q q'' = gamma      gamma collects the velocity-squared terms
//
// Constraints are written as functions of point positions; their Jacobians
// follow by the chain rule (dr_P/dphi_i = r_P - r_i rotated by 90 degrees), and
// gamma from r_P'' = J_P q'' - phi_i'^2 (r_P - r_i) plus each constraint's own
// curvature (Hessian) term.

import { normInf, solveMinNorm, RowSpace } from '../math/linalg';
import { GROUND } from './types';
import type { MechanismModel, ResolvedDriver } from './model';

type Vec = [number, number];

/** A point attached to a body (or ground, body index -1). */
interface Attach {
  body: number;
  /** Offset from the body reference point in the drawn pose (absolute position for ground). */
  s: Vec;
}

type Constraint =
  | { kind: 'revolute'; p: Attach; q: Attach; joint: string }
  | { kind: 'slot'; a: Attach; b: Attach; p: Attach; len: number; joint: string }
  | { kind: 'lock'; i: number; j: number; joint: string }
  | { kind: 'rotary'; i: number; j: number; t0: number }
  | { kind: 'linear'; p: Attach; q: Attach };

const rot = (phi: number, s: Vec): Vec => {
  const c = Math.cos(phi);
  const n = Math.sin(phi);
  return [c * s[0] - n * s[1], n * s[0] + c * s[1]];
};
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];

export class KinematicSystem {
  readonly bodyIds: string[];
  readonly bodyIndex = new Map<string, number>();
  readonly n: number;
  readonly constraints: Constraint[] = [];
  /** Characteristic length of the mechanism. */
  readonly scale: number;
  readonly driver: ResolvedDriver | null;
  private readonly refPoint: Vec[];
  private readonly attachCache = new Map<string, Attach>();

  constructor(readonly model: MechanismModel) {
    this.bodyIds = model.bodies.map((b) => b.id);
    this.bodyIds.forEach((id, i) => this.bodyIndex.set(id, i));
    this.n = 3 * this.bodyIds.length;
    this.refPoint = model.bodies.map((b) => model.positions.get(b.points[0]!)!);
    this.driver = model.driver;
    let ext = 1;
    for (const [x, y] of model.positions.values()) ext = Math.max(ext, Math.abs(x), Math.abs(y));
    this.scale = ext;

    for (const j of model.joints) {
      if (j.type === 'revolute') {
        this.constraints.push({
          kind: 'revolute',
          p: this.attach(j.point, j.a),
          q: this.attach(j.point, j.b),
          joint: j.id,
        });
        continue;
      }
      const line = model.lineEnds.get(j.line);
      if (!line) continue;
      const a = this.attach(line[0], j.a);
      const b = this.attach(line[1], j.a);
      const pa = model.positions.get(line[0])!;
      const pb = model.positions.get(line[1])!;
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
      this.constraints.push({ kind: 'slot', a, b, p: this.attach(j.point, j.b), len, joint: j.id });
      if (j.type === 'slider')
        this.constraints.push({ kind: 'lock', i: this.idx(j.a), j: this.idx(j.b), joint: j.id });
    }
    const d = model.driver;
    if (d?.type === 'rotary')
      this.constraints.push({ kind: 'rotary', i: this.idx(d.body), j: this.idx(d.refBody), t0: d.t0 });
    if (d?.type === 'linear')
      this.constraints.push({
        kind: 'linear',
        p: this.attach(d.pointA, d.bodyA),
        q: this.attach(d.pointB, d.bodyB),
      });
  }

  private idx(body: string): number {
    return body === GROUND ? -1 : this.bodyIndex.get(body)!;
  }

  /** Attach a sketch point to a body (or ground). */
  attach(point: string, body: string): Attach {
    const key = `${point}@${body}`;
    let a = this.attachCache.get(key);
    if (!a) {
      const p = this.model.positions.get(point)!;
      const i = this.idx(body);
      a =
        i < 0
          ? { body: -1, s: [p[0], p[1]] }
          : { body: i, s: [p[0] - this.refPoint[i]![0], p[1] - this.refPoint[i]![1]] };
      this.attachCache.set(key, a);
    }
    return a;
  }

  q0(): number[] {
    const q: number[] = [];
    for (const r of this.refPoint) q.push(r[0], r[1], 0);
    return q;
  }

  /** Position of an attached point. */
  pos(q: number[], a: Attach): Vec {
    if (a.body < 0) return a.s;
    const k = 3 * a.body;
    const d = rot(q[k + 2]!, a.s);
    return [q[k]! + d[0], q[k + 1]! + d[1]];
  }

  /** Velocity of an attached point given q' (any time derivative). */
  vel(q: number[], qd: number[], a: Attach): Vec {
    if (a.body < 0) return [0, 0];
    const k = 3 * a.body;
    const d = rot(q[k + 2]!, a.s);
    const w = qd[k + 2]!;
    return [qd[k]! - w * d[1], qd[k + 1]! + w * d[0]];
  }

  /** Acceleration of an attached point given q' and q''. */
  acc(q: number[], qd: number[], qdd: number[], a: Attach): Vec {
    if (a.body < 0) return [0, 0];
    const k = 3 * a.body;
    const d = rot(q[k + 2]!, a.s);
    const w = qd[k + 2]!;
    const al = qdd[k + 2]!;
    return [qdd[k]! - al * d[1] - w * w * d[0], qdd[k + 1]! + al * d[0] - w * w * d[1]];
  }

  /** Add g . dr_P/dq to a Jacobian row. */
  private addPointGrad(row: number[], q: number[], a: Attach, g: Vec): void {
    if (a.body < 0) return;
    const k = 3 * a.body;
    const d = rot(q[k + 2]!, a.s);
    row[k]! += g[0];
    row[k + 1]! += g[1];
    row[k + 2]! += g[0] * -d[1] + g[1] * d[0];
  }

  /** Centripetal part of a point's acceleration: -phi'^2 (r_P - r_i). */
  private centripetal(q: number[], qd: number[], a: Attach): Vec {
    if (a.body < 0) return [0, 0];
    const k = 3 * a.body;
    const d = rot(q[k + 2]!, a.s);
    const w = qd[k + 2]!;
    return [-w * w * d[0], -w * w * d[1]];
  }

  /** Number of constraint equations. */
  get m(): number {
    return this.constraints.reduce((s, c) => s + (c.kind === 'revolute' ? 2 : 1), 0);
  }

  /** Residual Phi(q, t). */
  residual(q: number[], t: number): number[] {
    const r: number[] = [];
    for (const c of this.constraints) {
      switch (c.kind) {
        case 'revolute': {
          const a = this.pos(q, c.p);
          const b = this.pos(q, c.q);
          r.push(a[0] - b[0], a[1] - b[1]);
          break;
        }
        case 'slot': {
          const A = this.pos(q, c.a);
          const B = this.pos(q, c.b);
          const P = this.pos(q, c.p);
          r.push(cross([B[0] - A[0], B[1] - A[1]], [P[0] - A[0], P[1] - A[1]]) / c.len);
          break;
        }
        case 'lock':
          r.push(this.phi(q, c.j) - this.phi(q, c.i));
          break;
        case 'rotary':
          r.push(this.scale * (this.phi(q, c.i) - this.phi(q, c.j) - (t - c.t0)));
          break;
        case 'linear': {
          const a = this.pos(q, c.p);
          const b = this.pos(q, c.q);
          r.push(Math.hypot(a[0] - b[0], a[1] - b[1]) - t);
          break;
        }
      }
    }
    return r;
  }

  private phi(q: number[], i: number): number {
    return i < 0 ? 0 : q[3 * i + 2]!;
  }

  /** Jacobian dPhi/dq (m x n). */
  jacobian(q: number[]): number[][] {
    const J: number[][] = [];
    const row = () => new Array<number>(this.n).fill(0);
    for (const c of this.constraints) {
      switch (c.kind) {
        case 'revolute': {
          const rx = row();
          const ry = row();
          this.addPointGrad(rx, q, c.p, [1, 0]);
          this.addPointGrad(rx, q, c.q, [-1, 0]);
          this.addPointGrad(ry, q, c.p, [0, 1]);
          this.addPointGrad(ry, q, c.q, [0, -1]);
          J.push(rx, ry);
          break;
        }
        case 'slot': {
          const A = this.pos(q, c.a);
          const B = this.pos(q, c.b);
          const P = this.pos(q, c.p);
          const u: Vec = [B[0] - A[0], B[1] - A[1]];
          const w: Vec = [P[0] - A[0], P[1] - A[1]];
          // f = (u x w)/L: df/dP = (-uy, ux)/L; df/dB = (wy, -wx)/L; df/dA = -(df/dP + df/dB)
          const dP: Vec = [-u[1] / c.len, u[0] / c.len];
          const dB: Vec = [w[1] / c.len, -w[0] / c.len];
          const r = row();
          this.addPointGrad(r, q, c.p, dP);
          this.addPointGrad(r, q, c.b, dB);
          this.addPointGrad(r, q, c.a, [-dP[0] - dB[0], -dP[1] - dB[1]]);
          J.push(r);
          break;
        }
        case 'lock': {
          const r = row();
          if (c.j >= 0) r[3 * c.j + 2] = 1;
          if (c.i >= 0) r[3 * c.i + 2]! -= 1;
          J.push(r);
          break;
        }
        case 'rotary': {
          const r = row();
          if (c.i >= 0) r[3 * c.i + 2] = this.scale;
          if (c.j >= 0) r[3 * c.j + 2]! -= this.scale;
          J.push(r);
          break;
        }
        case 'linear': {
          const a = this.pos(q, c.p);
          const b = this.pos(q, c.q);
          const d: Vec = [a[0] - b[0], a[1] - b[1]];
          const len = Math.max(Math.hypot(d[0], d[1]), 1e-12);
          const e: Vec = [d[0] / len, d[1] / len];
          const r = row();
          this.addPointGrad(r, q, c.p, e);
          this.addPointGrad(r, q, c.q, [-e[0], -e[1]]);
          J.push(r);
          break;
        }
      }
    }
    return J;
  }

  /** dPhi/dt (the driver row only). */
  residualT(): number[] {
    return this.constraints.flatMap((c) =>
      c.kind === 'revolute' ? [0, 0] : c.kind === 'rotary' ? [-this.scale] : c.kind === 'linear' ? [-1] : [0],
    );
  }

  /** gamma: right-hand side of Phi_q q'' = gamma (constant driver rate). */
  gamma(q: number[], qd: number[]): number[] {
    const g: number[] = [];
    for (const c of this.constraints) {
      switch (c.kind) {
        case 'revolute': {
          const a = this.centripetal(q, qd, c.p);
          const b = this.centripetal(q, qd, c.q);
          g.push(-(a[0] - b[0]), -(a[1] - b[1]));
          break;
        }
        case 'slot': {
          const A = this.pos(q, c.a);
          const B = this.pos(q, c.b);
          const P = this.pos(q, c.p);
          const u: Vec = [B[0] - A[0], B[1] - A[1]];
          const w: Vec = [P[0] - A[0], P[1] - A[1]];
          const vA = this.vel(q, qd, c.a);
          const vB = this.vel(q, qd, c.b);
          const vP = this.vel(q, qd, c.p);
          const ud: Vec = [vB[0] - vA[0], vB[1] - vA[1]];
          const wd: Vec = [vP[0] - vA[0], vP[1] - vA[1]];
          const cA = this.centripetal(q, qd, c.a);
          const cB = this.centripetal(q, qd, c.b);
          const cP = this.centripetal(q, qd, c.p);
          const uc: Vec = [cB[0] - cA[0], cB[1] - cA[1]];
          const wc: Vec = [cP[0] - cA[0], cP[1] - cA[1]];
          g.push(-(cross(uc, w) + cross(u, wc) + 2 * cross(ud, wd)) / c.len);
          break;
        }
        case 'lock':
        case 'rotary':
          g.push(0);
          break;
        case 'linear': {
          const a = this.pos(q, c.p);
          const b = this.pos(q, c.q);
          const d: Vec = [a[0] - b[0], a[1] - b[1]];
          const len = Math.max(Math.hypot(d[0], d[1]), 1e-12);
          const e: Vec = [d[0] / len, d[1] / len];
          const va = this.vel(q, qd, c.p);
          const vb = this.vel(q, qd, c.q);
          const dd: Vec = [va[0] - vb[0], va[1] - vb[1]];
          const ca = this.centripetal(q, qd, c.p);
          const cb = this.centripetal(q, qd, c.q);
          const curv = (dd[0] * dd[0] + dd[1] * dd[1] - (e[0] * dd[0] + e[1] * dd[1]) ** 2) / len;
          g.push(-(e[0] * (ca[0] - cb[0]) + e[1] * (ca[1] - cb[1]) + curv));
          break;
        }
      }
    }
    return g;
  }

  /** Degrees of freedom without the driver (from the Jacobian rank at the drawn pose). */
  mobility(): number {
    const q = this.q0();
    const space = new RowSpace(1e-8);
    let rank = 0;
    const J = this.jacobian(q);
    let k = 0;
    for (const c of this.constraints) {
      const rows = c.kind === 'revolute' ? 2 : 1;
      for (let r = 0; r < rows; r++, k++) {
        if (c.kind === 'rotary' || c.kind === 'linear') continue;
        if (space.add(J[k]!)) rank++;
      }
    }
    return this.n - rank;
  }

  /** Solve positions for input t from a starting guess. */
  solvePosition(qGuess: number[], t: number, maxIter = 40): { q: number[]; ok: boolean } {
    let q = qGuess.slice();
    let r = this.residual(q, t);
    let err = normInf(r);
    const tol = 1e-10 * this.scale;
    for (let it = 0; it < maxIter && err > tol; it++) {
      const dq = solveMinNorm(
        this.jacobian(q),
        r.map((v) => -v),
      );
      let alpha = 1;
      let improved = false;
      for (let k = 0; k < 10; k++) {
        const qn = q.map((v, i) => v + alpha * dq[i]!);
        const rn = this.residual(qn, t);
        const en = normInf(rn);
        if (en < err) {
          q = qn;
          r = rn;
          err = en;
          improved = true;
          break;
        }
        alpha /= 2;
      }
      if (!improved) break;
    }
    return { q, ok: err <= tol * 1e3 };
  }

  /** Velocity and acceleration coefficients (derivatives with respect to the input). */
  derivatives(q: number[]): { qd: number[]; qdd: number[] } {
    const J = this.jacobian(q);
    const qd = solveMinNorm(
      J,
      this.residualT().map((v) => -v),
      1e-14,
    );
    const qdd = solveMinNorm(J, this.gamma(q, qd), 1e-14);
    return { qd, qdd };
  }
}

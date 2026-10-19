// Distance to a cam's pitch curve: what a cam joint in a linkage keeps at
// zero (the roller centre stays on the pitch curve, so the roller touches the
// cam surface).

import type { PitchCurve } from './analysis';

type Vec = [number, number];
const TWO_PI = 2 * Math.PI;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

export interface CurveHit {
  /** Signed distance: + outside the cam (away from its centre), - inside. */
  d: number;
  /** Curve parameter of the closest point. */
  theta: number;
  /** Outward unit normal at the closest point (cam frame). */
  n: Vec;
}

/** Closest point on the pitch curve to X (cam frame), starting from a hint when given. */
export function closest(curve: PitchCurve, X: Vec, hint?: number): CurveHit {
  const refine = (t0: number) => {
    let t = t0;
    for (let it = 0; it < 30; it++) {
      const { P, d1, d2 } = curve.at(t);
      const r: Vec = [P[0] - X[0], P[1] - X[1]];
      const f = dot(r, d1);
      const df = dot(d1, d1) + dot(r, d2);
      if (!(df > 0)) break;
      const step = f / df;
      t -= Math.max(-0.2, Math.min(0.2, step));
      if (Math.abs(step) < 1e-14) break;
    }
    return ((t % TWO_PI) + TWO_PI) % TWO_PI;
  };
  const dist = (t: number) => {
    const { P } = curve.at(t);
    return Math.hypot(P[0] - X[0], P[1] - X[1]);
  };
  let t = hint;
  if (t !== undefined) t = refine(t);
  // A coarse global search when there is no hint or the hint slid to a worse local minimum.
  if (t === undefined || dist(t) > 1e-6 + coarse(curve, X).dist) t = refine(coarse(curve, X).t);
  const { P, d1 } = curve.at(t);
  const len = Math.hypot(d1[0], d1[1]) || 1;
  let n: Vec = [-d1[1] / len, d1[0] / len];
  if (dot(n, P) < 0) n = [-n[0], -n[1]];
  return { d: dot([X[0] - P[0], X[1] - P[1]], n), theta: t, n };
}

function coarse(curve: PitchCurve, X: Vec): { t: number; dist: number } {
  let best = { t: 0, dist: Infinity };
  const N = 360;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * TWO_PI;
    const { P } = curve.at(t);
    const d = Math.hypot(P[0] - X[0], P[1] - X[1]);
    if (d < best.dist) best = { t, dist: d };
  }
  return best;
}

/**
 * Mount angle that puts a roller centre at offset D from the cam centre
 * (world frame, drawn pose) on the pitch curve. Among the solutions, the one
 * nearest the start of the motion program (cam angle 0) is preferred.
 * Null when D is closer than the curve's nearest point or beyond its farthest.
 */
export function fitMountAngle(curve: PitchCurve, D: Vec): number | null {
  // X(alpha) = R(-alpha) D: the roller centre seen from a cam turned by alpha.
  const at = (alpha: number) => {
    const c = Math.cos(-alpha);
    const s = Math.sin(-alpha);
    return closest(curve, [c * D[0] - s * D[1], s * D[0] + c * D[1]]);
  };
  const N = 720;
  const roots: { alpha: number; theta: number }[] = [];
  let prev = at(0);
  for (let k = 1; k <= N; k++) {
    const a1 = (k / N) * TWO_PI;
    const cur = at(a1);
    if (prev.d === 0 || prev.d * cur.d < 0) {
      let lo = ((k - 1) / N) * TWO_PI;
      let hi = a1;
      let flo = prev.d;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        const fm = at(mid).d;
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      const alpha = (lo + hi) / 2;
      roots.push({ alpha, theta: at(alpha).theta });
    }
    prev = cur;
  }
  if (!roots.length) return null;
  const fromStart = (t: number) => Math.min(t, TWO_PI - t);
  roots.sort((a, b) => fromStart(a.theta) - fromStart(b.theta));
  return roots[0]!.alpha;
}

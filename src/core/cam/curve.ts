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
  /** Newton on the closest-point condition; null if it doesn't settle. */
  const refine = (t0: number): number | null => {
    let t = t0;
    for (let it = 0; it < 30; it++) {
      const { P, d1, d2 } = curve.at(t);
      const r: Vec = [P[0] - X[0], P[1] - X[1]];
      const f = dot(r, d1);
      const df = dot(d1, d1) + dot(r, d2);
      if (!(df > 0)) return null;
      const step = f / df;
      t -= Math.max(-0.2, Math.min(0.2, step));
      if (Math.abs(step) < 1e-13) return ((t % TWO_PI) + TWO_PI) % TWO_PI;
    }
    return null;
  };
  // Warm start from the hint (the previous position along a sweep). A global
  // search is only needed without one, if Newton doesn't settle, or if the
  // point is far from the curve (where a nearer stretch could exist).
  let t = hint !== undefined ? refine(hint) : null;
  if (t !== null) {
    const { P, d1 } = curve.at(t);
    const far = Math.hypot(P[0] - X[0], P[1] - X[1]) > 0.05 * Math.hypot(d1[0], d1[1]);
    if (far) t = null;
  }
  if (t === null) {
    const c = coarse(curve, X).t;
    t = refine(c) ?? c;
  }
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
  // Turning the cam keeps distances from its centre, so the roller is on the
  // curve where |P(theta)| equals its own distance; the angle then follows.
  const rD = Math.hypot(D[0], D[1]);
  const f = (t: number) => {
    const { P } = curve.at(t);
    return Math.hypot(P[0], P[1]) - rD;
  };
  const N = 720;
  const roots: number[] = [];
  let f0 = f(0);
  for (let k = 1; k <= N; k++) {
    const t1 = (k / N) * TWO_PI;
    const f1 = f(t1);
    if (f0 === 0) roots.push(((k - 1) / N) * TWO_PI);
    else if (f0 * f1 < 0) {
      let lo = ((k - 1) / N) * TWO_PI;
      let hi = t1;
      let flo = f0;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (flo * fm <= 0) hi = mid;
        else {
          lo = mid;
          flo = fm;
        }
      }
      roots.push((lo + hi) / 2);
    }
    f0 = f1;
  }
  if (!roots.length) return null;
  // Prefer the root nearest the start of the motion program (cam angle 0).
  const fromStart = (t: number) => Math.min(t, TWO_PI - t);
  const theta = roots.reduce((best, t) => (fromStart(t) < fromStart(best) ? t : best), roots[0]!);
  const { P } = curve.at(theta);
  return Math.atan2(D[1], D[0]) - Math.atan2(P[1], P[0]);
}

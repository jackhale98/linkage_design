// Sweep the driver through a range, starting from the drawn pose.
//
// The solution is continued step by step (with a linear predictor) forwards
// and backwards from the drawn input, so it stays on the assembly branch the
// user drew. A step that fails, or that jumps (Newton crossed a toggle onto
// the other branch), is retried in smaller sub-steps; if it still fails the
// mechanism has hit a limit (toggle) position, which is then located by
// bisection.

import type { KinematicSystem } from './kinematics';

export interface Frame {
  /** Driver input in solver units (radians or length). */
  t: number;
  q: number[];
  /** dq/dt and d2q/dt2 with respect to the driver input. */
  qd: number[];
  qdd: number[];
}

export interface SweepResult {
  /** Driver inputs (solver units) from start to end. */
  inputs: number[];
  /** Solution at each input, or null where the mechanism can't reach. */
  frames: (Frame | null)[];
  /** First and last reachable index. */
  first: number;
  last: number;
  /** Where motion stops short of the requested start or end (solver units). */
  limits: { start?: number; end?: number };
  /** The driver turns a full revolution. */
  fullRotation: boolean;
  /** Input of the drawn pose (solver units). */
  t0: number;
  error?: string;
}

export interface SweepRange {
  start: number;
  end: number;
  steps: number;
}

const TWO_PI = 2 * Math.PI;

function maxJump(sys: KinematicSystem, a: number[], b: number[]): { pos: number; ang: number } {
  let pos = 0;
  let ang = 0;
  for (let i = 0; i < a.length; i += 3) {
    pos = Math.max(pos, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!));
    ang = Math.max(ang, Math.abs(a[i + 2]! - b[i + 2]!));
  }
  return { pos: pos / sys.scale, ang };
}

/** One continuation step from (t, q) to tn, subdividing if needed. */
function step(
  sys: KinematicSystem,
  t: number,
  q: number[],
  qd: number[],
  tn: number,
  depth = 0,
): number[] | null {
  const guess = q.map((v, i) => v + qd[i]! * (tn - t));
  const res = sys.solvePosition(guess, tn);
  if (res.ok) {
    const j = maxJump(sys, res.q, guess);
    // Small residual jump from the predictor means we stayed on the branch.
    if (j.pos < 0.05 && j.ang < 0.2) return res.q;
  }
  if (depth >= 3) return null;
  const parts = 4;
  let tc = t;
  let qc = q;
  let qdc = qd;
  for (let k = 1; k <= parts; k++) {
    const tk = t + ((tn - t) * k) / parts;
    const next = step(sys, tc, qc, qdc, tk, depth + 1);
    if (!next) return null;
    tc = tk;
    qc = next;
    qdc = sys.derivatives(qc).qd;
  }
  return qc;
}

/** Locate the limit between a reachable input ta and an unreachable tb. */
function findLimit(sys: KinematicSystem, ta: number, qa: number[], tb: number): number {
  let qdA = sys.derivatives(qa).qd;
  for (let k = 0; k < 30; k++) {
    const tm = (ta + tb) / 2;
    const qm = step(sys, ta, qa, qdA, tm, 2);
    if (qm) {
      ta = tm;
      qa = qm;
      qdA = sys.derivatives(qa).qd;
    } else {
      tb = tm;
    }
  }
  return ta;
}

export function sweep(sys: KinematicSystem, range: SweepRange): SweepResult {
  const steps = Math.max(1, Math.round(range.steps));
  const inputs = Array.from(
    { length: steps + 1 },
    (_, k) => range.start + ((range.end - range.start) * k) / steps,
  );
  const frames: (Frame | null)[] = inputs.map(() => null);
  const empty = (error: string, t0 = 0): SweepResult => ({
    inputs,
    frames,
    first: -1,
    last: -1,
    limits: {},
    fullRotation: false,
    t0,
    error,
  });
  const d = sys.driver;
  if (!d) return empty('No driver: choose the input that moves the mechanism');

  // Place the drawn input within the range (rotary inputs are periodic).
  let t0 = d.t0;
  const lo = Math.min(range.start, range.end);
  const hi = Math.max(range.start, range.end);
  if (d.type === 'rotary') {
    const k = Math.round(((lo + hi) / 2 - t0) / TWO_PI);
    t0 += k * TWO_PI;
    if (t0 < lo - 1e-9) t0 += TWO_PI;
    if (t0 > hi + 1e-9) t0 -= TWO_PI;
  }

  const q0 = sys.q0();
  const at0 = sys.solvePosition(q0, t0);
  if (!at0.ok) return empty("The drawn pose doesn't satisfy the joints; check the sketch", t0);

  // Index nearest the drawn input, then walk there from the drawn pose.
  let k0 = 0;
  for (let k = 1; k < inputs.length; k++) if (Math.abs(inputs[k]! - t0) < Math.abs(inputs[k0]! - t0)) k0 = k;
  const span = Math.abs(range.end - range.start) / steps || 1e-3;
  let q = at0.q;
  let t = t0;
  const approach = Math.max(1, Math.ceil(Math.abs(inputs[k0]! - t0) / span));
  for (let s = 1; s <= approach; s++) {
    const tn = t0 + ((inputs[k0]! - t0) * s) / approach;
    const next = step(sys, t, q, sys.derivatives(q).qd, tn);
    if (!next) return empty("The mechanism can't move from the drawn pose into the requested range", t0);
    q = next;
    t = tn;
  }
  const at = (k: number, qk: number[]) => {
    const { qd, qdd } = sys.derivatives(qk);
    frames[k] = { t: inputs[k]!, q: qk, qd, qdd };
  };
  at(k0, q);

  const limits: SweepResult['limits'] = {};
  const march = (dir: 1 | -1) => {
    let k = k0;
    while (k + dir >= 0 && k + dir < inputs.length) {
      const f = frames[k]!;
      const next = step(sys, f.t, f.q, f.qd, inputs[k + dir]!);
      if (!next) {
        limits[dir > 0 ? 'end' : 'start'] = findLimit(sys, f.t, f.q, inputs[k + dir]!);
        return;
      }
      k += dir;
      at(k, next);
    }
  };
  march(1);
  march(-1);

  const first = frames.findIndex((f) => f !== null);
  let last = frames.length - 1;
  while (last >= 0 && frames[last] === null) last--;
  const fullRotation =
    d.type === 'rotary' && first === 0 && last === inputs.length - 1 && hi - lo >= TWO_PI - 1e-9;
  return { inputs, frames, first, last, limits, fullRotation, t0 };
}

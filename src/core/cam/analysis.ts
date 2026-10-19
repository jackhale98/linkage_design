// Cam analysis on one generic code path (docs/DESIGN.md §7).
//
// Every follower is either a point follower (roller or knife edge: its
// roller centre traces the pitch curve) or a line follower (flat face: the
// cam is the envelope of the face lines). Both are described in the ground
// frame as functions of the follower coordinate s; the cam frame is the
// ground frame turned back by the cam angle. The profile, pressure angle,
// curvature, contact force and cam torque all follow from that description.

import { inertiaFactor, type ForceUnits } from '../forces/types';
import { buildProgram, fundamentalLaw, svaj, type Program, type ProgramIssue } from './program';
import { isOscillating, isRoller, type CamData } from './types';

type Vec = [number, number];
const DEG = Math.PI / 180;

const rot = (a: number, [x, y]: Vec): Vec => [
  Math.cos(a) * x - Math.sin(a) * y,
  Math.sin(a) * x + Math.cos(a) * y,
];
const cross = (a: Vec, b: Vec) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const unit = (a: Vec): Vec => {
  const n = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / n, a[1] / n];
};

/** The follower in the ground frame as a function of its coordinate s (length, or radians). */
type Geometry =
  | {
      kind: 'point';
      /** Roller centre, and its rate of change with s. */
      centre: (s: number) => Vec;
      dcentre: (s: number) => Vec;
      d2centre: (s: number) => Vec;
      radius: number;
      pivot?: Vec;
    }
  | {
      kind: 'line';
      /** Face line { X : m . X = p }, m the unit normal pointing from the cam to the follower. */
      normalAngle: (s: number) => number;
      dNormalAngle: number; // d(angle)/ds
      support: (s: number) => number;
      dSupport: (s: number) => number;
      d2Support: (s: number) => number;
      /** Velocity of a follower point X per unit s. */
      pointRate: (X: Vec, s: number) => Vec;
      /** Position of X along the face (for the face width). */
      along: (X: Vec, s: number) => number;
      pivot?: Vec;
    };

const J = ([x, y]: Vec): Vec => [-y, x]; // turn 90 degrees

type PointGeometry = Extract<Geometry, { kind: 'point' }>;

/**
 * The pitch curve (roller-centre path) in the cam frame at cam angle theta,
 * with its first and second derivatives, exact (chain rule through the cam
 * rotation R(-sigma theta) and the motion program).
 */
function pointCurve(
  g: PointGeometry,
  program: Program,
  sigma: number,
  theta: number,
): { P: Vec; d1: Vec; d2: Vec } {
  const m = svaj(program, theta);
  const R = (v: Vec) => rot(-sigma * theta, v);
  const RC = R(g.centre(m.s));
  const RCs = R(g.dcentre(m.s));
  const RCss = R(g.d2centre(m.s));
  const jc = J(RC);
  const js = J(RCs);
  return {
    P: RC,
    d1: [-sigma * jc[0] + RCs[0] * m.v, -sigma * jc[1] + RCs[1] * m.v],
    d2: [
      -RC[0] - 2 * sigma * js[0] * m.v + RCss[0] * m.v * m.v + RCs[0] * m.a,
      -RC[1] - 2 * sigma * js[1] * m.v + RCss[1] * m.v * m.v + RCs[1] * m.a,
    ],
  };
}

/** A cam's pitch curve as an exact function, for mounting the cam in a linkage. */
export interface PitchCurve {
  /** Point and derivatives at curve parameter theta (the cam angle of the design, radians). */
  at(theta: number): { P: Vec; d1: Vec; d2: Vec };
  /** The roller that runs on it. */
  rollerRadius: number;
}

/** The pitch curve of a roller or knife-edge cam design; flat-faced designs have none. */
export function camPitchCurve(cam: CamData): PitchCurve | CamGeometryError {
  const program = buildProgram(cam);
  const bad = program.issues.find((i) => i.severity === 'error');
  if (bad) return { message: `${cam.id}: ${bad.message}` };
  const g = geometry(cam);
  if ('message' in g) return { message: `${cam.id}: ${g.message}` };
  if (g.kind !== 'point')
    return {
      message: `${cam.id} is designed for a flat-faced follower; mount a roller or knife-edge design`,
    };
  const sigma = cam.rotation === 'ccw' ? 1 : -1;
  return { at: (theta) => pointCurve(g, program, sigma, theta), rollerRadius: g.radius };
}

export interface CamGeometryError {
  message: string;
}

function geometry(cam: CamData): Geometry | CamGeometryError {
  const Rb = cam.baseRadius;
  const r = isRoller(cam.follower) ? cam.rollerRadius : 0;
  const Rp = Rb + r; // prime circle
  if (!(Rb > 0)) return { message: 'The base circle radius must be greater than zero' };
  switch (cam.follower) {
    case 'translating_roller': {
      const e = cam.offset;
      if (Math.abs(e) >= Rp)
        return { message: 'The offset must be smaller than the prime circle radius (base + roller)' };
      const y0 = Math.sqrt(Rp * Rp - e * e);
      return {
        kind: 'point',
        centre: (s) => [e, y0 + s],
        dcentre: () => [0, 1],
        d2centre: () => [0, 0],
        radius: r,
      };
    }
    case 'oscillating_roller': {
      const d = cam.pivotDistance;
      const L = cam.armLength;
      const c = (Rp * Rp - d * d - L * L) / (2 * d * L);
      if (!(d > 0 && L > 0) || Math.abs(c) > 1)
        return {
          message:
            'The arm cannot reach the prime circle from the pivot: change the pivot distance or arm length',
        };
      const psi0 = Math.acos(c); // roller above the line from cam centre to pivot
      const A: Vec = [d, 0];
      return {
        kind: 'point',
        // Lift turns the arm so the roller moves away from the cam.
        centre: (s) => [A[0] + L * Math.cos(psi0 - s), A[1] + L * Math.sin(psi0 - s)],
        dcentre: (s) => [L * Math.sin(psi0 - s), -L * Math.cos(psi0 - s)],
        d2centre: (s) => [-L * Math.cos(psi0 - s), -L * Math.sin(psi0 - s)],
        radius: r,
        pivot: A,
      };
    }
    case 'translating_flat': {
      const e = cam.offset;
      return {
        kind: 'line',
        normalAngle: () => Math.PI / 2,
        dNormalAngle: 0,
        support: (s) => Rb + s,
        dSupport: () => 1,
        d2Support: () => 0,
        pointRate: () => [0, 1],
        along: (X) => X[0] - e,
      };
    }
    case 'oscillating_flat': {
      const d = cam.pivotDistance;
      if (!(d > Rb)) return { message: 'The pivot must be outside the base circle' };
      const psi0 = Math.asin(Rb / d);
      const A: Vec = [d, 0];
      return {
        kind: 'line',
        // Face through the pivot at angle psi = psi0 + s; normal (sin psi, -cos psi).
        normalAngle: (s) => psi0 + s - Math.PI / 2,
        dNormalAngle: 1,
        support: (s) => d * Math.sin(psi0 + s),
        dSupport: (s) => d * Math.cos(psi0 + s),
        d2Support: (s) => -d * Math.sin(psi0 + s),
        pointRate: (X) => [-(X[1] - A[1]), X[0] - A[0]],
        along: (X, s) => dot([X[0] - A[0], X[1] - A[1]], [Math.cos(psi0 + s), Math.sin(psi0 + s)]),
        pivot: A,
      };
    }
  }
}

export interface CamSample {
  /** Cam angle (degrees) and time (s). */
  angle: number;
  time: number;
  /** Follower displacement (length, or degrees) and its time derivatives. */
  s: number;
  v: number;
  a: number;
  j: number;
  /** Pressure angle (degrees, signed). */
  pressure: number;
  /** Radius of curvature of the pitch curve (rollers) and of the cam surface; + convex, - concave. */
  rhoPitch: number;
  rhoSurface: number;
  /** Cam surface and pitch curve points in the cam frame. */
  surface: Vec;
  pitch: Vec;
  /** Flat faces: contact position along the face. */
  along: number;
  /** Contact force (+ pressing) and the cam shaft torque it needs. */
  force: number;
  torque: number;
}

export interface CamAnalysis {
  ok: boolean;
  program: Program;
  samples: CamSample[];
  issues: ProgramIssue[];
  summary: {
    maxPressure: { value: number; at: number };
    minRhoPitch: { value: number; at: number } | null;
    minRhoSurface: { value: number; at: number };
    undercut: number[];
    faceWidth: { min: number; max: number } | null;
    force: { min: number; max: number; minAt: number };
    jump: number[];
    torque: { min: number; max: number };
    lift: number;
  };
}

/** Everything about the cam at its analysis resolution. */
export function analyzeCam(cam: CamData, units: ForceUnits): CamAnalysis {
  const program = buildProgram(cam);
  const issues: ProgramIssue[] = [...program.issues];
  const empty = (): CamAnalysis => ({
    ok: false,
    program,
    samples: [],
    issues,
    summary: {
      maxPressure: { value: 0, at: 0 },
      minRhoPitch: null,
      minRhoSurface: { value: 0, at: 0 },
      undercut: [],
      faceWidth: null,
      force: { min: 0, max: 0, minAt: 0 },
      jump: [],
      torque: { min: 0, max: 0 },
      lift: 0,
    },
  });
  if (program.issues.some((i) => i.severity === 'error')) return empty();
  issues.push(...fundamentalLaw(program));
  const g = geometry(cam);
  if ('message' in g) {
    issues.push({ severity: 'error', message: g.message });
    return empty();
  }

  const sigma = cam.rotation === 'ccw' ? 1 : -1;
  const omega = (cam.speed * 2 * Math.PI) / 60;
  const fI = inertiaFactor(units);
  const toDisplay = isOscillating(cam.follower) ? 1 / DEG : 1;
  const step = Math.max(0.01, cam.step);
  const n = Math.max(8, Math.round(360 / step));

  const samples: CamSample[] = [];
  for (let k = 0; k < n; k++) {
    const angle = (k * 360) / n;
    const theta = angle * DEG;
    const m = svaj(program, theta);
    // Cam-frame curve (pitch curve, or the cam surface for flat faces), its
    // derivative, and its radius of curvature (+ convex), all exact.
    let c0: Vec;
    let d1: Vec;
    let rho: number;
    if (g.kind === 'point') {
      const pc = pointCurve(g, program, sigma, theta);
      c0 = pc.P;
      d1 = pc.d1;
      const d2 = pc.d2;
      const turn = Math.sign(cross(c0, d1)) || 1;
      const k2 = cross(d1, d2);
      rho = k2 === 0 ? Infinity : (turn * Math.hypot(d1[0], d1[1]) ** 3) / k2;
    } else {
      // Envelope of the face lines m . X = p in the cam frame (support function p(alpha)).
      const ac = g.normalAngle(m.s) - sigma * theta;
      const p = g.support(m.s);
      const dp = g.dSupport(m.s) * m.v;
      const d2p = g.d2Support(m.s) * m.v * m.v + g.dSupport(m.s) * m.a;
      const da = g.dNormalAngle * m.v - sigma;
      const d2a = g.dNormalAngle * m.a;
      const q = dp / da;
      c0 = [p * Math.cos(ac) - q * Math.sin(ac), p * Math.sin(ac) + q * Math.cos(ac)];
      d1 = [0, 0];
      rho = p + (d2p * da - dp * d2a) / da ** 3;
    }

    let surface: Vec;
    let normalG: Vec; // contact normal in the ground frame, cam to follower
    let rate: Vec; // follower contact point velocity per unit s

    let along = NaN;
    let rhoPitch = NaN;
    let rhoSurface: number;
    if (g.kind === 'point') {
      const t = unit(d1);
      let nc: Vec = [-t[1], t[0]];
      if (dot(nc, c0) < 0) nc = [-nc[0], -nc[1]];
      surface = [c0[0] - g.radius * nc[0], c0[1] - g.radius * nc[1]];
      normalG = rot(sigma * theta, nc);
      rate = g.dcentre(m.s);
      rhoPitch = rho;
      rhoSurface = rho - g.radius;
    } else {
      surface = c0;
      const a = g.normalAngle(m.s);
      normalG = [Math.cos(a), Math.sin(a)];
      const contactG = rot(sigma * theta, surface);
      rate = g.pointRate(contactG, m.s);
      along = g.along(contactG, m.s);
      rhoSurface = rho;
    }
    const nr = dot(normalG, rate);
    const phi = Math.atan2(cross(unit(rate), normalG), dot(unit(rate), normalG)) / DEG;
    const pressure = Math.abs(phi) < 1e-9 ? 0 : phi; // exact zero for flat faces, not round-off
    // Load the cam must carry along the follower coordinate: inertia, spring, preload, external load.
    const G = cam.mass * m.a * omega * omega * fI + cam.springRate * m.s + cam.preload + cam.load;
    samples.push({
      angle,
      time: theta / omega,
      s: m.s * toDisplay,
      v: m.v * omega * toDisplay,
      a: m.a * omega * omega * toDisplay,
      j: m.j * omega ** 3 * toDisplay,
      pressure,
      rhoPitch,
      rhoSurface,
      surface,
      pitch: g.kind === 'point' ? c0 : surface,
      along,
      force: Math.abs(nr) > 1e-12 ? G / nr : NaN,
      torque: G * m.v,
    });
  }

  // Summary and checks.
  const maxBy = (f: (x: CamSample) => number) =>
    samples.reduce((best, x) => (f(x) > f(best) ? x : best), samples[0]!);
  const pMax = maxBy((x) => Math.abs(x.pressure));
  const convex = (f: (x: CamSample) => number) => samples.filter((x) => f(x) > 0 && Number.isFinite(f(x)));
  const minOf = (xs: CamSample[], f: (x: CamSample) => number) =>
    xs.length ? xs.reduce((best, x) => (f(x) < f(best) ? x : best), xs[0]!) : null;
  const rp =
    g.kind === 'point'
      ? minOf(
          convex((x) => x.rhoPitch),
          (x) => x.rhoPitch,
        )
      : null;
  const rsAll = minOf(
    samples.filter((x) => Number.isFinite(x.rhoSurface)),
    (x) => x.rhoSurface,
  )!;
  const r = g.kind === 'point' ? g.radius : 0;
  const undercutAt = samples.filter((x) =>
    g.kind === 'point' ? x.rhoPitch > 0 && x.rhoPitch < r : x.rhoSurface < 0,
  );
  const undercut = ranges(
    undercutAt.map((x) => x.angle),
    360 / n,
  );
  const forces = samples.map((x) => x.force).filter(Number.isFinite);
  const fMin = minOf(
    samples.filter((x) => Number.isFinite(x.force)),
    (x) => x.force,
  );
  const jumpAt = samples.filter(
    (x) => x.force <= 0 && (cam.mass > 0 || cam.springRate > 0 || cam.preload > 0 || cam.load > 0),
  );
  const torques = samples.map((x) => x.torque);
  const alongs = samples.map((x) => x.along).filter(Number.isFinite);

  if (Math.abs(pMax.pressure) > cam.pressureLimit)
    issues.push({
      severity: 'warning',
      at: pMax.angle,
      message: `Pressure angle reaches ${fmtN(Math.abs(pMax.pressure))}° at ${fmtN(pMax.angle)}° (limit ${fmtN(cam.pressureLimit)}°): increase the base circle${g.kind === 'point' && !isOscillating(cam.follower) ? ' or use an offset' : ''}`,
    });
  if (undercut.length)
    issues.push({
      severity: 'error',
      at: undercut[0],
      message:
        g.kind === 'point'
          ? `Undercut: the pitch curve is sharper than the roller near ${undercut.map((a) => `${fmtN(a)}°`).join(', ')}. Use a smaller roller, a larger base circle or a gentler law.`
          : `Undercut: the flat face cannot follow the profile near ${undercut.map((a) => `${fmtN(a)}°`).join(', ')} (a cusp). Increase the base circle.`,
    });
  const jumps = ranges(
    jumpAt.map((x) => x.angle),
    360 / n,
  );
  if (jumps.length)
    issues.push({
      severity: 'error',
      at: jumps[0],
      message: `The follower leaves the cam (contact force ≤ 0) near ${jumps.map((a) => `${fmtN(a)}°`).join(', ')}: increase the spring rate or preload, or slow down`,
    });

  return {
    ok: true,
    program,
    samples,
    issues,
    summary: {
      maxPressure: { value: Math.abs(pMax.pressure), at: pMax.angle },
      minRhoPitch: rp ? { value: rp.rhoPitch, at: rp.angle } : null,
      minRhoSurface: { value: rsAll.rhoSurface, at: rsAll.angle },
      undercut,
      faceWidth: alongs.length ? { min: Math.min(...alongs), max: Math.max(...alongs) } : null,
      force: {
        min: forces.length ? Math.min(...forces) : 0,
        max: forces.length ? Math.max(...forces) : 0,
        minAt: fMin?.angle ?? 0,
      },
      jump: jumps,
      torque: { min: Math.min(...torques), max: Math.max(...torques) },
      lift: Math.max(...samples.map((x) => x.s)),
    },
  };
}

const fmtN = (v: number) => Number(v.toFixed(1)).toString();

/** Start angles of runs of consecutive flagged angles. */
function ranges(angles: number[], step: number): number[] {
  const out: number[] = [];
  let prev = -Infinity;
  for (const a of angles) {
    if (a - prev > step * 1.5) out.push(a);
    prev = a;
  }
  return out;
}

/** The follower pose at a cam angle, in the ground frame, for drawing. */
export function followerPose(
  cam: CamData,
  program: Program,
  angle: number,
): { centre?: Vec; pivot?: Vec; normalAngle?: number; support?: number; s: number } | null {
  const g = geometry(cam);
  if ('message' in g) return null;
  const m = svaj(program, angle * DEG);
  if (g.kind === 'point') return { centre: g.centre(m.s), pivot: g.pivot, s: m.s };
  return { normalAngle: g.normalAngle(m.s), support: g.support(m.s), pivot: g.pivot, s: m.s };
}

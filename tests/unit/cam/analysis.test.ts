import { describe, expect, it } from 'vitest';
import { analyzeCam } from '../../../src/core/cam/analysis';
import { buildProgram, fundamentalLaw, svaj } from '../../../src/core/cam/program';
import { emptyCam, starterProgram, type CamData, type CamSegment } from '../../../src/core/cam/types';
import type { MotionLaw } from '../../../src/core/cam/laws';

const units = { length: 'mm', force: 'N' } as const;
const DEG = Math.PI / 180;

function cam(patch: Partial<CamData>, law: MotionLaw = 'cycloidal'): CamData {
  const c = { ...emptyCam(), ...patch };
  if (!patch.segments) c.segments = starterProgram().map((s) => ({ ...s, law }));
  return c;
}

const seg = (
  id: string,
  type: CamSegment['type'],
  duration: number,
  lift: number,
  law: MotionLaw,
): CamSegment => ({
  id,
  type,
  duration,
  lift,
  law,
  extras: {},
});

describe('motion program', () => {
  it('checks coverage and balance', () => {
    expect(
      buildProgram(cam({ segments: [seg('S1', 'rise', 180, 10, 'cycloidal')] })).issues.map((i) => i.message),
    ).toEqual([
      'The segments cover 180°; they must add up to 360°',
      'The follower ends 10 above where it starts; rises and returns must balance',
    ]);
  });

  it('flags the fundamental law: velocity jumps (constant velocity) and acceleration jumps (simple harmonic)', () => {
    const cv = fundamentalLaw(buildProgram(cam({}, 'constant_velocity')));
    expect(cv.filter((i) => i.severity === 'error').map((i) => i.at)).toEqual([60, 180, 240, 0]);
    const shm = fundamentalLaw(buildProgram(cam({}, 'simple_harmonic')));
    expect(shm.every((i) => i.severity === 'warning' && /infinite jerk/.test(i.message))).toBe(true);
    expect(shm).toHaveLength(4);
    expect(fundamentalLaw(buildProgram(cam({}, 'cycloidal')))).toEqual([]);
  });

  it('gives s and its derivatives per radian of cam angle', () => {
    const p = buildProgram(cam({}));
    // Rise of 20 over 120 degrees, cycloidal: mid-rise s = 10, v = 2 h / beta.
    const m = svaj(p, 120 * DEG);
    expect(m.s).toBeCloseTo(10, 12);
    expect(m.v).toBeCloseTo((2 * 20) / (120 * DEG), 10);
    expect(svaj(p, 200 * DEG).s).toBeCloseTo(20, 12);
  });
});

describe('translating roller follower', () => {
  it('matches the textbook pressure angle, with and without offset', () => {
    for (const offset of [0, 8, -8]) {
      for (const rotation of ['ccw', 'cw'] as const) {
        const c = cam({ offset, rotation, baseRadius: 40, rollerRadius: 10, step: 2 });
        const res = analyzeCam(c, units);
        expect(res.ok).toBe(true);
        const p = buildProgram(c);
        const Rp = 50;
        const y0 = Math.sqrt(Rp * Rp - offset * offset);
        // Norton: tan(phi) = (s' -/+ e) / (sqrt(Rp^2 - e^2) + s); the sign of e follows the rotation.
        const e = rotation === 'ccw' ? offset : -offset;
        for (const x of res.samples) {
          const m = svaj(p, x.angle * DEG);
          const phi = Math.atan((m.v - e) / (y0 + m.s)) / DEG;
          expect(Math.abs(Math.abs(x.pressure) - Math.abs(phi))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('generates a profile that drives the follower back through s(theta)', () => {
    for (const rotation of ['ccw', 'cw'] as const) {
      const c = cam({ offset: 6, rotation, step: 0.1 });
      const res = analyzeCam(c, units);
      const p = buildProgram(c);
      const y0 = Math.sqrt(50 * 50 - 36);
      const sigma = rotation === 'ccw' ? 1 : -1;
      for (const deg of [0, 47, 100, 150, 222, 300]) {
        const th = deg * DEG;
        // Lowest roller position along the follower axis that clears every surface point.
        let lam = -Infinity;
        for (const x of res.samples) {
          const [qx, qy] = x.surface;
          const gx = Math.cos(sigma * th) * qx - Math.sin(sigma * th) * qy;
          const gy = Math.sin(sigma * th) * qx + Math.cos(sigma * th) * qy;
          const dx = 6 - gx;
          if (Math.abs(dx) <= 10) lam = Math.max(lam, gy + Math.sqrt(100 - dx * dx));
        }
        expect(lam - y0).toBeCloseTo(svaj(p, th).s, 3);
      }
    }
  });

  it('finds undercut when the roller is larger than the sharpest pitch curvature', () => {
    const ok = analyzeCam(cam({ baseRadius: 40, rollerRadius: 10 }), units);
    expect(ok.summary.undercut).toEqual([]);
    expect(ok.summary.minRhoPitch!.value).toBeGreaterThan(10);
    // Keep the pitch curve (prime circle 30) and grow the roller past its sharpest convex radius.
    const program = [
      seg('S1', 'rise', 60, 30, 'cycloidal'),
      seg('S2', 'return', 60, 30, 'cycloidal'),
      seg('S3', 'dwell', 240, 0, 'cycloidal'),
    ];
    const knife = analyzeCam(cam({ baseRadius: 30, rollerRadius: 0, segments: program }), units);
    const sharpest = knife.summary.minRhoPitch!.value;
    expect(sharpest).toBeLessThan(25);
    const big = sharpest + 2;
    const res = analyzeCam(cam({ baseRadius: 30 - big, rollerRadius: big, segments: program }), units);
    expect(res.summary.minRhoPitch!.value).toBeCloseTo(sharpest, 6); // same pitch curve
    expect(res.summary.undercut.length).toBeGreaterThan(0);
    expect(res.issues.some((i) => /Undercut/.test(i.message))).toBe(true);
  });

  it('carries the spring and inertia loads: torque = load x ds/dtheta, force = load / cos(phi)', () => {
    const c = cam({ mass: 0.5, springRate: 2, preload: 20, speed: 300, step: 1 });
    const res = analyzeCam(c, units);
    const p = buildProgram(c);
    const w = (300 * 2 * Math.PI) / 60;
    for (const x of res.samples) {
      const m = svaj(p, x.angle * DEG);
      const G = 0.5 * m.a * w * w * 1e-3 + 2 * m.s + 20; // kg mm/s^2 -> N
      expect(x.torque).toBeCloseTo(G * m.v, 9);
      expect(x.force).toBeCloseTo(G / Math.cos(x.pressure * DEG), 6);
    }
  });

  it('detects follower jump when the spring is too weak for the speed', () => {
    const weak = analyzeCam(cam({ mass: 2, springRate: 0.1, preload: 1, speed: 600 }), units);
    expect(weak.summary.jump.length).toBeGreaterThan(0);
    expect(weak.issues.some((i) => /leaves the cam/.test(i.message))).toBe(true);
    const firm = analyzeCam(cam({ mass: 2, springRate: 0.1, preload: 1, speed: 30 }), units);
    expect(firm.summary.jump).toEqual([]);
  });
});

describe('translating flat-faced follower', () => {
  it('has zero pressure angle, curvature Rb + s + s″ and the face contact at s′', () => {
    const c = cam({ follower: 'translating_flat', baseRadius: 50, step: 1 });
    const res = analyzeCam(c, units);
    const p = buildProgram(c);
    for (const x of res.samples) {
      const m = svaj(p, x.angle * DEG);
      expect(x.pressure).toBeCloseTo(0, 9);
      expect(x.rhoSurface).toBeCloseTo(50 + m.s + m.a, 9);
      expect(Math.abs(x.along)).toBeCloseTo(Math.abs(m.v), 6);
    }
    expect(res.summary.faceWidth!.max - res.summary.faceWidth!.min).toBeGreaterThan(0);
  });

  it('flags a cusp when the base circle is too small', () => {
    const c = cam({
      follower: 'translating_flat',
      baseRadius: 8,
      segments: [
        seg('S1', 'rise', 90, 30, 'cycloidal'),
        seg('S2', 'return', 90, 30, 'cycloidal'),
        seg('S3', 'dwell', 180, 0, 'cycloidal'),
      ],
    });
    expect(analyzeCam(c, units).summary.undercut.length).toBeGreaterThan(0);
  });

  it('generates a profile that drives the face back through s(theta)', () => {
    const c = cam({ follower: 'translating_flat', baseRadius: 50, step: 0.1 });
    const res = analyzeCam(c, units);
    const p = buildProgram(c);
    for (const deg of [10, 90, 133, 200, 290]) {
      const th = deg * DEG;
      const top = Math.max(
        ...res.samples.map((x) => Math.sin(th) * x.surface[0] + Math.cos(th) * x.surface[1]),
      );
      expect(top - 50).toBeCloseTo(svaj(p, th).s, 3);
    }
  });
});

describe('oscillating followers', () => {
  it('roller: the profile drives the arm back through its angle', () => {
    const c = cam({
      follower: 'oscillating_roller',
      baseRadius: 40,
      rollerRadius: 10,
      pivotDistance: 100,
      armLength: 80,
      step: 0.1,
    });
    c.segments = starterProgram().map((s) => ({ ...s, lift: s.type === 'dwell' ? 0 : 15 }));
    const res = analyzeCam(c, units);
    expect(res.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const p = buildProgram(c);
    const psi0 = Math.acos((50 * 50 - 100 * 100 - 80 * 80) / (2 * 100 * 80));
    for (const deg of [30, 120, 200, 300]) {
      const th = deg * DEG;
      // Lower the roller from above the cam until it first touches the surface.
      // (Scanning up from below would accept a roller sunk inside the lobe.)
      let best = NaN;
      for (let sDeg = 16; sDeg >= -1; sDeg -= 0.002) {
        const psi = psi0 - sDeg * DEG;
        const C = [100 + 80 * Math.cos(psi), 80 * Math.sin(psi)];
        const clear = res.samples.every((x) => {
          const gx = Math.cos(th) * x.surface[0] - Math.sin(th) * x.surface[1];
          const gy = Math.sin(th) * x.surface[0] + Math.cos(th) * x.surface[1];
          return Math.hypot(C[0]! - gx, C[1]! - gy) >= 10 - 1e-6;
        });
        if (!clear) break;
        best = sDeg;
      }
      expect(best).toBeCloseTo(svaj(p, th).s / DEG, 1);
    }
    expect(res.samples[0]!.s).toBeCloseTo(0, 12); // degrees
  });

  it('flat face: rejects a pivot inside the base circle and analyses a valid one', () => {
    const bad = analyzeCam(cam({ follower: 'oscillating_flat', baseRadius: 40, pivotDistance: 30 }), units);
    expect(bad.issues.map((i) => i.message)).toContain('The pivot must be outside the base circle');
    const c = cam({ follower: 'oscillating_flat', baseRadius: 30, pivotDistance: 120, step: 1 });
    c.segments = starterProgram().map((s) => ({ ...s, lift: s.type === 'dwell' ? 0 : 10 }));
    const res = analyzeCam(c, units);
    expect(res.ok).toBe(true);
    // The cam surface at zero lift is the base circle.
    expect(Math.hypot(...res.samples[0]!.surface)).toBeCloseTo(30, 6);
  });
});

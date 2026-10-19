import { describe, expect, it } from 'vitest';
import { camPitchCurve, type PitchCurve } from '../../../src/core/cam/analysis';
import { closest, fitMountAngle } from '../../../src/core/cam/curve';
import { buildProgram, svaj } from '../../../src/core/cam/program';
import { emptyCam, starterProgram } from '../../../src/core/cam/types';

const cam = { ...emptyCam(), baseRadius: 40, rollerRadius: 10, segments: starterProgram() };
const curve = camPitchCurve(cam) as PitchCurve;

describe('cam pitch curve', () => {
  it('is the roller-centre path: radius Rp + s along the follower axis at each cam angle', () => {
    const p = buildProgram(cam);
    for (const deg of [0, 30, 100, 200, 300]) {
      const th = (deg * Math.PI) / 180;
      const { P } = curve.at(th);
      expect(Math.hypot(P[0], P[1])).toBeCloseTo(50 + svaj(p, th).s, 9);
    }
  });

  it('refuses flat-faced designs', () => {
    expect(camPitchCurve({ ...cam, follower: 'translating_flat' })).toEqual({
      message: 'C1 is designed for a flat-faced follower; mount a roller or knife-edge design',
    });
  });

  it('finds signed distances: + outside, - inside, 0 on the curve', () => {
    const { P } = curve.at(1.3);
    const on = closest(curve, P);
    expect(on.d).toBeCloseTo(0, 9);
    expect(on.theta).toBeCloseTo(1.3, 6);
    const out = closest(curve, [P[0] + on.n[0] * 3, P[1] + on.n[1] * 3]);
    expect(out.d).toBeCloseTo(3, 9);
    const inside = closest(curve, [P[0] - on.n[0] * 2, P[1] - on.n[1] * 2], 1.2);
    expect(inside.d).toBeCloseTo(-2, 9);
  });

  it('fits the mount angle for a follower drawn at a given place', () => {
    // A follower drawn straight up at 55 from the centre: the cam must turn so the curve passes there.
    const alpha = fitMountAngle(curve, [0, 55])!;
    expect(alpha).not.toBeNull();
    const c = Math.cos(-alpha);
    const s = Math.sin(-alpha);
    expect(closest(curve, [c * 0 - s * 55, s * 0 + c * 55]).d).toBeCloseTo(0, 8);
    // Too close to the centre for this cam.
    expect(fitMountAngle(curve, [0, 20])).toBeNull();
  });
});

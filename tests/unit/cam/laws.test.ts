import { describe, expect, it } from 'vitest';
import { law, MOTION_LAWS, type MotionLaw } from '../../../src/core/cam/laws';

const peak = (name: MotionLaw, k: 1 | 2) => {
  let m = 0;
  for (let i = 0; i <= 20000; i++) m = Math.max(m, Math.abs(law(name, i / 20000)[k]));
  return m;
};

describe('motion laws', () => {
  it.each(MOTION_LAWS)('%s goes from 0 to 1 and has consistent derivatives', (name) => {
    expect(law(name, 0)[0]).toBeCloseTo(0, 12);
    expect(law(name, 1)[0]).toBeCloseTo(1, 12);
    const h = 1e-5;
    for (let i = 1; i < 50; i++) {
      const u = i / 50 + 0.0013; // avoid piece boundaries
      if (u >= 1 - h) continue;
      for (let d = 0; d < 3; d++) {
        const fd = (law(name, u + h)[d]! - law(name, u - h)[d]!) / (2 * h);
        expect(law(name, u)[d + 1]).toBeCloseTo(fd, 4);
      }
    }
  });

  it('starts and ends at rest except constant velocity', () => {
    for (const name of MOTION_LAWS.filter((n) => n !== 'constant_velocity')) {
      expect(law(name, 0)[1]).toBeCloseTo(0, 12);
      expect(law(name, 1)[1]).toBeCloseTo(0, 10);
    }
  });

  it('has zero end accelerations where the law is meant to (finite jerk into a dwell)', () => {
    for (const name of [
      'cycloidal',
      'modified_trapezoidal',
      'modified_sine',
      'poly_345',
      'poly_4567',
    ] as const) {
      expect(law(name, 0)[2]).toBeCloseTo(0, 10);
      expect(law(name, 1)[2]).toBeCloseTo(0, 9);
    }
    // Simple harmonic does not: that is why it fails the fundamental law next to dwells.
    expect(law('simple_harmonic', 0)[2]).toBeCloseTo((Math.PI * Math.PI) / 2, 12);
    // 4-5-6-7 also starts and ends with zero jerk.
    expect(law('poly_4567', 0)[3]).toBeCloseTo(0, 12);
    expect(law('poly_4567', 1)[3]).toBeCloseTo(0, 9);
  });

  it('matches the textbook peak velocity and acceleration coefficients (Norton)', () => {
    const table: [MotionLaw, number, number][] = [
      ['simple_harmonic', Math.PI / 2, (Math.PI * Math.PI) / 2],
      ['cycloidal', 2, 2 * Math.PI],
      ['modified_trapezoidal', 2.0, 4.888],
      ['modified_sine', 1.76, 5.528],
      ['poly_345', 1.875, 5.7735],
      ['poly_4567', 2.1875, 7.5132],
    ];
    for (const [name, cv, ca] of table) {
      expect(peak(name, 1)).toBeCloseTo(cv, 2);
      expect(peak(name, 2)).toBeCloseTo(ca, 2);
    }
  });
});

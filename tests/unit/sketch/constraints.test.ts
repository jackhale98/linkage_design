import { describe, expect, it } from 'vitest';
import { constraintRows, CONSTRAINT_DEFS } from '../../../src/core/sketch/constraints';
import { SketchSystem } from '../../../src/core/sketch/solver';
import type { ConstraintType, Sketch, SketchConstraint } from '../../../src/core/sketch/types';

// Points in general position so no gradient is degenerate.
function sketch(): Sketch {
  const pts: [string, number, number][] = [
    ['P1', 0.3, -0.2],
    ['P2', 41.7, 12.9],
    ['P3', 13.1, 37.4],
    ['P4', 58.2, 44.6],
    ['P5', 22.5, 5.5],
  ];
  return {
    points: pts.map(([id, x, y]) => ({ id, x, y, fixed: false, label: '', extras: {} })),
    lines: [
      { id: 'L1', p1: 'P1', p2: 'P2', construction: false, extras: {} },
      { id: 'L2', p1: 'P3', p2: 'P4', construction: false, extras: {} },
    ],
    constraints: [],
  };
}

const REFS: Record<string, string[]> = {
  'point,point': ['P1', 'P5'],
  line: ['L1'],
  'point,line': ['P5', 'L2'],
  'line,line': ['L1', 'L2'],
};

describe('constraint gradients match finite differences', () => {
  const sk = sketch();
  const sys = new SketchSystem(sk, { angleScale: Math.PI / 180 }, []);
  const q0 = sys.q0();
  const S = 17.3;

  for (const type of Object.keys(CONSTRAINT_DEFS) as ConstraintType[]) {
    for (const sig of CONSTRAINT_DEFS[type].signatures) {
      const refs = REFS[sig.join(',')]!;
      it(`${type}(${sig.join(', ')})`, () => {
        const c: SketchConstraint = { id: 'C', type, refs, value: 23, reference: false, extras: {} };
        const rows = constraintRows(c, sys.geometry(q0), Math.PI / 180, S);
        rows.forEach((row, k) => {
          const analytic = new Array<number>(sys.n).fill(0);
          for (const [i, v] of row.g) analytic[i]! += v;
          for (let i = 0; i < sys.n; i++) {
            const h = 1e-6;
            const qp = q0.slice();
            const qm = q0.slice();
            qp[i]! += h;
            qm[i]! -= h;
            const rp = constraintRows(c, sys.geometry(qp), Math.PI / 180, S)[k]!.r;
            const rm = constraintRows(c, sys.geometry(qm), Math.PI / 180, S)[k]!.r;
            expect(analytic[i]!).toBeCloseTo((rp - rm) / (2 * h), 5);
          }
        });
      });
    }
  }
});

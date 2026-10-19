import { describe, expect, it } from 'vitest';
import { sweep } from '../../../src/core/mechanism/sweep';
import { addConstraint, addLine, addPoint } from '../../../src/core/sketch/edit';
import { emptySketch } from '../../../src/core/sketch/types';
import { build, ctx, emptyMechanism, fourBar, must, rotaryDriver } from './helpers';

const DEG = Math.PI / 180;

/** Closed-form four-bar (Norton, Design of Machinery, ch. 4/6/7), open branch. */
function closedForm(a: number, b: number, c: number, d: number, t2: number, w2: number, al2 = 0) {
  const Ax = a * Math.cos(t2);
  const Ay = a * Math.sin(t2);
  // Position via the same circle intersection as the drawing (upper branch).
  const dx = d - Ax;
  const dy = -Ay;
  const L = Math.hypot(dx, dy);
  const along = (b * b - c * c + L * L) / (2 * L);
  const h = Math.sqrt(b * b - along * along);
  const Bx = Ax + (along * dx) / L - (h * dy) / L;
  const By = Ay + (along * dy) / L + (h * dx) / L;
  const t3 = Math.atan2(By - Ay, Bx - Ax);
  const t4 = Math.atan2(By, Bx - d); // rocker from O4 to B
  const w3 = (a * w2 * Math.sin(t4 - t2)) / (b * Math.sin(t3 - t4));
  const w4 = (a * w2 * Math.sin(t2 - t3)) / (c * Math.sin(t4 - t3));
  const A_ = c * Math.sin(t4);
  const B_ = b * Math.sin(t3);
  const C_ =
    a * al2 * Math.sin(t2) +
    a * w2 * w2 * Math.cos(t2) +
    b * w3 * w3 * Math.cos(t3) -
    c * w4 * w4 * Math.cos(t4);
  const D_ = c * Math.cos(t4);
  const E_ = b * Math.cos(t3);
  const F_ =
    a * al2 * Math.cos(t2) -
    a * w2 * w2 * Math.sin(t2) -
    b * w3 * w3 * Math.sin(t3) +
    c * w4 * w4 * Math.sin(t4);
  const al3 = (C_ * D_ - A_ * F_) / (A_ * E_ - B_ * D_);
  const al4 = (C_ * E_ - B_ * F_) / (A_ * E_ - B_ * D_);
  return { B: [Bx, By], t3, t4, w3, w4, al3, al4 };
}

describe('four-bar kinematics (Grashof crank-rocker)', () => {
  const [a, b, c, d] = [50, 110, 90, 140];
  const sk = fourBar(a, b, c, d, 60);
  const mech = emptyMechanism();
  rotaryDriver(mech, 'L2', 0, 360, 72);
  const { sys } = build(sk, mech);

  it('finds three moving links, four revolutes and one degree of freedom', () => {
    expect(sys.model.bodies.map((x) => x.lines)).toEqual([['L2'], ['L3'], ['L4']]);
    expect(sys.model.joints.map((j) => `${j.type}@${j.point}`).sort()).toEqual([
      'revolute@P1',
      'revolute@P2',
      'revolute@P3',
      'revolute@P4',
    ]);
    expect(sys.mobility()).toBe(1);
  });

  const res = sweep(sys, { start: 0, end: 2 * Math.PI, steps: 72 });

  it('turns a full revolution', () => {
    expect(res.error).toBeUndefined();
    expect(res.fullRotation).toBe(true);
    expect(res.frames.every((f) => f !== null)).toBe(true);
  });

  it('matches closed-form positions, angular velocities and accelerations', () => {
    const coupler = sys.bodyIndex.get(sys.model.bodies[1]!.id)!;
    const rocker = sys.bodyIndex.get(sys.model.bodies[2]!.id)!;
    const B = sys.attach('P4', sys.model.bodies[1]!.id);
    for (const f of res.frames) {
      const cf = closedForm(a, b, c, d, f!.t, 1);
      const pB = sys.pos(f!.q, B);
      // The drawn sketch was itself solved to ~1e-9 relative, so compare to 6 decimals.
      expect(pB[0]).toBeCloseTo(cf.B[0]!, 6);
      expect(pB[1]).toBeCloseTo(cf.B[1]!, 6);
      // Body rotations are relative to the drawn pose; rates are absolute.
      expect(f!.qd[3 * coupler + 2]).toBeCloseTo(cf.w3, 8);
      expect(f!.qd[3 * rocker + 2]).toBeCloseTo(cf.w4, 8);
      expect(f!.qdd[3 * coupler + 2]).toBeCloseTo(cf.al3, 7);
      expect(f!.qdd[3 * rocker + 2]).toBeCloseTo(cf.al4, 7);
    }
  });

  it('has velocities and accelerations consistent with finite differences of position', () => {
    const P = sys.attach('P4', sys.model.bodies[2]!.id);
    for (const k of [5, 20, 41, 63]) {
      const f = res.frames[k]!;
      const h = 1e-3; // big enough that solver round-off doesn't swamp the second difference
      const qp = sys.solvePosition(f.q, f.t + h).q;
      const qm = sys.solvePosition(f.q, f.t - h).q;
      const [xp, xm, x0] = [sys.pos(qp, P), sys.pos(qm, P), sys.pos(f.q, P)];
      const v = sys.vel(f.q, f.qd, P);
      const acc = sys.acc(f.q, f.qd, f.qdd, P);
      expect(v[0]).toBeCloseTo((xp[0] - xm[0]) / (2 * h), 3);
      expect(v[1]).toBeCloseTo((xp[1] - xm[1]) / (2 * h), 3);
      expect(acc[0]).toBeCloseTo((xp[0] - 2 * x0[0] + xm[0]) / (h * h), 1);
      expect(acc[1]).toBeCloseTo((xp[1] - 2 * x0[1] + xm[1]) / (h * h), 1);
    }
  });
});

describe('four-bar driven by its rocker', () => {
  const [a, b, c, d] = [50, 110, 90, 140];
  const sk = fourBar(a, b, c, d, 60);
  const mech = emptyMechanism();
  // L4 runs B -> O4; drive its angle.
  rotaryDriver(mech, 'L4', 0, 360, 360);
  const { sys } = build(sk, mech);
  const res = sweep(sys, { start: 0, end: 2 * Math.PI, steps: 360 });

  it('stops at the toggle positions where crank and coupler line up', () => {
    expect(res.fullRotation).toBe(false);
    expect(res.limits.start).toBeDefined();
    expect(res.limits.end).toBeDefined();
    // At a toggle, |O2 B| = b + a or b - a.
    for (const lim of [res.limits.start!, res.limits.end!]) {
      // L4 direction angle = lim; B = O4 - c * (cos, sin).
      const Bx = d - c * Math.cos(lim);
      const By = -c * Math.sin(lim);
      const r = Math.hypot(Bx, By);
      expect(Math.min(Math.abs(r - (a + b)), Math.abs(r - (b - a)))).toBeLessThan(1e-4);
    }
  });
});

describe('offset slider-crank', () => {
  const r = 40;
  const l = 120;
  const e = 10;
  const s = emptySketch();
  const o = addPoint(s, 0, 0);
  const A = addPoint(s, r * Math.cos(DEG * 30), r * Math.sin(DEG * 30));
  const x0 = r * Math.cos(DEG * 30) + Math.sqrt(l * l - (r * Math.sin(DEG * 30) - e) ** 2);
  const P = addPoint(s, x0, e);
  const g1 = addPoint(s, -60, e);
  const g2 = addPoint(s, 220, e);
  s.points[0]!.fixed = true;
  s.points[3]!.fixed = true;
  s.points[4]!.fixed = true;
  addLine(s, o, A); // L1 crank
  addLine(s, A, P); // L2 rod
  addLine(s, g1, g2, true); // L3 slide line (ground)
  must(s, { type: 'point_on_line', refs: [P, 'L3'] });
  const mech = emptyMechanism();
  rotaryDriver(mech, 'L1', 0, 360, 90);
  const { sys } = build(s, mech);
  const res = sweep(sys, { start: 0, end: 2 * Math.PI, steps: 90 });

  const xOf = (t: number) => r * Math.cos(t) + Math.sqrt(l * l - (r * Math.sin(t) - e) ** 2);

  it('derives a pin-in-slot joint on the ground slide line', () => {
    expect(
      sys.model.joints.filter((j) => j.type === 'pin_in_slot').map((j) => [j.point, j.line, j.a]),
    ).toEqual([['P3', 'L3', 'ground']]);
    expect(sys.mobility()).toBe(1);
  });

  it('matches the exact slider position, velocity and acceleration', () => {
    expect(res.fullRotation).toBe(true);
    const pin = sys.attach('P3', sys.model.pointBodies.get('P3')![0]!);
    for (const f of res.frames) {
      const t = f!.t;
      // Exact derivatives of x = r cos t + sqrt(l^2 - (r sin t - e)^2).
      const u = r * Math.sin(t) - e;
      const S = Math.sqrt(l * l - u * u);
      const du = r * Math.cos(t);
      const v = -r * Math.sin(t) - (u * du) / S;
      const acc = -r * Math.cos(t) - (du * du - u * r * Math.sin(t)) / S - (u * u * du * du) / (S * S * S);
      expect(sys.pos(f!.q, pin)[0]).toBeCloseTo(xOf(t), 6);
      expect(sys.pos(f!.q, pin)[1]).toBeCloseTo(e, 6);
      expect(sys.vel(f!.q, f!.qd, pin)[0]).toBeCloseTo(v, 5);
      expect(sys.acc(f!.q, f!.qd, f!.qdd, pin)[0]).toBeCloseTo(acc, 6);
    }
  });
});

describe('linear actuator (hydraulic boom)', () => {
  const s = emptySketch();
  const o = addPoint(s, 0, 0); // boom pivot
  const m = addPoint(s, 100, 40); // cylinder mount on the boom
  const t = addPoint(s, 200, 80); // boom tip
  const g = addPoint(s, 60, -40); // cylinder base
  s.points[0]!.fixed = true;
  s.points[3]!.fixed = true;
  addLine(s, o, m); // L1
  addLine(s, m, t); // L2
  addLine(s, g, m); // L3 cylinder
  const mech = emptyMechanism();
  mech.bodies = [
    { id: 'B1', name: 'Boom', lines: ['L1', 'L2'], ground: false, color: '#3b82f6', extras: {} },
  ];
  mech.driver = { ...mech.driver, type: 'linear', pointA: g, pointB: m, steps: 40, speed: 20 };
  const { sys } = build(s, mech);
  const len0 = Math.hypot(40, 80);
  const res = sweep(sys, { start: len0 * 0.8, end: len0 * 1.3, steps: 40 });

  it('keeps the cylinder out of the bodies and has one DOF', () => {
    expect(sys.model.actuatorLine).toBe('L3');
    expect(sys.model.bodies.map((b) => b.id)).toEqual(['B1']);
    expect(sys.mobility()).toBe(1);
  });

  it('matches the law-of-cosines boom angle', () => {
    expect(res.error).toBeUndefined();
    const OM = Math.hypot(100, 40);
    const OG = Math.hypot(60, 40);
    const tip = sys.attach('P3', 'B1');
    const angGO = Math.atan2(-40, 60);
    for (const f of res.frames.filter(Boolean)) {
      const cosA = (OM * OM + OG * OG - f!.t * f!.t) / (2 * OM * OG);
      const angOM = angGO + Math.acos(cosA); // mount stays on the same side as drawn
      const angTip = Math.atan2(sys.pos(f!.q, tip)[1], sys.pos(f!.q, tip)[0]);
      expect(angTip).toBeCloseTo(angOM, 8);
    }
  });
});

describe('mobility', () => {
  it('reports 2 DOF for a five-bar and 0 for a triangle', () => {
    const s = emptySketch();
    const pts = [
      [0, 0],
      [40, 50],
      [100, 70],
      [160, 40],
      [200, 0],
    ].map(([x, y]) => addPoint(s, x!, y!));
    s.points[0]!.fixed = true;
    s.points[4]!.fixed = true;
    for (let k = 0; k < 4; k++) addLine(s, pts[k]!, pts[k + 1]!);
    expect(build(s, emptyMechanism()).sys.mobility()).toBe(2);

    const t = emptySketch();
    const q = [
      [0, 0],
      [100, 0],
      [50, 60],
    ].map(([x, y]) => addPoint(t, x!, y!));
    t.points[0]!.fixed = true;
    t.points[1]!.fixed = true;
    addLine(t, q[0]!, q[2]!);
    addLine(t, q[1]!, q[2]!);
    expect(build(t, emptyMechanism()).sys.mobility()).toBe(0);
    void addConstraint;
    void ctx;
  });
});

import { describe, expect, it } from 'vitest';
import { newProject, type Project } from '../../../src/core/model/project';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { reachable } from '../../../src/core/mechanism/analysis';
import { syncMechanism } from '../../../src/core/mechanism/model';
import { addLine, addPoint } from '../../../src/core/sketch/edit';
import { buildProgram, svaj } from '../../../src/core/cam/program';
import { emptyCam, starterProgram } from '../../../src/core/cam/types';
import type { PairRecord } from '../../../src/core/mechanism/types';
import { must } from './helpers';
import { solveForces } from '../../../src/core/forces/solve';
import { newLoad, type Load } from '../../../src/core/forces/types';
import { angleScale } from '../../../src/core/model/project';

const pair = (patch: Partial<PairRecord>): PairRecord => ({
  id: 'G1',
  type: 'gear',
  bodyA: '',
  pointA: '',
  bodyB: '',
  pointB: '',
  line: '',
  cam: '',
  teethA: 20,
  teethB: 20,
  pressure: 20,
  extras: {},
  ...patch,
});

const bodyOf = (p: Project, line: string) => p.mechanism.bodies.find((b) => b.lines.includes(line))!;

/** Two gears on ground pivots 100 apart, each with a spoke line; gear A driven. */
function gears(za: number, zb: number) {
  const p = newProject();
  const s = p.sketch;
  const o1 = addPoint(s, 0, 0);
  const o2 = addPoint(s, 100, 0);
  const a = addPoint(s, 0, 25);
  const b = addPoint(s, 100, 40);
  s.points[0]!.fixed = true;
  s.points[1]!.fixed = true;
  addLine(s, o1, a); // L1 gear A spoke
  addLine(s, o2, b); // L2 gear B spoke
  syncMechanism(s, p.mechanism);
  const A = bodyOf(p, 'L1');
  const B = bodyOf(p, 'L2');
  p.mechanism.pairs = [pair({ bodyA: A.id, pointA: o1, bodyB: B.id, pointB: o2, teethA: za, teethB: zb })];
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 72 };
  return { p, A, B };
}

describe('gear pairs', () => {
  it('turn at the tooth ratio, in opposite directions', () => {
    const { p, A, B } = gears(20, 50);
    const m = computeMotion(p);
    expect(m.issues).toEqual([]);
    expect(m.mobility).toBe(1);
    const pr = m.model.pairs[0]!;
    expect(pr.type === 'gear' && [pr.ra, pr.rb]).toEqual([(100 * 20) / 70, (100 * 50) / 70]);
    const ia = m.sys.bodyIndex.get(A.id)!;
    const ib = m.sys.bodyIndex.get(B.id)!;
    for (const f of reachable(m.res!)) {
      expect(f.q[3 * ib + 2]!).toBeCloseTo((-20 / 50) * f.q[3 * ia + 2]!, 10);
      expect(f.qd[3 * ib + 2]!).toBeCloseTo(-20 / 50, 10);
    }
    expect(m.res!.fullRotation).toBe(true);
  });

  it('need both centres pivoting on the same link', () => {
    const { p } = gears(20, 50);
    p.sketch.points[1]!.fixed = false; // gear B no longer pivots on ground
    syncMechanism(p.sketch, p.mechanism);
    const m = computeMotion(p);
    expect(m.issues.map((i) => i.message)).toContain(
      'G1: both gears must turn on pivots at their centres, on the same link (ground or an arm)',
    );
  });
});

describe('rack and pinion', () => {
  it('moves the rack r times the pinion angle', () => {
    const p = newProject();
    const s = p.sketch;
    const o = addPoint(s, 0, 0);
    const t = addPoint(s, 0, 20);
    const g1 = addPoint(s, -200, -30);
    const g2 = addPoint(s, 200, -30);
    const r1 = addPoint(s, -60, -30);
    const r2 = addPoint(s, 60, -30);
    for (const id of [o, g1, g2]) s.points.find((x) => x.id === id)!.fixed = true;
    addLine(s, o, t); // L1 pinion
    addLine(s, g1, g2, true); // L2 ground slide
    addLine(s, r1, r2); // L3 rack
    must(s, { type: 'point_on_line', refs: [r1, 'L2'] }, { type: 'point_on_line', refs: [r2, 'L2'] });
    syncMechanism(s, p.mechanism);
    const pinion = bodyOf(p, 'L1');
    const rack = bodyOf(p, 'L3');
    p.mechanism.pairs = [
      pair({ id: 'R1', type: 'rack', bodyA: pinion.id, pointA: o, bodyB: rack.id, line: 'L3', teethA: 24 }),
    ];
    p.mechanism.driver = {
      ...p.mechanism.driver,
      type: 'rotary',
      line: 'L1',
      start: 60,
      end: 120,
      steps: 30,
    };
    const m = computeMotion(p);
    expect(m.issues).toEqual([]);
    expect(m.mobility).toBe(1);
    const ip = m.sys.bodyIndex.get(pinion.id)!;
    const ir = m.sys.bodyIndex.get(rack.id)!;
    for (const f of reachable(m.res!)) {
      // Pinion above the rack turning counterclockwise drives the rack to +x.
      expect(f.q[3 * ir]! - -60).toBeCloseTo(30 * f.q[3 * ip + 2]!, 9);
      expect(f.q[3 * ir + 1]!).toBeCloseTo(-30, 9);
    }
  });
});

describe('cam joints', () => {
  /** A cam on a driven shaft at the origin pushing a roller follower up a vertical slide. */
  function camFollower() {
    const p = newProject();
    p.cams = [{ ...emptyCam(), baseRadius: 40, rollerRadius: 10, segments: starterProgram() }];
    const s = p.sketch;
    const o = addPoint(s, 0, 0);
    const k = addPoint(s, 25, 0);
    const r = addPoint(s, 0, 50); // roller centre on the base-circle dwell
    const top = addPoint(s, 0, 110);
    const f1 = addPoint(s, 0, 150);
    const f2 = addPoint(s, 0, 180);
    for (const id of [o, f1, f2]) s.points.find((x) => x.id === id)!.fixed = true;
    addLine(s, o, k); // L1 cam shaft link
    addLine(s, r, top); // L2 follower
    addLine(s, f1, f2, true); // L3 ground slide
    must(s, { type: 'point_on_line', refs: [r, 'L3'] }, { type: 'point_on_line', refs: [top, 'L3'] });
    syncMechanism(s, p.mechanism);
    const cam = bodyOf(p, 'L1');
    const fol = bodyOf(p, 'L2');
    p.mechanism.pairs = [
      pair({ id: 'K1', type: 'cam', cam: 'C1', bodyA: cam.id, pointA: o, bodyB: fol.id, pointB: r }),
    ];
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 180 };
    return { p, cam, fol };
  }

  it('drives the follower through the cam design s(theta)', () => {
    const { p, fol } = camFollower();
    const m = computeMotion(p);
    expect(m.issues).toEqual([]);
    expect(m.mobility).toBe(1);
    expect(m.res!.fullRotation).toBe(true);
    const pr = m.model.pairs[0]!;
    if (pr.type !== 'cam') throw new Error('cam');
    const program = buildProgram(p.cams[0]!);
    const ifo = m.sys.bodyIndex.get(fol.id)!;
    const i1 = m.sys.bodyIndex.get(m.model.bodies.find((b) => b.lines.includes('L1'))!.id)!;
    for (const f of reachable(m.res!)) {
      const theta = f.q[3 * i1 + 2]! + pr.alpha;
      // Follower body reference point is the roller centre at (0, 50) when s = 0.
      expect(f.q[3 * ifo + 1]! - 50).toBeCloseTo(svaj(program, theta).s, 6);
      // Velocity along the slide per unit cam angle is s'.
      expect(f.qd[3 * ifo + 1]!).toBeCloseTo(svaj(program, theta).v, 5);
    }
  });

  it('refuses a cam that does not exist or a roller out of reach', () => {
    const { p } = camFollower();
    p.mechanism.pairs[0]!.cam = 'C9';
    expect(computeMotion(p).issues.map((i) => i.message)).toContain(
      "K1: cam C9 doesn't exist; design it in the Cam workspace",
    );
    p.mechanism.pairs[0]!.cam = 'C1';
    p.sketch.points.find((x) => x.id === 'P3')!.y = 20;
    const msgs = computeMotion(p).issues.map((i) => i.message);
    expect(msgs.some((m) => /can't touch C1/.test(m))).toBe(true);
  });

  it('carries the follower load: contact force = load / cos(pressure angle), driver torque = load x s′', async () => {
    const { solveForces } = await import('../../../src/core/forces/solve');
    const { angleScale } = await import('../../../src/core/model/project');
    const { newLoad } = await import('../../../src/core/forces/types');
    const { p, fol } = camFollower();
    const pressing = { ...newLoad('F1', 'force'), body: fol.id, point: 'P3', fy: -100 };
    p.forces = { ...p.forces, mode: 'static', loads: [pressing] };
    const m = computeMotion(p);
    const units = { length: p.meta.length_unit, force: p.meta.force_unit };
    const f = solveForces(m, p.mechanism.bodies, p.forces, units, angleScale(p));
    expect(f.issues).toEqual([]);
    const pr = m.model.pairs[0]!;
    if (pr.type !== 'cam') throw new Error('cam');
    const program = buildProgram(p.cams[0]!);
    const i1 = m.sys.bodyIndex.get(m.model.bodies.find((b) => b.lines.includes('L1'))!.id)!;
    reachable(m.res!).forEach((fr, k) => {
      const th = fr.q[3 * i1 + 2]! + pr.alpha;
      const sv = svaj(program, th);
      const phi = Math.atan(sv.v / (50 + sv.s)); // centred translating roller
      expect(f.frames[k]!.pairs.get('K1')!.force).toBeCloseTo(100 / Math.cos(phi), 6);
      expect(f.frames[k]!.driver).toBeCloseTo(100 * sv.v, 5);
    });
    // Pulling the follower away instead: the roller would lift off the cam.
    p.forces.loads = [{ ...pressing, fy: 100 }];
    const lift = solveForces(computeMotion(p), p.mechanism.bodies, p.forces, units, angleScale(p));
    expect(lift.issues.some((i) => /K1: the roller would lift off the cam/.test(i))).toBe(true);
  });
});

const load = (id: string, type: Load['type'], patch: Partial<Load>): Load => ({
  ...newLoad(id, type),
  ...patch,
});
const forces = (p: Project) => {
  const m = computeMotion(p);
  return {
    m,
    f: solveForces(
      m,
      p.mechanism.bodies,
      p.forces,
      { length: p.meta.length_unit, force: p.meta.force_unit },
      angleScale(p),
    ),
  };
};
const DEG = Math.PI / 180;

describe('cam and gear joint forces', () => {
  it('gears: driver torque by the tooth ratio, tooth force T/r, pivots carry the whole mesh force', () => {
    const { p, B } = gears(20, 50);
    p.forces = { ...p.forces, mode: 'static', loads: [load('T1', 'torque', { body: B.id, torque: -1000 })] };
    const { m, f } = forces(p);
    expect(f.issues).toEqual([]);
    const rb = (100 * 50) / 70;
    for (const ff of f.frames) {
      // T_A w_A + T_B w_B = 0 with w_B = -(20/50) w_A.
      expect(ff.driver).toBeCloseTo(-1000 * (20 / 50), 8);
      const g = ff.pairs.get('G1')!;
      expect(g.force).toBeCloseTo(1000 / rb, 8);
      expect(g.normal).toBeCloseTo(1000 / rb / Math.cos(20 * DEG), 8);
      expect(g.separating).toBeCloseTo((1000 / rb) * Math.tan(20 * DEG), 8);
      for (const j of m.model.joints) {
        const r = ff.joints.get(j.id)!;
        expect(Math.hypot(r.fx, r.fy)).toBeCloseTo(g.normal, 8);
      }
      expect(ff.balance).toBeLessThan(1e-9);
    }
  });

  it('rack: pinion torque F r, and the slide takes the separating force', () => {
    const p = newProject();
    const s = p.sketch;
    const o = addPoint(s, 0, 0);
    const t = addPoint(s, 0, 20);
    const g1 = addPoint(s, -200, -30);
    const g2 = addPoint(s, 200, -30);
    const r1 = addPoint(s, -60, -30);
    const r2 = addPoint(s, 60, -30);
    for (const id of [o, g1, g2]) s.points.find((x) => x.id === id)!.fixed = true;
    addLine(s, o, t);
    addLine(s, g1, g2, true);
    addLine(s, r1, r2);
    must(s, { type: 'point_on_line', refs: [r1, 'L2'] }, { type: 'point_on_line', refs: [r2, 'L2'] });
    syncMechanism(s, p.mechanism);
    const pinion = bodyOf(p, 'L1');
    const rack = bodyOf(p, 'L3');
    p.mechanism.pairs = [
      pair({ id: 'R1', type: 'rack', bodyA: pinion.id, pointA: o, bodyB: rack.id, line: 'L3', teethA: 24 }),
    ];
    p.mechanism.driver = {
      ...p.mechanism.driver,
      type: 'rotary',
      line: 'L1',
      start: 60,
      end: 120,
      steps: 10,
    };
    p.forces = {
      ...p.forces,
      mode: 'static',
      loads: [load('F1', 'force', { body: rack.id, point: r2, fx: -100 })],
    };
    const { m, f } = forces(p);
    expect(f.issues).toEqual([]);
    for (const ff of f.frames) {
      expect(ff.driver).toBeCloseTo(100 * 30, 8);
      expect(ff.pairs.get('R1')!.force).toBeCloseTo(100, 8);
      const pivot = m.model.joints.find((j) => j.type === 'revolute')!;
      const pr = ff.joints.get(pivot.id)!;
      expect(Math.hypot(pr.fx, pr.fy)).toBeCloseTo(100 / Math.cos(20 * DEG), 8);
      // The two slide contacts together push the rack back down by F tan(20°)... on the rack.
      const slides = m.model.joints.filter((j) => j.type !== 'revolute').map((j) => ff.joints.get(j.id)!);
      expect(Math.abs(slides.reduce((sum, r) => sum + r.fy, 0))).toBeCloseTo(100 * Math.tan(20 * DEG), 8);
    }
  });
});

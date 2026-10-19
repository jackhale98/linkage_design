import { describe, expect, it } from 'vitest';
import {
  newProject,
  parseProject,
  serializeProject,
  angleScale,
  type Project,
} from '../../../src/core/model/project';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { reachable } from '../../../src/core/mechanism/analysis';
import { syncMechanism } from '../../../src/core/mechanism/model';
import { barMassProperties, solveForces } from '../../../src/core/forces/solve';
import { newLoad, type Load } from '../../../src/core/forces/types';
import { addLine, addPoint } from '../../../src/core/sketch/edit';
import { fourBar, must } from '../mechanism/helpers';

const G = 9.80665;

function run(p: Project) {
  const m = computeMotion(p);
  const f = solveForces(
    m,
    p.mechanism.bodies,
    p.forces,
    { length: p.meta.length_unit, force: p.meta.force_unit },
    angleScale(p),
  );
  return { m, f, frames: reachable(m.res!) };
}

function load(id: string, type: Load['type'], patch: Partial<Load>): Load {
  return { ...newLoad(id, type), ...patch };
}

describe('single crank under gravity', () => {
  const L = 200; // mm
  const mass = 2; // kg
  function crank(mode: 'static' | 'kinetostatic') {
    const p = newProject();
    const o = addPoint(p.sketch, 0, 0);
    const t = addPoint(p.sketch, L, 0);
    p.sketch.points[0]!.fixed = true;
    addLine(p.sketch, o, t);
    syncMechanism(p.sketch, p.mechanism);
    p.mechanism.bodies[0]!.mass = mass;
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 36, speed: 60 };
    p.forces = { ...p.forces, mode, gravity: true };
    return run(p);
  }

  it('needs input torque m g (L/2) cos(theta) and a vertical pivot force (static)', () => {
    const { f, frames } = crank('static');
    expect(f.issues).toEqual([]);
    frames.forEach((fr, k) => {
      const ff = f.frames[k]!;
      expect(ff.driver).toBeCloseTo(mass * G * (L / 2) * Math.cos(fr.t), 6); // N mm
      const pivot = [...ff.joints.values()][0]!;
      expect(pivot.fx).toBeCloseTo(0, 6);
      expect(pivot.fy).toBeCloseTo(mass * G, 6);
      expect(ff.balance).toBeLessThan(1e-9);
    });
  });

  it('adds the centripetal force at speed but not torque (constant speed)', () => {
    const { f, frames } = crank('kinetostatic');
    const w = 2 * Math.PI; // 60 rpm
    frames.forEach((fr, k) => {
      const ff = f.frames[k]!;
      expect(ff.driver).toBeCloseTo(mass * G * (L / 2) * Math.cos(fr.t), 6);
      const pivot = [...ff.joints.values()][0]!;
      // F_pivot = m a_c - m g, with a_c = -w^2 r_c (mm/s^2 -> m/s^2)
      const rc = [(L / 2) * Math.cos(fr.t), (L / 2) * Math.sin(fr.t)];
      expect(pivot.fx).toBeCloseTo(-mass * w * w * rc[0]! * 1e-3, 6);
      expect(pivot.fy).toBeCloseTo(-mass * w * w * rc[1]! * 1e-3 + mass * G, 6);
      expect(ff.power).toBeCloseTo(ff.driver * w * 1e-3, 9); // W
    });
  });
});

describe('four-bar with an output torque on the rocker', () => {
  const p = newProject();
  p.sketch = fourBar(50, 110, 90, 140, 60);
  syncMechanism(p.sketch, p.mechanism);
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L2', steps: 72, speed: 30 };
  const rocker = p.mechanism.bodies.find((b) => b.lines.includes('L4'))!;
  p.forces = {
    ...p.forces,
    mode: 'static',
    loads: [load('F1', 'torque', { body: rocker.id, torque: -1000 })],
  };
  const { m, f, frames } = run(p);

  it('balances input and output power (virtual work)', () => {
    const ir = m.sys.bodyIndex.get(rocker.id)!;
    frames.forEach((fr, k) => {
      const ratio = fr.qd[3 * ir + 2]!; // omega4 / omega2
      expect(f.frames[k]!.driver / (1000 * ratio)).toBeCloseTo(1, 8);
      expect(f.frames[k]!.balance).toBeLessThan(1e-9);
    });
  });

  it('loads the unloaded coupler as a two-force member along A-B', () => {
    const coupler = p.mechanism.bodies.find((b) => b.lines.includes('L3'))!;
    const pinA = m.model.joints.find((j) => j.point === 'P3')!;
    frames.forEach((fr, k) => {
      const A = m.sys.pos(fr.q, m.sys.attach('P3', coupler.id));
      const B = m.sys.pos(fr.q, m.sys.attach('P4', coupler.id));
      const F = f.frames[k]!.joints.get(pinA.id)!;
      const cross = (B[0] - A[0]) * F.fy - (B[1] - A[1]) * F.fx;
      expect(Math.abs(cross) / (Math.hypot(F.fx, F.fy) * 110 + 1e-12)).toBeLessThan(1e-7);
    });
  });
});

describe('slider-crank with a load on the piston', () => {
  const r = 40;
  const l = 120;
  const p = newProject();
  const s = p.sketch;
  const o = addPoint(s, 0, 0);
  const a = addPoint(s, r * Math.cos(0.5), r * Math.sin(0.5));
  const x0 = r * Math.cos(0.5) + Math.sqrt(l * l - (r * Math.sin(0.5)) ** 2);
  const pin = addPoint(s, x0, 0);
  const g = addPoint(s, 250, 0);
  s.points[0]!.fixed = true;
  s.points[3]!.fixed = true;
  addLine(s, o, a);
  addLine(s, a, pin);
  addLine(s, o, g, true);
  must(s, { type: 'point_on_line', refs: [pin, 'L3'] });
  syncMechanism(s, p.mechanism);
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 90, speed: 60 };
  const rod = p.mechanism.bodies.find((b) => b.lines.includes('L2'))!;
  p.forces = {
    ...p.forces,
    mode: 'static',
    loads: [load('F1', 'force', { body: rod.id, point: pin, fx: -100 })],
  };
  const { m, f, frames } = run(p);

  it('needs torque F dx/dtheta, and the slide pushes only vertically', () => {
    const slot = m.model.joints.find((j) => j.type === 'pin_in_slot')!;
    frames.forEach((fr, k) => {
      const t = fr.t;
      const u = r * Math.sin(t);
      const dx = -r * Math.sin(t) - (u * r * Math.cos(t)) / Math.sqrt(l * l - u * u);
      const ff = f.frames[k]!;
      // Power balance: T w + F v = 0  =>  T = -F_x dx/dtheta = 100 dx/dtheta
      expect(ff.driver).toBeCloseTo(100 * dx, 5);
      expect(ff.joints.get(slot.id)!.fx).toBeCloseTo(0, 6);
    });
  });
});

describe('springs and inertia', () => {
  it('matches the spring energy gradient and keeps the power balance with masses', () => {
    const p = newProject();
    p.sketch = fourBar(50, 110, 90, 140, 60);
    const anchor = addPoint(p.sketch, 60, 150);
    p.sketch.points.find((x) => x.id === anchor)!.fixed = true;
    syncMechanism(p.sketch, p.mechanism);
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L2', steps: 120, speed: 90 };
    for (const b of p.mechanism.bodies)
      Object.assign(
        b,
        barMassProperties(
          b,
          new Map(p.sketch.lines.map((l) => [l.id, [l.p1, l.p2]])),
          new Map(p.sketch.points.map((q) => [q.id, [q.x, q.y]])),
          0.002,
        ),
      );
    p.forces = {
      ...p.forces,
      mode: 'kinetostatic',
      gravity: true,
      loads: [load('S1', 'spring', { point: 'P4', pointB: anchor, k: 2, free: 60, preload: 5 })],
    };
    const { f } = run(p);
    expect(f.frames.every((fr) => fr.balance < 1e-8)).toBe(true);

    // Static spring only: torque = -dE/dtheta.
    p.forces = { ...p.forces, mode: 'static', gravity: false };
    p.mechanism.driver.steps = 720; // fine steps so the finite difference is accurate
    const st = run(p);
    const E = st.frames.map((fr, k) => {
      const T = st.f.frames[k]!.springs.get('S1')!;
      const x = (T - 5) / 2; // extension
      return 2 * x * x * 0.5 + 5 * x; // 1/2 k x^2 + preload x
    });
    const dEdt = E.map((_, k) =>
      k === 0 || k === E.length - 1
        ? NaN
        : (E[k + 1]! - E[k - 1]!) / (st.frames[k + 1]!.t - st.frames[k - 1]!.t),
    );
    const peak = Math.max(...dEdt.filter(Number.isFinite).map(Math.abs));
    for (let k = 1; k < E.length - 1; k++) {
      expect(Math.abs(st.f.frames[k]!.driver - dEdt[k]!)).toBeLessThan(1e-3 * peak);
    }
  });

  it('estimates bar mass properties', () => {
    const p = newProject();
    p.sketch = fourBar(50, 110, 90, 140, 60);
    syncMechanism(p.sketch, p.mechanism);
    const crank = p.mechanism.bodies.find((b) => b.lines.includes('L2'))!;
    const props = barMassProperties(
      crank,
      new Map(p.sketch.lines.map((l) => [l.id, [l.p1, l.p2]])),
      new Map(p.sketch.points.map((q) => [q.id, [q.x, q.y]])),
      0.01,
    );
    expect(props.mass).toBeCloseTo(0.5, 9);
    expect(props.inertia).toBeCloseTo((0.5 * 50 * 50) / 12, 6);
    expect(props.comX).toBeCloseTo(12.5, 6);
  });
});

describe('over-constrained mechanisms', () => {
  it('warns that reactions are not unique for a parallelogram with a redundant link', () => {
    const p = newProject();
    const s = p.sketch;
    const pts = [
      [0, 0],
      [100, 0],
      [30, 60],
      [130, 60],
      [50, 0],
      [80, 60],
    ].map(([x, y]) => addPoint(s, x!, y!));
    for (const k of [0, 1, 4]) s.points[k]!.fixed = true;
    addLine(s, pts[0]!, pts[2]!);
    addLine(s, pts[1]!, pts[3]!);
    addLine(s, pts[4]!, pts[5]!);
    addLine(s, pts[2]!, pts[5]!);
    addLine(s, pts[5]!, pts[3]!);
    syncMechanism(s, p.mechanism);
    const top = p.mechanism.bodies
      .filter((b) => b.lines.includes('L4') || b.lines.includes('L5'))
      .map((b) => b.id);
    p.mechanism.bodies.find((b) => b.id === top[0])!.lines.push('L5');
    p.mechanism.bodies = p.mechanism.bodies.filter((b) => b.id !== top[1]);
    syncMechanism(s, p.mechanism);
    p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 10, start: 60, end: 80 };
    const { m, f } = run(p);
    expect(m.mobility).toBe(1);
    expect(f.indeterminate).toBe(true);
  });
});

describe('CSV', () => {
  it('round-trips loads, analysis settings and mass properties', () => {
    const p = newProject(new Date('2026-10-19T12:00:00Z'));
    p.sketch = fourBar(50, 110, 90, 140, 60);
    syncMechanism(p.sketch, p.mechanism);
    p.mechanism.bodies[0]!.mass = 0.25;
    p.mechanism.bodies[0]!.inertia = 60;
    p.forces = {
      ...p.forces,
      gravity: true,
      loads: [
        load('F1', 'force', { body: p.mechanism.bodies[1]!.id, point: 'P4', fx: 10, fy: -20, frame: 'body' }),
        load('S1', 'spring', { point: 'P4', pointB: 'P2', k: 1.5, preload: 3 }),
      ],
    };
    const text = serializeProject(p);
    expect(text).toContain('[analysis]\r\nkey,value\r\nmode,kinetostatic\r\ngravity,1\r\n');
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(serializeProject(r.project)).toBe(text);
    expect(r.project.forces.loads[0]).toEqual(p.forces.loads[0]);
    expect(r.project.mechanism.bodies[0]!.mass).toBe(0.25);
  });

  it('rejects loads that refer to missing geometry', () => {
    const text =
      'LinkageDesign,1\n[points]\nid,x,y\nP1,0,0\n[loads]\nid,type,body,point\nF1,force,B9,P1\nT1,torque,,\n';
    const r = parseProject(text);
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
        '7: Body "B9" doesn\'t exist',
        '8: torque needs a body',
      ]);
  });
});

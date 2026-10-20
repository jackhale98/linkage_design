// Regenerates src/examples/*.csv from code so examples stay valid as the
// format evolves. Run with: GENERATE_EXAMPLES=1 npx vitest run tests/unit/generate-examples.test.ts
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { newProject, serializeProject, type Project } from '../../src/core/model/project';
import { addConstraint, addLine, addPoint } from '../../src/core/sketch/edit';
import { syncMechanism } from '../../src/core/mechanism/model';
import type { Sketch } from '../../src/core/sketch/types';
import { barMassProperties } from '../../src/core/forces/solve';
import { newLoad, type Load } from '../../src/core/forces/types';
import { emptyCam } from '../../src/core/cam/types';
import { camPitchCurve } from '../../src/core/cam/analysis';
import type { PairRecord } from '../../src/core/mechanism/types';

const ctx = { angleScale: Math.PI / 180 };
const DATE = new Date('2026-10-19T12:00:00.000Z');

function add(s: Sketch, ...ncs: Parameters<typeof addConstraint>[1][]) {
  for (const nc of ncs) {
    const r = addConstraint(s, nc, ctx);
    if (!r.ok) throw new Error(`${nc.type} ${nc.refs.join(',')}: ${r.reason}`);
  }
}

function label(s: Sketch, labels: Record<string, string>) {
  for (const [id, text] of Object.entries(labels)) s.points.find((p) => p.id === id)!.label = text;
}

function fix(s: Sketch, ...ids: string[]) {
  for (const id of ids) s.points.find((p) => p.id === id)!.fixed = true;
}

/** Give every moving body uniform-bar mass properties (mass per unit length). */
function bars(p: Project, massPerLength: number) {
  const ends = new Map(p.sketch.lines.map((l) => [l.id, [l.p1, l.p2] as [string, string]]));
  const pos = new Map(p.sketch.points.map((q) => [q.id, [q.x, q.y] as [number, number]]));
  for (const b of p.mechanism.bodies) {
    const m = barMassProperties(b, ends, pos, massPerLength);
    const r = (v: number) => Number(v.toPrecision(6));
    Object.assign(b, { mass: r(m.mass), comX: r(m.comX), comY: r(m.comY), inertia: r(m.inertia) });
  }
}

const bodyWith = (p: Project, line: string) => p.mechanism.bodies.find((b) => b.lines.includes(line))!;

function loadOf(id: string, type: Load['type'], patch: Partial<Load>): Load {
  return { ...newLoad(id, type), ...patch };
}

function save(
  file: string,
  p: Project,
  bodies: Record<string, { name: string; lines: string[] }>,
  forces?: (p: Project) => void,
) {
  // Name the auto-created bodies after their first line.
  syncMechanism(p.sketch, p.mechanism);
  for (const [first, spec] of Object.entries(bodies)) {
    const target = p.mechanism.bodies.find((b) => b.lines.includes(first))!;
    target.name = spec.name;
    for (const l of spec.lines) {
      if (target.lines.includes(l)) continue;
      const owner = p.mechanism.bodies.find((b) => b.lines.includes(l));
      if (owner) owner.lines = owner.lines.filter((x) => x !== l);
      target.lines.push(l);
    }
  }
  syncMechanism(p.sketch, p.mechanism);
  forces?.(p);
  writeFileSync(`src/examples/${file}`, serializeProject(p));
}

function fourBar() {
  const p = newProject(DATE);
  p.meta.name = 'Four-bar with coupler point';
  p.meta.notes =
    'Grashof crank-rocker: ground 140, crank 50, coupler 110, rocker 90. The coupler is a rigid triangle A-B-C; C traces the coupler curve.';
  const s = p.sketch;
  const [o2, o4, a, b, c] = [
    [0, 0],
    [140, 0],
    [25, 43],
    [120, 86],
    [80, 120],
  ].map(([x, y]) => addPoint(s, x!, y!)) as [string, string, string, string, string];
  fix(s, o2);
  label(s, { [o2]: 'O2', [o4]: 'O4', [a]: 'A', [b]: 'B', [c]: 'C' });
  const ground = addLine(s, o2, o4, true);
  const crank = addLine(s, o2, a);
  const coupler = addLine(s, a, b);
  const rocker = addLine(s, b, o4);
  const ac = addLine(s, a, c);
  const bc = addLine(s, b, c);
  add(
    s,
    { type: 'horizontal', refs: [ground] },
    { type: 'distance', refs: [ground], value: 140, labelDx: 0, labelDy: -12 },
    { type: 'distance', refs: [crank], value: 50, labelDx: -7, labelDy: 4 },
    { type: 'angle', refs: [crank], value: 60, labelDx: 20, labelDy: 9 },
    { type: 'distance', refs: [coupler], value: 110, labelDx: 3, labelDy: -6 },
    { type: 'distance', refs: [rocker], value: 90, labelDx: 7, labelDy: 2 },
    { type: 'distance', refs: [ac], value: 75, labelDx: -5, labelDy: 5 },
    { type: 'distance', refs: [bc], value: 45, labelDx: 1, labelDy: 7 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 60 };
  p.mechanism.motion.trace = [c];
  save(
    'four-bar.csv',
    p,
    {
      [crank]: { name: 'Crank', lines: [] },
      [coupler]: { name: 'Coupler', lines: [ac, bc] },
      [rocker]: { name: 'Rocker', lines: [] },
    },
    (q) => {
      bars(q, 0.002); // kg/mm: a steel bar about 16 mm square
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('T1', 'torque', { body: bodyWith(q, rocker).id, torque: -2000 })],
      };
    },
  );
}

function sliderCrank() {
  const p = newProject(DATE);
  p.meta.name = 'Slider-crank';
  p.meta.notes =
    'In-line slider-crank: crank 40, connecting rod 120. The piston pin P slides on the ground line.';
  const s = p.sketch;
  const [o, a, pin, g] = [
    [0, 0],
    [28, 28],
    [140, 0],
    [200, 0],
  ].map(([x, y]) => addPoint(s, x!, y!)) as [string, string, string, string];
  fix(s, o);
  label(s, { [o]: 'O', [a]: 'A', [pin]: 'P' });
  const crank = addLine(s, o, a);
  const rod = addLine(s, a, pin);
  const slide = addLine(s, o, g, true);
  add(
    s,
    { type: 'horizontal', refs: [slide] },
    { type: 'distance', refs: [slide], value: 200, labelDx: 0, labelDy: -14 },
    { type: 'point_on_line', refs: [pin, slide] },
    { type: 'distance', refs: [crank], value: 40, labelDx: -8, labelDy: 6 },
    { type: 'angle', refs: [crank], value: 45, labelDx: 16, labelDy: 6 },
    { type: 'distance', refs: [rod], value: 120, labelDx: 2, labelDy: 8 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 120 };
  p.mechanism.motion.trace = [pin];
  save(
    'slider-crank.csv',
    p,
    {
      [crank]: { name: 'Crank', lines: [] },
      [rod]: { name: 'Connecting rod', lines: [] },
    },
    (q) => {
      bars(q, 0.003);
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        loads: [loadOf('F1', 'force', { body: bodyWith(q, rod).id, point: pin, fx: -500 })],
      };
    },
  );
}

function quickReturn() {
  const p = newProject(DATE);
  p.meta.name = 'Quick-return (crank and slotted lever)';
  p.meta.notes =
    'Inverted slider-crank: the crank pin A slides in the slotted lever, which rocks about O4. The forward stroke takes longer than the return.';
  const s = p.sketch;
  const [o4, o2, a, b] = [
    [0, 0],
    [0, 150],
    [52, 180],
    [100, 280],
  ].map(([x, y]) => addPoint(s, x!, y!)) as [string, string, string, string];
  fix(s, o4);
  label(s, { [o4]: 'O4', [o2]: 'O2', [a]: 'A', [b]: 'B' });
  const frame = addLine(s, o4, o2, true);
  const crank = addLine(s, o2, a);
  const lever = addLine(s, o4, b);
  add(
    s,
    { type: 'vertical', refs: [frame] },
    { type: 'distance', refs: [frame], value: 150, labelDx: -14, labelDy: 0 },
    { type: 'distance', refs: [crank], value: 60, labelDx: 2, labelDy: 8 },
    { type: 'angle', refs: [crank], value: 30, labelDx: 18, labelDy: 2 },
    { type: 'point_on_line', refs: [a, lever] },
    { type: 'distance', refs: [lever], value: 300, labelDx: 10, labelDy: -6 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 30 };
  p.mechanism.motion.trace = [b];
  save(
    'quick-return.csv',
    p,
    {
      [crank]: { name: 'Crank', lines: [] },
      [lever]: { name: 'Slotted lever', lines: [] },
    },
    (q) => {
      bars(q, 0.002);
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('F1', 'force', { body: bodyWith(q, lever).id, point: b, fx: -200 })],
      };
    },
  );
}

function boom() {
  const p = newProject(DATE);
  p.meta.name = 'Hydraulic boom';
  p.meta.notes =
    'A boom pivoted at O, raised by a hydraulic cylinder from G to M. The cylinder length is the driver.';
  const s = p.sketch;
  const [o, m, t, g] = [
    [0, 0],
    [400, 160],
    [900, 360],
    [300, -100],
  ].map(([x, y]) => addPoint(s, x!, y!)) as [string, string, string, string];
  fix(s, o, g);
  label(s, { [o]: 'O', [m]: 'M', [t]: 'Tip', [g]: 'G' });
  const b1 = addLine(s, o, m);
  const b2 = addLine(s, m, t);
  const cyl = addLine(s, g, m, true);
  add(
    s,
    { type: 'parallel', refs: [b1, b2] },
    { type: 'distance', refs: [b1], value: 430, labelDx: -20, labelDy: 30 },
    { type: 'distance', refs: [b2], value: 540, labelDx: -10, labelDy: 30 },
    { type: 'distance', refs: [cyl], value: 280, labelDx: 30, labelDy: -10 },
  );
  p.mechanism.driver = {
    ...p.mechanism.driver,
    type: 'linear',
    pointA: g,
    pointB: m,
    start: 230,
    end: 420,
    steps: 100,
    speed: 50,
  };
  p.mechanism.motion.trace = [t];
  save('hydraulic-boom.csv', p, { [b1]: { name: 'Boom', lines: [b2] } }, (q) => {
    const boom = bodyWith(q, b1);
    Object.assign(boom, { mass: 20, comX: 450, comY: 180, inertia: 1.6e6 });
    q.forces = {
      ...q.forces,
      mode: 'static',
      gravity: true,
      loads: [loadOf('F1', 'force', { body: boom.id, point: t, fy: -2000 })],
    };
  });
}

function cam() {
  const p = newProject(DATE);
  p.meta.name = 'Dwell-rise-dwell cam';
  p.meta.notes =
    'Translating roller follower: 25 mm rise and return with 3-4-5 polynomials between dwells, at 300 rpm. The spring keeps the roller on the cam.';
  const seg = (id: string, type: 'rise' | 'return' | 'dwell', duration: number, lift = 0) => ({
    id,
    type,
    duration,
    lift,
    law: 'poly_345' as const,
    extras: {},
  });
  p.cams = [
    {
      ...emptyCam('C1', 'Dwell-rise-dwell'),
      baseRadius: 40,
      rollerRadius: 10,
      speed: 300,
      mass: 0.5,
      springRate: 1.2,
      preload: 30,
      segments: [
        seg('S1', 'rise', 100, 25),
        seg('S2', 'dwell', 80),
        seg('S3', 'return', 100, 25),
        seg('S4', 'dwell', 80),
      ],
    },
  ];
  writeFileSync('src/examples/cam.csv', serializeProject(p));
}

const pairRec = (patch: Partial<PairRecord>): PairRecord => ({
  id: '',
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

function camSlide() {
  const p = newProject(DATE);
  p.meta.name = 'Cam-driven slide';
  p.meta.notes =
    'A cam designed in the Cam workspace (C1) on a shaft at O drives a roller follower up a vertical slide. A compression spring holds the roller on the cam at 300 rpm.';
  const seg = (id: string, type: 'rise' | 'return' | 'dwell', duration: number, lift = 0) => ({
    id,
    type,
    duration,
    lift,
    law: 'poly_345' as const,
    extras: {},
  });
  p.cams = [
    {
      ...emptyCam('C1', 'Lift cam'),
      baseRadius: 40,
      rollerRadius: 10,
      speed: 300,
      segments: [
        seg('S1', 'dwell', 60),
        seg('S2', 'rise', 120, 25),
        seg('S3', 'dwell', 60),
        seg('S4', 'return', 120, 25),
      ],
    },
  ];
  const s = p.sketch;
  const o = addPoint(s, 0, 0);
  const k = addPoint(s, 25, 0);
  const r = addPoint(s, 0, 50);
  const t = addPoint(s, 0, 110);
  const f1 = addPoint(s, 0, 150);
  const f2 = addPoint(s, 0, 180);
  const top = addPoint(s, 0, 200);
  label(s, { [o]: 'O', [r]: 'Roller', [t]: 'T', [top]: 'S' });
  fix(s, o, f1, f2, top);
  addLine(s, o, k); // L1 cam shaft
  addLine(s, r, t); // L2 follower
  addLine(s, f1, f2, true); // L3 slide
  add(
    s,
    { type: 'distance', refs: ['L1'], value: 25 },
    { type: 'horizontal', refs: ['L1'] },
    { type: 'point_on_line', refs: [r, 'L3'] },
    { type: 'point_on_line', refs: [t, 'L3'] },
    { type: 'distance', refs: ['L2'], value: 60 },
    { type: 'distance', refs: [o, r], value: 50 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L1', steps: 360, speed: 300 };
  save(
    'cam-slide.csv',
    p,
    { L1: { name: 'Cam shaft', lines: [] }, L2: { name: 'Follower', lines: [] } },
    (q) => {
      const shaft = bodyWith(q, 'L1');
      const follower = bodyWith(q, 'L2');
      Object.assign(follower, { mass: 0.5 });
      q.mechanism.pairs = [
        pairRec({
          id: 'K1',
          type: 'cam',
          cam: 'C1',
          bodyA: shaft.id,
          pointA: o,
          bodyB: follower.id,
          pointB: r,
        }),
      ];
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        // Compressed 30 mm at the drawn pose: pushes the follower down onto the cam.
        loads: [loadOf('S1', 'spring', { point: t, pointB: top, k: 2, free: 120 })],
      };
    },
  );
}

function gears() {
  const p = newProject(DATE);
  p.meta.name = 'Gear pair and rack';
  p.meta.notes =
    'A 20-tooth gear (A) drives a 40-tooth gear (B), which drives a rack against a 200 N load. Module 3 mm, 20° pressure angle.';
  const s = p.sketch;
  const o1 = addPoint(s, 0, 0);
  const a = addPoint(s, 0, 25);
  const o2 = addPoint(s, 90, 0);
  const b = addPoint(s, 90, 40);
  const g1 = addPoint(s, -100, -60);
  const g2 = addPoint(s, 400, -60);
  const r1 = addPoint(s, 40, -60);
  const r2 = addPoint(s, 160, -60);
  label(s, { [o1]: 'A', [o2]: 'B' });
  fix(s, o1, o2, g1, g2);
  addLine(s, o1, a); // L1 gear A spoke
  addLine(s, o2, b); // L2 gear B spoke
  addLine(s, g1, g2, true); // L3 slide
  addLine(s, r1, r2); // L4 rack
  add(
    s,
    { type: 'distance', refs: ['L1'], value: 25 },
    { type: 'vertical', refs: ['L1'] },
    { type: 'distance', refs: ['L2'], value: 40 },
    { type: 'vertical', refs: ['L2'] },
    { type: 'point_on_line', refs: [r1, 'L3'] },
    { type: 'point_on_line', refs: [r2, 'L3'] },
    { type: 'distance', refs: ['L4'], value: 120 },
    { type: 'distance', refs: [g1, r1], value: 140 },
  );
  p.mechanism.driver = {
    ...p.mechanism.driver,
    type: 'rotary',
    line: 'L1',
    start: 90,
    end: 270,
    steps: 180,
    speed: 30,
  };
  save(
    'gears.csv',
    p,
    { L1: { name: 'Gear A', lines: [] }, L2: { name: 'Gear B', lines: [] }, L4: { name: 'Rack', lines: [] } },
    (q) => {
      const A = bodyWith(q, 'L1');
      const B = bodyWith(q, 'L2');
      const rack = bodyWith(q, 'L4');
      q.mechanism.pairs = [
        pairRec({
          id: 'G1',
          type: 'gear',
          bodyA: A.id,
          pointA: o1,
          bodyB: B.id,
          pointB: o2,
          teethA: 20,
          teethB: 40,
        }),
        pairRec({ id: 'R1', type: 'rack', bodyA: B.id, pointA: o2, bodyB: rack.id, line: 'L4', teethA: 40 }),
      ];
      q.forces = {
        ...q.forces,
        mode: 'static',
        loads: [loadOf('F1', 'force', { body: rack.id, point: r2, fx: -200 })],
      };
    },
  );
}

/** Add points at the given positions and return their IDs. */
function pts(s: Sketch, ...xy: [number, number][]): string[] {
  return xy.map(([x, y]) => addPoint(s, x, y));
}

function hoekens() {
  const p = newProject(DATE);
  p.meta.name = 'Hoekens straight-line linkage';
  p.meta.notes =
    'A crank-rocker with proportions 1 : 2 : 2.5 : 2.5 (crank, ground, coupler, rocker). The coupler extends to P, twice as far from A as B is; P runs along a nearly straight line for about half of each turn, then lifts and returns. It is the leg of many walking machines: try the Forces view to see the crank torque as the foot carries the load.';
  const s = p.sketch;
  const [o2, o4, a, b, f] = pts(s, [0, 0], [80, 0], [0, 40], [80, 100], [160, 160]) as [
    string,
    string,
    string,
    string,
    string,
  ];
  fix(s, o2);
  label(s, { [o2]: 'O2', [o4]: 'O4', [a]: 'A', [b]: 'B', [f]: 'P' });
  const ground = addLine(s, o2, o4, true);
  const crank = addLine(s, o2, a);
  const coupler = addLine(s, a, b);
  const extension = addLine(s, b, f);
  const rocker = addLine(s, b, o4);
  add(
    s,
    { type: 'horizontal', refs: [ground] },
    { type: 'distance', refs: [ground], value: 80, labelDx: 0, labelDy: -12 },
    { type: 'distance', refs: [crank], value: 40, labelDx: -12, labelDy: 0 },
    { type: 'angle', refs: [crank], value: 90, labelDx: 14, labelDy: 10 },
    { type: 'distance', refs: [coupler], value: 100, labelDx: -10, labelDy: 10 },
    { type: 'distance', refs: [extension], value: 100, labelDx: -10, labelDy: 10 },
    { type: 'parallel', refs: [coupler, extension] },
    { type: 'distance', refs: [rocker], value: 100, labelDx: 12, labelDy: 0 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 60 };
  p.mechanism.motion.trace = [f];
  save(
    'hoekens.csv',
    p,
    {
      [crank]: { name: 'Crank', lines: [] },
      [coupler]: { name: 'Coupler', lines: [extension] },
      [rocker]: { name: 'Rocker', lines: [] },
    },
    (q) => {
      bars(q, 0.001);
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('F1', 'force', { body: bodyWith(q, coupler).id, point: f, fy: -50 })],
      };
    },
  );
}

function watt() {
  const p = newProject(DATE);
  p.meta.name = "Watt's linkage";
  p.meta.notes =
    "James Watt's straight-line linkage: two equal arms pivoted at opposite ends, joined by a short link. The centre M of the link moves on a nearly straight vertical line through the middle of its travel (it traces a figure of eight overall). Used to locate rear axles sideways; the 500 N side load at M shows the force each arm carries.";
  const s = p.sketch;
  const [o1, o2, a, m, b] = pts(s, [0, 0], [200, 100], [100, 0], [100, 50], [100, 100]) as [
    string,
    string,
    string,
    string,
    string,
  ];
  fix(s, o1, o2);
  label(s, { [o1]: 'O1', [o2]: 'O2', [a]: 'A', [m]: 'M', [b]: 'B' });
  const arm1 = addLine(s, o1, a);
  const am = addLine(s, a, m);
  const mb = addLine(s, m, b);
  const arm2 = addLine(s, b, o2);
  add(
    s,
    { type: 'distance', refs: [arm1], value: 100, labelDx: 0, labelDy: -12 },
    { type: 'angle', refs: [arm1], value: 0, labelDx: 30, labelDy: 10 },
    { type: 'distance', refs: [am], value: 50, labelDx: -12, labelDy: 0 },
    { type: 'distance', refs: [mb], value: 50, labelDx: -12, labelDy: 0 },
    { type: 'parallel', refs: [am, mb] },
    { type: 'distance', refs: [arm2], value: 100, labelDx: 0, labelDy: 12 },
  );
  p.mechanism.driver = {
    ...p.mechanism.driver,
    type: 'rotary',
    line: arm1,
    start: -25,
    end: 25,
    steps: 100,
    speed: 30,
    returnStroke: true,
  };
  p.mechanism.motion.trace = [m];
  save(
    'watt.csv',
    p,
    {
      [arm1]: { name: 'Lower arm', lines: [] },
      [am]: { name: 'Centre link', lines: [mb] },
      [arm2]: { name: 'Upper arm', lines: [] },
    },
    (q) => {
      bars(q, 0.002);
      q.forces = {
        ...q.forces,
        mode: 'static',
        loads: [loadOf('F1', 'force', { body: bodyWith(q, am).id, point: m, fx: 500 })],
      };
    },
  );
}

function scotchYoke() {
  const p = newProject(DATE);
  p.meta.name = 'Scotch yoke';
  p.meta.notes =
    'The crank pin A slides in the vertical slot of the yoke, and the yoke slides in a horizontal guide. The yoke moves in pure simple harmonic motion: x = 40 cos θ. At 600 rpm the yoke inertia dominates the pin force; the 300 N load at R resists the motion both ways, like a pump.';
  const s = p.sketch;
  const [o, a, t1, t2, m, r, g1, g2] = pts(
    s,
    [0, 0],
    [20, 34.641],
    [20, -60],
    [20, 60],
    [20, 0],
    [140, 0],
    [100, 0],
    [220, 0],
  ) as [string, string, string, string, string, string, string, string];
  fix(s, o, g1, g2);
  label(s, { [o]: 'O', [a]: 'A', [r]: 'R' });
  const crank = addLine(s, o, a);
  const slot = addLine(s, t1, t2);
  const rod = addLine(s, m, r);
  const guide = addLine(s, g1, g2, true);
  add(
    s,
    { type: 'distance', refs: [crank], value: 40, labelDx: -14, labelDy: 4 },
    { type: 'angle', refs: [crank], value: 60, labelDx: 16, labelDy: 6 },
    { type: 'vertical', refs: [slot] },
    { type: 'distance', refs: [slot], value: 120, labelDx: -14, labelDy: 0 },
    { type: 'midpoint', refs: [m, slot] },
    { type: 'point_on_line', refs: [m, guide] },
    { type: 'point_on_line', refs: [r, guide] },
    { type: 'distance', refs: [rod], value: 120, labelDx: 0, labelDy: 12 },
    { type: 'point_on_line', refs: [a, slot] },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 600 };
  p.mechanism.motion.trace = [r];
  save(
    'scotch-yoke.csv',
    p,
    { [crank]: { name: 'Crank', lines: [] }, [slot]: { name: 'Yoke', lines: [rod] } },
    (q) => {
      const yoke = bodyWith(q, slot);
      Object.assign(yoke, { mass: 1.2, comX: 60, comY: 0, inertia: 3000 });
      Object.assign(bodyWith(q, crank), { mass: 0.2, comX: 10, comY: 17.32, inertia: 30 });
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        loads: [loadOf('F1', 'force', { body: yoke.id, point: r, fx: 300, oppose: true })],
      };
    },
  );
}

function shaper() {
  const p = newProject(DATE);
  p.meta.name = 'Shaper (six-bar quick return)';
  p.meta.notes =
    'A crank and slotted lever swing the lever O4-B; a link carries the motion to the ram, which slides on the top guide. One stroke takes about 1.7 times as long as the other (the crank turns 227° for it, 133° for the return). The 1500 N cutting force resists the motion, so it flips with the direction of travel; compare the crank torque on the two strokes.';
  const s = p.sketch;
  const [o4, o2, a, b, c, c2, g1, g2] = pts(
    s,
    [0, 0],
    [0, 150],
    [51.96, 180],
    [83.2, 288.2],
    [229.8, 320],
    [379.8, 320],
    [-300, 320],
    [450, 320],
  ) as [string, string, string, string, string, string, string, string];
  fix(s, o4, o2, g1, g2);
  label(s, { [o4]: 'O4', [o2]: 'O2', [a]: 'A', [b]: 'B', [c]: 'C', [c2]: 'Tool' });
  const crank = addLine(s, o2, a);
  const lever = addLine(s, o4, b);
  const link = addLine(s, b, c);
  const ram = addLine(s, c, c2);
  const guide = addLine(s, g1, g2, true);
  add(
    s,
    { type: 'distance', refs: [crank], value: 60, labelDx: 2, labelDy: 8 },
    { type: 'angle', refs: [crank], value: 30, labelDx: 18, labelDy: 2 },
    { type: 'point_on_line', refs: [a, lever] },
    { type: 'distance', refs: [lever], value: 300, labelDx: -16, labelDy: 0 },
    { type: 'distance', refs: [link], value: 150, labelDx: 0, labelDy: -10 },
    { type: 'point_on_line', refs: [c, guide] },
    { type: 'point_on_line', refs: [c2, guide] },
    { type: 'distance', refs: [ram], value: 150, labelDx: 0, labelDy: 12 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 40 };
  p.mechanism.motion.trace = [b];
  save(
    'shaper.csv',
    p,
    {
      [crank]: { name: 'Crank', lines: [] },
      [lever]: { name: 'Slotted lever', lines: [] },
      [link]: { name: 'Link', lines: [] },
      [ram]: { name: 'Ram', lines: [] },
    },
    (q) => {
      bars(q, 0.004);
      Object.assign(bodyWith(q, ram), { mass: 15, comX: 304.8, comY: 320, inertia: 30000 });
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('F1', 'force', { body: bodyWith(q, ram).id, point: c2, fx: 1500, oppose: true })],
      };
    },
  );
}

function knucklePress() {
  const p = newProject(DATE);
  p.meta.name = 'Knuckle-joint press';
  p.meta.notes =
    'A crank pulls the knuckle K sideways; the two toggle links straighten and drive the ram down. As they near a straight line the ram slows and the force it can deliver climbs: the analysis solves for the ram force from a known 20 N·m crank torque, so the mechanical advantage shows directly.';
  const s = p.sketch;
  const [o1, o2, k, r, r2, a, g1, g2] = pts(
    s,
    [0, 200],
    [290, 100],
    [20, 102.02],
    [0, 4.04],
    [0, -55.96],
    [260, 100],
    [0, -200],
    [0, -150],
  ) as [string, string, string, string, string, string, string, string];
  fix(s, o1, o2, g1, g2);
  label(s, { [o1]: 'O1', [o2]: 'O2', [k]: 'K', [r]: 'R', [r2]: 'Die', [a]: 'A' });
  const upper = addLine(s, o1, k);
  const lower = addLine(s, k, r);
  const ram = addLine(s, r, r2);
  const crank = addLine(s, o2, a);
  const rod = addLine(s, a, k);
  const guide = addLine(s, g1, g2, true);
  add(
    s,
    { type: 'distance', refs: [upper], value: 100, labelDx: 12, labelDy: 0 },
    { type: 'distance', refs: [lower], value: 100, labelDx: 12, labelDy: 0 },
    { type: 'point_on_line', refs: [r, guide] },
    { type: 'point_on_line', refs: [r2, guide] },
    { type: 'distance', refs: [ram], value: 60, labelDx: -12, labelDy: 0 },
    { type: 'distance', refs: [crank], value: 30, labelDx: 0, labelDy: 10 },
    { type: 'angle', refs: [crank], value: 180, labelDx: 10, labelDy: 10 },
    { type: 'distance', refs: [rod], value: 240, labelDx: 0, labelDy: -10 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 30 };
  p.mechanism.motion.trace = [r2];
  save(
    'knuckle-press.csv',
    p,
    {
      [upper]: { name: 'Upper toggle', lines: [] },
      [lower]: { name: 'Lower toggle', lines: [] },
      [ram]: { name: 'Ram', lines: [] },
      [crank]: { name: 'Crank', lines: [] },
      [rod]: { name: 'Connecting rod', lines: [] },
    },
    (q) => {
      const slide = q.mechanism.joints.find((j) => j.point === r2 && j.line === guide)!;
      q.forces = {
        ...q.forces,
        mode: 'static',
        solveFor: 'output',
        input: 20000,
        outputJoint: slide.id,
        inputPoint: a,
      };
    },
  );
}

function pumpJack() {
  const p = newProject(DATE);
  p.meta.name = 'Pump jack';
  p.meta.notes =
    'An oil-well beam pump: the crank drives the walking beam through the pitman, and the horsehead at H lifts the 8 kN rod and fluid load. A 600 kg counterweight on the crank arm balances most of the load, so the motor drives through part of each stroke and holds back (brakes) through the rest. Plot the driver torque to see both, then set the crank mass to zero and compare.';
  const s = p.sketch;
  const [o4, o2, h, b, a] = pts(s, [0, 300], [200, 0], [-300, 300], [200, 300], [200, 60]) as [
    string,
    string,
    string,
    string,
    string,
  ];
  fix(s, o4, o2);
  label(s, { [o4]: 'Samson post', [o2]: 'O2', [h]: 'H', [b]: 'B', [a]: 'A' });
  const front = addLine(s, h, o4);
  const rear = addLine(s, o4, b);
  const pitman = addLine(s, a, b);
  const crank = addLine(s, o2, a);
  add(
    s,
    { type: 'distance', refs: [crank], value: 60, labelDx: 12, labelDy: 0 },
    { type: 'angle', refs: [crank], value: 90, labelDx: 14, labelDy: -10 },
    { type: 'distance', refs: [pitman], value: 240, labelDx: 14, labelDy: 0 },
    { type: 'distance', refs: [rear], value: 200, labelDx: 0, labelDy: 12 },
    { type: 'distance', refs: [front], value: 300, labelDx: 0, labelDy: 12 },
    { type: 'parallel', refs: [front, rear] },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: crank, steps: 360, speed: 8 };
  p.mechanism.motion.trace = [h];
  save(
    'pump-jack.csv',
    p,
    {
      [front]: { name: 'Walking beam', lines: [rear] },
      [pitman]: { name: 'Pitman', lines: [] },
      [crank]: { name: 'Crank and counterweight', lines: [] },
    },
    (q) => {
      Object.assign(bodyWith(q, front), { mass: 120, comX: -50, comY: 300, inertia: 2.5e6 });
      Object.assign(bodyWith(q, pitman), { mass: 20, comX: 200, comY: 180, inertia: 1e5 });
      // The counterweight sits on the crank arm beyond the pin, so it falls as the horsehead rises.
      Object.assign(bodyWith(q, crank), { mass: 600, comX: 200, comY: 100, inertia: 1.5e6 });
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('F1', 'force', { body: bodyWith(q, front).id, point: h, fy: -8000 })],
      };
    },
  );
}

function valveTrain() {
  const p = newProject(DATE);
  p.meta.name = 'Engine valve train';
  p.meta.notes =
    'A camshaft at O lifts a roller rocker arm pivoted at P; the other end of the rocker opens the valve against the valve spring. The cam (C1) is designed in the Cam workspace for an oscillating roller follower with the same pivot distance and arm length. At 1500 rpm watch the contact force: it must stay above zero or the roller would lift off.';
  const seg = (id: string, type: 'rise' | 'return' | 'dwell', duration: number, lift = 0) => ({
    id,
    type,
    duration,
    lift,
    law: 'cycloidal' as const,
    extras: {},
  });
  p.cams = [
    {
      ...emptyCam('C1', 'Valve cam'),
      follower: 'oscillating_roller',
      baseRadius: 25,
      rollerRadius: 8,
      pivotDistance: 80,
      armLength: 70,
      speed: 1500,
      segments: [
        seg('S1', 'rise', 110, 10),
        seg('S2', 'dwell', 20),
        seg('S3', 'return', 110, 10),
        seg('S4', 'dwell', 120),
      ],
    },
  ];
  // Draw the roller where the cam puts it 20° into the rise (the shaft drawn at 20°).
  const curve = camPitchCurve(p.cams[0]!);
  if ('message' in curve) throw new Error(curve.message);
  const th = (20 * Math.PI) / 180;
  const P = curve.at(th).P;
  const roller: [number, number] = [
    Math.cos(th) * P[0] - Math.sin(th) * P[1],
    Math.sin(th) * P[0] + Math.cos(th) * P[1],
  ];
  const s = p.sketch;
  const [o, k, pv, r, v, sp] = pts(s, [0, 0], [23.49, 8.55], [80, 0], roller, [150, 20], [150, -80]) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  fix(s, o, pv, sp);
  label(s, { [o]: 'O', [pv]: 'P', [r]: 'Roller', [v]: 'Valve', [sp]: 'Spring seat' });
  const shaft = addLine(s, o, k);
  const arm = addLine(s, pv, r);
  const tip = addLine(s, pv, v);
  add(
    s,
    { type: 'distance', refs: [shaft], value: 25 },
    { type: 'angle', refs: [shaft], value: 20 },
    { type: 'distance', refs: [arm], value: 70, labelDx: 0, labelDy: 10 },
    { type: 'distance', refs: [o, r], value: Number(Math.hypot(...roller).toFixed(4)) },
    { type: 'distance', refs: [tip], value: 70, labelDx: 0, labelDy: 10 },
    { type: 'distance', refs: [r, v], value: Number(Math.hypot(150 - roller[0], 20 - roller[1]).toFixed(3)) },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: shaft, steps: 360, speed: 1500 };
  p.mechanism.motion.trace = [v];
  save(
    'valve-train.csv',
    p,
    { [shaft]: { name: 'Camshaft', lines: [] }, [arm]: { name: 'Rocker arm', lines: [tip] } },
    (q) => {
      const camshaft = bodyWith(q, shaft);
      const rocker = bodyWith(q, arm);
      Object.assign(rocker, { mass: 0.08, comX: 80, comY: 10, inertia: 60 });
      q.mechanism.pairs = [
        pairRec({
          id: 'K1',
          type: 'cam',
          cam: 'C1',
          bodyA: camshaft.id,
          pointA: o,
          bodyB: rocker.id,
          pointB: r,
        }),
      ];
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        loads: [loadOf('S1', 'spring', { point: v, pointB: sp, k: 15, free: 125 })],
      };
    },
  );
}

function gearedFiveBar() {
  const p = newProject(DATE);
  p.meta.name = 'Geared five-bar';
  p.meta.notes =
    'Two meshing gears (20 and 40 teeth) turn two cranks, joined by a pair of links at P. The 2 : 1 gearing makes P trace a looped curve that a four-bar cannot. The big gear is the driver, so one turn of it closes the curve.';
  const s = p.sketch;
  const [o1, o2, a, b, f] = pts(s, [0, 0], [120, 0], [0, 30], [120, 50], [60, 160]) as [
    string,
    string,
    string,
    string,
    string,
  ];
  fix(s, o1, o2);
  label(s, { [o1]: 'O1', [o2]: 'O2', [a]: 'A', [b]: 'B', [f]: 'P' });
  const c1 = addLine(s, o1, a);
  const c2 = addLine(s, o2, b);
  const l1 = addLine(s, a, f);
  const l2 = addLine(s, b, f);
  add(
    s,
    { type: 'distance', refs: [c1], value: 30, labelDx: -12, labelDy: 0 },
    { type: 'angle', refs: [c1], value: 90, labelDx: 12, labelDy: -10 },
    { type: 'distance', refs: [c2], value: 50, labelDx: 12, labelDy: 0 },
    { type: 'angle', refs: [c2], value: 90, labelDx: 12, labelDy: -10 },
    { type: 'distance', refs: [l1], value: 150, labelDx: -12, labelDy: 0 },
    { type: 'distance', refs: [l2], value: 130, labelDx: 12, labelDy: 0 },
  );
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: c2, steps: 360, speed: 30 };
  p.mechanism.motion.trace = [f];
  save(
    'geared-five-bar.csv',
    p,
    {
      [c1]: { name: 'Small gear', lines: [] },
      [c2]: { name: 'Large gear', lines: [] },
      [l1]: { name: 'Left link', lines: [] },
      [l2]: { name: 'Right link', lines: [] },
    },
    (q) => {
      bars(q, 0.002);
      q.mechanism.pairs = [
        pairRec({
          id: 'G1',
          type: 'gear',
          bodyA: bodyWith(q, c1).id,
          pointA: o1,
          bodyB: bodyWith(q, c2).id,
          pointB: o2,
          teethA: 20,
          teethB: 40,
        }),
      ];
      q.forces = {
        ...q.forces,
        mode: 'kinetostatic',
        gravity: true,
        loads: [loadOf('F1', 'force', { body: bodyWith(q, l1).id, point: f, fy: -100 })],
      };
    },
  );
}

function steering() {
  const p = newProject(DATE);
  p.meta.name = 'Rack-and-pinion steering';
  p.meta.notes =
    'The steering pinion moves the rack, and tie rods turn the two steering arms about their kingpins (1500 mm apart). The arms point at the middle of the rear axle, 2600 mm behind, so the inner wheel turns further than the outer one (Ackermann steering): plot the two wheel angles to compare. The tyres resist turning with 40 N·m each.';
  const s = p.sketch;
  const track = 750;
  const base = 2600;
  const armLen = 150;
  const tieLen = 300;
  const d = Math.hypot(track, base);
  const tip = (side: -1 | 1): [number, number] => [
    side * (track - (armLen * track) / d),
    -(armLen * base) / d,
  ];
  const rackY = tip(1)[1];
  const rackEnd = tip(1)[0] - tieLen;
  const r4 = (v: number) => Number(v.toFixed(4));
  const [o, k, r1, r2, g1, g2, kl, kr, tl, tr, wl, wr] = pts(
    s,
    [0, r4(rackY + 20)],
    [0, r4(rackY + 50)],
    [r4(-rackEnd), r4(rackY)],
    [r4(rackEnd), r4(rackY)],
    [-1000, r4(rackY)],
    [1000, r4(rackY)],
    [-track, 0],
    [track, 0],
    tip(-1).map(r4) as [number, number],
    tip(1).map(r4) as [number, number],
    [-track, 250],
    [track, 250],
  ) as [string, string, string, string, string, string, string, string, string, string, string, string];
  fix(s, o, g1, g2, kl, kr);
  label(s, {
    [o]: 'Pinion',
    [kl]: 'Left kingpin',
    [kr]: 'Right kingpin',
    [wl]: 'Left wheel',
    [wr]: 'Right wheel',
  });
  const spoke = addLine(s, o, k);
  const rack = addLine(s, r1, r2);
  const guide = addLine(s, g1, g2, true);
  const armL = addLine(s, kl, tl);
  const armR = addLine(s, kr, tr);
  const tieL = addLine(s, r1, tl);
  const tieR = addLine(s, r2, tr);
  const wheelL = addLine(s, kl, wl);
  const wheelR = addLine(s, kr, wr);
  add(
    s,
    { type: 'distance', refs: [spoke], value: 30 },
    { type: 'vertical', refs: [spoke] },
    { type: 'point_on_line', refs: [r1, guide] },
    { type: 'point_on_line', refs: [r2, guide] },
    { type: 'distance', refs: [rack], value: r4(2 * rackEnd), labelDx: 0, labelDy: -14 },
    { type: 'distance', refs: [g1, r1], value: r4(1000 - rackEnd) },
    { type: 'distance', refs: [armL], value: armLen, labelDx: -14, labelDy: 0 },
    { type: 'distance', refs: [armR], value: armLen, labelDx: 14, labelDy: 0 },
    { type: 'distance', refs: [tieL], value: tieLen, labelDx: 0, labelDy: 12 },
    { type: 'distance', refs: [tieR], value: tieLen, labelDx: 0, labelDy: 12 },
    { type: 'distance', refs: [wheelL], value: 250 },
    { type: 'vertical', refs: [wheelL] },
    { type: 'distance', refs: [wheelR], value: 250 },
    { type: 'vertical', refs: [wheelR] },
  );
  p.mechanism.driver = {
    ...p.mechanism.driver,
    type: 'rotary',
    line: spoke,
    start: -80,
    end: 260,
    steps: 170,
    speed: 20,
    returnStroke: true,
  };
  save(
    'steering.csv',
    p,
    {
      [spoke]: { name: 'Pinion', lines: [] },
      [rack]: { name: 'Rack', lines: [] },
      [armL]: { name: 'Left wheel', lines: [wheelL] },
      [armR]: { name: 'Right wheel', lines: [wheelR] },
      [tieL]: { name: 'Left tie rod', lines: [] },
      [tieR]: { name: 'Right tie rod', lines: [] },
    },
    (q) => {
      q.mechanism.pairs = [
        pairRec({
          id: 'R1',
          type: 'rack',
          bodyA: bodyWith(q, spoke).id,
          pointA: o,
          bodyB: bodyWith(q, rack).id,
          line: rack,
          teethA: 16,
        }),
      ];
      q.forces = {
        ...q.forces,
        mode: 'static',
        loads: [
          loadOf('T1', 'torque', { body: bodyWith(q, armL).id, torque: 40000, oppose: true }),
          loadOf('T2', 'torque', { body: bodyWith(q, armR).id, torque: 40000, oppose: true }),
        ],
      };
    },
  );
}

it.skipIf(!process.env.GENERATE_EXAMPLES)('generates example projects', () => {
  fourBar();
  sliderCrank();
  quickReturn();
  boom();
  cam();
  camSlide();
  gears();
  hoekens();
  watt();
  scotchYoke();
  shaper();
  knucklePress();
  pumpJack();
  valveTrain();
  gearedFiveBar();
  steering();
});

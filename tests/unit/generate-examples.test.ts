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

it.skipIf(!process.env.GENERATE_EXAMPLES)('generates example projects', () => {
  fourBar();
  sliderCrank();
  quickReturn();
  boom();
  cam();
  camSlide();
  gears();
});

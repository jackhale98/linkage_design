// The examples' notes make engineering claims; check that each one holds.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { angleScale, parseProject, type Project } from '../../src/core/model/project';
import { computeMotion } from '../../src/core/mechanism/motion';
import { solveForces } from '../../src/core/forces/solve';

function run(file: string, edit?: (p: Project) => void) {
  const r = parseProject(readFileSync(`src/examples/${file}`, 'utf8'));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const p = r.project;
  edit?.(p);
  const m = computeMotion(p);
  const frames = m.data!.frames;
  const f = solveForces(
    m,
    p.mechanism.bodies,
    p.forces,
    { length: p.meta.length_unit, force: p.meta.force_unit },
    angleScale(p),
  );
  const point = (label: string) => {
    const id = p.sketch.points.find((q) => q.label === label)!.id;
    const body = m.model.bodies.find((b) => b.points.includes(id))!;
    const a = m.sys.attach(id, body.id);
    return frames.map((fr) => m.sys.pos(fr.q, a));
  };
  /** Turn of a link from its drawn pose, degrees. */
  const turn = (name: string) => {
    const i = m.model.bodies.findIndex((b) => b.name === name);
    return frames.map((fr) => (fr.q[3 * i + 2]! * 180) / Math.PI);
  };
  return { p, m, frames, f, point, turn };
}

const range = (v: number[]) => Math.max(...v) - Math.min(...v);

describe('example claims', () => {
  it('Hoekens: the foot runs straight for about half a turn', () => {
    const { point } = run('hoekens.csv');
    const ys = point('P').map((q) => q[1]);
    const low = Math.min(...ys);
    // Within 0.5% of the link lengths of the lowest point for over 150° of crank.
    expect(ys.filter((y) => y - low < 1).length).toBeGreaterThan(150);
  });

  it("Watt's linkage: the centre point moves on a nearly straight line", () => {
    const { point } = run('watt.csv');
    const m = point('M');
    expect(range(m.map((q) => q[1]))).toBeGreaterThan(80);
    expect(range(m.map((q) => q[0]))).toBeLessThan(1);
  });

  it('Scotch yoke: the yoke moves in simple harmonic motion', () => {
    const { point, frames } = run('scotch-yoke.csv');
    point('R').forEach((q, k) => expect(q[0]).toBeCloseTo(120 + 40 * Math.cos(frames[k]!.t), 6));
  });

  it('Shaper: one stroke takes about 1.7 times as long as the other', () => {
    const { point } = run('shaper.csv');
    const x = point('Tool').map((q) => q[0]);
    let fwd = 0;
    let back = 0;
    for (let k = 1; k < x.length; k++) {
      if (x[k]! > x[k - 1]!) fwd++;
      else back++;
    }
    const ratio = Math.max(fwd, back) / Math.min(fwd, back);
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(1.8);
  });

  it('Knuckle-joint press: the ram force climbs steeply as the toggle straightens', () => {
    const { f, point } = run('knuckle-press.csv');
    const y = point('Die').map((q) => q[1]);
    const out = f.frames.map((x) => Math.abs(x.output));
    const lo = Math.min(...y);
    const hi = Math.max(...y);
    const bottom = y.indexOf(lo);
    const mid = y.findIndex((v) => Math.abs(v - (lo + hi) / 2) < (hi - lo) / 20);
    // Near the bottom, 20 N·m gives over 50 kN; mid-stroke, a small fraction of that.
    expect(Math.max(...out.slice(Math.max(0, bottom - 10), bottom + 10))).toBeGreaterThan(50000);
    expect(out[mid]!).toBeLessThan(5000);
  });

  it('Pump jack: the motor drives and brakes; the counterweight cuts the peak torque', () => {
    const { f } = run('pump-jack.csv');
    const T = f.frames.map((x) => x.driver);
    expect(Math.min(...T)).toBeLessThan(0);
    expect(Math.max(...T)).toBeGreaterThan(0);
    const bare = run('pump-jack.csv', (p) => {
      const crank = p.mechanism.bodies.find((b) => b.name.startsWith('Crank'))!;
      crank.mass = 0;
    });
    const peak = (v: number[]) => Math.max(...v.map(Math.abs));
    expect(peak(T)).toBeLessThan(0.5 * peak(bare.f.frames.map((x) => x.driver)));
  });

  it('Valve train: the rocker swings the designed 10° and the roller never lifts off', () => {
    const { turn, f } = run('valve-train.csv');
    expect(range(turn('Rocker arm'))).toBeCloseTo(10, 3);
    expect(f.issues).toEqual([]);
    expect(Math.min(...f.frames.map((x) => x.pairs.get('K1')!.force))).toBeGreaterThan(0);
  });

  it('Geared five-bar: the small gear turns twice for each turn of the large one, and the curve closes', () => {
    const { turn, point } = run('geared-five-bar.csv');
    const small = turn('Small gear');
    const large = turn('Large gear');
    const n = small.length - 1;
    expect(small[n]! - small[0]!).toBeCloseTo(-2 * (large[n]! - large[0]!), 6);
    const P = point('P');
    expect(Math.hypot(P[n]![0] - P[0]![0], P[n]![1] - P[0]![1])).toBeLessThan(1e-6);
  });

  it('Steering: the inner wheel turns further, close to ideal Ackermann', () => {
    const { turn, p } = run('steering.csv');
    const left = turn('Left wheel');
    const right = turn('Right wheel');
    const xs = p.sketch.points.filter((q) => q.label.endsWith('kingpin')).map((q) => q.x);
    const track = Math.max(...xs) - Math.min(...xs);
    const base = 2600;
    const cot = (deg: number) => 1 / Math.tan((deg * Math.PI) / 180);
    for (const k of [0, left.length >> 1]) {
      const inner = Math.max(Math.abs(left[k]!), Math.abs(right[k]!));
      const outer = Math.min(Math.abs(left[k]!), Math.abs(right[k]!));
      expect(inner - outer).toBeGreaterThan(2);
      const ideal = (Math.atan(1 / (cot(inner) + track / base)) * 180) / Math.PI;
      expect(Math.abs(outer - ideal)).toBeLessThan(2);
    }
  });
});

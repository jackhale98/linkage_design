import { describe, expect, it } from 'vitest';
import { newProject, parseProject, serializeProject } from '../../../src/core/model/project';
import {
  evaluate,
  grashof,
  reachable,
  resultsTable,
  series,
  summarize,
} from '../../../src/core/mechanism/analysis';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { syncMechanism } from '../../../src/core/mechanism/model';
import { fourBar } from './helpers';

function project(a: number, b: number, c: number, d: number) {
  const p = newProject(new Date('2026-10-19T12:00:00Z'));
  p.sketch = fourBar(a, b, c, d, 60);
  p.mechanism.driver = { ...p.mechanism.driver, type: 'rotary', line: 'L2', steps: 72, speed: 60 };
  syncMechanism(p.sketch, p.mechanism);
  return p;
}

describe('motion analysis', () => {
  const p = project(50, 110, 90, 140);
  const m = computeMotion(p);

  it('sweeps a full turn with the default range', () => {
    expect(m.issues).toEqual([]);
    expect(m.range).toEqual({ start: 0, end: 360, steps: 72 });
    expect(m.res!.fullRotation).toBe(true);
    expect(reachable(m.res!)).toHaveLength(73);
  });

  it('classifies Grashof types', () => {
    expect(grashof(m.sys)!.type).toBe('crank-rocker');
    expect(grashof(computeMotion(project(50, 110, 90, 150)).sys)!.type).toBe('change-point');
    expect(grashof(computeMotion(project(100, 110, 90, 60)).sys)!.type).toBe('double-crank');
    expect(grashof(computeMotion(project(80, 110, 90, 140)).sys)!.type).toBe('triple-rocker');
  });

  it('reports the transmission angle at the coupler-rocker joint', () => {
    const data = m.data!;
    const joint = m.model.joints.find((j) => j.point === 'P4')!;
    for (const f of reachable(m.res!)) {
      // Law of cosines on triangle A-B-O4: |A O4|^2 = b^2 + c^2 - 2bc cos(mu)
      const A: [number, number] = [50 * Math.cos(f.t), 50 * Math.sin(f.t)];
      const z2 = (140 - A[0]) ** 2 + A[1] ** 2;
      const mu = (Math.acos((110 ** 2 + 90 ** 2 - z2) / (2 * 110 * 90)) * 180) / Math.PI;
      expect(evaluate(data, f, `j:${joint.id}:angle`)).toBeCloseTo(mu, 6);
    }
  });

  it('scales rates by the driver speed (60 rpm = 2 pi rad/s)', () => {
    const data = m.data!;
    const crank = m.model.bodies.find((b) => b.lines.includes('L2'))!;
    for (const w of series(data, `b:${crank.id}:omega`)) expect(w).toBeCloseTo(360, 6); // deg/s
    const speedA = series(data, 'p:P3:v');
    for (const v of speedA) expect(v).toBeCloseTo(50 * 2 * Math.PI, 6);
  });

  it('summarises the range, joint angles and extremes', () => {
    const s = summarize(m.data!, ['P4']);
    expect(s.rangeText).toBe('Turns a full revolution');
    expect(s.cycleTime).toBeCloseTo(1, 9);
    // Only B (coupler/rocker): the crank pin's angle isn't a transmission angle.
    expect(s.jointAngles.map((j) => j.point)).toEqual(['P4']);
    expect(s.extremes.map((e) => e.key)).toEqual(['p:P4:v', 'p:P4:a']);
  });

  it('exports a flat kinematics table with units in the header', () => {
    const table = resultsTable(m.data!);
    expect(table[0]!.slice(0, 4)).toEqual(['input [deg]', 'time [s]', 'P3_x [mm]', 'P3_y [mm]']);
    expect(table).toHaveLength(74);
    expect(table[1]![0]).toBe('0');
    expect(table[73]![0]).toBe('360');
  });

  it('round-trips mechanism data through CSV', () => {
    const text = serializeProject(p);
    expect(text).toContain('[driver]\r\nkey,value\r\ntype,rotary\r\nline,L2\r\n');
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(serializeProject(r.project)).toBe(text);
    expect(r.project.mechanism.bodies.map((b) => b.lines)).toEqual([['L2'], ['L3'], ['L4']]);
  });

  it('explains why a mechanism cannot move', () => {
    const q = project(50, 110, 90, 140);
    q.mechanism.driver.type = 'none';
    expect(computeMotion(q).issues.map((i) => i.message)).toEqual([
      'Choose a driver to animate the mechanism',
    ]);
    q.sketch.points[2]!.fixed = true; // fix the crank pin: structure
    q.mechanism.driver.type = 'rotary';
    expect(computeMotion(q).issues[0]!.message).toMatch(/driver line L2 must belong to a moving link|locked/);
  });
});

describe('Grashof with a plate coupler', () => {
  it('measures links between their joints', async () => {
    const { readFileSync } = await import('node:fs');
    const r = parseProject(readFileSync('src/examples/four-bar.csv', 'utf8'));
    if (!r.ok) throw new Error('example failed to load');
    const g = grashof(computeMotion(r.project).sys)!;
    expect(g.type).toBe('crank-rocker');
    expect(g.lengths.ground).toBeCloseTo(140, 6);
    expect(g.lengths.crank).toBeCloseTo(50, 6);
    expect(g.lengths.coupler).toBeCloseTo(110, 6);
    expect(g.lengths.rocker).toBeCloseTo(90, 6);
  });
});

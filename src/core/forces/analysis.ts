// Force results for plots, summaries and export.

import { formatNumber } from '../csv/values';
import { inputValue, timeOf, type MotionData } from '../mechanism/analysis';
import type { Quantity } from '../mechanism/analysis';
import type { ForcesData } from './types';
import type { ForceResult } from './solve';
import { jointNames, pointName } from '../mechanism/names';

export interface ForceUnitsLabel {
  force: string;
  length: string;
}

export function forceQuantities(
  data: MotionData,
  forces: ForcesData,
  result: ForceResult,
  u: ForceUnitsLabel,
): Quantity[] {
  if (!result.frames.length) return [];
  const rotary = data.sys.driver?.type === 'rotary';
  const out: Quantity[] = [
    rotary
      ? {
          key: 'd:effort',
          label: 'Input torque',
          short: 'Input torque',
          unit: `${u.force}·${u.length}`,
          group: 'Driver',
        }
      : { key: 'd:effort', label: 'Actuator force', short: 'Actuator force', unit: u.force, group: 'Driver' },
    { key: 'd:power', label: 'Input power', short: 'Input power', unit: 'W', group: 'Driver' },
  ];
  const T = `${u.force}·${u.length}`;
  const names = jointNames(data.sys.model);
  const point = (p: string) => pointName(data.sys.model, p);
  const f0 = result.frames[0]!;
  if (Number.isFinite(f0.inputForce))
    out.push({
      key: 'd:inF',
      label: `Input force at ${point(forces.inputPoint)}`,
      short: `Input as a force at ${point(forces.inputPoint)}`,
      unit: u.force,
      group: 'Driver',
    });
  if (forces.solveFor === 'output' && Number.isFinite(f0.output)) {
    const oj = data.sys.model.joints.find((j) => j.id === forces.outputJoint)!;
    const rotaryOut = oj.type === 'revolute';
    const g = `Output at ${names.get(oj.id)!.long}`;
    out.push({
      key: 'd:output',
      label: rotaryOut ? 'Output torque' : 'Output force',
      short: rotaryOut ? 'Output torque' : 'Output force',
      unit: rotaryOut ? T : u.force,
      group: g,
    });
    if (rotaryOut === rotary)
      out.push({
        key: 'd:ma',
        label: 'Mechanical advantage',
        short: 'Mechanical advantage',
        unit: '×',
        group: g,
      });
    if (Number.isFinite(f0.outputForce))
      out.push({
        key: 'd:outF',
        label: `Output force at ${point(forces.outputPoint)}`,
        short: `Output as a force at ${point(forces.outputPoint)}`,
        unit: u.force,
        group: g,
      });
  }
  for (const j of data.sys.model.joints) {
    const n = names.get(j.id)!;
    const q = (w: string, short: string, unit: string): Quantity => ({
      key: `f:${j.id}:${w}`,
      label: `${n.short} ${short}`,
      short,
      unit,
      group: `Joint ${n.long}`,
    });
    out.push(q('mag', 'force', u.force), q('fx', 'Fx', u.force), q('fy', 'Fy', u.force));
    if (j.type === 'slider') out.push(q('moment', 'moment', `${u.force}·${u.length}`));
  }
  for (const pr of data.sys.model.pairs) {
    const g = `${pr.type === 'cam' ? 'Cam joint' : pr.type === 'gear' ? 'Gear mesh' : 'Rack and pinion'} ${pr.id}`;
    const q = (w: string, short: string): Quantity => ({
      key: `m:${pr.id}:${w}`,
      label: `${pr.id} ${short}`,
      short,
      unit: u.force,
      group: g,
    });
    if (pr.type === 'cam') out.push(q('force', 'contact force'));
    else out.push(q('force', 'tooth force'), q('normal', 'mesh force'), q('separating', 'separating force'));
  }
  for (const l of forces.loads) {
    if (l.type === 'spring')
      out.push({
        key: `s:${l.id}`,
        label: `Spring ${l.id} tension`,
        short: `${l.id} tension`,
        unit: u.force,
        group: 'Springs',
      });
    if (l.type === 'torsion')
      out.push({
        key: `s:${l.id}`,
        label: `Torsion spring ${l.id} torque`,
        short: `${l.id} torque`,
        unit: `${u.force}·${u.length}`,
        group: 'Springs',
      });
  }
  return out;
}

export function forceSeries(result: ForceResult, key: string): number[] {
  const [kind, id, what] = key.split(':') as [string, string, string | undefined];
  return result.frames.map((f) => {
    if (kind === 'd') {
      if (id === 'output') return f.output;
      if (id === 'ma') return f.driver ? f.output / f.driver : NaN;
      if (id === 'inF') return f.inputForce;
      if (id === 'outF') return f.outputForce;
      return id === 'effort' ? f.driver : f.power;
    }
    if (kind === 's') return f.springs.get(id) ?? NaN;
    if (kind === 'm') {
      const pf = f.pairs.get(id);
      return pf ? (what === 'normal' ? pf.normal : what === 'separating' ? pf.separating : pf.force) : NaN;
    }
    const j = f.joints.get(id);
    if (!j) return NaN;
    if (what === 'fx') return j.fx;
    if (what === 'fy') return j.fy;
    if (what === 'moment') return j.moment;
    return Math.hypot(j.fx, j.fy);
  });
}

export interface ForceSummary {
  /** atBack: the peak is on the way back (a there-and-back cycle). */
  effort: { min: number; max: number; rms: number; atMax: number; atBack: boolean };
  power: { peak: number; mean: number };
  joints: { id: string; point: string; max: number; at: number; atBack: boolean }[];
  /** Cam and gear joints: force range (tooth force for gears, contact force for cams) and where it peaks. */
  pairs: {
    id: string;
    kind: 'cam' | 'gear' | 'rack';
    min: number;
    max: number;
    at: number;
    atBack: boolean;
  }[];
  /** Solving for the output: its range, the mechanical advantage range, and the forces at points. */
  output: {
    min: number;
    max: number;
    /** Median magnitude: a typical value that isn't swamped by dead-point spikes. */
    typical: number;
    ma?: { min: number; max: number };
    /** Driver inputs (user units) where the output stops and reverses: its torque or force is unbounded there. */
    deadPoints: number[];
  } | null;
  inputForce: { min: number; max: number } | null;
  outputForce: { min: number; max: number } | null;
  balance: number;
}

/** Peaks over the sweep. `at` values are driver inputs in user units. */
export function summarizeForces(data: MotionData, result: ForceResult): ForceSummary | null {
  const frames = data.frames;
  if (!result.frames.length || frames.length !== result.frames.length) return null;
  const inputs = frames.map((f) => inputValue(data, f));
  const effort = forceSeries(result, 'd:effort');
  const power = forceSeries(result, 'd:power');
  const iMax = effort.reduce((best, v, i) => (Math.abs(v) > Math.abs(effort[best]!) ? i : best), 0);
  const joints = data.sys.model.joints.map((j) => {
    const mag = forceSeries(result, `f:${j.id}:mag`);
    const k = mag.reduce((best, v, i) => (v > mag[best]! ? i : best), 0);
    return { id: j.id, point: j.point, max: mag[k]!, at: inputs[k]!, atBack: frames[k]!.dir === -1 };
  });
  return {
    effort: {
      min: Math.min(...effort),
      max: Math.max(...effort),
      rms: Math.sqrt(effort.reduce((s, v) => s + v * v, 0) / effort.length),
      atMax: inputs[iMax]!,
      atBack: frames[iMax]!.dir === -1,
    },
    power: { peak: Math.max(...power.map(Math.abs)), mean: power.reduce((s, v) => s + v, 0) / power.length },
    joints,
    pairs: data.sys.model.pairs.map((pr) => {
      const v = forceSeries(result, `m:${pr.id}:force`);
      const k = v.reduce((best, x, i) => (Math.abs(x) > Math.abs(v[best]!) ? i : best), 0);
      return {
        id: pr.id,
        kind: pr.type,
        min: Math.min(...v),
        max: Math.max(...v),
        at: inputs[k]!,
        atBack: frames[k]!.dir === -1,
      };
    }),
    output: Number.isFinite(result.frames[0]!.output) ? outputSummary(result, inputs) : null,
    inputForce: range(forceSeries(result, 'd:inF')),
    outputForce: range(forceSeries(result, 'd:outF')),
    balance: Math.max(...result.frames.map((f) => f.balance)),
  };
}

/** Forces table for CSV export: one row per frame. */
export function forcesTable(
  data: MotionData,
  forces: ForcesData,
  result: ForceResult,
  u: ForceUnitsLabel,
): string[][] {
  const qs = forceQuantities(data, forces, result, u);
  const inputUnit =
    data.sys.driver?.type === 'rotary' ? (data.units.angle === 'deg' ? 'deg' : 'rad') : data.units.length;
  const header = [
    'input [' + inputUnit + ']',
    'time [s]',
    ...qs.map((q) => `${q.label.replace(/\s+/g, '_')} [${q.unit.replace('·', '*')}]`),
  ];
  const cols = qs.map((q) => forceSeries(result, q.key));
  const frames = data.frames;
  return [
    header,
    ...frames.map((f, i) => [
      formatNumber(inputValue(data, f)),
      formatNumber(timeOf(data, f)),
      ...cols.map((c) => formatNumber(c[i]!)),
    ]),
  ];
}

function range(v: number[]): { min: number; max: number } | null {
  const ok = v.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok) } : null;
}

function outputSummary(result: ForceResult, inputs: number[]): NonNullable<ForceSummary['output']> {
  const all = forceSeries(result, 'd:output');
  const out = all.filter(Number.isFinite);
  const mags = out.map(Math.abs).sort((a, b) => a - b);
  const typical = mags[Math.floor((mags.length - 1) / 2)] ?? 0;
  // The output flips sign through a spike where it stops and reverses.
  const deadPoints: number[] = [];
  for (let k = 1; k < all.length; k++) {
    const a = all[k - 1]!;
    const b = all[k]!;
    if (a * b < 0 && Math.min(Math.abs(a), Math.abs(b)) > 3 * typical)
      deadPoints.push(Math.abs(a) > Math.abs(b) ? inputs[k - 1]! : inputs[k]!);
  }
  const ma = range(forceSeries(result, 'd:ma'));
  return { min: Math.min(...out), max: Math.max(...out), typical, deadPoints, ...(ma ? { ma } : {}) };
}

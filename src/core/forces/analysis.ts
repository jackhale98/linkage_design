// Force results for plots, summaries and export.

import { formatNumber } from '../csv/values';
import { inputValue, reachable, timeOf, type MotionData } from '../mechanism/analysis';
import type { Quantity } from '../mechanism/analysis';
import type { ForcesData } from './types';
import type { ForceResult } from './solve';

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
      ? { key: 'd:effort', label: 'Input torque', unit: `${u.force}·${u.length}`, group: 'Driver' }
      : { key: 'd:effort', label: 'Actuator force', unit: u.force, group: 'Driver' },
    { key: 'd:power', label: 'Input power', unit: 'W', group: 'Driver' },
  ];
  for (const j of data.sys.model.joints) {
    const g = `Joint ${j.id} (at ${j.point})`;
    out.push(
      { key: `f:${j.id}:mag`, label: `${j.id} force`, unit: u.force, group: g },
      { key: `f:${j.id}:fx`, label: `${j.id} Fx`, unit: u.force, group: g },
      { key: `f:${j.id}:fy`, label: `${j.id} Fy`, unit: u.force, group: g },
    );
    if (j.type === 'slider')
      out.push({
        key: `f:${j.id}:moment`,
        label: `${j.id} moment`,
        unit: `${u.force}·${u.length}`,
        group: g,
      });
  }
  for (const l of forces.loads) {
    if (l.type === 'spring')
      out.push({ key: `s:${l.id}`, label: `Spring ${l.id} tension`, unit: u.force, group: 'Springs' });
    if (l.type === 'torsion')
      out.push({
        key: `s:${l.id}`,
        label: `Torsion spring ${l.id} torque`,
        unit: `${u.force}·${u.length}`,
        group: 'Springs',
      });
  }
  return out;
}

export function forceSeries(result: ForceResult, key: string): number[] {
  const [kind, id, what] = key.split(':') as [string, string, string | undefined];
  return result.frames.map((f) => {
    if (kind === 'd') return id === 'effort' ? f.driver : f.power;
    if (kind === 's') return f.springs.get(id) ?? NaN;
    const j = f.joints.get(id);
    if (!j) return NaN;
    if (what === 'fx') return j.fx;
    if (what === 'fy') return j.fy;
    if (what === 'moment') return j.moment;
    return Math.hypot(j.fx, j.fy);
  });
}

export interface ForceSummary {
  effort: { min: number; max: number; rms: number; atMax: number };
  power: { peak: number; mean: number };
  joints: { id: string; point: string; max: number; at: number }[];
  balance: number;
}

/** Peaks over the sweep. `at` values are driver inputs in user units. */
export function summarizeForces(data: MotionData, result: ForceResult): ForceSummary | null {
  const frames = reachable(data.res);
  if (!result.frames.length || frames.length !== result.frames.length) return null;
  const inputs = frames.map((f) => inputValue(data, f));
  const effort = forceSeries(result, 'd:effort');
  const power = forceSeries(result, 'd:power');
  const iMax = effort.reduce((best, v, i) => (Math.abs(v) > Math.abs(effort[best]!) ? i : best), 0);
  const joints = data.sys.model.joints.map((j) => {
    const mag = forceSeries(result, `f:${j.id}:mag`);
    const k = mag.reduce((best, v, i) => (v > mag[best]! ? i : best), 0);
    return { id: j.id, point: j.point, max: mag[k]!, at: inputs[k]! };
  });
  return {
    effort: {
      min: Math.min(...effort),
      max: Math.max(...effort),
      rms: Math.sqrt(effort.reduce((s, v) => s + v * v, 0) / effort.length),
      atMax: inputs[iMax]!,
    },
    power: { peak: Math.max(...power.map(Math.abs)), mean: power.reduce((s, v) => s + v, 0) / power.length },
    joints,
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
  const frames = reachable(data.res);
  return [
    header,
    ...frames.map((f, i) => [
      formatNumber(inputValue(data, f)),
      formatNumber(timeOf(data, f)),
      ...cols.map((c) => formatNumber(c[i]!)),
    ]),
  ];
}

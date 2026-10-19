// The motion program: segments laid end to end over one cam revolution.
// Gives the follower displacement and its derivatives with respect to the cam
// angle (radians), and checks the fundamental law of cam design: displacement,
// velocity and acceleration must be continuous (finite jerk).

import { law } from './laws';
import { isOscillating, type CamData, type CamSegment } from './types';

const DEG = Math.PI / 180;

/** s and its derivatives with respect to cam angle (per radian). */
export interface SVAJ {
  s: number;
  v: number;
  a: number;
  j: number;
}

export interface ProgramIssue {
  severity: 'error' | 'warning';
  message: string;
  /** Cam angle (degrees) the issue is at, if any. */
  at?: number;
}

export interface Program {
  segments: { seg: CamSegment; start: number; end: number; from: number; to: number }[];
  /** Total cam angle covered (degrees). */
  total: number;
  /** Lift unit factor: lifts are converted to the internal unit (length, or radians for oscillating). */
  liftScale: number;
  issues: ProgramIssue[];
}

export function buildProgram(cam: CamData): Program {
  const liftScale = isOscillating(cam.follower) ? DEG : 1;
  const issues: ProgramIssue[] = [];
  const segments: Program['segments'] = [];
  let angle = 0;
  let level = 0;
  for (const seg of cam.segments) {
    const d = seg.type === 'rise' ? seg.lift : seg.type === 'return' ? -seg.lift : 0;
    segments.push({ seg, start: angle, end: angle + seg.duration, from: level, to: level + d * liftScale });
    angle += seg.duration;
    level += d * liftScale;
  }
  if (!cam.segments.length) issues.push({ severity: 'error', message: 'Add segments to the motion program' });
  else {
    if (Math.abs(angle - 360) > 1e-9)
      issues.push({
        severity: 'error',
        message: `The segments cover ${fmt(angle)}°; they must add up to 360°`,
      });
    if (Math.abs(level) > 1e-9 * Math.max(1, ...cam.segments.map((s) => s.lift * liftScale)))
      issues.push({
        severity: 'error',
        message: `The follower ends ${fmt(level / liftScale)}${isOscillating(cam.follower) ? '°' : ''} above where it starts; rises and returns must balance`,
      });
    for (const s of segments)
      if (s.to < -1e-9)
        issues.push({ severity: 'error', message: `${s.seg.id} takes the follower below the base circle` });
  }
  return { segments, total: angle, liftScale, issues };
}

const fmt = (v: number) => Number(v.toFixed(3)).toString();

/** Follower motion at cam angle theta (radians, wrapped to one revolution). */
export function svaj(p: Program, theta: number): SVAJ {
  if (!p.segments.length || p.total <= 0) return { s: 0, v: 0, a: 0, j: 0 };
  const deg = (((theta / DEG) % p.total) + p.total) % p.total;
  const k = p.segments.findIndex((x) => deg < x.end);
  const s = p.segments[k < 0 ? p.segments.length - 1 : k]!;
  return segmentAt(s, deg);
}

function segmentAt(s: Program['segments'][number], deg: number): SVAJ {
  const beta = (s.end - s.start) * DEG;
  const h = s.to - s.from;
  if (beta <= 0 || h === 0) return { s: s.from, v: 0, a: 0, j: 0 };
  const u = Math.min(1, Math.max(0, (deg - s.start) / (s.end - s.start)));
  const [y, y1, y2, y3] = law(s.seg.law, u);
  return { s: s.from + h * y, v: (h * y1) / beta, a: (h * y2) / beta ** 2, j: (h * y3) / beta ** 3 };
}

/**
 * Fundamental-law check at every boundary (including 360° back to 0°):
 * velocity jumps mean infinite acceleration, acceleration jumps infinite jerk.
 */
export function fundamentalLaw(p: Program): ProgramIssue[] {
  const out: ProgramIssue[] = [];
  const n = p.segments.length;
  if (n === 0) return out;
  const scaleV = Math.max(
    1e-12,
    ...p.segments.map((s) => Math.abs(s.to - s.from) / Math.max((s.end - s.start) * DEG, 1e-9)),
  );
  const scaleA = Math.max(
    1e-12,
    ...p.segments.map((s) => Math.abs(s.to - s.from) / Math.max((s.end - s.start) * DEG, 1e-9) ** 2),
  );
  for (let k = 0; k < n; k++) {
    const a = p.segments[k]!;
    const b = p.segments[(k + 1) % n]!;
    const end = segmentAt(a, a.end);
    const start = segmentAt(b, b.start);
    const at = k + 1 === n ? 0 : a.end;
    if (Math.abs(end.v - start.v) > 1e-6 * scaleV)
      out.push({
        severity: 'error',
        at,
        message: `Velocity jumps at ${fmt(at)}° (${a.seg.id} → ${b.seg.id}): infinite acceleration`,
      });
    else if (Math.abs(end.a - start.a) > 1e-6 * scaleA)
      out.push({
        severity: 'warning',
        at,
        message: `Acceleration jumps at ${fmt(at)}° (${a.seg.id} → ${b.seg.id}): infinite jerk`,
      });
  }
  return out;
}

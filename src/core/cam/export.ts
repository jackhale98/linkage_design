// Cam exports: SVAJ and profile tables (CSV), and the profile as DXF and SVG
// for CAD and laser/CNC tools. Profiles are in the cam frame (cam at rest,
// zero angle), centred on the cam axis, in project length units.

import { formatNumber } from '../csv/values';
import type { CamAnalysis } from './analysis';
import { isOscillating, isRoller, type CamData } from './types';

export interface CamUnits {
  length: string;
  force: string;
}

/** SVAJ and the checks, one row per analysis step. */
export function svajTable(cam: CamData, a: CamAnalysis, u: CamUnits): string[][] {
  const osc = isOscillating(cam.follower);
  const s = osc ? 'deg' : u.length;
  const header = [
    'cam_angle [deg]',
    'time [s]',
    `s [${s}]`,
    `v [${s}/s]`,
    `a [${s}/s^2]`,
    `j [${s}/s^3]`,
    'pressure_angle [deg]',
    ...(isRoller(cam.follower) ? [`rho_pitch [${u.length}]`] : []),
    `rho_surface [${u.length}]`,
    `contact_force [${u.force}]`,
    `cam_torque [${u.force}*${u.length}]`,
  ];
  return [
    header,
    ...a.samples.map((x) =>
      [
        x.angle,
        x.time,
        x.s,
        x.v,
        x.a,
        x.j,
        x.pressure,
        ...(isRoller(cam.follower) ? [x.rhoPitch] : []),
        x.rhoSurface,
        x.force,
        x.torque,
      ].map(formatNumber),
    ),
  ];
}

/** Cam surface (and pitch curve, for rollers) as x, y points. */
export function profileTable(cam: CamData, a: CamAnalysis, u: CamUnits): string[][] {
  const roller = isRoller(cam.follower);
  return [
    [
      'cam_angle [deg]',
      `x [${u.length}]`,
      `y [${u.length}]`,
      ...(roller ? [`pitch_x [${u.length}]`, `pitch_y [${u.length}]`] : []),
    ],
    ...a.samples.map((x) =>
      [x.angle, x.surface[0], x.surface[1], ...(roller ? [x.pitch[0], x.pitch[1]] : [])].map(formatNumber),
    ),
  ];
}

/** The cam surface as a closed DXF polyline (R12 POLYLINE, read by nearly every CAD tool). */
export function profileDxf(a: CamAnalysis): string {
  const lines = ['0', 'SECTION', '2', 'ENTITIES', '0', 'POLYLINE', '8', 'CAM', '66', '1', '70', '1'];
  for (const x of a.samples)
    lines.push(
      '0',
      'VERTEX',
      '8',
      'CAM',
      '10',
      formatNumber(x.surface[0]),
      '20',
      formatNumber(x.surface[1]),
      '30',
      '0',
    );
  lines.push('0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF');
  return lines.join('\r\n') + '\r\n';
}

/** The cam surface as SVG at true size (1 user unit = 1 length unit), with the axis marked. */
export function profileSvg(cam: CamData, a: CamAnalysis, u: CamUnits): string {
  const xs = a.samples.map((x) => x.surface[0]);
  const ys = a.samples.map((x) => -x.surface[1]); // SVG y points down
  const pad = cam.baseRadius * 0.1;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...ys) + pad - minY;
  const f = (v: number) => formatNumber(v);
  const d = 'M' + a.samples.map((x) => `${f(x.surface[0])} ${f(-x.surface[1])}`).join('L') + 'Z';
  const tick = cam.baseRadius * 0.1;
  const unit = u.length === 'in' ? 'in' : u.length === 'm' ? 'm' : 'mm';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}${unit === 'm' ? '' : unit}" height="${f(h)}${unit === 'm' ? '' : unit}" viewBox="${f(minX)} ${f(minY)} ${f(w)} ${f(h)}">`,
    `  <path d="${d}" fill="none" stroke="black" stroke-width="${f(cam.baseRadius * 0.005)}"/>`,
    `  <path d="M${f(-tick)} 0H${f(tick)}M0 ${f(-tick)}V${f(tick)}" stroke="black" stroke-width="${f(cam.baseRadius * 0.005)}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

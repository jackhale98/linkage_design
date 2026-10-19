import { describe, expect, it } from 'vitest';
import { convertUnits, newProject, parseProject, serializeProject } from '../../../src/core/model/project';
import { starterProgram } from '../../../src/core/cam/types';

describe('cam CSV', () => {
  it('leaves the cam out of linkage-only files', () => {
    expect(serializeProject(newProject())).not.toContain('[cam]');
  });

  it('round-trips settings and the motion program byte for byte', () => {
    const p = newProject(new Date('2026-10-19T12:00:00Z'));
    p.cam = {
      ...p.cam,
      follower: 'oscillating_roller',
      rotation: 'cw',
      baseRadius: 35,
      springRate: 1200,
      segments: starterProgram().map((s, i) => ({ ...s, law: i === 1 ? 'poly_345' : 'modified_sine' })),
    };
    const text = serializeProject(p);
    expect(text).toContain(
      '[cam_segments]\r\nid,type,duration,lift,law\r\nS1,dwell,60,0,modified_sine\r\nS2,rise,120,20,poly_345\r\n',
    );
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.project.cam).toEqual(p.cam);
    expect(serializeProject(r.project)).toBe(text);
  });

  it('rejects unknown laws and follower types with line numbers', () => {
    const p = newProject();
    p.cam = { ...p.cam, segments: starterProgram() };
    const text = serializeProject(p).replace('S2,rise,120,20,cycloidal', 'S2,rise,120,20,bezier');
    const r = parseProject(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/bezier/);
  });

  it('converts cam lengths and loads with the project units, but not oscillating lifts (degrees)', () => {
    const p = newProject();
    p.cam = { ...p.cam, baseRadius: 40, springRate: 2, preload: 10, mass: 1, segments: starterProgram() };
    convertUnits(p, 'in', 'deg', 'lbf');
    expect(p.cam.baseRadius).toBeCloseTo(40 / 25.4, 12);
    expect(p.cam.segments[1]!.lift).toBeCloseTo(20 / 25.4, 12);
    expect(p.cam.preload).toBeCloseTo(10 / 4.4482216152605, 12);
    const q = newProject();
    q.cam = { ...q.cam, follower: 'oscillating_roller', segments: starterProgram() };
    convertUnits(q, 'm', 'deg');
    expect(q.cam.segments[1]!.lift).toBe(20);
  });
});

describe('cam exports', () => {
  it('writes SVAJ, profile, DXF and SVG for the analysed cam', async () => {
    const { analyzeCam } = await import('../../../src/core/cam/analysis');
    const { svajTable, profileTable, profileDxf, profileSvg } = await import('../../../src/core/cam/export');
    const p = newProject();
    p.cam = { ...p.cam, step: 1, segments: starterProgram() };
    const u = { length: 'mm', force: 'N' } as const;
    const a = analyzeCam(p.cam, u);
    const svaj = svajTable(p.cam, a, u);
    expect(svaj[0]).toEqual([
      'cam_angle [deg]',
      'time [s]',
      's [mm]',
      'v [mm/s]',
      'a [mm/s^2]',
      'j [mm/s^3]',
      'pressure_angle [deg]',
      'rho_pitch [mm]',
      'rho_surface [mm]',
      'contact_force [N]',
      'cam_torque [N*mm]',
    ]);
    expect(svaj).toHaveLength(361);
    const prof = profileTable(p.cam, a, u);
    expect(prof[0]).toEqual(['cam_angle [deg]', 'x [mm]', 'y [mm]', 'pitch_x [mm]', 'pitch_y [mm]']);
    // At zero angle in a dwell the surface sits on the base circle, under the follower.
    expect(Number(prof[1]![1])).toBeCloseTo(0, 9);
    expect(Number(prof[1]![2])).toBeCloseTo(40, 9);
    const dxf = profileDxf(a);
    expect(dxf.startsWith('0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nPOLYLINE')).toBe(true);
    expect(dxf.match(/VERTEX/g)).toHaveLength(360);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    const svg = profileSvg(p.cam, a, u);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="[\d.]+mm"/);
    expect(svg).toContain('<path d="M0 -40L');
  });
});

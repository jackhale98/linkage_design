import { describe, expect, it } from 'vitest';
import { newProject, parseProject, projectFileName, serializeProject } from '../../../src/core/model/project';

const fixed = new Date('2026-10-19T12:00:00.000Z');

describe('project file', () => {
  it('round-trips byte-for-byte', () => {
    const p = newProject(fixed);
    p.meta.name = 'Crank, rocker "demo"';
    p.meta.notes = 'Line one\nLine two';
    p.meta.length_unit = 'in';
    const text = serializeProject(p);
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings).toEqual([]);
    expect(r.project.meta).toEqual(p.meta);
    expect(serializeProject(r.project)).toBe(text);
  });

  it('preserves unknown sections and keys from newer versions', () => {
    const text =
      'LinkageDesign,2\r\n[project]\r\nkey,value\r\nname,Future\r\nmaterial,steel\r\n' +
      '[hologram]\r\nid,brightness\r\nH1,"0,9"\r\n';
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('newer than this app'),
      expect.stringContaining('[hologram]'),
    ]);
    expect(r.project.meta.extras).toEqual({ material: 'steel' });
    const out = serializeProject(r.project);
    expect(out).toContain('material,steel');
    expect(out).toContain('[hologram]\r\nid,brightness\r\nH1,"0,9"\r\n');
    const again = parseProject(out);
    expect(again.ok && serializeProject(again.project)).toBe(out);
  });

  it('accepts files re-saved by Excel with semicolons', () => {
    const r = parseProject(
      'LinkageDesign;1\r\n[project]\r\nkey;value\r\nname;Gripper; v2\r\nlength_unit;MM\r\n',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.meta.name).toBe('Gripper');
      expect(r.project.meta.length_unit).toBe('mm');
    }
  });

  it('rejects unrelated files without partial results', () => {
    const r = parseProject('Date,Open,Close\n2026-01-01,1,2\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toMatch(/doesn't look like a Linkage Design project/);
  });

  it('rejects files with invalid values and reports line numbers', () => {
    const r = parseProject('LinkageDesign,1\n[project]\nkey,value\nlength_unit,furlong\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ line: 4, section: 'project', column: 'length_unit' });
  });

  it('rejects an invalid version', () => {
    const r = parseProject('LinkageDesign,beta\n[project]\nkey,value\n');
    expect(r.ok).toBe(false);
  });

  it('builds safe file names', () => {
    const p = newProject(fixed);
    p.meta.name = 'Toggle clamp / v2: final?';
    expect(projectFileName(p)).toBe('Toggle_clamp_v2_final.csv');
    p.meta.name = '   ';
    expect(projectFileName(p, '_kinematics')).toBe('mechanism_kinematics.csv');
  });
});

import { describe, expect, it } from 'vitest';
import { convertUnits, newProject, parseProject, serializeProject } from '../../../src/core/model/project';
import { addConstraint, addLine, addPoint } from '../../../src/core/sketch/edit';

const ctx = { angleScale: Math.PI / 180 };
const fixed = new Date('2026-10-19T12:00:00.000Z');

function project() {
  const p = newProject(fixed);
  const s = p.sketch;
  const a = addPoint(s, 0, 0);
  const b = addPoint(s, 40, 30);
  s.points[0]!.fixed = true;
  s.points[0]!.label = 'O2, ground';
  addLine(s, a, b);
  const r1 = addConstraint(s, { type: 'distance', refs: ['L1'], value: 50, labelDx: 5, labelDy: -8 }, ctx);
  const r2 = addConstraint(s, { type: 'angle', refs: ['L1'], value: 36.87 }, ctx);
  if (!r1.ok || !r2.ok) throw new Error('setup failed');
  return p;
}

describe('sketch CSV', () => {
  it('round-trips byte-for-byte', () => {
    const p = project();
    const text = serializeProject(p);
    expect(text).toContain('[points]\r\nid,x,y,fixed,label\r\nP1,0,0,1,"O2, ground"\r\n');
    expect(text).toContain('[lines]\r\nid,p1,p2,construction\r\nL1,P1,P2,0\r\n');
    expect(text).toContain(
      '[constraints]\r\nid,type,a,b,c,value,reference,label_dx,label_dy\r\nC1,distance,L1,,,50,0,5,-8\r\nC2,angle,L1,,,36.87,0,,\r\n',
    );
    const r = parseProject(text);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.warnings).toEqual([]);
    expect(serializeProject(r.project)).toBe(text);
    expect(r.project.sketch.constraints[0]).toEqual(p.sketch.constraints[0]);
  });

  it('reports bad references and signatures with line numbers', () => {
    const text = [
      'LinkageDesign,1',
      '[points]',
      'id,x,y',
      'P1,0,0',
      'P2,10,0',
      '[lines]',
      'id,p1,p2',
      'L1,P1,P9',
      'P2,P1,P2',
      '[constraints]',
      'id,type,a,b,value',
      'C1,parallel,L1,P1,',
      'C2,distance,P1,P2,',
      'C3,horizontal,L1,,5',
      'C4,distance,P1,P2,-3',
      'C5,coincident,P1,Q7,',
    ].join('\n');
    const r = parseProject(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
      '8: Point "P9" doesn\'t exist',
      '9: ID "P2" is already used by a point',
      '12: parallel needs line + line; got line + point',
      '13: distance needs a value',
      '15: Lengths must be greater than zero',
      '16: "Q7" doesn\'t exist',
    ]);
    expect(r.warnings.map((w) => `${w.line}: ${w.message}`)).toEqual([
      "14: horizontal doesn't take a value; ignored",
    ]);
  });

  it('converts units without changing the physical geometry', () => {
    const p = project();
    const x = p.sketch.points[1]!.x;
    convertUnits(p, 'in', 'rad');
    expect(p.sketch.points[1]!.x).toBeCloseTo(x / 25.4, 12);
    expect(p.sketch.constraints[0]!.value).toBeCloseTo(50 / 25.4, 12);
    expect(p.sketch.constraints[1]!.value).toBeCloseTo((36.87 * Math.PI) / 180, 12);
    convertUnits(p, 'mm', 'deg');
    expect(p.sketch.points[1]!.x).toBeCloseTo(x, 10);
    expect(p.sketch.constraints[1]!.value).toBeCloseTo(36.87, 10);
  });
});

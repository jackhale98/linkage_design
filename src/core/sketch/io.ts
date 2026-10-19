// Sketch <-> CSV sections: [points], [lines], [constraints].

import { Diagnostics } from '../csv/diagnostics';
import type { Delimiter } from '../csv/rfc4180';
import type { RawSection, SectionOut } from '../csv/sectioned';
import { readTable, writeTable } from '../csv/table';
import { CONSTRAINT_DEFS, matchesSignature, refKinds } from './constraints';
import { CONSTRAINT_TYPES, type Sketch, type SketchConstraint } from './types';

export const POINTS_SPEC = {
  id: { type: 'id', required: true },
  x: { type: 'number', required: true },
  y: { type: 'number', required: true },
  fixed: { type: 'bool' },
  label: { type: 'string' },
} as const;

export const LINES_SPEC = {
  id: { type: 'id', required: true },
  p1: { type: 'ref', required: true },
  p2: { type: 'ref', required: true },
  construction: { type: 'bool' },
} as const;

export const CONSTRAINTS_SPEC = {
  id: { type: 'id', required: true },
  type: { type: 'enum', values: CONSTRAINT_TYPES, required: true },
  a: { type: 'ref', required: true },
  b: { type: 'ref' },
  c: { type: 'ref' },
  value: { type: 'number' },
  reference: { type: 'bool' },
  label_dx: { type: 'number' },
  label_dy: { type: 'number' },
} as const;

export const SKETCH_SECTIONS = ['points', 'lines', 'constraints'] as const;

/** Snap float noise (e.g. 4.7e-17 from a solve) to zero; 1e-9 is negligible in any length unit. */
const clean = (v: number | undefined) => (v !== undefined && Math.abs(v) < 1e-9 ? 0 : v);

export function writeSketch(sketch: Sketch): SectionOut[] {
  return [
    writeTable(
      'points',
      POINTS_SPEC,
      sketch.points.map((p) => ({ ...p, x: clean(p.x)!, y: clean(p.y)! })),
      'Sketch points. fixed = anchored in place.',
    ),
    writeTable(
      'lines',
      LINES_SPEC,
      sketch.lines.map((l) => ({ ...l })),
      'Lines between points. construction = helper geometry.',
    ),
    writeTable(
      'constraints',
      CONSTRAINTS_SPEC,
      sketch.constraints.map((c) => ({
        id: c.id,
        type: c.type,
        a: c.refs[0] ?? '',
        b: c.refs[1] ?? '',
        c: c.refs[2] ?? '',
        value: clean(c.value),
        reference: c.reference,
        label_dx: clean(c.labelDx),
        label_dy: clean(c.labelDy),
        extras: c.extras,
      })),
      'Constraints and dimensions. Values use the project units; angles are counterclockwise from line a to line b.',
    ),
  ];
}

/** Read sketch sections and validate references. Problems go to `diag`. */
export function readSketch(
  sections: Map<string, RawSection>,
  delimiter: Delimiter,
  diag: Diagnostics,
): Sketch {
  const sketch: Sketch = { points: [], lines: [], constraints: [] };
  const ps = sections.get('points');
  const ls = sections.get('lines');
  const cs = sections.get('constraints');

  if (ps) {
    sketch.points = readTable(ps, POINTS_SPEC, delimiter, diag).map((r) => ({
      id: r.id ?? '',
      x: r.x ?? 0,
      y: r.y ?? 0,
      fixed: r.fixed,
      label: r.label,
      extras: r.extras,
    }));
  }
  const pointIds = new Set(sketch.points.map((p) => p.id));

  if (ls) {
    for (const r of readTable(ls, LINES_SPEC, delimiter, diag)) {
      const where = { line: r.line, section: 'lines' };
      if (r.id && pointIds.has(r.id)) diag.error(`ID "${r.id}" is already used by a point`, where);
      for (const key of ['p1', 'p2'] as const) {
        const v = r[key];
        if (v && !pointIds.has(v)) diag.error(`Point "${v}" doesn't exist`, { ...where, column: key });
      }
      if (r.p1 && r.p1 === r.p2) diag.error('A line needs two different points', where);
      sketch.lines.push({
        id: r.id ?? '',
        p1: r.p1 ?? '',
        p2: r.p2 ?? '',
        construction: r.construction,
        extras: r.extras,
      });
    }
  }
  const entityIds = new Set([...pointIds, ...sketch.lines.map((l) => l.id)]);

  if (cs) {
    for (const r of readTable(cs, CONSTRAINTS_SPEC, delimiter, diag)) {
      const where = { line: r.line, section: 'constraints' };
      if (r.id && entityIds.has(r.id)) diag.error(`ID "${r.id}" is already used by a point or line`, where);
      const refs = [r.a, r.b, r.c].filter((x): x is string => !!x);
      const type = r.type;
      const c: SketchConstraint = {
        id: r.id ?? '',
        type: type ?? 'distance',
        refs,
        value: r.value,
        reference: r.reference,
        labelDx: r.label_dx,
        labelDy: r.label_dy,
        extras: r.extras,
      };
      if (type) {
        const kinds = refKinds(sketch, refs);
        const missing = refs.filter((_, i) => kinds[i] === undefined);
        if (missing.length) {
          diag.error(`${missing.map((m) => `"${m}"`).join(', ')} doesn't exist`, where);
        } else if (!matchesSignature(type, kinds as ('point' | 'line')[])) {
          const sigs = CONSTRAINT_DEFS[type].signatures.map((s) => s.join(' + ')).join(' or ');
          diag.error(`${type} needs ${sigs}; got ${kinds.join(' + ')}`, where);
        }
        const kind = CONSTRAINT_DEFS[type].value;
        if (kind && c.value === undefined && !c.reference)
          diag.error(`${type} needs a value`, { ...where, column: 'value' });
        if (kind === 'length' && c.value !== undefined && !(c.value > 0))
          diag.error('Lengths must be greater than zero', { ...where, column: 'value' });
        if (!kind && c.value !== undefined)
          diag.warn(`${type} doesn't take a value; ignored`, { ...where, column: 'value' });
        if (!kind) {
          c.value = undefined;
          c.reference = false;
        }
      }
      sketch.constraints.push(c);
    }
  }
  return sketch;
}

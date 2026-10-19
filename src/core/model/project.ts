// Project model and its sectioned-CSV file format.
//
// Covers project metadata and the sketch. Later phases add mechanism,
// forces and cam sections; sections this version doesn't know are kept
// verbatim and written back out, so newer files survive a round trip.

import { Diagnostics, type Diagnostic } from '../csv/diagnostics';
import {
  parseSectioned,
  stringifySectioned,
  type RawSection,
  type SectionOut,
  type SectionedDoc,
} from '../csv/sectioned';
import { readKeyValue, writeKeyValue, type Row, type Extras } from '../csv/table';
import { readSketch, writeSketch, SKETCH_SECTIONS } from '../sketch/io';
import { CONSTRAINT_DEFS } from '../sketch/constraints';
import { emptySketch, type Sketch } from '../sketch/types';
import { readMechanism, writeMechanism, MECHANISM_SECTIONS } from '../mechanism/io';
import { syncMechanism } from '../mechanism/model';
import { emptyMechanism, type MechanismData } from '../mechanism/types';

export const FILE_APP = 'LinkageDesign';
export const FILE_VERSION = 1;

export const LENGTH_UNITS = ['mm', 'm', 'in'] as const;
export const FORCE_UNITS = ['N', 'lbf'] as const;
export const ANGLE_UNITS = ['deg', 'rad'] as const;

export type LengthUnit = (typeof LENGTH_UNITS)[number];
export type ForceUnit = (typeof FORCE_UNITS)[number];
export type AngleUnit = (typeof ANGLE_UNITS)[number];

const PROJECT_SPEC = {
  name: { type: 'string', default: 'Untitled mechanism' },
  length_unit: { type: 'enum', values: LENGTH_UNITS, default: 'mm' },
  force_unit: { type: 'enum', values: FORCE_UNITS, default: 'N' },
  angle_unit: { type: 'enum', values: ANGLE_UNITS, default: 'deg' },
  notes: { type: 'string' },
  created: { type: 'string' },
  modified: { type: 'string' },
} as const;

export type ProjectMeta = Row<typeof PROJECT_SPEC> & Extras;

export interface Project {
  meta: ProjectMeta;
  sketch: Sketch;
  mechanism: MechanismData;
  /** Sections not understood by this version, kept for round trips. */
  preserved: RawSection[];
}

/** Sections this version reads. Everything else is preserved. */
const KNOWN_SECTIONS = new Set<string>(['project', ...SKETCH_SECTIONS, ...MECHANISM_SECTIONS]);

export function newProject(now = new Date()): Project {
  const stamp = now.toISOString();
  return {
    meta: {
      name: 'Untitled mechanism',
      length_unit: 'mm',
      force_unit: 'N',
      angle_unit: 'deg',
      notes: '',
      created: stamp,
      modified: stamp,
      extras: {},
    },
    sketch: emptySketch(),
    mechanism: emptyMechanism(),
    preserved: [],
  };
}

const LENGTH_IN_METERS: Record<LengthUnit, number> = { mm: 0.001, m: 1, in: 0.0254 };
const ANGLE_IN_RADIANS: Record<AngleUnit, number> = { deg: Math.PI / 180, rad: 1 };

/** Factor converting stored angle values to radians. */
export function angleScale(p: Project): number {
  return ANGLE_IN_RADIANS[p.meta.angle_unit];
}

/**
 * Change the project's units, converting every stored value so the
 * physical geometry is unchanged.
 */
export function convertUnits(p: Project, length: LengthUnit, angle: AngleUnit): void {
  const kl = LENGTH_IN_METERS[p.meta.length_unit] / LENGTH_IN_METERS[length];
  const ka = ANGLE_IN_RADIANS[p.meta.angle_unit] / ANGLE_IN_RADIANS[angle];
  for (const pt of p.sketch.points) {
    pt.x *= kl;
    pt.y *= kl;
  }
  for (const c of p.sketch.constraints) {
    const kind = CONSTRAINT_DEFS[c.type].value;
    if (c.value !== undefined) c.value *= kind === 'angle' ? ka : kl;
    if (c.labelDx !== undefined) c.labelDx *= kl;
    if (c.labelDy !== undefined) c.labelDy *= kl;
  }
  const d = p.mechanism.driver;
  const kd = d.type === 'rotary' ? ka : kl;
  if (d.start !== undefined) d.start *= kd;
  if (d.end !== undefined) d.end *= kd;
  if (d.type === 'linear') d.speed *= kl;
  p.meta.length_unit = length;
  p.meta.angle_unit = angle;
}

// ---------------------------------------------------------------- writing

export function serializeProject(p: Project): string {
  const sections: SectionOut[] = [
    writeKeyValue('project', PROJECT_SPEC, p.meta),
    ...writeSketch(p.sketch),
    ...writeMechanism(p.mechanism),
  ];
  for (const s of p.preserved) {
    sections.push({ name: s.name, header: s.header, rows: s.records.map((r) => r.cells) });
  }
  return stringifySectioned(
    {
      app: FILE_APP,
      version: FILE_VERSION,
      comment: 'Linkage Design project file - https://github.com/jackhale98/linkage_design',
    },
    sections,
  );
}

// ---------------------------------------------------------------- reading

export type ImportResult =
  | { ok: true; project: Project; warnings: Diagnostic[] }
  | { ok: false; errors: Diagnostic[]; warnings: Diagnostic[] };

/** Format migrations, keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, (doc: SectionedDoc, diag: Diagnostics) => void> = {};

function checkSignature(doc: SectionedDoc, diag: Diagnostics): number | undefined {
  const sig = doc.signature;
  if (!sig) {
    if (doc.sections.length === 0) {
      diag.error(
        `This doesn't look like a Linkage Design project: no "${FILE_APP},${FILE_VERSION}" first line and no [sections] found`,
      );
      return undefined;
    }
    diag.warn(`No "${FILE_APP},${FILE_VERSION}" signature line; assuming format version ${FILE_VERSION}`);
    return FILE_VERSION;
  }
  if (sig.app.toLowerCase() !== FILE_APP.toLowerCase()) {
    diag.error(`This doesn't look like a Linkage Design project (first line starts with "${sig.app}")`, {
      line: sig.line,
    });
    return undefined;
  }
  const version = Number(sig.version);
  if (!Number.isInteger(version) || version < 1) {
    diag.error(`Invalid format version "${sig.version}"`, { line: sig.line });
    return undefined;
  }
  if (version > FILE_VERSION) {
    diag.warn(
      `File uses format version ${version}, newer than this app (${FILE_VERSION}). Unknown data is kept but may not be editable.`,
      { line: sig.line },
    );
  }
  return version;
}

/**
 * Parse a project file. The import is atomic: on any error nothing is
 * returned, so a bad file never half-loads over the user's work.
 */
export function parseProject(text: string): ImportResult {
  const diag = new Diagnostics();
  const doc = parseSectioned(text, diag);
  // Check the signature first: for an unrelated file, "not a project" is the useful message.
  const sigDiag = new Diagnostics();
  let version = checkSignature(doc, sigDiag);
  if (version === undefined && sigDiag.hasErrors && !diag.items.some((d) => d.code === 'csv-syntax')) {
    return { ok: false, errors: sigDiag.errors, warnings: [] };
  }
  diag.items.push(...sigDiag.items);
  if (version !== undefined) {
    while (version < FILE_VERSION) {
      MIGRATIONS[version]?.(doc, diag);
      version++;
    }
  }
  if (diag.hasErrors || version === undefined)
    return { ok: false, errors: diag.errors, warnings: diag.warnings };

  const byName = new Map(doc.sections.map((s) => [s.name, s]));
  const projectSection = byName.get('project');
  const meta = readKeyValue(projectSection, PROJECT_SPEC, doc.delimiter, diag);
  const sketch = readSketch(byName, doc.delimiter, diag);
  const mechanism = readMechanism(byName, sketch, doc.delimiter, diag);

  const preserved = doc.sections.filter((s) => !KNOWN_SECTIONS.has(s.name));
  for (const s of preserved) {
    diag.warn(`Section [${s.name}] isn't used by this version; it will be kept when you save`, {
      line: s.markerLine,
      section: s.name,
    });
  }

  if (diag.hasErrors) return { ok: false, errors: diag.errors, warnings: diag.warnings };
  syncMechanism(sketch, mechanism);
  return { ok: true, project: { meta, sketch, mechanism, preserved }, warnings: diag.warnings };
}

/** File name for exporting a project, derived from its name. */
export function projectFileName(p: Project, suffix = ''): string {
  const base =
    p.meta.name
      .trim()
      .replace(/[^A-Za-z0-9 _.-]+/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'mechanism';
  return `${base}${suffix}.csv`;
}

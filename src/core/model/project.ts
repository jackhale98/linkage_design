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
import { readForces, writeForces, FORCES_SECTIONS } from '../forces/io';
import { readCam, writeCam, CAM_SECTIONS } from '../cam/io';
import { emptyCam, isOscillating, type CamData } from '../cam/types';
import { emptyForces, type ForcesData } from '../forces/types';

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
  forces: ForcesData;
  cam: CamData;
  /** Sections not understood by this version, kept for round trips. */
  preserved: RawSection[];
}

/** Sections this version reads. Everything else is preserved. */
const KNOWN_SECTIONS = new Set<string>([
  'project',
  ...SKETCH_SECTIONS,
  ...MECHANISM_SECTIONS,
  ...FORCES_SECTIONS,
  ...CAM_SECTIONS,
]);

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
    forces: emptyForces(),
    cam: emptyCam(),
    preserved: [],
  };
}

const LENGTH_IN_METERS: Record<LengthUnit, number> = { mm: 0.001, m: 1, in: 0.0254 };
const ANGLE_IN_RADIANS: Record<AngleUnit, number> = { deg: Math.PI / 180, rad: 1 };
const FORCE_IN_NEWTONS: Record<ForceUnit, number> = { N: 1, lbf: 4.4482216152605 };
const MASS_IN_KG: Record<ForceUnit, number> = { N: 1, lbf: 0.45359237 };

/** Factor converting stored angle values to radians. */
export function angleScale(p: Project): number {
  return ANGLE_IN_RADIANS[p.meta.angle_unit];
}

/**
 * Change the project's units, converting every stored value so the
 * physical geometry is unchanged.
 */
export function convertUnits(
  p: Project,
  length: LengthUnit,
  angle: AngleUnit,
  force: ForceUnit = p.meta.force_unit,
): void {
  const kl = LENGTH_IN_METERS[p.meta.length_unit] / LENGTH_IN_METERS[length];
  const ka = ANGLE_IN_RADIANS[p.meta.angle_unit] / ANGLE_IN_RADIANS[angle];
  // Force and the paired mass unit (kg with N, lb with lbf).
  const kf = FORCE_IN_NEWTONS[p.meta.force_unit] / FORCE_IN_NEWTONS[force];
  const km = MASS_IN_KG[p.meta.force_unit] / MASS_IN_KG[force];
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
  for (const b of p.mechanism.bodies) {
    if (b.mass !== undefined) b.mass *= km;
    if (b.comX !== undefined) b.comX *= kl;
    if (b.comY !== undefined) b.comY *= kl;
    if (b.inertia !== undefined) b.inertia *= km * kl * kl;
  }
  for (const l of p.forces.loads) {
    l.fx *= kf;
    l.fy *= kf;
    l.torque *= kf * kl;
    if (l.type === 'spring') {
      l.k *= kf / kl;
      l.preload *= kf;
      if (l.free !== undefined) l.free *= kl;
    } else if (l.type === 'torsion') {
      l.k *= (kf * kl) / ka;
      l.preload *= kf * kl;
      if (l.free !== undefined) l.free *= ka;
    }
  }
  p.forces.input *= d.type === 'linear' ? kf : kf * kl;
  // Cam: lengths scale; oscillating lifts are angles (degrees) and its loads are torques.
  const c = p.cam;
  const osc = isOscillating(c.follower);
  c.baseRadius *= kl;
  c.rollerRadius *= kl;
  c.offset *= kl;
  c.pivotDistance *= kl;
  c.armLength *= kl;
  if (!osc) for (const sg of c.segments) sg.lift *= kl;
  c.mass *= osc ? km * kl * kl : km;
  c.springRate *= osc ? kf * kl : kf / kl;
  c.preload *= osc ? kf * kl : kf;
  c.load *= osc ? kf * kl : kf;
  p.meta.length_unit = length;
  p.meta.angle_unit = angle;
  p.meta.force_unit = force;
}

// ---------------------------------------------------------------- writing

export function serializeProject(p: Project): string {
  const sections: SectionOut[] = [
    writeKeyValue('project', PROJECT_SPEC, p.meta),
    ...writeSketch(p.sketch),
    ...writeMechanism(p.mechanism),
    ...writeForces(p.forces),
    ...writeCam(p.cam),
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
  const forces = readForces(byName, sketch, mechanism, doc.delimiter, diag);
  const cam = readCam(byName, doc.delimiter, diag);

  const preserved = doc.sections.filter((s) => !KNOWN_SECTIONS.has(s.name));
  for (const s of preserved) {
    diag.warn(`Section [${s.name}] isn't used by this version; it will be kept when you save`, {
      line: s.markerLine,
      section: s.name,
    });
  }

  if (diag.hasErrors) return { ok: false, errors: diag.errors, warnings: diag.warnings };
  syncMechanism(sketch, mechanism);
  return { ok: true, project: { meta, sketch, mechanism, forces, cam, preserved }, warnings: diag.warnings };
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

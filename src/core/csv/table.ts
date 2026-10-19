// Schema-driven conversion between raw sections and typed records.
//
// Columns are matched by header name (case-insensitive, any order). Missing
// optional columns take their defaults, unknown columns are kept verbatim in
// `extras` so they survive a round trip, and every bad cell is reported with
// its line number.

import type { Delimiter } from './rfc4180';
import type { RawSection, SectionOut } from './sectioned';
import { Diagnostics } from './diagnostics';
import { formatBool, formatNumber, parseBool, parseNumber } from './values';

export type ColumnSpec =
  | { type: 'string'; required?: boolean; default?: string }
  | { type: 'id'; required?: boolean }
  /** A reference to an ID elsewhere: same format as an ID, but need not be unique. */
  | { type: 'ref'; required?: boolean }
  | { type: 'number'; required?: boolean; default?: number; min?: number; max?: number; integer?: boolean }
  | { type: 'bool'; required?: boolean; default?: boolean }
  | { type: 'enum'; values: readonly string[]; required?: boolean; default?: string }
  | { type: 'idlist'; required?: boolean };

export type TableSpec = Record<string, ColumnSpec>;

type BaseValue<C extends ColumnSpec> = C extends { type: 'number' }
  ? number
  : C extends { type: 'bool' }
    ? boolean
    : C extends { type: 'idlist' }
      ? string[]
      : C extends { type: 'enum'; values: readonly (infer E)[] }
        ? E
        : string;

type HasValue<C extends ColumnSpec> = C extends { required: true }
  ? true
  : C extends { default: unknown }
    ? true
    : C extends { type: 'bool' | 'idlist' | 'string' }
      ? true
      : false;

/** Typed record for a spec: required/defaulted columns are always present. */
export type Row<S extends TableSpec> = {
  -readonly [K in keyof S]: HasValue<S[K]> extends true ? BaseValue<S[K]> : BaseValue<S[K]> | undefined;
};

export interface Extras {
  /** Unknown columns, in file order, preserved for round trips. */
  extras: Record<string, string>;
}

/** `srcLine` is the record's line in the source file (named so it can't clash with a column). */
export type RecordOf<S extends TableSpec> = Row<S> & Extras & { srcLine?: number };

export const ID_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function readCell(
  spec: ColumnSpec,
  text: string,
  delimiter: Delimiter,
  report: (msg: string) => void,
): unknown {
  if (text === '') {
    if (spec.required) {
      report('value is required');
      return undefined;
    }
    if ('default' in spec) return spec.default;
    if (spec.type === 'bool') return false;
    if (spec.type === 'idlist') return [];
    if (spec.type === 'string') return '';
    return undefined;
  }
  switch (spec.type) {
    case 'string':
      return text;
    case 'id':
    case 'ref':
      if (!ID_RE.test(text)) {
        report(`"${text}" is not a valid ID (use letters, digits, "_", "-", "."; start with a letter)`);
        return undefined;
      }
      return text;
    case 'number': {
      const v = parseNumber(text, delimiter);
      if (v === undefined) {
        report(`"${text}" is not a number`);
        return undefined;
      }
      if (spec.integer && !Number.isInteger(v)) report(`${text} must be a whole number`);
      if (spec.min !== undefined && v < spec.min) report(`${text} is below the minimum of ${spec.min}`);
      if (spec.max !== undefined && v > spec.max) report(`${text} is above the maximum of ${spec.max}`);
      return v;
    }
    case 'bool': {
      const v = parseBool(text);
      if (v === undefined) report(`"${text}" is not a yes/no value (use 1/0, true/false or yes/no)`);
      return v ?? false;
    }
    case 'enum': {
      const v = spec.values.find((e) => e.toLowerCase() === text.toLowerCase());
      if (v === undefined) {
        report(`"${text}" is not one of: ${spec.values.join(', ')}`);
        return spec.default;
      }
      return v;
    }
    case 'idlist': {
      const ids = text.split(/[\s;|]+/).filter(Boolean);
      for (const id of ids) if (!ID_RE.test(id)) report(`"${id}" is not a valid ID`);
      return ids;
    }
  }
}

/** Read a table section into typed records. IDs in an `id` column must be unique. */
export function readTable<S extends TableSpec>(
  section: RawSection,
  spec: S,
  delimiter: Delimiter,
  diag: Diagnostics,
): RecordOf<S>[] {
  const keys = Object.keys(spec);
  const colIndex = new Map<string, number>();
  section.header.forEach((h, k) => {
    if (h !== '') colIndex.set(h, k);
  });
  for (const key of keys) {
    if (spec[key]!.required && !colIndex.has(key))
      diag.error(`Required column "${key}" is missing`, { line: section.markerLine, section: section.name });
  }
  const unknown = section.header.map((h, k) => [h, k] as const).filter(([h]) => h !== '' && !(h in spec));
  const idKeys = keys.filter((k) => spec[k]!.type === 'id');
  const seenIds = new Map<string, number>();

  const out: RecordOf<S>[] = [];
  for (const rec of section.records) {
    const row: Record<string, unknown> = {};
    for (const key of keys) {
      const k = colIndex.get(key);
      const text = k === undefined ? '' : (rec.cells[k] ?? '');
      row[key] = readCell(spec[key]!, text, delimiter, (msg) =>
        diag.error(msg, { line: rec.line, section: section.name, column: key }),
      );
    }
    for (const key of idKeys) {
      const id = row[key] as string | undefined;
      if (id === undefined) continue;
      const prev = seenIds.get(id);
      if (prev !== undefined)
        diag.error(`Duplicate ID "${id}" (first used on line ${prev})`, {
          line: rec.line,
          section: section.name,
          column: key,
        });
      else seenIds.set(id, rec.line);
    }
    const extras: Record<string, string> = {};
    for (const [h, k] of unknown) extras[h] = rec.cells[k] ?? '';
    out.push({ ...(row as Row<S>), extras, srcLine: rec.line });
  }
  return out;
}

/** Read a two-column key,value section into a typed object. Unknown keys go to `extras`. */
export function readKeyValue<S extends TableSpec>(
  section: RawSection | undefined,
  spec: S,
  delimiter: Delimiter,
  diag: Diagnostics,
): Row<S> & Extras {
  const values = new Map<string, { text: string; line: number }>();
  if (section) {
    const ki = section.header.indexOf('key');
    const vi = section.header.indexOf('value');
    if (ki < 0 || vi < 0) {
      diag.error('Header must be "key,value"', { line: section.markerLine, section: section.name });
    } else {
      for (const rec of section.records) {
        const key = rec.cells[ki]!.toLowerCase();
        if (key === '') continue;
        if (values.has(key))
          diag.error(`Key "${key}" appears more than once`, { line: rec.line, section: section.name });
        values.set(key, { text: rec.cells[vi]!, line: rec.line });
      }
    }
  }
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(spec)) {
    const v = values.get(key);
    const where = { line: v?.line ?? section?.markerLine, section: section?.name, column: key };
    row[key] = readCell(spec[key]!, v?.text ?? '', delimiter, (msg) => diag.error(msg, where));
    values.delete(key);
  }
  const extras: Record<string, string> = {};
  for (const [k, v] of values) extras[k] = v.text;
  return { ...(row as Row<S>), extras };
}

function writeCell(spec: ColumnSpec, value: unknown): string {
  if (value === undefined || value === null) return '';
  switch (spec.type) {
    case 'number':
      return formatNumber(value as number);
    case 'bool':
      return formatBool(value as boolean);
    case 'idlist':
      return (value as string[]).join(' ');
    default:
      return String(value);
  }
}

/** Build a section for writing. Spec columns come first, then preserved unknown columns. */
export function writeTable<S extends TableSpec>(
  name: string,
  spec: S,
  records: readonly (Row<S> & Partial<Extras>)[],
  comment?: string,
): SectionOut {
  const keys = Object.keys(spec);
  const extraKeys: string[] = [];
  for (const r of records)
    for (const k of Object.keys(r.extras ?? {})) if (!extraKeys.includes(k)) extraKeys.push(k);
  const rows = records.map((r) => [
    ...keys.map((k) => writeCell(spec[k]!, (r as Record<string, unknown>)[k])),
    ...extraKeys.map((k) => r.extras?.[k] ?? ''),
  ]);
  return { name, header: [...keys, ...extraKeys], rows, comment };
}

/** Build a key,value section for writing. Unset optional values are omitted. */
export function writeKeyValue<S extends TableSpec>(
  name: string,
  spec: S,
  values: Row<S> & Partial<Extras>,
  comment?: string,
): SectionOut {
  const rows: string[][] = [];
  for (const k of Object.keys(spec)) {
    const v = (values as Record<string, unknown>)[k];
    if (v === undefined) continue;
    rows.push([k, writeCell(spec[k]!, v)]);
  }
  for (const [k, v] of Object.entries(values.extras ?? {})) rows.push([k, v]);
  return { name, header: ['key', 'value'], rows, comment };
}

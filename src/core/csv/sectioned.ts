// The sectioned CSV container used for project files:
//
//   LinkageDesign,1          signature row: application name, format version
//   # comment                rows whose first (unquoted) cell starts with '#'
//   [points]                 section marker: the only non-empty cell in its row
//   id,x,y                   header row (names are case-insensitive)
//   P1,0,0                   records until the next marker
//
// Every section is an ordinary table, so the file opens directly in Excel.

import { BOM, parseCsv, stringifyCsv, CsvSyntaxError, type Delimiter } from './rfc4180';
import { Diagnostics } from './diagnostics';

export interface RawRecord {
  /** Cell text, trimmed unless it was quoted. Padded to the header width. */
  cells: string[];
  line: number;
}

export interface RawSection {
  name: string;
  header: string[];
  markerLine: number;
  records: RawRecord[];
}

export interface Signature {
  app: string;
  version: string;
  line: number;
}

export interface SectionedDoc {
  signature?: Signature;
  delimiter: Delimiter;
  sections: RawSection[];
}

const SECTION_RE = /^\[([A-Za-z][A-Za-z0-9_-]*)\]$/;

/** Parse sectioned CSV text. Structural problems are reported to `diag`; never throws. */
export function parseSectioned(text: string, diag: Diagnostics): SectionedDoc {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    if (e instanceof CsvSyntaxError) {
      diag.error(e.message, { line: e.line, code: 'csv-syntax' });
      return { delimiter: ',', sections: [] };
    }
    throw e;
  }
  const doc: SectionedDoc = { delimiter: parsed.delimiter, sections: [] };
  const seen = new Set<string>();
  let current: RawSection | undefined;
  let headerPending = false;
  // After a rejected marker, skip that section's rows (the marker was already reported).
  let skipping = false;

  for (const row of parsed.rows) {
    const cells = row.cells.map((c, k) => (row.quoted[k] ? c : c.trim()));
    if (cells.every((c, k) => c === '' && !row.quoted[k])) continue;
    const firstUnquoted = !row.quoted[0];
    if (firstUnquoted && cells[0]!.startsWith('#')) continue;

    const onlyFirst = cells.slice(1).every((c) => c === '');
    if (firstUnquoted && onlyFirst && cells[0]!.startsWith('[')) {
      current = undefined;
      headerPending = false;
      skipping = true;
      const m = SECTION_RE.exec(cells[0]!);
      if (!m) {
        diag.error(`Invalid section marker "${cells[0]}". Use letters, digits, "_" or "-", e.g. [points]`, {
          line: row.line,
        });
        continue;
      }
      const name = m[1]!.toLowerCase();
      if (seen.has(name)) {
        diag.error(`Section [${name}] appears more than once`, { line: row.line, section: name });
        continue;
      }
      seen.add(name);
      current = { name, header: [], markerLine: row.line, records: [] };
      doc.sections.push(current);
      headerPending = true;
      skipping = false;
      continue;
    }

    if (skipping) continue;
    if (!current) {
      if (!doc.signature) doc.signature = { app: cells[0]!, version: cells[1] ?? '', line: row.line };
      else diag.error('Data found before the first [section]', { line: row.line });
      continue;
    }

    if (headerPending) {
      const header = cells.map((c) => c.toLowerCase());
      while (header.length && header[header.length - 1] === '') header.pop();
      const dup = header.find((h, k) => h !== '' && header.indexOf(h) !== k);
      if (dup)
        diag.error(`Column "${dup}" appears more than once in the header`, {
          line: row.line,
          section: current.name,
        });
      current.header = header;
      headerPending = false;
      continue;
    }

    const width = current.header.length;
    const extra = cells.slice(width).filter((c) => c !== '');
    if (extra.length) {
      diag.warn(`Row has ${extra.length} more value(s) than the header has columns; extra values ignored`, {
        line: row.line,
        section: current.name,
      });
    }
    const padded = cells.slice(0, width);
    while (padded.length < width) padded.push('');
    current.records.push({ cells: padded, line: row.line });
  }

  for (const s of doc.sections) {
    if (s.header.length === 0)
      diag.warn('Section has no header row', { line: s.markerLine, section: s.name });
  }
  return doc;
}

export interface SectionOut {
  name: string;
  header: string[];
  rows: string[][];
  comment?: string;
}

/**
 * Write a sectioned document. Output starts with a UTF-8 BOM (so Excel
 * detects the encoding) and uses CRLF line endings.
 */
export function stringifySectioned(
  signature: { app: string; version: number | string; comment?: string },
  sections: SectionOut[],
  delimiter: Delimiter = ',',
): string {
  const line = (cells: string[]) => stringifyCsv([cells], delimiter).slice(0, -2);
  // Comments are written raw, so strip what could break parsing (line breaks, quotes).
  const comment = (text: string) => '# ' + text.replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  const lines = [line([signature.app, String(signature.version)])];
  if (signature.comment) lines.push(comment(signature.comment));
  for (const s of sections) {
    lines.push('');
    if (s.comment) lines.push(comment(s.comment));
    lines.push(`[${s.name}]`);
    lines.push(line(s.header));
    for (const r of s.rows) lines.push(line(r));
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

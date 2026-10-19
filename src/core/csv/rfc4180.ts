// RFC 4180 CSV reader and writer.
//
// The reader is deliberately tolerant: it accepts comma, semicolon or tab
// delimiters, CRLF/LF/CR line endings and an optional UTF-8 BOM. It records
// which cells were quoted so callers can tell `"#note"` (data) from `#note`
// (a comment) and preserve significant whitespace inside quotes.

export type Delimiter = ',' | ';' | '\t';

export interface CsvRow {
  /** Raw cell text (quotes removed, escapes resolved, not trimmed). */
  cells: string[];
  /** Whether each cell was enclosed in quotes. */
  quoted: boolean[];
  /** 1-based line number where the row starts. */
  line: number;
}

export interface CsvParseResult {
  rows: CsvRow[];
  delimiter: Delimiter;
}

export class CsvSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = 'CsvSyntaxError';
  }
}

export const BOM = '﻿';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function delimitersOutsideQuotes(line: string): Map<Delimiter, number> {
  const counts = new Map<Delimiter, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(c as Delimiter))
      counts.set(c as Delimiter, counts.get(c as Delimiter)! + 1);
  }
  return counts;
}

/**
 * Guess the delimiter.
 *
 * If the first non-blank line looks like a signature (`Name<d>version`) the
 * character after the name decides. Otherwise the delimiter present on the
 * most lines wins. Semicolon beats comma when both are common, because
 * semicolon-delimited files from European Excel use decimal commas inside
 * numbers, while commas rarely appear unquoted in comma-delimited files.
 */
export function detectDelimiter(text: string): Delimiter {
  const lines = stripBom(text)
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '');
  const first = lines[0];
  if (first) {
    const sig = /^[A-Za-z][A-Za-z0-9_ ]*?([,;\t])\s*\d+\s*[,;\t]*\s*$/.exec(first);
    if (sig) return sig[1] as Delimiter;
  }
  const sample = lines.slice(0, 50);
  const linesWith = new Map<Delimiter, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  for (const line of sample) {
    for (const [d, n] of delimitersOutsideQuotes(line)) if (n > 0) linesWith.set(d, linesWith.get(d)! + 1);
  }
  const comma = linesWith.get(',')!;
  const semi = linesWith.get(';')!;
  const tab = linesWith.get('\t')!;
  if (tab > comma && tab > semi) return '\t';
  if (semi > 0 && semi >= comma * 0.5) return ';';
  return ',';
}

/** Parse CSV text into rows. Throws CsvSyntaxError on an unterminated quote. */
export function parseCsv(text: string, delimiter?: Delimiter): CsvParseResult {
  text = stripBom(text);
  const d = delimiter ?? detectDelimiter(text);
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let quoted: boolean[] = [];
  let field = '';
  let fieldQuoted = false;
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  const n = text.length;

  const endField = () => {
    cells.push(field);
    quoted.push(fieldQuoted);
    field = '';
    fieldQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push({ cells, quoted, line: rowLine });
    cells = [];
    quoted = [];
  };

  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
        continue;
      }
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field.trim() === '' && !fieldQuoted) {
      // Opening quote; whitespace before it is insignificant.
      field = '';
      fieldQuoted = true;
      inQuotes = true;
      quoteLine = line;
      i++;
    } else if (c === d) {
      endField();
      i++;
    } else if (c === '\r' || c === '\n') {
      endRow();
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
      line++;
      rowLine = line;
    } else {
      if (fieldQuoted && c !== ' ' && c !== '\t') {
        // Text after a closing quote, e.g. "abc"def. Keep it rather than fail.
        field += c;
      } else if (!fieldQuoted) {
        field += c;
      }
      i++;
    }
  }
  if (inQuotes)
    throw new CsvSyntaxError(`Unterminated quoted field starting on line ${quoteLine}`, quoteLine);
  if (field !== '' || fieldQuoted || cells.length > 0) endRow();
  return { rows, delimiter: d };
}

function needsQuotes(s: string, d: Delimiter, firstCell: boolean): boolean {
  if (s === '') return false;
  if (s.includes('"') || s.includes(d) || s.includes('\n') || s.includes('\r')) return true;
  if (s !== s.trim()) return true;
  // Leading '#' or '[' in the first cell would be read back as a comment or section marker.
  if (firstCell && (s.startsWith('#') || s.startsWith('['))) return true;
  return false;
}

export function quoteCell(value: string, d: Delimiter = ',', firstCell = false): string {
  return needsQuotes(value, d, firstCell) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** Serialise rows of strings to CSV text with CRLF line endings. */
export function stringifyCsv(rows: string[][], d: Delimiter = ','): string {
  return rows.map((r) => r.map((v, k) => quoteCell(v, d, k === 0)).join(d)).join('\r\n') + '\r\n';
}

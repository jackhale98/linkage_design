// Conversions between CSV cell text and typed values.

import type { Delimiter } from './rfc4180';

/**
 * Format a number for writing: up to 12 significant digits, which is
 * lossless for engineering purposes and removes float noise such as
 * 49.99999999999997. Negative zero is written as 0.
 */
export function formatNumber(x: number): string {
  if (!Number.isFinite(x)) return '';
  if (x === 0) return '0';
  return String(Number(x.toPrecision(12)));
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DECIMAL_COMMA_RE = /^[+-]?(\d+,\d*|,\d+)([eE][+-]?\d+)?$/;

/**
 * Parse a numeric cell. Accepts plain and exponent notation, and a decimal
 * comma when the file is not comma-delimited. Returns undefined for invalid
 * text so callers can report the cell.
 */
export function parseNumber(text: string, delimiter: Delimiter = ','): number | undefined {
  const t = text.trim();
  if (NUMBER_RE.test(t)) return Number(t);
  if (delimiter !== ',' && DECIMAL_COMMA_RE.test(t)) return Number(t.replace(',', '.'));
  return undefined;
}

const TRUE = new Set(['1', 'true', 'yes', 'y']);
const FALSE = new Set(['0', 'false', 'no', 'n']);

/** Parse a boolean cell. Returns undefined for unrecognised text. */
export function parseBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (TRUE.has(t)) return true;
  if (FALSE.has(t)) return false;
  return undefined;
}

export function formatBool(b: boolean): string {
  return b ? '1' : '0';
}

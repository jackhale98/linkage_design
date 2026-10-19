import { describe, expect, it } from 'vitest';
import { formatNumber, parseBool, parseNumber } from '../../../src/core/csv/values';

describe('formatNumber', () => {
  it('removes float noise and keeps 12 significant digits', () => {
    expect(formatNumber(49.99999999999997)).toBe('50');
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(133.205205436993)).toBe('133.205205437');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1e-9)).toBe('1e-9');
    expect(formatNumber(NaN)).toBe('');
  });

  it('round-trips through parseNumber', () => {
    for (const x of [0, 1, -2.5, 1 / 3, Math.PI * 1000, 6.02e23, -1.5e-7, 123456789.123]) {
      const back = parseNumber(formatNumber(x))!;
      expect(Math.abs(back - x)).toBeLessThanOrEqual(Math.abs(x) * 1e-11);
    }
  });
});

describe('parseNumber', () => {
  it('accepts standard forms', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber(' -1.5 ')).toBe(-1.5);
    expect(parseNumber('+.5')).toBe(0.5);
    expect(parseNumber('5.')).toBe(5);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('2.5E-2')).toBe(0.025);
  });

  it('accepts a decimal comma only in non-comma files', () => {
    expect(parseNumber('1,5', ';')).toBe(1.5);
    expect(parseNumber('-0,25', '\t')).toBe(-0.25);
    expect(parseNumber('1,5', ',')).toBeUndefined();
  });

  it('rejects ambiguous or invalid text', () => {
    for (const t of ['', 'abc', '1.2.3', '1,234.5', '0x10', 'Infinity', 'NaN', '1 000', '--1']) {
      expect(parseNumber(t, ';')).toBeUndefined();
    }
  });
});

describe('parseBool', () => {
  it('accepts common spellings', () => {
    for (const t of ['1', 'true', 'TRUE', 'yes', 'Y']) expect(parseBool(t)).toBe(true);
    for (const t of ['0', 'false', 'No', 'n']) expect(parseBool(t)).toBe(false);
    expect(parseBool('maybe')).toBeUndefined();
  });
});

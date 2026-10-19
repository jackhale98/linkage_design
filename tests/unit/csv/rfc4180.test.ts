import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, stringifyCsv, CsvSyntaxError } from '../../../src/core/csv/rfc4180';

const cells = (text: string) => parseCsv(text).rows.map((r) => r.cells);

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(cells('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles CRLF, LF and CR line endings', () => {
    expect(cells('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(cells('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a missing final newline', () => {
    expect(cells('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(cells('﻿a,b\n')).toEqual([['a', 'b']]);
  });

  it('handles quoted fields with delimiters, quotes and newlines', () => {
    const rows = parseCsv('id,note\nP1,"left, upper"\nP2,"say ""hi"""\nP3,"two\r\nlines"\nP4,x\n').rows;
    expect(rows.map((r) => r.cells)).toEqual([
      ['id', 'note'],
      ['P1', 'left, upper'],
      ['P2', 'say "hi"'],
      ['P3', 'two\r\nlines'],
      ['P4', 'x'],
    ]);
    expect(rows[1]!.quoted).toEqual([false, true]);
  });

  it('tracks source line numbers across embedded newlines', () => {
    const rows = parseCsv('a\n"x\ny"\nb\n').rows;
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });

  it('keeps empty fields', () => {
    expect(cells('a,,c\n,,\n')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ]);
  });

  it('treats a quote inside an unquoted field literally', () => {
    expect(cells('5" bolt,x\n')).toEqual([['5" bolt', 'x']]);
  });

  it('allows whitespace before an opening quote', () => {
    expect(cells('a, "b,c"\n')).toEqual([['a', 'b,c']]);
  });

  it('reports an unterminated quote with its line', () => {
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n')).toThrow(CsvSyntaxError);
    try {
      parseCsv('a,b\n1,"oops\n2,3\n');
    } catch (e) {
      expect((e as CsvSyntaxError).line).toBe(2);
    }
  });

  it('parses semicolon and tab delimited text', () => {
    expect(parseCsv('a;b\n1,5;2\n').rows.map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
    expect(cells('a\tb\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('detectDelimiter', () => {
  it('uses the signature row when present', () => {
    expect(detectDelimiter('LinkageDesign;1\n[points]\nid;x\nP1;1,5\n')).toBe(';');
    expect(detectDelimiter('LinkageDesign,1\n[points]\nid,x\n')).toBe(',');
    expect(detectDelimiter('﻿LinkageDesign\t1\n')).toBe('\t');
  });

  it('prefers semicolon when numbers use decimal commas', () => {
    expect(detectDelimiter('id;x;y\nP1;1,5;2,25\nP2;3;4,75\n')).toBe(';');
  });

  it('keeps comma when semicolons only appear in prose', () => {
    expect(detectDelimiter('id,x,y,note\nP1,1,2,a\nP2,3,4,b\nP3,5,6,c; d\n')).toBe(',');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('a,b\n"x;y;z",1\n')).toBe(',');
  });
});

describe('stringifyCsv', () => {
  it('quotes only when needed', () => {
    expect(stringifyCsv([['a', 'b,c', 'say "hi"', ' pad', 'line\nbreak', '']])).toBe(
      'a,"b,c","say ""hi"""," pad","line\nbreak",\r\n',
    );
  });

  it('quotes a leading # or [ in the first cell so it is not read as a comment or section', () => {
    expect(stringifyCsv([['#3b82f6', '#fff']])).toBe('"#3b82f6",#fff\r\n');
    expect(stringifyCsv([['[x]']])).toBe('"[x]"\r\n');
  });

  it('round-trips arbitrary cell text', () => {
    const rows = [
      ['plain', 'with,comma', 'with "quote"', 'multi\r\nline', '  spaced  '],
      ['#hash', '[bracket]', '', 'ünïcødé ✓', '\t'],
    ];
    const back = parseCsv(stringifyCsv(rows)).rows.map((r) => r.cells);
    expect(back).toEqual(rows);
  });
});

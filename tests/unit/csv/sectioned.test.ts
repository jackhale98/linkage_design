import { describe, expect, it } from 'vitest';
import { Diagnostics, formatDiagnostic } from '../../../src/core/csv/diagnostics';
import { parseSectioned, stringifySectioned } from '../../../src/core/csv/sectioned';
import { readKeyValue, readTable, writeKeyValue, writeTable } from '../../../src/core/csv/table';

const POINTS = {
  id: { type: 'id', required: true },
  x: { type: 'number', required: true },
  y: { type: 'number', required: true },
  fixed: { type: 'bool' },
  label: { type: 'string' },
} as const;

function parse(text: string) {
  const diag = new Diagnostics();
  const doc = parseSectioned(text, diag);
  return { doc, diag };
}

describe('parseSectioned', () => {
  it('splits sections, skips blanks and comments, lower-cases names and headers', () => {
    const { doc, diag } = parse(
      'LinkageDesign,1\n# comment\n\n[Points]\nID,X,Y\nP1,0,0\n\n# between rows\nP2,1,2\n[links]\nid,points\nL1,P1 P2\n',
    );
    expect(diag.items).toEqual([]);
    expect(doc.signature).toMatchObject({ app: 'LinkageDesign', version: '1', line: 1 });
    expect(doc.sections.map((s) => s.name)).toEqual(['points', 'links']);
    expect(doc.sections[0]!.header).toEqual(['id', 'x', 'y']);
    expect(doc.sections[0]!.records.map((r) => [r.cells, r.line])).toEqual([
      [['P1', '0', '0'], 6],
      [['P2', '1', '2'], 9],
    ]);
  });

  it('pads short rows and warns about extra cells', () => {
    const { doc, diag } = parse('[t]\na,b,c\n1\n1,2,3,4\n');
    expect(doc.sections[0]!.records[0]!.cells).toEqual(['1', '', '']);
    expect(diag.warnings).toHaveLength(1);
    expect(diag.warnings[0]!.line).toBe(4);
  });

  it('trims unquoted cells but keeps quoted whitespace', () => {
    const { doc } = parse('[t]\na,b\n  x  ," y "\n');
    expect(doc.sections[0]!.records[0]!.cells).toEqual(['x', ' y ']);
  });

  it('treats quoted "#..." and "[...]" first cells as data', () => {
    const { doc, diag } = parse('[t]\na,b\n"#tag",1\n"[x]",\n');
    expect(diag.items).toEqual([]);
    expect(doc.sections[0]!.records.map((r) => r.cells[0])).toEqual(['#tag', '[x]']);
  });

  it('reports duplicate sections and skips their rows', () => {
    const { doc, diag } = parse('[t]\na\n1\n[t]\na\n2\n');
    expect(diag.errors).toHaveLength(1);
    expect(diag.errors[0]).toMatchObject({ line: 4, section: 't' });
    expect(doc.sections[0]!.records).toHaveLength(1);
  });

  it('reports invalid markers, data outside sections and duplicate columns', () => {
    const { diag } = parse('App,1\nstray,row\n[bad name]\n[t]\na,a\n');
    const msgs = diag.errors.map(formatDiagnostic);
    expect(msgs).toEqual([
      'Line 2: Data found before the first [section]',
      expect.stringContaining('Line 3: Invalid section marker'),
      'Line 5 [t]: Column "a" appears more than once in the header',
    ]);
  });

  it('reports an unterminated quote instead of throwing', () => {
    const { diag } = parse('[t]\na\n"open\n');
    expect(diag.errors[0]!.line).toBe(3);
  });

  it('reads semicolon files with decimal commas (European Excel)', () => {
    const { doc, diag } = parse('LinkageDesign;1\r\n[points]\r\nid;x;y;fixed\r\nP1;1,5;-2,25;yes\r\n');
    const recs = readTable(doc.sections[0]!, POINTS, doc.delimiter, diag);
    expect(diag.items).toEqual([]);
    expect(recs[0]).toMatchObject({ id: 'P1', x: 1.5, y: -2.25, fixed: true });
  });
});

describe('readTable', () => {
  const read = (text: string) => {
    const { doc, diag } = parse(text);
    return { recs: readTable(doc.sections[0]!, POINTS, doc.delimiter, diag), diag };
  };

  it('matches columns by name in any order and applies defaults', () => {
    const { recs, diag } = read('[points]\nY,label,ID,x\n2,"A, top",P1,1\n');
    expect(diag.items).toEqual([]);
    expect(recs[0]).toMatchObject({ id: 'P1', x: 1, y: 2, fixed: false, label: 'A, top', extras: {} });
  });

  it('preserves unknown columns as extras', () => {
    const { recs } = read('[points]\nid,x,y,colour,weight\nP1,0,0,red,3\n');
    expect(recs[0]!.extras).toEqual({ colour: 'red', weight: '3' });
  });

  it('reports bad cells with line and column, and duplicate IDs', () => {
    const { diag } = read('[points]\nid,x,y,fixed\nP1,abc,0,1\n1P,0,,maybe\nP1,0,0,0\n');
    expect(diag.errors.map(formatDiagnostic)).toEqual([
      'Line 3 [points] x: "abc" is not a number',
      'Line 4 [points] id: "1P" is not a valid ID (use letters, digits, "_", "-", "."; start with a letter)',
      'Line 4 [points] y: value is required',
      'Line 4 [points] fixed: "maybe" is not a yes/no value (use 1/0, true/false or yes/no)',
      'Line 5 [points] id: Duplicate ID "P1" (first used on line 3)',
    ]);
  });

  it('reports missing required columns', () => {
    const { diag } = read('[points]\nid,x\nP1,0\n');
    expect(diag.errors.map((d) => d.message)).toContain('Required column "y" is missing');
  });

  it('validates enums case-insensitively and number ranges', () => {
    const spec = {
      law: { type: 'enum', values: ['cycloidal', 'harmonic'], required: true },
      steps: { type: 'number', min: 1, integer: true, default: 360 },
    } as const;
    const { doc, diag } = parse('[t]\nlaw,steps\nCycloidal,\nlinear,0.5\n');
    const recs = readTable(doc.sections[0]!, spec, doc.delimiter, diag);
    expect(recs[0]).toMatchObject({ law: 'cycloidal', steps: 360 });
    expect(diag.errors.map((d) => d.message)).toEqual([
      '"linear" is not one of: cycloidal, harmonic',
      '0.5 must be a whole number',
      '0.5 is below the minimum of 1',
    ]);
  });

  it('parses ID lists separated by spaces, semicolons or pipes', () => {
    const spec = { points: { type: 'idlist' } } as const;
    const { doc, diag } = parse('LinkageDesign,1\n[t]\npoints\nP1 P2;P3|P4\n');
    expect(readTable(doc.sections[0]!, spec, doc.delimiter, diag)[0]!.points).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
    ]);
  });
});

describe('readKeyValue', () => {
  const SPEC = {
    name: { type: 'string', default: 'x' },
    steps: { type: 'number', default: 360 },
  } as const;

  it('reads typed values, defaults missing keys and preserves unknown keys', () => {
    const diag = new Diagnostics();
    const doc = parseSectioned('[s]\nKey,Value\nNAME,Demo\nfuture_key,42\n', diag);
    const v = readKeyValue(doc.sections[0], SPEC, doc.delimiter, diag);
    expect(diag.items).toEqual([]);
    expect(v).toEqual({ name: 'Demo', steps: 360, extras: { future_key: '42' } });
  });

  it('reports a bad header and duplicate keys', () => {
    const diag = new Diagnostics();
    const doc = parseSectioned('[a]\nk,v\n[b]\nkey,value\nname,1\nname,2\n', diag);
    readKeyValue(doc.sections[0], SPEC, doc.delimiter, diag);
    readKeyValue(doc.sections[1], SPEC, doc.delimiter, diag);
    expect(diag.errors.map((d) => d.message)).toEqual([
      'Header must be "key,value"',
      'Key "name" appears more than once',
    ]);
  });
});

describe('writing', () => {
  it('writes BOM, CRLF, comments and sections, and round-trips byte-for-byte', () => {
    const records: {
      id: string;
      x: number;
      y: number;
      fixed: boolean;
      label: string;
      extras: Record<string, string>;
    }[] = [
      { id: 'P1', x: 0, y: 0, fixed: true, label: 'O2', extras: { colour: 'red' } },
      { id: 'P2', x: 133.205205436993, y: 0.1 + 0.2, fixed: false, label: 'A, "upper"', extras: {} },
    ];
    const text = stringifySectioned({ app: 'LinkageDesign', version: 1, comment: 'test file' }, [
      writeKeyValue('project', { name: { type: 'string', default: '' } }, { name: 'Demo', extras: {} }),
      writeTable('points', POINTS, records, 'Sketch points'),
    ]);
    expect(text).toBe(
      '﻿LinkageDesign,1\r\n# test file\r\n\r\n[project]\r\nkey,value\r\nname,Demo\r\n\r\n# Sketch points\r\n[points]\r\n' +
        'id,x,y,fixed,label,colour\r\nP1,0,0,1,O2,red\r\nP2,133.205205437,0.3,0,"A, ""upper""",\r\n',
    );

    const diag = new Diagnostics();
    const doc = parseSectioned(text, diag);
    const back = readTable(doc.sections[1]!, POINTS, doc.delimiter, diag);
    expect(diag.items).toEqual([]);
    const again = stringifySectioned({ app: 'LinkageDesign', version: 1, comment: 'test file' }, [
      writeKeyValue('project', { name: { type: 'string', default: '' } }, { name: 'Demo', extras: {} }),
      writeTable('points', POINTS, back, 'Sketch points'),
    ]);
    expect(again).toBe(text);
  });
});

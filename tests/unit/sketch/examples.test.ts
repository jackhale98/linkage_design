import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { angleScale, parseProject, serializeProject } from '../../../src/core/model/project';
import { analyze } from '../../../src/core/sketch/solver';

const dir = 'src/examples';

describe('example projects', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
    it(`${file} loads cleanly, is fully defined, and round-trips`, () => {
      const text = readFileSync(`${dir}/${file}`, 'utf8');
      const r = parseProject(text);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(r.warnings).toEqual([]);
      const a = analyze(r.project.sketch, { angleScale: angleScale(r.project) });
      expect(a.dof).toBe(0);
      expect(a.redundant.size).toBe(0);
      expect(a.unsatisfied.size).toBe(0);
      expect(serializeProject(r.project)).toBe(text);
    });
  }
});

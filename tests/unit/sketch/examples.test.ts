import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { angleScale, parseProject, serializeProject } from '../../../src/core/model/project';
import { analyze } from '../../../src/core/sketch/solver';
import { computeMotion } from '../../../src/core/mechanism/motion';
import { reachable } from '../../../src/core/mechanism/analysis';
import { solveForces } from '../../../src/core/forces/solve';
import { analyzeCam } from '../../../src/core/cam/analysis';

const dir = 'src/examples';

describe('example projects', () => {
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.csv'))) {
    it(`${file} loads cleanly, is fully defined, round-trips and moves`, () => {
      const text = readFileSync(`${dir}/${file}`, 'utf8');
      const r = parseProject(text);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      expect(r.warnings).toEqual([]);
      expect(serializeProject(r.project)).toBe(text);
      for (const c of r.project.cams) {
        // Every cam's own checks pass.
        const a = analyzeCam(c, { length: r.project.meta.length_unit, force: r.project.meta.force_unit });
        expect(a.issues).toEqual([]);
      }
      if (!r.project.sketch.points.length) {
        // A cam-only example: every check passes.
        const a = analyzeCam(r.project.cams[0]!, {
          length: r.project.meta.length_unit,
          force: r.project.meta.force_unit,
        });
        expect(a.ok).toBe(true);
        expect(a.issues).toEqual([]);
        return;
      }
      const a = analyze(r.project.sketch, { angleScale: angleScale(r.project) });
      expect(a.dof).toBe(0);
      expect(a.redundant.size).toBe(0);
      expect(a.unsatisfied.size).toBe(0);
      expect(serializeProject(r.project)).toBe(text);
      const m = computeMotion(r.project);
      expect(m.issues).toEqual([]);
      expect(m.mobility).toBe(1);
      expect(reachable(m.res!).length).toBeGreaterThan(10);
      const p = r.project;
      const f = solveForces(
        m,
        p.mechanism.bodies,
        p.forces,
        { length: p.meta.length_unit, force: p.meta.force_unit },
        angleScale(p),
      );
      expect(f.issues).toEqual([]);
      expect(f.frames.length).toBe(reachable(m.res!).length);
      expect(Math.max(...f.frames.map((x) => x.balance))).toBeLessThan(1e-8);
    });
  }
});

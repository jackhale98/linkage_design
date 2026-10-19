# Linkage Design

A free, open source, browser-based tool for designing planar mechanisms, linkages and cams:

- **Sketch** mechanisms with geometric constraints and dimensions
- **Animate** them and analyse position, velocity, acceleration, transmission angle and limit positions
- **Apply forces and torques** to get joint reaction forces and the required input torque or force (static and kinetostatic)
- **Design cams**: motion programs, SVAJ, pressure angle, radius of curvature, undercut and follower-jump checks, profile export
- **Save everything as one CSV file**, and export results as flat CSVs for Excel or pandas

It runs entirely in the browser as a static site on GitHub Pages. Nothing is uploaded anywhere.

## Status

Phases 0–2 are complete:

- **Sketching:** points and lines with snapping; dimensions edited on the canvas (expressions allowed).
- **Constraints:** geometric constraints, plus live constraint status while you drag.
- **Mechanisms:** links (merge lines into rigid plates), automatic ground and joints (pins, pin-in-slot, slider blocks), and rotary or linear (actuator) drivers.
- **Motion:**
  - animation with playback controls and traced paths (coupler curves);
  - plots of position, velocity, acceleration, link angles and transmission angles;
  - range-of-motion and toggle limits, and Grashof classification;
  - kinematics CSV export.
- **Examples:** four-bar, slider-crank, quick-return and hydraulic boom.
- **Files:** one CSV project file with undo/redo and autosave.

Forces (joint reactions and input torque) come next, then cams. See the [design document](docs/DESIGN.md) for the architecture, solver math and roadmap, and the [file format reference](docs/FILE_FORMAT.md) for the CSV layout.

## Development

Requires Node 22+.

```sh
npm install
npm run dev          # dev server at http://localhost:5173/linkage_design/
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright; run `npx playwright install chromium` once)
npm run lint         # ESLint
npm run check        # type check (svelte-check)
npm run format       # Prettier
npm run build        # production build to dist/
npm run size         # check the bundle against the size budget
```

Code layout:

- `src/core/`: framework-free TypeScript (CSV format, model, and later the solvers). No DOM access, so it is unit-tested in Node.
- `src/ui/`: Svelte 5 components and UI state.
- `tests/unit/`, `tests/e2e/`: Vitest and Playwright tests.

## Deployment

Pushing to `main` builds and deploys the site with GitHub Actions (`.github/workflows/pages.yml`). One-time setup: in the repository settings, set **Pages → Source** to **GitHub Actions**. The site is then served at <https://jackhale98.github.io/linkage_design/>.

## License

[MIT](LICENSE)

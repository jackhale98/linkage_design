# Linkage Design

A free, open source, browser-based tool for designing planar mechanisms, linkages and cams:

- **Sketch** mechanisms with geometric constraints and dimensions
- **Animate** them and analyse position, velocity, acceleration, transmission angle and limit positions
- **Apply forces and torques** to get joint reaction forces and the required input torque or force (static and kinetostatic)
- **Design cams**: motion programs, SVAJ, pressure angle, radius of curvature, undercut and follower-jump checks, profile export
- **Save everything as one CSV file**, and export results as flat CSVs for Excel or pandas

It runs entirely in the browser as a static site on GitHub Pages. Nothing is uploaded anywhere.

## Status

Phases 0 and 1 are complete:

- **Sketching:** points and lines with snapping and horizontal/vertical inference; dimensions (length, distance, angle) edited right on the canvas, with expressions like `=2*25+10`.
- **Constraints:** horizontal, vertical, parallel, perpendicular, coincident, point on line, midpoint, equal length.
- **Constraint status:** live solving while you drag. Colours show under-, fully and over-defined geometry, and conflicts are explained.
- **Editing:** editable tables, undo/redo and autosave.
- **Files:** project CSV save/open.

Mechanisms, motion and forces come next. See the [design document](docs/DESIGN.md) for the architecture, solver math and roadmap, and the [file format reference](docs/FILE_FORMAT.md) for the CSV layout.

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

# Linkage Design — Design Document

Status: **approved** · Phase 0 complete · Last updated: 2026-10-19

A free, open source, browser-based tool for designing planar mechanisms,
linkages and cams. It runs as a static site on GitHub Pages (this
repository). Engineers sketch a mechanism with geometric constraints and
dimensions, animate it, apply forces and torques to get joint reactions and
the required input effort, design cams, and save everything as a CSV file.

---

## 1. Goals and non-goals

### Goals

- **Functional and robust.** Results match textbook and closed-form answers,
  and the app says clearly when a mechanism locks, binds, is over-constrained
  or is statically indeterminate.
- **Attractive and modern.** A clean, calm interface in light and dark themes
  that feels like current CAD tools, not 1990s freeware.
- **Easy to use.** Someone who knows mechanisms but has never seen the app
  can sketch and animate a four-bar in under two minutes. Templates and
  on-canvas editing beat dialogs.
- **Fast.** Instant load, live solving while dragging, sweeps and force
  analysis in milliseconds.
- **Portable data.** One human-readable CSV file holds the whole project, and
  results export as flat CSVs that open cleanly in Excel or pandas.
- **No server.** Everything runs in the browser and nothing is uploaded.

### Primary users

Practicing machine designers first, students second. Conventions follow
common textbooks (Norton, *Design of Machinery*; Shigley/Uicker, *Theory of
Machines and Mechanisms*) so results are easy to cross-check.

### Non-goals (for now)

- 3D or spatial mechanisms.
- Forward dynamics (given a torque, integrate the motion over time).
- Joint friction. It makes the force problem nonlinear; this is a later
  phase.
- Full CAD (fillets, extrudes, assemblies).
- Phone-sized editing. Phones get view and animate only; tablets and up get
  full editing.

---

## 2. Landscape (why build this)

| Tool | Kinematics | Forces | Cams | Free | Open source | Web |
|---|---|---|---|---|---|---|
| Linkage (Rector) | ✔ | – | – | ✔ | – | – (Windows) |
| MotionGen | ✔ (strong synthesis) | – | – | ✔ | – | ✔ |
| PMKS+ | ✔ | partial | – | ✔ | ? | ✔ |
| Pyslvs | ✔ (synthesis) | – | – | ✔ | ✔ | – |
| SolveSpace | ✔ (via sketch drag) | – | – | ✔ | ✔ | partial |
| Working Model 2D, SAM | ✔ | ✔ | limited | – | – | – |
| DYNACAM, CAD add-ins | – | limited | ✔ | – | – | – |

Kinematics alone is reasonably well served. The gap is a free, open, web-based
tool that combines **constrained sketching, kinematics, joint reactions and
cam design** with plain, portable files.

---

## 3. Technical stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Typed geometry and solver code catches unit and shape bugs early |
| Build | Vite | Fast dev server, small production bundles, static output |
| UI framework | Svelte 5 | Tiny runtime, fine-grained reactivity, fast without tuning. *Alternatives: Preact or Solid; open to change.* |
| Drawing canvas | SVG | Crisp at any zoom, easy hit-testing and selection, direct SVG export |
| Plots | uPlot | ~45 KB, renders thousands of points per series at 60 fps |
| Unit tests | Vitest | Solver, CSV and cam math run headless |
| End-to-end tests | Playwright | Smoke tests of real user flows in Chromium |
| Lint/format | ESLint + Prettier | |
| CI/CD | GitHub Actions | Test on every PR; build and deploy to Pages on `main` |
| License | MIT | |

The solver, CSV and cam code (`src/core/`) is **framework-free TypeScript**
with no DOM access. It runs in Node for tests, and can move to a Web Worker
without changes if profiling shows the need.

### Hosting

The site deploys to `https://jackhale98.github.io/linkage_design/` from a
GitHub Actions workflow (Vite `base: '/linkage_design/'`). This needs one
manual step in the repo: **Settings → Pages → Source: GitHub Actions**.

---

## 4. Concepts and workflow

The app has five workspaces, shown as tabs in the top bar. They share one
project.

```
Sketch ──► Mechanism ──► Motion ──► Forces          Cam (independent workspace)
```

1. **Sketch.** Draw points and lines, then add geometric constraints
   (coincident, horizontal, parallel…) and dimensions (lengths, angles).
   Geometry is colour-coded by state: under-constrained (blue), fully
   constrained (black/white), over-constrained (red). Under-constrained
   geometry can be dragged.
2. **Mechanism.** Group sketch entities into rigid **bodies** (links), mark
   the **ground** body, and confirm **joints**. Points shared by two bodies
   become revolute joints automatically; the type can be changed to slider or
   pin-in-slot. Choose a **driver**, which is the one sketch dimension that
   will vary (a crank angle or an actuator length).
3. **Motion.** Sweep the driver through a range and animate it. Shows coupler
   curves, velocity and acceleration vectors, transmission angles, Grashof
   type, limit/toggle positions, and plots of any quantity.
4. **Forces.** Assign mass properties and add loads (forces, torques,
   gravity, springs). Get the reaction force at every joint and the required
   driver torque or force, at every position in the sweep. Choose static or
   kinetostatic (includes inertia at the set speed).
5. **Cam.** Define a motion program and a follower, then get the cam profile,
   SVAJ curves, pressure angle, radius of curvature, undercut checks,
   follower spring and jump checks, and profile exports.

### Mapping a sketch to a mechanism

- At the moment you enter Motion, each body's sketch geometry is frozen into
  body-local coordinates. Dimensions inside one body become rigid geometry.
- The driver dimension becomes the time-varying driver constraint.
- Any other dimension that spans two different moving bodies would fight the
  motion. The app lists these and treats them as *reference* (design pose
  only) rather than silently over-constraining the mechanism.
- Going back to Sketch restores the design pose, so editing is always done in
  one well-defined configuration.

---

## 5. Solver design

There is one numerical core with two formulations.

### 5.1 Common core

- Constraints are written as residual equations Φ(q, t) = 0, each with an
  analytic Jacobian (no finite differences).
- Nonlinear solve: Newton–Raphson with Levenberg–Marquardt damping. This is
  robust far from the solution and quadratic near it.
- Linear algebra: dense LU/QR for the small systems here (tens to a few
  hundred unknowns). QR with column pivoting gives the numerical rank, used
  for DOF counting and redundancy detection.
- Residuals are scaled to units of length so conditioning doesn't depend on
  the size of the model.

### 5.2 Sketch solver (point coordinates)

- Unknowns: x, y of each sketch point. Lines reference two points. Arcs and
  circles (centre point plus radius) come in a later phase.
- Constraints for v1: coincident, distance, horizontal/vertical distance,
  angle, horizontal, vertical, parallel, perpendicular, point-on-line,
  midpoint, equal length, fixed.
- **Dragging:** the cursor is a soft, low-weight constraint on the dragged
  point. Weighted least squares moves the geometry as little as possible
  while satisfying all hard constraints, which is what makes dragging feel
  natural.
- **DOF and state:** the rank of the Jacobian gives the remaining degrees of
  freedom. Each entity's state comes from whether its coordinates lie in the
  Jacobian's null space.
- **Over-constraint diagnosis:** if residuals don't converge or the rank is
  deficient, the app identifies a minimal conflicting or redundant set by
  testing constraint removal (cheap at this size) and highlights it.

### 5.3 Mechanism solver (body coordinates)

Each moving body i has generalized coordinates **qᵢ = (xᵢ, yᵢ, φᵢ)**. The
ground body is fixed. A point P fixed on body i with local position **s′ᵢᴾ**
is at

  **rᴾ = rᵢ + A(φᵢ) s′ᵢᴾ**, where A is the 2×2 rotation matrix.

This formulation follows Haug (*Computer-Aided Kinematics and Dynamics of
Mechanical Systems*) and Nikravesh. It was chosen over point coordinates
because **joint reaction forces fall directly out of it** (§6).

| Joint / driver | Equations | Removes |
|---|---|---|
| Revolute at P (bodies i, j) | rᵢ + Aᵢs′ᵢᴾ − rⱼ − Aⱼs′ⱼᴾ = 0 | 2 DOF |
| Slider / prismatic (i, j along axis) | φᵢ − φⱼ − c = 0; point of j on axis line of i | 2 DOF |
| Pin-in-slot (pin on j, slot on i) | pin point of j on slot line of i | 1 DOF |
| Rotary driver | φᵢ − φⱼ − θ(t) = 0 | 1 DOF |
| Linear driver (actuator P–Q) | ‖rᴾ − rQ‖ − L(t) = 0 | 1 DOF |

For each driver input in the sweep:

- **Position:** Φ(q, t) = 0, solved by LM from the previous solution, with a
  linear predictor q ≈ q_prev + q̇·Δt.
- **Velocity:** Φ_q q̇ = −Φ_t
- **Acceleration:** Φ_q q̈ = γ, where γ = −(Φ_q q̇)_q q̇ − 2Φ_qt q̇ − Φ_tt

**Robustness rules**

- **Branch tracking.** Sweeps start from the drawn pose and step continuously.
  If a step jumps further than a threshold, it is treated as a branch flip at
  a toggle and stops the sweep. The app never jumps silently between
  assemblies.
- **Limits.** When assembly fails, the sweep records the limit or toggle
  position. The animation then ping-pongs between limits, and the UI reports
  the reachable input range.
- **Near-singular poses.** A large Jacobian condition number is shown as a
  "near toggle" warning, because velocities and forces blow up there.
- **Mobility.** Shown from the Jacobian rank, not the Gruebler count, so
  redundant constraints (for example a parallelogram with an extra link) are
  handled correctly. A mechanism must have exactly 1 DOF before the driver is
  applied (multi-driver systems are a later phase).

---

## 6. Force analysis

### 6.1 Formulation

With the motion known from §5.3, the equations of motion in Lagrange
multiplier form are

  **M q̈ + Φ_qᵀ λ = Qᴬ**  ⇒  **Φ_qᵀ λ = Qᴬ − M q̈**

- **M** is the block-diagonal mass matrix: mᵢ, mᵢ, Iᵢ (about the centre of
  mass).
- **Qᴬ** is the generalized applied forces: point forces, torques, gravity
  and springs.
- **λ** is the Lagrange multipliers, one per constraint equation.

Because the driver constraint is included, Φ_q is square (n×n) for a
correctly driven 1-DOF mechanism, so λ is found by **one linear solve per
position**. That is cheap enough to run live.

**Outputs**

- **Joint reactions.** The force on body i at joint k is **Fᵢᵏ = −Φᵏ_rᵢᵀ λᵏ**.
  For a revolute joint, λᵏ is the reaction force vector itself. For a slider,
  the reactions are a normal force plus a moment (a measure of tilt/binding).
  Reactions are reported as global x/y components and magnitude, and in each
  link's local frame (useful for sizing pins and bearings).
- **Driver effort.** The driver's multiplier is the **required input torque**
  (rotary) or **actuator force** (linear).
- **Input power** and a **virtual-work cross-check**: input power must equal
  Σ F·v + Σ T·ω of the applied and inertia loads. This is shown as a
  self-check, and is also a unit test on every example.

### 6.2 Modes

- **Static (quasi-static):** M q̈ is omitted. Use it for clamps, lifts and
  slow mechanisms. Gravity is optional.
- **Kinetostatic:** includes inertia at the set driver speed (constant speed
  for v1).

### 6.3 Loads (v1)

| Load | Parameters |
|---|---|
| Point force | body, point, Fx/Fy *or* magnitude/angle, global or body-fixed direction |
| Torque | body, value |
| Gravity | gx, gy (default 0, −9.81 m/s²), on or off |
| Linear spring | two points (bodies), k, free length, preload |
| Torsional spring | revolute joint, k, free angle, preload |
| Mass properties | per body: mass, centre of mass (local), moment of inertia about it |

Mass properties can be typed in, or estimated from a simple bar or plate
outline with material density and thickness (a later phase).

### 6.4 Failure modes reported

- **Statically indeterminate** (rank-deficient Φ_q, for example redundant
  joints): the reactions are not unique. The app shows the minimum-norm
  solution with an explicit warning and names the redundant constraints.
- **Toggle/singular pose:** forces grow without bound. Flagged rather than
  plotted as huge spikes.

---

## 7. Cam module

### 7.1 Motion program

A table of segments that together cover 360°:

| Type | Parameters |
|---|---|
| Rise / Return | duration (deg), lift (mm, or deg for oscillating followers), motion law |
| Dwell | duration (deg) |

**Motion laws:** constant velocity, simple harmonic, cycloidal, modified
trapezoidal, modified sine, 3-4-5 polynomial, 4-5-6-7 polynomial. Later:
user-defined polynomials with boundary conditions, and custom s(θ) imported
from CSV.

**Fundamental-law check:** at each segment boundary, displacement, velocity
and acceleration must be continuous (finite jerk). Violations are listed with
the angle and the size of the jump, for example "constant-velocity rise
causes infinite acceleration at 90°".

### 7.2 Followers (v1)

- Translating roller, including knife-edge (roller radius 0), with offset.
- Translating flat-faced.
- Oscillating roller (pivot distance, arm length).
- Oscillating flat-faced.

Cam rotation can be CW or CCW, with a base circle radius and speed in rpm.

### 7.3 Outputs

- **SVAJ:** displacement, velocity, acceleration and jerk against cam angle,
  and in time units at the set rpm.
- **Pressure angle** over the cycle, with its maximum against a user limit
  (default 30° for translating followers).
- **Radius of curvature** of the pitch curve and of the cam surface, with the
  minimum value and **undercut detection** (ρ_pitch < roller radius, or a
  negative radius for flat-faced followers). Also the minimum flat-face width
  needed.
- **Follower force:** spring rate and preload, follower mass and external
  load give the contact force over the cycle, with **jump/float detection**
  (contact force ≤ 0) and **cam shaft torque**.
- **Profile export:** cam surface and pitch curve as an (x, y) CSV (for CAD
  "curve through points" import), DXF polyline, and SVG.
- An animated view of the cam rotating with the follower.

The math is computed generically from follower position and direction of
motion, rather than from separate per-follower textbook formulas. This keeps
all four follower types on one tested code path, which is then validated
against those formulas.

Integrating cams into linkages (a cam-follower joint) is a later phase.

---

## 8. Data and file format

### 8.1 Internal model

```
Project
├─ meta        name, units, notes, created/modified, format version
├─ sketch      points, lines, (arcs), constraints, dimensions
├─ mechanism   bodies, joints, driver, sweep settings
├─ forces      mass properties, loads, analysis mode, gravity
├─ cam         settings, follower, segments, spring/load
└─ view        zoom, pan, panel layout (optional)
```

- Every object has a stable, human-readable string ID (P1, L3, J2…).
  References are always by ID.
- The model is plain data, serialisable to and from CSV with no loss.

### 8.2 Project file: sectioned CSV

A project is **one `.csv` file** made of named sections. Each section is an
ordinary table with its own header row. Excel, Google Sheets and text editors
open it as-is.

```csv
LinkageDesign,1
# Four-bar crank-rocker example

[project]
key,value
name,Crank-rocker demo
length_unit,mm
force_unit,N
angle_unit,deg

[points]
id,x,y,fixed,label
P1,0,0,1,O2
P2,40,30,0,A
P3,133.205205437,88.4190866023,0,B
P4,150,0,1,O4

[lines]
id,p1,p2,construction
L1,P1,P2,0
L2,P2,P3,0
L3,P3,P4,0
L4,P1,P4,1

[constraints]
id,type,a,b,c,value,reference
C1,distance,P1,P2,,50,0
C2,distance,P2,P3,,110,0
C3,distance,P3,P4,,90,0
C4,distance,P1,P4,,150,0
C5,horizontal,L4,,,,0
C6,angle,L4,L1,,36.87,0

[bodies]
id,name,entities,ground,mass,com_x,com_y,inertia,color
B0,Ground,L4,1,,,,,
B1,Crank,L1,0,0.2,25,0,40,#3b82f6
B2,Coupler,L2,0,0.5,55,0,600,#10b981
B3,Rocker,L3,0,0.3,45,0,220,#f59e0b

[joints]
id,type,body_a,body_b,point,axis
J1,revolute,B0,B1,P1,
J2,revolute,B1,B2,P2,
J3,revolute,B2,B3,P3,
J4,revolute,B3,B0,P4,

[driver]
key,value
constraint,C6
start,0
end,360
steps,360
speed,60
speed_unit,rpm

[loads]
id,type,body,point,point2,fx,fy,magnitude,angle,frame,k,free_length,preload
F1,force,B3,P3,,0,-100,,,global,,,
G1,gravity,,,,0,-9.81,,,,,,
```

**Robustness rules**

- **Standard:** RFC 4180 (quoted fields, escaped quotes, embedded commas and
  newlines), UTF-8 written with a BOM so Excel detects the encoding, and CRLF
  line endings.
- **Tolerant reading:**
  - Comma, semicolon or tab delimiters are auto-detected.
  - Decimal commas are accepted in semicolon-delimited files (as written by
    European Excel).
  - A BOM is optional.
  - Header names are case-insensitive and columns can be in any order.
  - Blank rows and `#` comment rows are ignored.
  - Booleans accept 1/0, true/false and yes/no.
- **Validation:** every reference is checked (a joint pointing at a missing
  body, a constraint at a missing point). Types and ranges are checked too.
  Errors are reported with **file line numbers** and plain-language fixes.
- **Atomic import:** an import either fully succeeds or changes nothing. A
  bad file never half-loads over your work. Warnings (for example unknown
  columns) are shown without blocking.
- **Forward compatibility:** unknown sections and columns are preserved and
  written back out on save, so newer files survive a round trip through an
  older version.
- **Versioning:** the signature row carries the format version, and older
  versions are migrated on load.
- **Numbers** are written with up to 12 significant digits, which is
  lossless for engineering purposes and free of float noise like
  `49.99999999997`.
- **Round-trip guarantee:** export → import → export produces identical
  bytes. This is enforced by tests over every example project.

### 8.3 Results exports (flat CSV, one header row)

| File | Contents |
|---|---|
| `*_kinematics.csv` | input, time, and per point x/y/vx/vy/ax/ay; per body angle/ω/α; joint angles |
| `*_forces.csv` | input, time, and per joint Fx/Fy/|F| (global and local); driver torque/force; input power |
| `*_cam_svaj.csv` | cam angle, time, s, v, a, j, pressure angle, ρ, contact force |
| `*_cam_profile.csv` | x, y of the cam surface (and pitch curve), ready for CAD import |

Column headers include units, for example `P3_vx [mm/s]`.

### 8.4 Other persistence

- **Autosave** to browser localStorage in the project CSV format. The last session is
  restored automatically on load, with a one-click "Start new" in the notification.
- **Undo/redo** of all edits (snapshot based; projects are small).
- **Later:** a shareable link with the project compressed into the URL hash.

---

## 9. User experience

### 9.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◆ Linkage Design  [Sketch|Mechanism|Motion|Forces|Cam]  ↶ ↷  ⬇ ⬆  ☾ │  top bar
├────┬───────────────────────────────────────────────────┬─────────────┤
│ ▢  │                                                   │ Inspector   │
│ ╱  │                                                   │ (selection  │
│ ⌀  │              SVG canvas                           │  properties,│
│ ↔  │   (pan: drag empty / middle mouse, zoom: wheel)   │  editable)  │
│ ⊥  │                                                   │             │
│ …  │                                                   │             │
├────┴───────────────────────────────────────────────────┴─────────────┤
│ ▶ ━━━━━━━━━●━━━━━━━  128°   │ Plots │ Tables │ Results │ Messages(2) │  bottom dock
└──────────────────────────────────────────────────────────────────────┘
```

- **Left:** a tool rail that changes per workspace.
- **Right:** a context-sensitive inspector.
- **Bottom:** a resizable dock with plots, editable tables, results and
  messages.
- **Messages:** warnings such as "over-constrained", "toggle at 212°" or
  "pressure angle 34° > 30°" are clickable and select the offending item.

### 9.2 Interaction principles

- **Direct manipulation first.** Draw on canvas. Double-click a dimension to
  type a value, with simple expressions (`=2*25+10`). Drag geometry to
  explore.
- **Smart drawing.** Snapping to points, midpoints, grid and
  horizontal/vertical, with automatic constraint inference while drawing
  (shown as small glyphs, and removable).
- **Immediate feedback.** Constraint state colours, a live DOF count, and
  re-solving on every edit.
- **Templates gallery** for a fast start: four-bar, slider-crank, inverted
  slider-crank / quick-return, toggle clamp, Watt and Stephenson six-bars,
  Jansen leg, hydraulic boom (linear actuator), and a standard
  dwell-rise-dwell cam.
- **Keyboard:**
  - Tools: `P` point, `L` line, `D` dimension, `C` constraint, `B` body,
    `J` joint.
  - Editing: `Space` play/pause, `F` fit view, `Del` delete, `Esc` cancel,
    `Ctrl+Z`/`Ctrl+Shift+Z` undo/redo, `Ctrl+S` export.
  - `Ctrl+K` opens a command palette.
- **Empty states and inline help** explain the next step ("Add a driver to
  animate: select a dimension and press *Make driver*").
- **Units everywhere:** every number field shows its unit, and the unit
  system is switchable (SI mm-N, SI m-N, inch-lbf).

### 9.3 Visual design

- **Design tokens** (CSS custom properties) for colour, spacing, radius and
  type. Light and dark themes follow the system setting, with a manual
  toggle.
- **Restrained palette:** neutral surfaces, one accent colour for selection,
  and a fixed semantic set:
  - constraint state: blue, ink and red;
  - force vectors: applied loads in orange, reactions in purple;
  - body colours from a categorical palette that works in both themes.
- **Typography:** the system UI font stack (no web-font download), with
  tabular numerals in tables and readouts.
- **Canvas styling:** subtle adaptive grid, and crisp 1.5 px strokes at any
  zoom. Ground is drawn with hatching. Joints have clear pin and slider
  glyphs. Force arrows are scaled with a legend.
- **Motion:** short, purposeful transitions (≤150 ms). Animation playback is
  smooth at 60 fps.
- **Accessibility:** WCAG AA contrast, full keyboard access to panels and
  tables, and visible focus states.

### 9.4 Performance budgets

| Metric | Budget |
|---|---|
| Initial download (JS+CSS, gzipped) | ≤ 250 KB |
| Time to interactive (mid-range laptop) | ≤ 1 s |
| Drag re-solve (≤ 50 bodies / 200 constraints) | ≤ 8 ms per frame (60 fps) |
| 360-step sweep incl. forces (four-bar to six-bar) | ≤ 30 ms |
| Cam analysis at 0.25° resolution | ≤ 20 ms |

Budgets are checked in CI with a small benchmark suite. If a sweep exceeds
16 ms on typical models, it moves into a Web Worker. The core is already
DOM-free for this reason.

---

## 10. Repository layout

```
/
├─ index.html
├─ src/
│  ├─ core/                 framework-free, unit-tested
│  │  ├─ csv/               RFC 4180 reader/writer, sectioned format
│  │  ├─ model/             project types, validation, (de)serialisation, migrations
│  │  ├─ math/              linear algebra, LM solver
│  │  ├─ sketch/            sketch constraints and solver
│  │  ├─ mechanism/         body-coordinate kinematics, sweeps
│  │  ├─ forces/            loads, mass properties, kinetostatics
│  │  ├─ cam/               motion laws, followers, profile, forces
│  │  └─ export/            results CSV, DXF, SVG
│  ├─ ui/                   Svelte components (canvas, panels, plots, dialogs)
│  ├─ styles/               design tokens, themes
│  └─ examples/             template projects (as CSV)
├─ tests/
│  ├─ unit/                 Vitest
│  ├─ reference/            textbook and closed-form verification cases
│  └─ e2e/                  Playwright
├─ docs/                    this document, file-format reference, user guide
└─ .github/workflows/       ci.yml (test), pages.yml (build + deploy)
```

---

## 11. Verification strategy

**Correctness is the product,** so testing is part of every phase.

- **Closed form.** Check four-bar position, velocity and acceleration
  against the Freudenstein/vector-loop solutions. Slider-crank against its
  exact equations.
- **Textbook cases.** Worked kinematic, kinetostatic and cam examples from
  standard texts, encoded as reference tests with their published answers.
- **Invariants:**
  - Virtual work balance on every force solution.
  - Finite-difference checks of every analytic Jacobian, velocity and
    acceleration.
  - Each cam motion law meets its boundary conditions.
  - The cam profile reproduces s(θ) when the follower is re-solved against
    it.
- **CSV:**
  - Byte-identical round trip of all examples.
  - A fuzz/edge-case corpus: quotes, embedded newlines, semicolons, decimal
    commas, BOM/no-BOM, CRLF/LF, reordered columns, missing optional
    columns.
  - Malformed files produce line-numbered errors and never partial loads.
- **End-to-end.** Load each template, animate, export, re-import, and
  compare.

---

## 12. Phased delivery

Each phase ends with a deployed, usable site.

| Phase | Scope | Done when |
|---|---|---|
| **0. Foundation** | Vite + TS + Svelte scaffold, design tokens and themes, app shell, CI, Pages deploy, sectioned CSV library + tests | Site is live at the Pages URL; CSV test corpus passes |
| **1. Sketcher** | Points, lines, constraints, dimensions, drag, DOF/state colouring, over-constraint diagnosis, undo/redo, autosave, project CSV import/export | A four-bar can be drawn and fully dimensioned; save → load is byte-identical |
| **2. Motion** | Bodies, ground, revolute/slider/pin-in-slot joints, rotary/linear drivers, sweep, animation, traces, plots, transmission angle, Grashof, limits, kinematics CSV, templates | Matches closed-form and textbook kinematics to ≤ 0.01 % |
| **3. Forces** | Mass properties, point forces, torques, gravity, springs; static and kinetostatic; joint reactions, driver effort, force arrows, indeterminacy warnings, forces CSV | Matches textbook kinetostatic examples; virtual-work residual ≤ 1e-9 relative |
| **4. Cams** | Motion program, all v1 followers, SVAJ, pressure angle, curvature/undercut, follower force/jump, profile CSV/DXF/SVG, cam animation | Matches textbook cam examples; all motion-law tests pass |
| **5. Extensions** | Linkage synthesis (2- and 3-position, function generation), arcs/tangency, cam-follower joints in linkages, share links, mass properties from outlines, joint friction, multi-driver | Prioritised after phase 4 based on feedback |

---

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Sketcher UX is hard to get right | Keep v1 to points and lines; borrow proven interaction patterns (SolidWorks/Onshape/SolveSpace); test with real users after phase 1 |
| Solver jumps branches or fails near toggles | Predictor-corrector stepping, jump detection, explicit limit reporting, adaptive step refinement near singularities |
| Redundant constraints make forces non-unique | Rank detection, minimum-norm solution, clear warning naming the redundant joints |
| Scope creep | Strict phase gates; extensions only after phase 4 |
| Bundle and performance creep | CI budget checks; DOM-free core ready to move to a Worker |

---

## 14. Open questions

1. **Product name.** "Linkage Design" is a placeholder. The repo name can
   stay; the site title and logo need a name.
2. **Example library.** Which mechanisms do your engineers use most? Those
   should be the first templates.
3. **Reference cases.** Are there in-house or textbook problems you trust
   that should become reference tests?

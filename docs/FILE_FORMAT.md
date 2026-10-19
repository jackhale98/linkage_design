# Project file format

A Linkage Design project is a single `.csv` file. It opens directly in Excel, Google Sheets or a text editor. This page describes the format as of **format version 1**: the sketch and the mechanism. Force and cam sections will be added in later versions; older files will keep loading.

## Layout

The file is a sequence of named **sections**. Each section is an ordinary table: a marker row, a header row, then one row per record.

```csv
LinkageDesign,1
# Lines starting with # are comments

[project]
key,value
name,Four-bar with coupler point

[points]
id,x,y,fixed,label
P1,0,0,1,O2
P2,150,0,0,O4
```

- **First row:** the signature `LinkageDesign,<format version>`.
- **Section marker:** a row whose only cell is `[name]`.
- **Header row:** column names. They are case-insensitive and may appear in any order.
- **Blank rows** and **comment rows** (first cell starts with `#`) are ignored.

## Reading rules

- Standard CSV (RFC 4180). Quote a cell to include commas, quotes (`""`) or line breaks.
- Comma, semicolon and tab delimiters are detected automatically.
- In semicolon- or tab-delimited files, numbers may use a decimal comma (`1,5`), as written by European Excel.
- The file may be UTF-8 with or without a byte-order mark.
- Yes/no cells accept `1`/`0`, `true`/`false`, `yes`/`no`, `y`/`n`. A blank cell means no.
- Missing optional columns take their defaults.
- Unknown columns and unknown sections are kept and written back when you save.
- A file with any error is not opened at all. The error list gives the line number and column of each problem.

## Writing rules

- Written as UTF-8 with a byte-order mark, so Excel detects the encoding.
- Comma-delimited with CRLF line endings.
- Numbers have up to 12 significant digits.
- Opening a saved file and saving it again produces an identical file.

## Sections

### `[project]` (key, value)

| Key | Values | Default |
|---|---|---|
| `name` | text | Untitled mechanism |
| `length_unit` | `mm`, `m`, `in` | `mm` |
| `force_unit` | `N`, `lbf` | `N` |
| `angle_unit` | `deg`, `rad` | `deg` |
| `notes` | text | |
| `created`, `modified` | ISO 8601 timestamps | |

**All lengths and angles in the file use these units.** Changing units in the app converts the stored values.

### `[points]`

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | Unique ID: a letter or `_`, then letters, digits, `_`, `-`, `.` |
| `x`, `y` | yes | Coordinates |
| `fixed` | | Anchored in place (ground) |
| `label` | | Free text, e.g. `O2` |

### `[lines]`

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | Unique ID (not shared with any point or constraint) |
| `p1`, `p2` | yes | IDs of the two end points (must be different) |
| `construction` | | Helper geometry that isn't part of a link's outline |

### `[constraints]`

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | Unique ID |
| `type` | yes | See the table below |
| `a`, `b`, `c` | `a` | IDs of the referenced points/lines, in the order the type expects |
| `value` | dimensions | Length or angle, in project units |
| `reference` | | Reference (driven) dimension: measured, not enforced |
| `label_dx`, `label_dy` | | Position of the dimension label relative to its anchor |

| `type` | References | Value | Meaning |
|---|---|---|---|
| `coincident` | point, point | | Same location |
| `distance` | point, point | length | Distance between points |
| `distance` | line | length | Length of the line |
| `distance` | point, line | length | Perpendicular distance from the point to the line |
| `hdistance` | point, point | length | Horizontal distance |
| `vdistance` | point, point | length | Vertical distance |
| `angle` | line | angle | Angle of the line from the +x axis, counterclockwise |
| `angle` | line, line | angle | Angle from line `a` to line `b`, counterclockwise (signed) |
| `horizontal` | line, or point + point | | Horizontal |
| `vertical` | line, or point + point | | Vertical |
| `parallel` | line, line | | Parallel |
| `perpendicular` | line, line | | Perpendicular |
| `point_on_line` | point, line | | The point lies on the (extended) line |
| `midpoint` | point, line | | The point is the line's midpoint |
| `equal` | line, line | | Equal lengths |

Line directions run from `p1` to `p2`. This matters for signed angles.

Validation checks that:

- every referenced ID exists and is the right kind;
- lengths are greater than zero;
- driving dimensions have a value.

Relations that don't take a value ignore one if present, with a warning.

When a file is opened, geometry is shown exactly as stored. If the stored positions don't satisfy the constraints, or constraints conflict or duplicate each other, the sketch is marked **over-defined** and the offending constraints are listed in **Messages**.

### `[bodies]`

Rigid bodies (links). Each is a group of sketch lines that move together.

| Column | Required | Meaning |
|---|---|---|
| `id` | yes | Unique ID, e.g. `B1` |
| `name` | | Display name, e.g. `Crank` |
| `lines` | | Space-separated line IDs |
| `ground` | | Fixed to the frame |
| `color` | | Hex colour, e.g. `#2a78d6` |
| `mass` | | Mass in kg (N projects) or lb (lbf projects). Blank = massless. |
| `com_x`, `com_y` | | Centre of mass in sketch coordinates at the drawn pose (blank = the middle of the link's lines) |
| `inertia` | | Moment of inertia about the centre of mass, in mass·length² (e.g. kg·mm²) |

When a project is opened or edited, the bodies are synced with the sketch:

- **Unassigned lines:** every non-construction line not in a body becomes its own link.
- **Stale references:** missing lines are dropped, and so are bodies left empty.
- **Ground** is:
  - every fixed point;
  - every construction line connected, through other construction lines, to a fixed point (a drawn "ground line" between pivots);
  - every body marked `ground`, and every body touching two or more ground points.

### `[joints]`

Joints are **derived from the sketch**, and this section records them so they keep stable IDs:

- a **revolute** wherever two bodies, or a body and ground, share a point;
- a **pin-in-slot** wherever a `point_on_line` constraint ties a point of one body to a line of another;
- a **revolute** instead of a pin-in-slot when the sketch also fixes where that point sits along the line: a `distance` from it to a point of the line's link, or a `midpoint` constraint. The point can't slide, so it is a pivot partway along the link.

| Column | Meaning |
|---|---|
| `id` | Stable ID, e.g. `J3` |
| `type` | `revolute`, `pin_in_slot`, or `slider` (a pin-in-slot whose block can't rotate). Only the pin-in-slot / slider choice is editable. |
| `point` | The pin point |
| `line` | The slot line (slots only) |
| `body_a`, `body_b` | Joined bodies (`ground` for the frame); for slots, `body_a` carries the line |

### `[driver]` (key, value)

| Key | Meaning |
|---|---|
| `type` | `none`, `rotary` or `linear` |
| `line` | Rotary: the line whose angle is the input |
| `line_ref` | Rotary: measure the angle from this line (blank = from the +x axis) |
| `point_a`, `point_b` | Linear: the actuator's end points. A line between them is the actuator and belongs to no body. |
| `start`, `end` | Sweep range in project units (blank = a full turn, or ±20% of the actuator length) |
| `steps` | Number of steps (default 360) |
| `speed` | rpm (rotary) or length units per second (linear) |
| `return` | `1`: a limited sweep runs there and back (a full cycle). On the way back the positions repeat in reverse, velocities reverse, and time continues. |

### `[motion]` (key, value)

| Key | Meaning |
|---|---|
| `trace` | Space-separated IDs of points whose paths are drawn |

### `[loads]`

Applied loads for the force analysis.

| Column | Used by | Meaning |
|---|---|---|
| `id` | all | Unique ID, e.g. `F1` |
| `type` | all | `force`, `torque`, `spring` or `torsion` |
| `body` | force, torque | The link the load acts on |
| `point` | force, spring | Where a force acts; a spring's first end |
| `point_b` | spring | The spring's second end |
| `joint` | torsion | The pin a torsion spring acts across |
| `fx`, `fy` | force | Components in the project force unit |
| `frame` | force | `global` (fixed directions) or `body` (turns with the link) |
| `torque` | torque | Counterclockwise positive, in force·length |
| `k` | spring, torsion | Stiffness: force per length, or torque per angle unit |
| `free` | spring, torsion | Free length or free angle. Blank = free at the drawn pose. |
| `preload` | spring, torsion | Tension or torque at the free length or angle |
| `opposes` | force, torque | `1`: the load resists the motion, like friction or a pump. A force acts along its line against the point's motion, and a torque against the link's rotation, so both flip with the direction of travel. |

### `[analysis]` (key, value)

| Key | Meaning |
|---|---|
| `mode` | `static` (applied loads only) or `kinetostatic` (adds each link's inertia at the driver speed) |
| `gravity` | `1` to add each link's weight, acting in −y |
| `solve_for` | `input` (default): the loads are known; find the input torque or actuator force needed. `output`: the input is known; find what the output joint delivers. |
| `input` | The known input torque (rotary driver, CCW +) or actuator force (+ pushes apart), when `solve_for` is `output` |
| `output_joint` | The output, when `solve_for` is `output`: a pivot to ground (output torque on the link turning about it) or a pin or block in a ground slot (output force along the slot) |
| `input_point`, `output_point` | Optional points on the driven and output links. The input and output torques are also reported as forces there, at right angles to the line from the pivot. |

### `[cam]` (key, value)

Cam settings. Left out of the file while the cam is untouched. Lengths and forces use the project units; cam angles are always in degrees.

| Key | Meaning |
|---|---|
| `base_radius` | Base circle radius: the smallest radius of the cam surface |
| `rotation` | `ccw` or `cw` |
| `speed` | rpm |
| `follower` | `translating_roller`, `translating_flat`, `oscillating_roller` or `oscillating_flat` |
| `roller_radius` | Roller radius (`0` = knife edge) |
| `offset` | Translating followers: offset of the follower axis from the cam centre (the follower moves along +y) |
| `pivot_distance` | Oscillating followers: cam centre to arm pivot (the pivot is on the +x axis) |
| `arm_length` | Oscillating roller: pivot to roller centre |
| `pressure_limit` | Limit for the pressure-angle check, degrees (default 30) |
| `mass` | Translating: follower mass. Oscillating: arm moment of inertia about the pivot. |
| `spring_rate` | Return spring: force per length, or torque per radian (oscillating) |
| `preload` | Spring force (or torque) at zero lift |
| `load` | Constant load pressing the follower onto the cam: force, or torque (oscillating) |
| `step` | Analysis step, degrees (default 0.5) |

### `[cam_segments]`

The motion program, in order from 0°. Durations must add up to 360°, and rises and returns must balance.

| Column | Meaning |
|---|---|
| `id` | Unique ID, e.g. `S1` |
| `type` | `rise`, `return` or `dwell` |
| `duration` | Cam angle the segment spans, degrees |
| `lift` | Rise or return: length (translating) or degrees (oscillating) |
| `law` | `constant_velocity`, `simple_harmonic`, `cycloidal`, `modified_trapezoidal`, `modified_sine`, `poly_345` or `poly_4567` |

## Results exports

Analysis results export as separate, flat CSV files with one header row and units in the column names. They are meant for Excel, pandas or MATLAB, not for re-opening in the app.

**Kinematics** (Motion → Results → Kinematics CSV): one row per sweep step.

| Column group | Contents |
|---|---|
| Driver | `input [deg]` (or the length unit), `time [s]` |
| Each moving point | x, y, speed, vx, vy, acceleration, ax, ay |
| Each link | angle, angular velocity, angular acceleration |
| Each pin between two links | Joint angle (the transmission angle where it applies) |

Points and joints are named by their sketch label where they have one, otherwise by ID. Example column names: `A_x [mm]`, `P5_speed [mm/s]`, `Rocker_angular_velocity [deg/s]`. Rates assume the driver turns (or extends) at the set constant speed.

**Cam SVAJ** (Cam → Results → SVAJ CSV): one row per analysis step.

| Column | Contents |
|---|---|
| `cam_angle [deg]`, `time [s]` | Position in the revolution |
| `s`, `v`, `a`, `j` | Follower displacement, velocity, acceleration and jerk against time (length or degrees) |
| `pressure_angle [deg]` | Signed angle between the contact normal and the follower's direction of motion |
| `rho_pitch`, `rho_surface` | Radius of curvature of the pitch curve (rollers) and of the cam surface: + convex, − concave |
| `contact_force`, `cam_torque` | Force at the contact, and the shaft torque it takes |

**Cam profile** (Profile CSV, DXF, SVG): the cam surface in the cam's own frame at 0°, centred on the cam axis. The CSV also has the pitch curve for rollers. The DXF is one closed R12 polyline; the SVG is at true size.

**Forces** (Forces → Results → Forces CSV): one row per sweep step.

| Column group | Contents |
|---|---|
| Driver | `input`, `time [s]`, input torque (or actuator force) and input power; the input as a force at `input_point` if set |
| Output | When solving for the output: output torque (or force), mechanical advantage, and the output as a force at `output_point` if set |
| Each joint | Force magnitude, Fx, Fy on the joint's second link (`body_b`), and the moment for slider blocks |
| Each spring | Tension, or torque for torsion springs |

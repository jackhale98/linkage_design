# Project file format

A Linkage Design project is a single `.csv` file. It opens directly in Excel, Google Sheets or a text editor. This page describes the format as of **format version 1** (the sketch). Mechanism, force and cam sections will be added in later versions; older files will keep loading.

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

## Results exports

Analysis results (from later phases) export as separate, flat CSV files with one header row and units in the column names, e.g. `P3_vx [mm/s]`. They are meant for Excel, pandas or MATLAB, not for re-opening in the app.

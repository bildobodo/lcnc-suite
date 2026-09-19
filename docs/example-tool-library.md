# Bundled example tool library

**Tools → Examples** opens a review of 36 tools: 21 Fusion 360 examples and
15 FreeCAD examples. The library ships with the WebUI and works offline, with
no CAD application installed. It covers common cutters, special profiles,
all 14 supported FreeCAD standard shapes, and a custom native mesh with a bore.

## Use in the WebUI

1. Open **Tools → Examples**. Loading and reviewing the library changes nothing.
2. Review the tool list and import mode. An existing table defaults to **Update
   existing tool metadata**. This updates matching tool numbers only, preserves
   measured offsets, pockets and table diameters, and skips identity conflicts.
   It does not add the examples to an existing table.
3. For a demonstration setup, select **Replace entire tool table** and confirm
   **Replace table**. This replaces the current table with the 36 examples.
   Every example starts with **Z offset = 0**, including the Fusion tools.
4. Open a tool's edit dialog or hover its table row to inspect its geometry.
   The machine viewer uses the same geometry when that tool is loaded.

Download and preview failures remain visible even if the tool table refreshes.
Use the close button to dismiss the message, or **Examples** to try again.
Retrying opens the review; it does not apply or replace the table.

These are geometry examples, not a catalog of tools installed on your machine.
They contain **no holders or cutting presets**. Physical length and contour come
from the source library; the installed length must be measured separately before
use. Changing a measured offset never stretches the tool model. Replacing the
table resets offsets; a metadata update preserves them.

Tool numbers are deliberately separated into T1001–T1021 (Fusion) and T2001–T2015
(FreeCAD). Those ranges are not reserved by LinuxCNC; check for existing tools.
The examples have their own stable source IDs and descriptions prefixed with
`Example / Fusion /` or `Example / FreeCAD /`.

## Contents

| Fusion tool | Geometry example |
| --- | --- |
| T1001 | Flat end mill, 12 mm |
| T1002 | Ball end mill, 8 mm |
| T1003 | Bullnose, 10 mm, R1 |
| T1004 | Micro drill, 0.35 mm |
| T1005 | Spot drill |
| T1006 | Center drill |
| T1007 | Countersink, 90° |
| T1008 | Chamfer mill with a small tip |
| T1009 | Corner chamfer end mill |
| T1010 | Dovetail with a rounded edge |
| T1011 | Face mill, 45°, R2 |
| T1012 | Lollipop, 12 mm |
| T1013 | Slot mill with a full-round edge |
| T1014 | Corner rounding mill |
| T1015 | Tapered ballnose, R2 |
| T1016 | Tapered bullnose |
| T1017 | Thread mill with three flat crests |
| T1018 | Thread mill with three round crests |
| T1019 | Right-hand tap |
| T1020 | Form mill with a multi-lobe profile |
| T1021 | Block drill |

| FreeCAD tool | Geometry example |
| --- | --- |
| T2001 | Flat end mill, 5 mm |
| T2002 | Ball end mill, 5 mm |
| T2003 | Bullnose, 5 mm, R1.5 |
| T2004 | Drill, 3 mm |
| T2005 | Reamer, 5 mm |
| T2006 | Tap, 8 mm |
| T2007 | Chamfer mill |
| T2008 | V-bit, 90° |
| T2009 | Dovetail, 20 mm |
| T2010 | Radius mill |
| T2011 | Slitting saw, 100 mm |
| T2012 | Ball probe, 6 mm |
| T2013 | Tapered ballnose |
| T2014 | Single-tooth thread mill |
| T2015 | Custom asymmetric body with an axial bore |

The Fusion entries retain the parameterized geometry from the native regression
references, including the original form-tool contour. The FreeCAD standard
shapes retain the original bit parameters; the custom body retains its native
triangle mesh. Standard FreeCAD bodies are shown without inventing cutting-face
colors. See the [FreeCAD guide](freecad-tool-import.md) for origin differences,
standard-template assumptions and native mesh limits.

## Packaging and maintenance

The asset is `lcnc-webui/public/examples/tools/fusion-freecad.json` (about 51 kB).
Vite copies it to `dist/examples/tools/fusion-freecad.json`; deploy the complete
`dist` directory. The UI fetches it only when **Examples** is clicked, then sends
it through the same preview/apply endpoints as a regular file import. It is not
part of the initial JavaScript bundle. The JSON can also be selected through
**Tools → Import**.

Regenerate the committed asset from the repository root:

```sh
python3 scripts/build_example_tool_library.py
```

The generator copies geometry from `test-fixtures/fusion-tool-*.json` and
`test-fixtures/freecad/`. It changes only example descriptions, numbers and IDs,
and omits holders, vendor data and machining presets. Each entry records its
source reference. No CAD process, network or machine connection is required.
FreeCAD reference-data attribution is recorded in [NOTICE](../NOTICE).

The portable envelope is `format: "lcnc-tool-library"`, `version: 1`, with a
`tools` array. Each entry has a `source` (`fusion360` or `freecad`) and `data`:

- Fusion data is one original Fusion tool object, including `post-process.number`.
- FreeCAD data has `nr`, `id`, `bit` and optionally native `geometry`, as in the
  existing FreeCAD export bundle.

`is_example: true` marks the whole library and causes every new table Z offset
to start at zero. Source definitions go through the existing source adapters
and are converted to the machine's mm/inch units. Cross-source number collisions
are reported by the common duplicate handling. The format accepts at most 2000
tools and does not execute CAD models or resolve external paths.

Regression checks cover reproducible generation, decoding, persistence,
mm/inch rendering of all 36 examples, identical table/viewer geometry despite
different measured offsets, read-only preview, offset-preserving updates, and
the built UI's review and explicit replacement flow.

# Bundled example tool library

The suite includes 36 tools: 21 Fusion 360 examples and 15 FreeCAD examples,
covering common cutters, special profiles, all supported standard FreeCAD
shapes, and a custom mesh. No CAD application or network connection is needed.

## Import from server or client

1. Open **Tools**. The file controls follow the Program panel.
2. **Browse** expands the server file list; **Hide Files** collapses it.
   **Upload** opens the client file picker directly, without opening a server
   browser first. Browse into folders or use **..** to go up.
   Program and Tools use the same file list and navigation. Browse reserves
   the remaining Tools panel for files, even when only one library is present.
   The table and its search return when Browse is closed. The current folder is listed again whenever Browse is reopened; the tool table
   updates automatically when the gateway reports a change.
3. Select a library to review its tools. Selection alone changes nothing.
4. Existing tables default to **Update existing tool metadata**. This preserves
   measured offsets, pockets and table diameters, updates matching tools only,
   and skips identity conflicts. It does not add tools.
5. **Replace entire tool table** explicitly replaces all current rows, including
   demo tools such as T1. The review shows the nominal Z lengths of the examples.
   Confirm **Replace table** only when that replacement is intended.

The server folder comes from `[DISPLAY] TOOL_LIBRARY_DIR` in the active INI.
Relative paths are relative to the INI directory; `~` and absolute paths work.
Without a setting, it uses the Program browser folder (`PROGRAM_PREFIX`),
normally `~/linuxcnc/nc_files`. Both browsers can share this folder: Tools lists
library files and Program lists G-code files. The browser shows the full server
path. An explicit `TOOL_LIBRARY_DIR` can still select a separate folder. Browsing and downloading
require the same token as importing and cannot leave the configured folder,
including through symlinks. **Upload** remains available if the
server folder is missing or inaccessible. Supported formats are Fusion / LCNC
JSON and FreeCAD JSON, ZIP, FCTB and FCTL; the import limit is 16 MB.

Download errors stay in the inline file browser for retry or another selection. Preview
errors remain visible through table refreshes and can be dismissed or retried.
Every retry returns to review before any table replacement.

## Initial installation and Z offsets

`install.sh` installs the library in
`~/linuxcnc/nc_files/fusion-freecad.json` and configures the three supplied
machines to browse the same folder for programs and tool libraries. A fresh simulator table
already contains all 36 examples and their geometry, alongside the original demo
tools. The 5-axis demo keeps T1 Z100 D12; the 6-axis TWP demo keeps T1 Z200 D14.
Existing tables, user-edited libraries and custom folder settings are preserved
on upgrade. The earlier configuration-local `tool-libraries` default migrates
to the program folder; an existing library is copied only if the destination
does not already exist. Upgrading does not silently add tools or reset measured lengths.

Each example has an explicit **nominal exposed length** in `example_z_mm`:
the distance from the modeled spindle face to the tool tip. These bare-tool
examples have no holder geometry, so no extra holder projection is added. The
Z offset is shorter than the physical tool's overall length, leaving its upper
shaft inside the spindle and its working profile exposed.

For example, the 76 mm T1001 uses Z50 mm (26 mm inserted), the 8.58 mm micro
drill T1004 uses Z6 mm (2.58 mm inserted), and the 50 mm probe T2012 uses
Z40 mm (10 mm inserted). These are nominal simulation placements. The tables
below show both overall length and Z so the insertion depth is explicit.
The decoder converts nominal lengths from mm to the machine's mm/inch units.
A replacement applies them; a metadata update retains measured Z values exactly.

If these examples were previously imported with Z=0, restarting or reinstalling
does not change those existing rows. A metadata update also retains zero. To
reset the entire table to nominal example lengths, browse or upload the library,
select **Replace entire tool table**, and confirm. This replaces other rows
and manually entered offsets as well; use individual tool edits when those
values need to be retained.

The examples contain **no holder meshes or cutting presets**. Nominal lengths are
simulation defaults; measure the installed tools before machining. Changing a
measured offset never stretches their physical geometry.

Numbers are T1001–T1021 (Fusion) and T2001–T2015 (FreeCAD). These ranges are not
reserved by LinuxCNC. The examples have stable source IDs and descriptions
prefixed with `Example / Fusion /` or `Example / FreeCAD /`.

## Contents

| Fusion tool | Geometry example | Overall length (mm) | Nominal Z (mm) | Inserted (mm) |
| --- | --- | ---: | ---: | ---: |
| T1001 | Flat end mill, 12 mm | 76 | 50 | 26 |
| T1002 | Ball end mill, 8 mm | 63 | 40 | 23 |
| T1003 | Bullnose, 10 mm, R1 | 70 | 45 | 25 |
| T1004 | Micro drill, 0.35 mm | 8.58 | 6 | 2.58 |
| T1005 | Spot drill | 89 | 60 | 29 |
| T1006 | Center drill | 60 | 35 | 25 |
| T1007 | Countersink, 90° | 70 | 45 | 25 |
| T1008 | Chamfer mill with a small tip | 100 | 65 | 35 |
| T1009 | Corner chamfer end mill | 80 | 50 | 30 |
| T1010 | Dovetail with a rounded edge | 75 | 45 | 30 |
| T1011 | Face mill, 45°, R2 | 80 | 55 | 25 |
| T1012 | Lollipop, 12 mm | 150 | 120 | 30 |
| T1013 | Slot mill with a full-round edge | 50 | 30 | 20 |
| T1014 | Corner rounding mill | 100 | 65 | 35 |
| T1015 | Tapered ballnose, R2 | 70 | 45 | 25 |
| T1016 | Tapered bullnose | 70 | 50 | 20 |
| T1017 | Thread mill with three flat crests | 77 | 50 | 27 |
| T1018 | Thread mill with three round crests | 77 | 50 | 27 |
| T1019 | Right-hand tap | 80 | 50 | 30 |
| T1020 | Form mill with a multi-lobe profile | 179.598 | 145 | 34.598 |
| T1021 | Block drill | 80 | 50 | 30 |

| FreeCAD tool | Geometry example | Overall length (mm) | Nominal Z (mm) | Inserted (mm) |
| --- | --- | ---: | ---: | ---: |
| T2001 | Flat end mill, 5 mm | 50 | 40 | 10 |
| T2002 | Ball end mill, 5 mm | 50 | 45 | 5 |
| T2003 | Bullnose, 5 mm, R1.5 | 50 | 45 | 5 |
| T2004 | Drill, 3 mm | 50 | 35 | 15 |
| T2005 | Reamer, 5 mm | 50 | 40 | 10 |
| T2006 | Tap, 8 mm | 60 | 40 | 20 |
| T2007 | Chamfer mill | 30 | 20 | 10 |
| T2008 | V-bit, 90° | 20 | 12 | 8 |
| T2009 | Dovetail, 20 mm | 55 | 35 | 20 |
| T2010 | Radius mill | 60 | 40 | 20 |
| T2011 | Slitting saw, 100 mm | 53 | 38 | 15 |
| T2012 | Ball probe, 6 mm | 50 | 40 | 10 |
| T2013 | Tapered ballnose | 63.5 | 40 | 23.5 |
| T2014 | Single-tooth thread mill | 50 | 35 | 15 |
| T2015 | Custom asymmetric body with an axial bore | 30 | 25 | 5 |

The Fusion entries retain the parameterized geometry from the native regression
references, including the original form-tool contour. The FreeCAD standard
shapes retain the original bit parameters; the custom body retains its native
triangle mesh. Standard FreeCAD bodies are shown without inventing cutting-face
colors. See the [FreeCAD guide](freecad-tool-import.md) for origin differences,
standard-template assumptions and native mesh limits.

## Packaging and maintenance

The library lives in `examples/sim_config/tool-libraries/fusion-freecad.json`.
It is installed as a regular file and opened through **Browse** or **Upload**;
there is no Examples menu or special WebUI asset download.

Regenerate the library, fresh simulator tables and geometry seeds:

```sh
python3 scripts/build_example_tool_library.py
```

The generator copies tested geometry from `test-fixtures/fusion-tool-*.json` and
`test-fixtures/freecad/`, assigns descriptions, numbers and stable IDs, and omits
holders, vendor data and machining presets. Source references remain in the
library. FreeCAD attribution is recorded in [NOTICE](../NOTICE).

`tool.seed.json` next to each fresh `tool.tbl` provides initial geometry. The
installer copies it only when creating a table from the supplied defaults. The
gateway uses this seed only if no saved metadata exists for the active INI; an
explicitly saved empty library also takes precedence. Normal edits persist in
`lcnc-gateway/tool_library.json` as before. A metadata seed never writes offsets.

The portable envelope is `format: "lcnc-tool-library"`, `version: 2`, with a
`tools` array. Each entry has `source` (`fusion360` or `freecad`) and `data`:

- Fusion data is an original Fusion tool object with `post-process.number`.
- FreeCAD data contains `nr`, `id`, `bit` and optionally native `geometry`.

`is_example: true` enables an optional `example_z_mm` on each entry: a finite,
positive nominal installation length, always expressed in mm. The shipped library
sets it for all 36 tools. Version 2 prevents older gateways from silently
ignoring the explicit lengths; restart the suite after updating its backend.
The updated decoder continues to accept version 1 files. Earlier files without this field retain the previous
body-length fallback. Ordinary Fusion and FreeCAD imports retain their existing length
policies. All definitions pass through the source adapters and machine-unit
conversion. The format accepts at most 2000 tools, reports number collisions,
and never executes CAD models or resolves external paths.

Tests cover reproducible generation, fresh installs and upgrades, persistence,
mm/inch geometry and offsets, spindle contact and exposed cutting profiles, server path confinement and authentication,
read-only preview, measured-offset preservation, server/client file selection,
error recovery and browser layout.

# Compact 500 — conventional XYZAC trunnion mill

An original, compact machine example for LCNC Suite: a deep cast-style bed,
wide rear column, horizontal X saddle, vertical Z spindle head and Y table.
The table carries a **connected U-shaped A yoke supported by bearings on both
sides**, with a C rotary platter inside it. The frame is left exposed so the
joints, guide blocks and kinematic hierarchy are easy to inspect.

This is independently drawn example geometry under GPL-2.0-or-later, not a
replica of a particular manufacturer's machine or a production-ready design.
No third-party CAD meshes are redistributed.

| Item | Model specification |
| --- | --- |
| X / Y / Z travel | 500 / 400 / 400 mm |
| X / Y joint limits | −250…250 / −200…200 mm |
| Z joint limits | 100…500 mm; spindle-nose height above the A/C intersection |
| A tilt | −110…110°, about X, supported at both ends |
| C rotation | Continuous mechanics; configured ±100 turns |
| Platter | Ø400 mm; top surface at the A/C intersection in the neutral pose |
| Guide system | Size 45; two rails and four long flanged blocks on each linear axis |
| Rail / block dimensions | 45 × 38 mm rail; 120 × 171.2 mm block; 60 mm assembly height |
| Frame envelope | About 1540 × 1710 × 2035 mm including feet |
| Supplied tool | T1, Ø12 mm, 100 mm gauge length |
| Example blank | 130 × 130 × 60 mm on the platter |

## Start the example

Requires an installed LCNC Suite and LinuxCNC with `xyzac-trt-kins` (the
source-pinned kinematic oracle is LinuxCNC 2.9.4). This simulation uses the
suite's existing watchdog, tool-change and compensation HAL wiring. There are
no hardware drivers and no second Vismach window. It listens on localhost.

From the repository root, materialize the model and run the config:

```sh
git lfs pull --include="examples/sim_config/machine-xyzac-compact/*.stl"
cd examples/sim_config
linuxcnc lcnc_suite_sim_5axis_compact.ini
```

For a separate writable configuration, copy the **whole** `sim_config`
directory into a new `~/linuxcnc/configs/lcnc_suite_compact5` directory. Retain
all siblings: `hallib`, `remap_subs`, `compact5`, and `machine-xyzac-compact`.
Make `hallib/lcnc_webui.hal` a symlink back to the installed repository, as
described in the [shared setup guide](../README.md), so safety-chain updates
continue to arrive. Run the INI with that config directory as the working
directory; model, tool-table, program and variable-file paths are relative.

`install.sh` includes this example on a **fresh** simulation install. It
preserves existing configuration directories on upgrades; use the separate
copy above to add this example to an existing installation.

Connect and arm the UI, reset E-stop, switch on and **home all axes**. Homing
is instantaneous and switchless: Z establishes its retracted 500 mm position
first, then X/Y and A/C. Before homing, feedback is not a valid machine pose.
The supplied program is loaded but is not started automatically. Start it and
confirm the T1 manual tool change when prompted.

`demo.ngc` is an **air-motion demonstration**. It shows linear travel and the
full A range with the spindle retracted, then holds a point 260 mm above the
platter while A/C rotate in TCP mode. It resets this example's G54 to the
A/C intersection. Its own `sim.var` and `tool.tbl` keep this state separate
from the other examples. A sample blank is shown; clamps, enclosure, way
covers, tool changer and chip conveyor are omitted from this teaching model.
The example does not configure probing routines or M600/M601.

## Kinematic contract

Joints are ordered **X, Y, Z, A, C**:

- X moves the head saddle in +X; Z moves the spindle in +Z.
- Y moves the complete table assembly in −Y.
- A rotates the yoke about +X. C rotates the platter about its local +Z.
- `tool` is the spindle-nose frame; `c_platter` is the work/backplot frame.
- At X=Y=A=C=0, the A/C intersection is at model origin. The platter top is
  Z=0 and the spindle nose is at the commanded Z joint position.

The A and C axes intersect, so all `xyzac-trt-kins.*-rot-point`, `y-offset`
and `z-offset` geometry pins are zero. Tool compensation is still required:
`motion.tooloffset.z` is connected to `xyzac-trt-kins.tool-offset`.

`xyzac-trt-kins sparm=identityfirst` starts in identity mode. **M429** selects
identity; **M428** selects world/TCP kinematics using the shared remaps.
The existing suite kinematics pipeline handles offline paths and collisions;
this example adds no alternative runtime solver.

The guide blocks remain fully on their rails at every linear limit. Rails,
block patterns and spindle/table zero positions are symmetric. Full tilting
is demonstrated with Z retracted. The legal joint limits are **not** a
promise that every arbitrary combination of low Z, X/Y, tilt, fixture and
tool is collision-free; check the program with the suite's collision tools.

## Regenerate / inspect

The source is [`scripts/freecad_compact5.py`](../../../scripts/freecad_compact5.py).
It generates 39 named, closed STL parts, `machine.json` and `dimensions.json`.
Each STL is local to its group. Run with FreeCAD's Python runtime:

```sh
COMPACT5_CAD_DIR=/tmp/compact5 freecadcmd scripts/freecad_compact5.py
COMPACT5_CAD_DIR=/tmp/compact5 freecadcmd scripts/freecad_check_compact5.py
python3 scripts/test_compact5.py
```

Use an absolute path to `freecadcmd` if it is not on PATH. The optional output
directory receives an editable **FCStd assembly**, a **STEP assembly** and
`preview-data.json`. The FCStd `Motion` spreadsheet animates the five joints;
structural dimensions are changed in the generator and then regenerated.
The STEP export contains the named solids in the visible CAD pose.

The off-machine acceptance script checks INI/model agreement, exported mesh
integrity, symmetric guide coverage, 8000 model-frame comparisons against the
compiled LinuxCNC C oracle, inverse roundtrips, and 3723 sampled TCP demo poses
against the joint limits. It requires Python 3 and a C compiler, not FreeCAD.
The optional exact-solid FreeCAD checker tests 72 discrete retracted
rotary/travel and lower working poses (not continuous swept volumes).
The initial acceptance run found no interpenetration across 3447 candidate
solid-pair checks. A live LinuxCNC startup must
still be checked on a Linux host; it cannot be executed on macOS.

## Design references

Only proportions and published dimensional envelopes were used:

- [Haas UMC-500](https://www.haascnc.com/machines/vertical-mills/universal-machine/models/umc-500.html):
  market scale for a compact machine and Ø400 mm platter; our frame and axis
  arrangement are independently designed.
- [HCNC HMU800](https://www.hcnc-group.com/news/meet-the-hmu-800-one-of-the-world-s-most-adva-64681549.html)
  and [Hicent cradle example](https://www.hicentcncmachinetool.com/Milling-Crossbeam-Type-Cradle-5-Axis-Machining-Center-p.html):
  visual references for a two-sided cradle and substantial bearing housings.
- [HIWIN HGW45HC](https://www.hiwin.de/en/Products/Linear-guideways/Blocks/Ball-guides/Series-HG-QH/HGW-QHW/HGW45HCZBH/p/5-001275)
  and [linear-guideway catalog](https://www.hiwin.com/wp-content/uploads/HIWIN-Linear-Guideway-Catalog.pdf):
  simplified rail/block outer dimensions, not manufacturer raceway geometry.
- [LinuxCNC 5-axis kinematics](https://www.linuxcnc.org/docs/html/motion/5-axis-kinematics.html):
  table/table kinematic convention; the repository's vendored 2.9.4 C source
  is the numerical oracle.

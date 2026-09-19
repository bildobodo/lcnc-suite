# TWP 45 wall-gantry example

The supported **6 Axis TWP XYZABC** example: two continuous walls support a
travelling crossbeam, with an offset 45° universal head and an A-axis faceplate.
It replaces the old 55° example for installation and live acceptance tests.

![Wall gantry and offset universal head](overview.png)

[Top view of the four X blocks and their saddle plate](x-guides.png)

## Run on the LinuxCNC host

Use a checkout containing this example, with lcnc-suite installed from that
checkout as described in the [main README](../../../README.md). From its root:

```sh
git lfs pull
sudo halcompile --install examples/sim_config/twp/xyzacb_trsrn.comp
cd examples/sim_config
linuxcnc lcnc_suite_sim_6axis_twp_xyzabc.ini
```

Compile the runtime component once, and again when that `.comp` changes.
The separate `scripts/kins_oracle/` copy is for tests, not installation.
The new example defaults to `WEBUI_HOST = 127.0.0.1`; remote access uses the
same token settings as the other sims.

Launch from the complete checkout as above. The model path is relative to
the INI directory, which is also the LinuxCNC display/gateway working
directory. The remap and suite subroutine paths likewise follow this layout.
If launching the gateway manually from elsewhere, set
`LCNC_WEBUI_MACHINE_DIR` to this model directory's absolute path.
`install.sh` also deploys this profile on upgrades, resolves suite paths and
backs up the previous installation. See [installation and state migration](../README.md).

Arm, reset E-stop, enable and home all axes in the usual way. Startup is empty
and parked at all joints zero. The new `xyzabc6/sim.var` seeds G54 at the
centre of the 600 mm stock's top face at A=0:

| Datum / pose | X | Y | Z |
| --- | ---: | ---: | ---: |
| G54 in machine coordinates | -100 | 140 | -725 |
| Ram centred, spindle retracted (joint coordinates) | 0 | 0 | 0 |
| Spindle above the work (joint coordinates, A=B=C=0) | 0 | 140 | -475 |

At the last pose, the nose is 850 mm above the A axis. The supplied T1 has
200 mm gauge length and 14 mm diameter, leaving its tip 50 mm above the
stock. The tool is defined in `xyzabc6/tool.tbl`, not baked into an STL.
Normal tool loading and G43 apply; identity/TCP/plane coordinates are different
after switching modes.

Use `xyzabc6/twp_simple_example.ngc` for the gantry exercise. Its datum and T1
match this example. The historical 55° program is archived in
`scripts/test_fixtures/legacy_sim/twp/demos/simple_example.ngc`; it is not
installed with this example.

## Kinematic contract

| Geometry pin | Value |
| --- | ---: |
| `nut-angle` | 45° |
| `y-pivot` / `z-pivot` | 140 / 480 mm |
| `x-offset` / `y-offset` | 0 / 0 mm |
| `y-rot-axis` / `z-rot-axis` | 140 / -1325 mm |

All seven values are direct `[HAL] HALCMD = setp ...` lines so the runtime,
gateway and offline TWP remap see the same geometry. Keep them and the model
frames together when modifying the design.

The linear chain is `x_bridge → y_saddle → xyz_head`. C rotates about +Z;
B rotates about `(0, sin45°, cos45°)` in the C frame. The A faceplate rotates
about -X and carries `a_work`. The neutral spindle axis is deliberately
140 mm behind the C/ram axis in Y. Y=0 centres the ram between the walls;
Y=140 centres the neutral spindle on the table. The work/tool frame origins
match the kinematics despite this offset.

| Joint | Limits |
| --- | --- |
| X | -1500 … +1500 mm |
| Y | -1300 … +1300 mm |
| Z | -1325 … +0.01 mm (nominal upper end 0) |
| A / B / C | ±360° / ±185° / ±320° |

Z0 is the retracted position. The +0.01 mm allowance keeps HOME=0 strictly
inside the limit window. `hallib/limit_window.hal` lifts world XYZ limits
under TCP/TOOL as in the existing TWP demo; the joint limits still constrain
the physical slides.

## Geometry and validation

- 32 STL parts in group-local millimetres, generated from FreeCAD solids.
- Walls 3075 mm high with inner faces at Y=±2110 mm.
- Two X rails per wall, two blocks per rail, four blocks under each separate
  1110 × 950 × 200 mm saddle plate; plates and crossbeam share their X centre.
- Two Y rails/four blocks and two Z rails/four blocks. All three axes now use
  size 100 instead of size 65: simplified THK SRG100LC dimensions, with
  **100 × 77 mm rails, 250 × 395 mm flanged blocks and 120 mm assembly height**.
  The mounting-hole pitch on the rails is 105 mm; the block's steel body is
  280.2 mm long and its flange is 35 mm thick.
- The larger blocks retain two blocks per rail and four X blocks per wall.
  The 200 mm saddle plates and beam rise 30 mm with the taller X guides.
  The beam and its saddle plates move 60 mm back to accommodate the larger
  Y/Z stacks while retaining the 220 mm carriage thickness and existing
  spindle datum. The Y carriage widens to 1020 mm. X rails extend to 5440 mm,
  Z rails to 2425 mm; every block stays fully supported throughout travel,
  with at least 27.5 mm to a rail end. X/Y rails use two joined segments.
- Both head housings are Ø560 mm, with broad shoulders at the 45° cut and
  short Ø380 mm connecting bosses. The B joint has 4 mm minimum separation.

`machineGantry.test.ts` checks the shipped INI and meshes, guide dimensions,
mounting-face alignment, plate symmetry and full-travel block support, the model chain
against the oracle-backed `TrsrnKins` implementation over 303 poses, symmetric
wall clearance, and an intended sequence of linear-limit and parked rotary
moves through the actual collision sweep. The current BVH reports the close
diagonal head bearing faces as static contacts; an independent separating-plane
check proves their 4 mm gap for every B angle, so baseline subtraction cannot
hide a head-half intersection. The test does not assert that arbitrary
simultaneous six-axis moves clear the fixture or stock.

The continuous wall bound includes every B/C orientation and full Y travel,
with a 200 mm × Ø14 mm tool and a 1.3 mm housing tessellation allowance:
at least **114 mm on either side**. Longer/wider tools need a new check.
The CAD and compiled LinuxCNC kinematics were also checked off-machine during
development. Initial setup and operation of the example have been confirmed
on a LinuxCNC host. This larger-guide revision has been checked off-machine;
the adapted TWP demonstration programs and full live validation still precede
promotion to the default demo. The existing INI, kinematic pins and offsets
remain applicable to this geometry update.

## Collision proxies

The linear guides tessellate the rail and block profiles into ~189,000 of the
model's 204,000 triangles, and every clearance query of the collision sweep
walked those meshes — a 1.2 M-point program's sweep took hours. The nine
guide parts (`x/y/z_guide_rails`, `_guide_blocks`, `_guide_endcaps`) therefore
declare a `collision` proxy in `machine.json`: `collision/<part>.stl`, one
axis-aligned box per connected component (rail, block, cap), 744 triangles in
all. The display mesh is unchanged; the sweep checks the box, which contains
the part, so it can only become more conservative. `leveling_pads` and
`chip_tray` are `collide: false` — decoration under the bed the sweep never
sees. The head, housings, faceplate and fixture stay on their real meshes: a
box around a ring or a tilted housing would fill the gaps between them.

The proxies are derived from the exported meshes, deterministically:

```sh
python3 scripts/stl_collision_proxy.py examples/sim_config/machine-xyzacb-gantry/x_guide_rails.stl \
        examples/sim_config/machine-xyzacb-gantry/collision/x_guide_rails.stl
python3 scripts/stl_collision_proxy.py --check IN.stl OUT.stl   # exit 1 if OUT is stale
```

`freecad_twp_gantry.py` runs this for every proxied part after its export,
and `machineGantry.test.ts` checks that every display-mesh vertex of a proxied
part lies inside one of its boxes.

## Rebuild or edit

FreeCAD is only needed to change geometry. The committed meshes are ready to
load after `git lfs pull`. From the repository root, with FreeCAD available:

```sh
FreeCADCmd -c "import runpy; runpy.run_path('scripts/freecad_twp_gantry.py', run_name='__main__')"
```

The executable may be named `freecadcmd` on your installation. For an editable
assembly with a six-axis Motion spreadsheet, a STEP export, and a geometry
report, supply an export directory:

```sh
TWP_GANTRY_CAD_DIR=/tmp/twp-gantry-cad FreeCADCmd -c "import runpy; runpy.run_path('scripts/freecad_twp_gantry.py', run_name='__main__')"
```

This writes the 32 STLs and `machine.json` back into this folder; optional CAD
files go only to the chosen directory. STL export poses are local and
independent of the saved CAD assembly pose. Verify a change with:

```sh
cd lcnc-webui
npm ci
npm test -- src/viewer/machineGantry.test.ts src/viewer/kinsFixtures.test.ts
npm run build
```

This is a simulation concept, not a load-rated mechanical design. Geometry
and generator are GPL-2.0-or-later; see [NOTICE](../../../NOTICE). No DMU meshes
or manufacturer photographs are redistributed. Guide envelopes and mounting
dimensions reference the [THK SRG100LC table, pages A1-430/431](https://tech.thk.com/en/products/pdfs/en_a01_430.pdf).
Raceways, end caps and screw holes are simplified independent geometry.

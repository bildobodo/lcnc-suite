# Simulation examples

The supported catalog is [`profiles.json`](profiles.json). The suite installs
exactly these examples on fresh installations and upgrades:

| Name | INI | Modes |
| --- | --- | --- |
| **3 Axis XYZ** | `lcnc_suite_sim_3axis_xyz.ini` | Cartesian XYZ |
| **5 Axis XYZAC** | `lcnc_suite_sim_5axis_xyzac.ini` | Identity and TCP; new trunnion from PR #41 |
| **6 Axis TWP XYZABC** | `lcnc_suite_sim_6axis_twp_xyzabc.ini` | Identity, TCP and TWP; 45° gantry from PR #39 |

The new 5-axis example currently has **no G68.2/TWP support**. Its A/C table
kinematics differ from the 6-axis nutating head. A TWP label requires a separate
implementation and acceptance tests, not copying the head's remaps.

## Install and run

Run `./install.sh` from the checkout. It installs the three profiles under
`~/linuxcnc/configs/lcnc_suite_sim/` and compiles two realtime components with
`halcompile` — the 6-axis runtime kinematics and the simulated tool setter
(LinuxCNC development tools are installed if missing).
Stop LinuxCNC before updating the examples. For an existing suite installation,
update only the examples with:

```sh
python3 scripts/install_examples.py
sudo halcompile --install examples/sim_config/twp/xyzacb_trsrn.comp
sudo halcompile --install examples/sim_config/sim_toolsetter/sim_toolsetter.comp
linuxcnc ~/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim_3axis_xyz.ini
# Or choose lcnc_suite_sim_5axis_xyzac.ini / lcnc_suite_sim_6axis_twp_xyzabc.ini.
```

Start one LinuxCNC session at a time. The examples default to loopback access
and production mode. Build the frontend with `cd lcnc-webui && npm run build`
before starting. Arm control in the UI, reset E-stop, enable, then home all axes.

Each example has its own parameter file and tool table under `xyz3/`, `xyzac5/`
or `xyzabc6/`. The 5-axis example opens its air-motion demonstration. The gantry
starts empty; load `xyzabc6/twp_simple_example.ngc` for the TWP exercise, which
uses G54 `X-100 Y140 Z-725` and the supplied T1 (`Z200 D14`). These programs
change work offsets and exercise kinematics; they are simulation fixtures.

See [5-axis setup and geometry](xyzac5/README.md) and
[6-axis gantry coordinates](machine-xyzacb-gantry/README.md).

All three profiles use `~/linuxcnc/nc_files` as the Program browser root
(`DISPLAY.PROGRAM_PREFIX`). The browser displays the server path and reserves
most of the program panel for the file list while Browse is open. An upgrade
corrects the initial 5-axis profile's `xyzac5` browser root, which accidentally
exposed machine state instead of the shared programs. Custom program folders
are preserved. Restart the suite after changing this INI setting.

## Simulated tool setter

The sim configs have no probe hardware. The WebUI's *Simulate probe trip* pulses
the probe input by hand (work probing); for the **tool setter** the probe trips by
itself, where a real tool setter would: `hallib/sim_toolsetter.hal` (sourced by
every `core_sim_*.hal`) routes `motion.probe-input` through the realtime
component `sim_toolsetter`, which compares in the servo thread — the control
point (the joint positions, `joint.N.pos-fb`) inside the plate's X/Y window
(±25 mm) and its Z minus the spindle tool's **table length** at or below the
plate surface. `sim_toolsetter/sim_toolsetter_feed.py` supplies the length from
the tool table.

The **plate is physical**: a fixed point per profile, set in its `core_sim_N.hal`
(`setp sim-toolsetter.0.plate-x/-y/-z`, G53 — centre X/Y, surface Z):

| Profile | Plate X / Y / Z |
|---|---|
| 3 Axis XYZ (`core_sim_3.hal`) | 10 / 10 / −180 |
| 5 Axis XYZAC (`core_sim_5.hal`) | 150 / 0 / −300 |
| 6 Axis TWP XYZABC (`core_sim_6.hal`) | 10 / 10 / −180 |

Set *Probing › Toolsetter* (X, Y, Z position) to the same point — the
profile's shipped var file names it (`#3100` / `#3101` / `#3102`). The sim does
not follow the WebUI's setting: a different setting measures wrong by the
difference, the same way every time, like a machine whose reference is set
wrong (a Z set 20 mm too high measures every tool 20 mm short; X/Y more than
25 mm off never trips).

- With the setting on the plate, the table length is the sim's physical
  length of the tool: a measurement returns it (to a servo period at the slow
  probe feed) and repeated measurements do not drift.
- A tool without a table length, or an empty spindle: nothing trips, the probe
  finds nothing — as on a machine without a tool setter.
- The tool is taken as vertical (the TWP gantry's head must stand at B0/C0).
- The comparison is faithful: after the fast probe the machine decelerates past
  the trip point; if the retract (`#3009`, *Retract distance*) does not clear
  that overshoot, the slow probe starts with the probe still pressed and
  LinuxCNC stops with "probe already tripped" — as a real machine would. Keep
  the fast probe feed moderate (e.g. 500 mm/min with a 2 mm retract).

`scripts/config_sync_check.py` reports a component that is not installed, with
the `halcompile` command.

## Updating existing installations

The installer renames the old 3-axis and gantry INIs and carries over their
saved parameters, tool tables, network settings and local INI adjustments.
The new 5-axis model starts with its own state; it never inherits tool lengths
or offsets from the retired trunnion. Subsequent runs preserve all three
profiles' parameters, tool tables and locally edited demonstration programs.
The 5-axis example also keeps joint positions in `xyzac5/position.txt`.
Fresh installs and upgrades without that file receive X0 Y0 Z0 A0 C0,
so Z starts at the top of its −400…0 mm window before homing. Existing saved joint
positions are preserved; all axes still require homing after startup.

The XYZAC example moved its Z datum on 2026-09-27 (machine Z0 is the top of
travel; the A/C intersection is at machine Z −500) and gained M600/M601. An
installation from before is migrated once by `install_examples.py`. The
datum is read from the kins pin `z-rot-point` (0 before, −500 after; any other
value is refused before anything is written). Every machine-absolute Z shifts
by −500 — the INI's own Z window, homes and pin (a local limit stays a local
limit), G54…G59.3 Z, G28/G30 Z, the saved joint Z and the toolsetter Z in the
var file and in the WebUI's settings — so program zero stays where it was
touched off; G92, tool lengths and distances stay. A G28/G30 Z that was
outside the travel (never reachable) becomes the top of travel. The toolsetter
position #3100–#3102 moves with the datum too — also 0/0/0 when the WebUI saved
no toolsetter for this INI (the installer cannot tell the WebUI's old fallback
zeros from a position set directly, so it keeps the point and says what to
check); only the old example's unchanged 10/10/−180 is replaced by the
current one, reported. A var or position file missing from the installation
is seeded from the example with THIS INI's home and top of travel (a lowered
window kept by the migration starts inside it). The unchanged
old demo is replaced; an edited one is kept and the current one is put beside
it (`demo.new.ngc`). Stop LinuxCNC and the gateway first. Missing suite remaps
(a new M-code) and RS274NGC entries are added to any installed example from
its template; local values are kept.

Before replacing files, the complete previous installation is saved under
`~/linuxcnc/config-backups/lcnc_suite_sim/<timestamp>/config/`. Backups are
outside `configs/`, so LinuxCNC's chooser does not list retired profiles.
The old 5-axis, 9-axis, 55° TWP and local DMU examples are retired from this
managed installation. Other LinuxCNC configuration directories are untouched.

Shared HAL, remaps and model directories link to this checkout, so runtime
code and the gateway remain in sync. Local edits to replaced shared files
remain in the backup. Suite paths/titles are managed; other INI changes are
preserved and reported by `scripts/config_sync_check.py`. Do not move or remove
the checkout while using its installed examples.

Historical model/config fixtures live in `scripts/test_fixtures/legacy_sim/`.
They preserve existing numerical and recorded tests and are not installed.
New live acceptance uses the three profiles above. See
[the shared test suite](../../docs/testing.md).

## Tool libraries

Fresh installations include the 36 Fusion / FreeCAD example tools with nominal
Z lengths and geometry, plus each machine’s original demo tools. Existing tool
tables remain untouched on upgrade. The library is installed as
`~/linuxcnc/nc_files/fusion-freecad.json`. **Tools → Browse** uses the same server
folder as Program, showing library files instead of G-code;
**Upload** opens a file picker on the client. See the repository
[tool library guide](../../docs/example-tool-library.md) for import and offset details.

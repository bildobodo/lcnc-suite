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
`~/linuxcnc/configs/lcnc_suite_sim/` and compiles the 6-axis runtime kinematics
with `halcompile` (LinuxCNC development tools are installed if missing).
Stop LinuxCNC before updating the examples. For an existing suite installation,
update only the examples with:

```sh
python3 scripts/install_examples.py
sudo halcompile --install examples/sim_config/twp/xyzacb_trsrn.comp
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

## Updating existing installations

The installer renames the old 3-axis and gantry INIs and carries over their
saved parameters, tool tables, network settings and local INI adjustments.
The new 5-axis model starts with its own state; it never inherits tool lengths
or offsets from the retired trunnion. Subsequent runs preserve all three
profiles' parameters, tool tables and locally edited demonstration programs.
The 5-axis example also keeps joint positions in `xyzac5/position.txt`.
Fresh installs and upgrades without that file receive X0 Y0 Z500 A0 C0,
so Z starts within its 100–500 mm limits before homing. Existing saved joint
positions are preserved; all axes still require homing after startup.

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

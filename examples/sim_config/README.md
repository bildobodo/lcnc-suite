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

## Updating existing installations

The installer renames the old 3-axis and gantry INIs and carries over their
saved parameters, tool tables, network settings and local INI adjustments.
The new 5-axis model starts with its own state; it never inherits tool lengths
or offsets from the retired trunnion. Subsequent runs preserve all three
profiles' parameters, tool tables and locally edited demonstration programs.

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

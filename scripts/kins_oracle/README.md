# Kins oracle (TCP+TWP plan phase 1b)

Compiles LinuxCNC's own kinematics math into a host binary so
`scripts/gen_kins_fixtures.py` can generate golden fixtures for the
TypeScript kins mirrors (`lcnc-webui/src/viewer/kins.ts`) and the Python
twin (`lcnc-gateway/gateway_util.py`). Same oracle discipline as the
rs274 WCS fixtures: the implementation under test is pinned to the real
control's code, never to a re-derivation.

## Provenance

`trtfuncs.c` and `kins_util.c` are vendored VERBATIM (do not edit) from
LinuxCNC v2.9.4, GPL-2.0:

    https://raw.githubusercontent.com/LinuxCNC/linuxcnc/v2.9.4/src/emc/kinematics/trtfuncs.c
    https://raw.githubusercontent.com/LinuxCNC/linuxcnc/v2.9.4/src/emc/kinematics/kins_util.c

They cover `xyzac-trt-kins` and `xyzbc-trt-kins` (the switchkins world
modes). The 45° nutating DMU head needs Sigma1912's custom comp —
separate vendor when phase 1c reaches it.

`xyzacb_trsrn.comp` (phase 3) is vendored VERBATIM (do not edit) from
the upstream TWP stack, LinuxCNC master @493926b56c (pre-ini-migration
tree the spike validated on 2.9.4), GPL-2.0, © David Mueller:

    https://raw.githubusercontent.com/LinuxCNC/linuxcnc/493926b56c/configs/sim/axis/vismach/5axis/table-rotary-spindle-rotary-nutating/xyzacb_trsrn.comp

It is the TWP machine's switchable kins (identity / TCP / TOOL-plane).
`harness_trsrn.c` includes its C body — everything after the `;;`
separator, extracted verbatim at build time by gen_kins_fixtures.py
(the halcompile-equivalent split; the extracted file is generated, not
in-tree). The newer handle-style pin API it uses (hal_real_t,
hal_get_real, hal_pin_new_real) is stubbed in `stub/hal.h`;
`stub/kinematics.h` supplies what halcompile's prologue would.

## How it compiles outside RTAPI

`stub/` contains minimal header stand-ins (EmcPose, hal_float_t=double,
hal_malloc/hal_pin_float_newf backed by calloc, rtapi_print → stderr).
`harness.c` #includes `trtfuncs.c` (same translation unit — the statics
stay reachable through the REAL `trtKinematicsSetup`, which runs
unmodified: coordinate mapping, principal-joint assignment, pin
allocation). `kins_util.c` compiles as a second TU. No LinuxCNC install
or RTAPI needed — just gcc + libm.

## Harness protocol

    harness <xyzac|xyzbc> <xrot> <yrot> <zrot> <xoff> <yoff> <zoff> <tooloff>

stdin lines:  `F j0 j1 j2 j3 j4 0`  → world `x y z a b c`
              `I x y z a b c`       → joints `j0 j1 j2 j3 j4`
(17 significant digits, one result line per input line; `ERR` on failure)

## harness_trsrn protocol

    harness_trsrn <y_pivot> <z_pivot> <x_offset> <y_offset>
                  <y_rot_axis> <z_rot_axis> <nut_angle_deg> <tool_offset_z>

stdin lines:  `S <type>`                          → `OK` (switchkins 0|1|2)
              `P <pre_rot_RAD> <th1_DEG> <th2_DEG>` → `OK` (plane params —
                  remap.py writes pre-rot in RADIANS, primary/secondary in
                  DEGREES; primary = table C, secondary = spindle B)
              `F j0 j1 j2 j3 j4 j5`               → world `x y z a b c`
              `I x y z a b c`                     → joints `j0 .. j5`

Live differential validation (2026-08-19, spike captures on 2.9.4,
geometry y_pivot 50 / z_pivot 120 / offsets 0 / rot-axis −1000,−2000 /
nut 55 / TLO 100): case 1 (TCP) worst XYZ deviation 0.067 mm over 218
mid-orient samples (servo-sampling skew); case 2 (TOOL/plane) settled
samples agree to ~3e-4 mm in BOTH directions (mid-move deviations up to
0.36 mm are deceleration-tail sampling skew, confirmed by the settled
tail). Captures: `~/twp-spike/capture-g536*.ndjson`.

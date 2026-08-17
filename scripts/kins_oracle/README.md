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

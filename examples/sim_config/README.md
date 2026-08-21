# Example Sim Config

A minimal LinuxCNC sim configuration for lcnc-suite. Copy to your LinuxCNC configs directory and adjust paths.

## Setup

Prefer `install.sh` (repo root) — it copies this directory to
`~/linuxcnc/configs/lcnc_suite_sim` **and replaces
`hallib/lcnc_webui.hal` with a symlink back to the repo**, so safety-chain
updates arrive with `git pull` instead of drifting (a hand-copied HAL file
eventually fails with `Pin does not exist` after the repo moves on).
Copying by hand:

```bash
cp -r examples/sim_config ~/linuxcnc/configs/lcnc_suite_sim
ln -sf "$(pwd)/examples/sim_config/hallib/lcnc_webui.hal" \
       ~/linuxcnc/configs/lcnc_suite_sim/hallib/lcnc_webui.hal
```

(Later `cp -r` copies of an installed config keep the symlink — GNU cp
copies symlinks as symlinks.)

Edit `lcnc_suite_sim.ini`:
- Set `SUBROUTINE_PATH` to your lcnc-suite clone location (LinuxCNC's INI parser expands `~`, so `~/lcnc-suite/...` is fine if you cloned there).

Edit `hallib/lcnc_webui.hal`:
- The HAL invokes the three helper scripts (`hal_watchdog.py`, `hal_reader.py`, `compensation.py`) by bare name. `install.sh` symlinks them into `~/.local/bin/` so `loadusr`/`execvp` finds them via PATH — no `$HOME`-substitution syntax is needed and the file is portable across clone locations and TWOPASS modes. If `~/.local/bin` is not on your PATH, add it to your shell rc.
- Surface compensation is enabled by default and requires `python3-scipy` (auto-installed by `install.sh`). Comment out the `loadusr ... compensation.py` line and the `net eoffset-*` / `net compensation-*` block at the bottom of the file if you don't need it.
- Adjust the `unlinkp iocontrol.0.emc-enable-in` line if your config uses a different e-stop signal name.

## Key files

- `lcnc_suite_sim.ini` — INI with all required RS274NGC, HAL, and display settings
- `lcnc_suite_sim_5axis.ini` / `lcnc_suite_sim_9axis.ini` — WS-D axis-layout
  verification variants (XYZAC / XYZABCUVW). Extra joints home instantly
  (no simulated switch) and loop back via `hallib/core_sim_5.hal` /
  `core_sim_9.hal`. Same subroutines/var file as the base sim.
- `lcnc_suite_sim_5axis_tcp.ini` — the 5-axis sim with REAL switchable
  kinematics (`xyzac-trt-kins sparm=identityfirst`) and the M428/M429/M430
  TCP toggle remaps from `remap_subs/` (see its README). Own var file
  (`sim_tcp.var`). The reference config for the suite's TCP support.
- `lcnc_suite_sim_twp.ini` — the TWP (tilted work plane) machine. Needs a
  one-time `halcompile --install` first; see "TWP variant" below.
- `hallib/lcnc_webui.hal` — HAL wiring for safety watchdog, e-stop chain, tool change, compensation
- Other HAL files — sim-specific (homing, spindle, etc.)

## 5-axis variant (XYZAC trunnion mill)

`lcnc_suite_sim_5axis.ini` simulates an XYZAC trunnion machine (trivkins)
and ships two visualizations of the same geometry:

- **Web UI machine model** — `WEBUI_MACHINE_DIR` in `[DISPLAY]` points at
  `machine-xyzac/` (machine.json + 11 STLs), an articulated model of
  LinuxCNC's vismach `xyzac-trt-gui` Hermle-style knee mill (GPL v2+,
  Rudy du Preez): the head/spindle is fixed to the column, Z lowers the
  knee, X/Y move table/saddle (table-moving signs), A tilts the trunnion,
  C spins the platter. The toolpath/backplot ride the platter
  (`workGroup: c_platter`). Regenerate after editing the generator:
  `python3 scripts/vismach_to_stl.py` (run from the repo root; the
  gateway hot-reloads machine.json on the next client connect).
- **Native vismach window** — `hallib/vismach_xyzac.hal` additionally
  loads the original Tk `xyzac-trt-gui` viewer on the LinuxCNC host's X
  display, driven by the same joint feedback (useful as a cross-check).
  Remove that HALFILE line for headless hosts.

The INI travel limits (X ±200, Y ±100, Z ±120, A −100…+50, C ±36000)
deliberately match the sample config the model comes from — the model is
desktop-scale (table ±150 mm, platter Ø100 mm), and larger travels make
the viewer frame a huge envelope around a small machine and let jogs
drive the table visually off its base.

## TWP variant (XYZACB-TRSRN nutating head)

`lcnc_suite_sim_twp.ini` simulates the upstream Tilted Work Plane machine:
X/Y/Z head slides, an **A rotary faceplate** carrying the work (its axis
runs along machine X), and a **nutating spindle head** — C swivels about Z
and B nutates about an axis 55° off it. `G68.2` defines a work plane,
`G53.1/.3/.6` orient the spindle to it and switch the kinematics into TOOL
mode, and `G69` cancels.

**One-time precondition.** The kinematics is a vendored realtime component
and must be compiled once before the config will load:

```bash
halcompile --install scripts/kins_oracle/xyzacb_trsrn.comp
```

Re-run it whenever that file changes. `install.sh` deliberately does not do
this: nothing else in the project builds a realtime component, and a failed
`halcompile` would break the install for everyone who does not want TWP.
Without it LinuxCNC fails at HAL load with a missing-module error.

**What makes this config different from the others:**

- `hallib/core_sim_6.hal` — six joints, `num_aio=4` (the TWP stack needs
  `analog-out-02` for twp-status *and* `-03` for the switchkins type), and
  `unlock_joints_mask=0` (on XYZABC, joint 4 is the nutating spindle rotary,
  not a lockable table — the 5-joint file's mask of 16 would have declared
  it unlockable).
- `[PYTHON]` and `SUBROUTINE_PATH` point at `twp/`, this project's GPL-2
  **fork** of the upstream remap stack. Task behaviour is identical to
  upstream; the fork additionally runs the plane math in PREVIEW and emits
  marker comments, which is how the web UI's offline stack (preview, scrub,
  soft limits, collision sweep) knows which kinematics governs each segment.
  See `twp/README.md`.
- The seven kins geometry values are `setp` lines in `[HAL]HALCMD`, and
  every one is named even where the value is 0. Both the gateway and the
  forked remap read *only* that form — geometry seeded through `net`/`sets`
  signals (the upstream idiom) is invisible to both. A pin the INI does not
  name parses as absent and the viewer substitutes 0, which is
  indistinguishable from a typo; the gateway raises a config warning naming
  the missing pins.
- Those same seven numbers are the constants in
  `scripts/vismach_to_stl_trsrn.py`, which generates the
  `machine-xyzacb-trsrn/` viewer model. Change one and you must change the
  other, or the 3D model and the kinematics disagree.

`twp/demos/` carries the upstream `simple_example.ngc` (and the `square`
subroutine it calls) — the program every stage of this machine's support was
validated against. It is a kinematics demo: it exercises the plane transform
rather than cutting the modelled stock.

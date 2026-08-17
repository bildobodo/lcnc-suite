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

# TWP remap stack — lcnc-suite preview-marker fork

GPL-2 fork of the upstream LinuxCNC Tilted Work Plane remap stack
(G68.2/.3/.4, G53.1/.3/.6, G69) for the `xyzacb_trsrn` machine, vendored
from LinuxCNC master @493926b56c
`configs/sim/axis/vismach/5axis/twp/` (David Mueller, GPL v2 — see file
headers; this pre-2026 revision uses stdlib configparser and runs on
LinuxCNC 2.9.4). The matching kins comp is vendored at
`scripts/kins_oracle/xyzacb_trsrn.comp` (install with
`halcompile --install`).

## What the fork changes (and why)

Upstream, every python remap entry point starts
`if self.task == 0: return` — previews (AXIS included) show TWP programs
untransformed by design. The web UI's offline stack (scrub, part-frame
preview, collision sweep, soft limits) needs to know, per segment, which
switchkins mode governs and what plane frame is pinned. This fork makes
the PREVIEW interpreter run the same pure math and announce the results
on the one execution-ordered channel the preview canon receives —
comment markers, silent in task:

- `(WEBUI_KINSTYPE=n)` — emitted right where `M68 E3 Qn` switches
  switchkins (types 0/1 in the ngc wrappers, type 2 in `g53x_core`).
- `(WEBUI_TWPFRAME=p,t1,t2)` — emitted by `g53x_core` where it set_p's
  the kins comp's `pre-rot`/`primary-angle`/`secondary-angle` pins: the
  three values that pin the TOOL-kins (case 2) plane frame. Units mirror
  the pins (and upstream's own asymmetry): pre-rot RADIANS,
  primary/secondary DEGREES.

The G59 origin needs no marker — the `G10 L2 P6..9` + `G59` writes are
plain interpreter state and execute in preview. The orient `G0` is real
canon motion, already in the preview stream.

Preview mechanics (all edits tagged `LCNC-SUITE` in `python/remap.py`):

- The preview process may have no HAL component at all (the webui parse
  worker), so every `hal.*` touch routes through `_task_mode` branches.
  The nutation angle comes from the INI's `[HAL]HALCMD`
  `setp <kins>_kins.nut-angle <deg>` line — the same single-source
  convention the webui gateway parses (`parse_kins_config`). Configs
  seeding geometry via `net`/`sets` signals are invisible to both; use
  direct `setp` lines for the static geometry pins.
- TWP state (`twp-status`, current pre-rot) is mirrored in module
  globals for the preview. `webui_preview_reset()` clears them — the
  webui parse worker calls it before every parse (the module stays
  cached in `sys.modules`). Foreign previews (AXIS) never call it, so
  preview state checks never hard-error: a G53.x with no plane declines
  loudly (stderr) instead of guessing, and a re-issued G68.2 overwrites.
- Task-mode behavior is intentionally IDENTICAL to upstream (verified
  live: same pin values, same program end state as the pristine stack).

## Validation (2026-08-20, LinuxCNC 2.9.4)

Preview parse of the upstream `simple_example.ngc` through the real
gateway parse worker emitted `WEBUI_TWPFRAME=-1.781762,130.245477,
-40.855498` — matching the live task run's kins pins from the same
program to 6 decimals (pre-rot −1.781762 rad, primary +130.2455°,
secondary −40.8555°). G53.6 spans type correctly (orient under 1/TCP,
square under 2/TOOL); G69 returns segments to type 0.

## Files

- `python/remap.py` — the fork (marked edits; everything else verbatim)
- `python/util.py`, `python/toplevel.py` — verbatim upstream
- `python/twp-helper-comp.py` — upstream plus ONE edit (tagged
  `LCNC-SUITE`): a 20 Hz sleep in its main loop. Upstream runs a bare
  `while 1:` with no sleep, which pins a CPU core at 100% and polls the
  NML status channel as fast as it can — measured here at 13m29s of CPU
  in 13m33s of wall time. Everything it publishes is display state for a
  vismach window; next to a 500 ms heartbeat watchdog the spin is a real
  hazard, not just waste.
- `remap_subs/*.ngc` — upstream wrappers + `(WEBUI_KINSTYPE=n)` markers;
  M428/429/430 adapted with preview-safe nested o-if HAL guards (RS274
  `AND` does not short-circuit)

INI wiring is the upstream TWP config's `[RS274NGC]` REMAP block with
`SUBROUTINE_PATH`/`[PYTHON]` pointed here (use ABSOLUTE paths — the
webui parse worker does not run from the config directory).

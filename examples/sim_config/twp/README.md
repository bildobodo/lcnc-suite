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
- `python/twp-helper-comp.py` — upstream plus a SPLIT-RATE main loop
  (edits tagged `LCNC-SUITE`). Upstream runs a bare `while 1:` with no
  sleep, pinning a CPU core at 100% and polling the NML status channel
  as fast as it can — measured here at 13m29s of CPU in 13m33s of wall
  time; next to a 500 ms heartbeat watchdog that spin is a real hazard,
  not just waste. But the rate cannot simply be dropped to 20 Hz:
  `twp-is-defined`/`twp-is-active` are NOT display state — remap.py
  reads them as CONTROL-FLOW GUARDS (G68.2 aborts if TWP is already
  defined; G53.x aborts "No TWP defined" if it is not), and upstream's
  spin made them effectively synchronous with the analog-out that
  drives them. A uniform 20 Hz period turned `g69 / g68.2 / g53.3` into
  a race the program lost roughly half the time, aborting mid-run and
  leaving the machine in limbo. So the guard pins republish at ~1 kHz
  (edge-triggered — steady state is one pin read and a compare) while
  the NML poll and the vismach passthrough (genuine display state) run
  at 20 Hz. Measured on a live session: ~0.9% of one core, vs
  upstream's 99.6%.
- `remap_subs/*.ngc` — upstream wrappers + `(WEBUI_KINSTYPE=n)` markers;
  M428/429/430 adapted with preview-safe nested o-if HAL guards (RS274
  `AND` does not short-circuit)

INI wiring is the upstream TWP config's `[RS274NGC]` REMAP block with
`SUBROUTINE_PATH`/`[PYTHON]` pointed here (use ABSOLUTE paths — the
webui parse worker does not run from the config directory).

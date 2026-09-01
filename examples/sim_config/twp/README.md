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
- Task-mode behavior was IDENTICAL to upstream until 2026-08-30 (verified
  live then: same pin values, same program end state as the pristine
  stack). Deliberate divergences since, all in `python/remap.py` and the
  wrappers, each recorded in docs/decisions.md:
  - the orient move is `G53 G0 B C` (machine-frame angles cannot be
    displaced by a rotary work offset), and every orient writes
    G59..G59.3 COMPLETELY (`A0 B0 C0 R0`) with an operator `(MSG,…)` when
    it had to clear foreign values; a G92 rotary offset refuses;
  - rotary reads add the ACTIVE fixture + G92 offsets back
    (`get_current_rotary_positions`, `get_machine_a`) — upstream read raw
    program coordinates; `rotary_offsets_nonzero` covers A/B/C;
  - `M535` / `o<twp_touchoff>` (lcnc-suite original): Plane-mode touch-off
    that writes the WORKPIECE datum G54 through the plane — the one datum;
  - `M428/M429` leave a reserved fixture for G54, `M430` selects G59 (the
    fixture rides the kins mode);
  - the "TWP already active" / "not reachable" refusals preserve the plane
    instead of wiping it; `M530 Q1` is the re-orient;
  - `M530 Q2` (lcnc-suite original, 2026-08-31): ADOPT the current head
    pose — verifies the live rotaries are normal to the stored plane and
    uses them verbatim instead of the solver's branch pick (a plain
    `G53.1 P0` after G68.3 can swing to the OTHER (B,C) solution; observed
    live: 168° of C with the tip on the part). Used by the gateway's
    one-button `twp_capture` command (G69 → G68.3 at the tool tip →
    M530 P0 Q2 → plane touch-off XYZ→0), driven as separate MDIs because
    remapped G-CODES silently never execute inside an o-sub called from
    MDI (M-code remaps do). Live acceptance:
    `scripts/twp_capture_check.py`.

## Touch-off and the reserved fixtures

The gateway's G54 row is seeded from the helper's datum pins after every
M535 write (STAT carries only the ACTIVE fixture, and LinuxCNC writes the
var file at shutdown), and the payload publishes the W1 stamp angles
(`wcs_prov_a`) so the client never compares a tilted-stamp row against the
table-frame datum.

G59..G59.3 hold the plane frame's origin in TOOL coordinates and are the
remap's to write. A touch-off never targets them: the gateway's `touchoff`
command routes identity/TCP touch-offs into G54–G58 (rotary letters into
G54 only, identity kins only; TCP only with the table at A=0) and Plane-mode
touch-offs to `o<twp_touchoff> call [mask] [x] [y] [z]`, which maps the
touched point back through the head solve (the kins pins) and the live table
angle and writes G54 — so a Re-orient recomputes the same G59 rows and G69
leaves a real datum behind. Layout twins: `python/twp_params.py` ↔
`gateway_util.WCS_VAR_BASES` (`lcnc-gateway/test_twp_params.py`),
`python/twp_prov.py` ↔ `gateway_util.wcs_prov_params`. Live acceptance:
`scripts/twp_touchoff_plane_check.py`.

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

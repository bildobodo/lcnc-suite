# P6-a v3 — F9, the believed start (`start_believed`) read where it is coherent

Replaces the section "F9 — the entry move 'to max Y, diagonally' (P6-a)" of
`docs/reviews/maschinentag.r456.p6-plan-v2.md` from "Proposed change" on. The
diagnosis ("Current behaviour at 4eda3892") stands as written there and is
confirmed by Codex (R456). Code sites at development `4eda3892` (worktree
`/home/cnc/lcnc-suite-p6`). **Plan only, no product code**: every variant
below ran inside the probe processes only. **Scope: rule 1 only** — the read
point for `start_believed`. Seeding the canon's `lo` with the same read
(F9-L) and the resync after the first point (F9-R) go to their own package
with a visible-layer proof (section "Out of P6-a").

## What R456 refuted, and why no read at the program's begin can hold

MT456-01 (Codex): with `G55` as the first line, v2's read (`current_*` at the
first `_begin_program`, through the canon's offsets at that moment) gives
`start_believed` (−400, −400, 60) instead of (−200, −200, 30); the entry move
then moves Y and Z on a block that commands X only, and the rotary config,
correct today, gets worse. Reproduced here (`g55_first`, `g55_first_rot`).

The cause is in LinuxCNC's own order, not in v2's arithmetic. `_begin_program`
runs inside the program's FIRST canon callback — gcodemodule calls
`maybe_new_line` → `next_line` at the top of every canon function
(gcodemodule.cc:155–173, e.g. `SET_G5X_OFFSET` 255–267). That first callback
is the announcement of the first block's first converter, and the converters
order "re-express `current_*`" and "tell the canon" differently
(upstream v2.9.4, `src/emc/rs274ngc/interp_convert.cc`):

| Converter | `current_*` re-expressed | Canon told | At the first callback |
|---|---|---|---|
| G54–G59.3 `convert_coordinate_system` | 1802–1805 (`find_current_in_system`) | `SET_G5X_OFFSET` 1824, `SET_G92_OFFSET` 1835, `SET_XY_ROTATION` 1845 | interpreter in the new frame, canon in the old |
| G92 `convert_axis_offsets` | 1124–1167 | `SET_G92_OFFSET` 1170 | same |
| G10 L2 on the active fixture `convert_setup` | 4333–4363, rotation 4367 | `SET_G5X_OFFSET` 4365, `SET_XY_ROTATION` 4369 | interpreter re-expressed, canon at most between g5x and rotation |
| G43 / G43.1 / G49 `convert_tool_length_offset` | 5747–5759 | `USE_TOOL_LENGTH_OFFSET` 5743 (first) | both in the OLD offset (coherent by accident) |
| G20 / G21 `convert_length_units` | 2723–2725 / 2766–2768 | `USE_LENGTH_UNITS` 2720 / 2763 (no Python callback: gcodemodule.cc:291 sets `metric` only) | the canon never hears it; its unit is what `length_units` says at the read |

So the state at the first callback is coherent for some first lines and not
for others; a text-line limit ("no frame word before the first motion") is no
border either (`G55 G0 X10` in one block, a preamble `G90` line, an O-call).
The spy log (`f9b_log`, every callback until the third point) shows it: at
`begin` the interpreter holds (−200, −200, 30) in G55 while the canon's g5x is
still G54's (100, 200, −30).

## The candidates

**(a) The first recorded point, in its own callback — chosen (rule 1).**
In every motion handler (`straight_traverse`, `straight_feed` /
`straight_probe`, `arc_feed`, `rigid_tap`) while no point is recorded yet
(`seq == 0`), AFTER the handler's begin decision (`_enter()`'s
`_ensure_reads()` and `_phase()`: a program whose first callback is a Python
remap's motion at line 0 begins only there) and BEFORE anything in the
handler reads `lo` — the last such read is the one of the callback that
records point 0. `arc_feed` reads `lo` for its segment count before it
reaches `straight_arcsegments`' `_enter()`: there the read sits at its top,
after the same two steps. It reads ONE state:

- the interpreter's position `current_x/_y/_z` (program frame, the
  interpreter's `length_units`: 1 inch, 2 mm, 3 cm → the canon's inch by 1,
  1/25.4, 1/2.54);
- carried into the canon frame by the canon's own `rotate_and_translate` with
  the offsets this callback's segment is stamped with (`_next_seq` takes the
  epoch snapshot in the same callback, gcode_canon.py:887–909) — the
  interpreter's position in `lo` space (the machine frame less the tool
  offset in effect, gcode_canon.py:1020–1025);
- **`start_lo`** = that position re-based to the tool offset in effect at the
  program's begin — the canon's own re-expression (`tool_offset`,
  gcode_canon.py:868–871) undone: `+ (xo, yo, zo) − (xo, yo, zo)@begin`. The
  worker's peel (gcode_parse_worker.py:1805–1812) is unchanged and is now the
  exact inverse of the read's transform: `start_believed` is the start in the
  first point's epoch frame, in the start tool basis — the existing
  convention (`startTlo` in `buildEntryTrack`, scrubTrack.ts:698–706; VP-I20's
  `compare_preview_payloads` shifts it like a point before the first TLO row,
  gateway_util.py:1897–1907).

`basis_at_start` stays where it is (`_begin_program`): it is the
initcode-forced active WCS, another contract. `lo` itself is NOT touched by
rule 1.

**No read — never a guess.** The read gives nothing, and `start_lo` stays
`None` (no `start_believed` on the wire, nothing falls back to the canon's
`lo`), when:

- the interpreter's words are absent (`interp()` None): X/Y/Z are already
  unknown from the begin (`start_dep_unavailable`, VP-I80) — as today, only
  the meaningless `start_believed` disappears;
- the callback comes from the **cutter-compensation queue**
  (`cutter_comp_side` set and `cutter_comp_radius` > 0 at the callback): the
  comp moves are queued unconditionally (`enqueue_STRAIGHT_FEED` /
  `_TRAVERSE`, interp_queue.cc:299 / 339, from `convert_straight_comp1`
  interp_convert.cc:5201–5213) and issued later by `dequeue_canons` — the
  entry move's callback runs inside the NEXT block, after `comp_set_current`
  (5216) moved `current_*` to the entry's end (measured: `cur` = (7.879,
  12.121, 30) at point 0 of `comp_first_g55`), and the callback's block words
  are that later block's too (`_dep_step` reads `blocks[0]`). Then
  `start_unbound` = X, Y, Z, whatever the misread words say (VP-I84's channel:
  no entry move, the beginning "not checked") — a comp entry whose next block
  commands X, Y and Z would otherwise look start-free (`comp_next_xyz_g55`).
  `G40` dequeues while the side is still set (1920 vs 1926). (The comp
  entry's end itself depends on where it starts — `convert_straight_comp1`
  offsets it from the current point, 5183–5191 — so the drawn entry point is
  the believed start's: a display limit, named, not fixed here.)

**(b) An init-end sync for every config — what makes the rotary config right
today — lost.** The rotary config is right today because its sync initcode
(`G53 G0 A… C…`, gateway_util.py:1402–1441) is a motion: it puts the canon's
`lo` at the interpreter's init-end position, and `_begin_program` takes that.
Giving every config such a seed (an XYZ sync move, or a marker callback after
the last initcode) fails for a source reason: a seed taken at init stays
fixed, while the offline interpreter's own position can be RESET after it —
an M6 (interp_convert.cc:5615), M61 (3398), G10 L0 (3706) or a probe (3905)
makes the next `read()` run `read_inputs` (rs274ngc_pre.cc:1437–1452, 1599) →
`refresh_actual_position` (interp_internal.cc:410–423), `current_*` :=
gcodemodule's `_pos_*`, the last `STRAIGHT_*` endpoint as it was passed (zero
before any; gcodemodule.cc:225, 242, 483, 520–528, 754), never re-expressed
into a frame, offset or unit changed since. The points after such a resync
are made of the reset position; an init-end seed is not. Measured, not only
argued: on the rotary config today's start IS that seed, and its first
endpoint is wrong in all five resync rows (`m6_after_g55_rot`,
`m61_after_g55_rot`, `m6_first_g43_rot`, `m6_first_g43_zero_rot`,
`inch_m6_first_g43_rot` — table below). A seed placed later only moves the
window: any frame, offset or unit change between it and a resync re-opens the
gap (`m6_after_g55`).

**(c) The canon reconstructing the start from its own applied state** means
re-deriving the interpreter's init (`synch()` from `_pos_*` = 0, the `#5220`
fixture, the seed's re-expression): the re-derivation CLAUDE.md forbids, and
it fails the resync rows exactly like (b).

## Why (a) is coherent (LinuxCNC source, v2.9.4)

1. **Every converter of the blocks before has returned.** Canon calls are
   synchronous and in execution order; a motion is converted after the frame,
   unit and offset words of its own block (`execute_block`: `convert_m`
   interp_execute.cc:303 before `convert_g` 304; in `convert_g` units 2373,
   comp 2381, tool offset 2385, fixture 2389, G10/G28/G30/G92 2410, motion
   last 2417), so at a motion callback both halves of every table row above
   are done — the interpreter's re-expression AND the canon's applied
   offsets, rotation, tool offset and gcodemodule's `metric` (set by the same
   `USE_LENGTH_UNITS` as `length_units`).
2. **`current_*` is still the motion's start at its callback.** The
   interpreter assigns the end after the canon call returns:
   `convert_straight` `STRAIGHT_TRAVERSE` 4834 → 4837–4839, `STRAIGHT_FEED`
   4841 → 4844–4846; `convert_arc2` `ARC_FEED` 606 → 609–611; `convert_home`
   (G28/G30 first leg) 2581 → 2585–2593; `convert_probe` 3907 (the position
   follows at the next read). Only the comp queue breaks it (above).
3. **The read is what point 0's dependent axes are made of.** An axis a block
   does not address keeps `current_*` (`find_ends`; G91 adds to it); so point
   0 on every still-dependent axis = the read (+ the G91 increment, − the tool
   offset changed before point 0). Hence, for any live start S in the same
   basis: bound point 0 = point 0 + (S − read) = S on every axis the block
   does not command — the first endpoint moves only the commanded axes **by
   construction**, whatever happened before point 0, the resync included.

## The premise of the resync rows: the controller's motion at a tool change

The resync rows say "the machine holds its place across the M6, so the first
X-only move moves only X". Checked in the controller's source (v2.9.4,
`src/emc/task/emccanon.cc`, fetched with its hash):

- **The real resync re-reads the real position.** In task the same
  `refresh_actual_position` asks emccanon's `GET_EXTERNAL_POSITION`
  (emccanon.cc:2658–2690): `emcStatus->motion.traj.position`, un-offset and
  un-rotated with the CURRENT offsets — the physical position in the current
  frame. No jump; only the offline gcodemodule answers with `_pos_*`.
- **Where the machine MOVES at a tool change** — every source of motion:

| Setting | Who moves | Source | Recorded by the parse? | The beginning |
|---|---|---|---|---|
| `[EMCIO] TOOL_CHANGE_POSITION` (3, 6 or 9 values; XYZ, +ABC, +UVW) | the controller's canon `CHANGE_TOOL`, a linear move of type TOOLCHANGE before the load | emccanon.cc:2066–2125; read by taskclass.cc:461–520 | **no** — the worker marks the named axes unknown (`tool_change_moves` / `tool_change_axes` from the INI, gcode_parse_worker.py:340–350; any count but 3/6/9 → all nine, conservative) | unbound (`m6tc_first_partial`, `m6tc_after_g55`, in-tree `e_m6_first`, `r133_m6_before_first`) — measured: `m6tc_after_g55` (+rot) unbound [X, Y, Z] today and v3 |
| `[EMCIO] TOOL_CHANGE_QUILL_UP` | the interpreter: a traverse to machine Z0 before `CHANGE_TOOL` | interp_convert.cc:5547–5560 (`STRAIGHT_TRAVERSE(-1, …)`) | yes, at line −1 (`_internal_move` → the dependent axes to unknown) | unbound — measured: `m6_quill_first_g55` (+rot), [X, Y, Z] today and v3 |
| `[EMCIO] TOOL_CHANGE_AT_G30` | the interpreter: traverses to G30 (#5181–#5189) | interp_convert.cc:5562–5602 | yes, at line −1 | unbound — measured: `m6_g30_first_g55` (+rot), [X, Y, Z] today and v3 |
| an M6 / M600 REMAP | the remap's body | (the suite's routine runs in the preview) | yes where the body runs in the preview; a foreign or opaque body → unknown (`foreign_remap`, `position_read`) | as its body |
| `TOOL_CHANGE_WITH_SPINDLE_ON`, `RANDOM_TOOLCHANGER`, M61, G10 L0 | — no motion (M61: `CHANGE_TOOL_NUMBER` only, emccanon.cc:2149) | | | |

  So the one motion the parse does not record (TOOL_CHANGE_POSITION) already
  makes the beginning unbound, and the interpreter's own moves are recorded
  and make it unbound too. **The premise holds; the rule does not change.**
  The resync rows are exactly the configuration without these settings —
  where `CHANGE_TOOL` moves nothing (the move is inside
  `if (have_tool_change_position)`, emccanon.cc:2082) and M61 sends only
  `EMC_TOOL_SET_NUMBER` (emccanon.cc:2149). Not run on a live controller.

## Independent proof: the client chain and the corpus

Harness (`~/claude-work/p6/f9b/`): `f9b_probe.py` is the worktree's
`native_start_probe.py` (4eda3892) with the case file, X/Y limit overrides and,
**inside the probe process only**, the variants by `F9B_MODE`: `old`
(4eda3892), `v2` (R456's `R456_FIX`), `cand` (rule 1) and the mutations. pytest
runner `test_p6_f9b_probe.py` (copied into `lcnc-gateway/` and removed after
each run; the case sets and the corpus runs under `heavy_lock.py --who
p6a-plan`, short runs of ≤ 108 subprocesses (seconds of CPU) without it), one subprocess per case and
variant, synthetic STAT, machine commands prohibited — LinuxCNC's offline
interpreter, the parse worker's own. 85 cases: Codex's ten, the first
agent's nine, every shape asked for (G55 with motion in one block, G90 before
G55, an inch machine with a G43 start, a rotated fixture with a stored G92,
G92 first, M6 / M61 / M600 / an O-call before the first motion, no motion),
each frame-change case with its rotary twin (`_rot`, XYZA with the sync
initcode), and G28, an arc, a rigid tap, cutter compensation, a Python remap's
motion first, the tool-change motions above.

Frames (machine units): Codex's G54 (100, 200, −30), G55 (300, 400, −60); the
machine-day G54 (238.525, 379.696, −96.75); inch G54 (2, 3, −1), G55 (4, 5,
−2); a rotated G54 R30 with a stored G92 (7, 9, 0).

**1. The client chain** (`~/claude-work/p6/f9b/p6probe.f9b.test.ts`, vitest,
copied into `lcnc-webui/src/viewer/` and removed): every native payload,
every variant, through `decodePreviewStreams → buildScrubTrack →
epochTermsFor → buildEntryTrack` (Codex's R456 client probe, generalised),
live active fixture G54, live tool offset = the start offset, the live joints
at P (the believed physical start) AND at Q = P + (13, −17, 7) mm (inch:
+ (0.5, −0.7, 0.3)) — **away from P a wrong dependency label shows; at P it
hides** (Codex's probe used P only). The first endpoint (entry index 1) in
machine joints (tip + the point's tool offset); the oracle needs nothing from
the read: every axis the first block does not command stays at the live
value, a commanded axis lands on its target (G91: live + increment), and a
case that binds under v3 must not lose its entry.

Cases with a wrong first endpoint (85 cases): **at P today 38, v2
30, v3 0; at Q today 42, v2 34, v3 0** (a case that loses an entry v3 keeps
counts as wrong). Decisive rows (machine joints,
live at P; at Q the same verdicts):

| Case | Commands | Today | v2 | **v3** |
|---|---|---|---|---|
| g55_first (3-axis) | X | (310, 400, −60) moves YZ | (310, 400, −60) moves YZ | **(310, 200, −30)** |
| g55_first_rot | X | (310, 200, −30) ✓ | (310, 400, −60) moves YZ | **(310, 200, −30)** |
| g55_with_move / g55_preamble | X | moves YZ | moves YZ | **✓** |
| f9_mday_g30_0 (machine-day head, live at the G54 origin) | Z | (477.05, 759.39, 0) moves XY | (238.525, 379.696, 0) ✓ | **(238.525, 379.696, 0)** |
| inch_g43_g55 | X | (5, 6, −2) moves YZ | (5, 5, −2) moves YZ | **(5, 3, −1)** |
| comp_first_rot (live Q) | XY | (107.9, 195.1, −23) off target (Y commanded, shifted as dependent) | same | **no entry: unbound [X, Y, Z]** |

(at P `comp_first_rot` is right today by coincidence: Δ = 0.) The
machine-day head's beginning time `cum[K+1]`: 13.555212 s today, 5.4515 s
with v3.

**The resync rows, by the client** — today, Codex's physical-start oracle
(the v3 payload with `start_believed` := P in point 0's frame) and v3; live
at P and at Q:

| Case | Live | Today | Codex's oracle (physical start) | **v3** |
|---|---|---|---|---|
| m6_after_g55 (`G55` / `T2 M6` / `G0 X10`) | P | (310, 600, −90) moves YZ | (310, 400, −60) moves YZ | **(310, 200, −30)** |
| | Q | (310, 583, −83) moves YZ | (310, 383, −53) moves YZ | **(310, 183, −23)** |
| m6_after_g55_rot | P | (310, 400, −60) moves YZ | (310, 400, −60) moves YZ | **(310, 200, −30)** |
| | Q | (310, 383, −53) moves YZ | (310, 383, −53) moves YZ | **(310, 183, −23)** |
| m61_after_g55 (`M61 Q2` instead) | P / Q | as m6_after_g55 | as m6_after_g55 | **(310, 200, −30) / (310, 183, −23)** |
| m61_after_g55_rot | P / Q | as m6_after_g55_rot | as m6_after_g55_rot | **(310, 200, −30) / (310, 183, −23)** |
| m6_first_g43 (G43 Z10 start, `T2 M6` / `G0 X10 Y10`) | P | (110, 210, −50) moves Z | (110, 210, −20) moves Z | **(110, 210, −30)** |
| | Q | (110, 210, −43) moves Z | (110, 210, −13) moves Z | **(110, 210, −23)** |
| m6_first_g43_rot | P | (110, 210, −20) moves Z | (110, 210, −20) moves Z | **(110, 210, −30)** |
| | Q | (110, 210, −13) moves Z | (110, 210, −13) moves Z | **(110, 210, −23)** |
| m6_first_g43_zero (+rot; every fixture zero) | P | (10, 10, 10) moves Z | (10, 10, 10) moves Z | **(10, 10, 0)** |
| | Q | (10, 10, 17) moves Z | (10, 10, 17) moves Z | **(10, 10, 7)** |
| inch_m6_first_g43 (inch, G43 0.5) | P | (3, 4, −1.5) moves Z | (3, 4, −0.5) moves Z | **(3, 4, −1)** |
| | Q | (3, 4, −1.2) moves Z | (3, 4, −0.2) moves Z | **(3, 4, −0.7)** |
| inch_m6_first_g43_rot | P | (3, 4, −0.5) moves Z | (3, 4, −0.5) moves Z | **(3, 4, −1)** |
| | Q | (3, 4, −0.2) moves Z | (3, 4, −0.2) moves Z | **(3, 4, −0.7)** |

The physical-start value is wrong in exactly these 10 cases and right in every
other; today's rotary value is the physical start (candidate (b)), hence the
same verdicts on `_rot`.

**2. The in-tree corpus.** Every case of `native_start_probe.py` (279 that
parse; 5 regex hits are field names), today vs v3: equal — digest without the
start fields, `start_unbound`, `rapid_dep` / `feed_dep`, `rapid_ustart`,
`parse_error`, `violations_total` — in all 279. `start_believed` differs in
two, both explained: `e_no_interp` (none instead of a value from `lo`; X/Y/Z
unbound there) and `m600_result` (G54 Z = 10: (0, 0, −10) → (0, 0, 0) — an F9
instance in the tree, without a dependent axis, so no binding moved).

**3. The corpus under a common fixture translation** (metamorphic): every
fixture row G54–G59.3 moved by D = (100, 200, 0) moves the believed start with
it; the program-frame answers must not move (D_z = 0 keeps every `G53 Z` and
the Z limits fixed). 279 cases, each against its own unshifted run:
- today: `start_believed` moves in **267** cases — by exactly −D in 263 (in
  209 of them nothing else moves: the F9 signature across the whole corpus),
  by a turned −D in the three turned-frame cases, by (0, −200, 0) in one
  absolute write — and stays in 12, two of them absolute writes where it
  must move;
- v3 (rule 1 alone): `start_believed` stays in **276**
  and moves in exactly the 3 cases that write a fixture ABSOLUTELY
  (`G10 L2 P2 X5 Y6 Z7` / `G55`, an inline sub's `G10 L2 P1 X1 Y2 Z3`,
  `G10 L2 P1 X0`): the written frame does not move, so the believed start in
  it must, by D on the written axes — +(100, 200, 0), +(100, 200, 0),
  +(100, 0, 0), giving (95, 194, −7), (99, 198, −3), (100, 0, 0) (by hand the
  shifted P in the written frame; in `r133_g55_before_first` also point 0's
  dependent Y, Z (194, −7)); today's stay at (−5, −6, −7), (−1, −2, −3),
  (0, −200, 0);
- every other field (points, masks, unknown starts, unbound, times, limits,
  TLO rows, notes): today and v3 identical in the shifted runs (279 cases,
  measured for `cand`);
  where they move under the translation they move alike in both —
  machine-addressed moves (the M600 routine's `G53` to the setter, G28/G30
  stored positions, the limit splits of `lim_*`) and one translation variance
  unrelated to F9: arc tessellation (`e_arc_known` 90 → 128 feed points,
  `e_arc_dep`, `g43_arc`).

**4. A consistency check (not independent): the read against point 0.** On
every axis still dependent after point 0, v3's `start_believed` equals point
0's own value (less the G91 increment, re-based by the tool offset set before
point 0) — in 59 of the 63 cases with a dependent axis (the comp cases excluded: no
read). This compares the read with what the read produced, so it proves only
that the worker's peel inverts the read; the client chain above is the proof.

**The value table** (`start_believed` per variant, mm or in; `·` = an axis
not dependent at point 0; `unb` = `start_unbound`):

| Case | Program head | Point 0 (dep) | Today 4eda3892 | v2 | **v3** | Expected pt0 / phys |
|---|---|---|---|---|---|---|
| plain | `G53 G0 Z0` | (0, 0, 30) XY | (−100, −200, 30) | (0, 0, 0) | **(0, 0, 0)** | (0, 0, ·) / (0, 0, 0) |
| **g55_first** | `G55` / `G0 X10` | (10, −200, 30) YZ | (−300, −400, 60) | (−400, −400, 60) | **(−200, −200, 30)** | (·, −200, 30) / (−200, −200, 30) |
| **g55_first_rot** (`g55_rotary` in the probe) | same, XYZA | same | (−200, −200, 30) | (−400, −400, 60) | **(−200, −200, 30)** | same |
| g55_with_move (+rot) | `G55 G0 X10` | same | (−300, −400, 60) [rot ✓] | (−400, −400, 60) | **(−200, −200, 30)** | same |
| g55_preamble (+rot) | `G90` / `G55` / `G0 X10` | same | (−300, −400, 60) [rot ✓] | (−400, −400, 60) | **(−200, −200, 30)** | same |
| ocall_g55 (+rot) | inline `o100 sub G55`, call, `G0 X10` | same | (−300, −400, 60) [rot ✓] | (−400, −400, 60) | **(−200, −200, 30)** | same |
| g20_first | `G20 G91 G0 X1` (mm machine) | (25.4, 0, 0) XYZ | (−100, −200, 30) | (0, 0, 0) | **(0, 0, 0)** | (0, 0, 0) / (0, 0, 0) |
| g20_g55 (+rot) | `G20 G55 G0 X1` | (25.4, −200, 30) YZ | (−300, −400, 60) [rot ✓] | (−400, −400, 60) | **(−200, −200, 30)** | (·, −200, 30) / same |
| g43_first | `G43.1 Z10` / `G53 G0 Z0` | (0, 0, 20) XY | (−100, −200, 30) | (0, 0, 0) | **(0, 0, 0)** | (0, 0, ·) / (0, 0, 0) |
| g43h_g55_move (+rot) | `G55 G43 H1 G0 X10` | (10, −200, 20) YZ | (−300, −400, 60) [rot ✓] | (−200, −200, 30) | **(−200, −200, 30)** | (·, −200, 30) / same |
| g43_start_g55 (+rot), start G43 Z10 | `G55` / `G0 X10` | (10, −200, 20) YZ | (−300, −400, 50) [rot ✓] | (−400, −400, 50) | **(−200, −200, 20)** | (·, −200, 20) / same |
| inch_g43_start (+rot), inch, G43 0.5 | `G20 G90` / `G53 G0 Z0` | (0, 0, 0.5) XY | (−2, −3, 0.5) [rot ✓] | (0, 0, −0.5) | **(0, 0, −0.5)** | (0, 0, ·) / (0, 0, −0.5) |
| inch_g43_g55 (+rot) | `G55` / `G0 X1` | (1, −2, 0.5) YZ | (−4, −5, 1.5) [rot ✓] | (−4, −4, 1.5) | **(−2, −2, 0.5)** | (·, −2, 0.5) / same |
| rot_g92_to_g55 (+rot), init G54 R30 + G92 | `G55` / `G0 X10` | (10, −197.7, 30) YZ | (−307, −409, 60) [rot ✓] | (−284.5, −471.6, 60) | **(−205.4, −197.7, 30)** | (·, −197.7, 30) / same |
| g28_first_g55 (+rot) | `G55` / `G91 G28 Z0` | (−200, −200, 30) XYZ | (−300, −400, 60) [rot ✓] | (−400, −400, 60) | **(−200, −200, 30)** | same / same |
| **m6_after_g55** (+rot) | `G55` / `T2 M6` / `G0 X10` | (10, **0, 0**) YZ | (−300, −400, 60); rot (−200, −200, 30) | (−400, −400, 60) | **(0, 0, 0)** | (·, 0, 0) / (−200, −200, 30) ≠ |
| m61_after_g55 (+rot) | `G55` / `M61 Q2` / `G0 X10` | (10, 0, 0) YZ | same as above | (−400, −400, 60) | **(0, 0, 0)** | (·, 0, 0) / (−200, −200, 30) ≠ |
| **m6_first_g43** (+rot, +zero fixture), G43 Z10 | `T2 M6` / `G0 X10 Y10` | (10, 10, **0**) Z | (−100, −200, 20); rot/zero (0, 0, −10) | (0, 0, −10) | **(0, 0, 0)** | (·, ·, 0) / (0, 0, −10) ≠ |
| inch_m6_first_g43 (+rot) | `T2 M6` / `G0 X1 Y1` | (1, 1, 0) Z | (−2, −3, 0.5); rot (0, 0, −0.5) | (0, 0, −0.5) | **(0, 0, 0)** | (·, ·, 0) / (0, 0, −0.5) ≠ |
| m6_first_plain (+rot) | `T2 M6` / `G0 X10` | (10, 0, 0) YZ | (−100, −200, 30) [rot ✓] | (0, 0, 0) | **(0, 0, 0)** | same / same |
| m6_after_motion_g55 (+rot) | `G53 G0 Z0` / `G55` / `T2 M6` | (0, 0, 30) XY | (−100, −200, 30) [rot ✓] | (0, 0, 0) | **(0, 0, 0)** | same / same (later points: F9-R below) |
| f9_mday_g30_0 / _far (machine-day head) | `G53 G0 Z0` / `T13 M600` | (0, 0, 96.75) XY | (−238.5, −379.7, 96.75) | (0, 0, 0) | **(0, 0, 0)** | same / same |
| f9_g53z_only / f9_m600_first | `G53 G0 Z0` … / `T13 M600` first | (0, 0, 96.75) XY | (−238.5, −379.7, 96.75) | (0, 0, 0) | **(0, 0, 0)** | same / same |
| f9_g91_first / f9_g91_bare | `G91 G0 X5` | (5, 0, 0) XYZ | (−238.5, −379.7, 96.75) | (0, 0, 0) | **(0, 0, 0)** | same / same |
| f9_inch_g54 | inch, `G53 G0 Z0` | (0, 0, 1) XY | (−2, −3, 1) | (0, 0, 0) | **(0, 0, 0)** | same / same |
| f9_g43_start, G43 Z10 | `G53 G0 Z0` | (0, 0, 86.75) XY | (−238.5, −379.7, 86.75) | (0, 0, −10) | **(0, 0, −10)** | same / same |
| f9_g53z_rotary, f9_g53z_zero, g55_zero | rotary / zero fixtures | as f9_g53z_only / g55_first | (0, 0, 0) each | (0, 0, 0) each | **(0, 0, 0) each** | equal — equality controls |
| **comp_first_g55** (+rot), comp_first (+rot) | `G55` / `G41` / `G1 X10 Y10` / `G1 X50` (comp entry first) | (7.879, 12.121, ·) | (−300, −400, 60), rot (−200, −200, 30); comp_first (−100, −200, 30), rot (0, 0, 0) | (−400, −400, 60); (0, 0, 0) | **none; unb [X, Y, Z]** (today: no `start_unbound`) | not readable (queue) |
| comp_next_xyz_g55 (+rot) | the same, next block `G1 X50 Y50 Z-1` | (7.879, 12.121, 30), no axis "dependent" (the misread words) | (−300, −400, 60); rot (−200, −200, 30) | (−400, −400, 60) | **none; unb [X, Y, Z]** (today: none) | not readable (queue) |
| py_motion_first (+rot) | `M200` (Python remap: `execute('G0 X10')`) first | — | unb [X, Y, Z] (the body's reads, `position_read`) | unb | **unb [X, Y, Z]**, `start_believed` (0, 0, 0) | unchanged; pins the read's placement (M10) |
| g92_first (+rot) | `G92 X7` | — | unb [X, Y, Z] | unb | **unb [X, Y, Z]** | unchanged (E6) |
| rotated (Codex) | G54 R30 + G92, `G53 G0 Z0` | — | unb [X, Y] | unb | **unb [X, Y]** | unchanged |
| arc_first_g55 (+rot) | `G55` / `G91 G2 …` | — | unb [X, Y] | unb | **unb [X, Y]** | unchanged |
| m6tc_first_partial (+rot, +zero), m6tc_after_g55 (+rot) | TOOL_CHANGE_POSITION, (`G55` /) `T2 M6` / `G0 X10` | — | unb [X, Y, Z] | unb | **unb [X, Y, Z]** | unchanged |
| m6_quill_first_g55, m6_g30_first_g55 (+rot) | TOOL_CHANGE_QUILL_UP / _AT_G30, `G55` / `T2 M6` / `G0 X10` | the interpreter's own move (line −1) | unb [X, Y, Z] | unb | **unb [X, Y, Z]** | unchanged |
| tap_first_g55 (+rot) | `G55` / `M3` / `G33.1 Z-5` | — | unb [X, Y, Z] | unb | **unb [X, Y, Z]** | unchanged |
| no_motion_g55 (+rot) | `G55` / `M2` | — | none | none | none | no motion, no field |
| g43_line_then_x (+rot) | `G43.1 Z10` / `G0 X10` | (10, 0, −10) YZ | (−100, −200, 30); rot (0, 0, 0) | (0, 0, 0) | **(0, 0, 0)** | (·, 0, 0) / (0, 0, 0) |
| py_motion_first_bound (+rot) | `M200` (suite-bound Python remap: `execute('G0 X10')`) first | (10, 0, 0) YZ | (−100, −200, 30); rot (0, 0, 0) | (0, 0, 0) | **(0, 0, 0)** | (·, 0, 0) / (0, 0, 0) |
| twp_head_shape_rot | `G10 L2 P0 …` / `M6 T2 G43 H2` / `G0 X0 Y0 Z100` | (0, 0, 100), no axis dependent | (0, 400, 110) | — | **(0, 0, 80)** | — (all commanded) |

## What rule 1 changes on configs that are right today

R456's premise "the rotary config is right today and must stay unchanged"
holds EXCEPT in these rows; the same for zero fixtures (the in-tree frame):

Over the 85 plan cases and the 279 in-tree cases (zero fixtures; their rotary
ones `e_py_rotary_*`, `percent_rotary*` included), rule 1 against 4eda3892:

| Config | Cases | `start_believed` changes | `start_unbound` changes | First endpoint (client) |
|---|---|---|---|---|
| rotary, plan cases | 34 | 10: the 5 resync rows, the 3 comp-first cases, `m6tc_after_g55_rot` and `twp_head_shape_rot` (both without a dependent axis: unbound / all commanded) | 3: the comp-first cases → [X, Y, Z] | the 5 resync rows wrong today → right; the 3 comp-first cases right today at P (by coincidence), off target at Q, now no entry ("start not checked") |
| zero fixture, plan cases | 7 | 1: `m6_first_g43_zero` | 0 | wrong today → right (Z by the tool length) |
| zero fixture, in-tree corpus | 279 | 2: `e_no_interp` (unbound anyway), `m600_result` (G54 Z = 10, no dependent axis) | 0 | no other field changes |

So "rotary unchanged" (R456) holds except where an M6 / M61 (no tool-change
motion configured) runs before the first motion after a frame, offset or unit
change or under a G43 start, and where the first motion is a cutter-comp
entry. The rotary sync makes today's value the init-end physical start; the
points after the resync are not made of it.

## Out of P6-a (own package, with a visible-layer proof)

- **F9-L — the canon's `lo` before point 0.** The same read could also seed
  `lo` (machine 0 today on a config without the rotary sync). Where point 0 is
  an UNKNOWN move (a tool change at a TOOL_CHANGE_POSITION before it, a turned
  frame at it), `_unknown_move` takes `lo` (machine 0) as the block start, and
  the block-end re-establishment (gcode_canon.py:553–566) counts an axis the
  block never commanded as known: the next move is drawn, timed and swept as a
  known path from the believed start. Measured (probe mode `seed`):
  `m6tc_first_partial` (G54 ≠ 0, TOOL_CHANGE_POSITION, `T2 M6` / `G0 X10` /
  `G0 Z0` / `G0 Y20`) draws the Y move known (2.0 s from Y 0) today and three
  unknown-start points with the seed — its zero-fixture and rotary twins
  today; Codex's `rotated`; `tap_first_g55` (a rigid tap's point at machine
  0). Its mutations (no seed; seed after the point is stamped) are red there.
- **F9-R — a resync AFTER the first point.** The interpreter's position jumps
  where gcodemodule's `_pos_*` is stale (a frame, offset or unit change since
  the last motion, then M6/M61/G10 L0/probe): `G53 G0 Z0` / `G55` / `T2 M6` /
  `G0 X10` draws a move in Y and Z, Z even a KNOWN axis; `T1 M6 G43 H1` in ONE
  block (the M6 converts before the G43, interp_execute.cc:303–304; the
  resync restores the pre-G43 `_pos_z`) draws the next XY move ending at
  machine Z +10 — with `G43 H1` on its own line, machine 0. Proposal: the same
  read at every later motion; where `rotate_and_translate(current)` and `lo`
  disagree, that axis is unknown (`_to_stale`). Triage: below.
- **The comp queue beyond point 0** (`_dep_step` reads the queue's later
  block): named, not fixed.

## F9-R triage (does not block R457)

Static scan of every shipped `.ngc` (183 files under `examples/`,
`subroutines/`, `scripts/`, `lcnc-gateway/`): a frame / offset / unit change
followed by M6, M61 or G10 L0 with no motion between (G38 hits discarded: a
probe's own `STRAIGHT_PROBE` sets `_pos_*`, gcodemodule.cc:483), plus the
jump spy (`F9B_JUMPS`: at every motion after point 0,
`rotate_and_translate(current)` against `lo`) where the program runs on the
probe's configs:

- **The operator's machine-day head** (`the machine-day head (.ngc)`: `G53 G0 Z0` /
  `T13 M600` with the bundled `tool_touch_off.ngc`): no hit; spy: 0 jumps
  over 125 points (`f9_mday_g30_0`, `_far`); `f9_m600_first` 0. The routine's
  M6s follow motions with nothing changed between (G49 before its
  `G53 G1 Z0`, the M6 after its `G53` moves), its `T#5400 G43 H#5400` has no
  M6.
- **`T… M6 G43 H…` in ONE block**: 12 programs — the shipped
  `examples/sim_config/xyzabc6/twp_simple_example.ngc` and 11 parity-corpus
  / legacy fixtures (`scripts/parity_corpus/twp_{a_tilt,g683_tilted,
  g69_tail,a_define_tilted}.ngc`, their `twp_gantry/` copies +
  `twp_simple_example`, `parity_linear`, `legacy_sim/twp/demos/
  simple_example.ngc`). In all 12 it comes BEFORE the first motion (after
  `g10 l2 p0/p1 …`), and the next motion commands X, Y and Z: an F9-R0 shape
  (rule 1's), no dependent axis, so neither the drawn path nor the limit
  verdict changes; only `start_believed` does. Emulated on the probe's
  rotary config (`twp_head_shape_rot`, no G68.2 remaps): `start_believed`
  (0, 400, 110) today → (0, 0, 80), no dependent axis, 0 jumps. The parity
  corpora themselves need their configs: build item 3.
- **After point 0**: no hit in any shipped program; `examples/sim_config/
  xyzac5/demo.ngc` (M428/M429 removed: kins remaps the probe lacks) 0 jumps.
- The spy finds the synthetic shapes: `m6_after_motion_g55` (+rot) one jump
  of (200, 200, −30) mm, `m6_g43_one_block` one jump of +10 mm in Z,
  `m6_g43_two_blocks` none.

## Files touched

- `lcnc-gateway/gcode_canon.py`: `_begin_program` keeps the tool offset at the
  begin and no longer sets `start_lo`; one helper (the read) called in
  `straight_traverse`, `straight_feed` (= `straight_probe`), `rigid_tap` right
  after `_enter()` and in `arc_feed` at its top after `_ensure_reads()` +
  `_phase()` — before any read of `lo` — while `seq == 0` and the program has
  begun; the queue check; `_next_seq`'s `start_unbound` decision: "no read" →
  X, Y, Z. No change to `lo`, `_dep_step`, the worker's peel, the client or
  `PREVIEW_SCHEMA`.
- `lcnc-gateway/native_start_probe.py`: the cases below (a G54/G55 patch, the
  rotary twins), `test_start_dep_worker.py`.
- `scripts/gen_start_dep_payloads.py` + new fixtures
  `scripts/test_fixtures/start_dep_payloads/{g55_first,g55_first_rot,mday_head,m6_after_g55,m6_after_g55_rot,m6_first_g43_zero,inch_g43_g55,g20_g55,g43_line_then_x,py_motion_first_bound,comp_first_g55,comp_next_xyz_g55}.msgpack`
  (their `READ_SITES` entries), `startDepPayloads.test.ts`.
- The mock-page spec and the native-stage page case of v2's guards 3–4.
- `docs/architecture/scrub-and-run.md` (the start-dependent beginning: "the
  believed start is the interpreter's position at the first point, in that
  point's callback, re-based to the start tool offset; none from the comp
  queue") and the CLAUDE.md invariants line if it names the beginning.

## Guards ("red" = at 4eda3892 unless named)

Client chain (`startDepPayloads.test.ts` over the new native fixtures; the
first endpoint in machine joints, live at P AND at Q; the oracle is the
commanded axes, never the read):

1. **Codex's counter-case, 3-axis** `g55_first`: (310, 200, −30) / (310, 183,
   −23) — red at 4eda3892 and under the v2 read.
2. **Codex's counter-case, rotary** `g55_first_rot`: the same — GREEN at
   4eda3892, red under the v2 read: the guard that keeps a rotary config
   from getting worse.
3. **The resync rows** (F9-R0): `m6_after_g55`, `m6_after_g55_rot`,
   `m6_first_g43_zero` (+ the `_rot` twins in native form) — X-only /
   XY-only first blocks whose other axes stay at the live value; red at
   4eda3892 on BOTH configs and under Codex's physical-start value.
4. **The tool offset before point 0** (the re-base): `g43_line_then_x`
   (`G43.1 Z10` on its own line, then `G0 X10`) and `g43h_g55_move` (`G43 H1`
   in the first block): joint Z stays at the live Z; red when the re-base is
   dropped (M3) — measured: `g43_line_then_x` at P (110, 200, −20)
   and `g43h_g55_move` move Z under M3, (110, 200, −30) under v3. **The
   unit**: `g20_g55` (`G20 G55 G0 X1` on a mm machine): (325.4, 200, −30) /
   (325.4, 183, −23); red when the machine's unit replaces the
   interpreter's (M5) or the conversion is dropped (M4).
5. **The read's placement**: `py_motion_first_bound` (a suite-bound Python
   remap's motion is the program's first callback, line 0): an entry exists
   and its first endpoint moves X only; red when the read runs before the
   handler's begin decision (M10) — measured: under M10 `start_believed` is absent
   and the entry is lost (both configs).
6. **The comp queue**: `comp_first_g55`, `comp_next_xyz_g55`: no entry
   (`startUnbound` X, Y, Z); red at 4eda3892 (bound: Y shifted as dependent).
7. The machine-day head (`mday_head`): first endpoint (238.525, 379.696, 0),
   `cum[K+1]` 5.4515 s (today 13.555212 — the trace's figure).

Native, pytest (`test_start_dep_worker.py` over `native_start_probe.py`;
`start_believed` within 1e-9 relative):

8. The same cases' values, and: same block / preamble / O-call / unit
   (`g55_with_move`, `g55_preamble`, `ocall_g55`, `g20_g55`, `inch_g43_g55`,
   each with its rotary twin — 3-axis red, rotary green at 4eda3892, all red
   under v2; `inch_g43_start` (+rot): red at 4eda3892, green under v2);
   `comp_*`: no `start_believed`, `start_unbound` [X, Y, Z].
9. **Equality controls**: `g55_zero`, `f9_g53z_zero`, `f9_g53z_rotary`,
   `g43_start_g55_rot`, `rot_g92_to_g55_rot`, `g28_first_g55_rot` equal to
   4eda3892; the unbound cases (`g92_first` +rot, `rotated`, `arc_first_g55`
   +rot, the TOOL_CHANGE_POSITION / quill-up / G30 rows, `tap_first_g55`)
   keep `start_unbound`; **the whole in-tree corpus** unchanged except
   `start_believed` of `e_no_interp` (absent) and `m600_result` (corrected).
10. **The metamorphic corpus run** (heavy — merge gate): every
    `native_start_probe` case with all fixture rows moved by D = (100, 200,
    0): `start_believed` unchanged except the named absolute-write cases
    (expected values above), masks / unknown starts / `start_unbound`
    unchanged everywhere. Red at 4eda3892 in 267 cases.

Visible layer (as v2's guards 3–4, kept): the mock-page spec serves
`mday_head.msgpack` AND `g55_first.msgpack`; the tool tip at the entry
segment's end: machine X/Y unchanged / X 310 with Y, Z unchanged. The
native-stage page case on the VM's 3-axis sim (G54 ≠ 0; plus a `G55` first
line with G55 ≠ G54), owed before the machine update.

## Mutations (each must turn a guard red; run natively and through the client)

Native over the 85 plan cases (mutations M3–M10 over 84: the 3-axis
`twp_head_shape` refuses its A word) and through the client at both live
starts:

| Mutation | Native: `start_believed` / `start_unbound` move in | Client: cases wrong (either start) | Red guard |
|---|---|---|---|
| M1 `start_lo = self.lo` (4eda3892) | 53 / 6 | 42 | 1, 3, 4, 5, 6, 7, 8, 10 |
| M2 the v2 read (`_begin_program`) | 47 / 6 | 34 (`g55_first_rot` …) | 1, **2**, 3, 6, 8 |
| M3 no tool-offset re-base | 6 / 0 (`g43_first`, `g43h_g55_move`, `g43_line_then_x`, each +rot where present) | 4 (`g43_line_then_x`, `g43h_g55_move`, +rot) | 4 |
| M4 no unit conversion | 30 / 0 | 18 | 1, 2, 4, 8 |
| M5 the machine's unit, not the interpreter's | 2 / 0 (`g20_g55` +rot) | 2 (`g20_g55` +rot) | 4 |
| M6 no comp-queue check | 6 / 6 (the comp cases) | 6 | 6 |
| M7 fall back to `lo` when there is no read | 6 / 6 | 6 | 6 |
| M10 read before the handler's begin decision | 4 / 0 (`py_motion_first*`) | 2 (`py_motion_first_bound` +rot: entry lost) | 5 |

Every mutation of the read turns a CLIENT guard red (M3 and M10 too: an
offset change on its own line before an X-only first block, and a bound
Python remap's first motion).

## Build list (P6-a)

1. Rule 1 in `gcode_canon.py` (above); **one place decides which callbacks
   can record point 0**: derive it from gcodemodule — every canon function
   that reaches a Python motion method (`STRAIGHT_TRAVERSE`, `STRAIGHT_FEED`,
   `STRAIGHT_PROBE`, `ARC_FEED`, `RIGID_TAP`, `NURBS_FEED` via
   `STRAIGHT_FEED`; gcodemodule.cc:181–250, 479–506) — and pin it with a
   test that fails when the canon gains a recording method the helper does not
   cover; or fail closed: `_next_seq` at `seq == 0` without a read of this
   callback → no believed start, X, Y, Z unbound.
2. The native cases and guards above; the new fixtures and the client guards.
3. **Run the TWP and XYZAC parity corpora (`scripts/parity_corpus/`) today
   vs v3** and explain every changed `start_believed` and every newly unbound
   beginning (the TWP heads put `G10 L2 P0` and `m6 t3 g43 h3` before their
   first motion: F9-R0 shapes — see the triage).
4. `docs/architecture/scrub-and-run.md`, the merge record (beginnings checked
   before the update were checked along the wrong path; the resync rows bind
   differently on rotary and zero-fixture configs too).

## Risks and interactions

- **Payload.** Only `start_believed` moves (and disappears in the two "no
  read" cases; the comp cases also name `start_unbound`). Rotary configs:
  equal to 1 ulp (`rotate_and_translate(current)` vs the synced `lo`); guards
  compare with a tolerance, VP-I20's verify already does (`VERIFY_F32_REL`).
- **No believed start.** A comp-queue first point and no interpreter words:
  no `start_believed`, and both ship `start_unbound` X, Y, Z, so the bar says
  "start not checked" through VP-I84's existing path; `bindBeginning`'s "no
  assumed start → null" is never what names it. A comp-first program loses
  its (wrong) entry move.
- **VP-I20 verify.** The re-base keeps `start_believed` in the start tool
  basis, so it shifts with `tlo_start` like a point before the first row (the
  in-tree verify cases are unchanged: corpus run). After a resync before point
  0 the believed start no longer follows the seed (the points do not either);
  verify then reports a difference and publishes the fresh parse — as it
  already does today for such programs, whose M6 row carries the seed (code
  reading, `compare_preview_payloads` requires byte-equal TLO rows).
- **gcode.verify, pinned re-parse, identity gate, schema**: as v2 (same
  field, same worker path, no `PREVIEW_SCHEMA` bump, no publication survives
  a restart).
- **Performance**: one interpreter read per motion callback until point 0.
- **Operator-visible**: as v2, plus — programs with a `G5x` / `G20` / `G43` /
  `M6` before their first move bind their beginning differently, on rotary
  and zero-fixture configs too where an M6/M61 precedes the first move (the
  section above); comp-first programs show "start not checked".

## What was not verified

- **Code**: no product code; rule 1 ran as a monkeypatch inside the probe
  processes (`f9b_probe.py`'s `F9B_MODE` block), at the place specified.
- **LinuxCNC source**: `src/emc/rs274ngc/*`, `src/emc/task/{emccanon,emctask,
  emctaskmain,taskclass}.cc` and `src/emc/ini/initraj.cc` fetched from the
  v2.9.4 tag into `~/claude-work/bg/upstream-2.9.4/` (`SHA256SUMS`,
  `task_ini.SHA256SUMS`; its `sources.json` not updated); `initool.cc` does
  not exist at that tag. Debian's patches (installed 1:2.9.4-2+deb13u1) not
  compared. Every claim the guards rest on was also measured natively on the
  installed interpreter, except the controller side (emccanon), which is read
  only — no live LinuxCNC run.
- **The parity corpora** (TWP / XYZAC): not run (build item 3).
- **Lathe (G7 diameter mode), UVW, gantry**: not probed.
- **Browser and native-stage page**: not run (v2's guards 3–4 stay owed).

## Probe files (none committed)

`~/claude-work/p6/f9b/`: `make_probe.py` (builds `f9b_probe.py` from the
worktree's `native_start_probe.py`), `f9b_cases.py`, `test_p6_f9b_probe.py`
(runner; F9B_SET f9b | intree, F9B_SHIFT, F9B_MODES, F9B_JUMPS),
`analyze.py`, `shift_compare.py`, `p6probe.f9b.test.ts`; outputs in `out/`
(`table.md`, `client.md`, `client.json`, `meta.json`, per case and variant
`.json` with the spy logs and `.msgpack`; `out/intree/`, `out/intree_shift/`).
The rules 1 + 2 version of this section: `plan-p6a-v3.r1+r2.md`.

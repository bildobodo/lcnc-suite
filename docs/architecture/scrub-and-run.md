# Program scrub, run display, re-parses, M600 preview, start state

> Moved verbatim from `CLAUDE.md` on 2026-10-25 (the guide keeps a short form and points here).
> The entries record each rule with the reason and the review round that set it.

**Program scrub (offline dry run, stage 2 + unified-timeline phase 1)**: a
timeline bar overlaid on the 3D viewer (`ScrubBar.vue`, hosted in
ThreeViewer's overlay next to CameraPip) poses the articulated machine
model at any point of the loaded program without running it — drag or
play at a speed the Simulation tab sets in 1-2-5 steps (×0.1–×100). The timeline
axis is PROGRAM TIME (seconds; ×1 = real time; mm:ss readout): the parse
worker ships per-stream cumulative seconds (`feed_tcum`/`rapid_tcum` —
feeds from F with max(linear, rotary°) governing, rapids from
TRAJ/AXIS MAX_VELOCITY; also `rapid_rate`/`rot_rapid_rate` for the
client-built entry move) and the track merge diffs them per stream.
`timeBased: false` (no INI velocity / legacy payload) falls back to the
distance axis (1° ≙ 1 mm), honest not guessed. Tool-change events ride
the wire as `tool_change_lines` (canon M6 on a line of this file; the M600
routine's own M6 at its call line when that is the program's only one,
else none — `main_file_tool_changes`; see "M600 in the preview") and the
client unions them with a TEXT scan for
M6 / M600 / M601 lines (`viewer/toolChangeScan.ts`, tool from the T word
on or before the line; "T13 M600" had no mark) — a change line has no
motion, so its mark sits at the next line with one; info-blue ● marks +
the "T13 in 2:41" countdown.
**Phase 2 (run-time display)**: the bar stays visible during a REAL run
as a read-only surface — every control is dead via the existing gating,
a RUNNING chip marks the mode, the playhead follows `motion_line` on the
estimate axis (line granularity via lineCum; subroutine loops move it
backward legitimately), and the findings/tool marks become look-ahead
("next clash → L11", "T3 in 2:41" — the next-tool countdown, shown in
sim too). No motion verb lives on the timeline — cycle
start/pause/abort stay in their constant home (see
unified-timeline-design memory: unify display, not actuation).
Execution order is reconstructed by merging the
feed/rapid streams on per-point `feed_seq`/`rapid_seq` (global counter in
`gcode_canon.py` — line numbers can't order subroutine loops);
`previewWorker` builds the merged `scrubTrack` off-thread
(`viewer/scrubTrack.ts`, pure, unit-tested). The pose is derived per frame:
lerp adjacent program-space samples, program→joint-space via the same
`wcsTerms`/`programToMachine` as the part-frame preview (exported from
`viewer/partFrame.ts`), letters→joints via `viewer_init.axes`, then through
the SAME `applyState` compose path as live motion (null joint entries — UVW
— keep the live value). The transform is **RS274-exact and pinned by golden
tests** (`viewer/rs274.test.ts` — fixtures generated from LinuxCNC's own
`rs274.interpret.Translated.rotate_and_translate` by
`scripts/gen_rs274_wcs_fixtures.py`; Python twin
`TestRs274EffectiveOffset`): effective XY origin is `g5x + Rz(θ)·g92` (g92
applies BEFORE the G10 R rotation — a plain sum deviates when both are
active), and `wcs.tool` (live `stat.tool_offset`) makes the derived joints
TRUE joint-space (G43-inclusive) so `applyState` phase 3's marker shift
lands the tip on the path — pose, part-frame tip peel, and the collision
worker's tool-cylinder shift all subtract the same TLO back. `tool_offset`
is therefore a watched transform input everywhere WCS is (ScrubBar
`_wcsKey`, ThreeViewer preview refresh + sweep re-run). Scrubbing is an explicit **SIMULATION mode**
(`simMode.ts`, client-local like `busy`): the posed model is an
intentionally wrong display, so while active every machine-action gate is
closed (`permissions.ts` SIM_GATES — only `always`/`armed`/`setup` stay
open; `safety` is closed too, so Machine On requires a purposeful Exit
first). Entry requires armed (outer Gate) + machine OFF + interpreter
idle, via the bar's Simulate button (play and clash-jump also enter when
eligible); a warn `.simBanner` heads the viewer's top-left column
(`.viewerTop`, above the DRO card) the whole time.
Auto-exits: run start, program change, machine powered on by another
client, real joint motion (0.05-unit backstop — above servo dither).
While simulating: backplot recording is suspended (never fabricate motion
history), GcodePanel follows the scrub line, and
touch-off re-poses immediately (WCS watcher). A stale pre-seq cached
payload yields `scrubTrack: null` — the bar simply doesn't offer itself
(unchecked ≠ broken). Text-panel line: `displayLineForPoint` is the ONE
gating rule for scrub AND run playhead — the point's own line only when
per-point trust allows (motion in called subs/remaps carries THAT file's
colliding linenos, W2 P6), else the sub span's CALL/trigger line (W4,
schema 7: `(WEBUI_SUB=name CALLER=g53.3)` markers; the interp never fires
next_line for o-call/remap trigger lines, but its own state names them —
since Codex R107 the span takes the main-file line the interpreter ran at
its start marker, per occurrence (`gcode_canon.main_line`, below), the
unique-site scan in `attribute_sub_callers` its cross-check and its
fallback), else null + the "(name)" chip. Above it sits `resolveCurrentLine` (W5, the display
spec in docs/decisions.md wave 5): live `motion_line` — a bare
motion-queue id with NO file identity — may display only when the
track's per-line trust set vouches for it (the off-path approach
rescue) and NEVER at idle (post-run it holds the last executed id: the
stale blank-line-8 class); the track's terminal vertex displays the
text-scanned unique M2/M30 line ("end" readout). While a marked o-call
span executes, GcodePanel renders the called file's lines INDENTED
under the call line (`subRows.ts` row model, `GET /subfile` source,
expansion only when the call line's text IS `o<name> call` — remap
wrappers and nested spans never expand).

**Run-time state freshness + the sim-parity gate (W6)**: the preview
depends on four run-time state inputs, each freshness-guarded — WCS
table (per-epoch terms), tool length (TLO-drift auto-reparse), XYZ
start (entry move), and rotary pose: the worker emits its schema-5
rotary seed as an `__ABCSEED__` stderr line and the gateway's idle
drift edge (`evaluate_rotary_drift`, 0.01°) auto-reparses when the live
pose leaves it (a run parking the table tilted made the cached preview
orient from a pose the next run never visits — the arc-vs-plunge
class). A parse IN FLIGHT whose rotary seed the live pose has left is
cancelled at once, every tick, no settle (`inflight_doomed_reason` — it
used to run through the whole jog); the RESTART waits until the rotary
pose has held still 1 s (`rotary_hold_update`/`rotary_hold_settled`, the
schedule gate in the poller), and linear motion never defers or dooms a
parse — the payload does not depend on where X/Y/Z sit. Acceptance standard: `scripts/sim_parity.py gate --corpus
scripts/parity_corpus/<config>.json` (run by `test_suite.py live-twp`, which
copies the corpus into the program folder: each program is loaded through
the gateway's `load_file`, never a bare `program_open` — docs/testing.md) — per run it saves the RUNNING
gateway's cached payload, captures the real run (twp_parity
sample_run; truth file opens with a context header), replays the
payload through the ACTUAL client chain (`lcnc-webui/scripts/
simDump.ts` via vite-node — decodePreviewStreams/buildEntryTrack are
single pure implementations shared with the browser), and gates on
bidirectional 6D joint-space path deviation (deg ≙ mm; wall-clock never
compared; per-program tolerance absorbs G64 blending).

**Mid-run tool-table re-parse (operator 2026-09-29, Codex R40)**: every
drift edge above is idle-gated because the worker seeds its start state
from the LIVE machine (fixture, WCS patches, parameter file, kins, rotary
pose, applied offset, spindle tool) — mid-run that is the running
program's state, and a parse from it describes the program wrongly. But a
program that measures its own tool (`T13 M600` → G10 L1) cuts right after,
the interpreter is not idle again before M2, and the preview stayed muted
on the old length for the whole run. ONE edge re-parses DURING a run:
`midrun_table_gate_open` (AUTO mode, interpreter busy, a published ctx for
the loaded file, not `pin_unsupported`, 2 s debounce) with
`evaluate_tlo_drift(table_only=True)` — only `table_mtime` / `table_row`;
the run's own G43 / M6 are no drift. The parse is PINNED
(`BulkPipeline.pinned_ctx`): the published parse's ctx verbatim (fixture
index, WCS var patches, kins type/frame) + its PARAMETER BASIS (the var
file's raw text and G92 the worker reported in `__PARAMS__` → `param_text`
/ `g92_offset`: G92, G28/G30 and every numbered parameter the program reads
— MR-I02) + its rotary seed (`rotary_pose`) + its tool seed (`seed_tool`):
the worker puts the START tool's row, from the table NOW, into the
interpreter's spindle pocket (`seeded_spindle_row` — a `G43` without H read
the live pocket, MR-I01) and reports it back in `__TLO__`
(`seeded_tool_meta`). A random toolchanger cannot be pinned faithfully: the
worker exits `PIN_UNSUPPORTED_EXIT`, the pipeline latches `pin_unsupported`
and the preview stays stale-marked until idle. Read live on purpose: the
tool TABLE (the reason for the parse), the operator's run option block
delete, and the configuration (units, axis mask, joint limits, INI, program
and sub files). So the preview shows the program as the machine executes
it: from the same start, with the table it now holds. Niced
(`PINNED_NICE` 19, the worker's first act — a priority, no guarantee for
real-time, memory or I/O latency; SCHED_IDLE is weaker still), 3× the
timeout, its duration never enters the idle estimate, a pinned in-flight
parse is never doomed by the (program's) rotary motion; a second
measurement during it is picked up by one follow-up parse (the worker reads
the table's file time BEFORE its STAT read). A pinned parse still running
when its run ENDS — the interpreter idle again: a limit refusal right after
the measurement, an abort, M2 — is cancelled at once (`pinned_parse_outlived`,
`gcode.reparse_superseded` reason `run_ended`; operator 2026-10-20: it ran
14 s for a run stopped 1.7 s after it began, then the idle edge parsed
again), and the idle edges decide — one parse. The published ctx never
carries a verify parse's temp file (`verify_against`): a pinned parse copies
it and compared against a file already removed. After the run the idle edge
re-parses for the table and the spindle tool (the program's M6:
`tool_loaded`), and VERIFIES a changed start tool state (below). The browser: a publish during a run clears the collision findings (the earlier verdict stays named); a pinned parse made for the run is checked during it ("Check during a run" below), anything else is held while the interpreter runs and starts once it is idle again (`_colHeldByRun`, MR-I03). Traces `gcode.reparse_table_midrun`,
`pinned: true` on `spawn_start` / `publish`, `gcode.pinned_unsupported`;
banner reason "tool measured (program running)". Tests: `native_pinned_probe.py`
(the real worker + native interpreter, synthetic STAT) behind
`test_pinned_worker.py`.

**Check during a run (collision plan step 3, last part; plan
`docs/reviews/restpruefung-lauf.plan.md` Fassung 4, Codex R112–R115)**: a
mid-run tool-table re-parse is CHECKED during the run — first provisionally
from the machine's line, then in full — instead of waiting for idle. Gateway:
`_cmd_blocking` takes a `run_basis` for AUTO_RUN / a first AUTO_STEP from idle
BEFORE the write (a fresh poll; a paused step and a resume continue the run):
`run_id`, state sending → sent / unsent (a failed or cancelled write is no
run; a start whose poll or capture fails takes an UNVERIFIED basis without
context or start — never the last run's record, Codex R116 VP-I67 — and still
goes out), file, source, version, `start` (the status's own fields:
`status_runtime.spindle_tool_dims`, the fixture table copied), the published
start context copied whole (server-side only) with its `ctx_digest`,
`tool_basis_rev` and `verified` — `BulkPipeline.run_start_check` compares the
controller now with the published start (fixture and table, G92, kins, rotary
seed, tool start) and evaluates every drift edge without debounce (tool table,
WCS snapshot, soft-limit window, the toolsetter book `_ts_open_drift`); what
cannot be compared is not verified. A pinned parse during a verified, sent run
of the program is built from the run's context (`_run_for_pin`), never from a
publication made since (R114), and names the run (`for_run`) only when the
built context has the run's digest, checked again at the publish with the
run's text and the pipeline's basis revision. `tool_basis_rev` counts every
change of the tool basis (a verify without a new version too). Every
publication says where it comes from (`published_origin`: version, file,
source, reason, pinned, for_run, the table read, basis revision) on
`viewer_gcode_ready` and as `preview_origin` in every status envelope, the run
basis (without its context) as `run_basis`; both keys are pinned on both sides
by `scripts/test_fixtures/run_check_wire.json`. Client: statusStore mirrors
both (`runBasis.ts` parses them); every sweep is built from ONE `CheckBasis`
(`viewer/checkBasis.ts` — idle the live state at the check's start, in a run
`run_basis.start`, never the first run frame seen); while a run is in progress
(run_basis sent, AUTO, the interpreter busy — judged on the same status frame
as the change) the program's own G92 / G43.1 / M6 keep the findings, and at
the run's end a kept result whose basis is not the state now is re-checked. A
preview published in a run that is not admitted names the earlier verdict
only ("Earlier preview: 2 collisions"). `admitRunCheck` (pure) admits a check
during the run only for the pinned parse made for exactly this run (version on
screen, file and text the run's, for_run = the run's id / digest / basis
revision, the basis not moved since, the start verified, the run going on). It
runs the RANGE sweep (`CollisionOptions.range`, see "Collision sweep") from
the run watcher's attached segment start (`viewer/runPlayhead.ts`, read once
when planning), shows it ("Run check · tool table updated", "… from L7
(provisional)", the band from the start, the boundary contacts in the "?"),
then the full sweep from 0 on the same basis replaces it ("· checked in full";
never "measured"). While the full one runs, the band, the star and the words
are the SHOWN provisional result's own — where it stopped (", stopped at
60 %"), whether certified (Codex R116 VP-I68); every boundary contact is named
in the "?" with the lines it stays on provisionally, and its boundary episodes
reach the code panel as provisional marks (`contactView.lineMark`: a line's
contact over a provisional one; VP-I69). A
worker that asks for the bodies (`needBodies`) gets the SAME request again —
basis, range, run and whether the result on screen stays (`_colPendingRun`,
VP-I70). A new publication, another basis revision, another run, a
lost connection and idle discard it; idle starts the full check. Load: during
a run at most two workers and 20 ms slices (`sliceMs`), a decoding payload
holds the sweep (`previewDecoding`, worker hold "decode"), the run's own
rotary motion parks nothing. The browser-PC measurement (status frame age
p95 < 50 ms, heartbeat gap p99 < 300 ms) on the operator's Mac — which hosts
the VM, no separate PC — is done (2026-10-23, two full runs, Codex R188/R189;
`~/claude-work/bpc`, `drive2.py` / `bpc2.py report`): the run check's overlap
with a pinned parse proven, the parse supersede met, age (an upper bound) p95
36 ms in every phase but eight G54 offset changes in 30 s on the 600 000-line
program (p95 58 / 68 ms — each change restarts the page's check of the whole
track and re-bakes the path: OPEN as its own product item, VP188-02, the target
not relaxed), key input p95 ≤ 16 ms, the HAL watchdog's receipt < 201 ms in
every phase, one parse worker at a time. A change of the ACTIVE fixture alone
raises no re-parse (no drift edge reads the index; the WCS edge compares the
table) — the run's S phase toggles G54 Z by `G10 L2`. Owed: the acceptance on
the machine PC and the live M600 run. The instruments: the page's 3 s `browser.viewer.perf` rows
carry fixed-bin histograms that POOL into a phase's quantiles (`viewerPerf.binOf`
— a window's p95 never pools): `apply_h` (applyState's own time), `gap_h` (the
cadence), `age_h` (a status frame's socket receipt in the WS worker — stamped
`rx` on the global clock, timeOrigin + now — until the applyState that shows
it or a newer one; the receipt TRAVELS with the buffered status: the store
keeps the oldest of a flush (`statusReceiptOf`), the viewer the oldest of the
flushes it folds into one apply (`notePendingReceipt`) — an apply of an older
frame never takes the receipt of one still in the store's batch, Codex R182
VP182-01; the viewer's first apply is not aged; gateway → socket only bounded
by `rt_net_h`, the heartbeat round trip timed IN THE WORKER — its send stamp,
the answering frame's receipt — less the gateway's hold, paired by the
heartbeat's own number (`{"cmd":"heartbeat","seq":N}`, echoed by the gateway
as `timing.hb_seq`); an answer naming no heartbeat sent here is `rt_invalid`,
VP182-02),
`in_delay_h` (a key / pointer press to its
first listener; with Event Timing `ev_*`, the presses ≥ 16 ms to the next
paint), and the page's own memory (`mem_path_cpu/gpu`, `mem_contacts`,
`mem_contact_views` — Firefox has no heap number), `vis_changes` (the
window's visibility changes); the collision sweep events carry their request
`id` and `run_gen`, and the status store reports the gateway's parse in flight
as the page saw it (`preview.parse_seen` on / off, by its `job`, with the
frame's socket receipt — information only); every parse's trace events name
its `job` and spawn and publish the start `basis` (the context digest with the
drift inputs), so a supersede is proven by id. The overlap of a check during
a run with a pinned parse is proven from the ORDER of events (Codex R185,
R186) — no clock of the VM against the page's, none of one browser context
against another: the worker stamps `time.monotonic_ns()` right around
`parse(ctx)` (`__PARSE_T0__` / `__PARSE_T1__` → `gcode.parse_span`, by job, a
parse cut short without an end); the gateway's heartbeat answer carries
`g_mono_ms` (its CLOCK_MONOTONIC after the heartbeat's receipt, before the
answer's send) and `g_pid`; the page issues a witness TICK after each answer
it handled (`viewerPerf` → the viewer posts it to a check during a run; the
pool hands it to every shard), a real slice that BEGAN after a tick says it
after it ENDED (`{id, witness: {shard, gen, tick}}`, the page's
`collision.sweep_witness` numbered `n`), the page hands the word to the WS
worker, and every heartbeat it sends after carries the highest (`dt`, `dn`);
`hb_pairs` holds `{seq, hs, hr, g, pid, ta, dt, dn}`. Two heartbeats whose g
lie inside a parse, B carrying a word for a tick after A's answer: that slice
ran inside the parse. The status AGE puts the WS worker's receipt on the
page's clock through a two-way exchange a heartbeat (`{type: "clock"}`: θ =
worker − page ∈ [w − p1, w − p0] ± 4 ms, intersected per worker instance, a
contradiction starts anew — `clk_*`), at its earliest time (an upper bound);
without a relation a receipt is not aged (`age_unbound`). Main-thread SPANS
(VP188-02 step 0, plan `docs/reviews/basiswechsel-last.plan.md`): `viewerPerf.timeSpan`
times a fixed list of synchronous work an offset change sets off —
`col_copy` / `col_post` (a check's request and its post), `col_cancel`,
`path_reply` (the part-frame reply with `toolpath.apply`), `path_programmed`,
`pf_load`, `entry_track` — per window `span_<name>: {n, sum, max}`, a span
inside another one as `nested_*` (never in the outer sum); the report pools
them per phase (`main_thread`). The check's request transfers every track
column it copies, none cloned twice (`viewer/colTrackCopy.ts`, N1;
`getCollisionRequestMeta` says copies / transferred / detached). The S run
after it still missed the age target (p95 60 ms): the dominant cost was the
path RE-BAKE per offset change (`path_reply` 8 × mean 73 / max 113 ms), the
check ~5 ms. E2 (operator's choice, plan Fassung 4, Codex R193/R194): while the
gateway re-parses the loaded program the re-bake is HELD (`viewer/bakeHold.ts`,
pure: free → parsing ↔ after_parse 6 s → loading 20 s → free at the adoption,
whose own bake uses the LIVE offsets; ending without an adoption — a window,
THIS decode's failure `previewDecodeFailure` (never the mixed
`previewLoadError`), the connection, a run, the simulation — bakes ONCE when a
change was held; another program ends it without). Admitted at every
`preview_refresh` and whenever the admission's reason changes (`_holdAdmission`:
connected, the interpreter KNOWN idle from the status — an AUTO run without a
run basis, an MDI, an unknown state hold nothing and end a hold at once, Codex
R195 VP-I132 —, no simulation, the displayed program); only a path that
follows the offsets (`_pfScheduleWcsRefresh`'s own criterion,
`pathBasis.bakeFollowsOffsets`) ever ASKS to bake. The viewer's teardown drops
the hold, its window's timer and held replies without a catch-up (VP-I133).
E1 (plan Fassung 5 3e, Codex R197): two S runs after E2 still missed the target
(p95 80 / 62 ms) with frames missing at low timer lateness; a separating run
(`drive2.py --touch`: a new file time — the gateway's parse churn, no restart
on the page) met it (p95 36), so the COLLISION CHECK waits at the SAME hold:
its re-check (`_colScheduleAuto`, asked at the 400 ms timer's expiry) is NOTED
in a hold (`checkHeld`, apart from the bake's `held`) and asked again ONCE on
an end without an adoption (an adoption schedules the new version's own
check); a running check PAUSES through the worker hold `reparse` (independent
of camera / hidden / decode), sent only on the free ↔ held edges, posted to a
parked check too, and kept by the worker through a park, the pool, its fall
back and a lost parked run — a continue under the hold computes nothing. Its
admission has no path scope since E1: the check follows the offsets for every
program.
The DRAWN path has its own state (`viewer/pathBasis.ts`, VP193-01): every bake
request carries the key of what it bakes with (revision, display mode,
`_pfWcs()`, the used table rows) — request, anchor and key from one snapshot —,
`drawnKey` is set only when a path is APPLIED (`toolpath.apply` now says
whether it did; a scene clear drops it), `wantKey` is the adopted preview at the
live values, renewed once per status frame; `pathStaleNow` adds
`pathBehind(drawn, want)` beside the parse-basis reasons: an adoption whose
part-frame reply is still out, or a change back to the preview's basis while
the drawn path stands elsewhere, stays muted until the matching path is drawn.
Any `applyGcode` consumes a pending 300 ms re-bake. The WANTED display is decided at every `applyGcode` (`_wantMode`: the part frame where the preview mode and payload ask for it) and never changed by a fallback: a programmed path drawn because the part-frame transform failed (the reply's error, a missing anchor, the worker's onerror, the post's own catch) is drawn and named in `drawnKey` (mode programmed) and stays MUTED until the part frame is drawn again. `__viewerDiag.getPathBasis`
({drawn, want, behind, stale, hold, held, checkHeld, mode, admission}),
`getCollisionActivity` ({starts, busy, resumable, result}),
`holdPartFrameReplies` / `releasePartFrameReplies`, `setBakeDebounceMs`, `failNextPartFrameReply` (seams);
`bakeHold.test.ts`, `pathBasis.test.ts`, `e2e/bake-hold.viewer.spec.ts` (A→B→A
with the gap and the loading, a reply out after the adoption, a pre-hold reply
after a held change, the windows, THIS decode's failure, the run before and
during a hold, the connection, the consumed timer, the programmed scope, a failed part bake, a scene rebuild,
the teardown, the controller's idle; E1: the paused check, no start in the hold, ONE at the adoption at the live
offsets, the gap's edges, the catch-up after a parse without publication, a run in the hold, a check parked by a
rotary jog under the hold, the help line), `collisionWorker.test.ts` (the `reparse` hold through every owner).
Tests:
`test_bulk_pipeline.TestRunBinding`, `test_command_dispatch` (run basis),
`checkBasis.test.ts`, `collisionRange.test.ts`, `collisionRangeOracle.test.ts`,
`contactView.test.ts`, `collisions.viewer.spec` (plan 1c–4; R116: a tap on
the page's collision worker answers a request with `needBodies`, lays fields
over the provisional result and holds the full one's).

**M600 in the preview (collision plan step 3, Codex R102–R104, plan
`docs/reviews/m600-preview.plan.md` Fassung 3)**: the bundled
`tool_touch_off.ngc` runs in the preview (`#<_task> EQ 0`) — it used to be
skipped whole (`o<400> if [#<_task> EQ 1]`): no M6, no positioning moves, the
old tool on. The positioning is the same code in both; preview-only blocks
`o<500>`–`o<540>` guard what a preview cannot reproduce (the log file, M50,
M00/M01, and the two probes). The preview's G38 never trips (full travel,
`#5070 = 0`, measured), so o<520>/o<530> move to the point the tool's TABLE
length trips at (`#3102 + L`, + `#3115` for the edge finder) with the probe
feeds and set `#5061`–`#5069` from `#5420`–`#5428` there, before the retract,
`#5070 = 1` — the routine's own length formula gives L, G10 L1 / G43 H apply
it; `(WEBUI_TOOLLEN_TABLE)` before them pairs with that G43 only (canon
`toollen_events`, wire `toollen_table`: "65.040 mm from the table (assumed)",
never "measured"). Only where the machine's probe would trip there too
(o<510>): a known length, `#3102 ≤ 0`, the trip strictly inside the clamped
fast travel, positive probe feed and retract, a slow probe ending inside the
Z limit (motion refuses a probe END outside, command.c). Else the routine
stops at the probe's start with `(WEBUI_PROBE_UNPREDICTED=<reason>)` — canon
`probe_events`, wire `probe_unpredicted` [seq, tool, reason, line]: from there
EVERY axis is unknown to the program's end (`_frame_unknown`, so every later
motion is a zero-length unknown-start endpoint: no path, time, collision or
limit check — the worker skips them in every limit check; the sweep's note,
the Sim tab's summary "*" and "?", the bar's time "+", the stats rows and the
tool-change row say why, `viewer/probeStop.ts`). Each measurement event
carries the verified MAIN-file call line it belongs to (the rows' 4th
element, `main_file_event_lines` — the same walk as the tool changes; 0 when
not verified; the interpreter's own word since Codex R107, so two call
sites each get theirs): the Sim tab notes a length or a stop on THAT call's
row of THAT tool only (`m600ToolNotes`); one without a verified line, or a
line whose runs differ (a loop), is named in general — Program Stats' "Tool
Lengths" lists every measurement, the summary's "?" counts them (Codex R105
VP-I63: a per-tool note put a later stop on an earlier success and on an
ordinary M6 of the number). A first drawn point after a stop gets no entry
move (`prependEntry`; VP-I62). The task path is pinned to
the routine before the change as a control structure
(`test_tool_touch_off_paths.py`, `scripts/test_fixtures/tool_touch_off.before_preview.ngc`).
`(WEBUI_SUB_END)` precedes every `return` (a return skips the endsub's
marker: the program after it was taken for the call). The routine's M6 is a
canon tool change on the SUB's line: `main_file_tool_changes` ships it at
the verified call line (`CALLER=m600` / `m601` on the wrappers' markers),
else none; an M6 outside every marked span — an unmarked remap body's, a
called file's — at the main-file line the interpreter ran.

WHERE A CALLBACK COMES FROM (Codex R107, measured natively on 2.9.4):
gcode.parse runs LinuxCNC's interpreter in the worker, and its Python face
`interpreter` (built into gcode.so, importable while a parse runs) is that
interpreter's state at every canon callback — `call_level`, `remap_level`,
`filename`, `sequence_number`, the remapped codes running
(`blocks[1..remap_level].executing_remap.name`, "M200", "M600") and each
calling frame's file and the BYTE after the line it called from
(`sub_context[k].position`). next_line fires only when the sequence number
changes — a body line numbered like the main line before it reports
nothing (Codex R107 VP-I61) — so the canon asks the interpreter instead
(`gcode_canon.main_line`: its current line where the main file runs, an
inline or M98 sub's own line too, else the line the deepest main-file frame
called from — a remap trigger, an o-call or M98 line; per occurrence, a
loop's line each time; `%`, CRLF and UTF-8 pinned): the sub spans' call
lines (above), the tool changes, the position-write walk and the
callback-caught writes (below: a remap body's G92 on ITS line 2 was taken
for the main file's line 2, and a body's high numbers ran the walk ahead
of the main file — Codex R107) and a foreign remap's start. Without the
module (`__INTERP__ unavailable`, trace `gcode.interp_state_unavailable`)
every one falls back to the text and a foreign remap stops the preview from
the program's start. Tests: `TestCallLines` (native: another remap's body,
a called file, a loop, an inline and an M98 sub, a `%` CRLF file),
`TestCallerAttribution` (an interpreter double). A program tool without a length (or a row) has an unknown BODY
(`tloEvents.unknownProgramTools`): while it is in the spindle the sweep skips
the tool's own pairs (the machine's are checked), a contact of the tool
restarts after such a stretch, no refinement walks into it — it used to
wear a 60 mm stub. The TOOLSETTER BASIS (plan section 2): the values the
routine reads are the INTERPRETER's; the gateway books them per key
(`_ts_basis`: applied per `_apply_probe_vars` chunk that ended RCS_DONE,
unknown for one that failed / timed out / was cut short, read by a confirmed
read — a synch RCS_DONE (`_synch_interp_params`, see G30) + a new inode, save_parameters writes every
line from the interpreter — assumed from the file at the process's start and
BEFORE any MDI line or AUTO run / step / resume that may write it —
`_cmd_blocking`, the one place every start passes, so neither a cancel nor a
timeout after the write skips it; Codex R105 VP-I60). The parse
ctx carries `toolsetter_ctx` (confirmed values patched into the worker's
parameter copy, #3116 = 0); unknown or never-stored values set
`#<_webui_toolsetter_stop>` by initcode — the routine returns at once,
named from its start. An unconfirmed basis is read back once per version
while a program that runs the routine is loaded (idle, nothing in flight; an
abort cancels it); a change re-parses it (reason `toolsetter`). An M600 /
M601 remap that is not the suite's (`foreign_m600_codes`) is unknown from
the first callback it runs in — the interpreter's remap stack names it,
before anything its body records (Codex R107 VP-I61: its first move was
swept) — and the text adds what the run may do where the preview does not
(a body's branch on a run's input): in text order from the first main-file
line that may call it, its own or another remap's (that remap's body's
moves before the call too), else from the program's start — and from the
start whenever the program calls another file (M98, an o-word of no sub
defined in it), which may run it. What a text MAY write or call is read the
interpreter's way by ONE word reader (`gateway_util.nc_block_norm`: comments
out, whitespace nowhere, a value a number with a sign, `[…]`, a parameter
or a function): `toolsetter_assigned_keys` (`#3 0 0 9=`, `#+3009=`,
`#3009.0=`; a target it does not settle — `##1=`, `#[…]=` — or a line it
cannot read is "any"), `m_code_lines` (`T2M600`, `M+600`; `M[600]`, `M#1`
are candidates), the M98 / M99 flow test (`M[98]` is a call) and the call
sites of `attribute_sub_callers` (`T2M600`, `N5 o <x> c a l l`; a line that
MAY call it leaves a single site unclaimed — the regex missed `T2M600` and
put two calls on the other line, found with VP-I61; so does a line whose
remapped word's body may run the span's marker, `RemapEnv.marks` — a body
with `o<m600> call` makes an m600 span no M600 wrote, Codex R107). A sign
before a value that is no number is unary, recursively (`G-[-10]` and
`G--10` are G10, `M-#1` with #1 = −600 is M600, natively — Codex R107
VP-I64): the reader reads it exactly through signs, and the prefilters let
any run of signs through. Which spellings the
interpreter takes is pinned natively (`scripts/test_fixtures/nc_spellings.json`,
`TestNcSpellings`): a literal reads as a code within 1e-4 (`M599.99999` is
M600, `G91.99999` is G92, `L1.99999` is L2), so every text PREFILTER that
skips a line by its digits accepts the code's integer part or the one below
(`_near_int_parts`, `_POSWRITE_CANDIDATE_RE`, `_G10_CANDIDATE_RE` — proven over
the near forms by `TestNearLiterals`), and `position_write_lines` /
`wcs_rewrite_targets` decide on the reader's words (`GABS[92]` is G92, `G10
L+20 P1` writes G54). A remapped code runs a body the line does not show
(Codex R106): `RemapEnv` (the configured REMAPs, read per MDI by the gateway
and per parse by the worker) answers per code what its body may write and
which remaps it may invoke — every file of the body's name on the path (INI
folder, PROGRAM_PREFIX, SUBROUTINE_PATH), followed through its o-calls and
remapped words; `python=` / `prolog=` / `epilog=`, a missing or unreadable
body, an M98, an unsettled target are "any"; an M whose value the text does
not settle reaches every remapped M (without a P word it is no M98 — the
interpreter refuses that, natively). `toolsetter_assigned_keys` adds the body
writes; the worker's foreign-M600 candidates add every line that may reach
it through another remap (`remap_reach_lines`); an INI the gateway cannot read
makes every line a writer. The shipped configs: M600 writes no basis key on
the 3-axis and XYZAC profiles; on the TWP profile `M#<spindle_stop_m>` may be
one of its python remaps, so every M600 start books the basis assumed until
the read-back (`TestShippedRemapsWriteNoBasisKey`). Named limits:
`#5064`–`#5066` are copied without the wrapped-rotary fold; another writer of
the interpreter (a second GUI, halui) is not seen; a mid-run measurement's
rest check is its own later plan.
THE PROBE'S BRAKING RANGE (plan `docs/reviews/parity-ef.plan.md` F,
Codex R122–R125): LinuxCNC stores the feedback position at the trip
(`control.c` `process_probe_inputs`: `probedPos = carte_pos_fb`, then
`tpAbort`) and brakes along the probe line, so the machine stops BELOW the
trip point P (2.13 mm at F2000 on the XYZAC sim). The preview branch goes
on past P by the MODELED distance h = v·t + v²/a — v the probe feed capped by
(1 − `OFFSET_AV_RATIO`) · `[AXIS_Z] MAX_VELOCITY` and `[TRAJ]
MAX_LINEAR_VELOCITY`, a the same share of `MAX_ACCELERATION` (v²/a is
v²/(2·a/2): a parabolic blend halves the acceleration, `tc.c`
`tcGetOverallMaxAccel`; the probes follow a collinear move or a reversal, so
no kink reduction — text-guarded), t four servo periods (an ideal probe input:
up to two until motion reads it and stores P, two more until the trajectory
brakes — measured on the XYZAC sim, `viewer-palette-fest.r127.f5.txt` and `viewer-palette-fest.r128.f5.txt`; with two
the model fell short by the read delay in every G64 case) — never past the
move's commanded end; the routine's own retract starts
there and a preview leg climbs to P + retract: the hull H = [P − h, P + r]
every stop and retract lies in (only Z moves between the probes and the
drive-free G53 Z0 — text-guarded). `#5061…#5070` and the length stay at P.
On the wire `probe_bands` [seq_start, seq_end, tool, line] (the segments
inside, every vertex a decimation anchor) and `probe_notes` [seq, tool,
reason, line] (`retract` inside the range, a possible `slow_limit`,
`brake_unknown` without the INI values). The client: track `band` (the range
changes NO contact state — no onset, no separation: a possible feed contact
must not make a later rapid a benign retract, nor a later certain hit its
continuation; its touches are `possible` records — a certain contact begun
before continues on them, a certain sample upgrades a record, a possible one
never feeds the re-entry rule; the range's end pose, the first sample of the
segment after it, does not count as that line's sample — Codex R126 VP-I74;
the move after the range rises to machine Z0, text-guarded, so the poses
past its end vertex are real) and `cond` (every point after a trip point): the check's notes say the range is modeled, not
certified, and "After the measurement at L7, this path assumes the table
length and the modeled successful probe sequence. Probe timing and the
resulting tool offset are not verified" — NO delay number (a program may
compute or branch on the measured value, Codex R124) — so every program with
a predicted measurement reads "Clear*", on the sim too; the Sim tab's rows
after a trip point carry "conditional — after the measurement at L7"; the
measurement's warnings stand in Program Stats too, per run in execution order
(VP-I75); an external Z offset at the check's basis — enabled, a value left,
or not read (never an "off" nobody read) — is named for the range and the path
after it (`CheckBasis.eoffsetZ/eoffsetEnabled`, `run_basis.start.eoffset_*`,
VP-I76). The
parity gate checks COVERAGE there: truth→sim over the whole path, sim→truth
without the range's samples (simDump `band`), the hull's reach past the
truth reported apart (`scripts/test_parity_compare.py`). Named: no probe
chain is admitted (a real input's latency shortens the measured length and
deepens the stop — a machine/probe contract is a later step); the range's
time is estimated; G38 outside the routine is unchanged. Tests: `test_m600_preview_worker.py`
(native, `native_start_probe.py` with the shipped routine and a tool data
mmap — libtooldata needs 1001 comment pointers — and a check that the
preview never writes it), `test_toolsetter_basis.py`,
`toolChangePayloads.test.ts` (the native payloads through decode, track and
sweep), `probeStop.test.ts`, `sim-panel.viewer.spec`; the braking range:
`TestBrakingRange`, `test_tool_touch_off_paths.py` (only Z inside it, collinear
approach / reversal), `collision.test.ts` ("a probe's braking range"),
`simRows.test.ts`, `previewDecode.test.ts`, `scripts/test_parity_compare.py`.

**Start tool state + verify at the actual offset (VP-I20, Codex R51–R57,
2026-10-01)**: the machine runs every move before a program's own G43/G49
under its INHERITED modal G43 (live-confirmed: `G0 Z-100` lands at −100 +
G54 + the applied offset for G43.1 Z12.345 / G49 / G43 H13), but the parse's
interpreter used to start at offset 0 — Z45 under a start offset of 10 ran
at Z55 and was not reported. The worker reads the start ONCE
(`start_tlo_seed`: the gates' `applied_tlo` override, else a pinned parse's
seed, else STAT — 490 → G49 start, a G43-family code → `G43.1` with the
applied vector), seeds it as an init line after the rotary sync, and ships
it as `tlo_start` / `start_known` (+ `start_mode` on `__TLO__`). An unknown
start (no mode, not finite, an A–W component, a pinned seed without a mode)
seeds nothing and gives NO limit verdict (`violations: null`,
`violations_reason: "start_unknown"`, stats "Not validated (start tool
offset unknown)"). A `%`-delimited file has an INIT PHASE
(`PreviewCanon.percent_delimited` from `percent_delimiter_line`): LinuxCNC
reports the `%` line as sequence 1 (whatever blank lines precede it) and runs
the initcode block right after it, so its callbacks arrive numbered 1 — it
used to record the rotary sync as a phantom zero-length point at program
0,0,0 and the seed as a TLO row. The phase is the observed ORDER (from that
next_line to the next one, then never again — a subroutine's line 1 is
program), never a line number (Codex R58 VP-I22). The idle edge
(`evaluate_start_drift`) fires on ANY actual change of the start (> 1e-9,
mode included; no tolerance — two samples prove nothing, Codex R54): reason
`tool_offset` → a VERIFY parse at the live offset: the gateway hands the
worker the published bytes (`verify_against`, temp file), the worker
compares its encoded payload (`compare_preview_payloads`): the published
one NORMALISED to the new start — points before the first TLO row p +
tlo_start_old − tlo_start_new within float32 precision, every later point
bit-equal, the rows byte-equal (they are the offset of every later point —
the client uses an offset TWICE, axis position and tip/body, Codex VP55-01),
bounds recomputed, every other field byte-equal. Same → `__SAME__`, no
stdout, no version bump: only the TOOL BASIS moves (`BulkPipeline.tool_basis`,
status `preview_tool_basis` {file, version, xyz} while it differs from
`tlo_start`), and previewWorker re-decodes the SAME bytes it kept
(`normalizeToToolBasis` — every basis from the original data) so the prefix
re-tips — only for exactly that FILE and version (a basis naming another
file is never applied; the payload falls back to its own start, Codex R58
VP-I24), and until that decode is on screen the preview counts as being
refreshed (`previewBasisPending` → the same "checking" line, muted path,
sweep findings dropped and not restarted; only the matching reply ends it,
never an older one or a worker error — VP-I23). A reply is checked against
the decode WANTED now (`_previewWantKey`), not the one sent last: a return
to the basis already on screen ends the wait at once and drops the reply
still out for the other basis (Codex R59); ThreeViewer `_programTool()` / ScrubBar resolve the pre-first-row
offset to the payload's `toolBasis` (a payload without a known start keeps
the live offset). Different → the verify parse is the re-parse, published.
Banner reason "tool offset changed — checking" (in the HUD's "?"). A pinned parse seeds the tool
basis. Tests: `native_start_probe.py` behind `test_start_tlo_worker.py`
(one fresh process per case; Codex's R54/R53 counterexamples differ, his R55
pair and heavy_test's shape compare same), `viewer/toolBasis.test.ts` (real
payloads `scripts/test_fixtures/tool_basis_pairs.json`, regenerated by
`scripts/gen_tool_basis_fixture.py`, through decode, track, part frame,
scrub pose and sweep both ways), `collisions.viewer.spec`. The goldens are
pinned to a G49 start (`preview_gate.GOLDEN_APPLIED_TLO`). Schema 10 (the
start state + the `%` init phase) shipped at the suite stop of 2026-10-01:
the four goldens (`3axis` haus / kontur / 1001 against a headless boot,
`twp_gantry` against the gantry sim) moved in the schema field alone — none
of them is a `%` program on a rotary config. Schema 11 (the suite stop of
2026-10-11: the keys of the unknown positions after a tool change, M600 in the
preview, the braking range and the start-dependent beginning — see
`gateway_util.PREVIEW_SCHEMA`): the same four goldens moved in the schema
field, haus and kontur also by +4 feed points — the braking range's legs
inside their M600's band (untrusted routine lines; plan parity-ef F) — and
the 73 native payload fixtures in the stamp alone.

**Re-parse cancel-and-restart + visibility (2026-09-05)**: every drift
edge above used to be gated on "no parse running", so an edge raised
DURING a parse (a touch-off while the rotary-drift parse from → Zero
still ran — every zeroing sequence, live) was not evaluated until that
parse published and then queued a second full parse behind it: 41–167 s
to a correct preview on a 1.18 M-line program. Now `BulkPipeline.inflight`
holds the running parse's input snapshot (rotary seed, kins seed, flat
WCS offsets, file + mtime) and the poll loop evaluates the same edges
against it under the same idle gate, settle guards and 2 s debounce
(`inflight_stale_reason`, pure); a hit CANCELS the worker
(`cancel_inflight`: SIGTERM — inside `gcode.parse` the handler's
SystemExit becomes `interp_error` → exit 3 within ~100 ms, temp dir
removed; SIGKILL fallback after 2 s; `gcode.reparse_superseded` /
`gcode.parse_cancelled`) and `reparse_pending` restarts it under the
specific edge (`wcsoff:G54:x`, `rotary:A`, `kins:type`, …) — the
scheduled reason is that edge, never a bare "drift". A running parse for
the CURRENT file+mtime is never superseded by its own file edge
(`preview_file_edge_action` — `file_changed` holds until the publish;
the first acceptance run killed every load parse 33 ms after spawn).
The worker timeout is `max(60 s, 3× expected)` where expected = the last
measured publish of that path, else 1.2 ms/byte (the flat 60 s sat 14 s
above the plane-mode parse). While a parse runs the status envelope
carries `preview_refresh` {reason, file, expected_ms, started_ms,
queued, superseded}: App.vue shows a warn banner with the reason in
operator wording (`previewRefreshLabel`), a locally ticked elapsed clock
and a progress track that never reaches 100 % on its own, the viewer HUD
shows ONE line "Preview re-parsing" with the same bar — the reason only in
its "?" ("Why: …", operator 2026-10-01: the reason took width) — and the
drawn toolpath is MUTED
(`toolpathController.setStale`: an OPAQUE colour mix toward the scene
background at the `--opacity-disabled` ratio — never alpha; a million
blended segments held the Mac's GPU 3 frames behind during every re-parse,
measured with the viewerPerf probe 2026-09-09) while a parse runs
or the payload's offsets / tool length are known stale. The stale-offsets
LINE ("Preview uses older offsets — re-parses when idle") shows at once
only during a run; in standstill the gateway re-parses within its
debounce, so it waits 5 s for that re-parse and shows only if none began
(live look 2026-10-01: it flashed before every "Preview re-parsing"). Parse speed on
the same program (identity, this VM): ~23 s → ~15 s quiet / ~23 s while
a VM-local tab decodes the previous publish — the comment-strip fast
path, the canon's WCS snapshot only on a setter call, and the vectorized
limit checks (below).

**The program's start-dependent beginning (plan `docs/reviews/parity-ef.plan.md`
E, Fassung 7, Codex R122–R133)**: X, Y, Z stand where the machine stands when
the program starts — a value no parse knows. The canon books per callback the
axes whose value still DEPENDS on it (`dep`, bit 0 X, 1 Y, 2 Z): every axis at
the program's first callback (`_begin_program`, before the walk of the
call-less lines up to it — R132 VP-I78), leaving `dep` only when a block
commands it absolutely — the interpreter's own words (`blocks[0].x_flag…`,
`g_modes[0]` 530 / 280 / 300, `distance_mode`), never a changed value (`G0 X0`
at a believed X0 commands X); G28/G30 legs free the stored position only as
the two traverses. Out of scope — an arc whose plane holds a dependent axis, a
cycle, a probe, a turned XY frame, a labeling that is not identity (an unread
live kins type is identity only where the declared kinematics cannot switch,
VP-I81), the interpreter's own M6 moves (line −1), a feed leg of G28/G30 — the
axes become `stale` (`_to_stale`: unknown is never dependent too, VP-I79);
without the interpreter's words X/Y/Z are unknown from the start and the wire
says so (`start_dep_unavailable`, VP-I80). A write FROM a dependent axis
(G92, L20, G28.1 …) is unknown to the end; an explicit main-file line is no
cause in `foreign` text either when the interpreter places the callback in
the main file (the TWP corpus's `g10 l2 p0 …`). A write the canon cannot see
— an inline sub's G30.1, a called file's, a remap body's — is decided by
EXISTENCE (R133 VP-I88): `RemapEnv.pos_writes` follows the text (its own
lines out of text order), its o-call files and remap bodies; a bound suite
Python hook writes nothing from the position by itself (its executed G-code
is test-pinned), the content-pinned routine neither (its reads come first);
any such write sets `start_writes_untracked`, a note and the "*" on the base
and every bound track, wherever it runs (named limit: a write after X, Y, Z
are known counts too). X, Y or Z unknown at the program's FIRST point (a tool
change at a position no parse sees, a turned or world frame, a write before
it) ships `start_unbound` (VP-I84): no entry move, no binding, the beginning
named "not checked" whatever K is — at K = 0 the first move alone, its XYZ end
commanded whole (`startDependent` on its line; one point = the whole program,
"Not checked"); the bar reads "Clear · start not checked" idle and in a run,
never "Clear" alone (Codex R134). A position READ (`#5420`–`#5428`,
`#<_x>`, `#<_abs_x>` …) of a dependent or unknown axis makes every axis
unknown to the end (reason `position_read`, `position_read_lines`): in text
order by the walk and the line's first callback (before its motion), in remap
bodies on the interpreter's stack (`RemapEnv.reads`: ngc bodies followed;
`python=` / `prolog=` / `epilog=` each, bound only for the suite's TWP Python
entries — `SUITE_PY_READS`, every link of the call graph matched to the code
object the worker compiles from the sha256-pinned sources, natively
`sys.modules["remap"].<name>`, R129–R131), out of order from the start. The
bundled routine marks its reads (`WEBUI_POS_SAVE` / `_RETURN` / `_READ=<axes>`,
content-pinned `MARKED_POS_ROUTINES`): the return takes the saved state. The
worker ships per stream a PREFIX of masks, time bases (1 rapid, 2 G94 at F, 3
a feed it cannot time) and F (`*_dep`, `*_dep_basis`, `*_dep_f`), anchors RDP
at every change, gives dependent axes no limit verdict (NaN), and ships
`start_believed` (the first point's epoch, shifted with the tool basis like a
point before the first TLO row — verify and `normalizeToToolBasis`); a first
G1 is a zero-length endpoint with its feed basis like a first G0 — kept by the
track with no mask after it too (VP-I85). Client: the
BASE track breaks the segments into points 1..K (K = after the last mask; no
time, not drawn, not checked; the sweep's baseline is point K; the result
names it, `startDependent` — a whole dependent track never reads "Clear").
`viewer/startDep.ts bindBeginning` binds it to a start: Δ = start −
`start_believed` on every dependent axis — the start converted in
`start_believed`'s basis, the tool offset BEFORE the first TLO row (a G43
before the first move shifted Z twice, VP-I83) — the parse's relabels back, each
move timed by its basis (G93/G95: the INI's shortest duration, a lower bound
"+", none without a limit — `axis_vmax` / `traj_vmax`; `depTime` keeps the
earliest cause in execution order, the entry move's own first, and the "?"
names it — VP-I89). The simulation's
entry track binds to the live joints (the first move keeps its kind: a G1
feeds there), its side sweep covers the entry move and the beginning to K
(only the entry move's findings read "entry"); a run check binds to
`run_basis.start.joints` (gateway: copied from the start's poll before any
await — standing, in position, finite; else `joints_why`) beside the base
sweep, merged onto the base axis (`mergeBeginningOntoBase`: the beginning's
findings at cum 0, a named display limit; its range and boundary contacts
are the base's — VP-I87). The bar names the beginning per run check
(`runBeginOf` / `runBeginView`: none, checked once its side result is merged,
still checking only while ITS side sweep runs, no joints, unbound, failed —
a side sweep that ended without a result: an error, the bodies asked twice, a
cancel, a request not built or not sent, joints that bind no start; the "?"
says why, the base result stays, Codex R134 VP-I90) and never says "checked
in full" while it is not checked (VP-I86). `startDepPayloads.test.ts` runs the
viewer's own coordinator functions out of ThreeViewer.vue for it. The parity harness binds to its record's start
joints. Tests: `test_start_dep_worker.py` (native, E10 + R132–R134, `TestPosWrites`),
`suite_py_bind_probe.py`, `startDepPayloads.test.ts`
(`scripts/gen_start_dep_payloads.py`).

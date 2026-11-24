# P6 Simulation — detail plan v2 (after Fable's read; for Codex R456)

Code sites are at development `4eda3892` (worktree `/home/cnc/lcnc-suite-p6`, branch `plan/p6-sim`). The scope is the agreed P6 text (`docs/reviews/maschinentag.review.md` ~150–160, the MT418-03 F14 part ~224–232, the P6 additions ~258–262, the agreed bullets ~342–348).

The probes and their outputs are in `~/claude-work/p6/`:
- `f9/`: an offline native parse with the operator's setup, the client chain, the trace arithmetic.
- `f11/`: a mock-page Playwright probe against the 4eda3892 build.

**Plan only, no product code.**

## Summary

| F | Cause / state at 4eda3892 | Proof | Proposed change (one line) | Sub-package |
|---|---|---|---|---|
| **F9** | **A defect in the parse worker, not in the frame of the client's entry move.** On a config without a rotary sync, that is a 3-axis machine, the start that the beginning's dependent points derive from (program zero of the fixture) is not the `start_believed` the worker ships (the canon's initial `lo` = machine 0 → −G5x in the program frame). The client then shifts the whole beginning by +G5x. | **Reproduced.** The real worker under LinuxCNC's offline interpreter with the operator's setup, then through the client's decode → track → entry chain: `shift` 13.555212 s and the first point at machine (477.05, 759.39, 0). The machine-day trace logged `shift` 13.55521 three times. | `start_believed` = the interpreter's own position at the program's begin, never the canon's initial `lo`. | **P6-a** |
| **F11** | Scrub position 0 = the entry point, line 0 → display line `null` → `GcodePanel` ignores `null` and stays on the last line. | **Reproduced** on the mock page: mid → 0 leaves lines 4953–4971 in view with nothing marked; the readout says 00:00. | Position 0 = the program's beginning: the code view goes to the top, nothing marked. | **P6-b** |
| **F10** | Design gap: no "to start" control. | — | A ⏮ "Back to start" icon button in a fixed slot beside Play (narrow form: see Q4). | **P6-b** |
| **F8** | The sim marker gets meta only for tools loaded in this session. The collision body of every tool is a cylinder of the table D × (L + 20); after D 8 → 1.875 the tapered T13 is checked as a Ø1.875 pin. | Code reading, file:line below. The browser guard is red first. | (1) The shapes of all tools from ONE store, bound to the tool-table version. (2) The collision body = the envelope of the drawn shape (operator Q5). | **P6-c** (c1 shape, c2 body) |
| **F14** | An RFL that measures starts with the table edge pending or not yet raised → `run_basis` `verified:false` ("a parse runs or is pending" on the machine day; at 4eda3892 possibly "drift open: table_mtime") → the run check is refused for the whole run. After P2b the parse can no longer run during the positioning (observers + `not_idle`). Under the run at most a pinned parse that names no run follows. | Code path only. The machine-day trace is from 98748fab, **not reproduced at 4eda3892**; the native case is build step 0, red first. | A bounded, abortable **wait phase in `_rfl_sequence`** before the start; `run_start_check` decides again at the write. No retroactive confirmation. | **P6-d** |
| **F6** | The header's `(T13 D=1.875 …)` is not compared with the table. The importer takes D = Fusion `DC`. | Code reading and the machine-day data. | A hint in the Check basis card when the header D ≠ table D, never applied. The importer part goes to **P8**. | **P6-e** (hint); importer → P8 |

---

## F9 — the entry move "to max Y, diagonally" (P6-a)

### Current behaviour at 4eda3892 (reproduced)

**The chain.** Sim entry → `ScrubBar.enterSim` (ScrubBar.vue:325–341):
- it takes the live joints (`_baseJoints`) and calls `_buildEntryTrack` (ScrubBar.vue:305–323);
- that calls `scrubTrack.buildEntryTrack` (scrubTrack.ts:670–716), which converts the live joints to program coordinates (`machineJointsToProgram`, scrubTrack.ts:767–788);
- it binds the start-dependent beginning, `startDep.bindBeginning` (startDep.ts:90–134), with Δ = start − `startBelieved` on every dependent axis (startDep.ts:95–101);
- then `prependEntry` (scrubTrack.ts:1018ff) adds the move to the first point.

The side sweep covers the entry move plus the beginning up to K and logs `shift = entry.cum[K+1]` (ThreeViewer.vue:3853–3855, telemetry ThreeViewer.vue:4256).

**The machine-day evidence** (`~/claude-work/machine-day-logs/2026-11-21/x/trace*`):
- `browser.collision.entry_start shift 13.55521297` at 11:01:03 and 11:10:18 (sim entries), and the same at 11:24:45, which is run 1's run-check side sweep, bound to `run_basis.start.joints`.
- The machine stood at the G54 origin. The last jog was at 10:55:42 (Z), the touch-off X0 Y0 Z0 at 10:55:45. No `jog.cmd`, touch-off or go-to between 10:55:45 and 11:24:45.
- That puts the machine at X 238.525, Y 379.696, Z −96.75. The toolsetter values of the day are in `probe.set_vars` (11:31:41), including #3006 = 6000 and #3103 = 0.
- Arithmetic (stale repo INI: rapid 100 mm/s; Z vmax 80):

  | Binding | Moves | Time |
  |---|---|---|
  | Beginning shifted by +G54 | 458.72 mm diagonal rapid + 896.80 mm G1 at F6000 | **13.555212 s** (matches the log to 7 digits) |
  | Correct | Z-only rapid 96.75 mm + 448.40 mm G1 | 5.45 s |

  The match also confirms the machine's G30 X/Y = 0/0 on that day.

**The root cause, reproduced natively.** The probe `lcnc-gateway/test_p6_f9_probe.py` (untracked; copy in `~/claude-work/p6/f9/`) runs `~/claude-work/p6/f9/f9_native_probe.py` the way `test_start_tlo_worker.probe` runs `native_start_probe.py`: pytest, one subprocess per case, synthetic STAT, a temporary INI / var file / tool table, machine commands prohibited. The cases are in `f9_cases.py`: the operator's limits, the toolsetter values of the day, G30 0/0/0, G54 238.525 / 379.696 / −96.75, and the machine-day program's head (N20 `G53 G0 Z0`, N25 `T13 M600`, … 120 lines + M30).

| Case | `start_believed` | Dependent points (program frame) |
|---|---|---|
| 3-axis, G54 ≠ 0, program head | **[−238.525, −379.696, 96.75]** | point 0 (N20) = (0, 0, 96.75), dep 3 (X, Y) |
| 3-axis, G54 ≠ 0, `G53 G0 Z0 / G54 / G0 X10 Y10` | **[−238.525, −379.696, 96.75]** | (0, 0, 96.75), dep 3 |
| 3-axis, G54 ≠ 0, `G91 G0 X5` first | **[−238.525, −379.696, 96.75]** | (5, 0, 0), dep 7 |
| **rotary config (XYZA)**, same G54 | **[0, 0, 0]** | (0, 0, 96.75), dep 3 |
| 3-axis, G54 = 0 (the in-tree cases' frame) | [0, 0, 0] | (0, 0, 0), dep 3 |

The points believe the start at program zero; `start_believed` says machine zero. The cause:
- `PreviewCanon.__init__` sets `self.lo = (0,) * 9` (gcode_canon.py:262, the canon frame = offsets applied).
- `_begin_program` takes `self.start_lo = self.lo` (gcode_canon.py:669).
- The worker subtracts the first point's epoch basis (gcode_parse_worker.py:1803–1812) → −G5x.
- The interpreter itself starts at program zero of the active fixture, as the `rotary_sync_initcode` docstring says (gateway_util.py:1406–1407: "The offline interpreter starts every axis at program-zero of the active fixture").
- On a rotary config the sync initcode is a G53 move whose endpoint sets `lo` to the interpreter's position, so `start_lo` is right there. A 3-axis config gets no such initcode, and its `lo` stays at machine 0.
- The fixture offset is not re-expressed into `lo`; only `tool_offset` re-expresses it (gcode_canon.py:868–871).

**Through the client chain** (`~/claude-work/p6/f9/p6probe.f9.test.ts`, vitest over the native payload, live joints at the G54 origin):

| | `shift` | Points (machine) | K |
|---|---|---|---|
| 4eda3892 | **13.555212** | live (238.525, 379.696, −96.75) → **(477.05, 759.392, 0)** | 3 |
| `start_believed` patched to [0, 0, 0] | 5.4515 | live → (238.525, 379.696, 0): Z only | 3 |

**Why no guard saw it.**
- Every native start-dep case zeroes every fixture (`native_start_probe.py:931`, `var_patches` 5221–5390 = 0), and so do the shipped payloads `scripts/test_fixtures/start_dep_payloads/*.msgpack`.
- The parity corpora (`scripts/parity_corpus/`) are TWP / XYZAC: rotary sync, consistent.
- The operator's machine (3-axis, G54 ≠ 0, Fusion's `G53 G0 Z0` first) is the uncovered cell.

**What the defect touches.**
- Every program on a config without rotary axes whose beginning has a dependent axis (any program that does not command X, Y and Z absolutely in its first moves; Fusion's `G53 G0 Z0` + M600 is the standard case), with a non-zero active fixture.
- (a) The simulation's entry track: the pose, the timeline time (+8.1 s here), the "entry" segment.
- (b) Its side sweep: the entry move and the beginning were swept along a path the machine never runs; the real path (Z up, then X/Y to G30 at Z0) was never swept.
- (c) A run check's beginning: the same binding with `run_basis.start.joints`, run 1 on 11:24:45.
- Not the machine's motion.
- The base track is unaffected: it does not draw or check the beginning.

### Proposed change

**Rule.** The program's believed start (`start_believed`) is the position the INTERPRETER holds when the program begins: the start its dependent points are computed from. It is never the canon's initial `lo`. On every config Δ = start − `start_believed` is the live start's offset from the interpreter's own start, so the entry move moves only the axes the program's first motion block commands. This is the agreed P6 addition "the entry move against the ACTUAL first programmed move and its known start axes".

**Where.** `gcode_canon._begin_program` (gcode_canon.py:626–672): `start_lo` from `self.interp()` (`interpreter.this.current_x/_y/_z`; the same attributes the suite's TWP remap reads, `examples/sim_config/twp/python/remap.py:1556`; `gateway_util.POS_READ_ATTRS` 4733), converted to the canon's internal length unit and carried into the canon frame through the canon's own `rotate_and_translate`. Without the interpreter's words (`interp()` None) X/Y/Z are already stale (`_to_stale`, `start_dep_unavailable`): unchanged.

**The mechanism, prototyped at the value level.** The harness wraps `PreviewCanon._begin_program` (`F9_SPY=1`, `~/claude-work/p6/f9/f9_native_probe.py`) and prints the interpreter's position beside `self.lo`:

| Case | `self.lo` (today's source) | `interp.current_*` | `rotate_and_translate(current)` |
|---|---|---|---|
| 3-axis G54 | (0, 0, 0) | (0, 0, 0) | (9.3907, 14.9487, −3.8091) = G54 / 25.4 |
| rotary G54 | (9.3907, 14.9487, −3.8091) | (0, 0, 0) | (9.3907, 14.9487, −3.8091), equal to `lo` |
| G54 = 0 | (0, 0, 0) | (0, 0, 0) | (0, 0, 0), equal to `lo` |
| G91 as the very first line (no preamble) | (0, 0, 0) | (0, 0, 0) | — |
| inch machine, G54 (2, 3, −1) in | (0, 0, 0) | (0, 0, 0) | (2, 3, −1) |
| G43 start Z10 + G54 | (0, 0, −0.3937) | (0, 0, **−10**) | — |

What this settles:
- `_begin_program` runs at the program's first callback (lineno 0), before any motion. The interpreter's position there is the start, even when the first line is the move: (i) is settled.
- The canon frame is in INCHES (`lo` 9.3907 = 238.525 mm), while `current_*` is in the program's length unit (G21: mm; the G43 case's −10 is mm). The conversion must use the interpreter's length unit: (ii) is settled in principle; the build's inch and G43 guards hold it.
- On the rotary and the zero-fixture configs `rotate_and_translate(current)` equals today's `lo`: the fix changes nothing there.
- With the conversion, the corrected `start_believed` is (0, 0, 0) for every 3-axis G54 case and (0, 0, −10) for the G43 start: exactly the start the dependent points carry (rapid[0] (0, 0, 96.75) / (0, 0, 86.75), dep XY).

**Named alternative, if the build finds a case the read does not cover:** seed `lo` from the interpreter at the end of the init phase. Same rule, same guards.

**Files touched.**
- `lcnc-gateway/gcode_canon.py`.
- `native_start_probe.py`: G5x ≠ 0 variants of the existing start-dep cases (a ctx `var_patches` with a G54 row).
- `test_start_dep_worker.py`.
- `scripts/gen_start_dep_payloads.py` and new fixtures `scripts/test_fixtures/start_dep_payloads/*_g54.msgpack`.
- `startDepPayloads.test.ts`.
- `docs/architecture/scrub-and-run.md` ("the program's start-dependent beginning": the believed start's rule) and the CLAUDE.md short form if the invariants line names it.
- No client code and no `PREVIEW_SCHEMA` bump: the same field, a corrected value. Never bump while live.

### Guards (each red at 4eda3892 by construction; the mutation is "`start_lo = self.lo` again")

1. **Native, pytest** (`test_start_dep_worker.py`, through `native_start_probe.py`).
   - For `e_g53_rdp`, `e_m600_return`, `e_single`, `e_first_g1`, the G91 first move, a G92 at the start, a G43 start (`inherit_g43` shape) and an inch machine, each also under G54 = (238.525, 379.696, −96.75) and under G55 active (`g5x_index` 2):
     - `start_believed` and every point in the PROGRAM frame equal the zero-fixture parse's on every axis the program does not address with G53;
     - a G53 axis differs by exactly the fixture.
   - The rotary config's `start_believed` is unchanged by the fix: an equality control, so the TWP/XYZAC behaviour cannot move.
   - **Cases where the conversion is visible** (Fable: in the prototype rows but one the interpreter starts at program zero, so the unit and the `rotate_and_translate` route change nothing there). Each expected equal to the same program's zero-fixture parse on every non-G53 axis, and red if the conversion is dropped or done in the wrong unit:
     - an inch machine WITH a G43 start (the length unit and the tool offset together);
     - a ROTATED fixture (G10 L2 R) with a stored G92 offset — the class of the two earlier re-derivation bugs (`g5x+g92` origin, TLO in the scrub transform);
     - a frame change before the first motion (`G55` or `G92` as the first line, no motion before it): the read happens at the program's begin while the worker subtracts the FIRST POINT's epoch basis — the guard shows whether those two frames are reconciled.
2. **Client, over the new native payloads** (`startDepPayloads.test.ts`):
   - the entry track built at the live start = the G54 origin moves only the axes the first block commands (|ΔX|, |ΔY| < 1e-6 for the `G53 G0 Z0` case);
   - the bound beginning's first point in the machine frame is (238.525, 379.696, 0);
   - `cum[K+1]` is the correct time (the program's head: 5.4515 s, not 13.555);
   - the Δ = 0 identity holds with start = the interpreter's believed start.
3. **Visible layer, mock page (in the merge gate).** A `*.viewer.spec.ts` serves the new native `*_g54.msgpack` (the program's head shape) at `/preview`, with status `g5x_offset` = the G54 row and `joint_pos` = the G54 origin (machine OFF). It enters the simulation and reads the SCENE and the bar:
   - `__viewerDiag.getToolTip()` at the entry segment's end (`sPos` = `cum[1]`, set through the slider's `input`): machine X/Y unchanged from the live pose, Z = 0;
   - `.scrubBar .posSlot`: the total includes the correct beginning (5.45 s for the program's head, not 13.56).

   Red at 4eda3892: the tip at 2 × G54 in X/Y, the total 8.1 s longer. Mutation: the old `start_lo` → red.
4. **Visible layer, native stage** (outside the merge gate; owed before the machine update). The VM, the 3-axis sim, a real page, the native runner with `restore: complete`. The VM's 3-axis sim profile with a G54 offset, a program `G53 G0 Z0` / `T<tool> M600` / a G54 move, machine OFF.
   - The page enters the simulation.
   - It reads the SCENE: `__viewerDiag.getToolTip()` at the end of the entry segment, the scrub at `cum[1]`, then the next segment.
   - It reads the bar's total time (`.scrubBar .posSlot`).
   - Verdict: the tool tip ends the entry move straight above where it started (machine X/Y unchanged, Z = 0), and the total time is the correct one.
   - Red at 4eda3892: the tip at 2 × G54 in X/Y.

### Risks and interactions

- **Payload.** Only configs without the rotary sync and with a non-zero fixture at the start get another `start_believed`. Every other config must stay byte-equal; guard 1's rotary control covers that.
- **`gcode.verify` (VP-I20).** It compares `start_believed` between two parses (gateway_util.py:1891–1907). Both come from the same worker. **No parse result survives a restart:** the gateway writes no publication to disk (the only payload file is the VERIFY parse's temp blob, `bulk_pipeline._write_verify_blob`, bulk_pipeline.py:98–104; `loaded_program.json` holds the load record only), so after the update every publication is a fresh parse under the new rule — no schema bump needed.
- **Pinned re-parse (`_run_for_pin`, `param_text`).** Same worker path, same rule; no new input.
- **Identity gate, sim gate closure.** Untouched.
- **The collision sweep.** The side and run-beginning sweeps now see the real path: findings may appear or disappear (correct). No change to the model key (ThreeViewer.vue:4004–4011).
- **Performance.** One interpreter read per parse.
- **Operator-visible after the update.** The entry move goes Z first, then the routine's moves. The sim's total time changes. Beginnings checked before the update were checked along the wrong path. Name this in the merge record.

---

## F11 — scrub fully left keeps the old code line (P6-b)

### Current behaviour (reproduced)

- `sampleTrack` at s ≤ 0 returns index 0 (scrubTrack.ts:552–564). On an entry track index 0 is the entry point with line 0 (`prependEntry`: "the entry point keeps line 0 = 'entry'").
- `displayLineForPoint` gives `line > 0 ? line : null` (scrubTrack.ts:618–628), so `applyPos` emits `disp.line = null` (ScrubBar.vue:268, 289).
- ThreeViewer emits `scrub-line null` (ThreeViewer.vue:5085–5098); App binds it (App.vue:2362, 2397).
- `GcodePanel`'s watch scrolls only for non-null (GcodePanel.vue:580–582). A null only stops the glide and the band (GcodePanel.vue:490–492). The view stays on the line the drag passed last.

**Probe** (`~/claude-work/p6/f11/p6probe-f11.spec.ts`, mock page, 4eda3892 build, `run-4eda3892.log`):
- the program has 6000 lines, the machine stands away from the first point;
- Sim on, the thumb to 83 % → line 4962 marked, lines 4953–4971 in view;
- the thumb to 0 → the readout says "00:00/50:53", lines **4953–4971 still in view**, nothing marked, `scrollTop` unchanged;
- the same at desktop 1600×1000 and touch Full HD.

The operator's "~line 5000".

### Proposed change

**Rule.** Position 0 of the simulation is the program's beginning: the machine where it stands, nothing executed. The code view goes to the program's first row (scroll top), nothing is marked, and the bar's readout keeps "entry". The end keeps its own rule (`endLine`). A track without an entry move keeps today's behaviour: index 0 is the first point and its line.

**Where.**
- ScrubBar: `curAtStart` beside `curAtEnd` (ScrubBar.vue:254–290); the `pose` emit carries it.
- ThreeViewer → App: `scrub-line` carries an explicit start state (`{ line: null, at: "start" }` or a second event). Never a sentinel line number.
- GcodePanel: a start state scrolls to row 0. It is a snap: no highlight is in view, so the codeGlide snap rule applies, and no band.

**Files touched.** `ScrubBar.vue`, `ThreeViewer.vue` (the emit type), `App.vue` (the binding), `GcodePanel.vue`, and a pure helper if the decision grows.

### Guards

- The probe becomes a product spec in `sim-panel.viewer.spec.ts` or its own spec. Scrub to the middle, then to 0:
  - the code view's first row is line 1 and `scrollTop` is 0;
  - no `.codeLine.active` and no `.codeFollowBand`;
  - the readout and the timeline stay.
  - Also: at 0 with the end reached before (the `endLine` state) and in the narrow form.
- Red at 4eda3892: `first` = 4953, already recorded.
- Mutation: drop the start state in GcodePanel → red.

### Risks

- The follow (codeGlide) rules: a jump of thousands of rows must snap, never glide; the existing `sim-panel` glide specs cover the highlight rules.
- The run display is not affected: the bar is read-only in a run, and position 0 there is the run's playhead.

---

## F10 — no "to start" control on touch (P6-b)

### Current behaviour

- The bar's controls (ScrubBar.vue:1325–1389) are Sim, Play, the speed, the timeline, the check %, the time and the Sim tab link.
- Play restarts from 0 only at the END (`togglePlay`, ScrubBar.vue:460–472).
- On a keyboard `Home` on the range input reaches 0; on touch there is only a drag to the track's very end.

### Proposed change

**Rule.** A ⏮ "Back to start" icon button (`MachineBtn type="scrub"`, gate `always` like Play, the same `:disabled`/`:reason` as Play) in its own fixed slot right of Play. It does what Play's entry does (`enterSim()`, the device switch and machine-off rules unchanged), stops playback, sets `sPos = 0`, clears `navSel` and emits `manual-scrub`. The code view follows F11's start state. In a run the bar is read-only: the button is disabled like Play.

**Room.** The one-row form loses 40 px of timeline (36 + `--gap-tight`). The two-row form (bar < 620 px, ScrubBar.vue:1493–1511): the code comment (ScrubBar.vue:1497–1501) says row 1 uses 249 of 256 px at the narrowest form — **to be MEASURED in build step 0 of P6-b** (not re-measured yet). Decision (Q4, decided by default, the operator may overrule): in the two-row form ⏮ takes the Sim-tab link's slot (the Sim tab stays reachable through the side pane); the operator's landscape Full HD panel shows the one-row form.

**Files touched.**
- `ScrubBar.vue`.
- `controlInventory.ts`: classify the new control (`local`, the scrub's reason; `controlInventory.test.ts` fails otherwise).
- The function inventory, regenerated and claimed.
- `docs/ui-glossary.md` ("Back to start").
- The CLAUDE.md ScrubBar line (fixed slots) and `docs/architecture/frontend-modules.md`.

### Guards

- A spec: at the middle, a tap on ⏮ → `sPos` 0 and F11's start view.
- In a run, the button disabled.
- `layout.spec` / `strip-fit`-style measure: every bar form keeps its rows within the bar's width (one row; two rows at 256 px), no overflow, nothing moves under a press.
- Mutation: the handler without `sPos = 0` → red.

---

## F8 — the sim tool is a plain cylinder; the collision body (P6-c)

### Current behaviour (code reading)

**Drawn marker.**
- While scrubbing the marker wears the sample's tool. Its meta comes only from `getToolMeta(scrubTool)` (ThreeViewer.vue:2717–2721), a session cache (machineAssetCache.ts:34, 185–194).
- The cache is filled from `st.tool_meta` of the LOADED tool only (ThreeViewer.vue:2750–2755, `setToolMeta` only when `scrubTool == null`).
- The gateway sends `tool_meta` only for `st.tool_number` (gateway.py:12978–12998).
- A tool not loaded in this session → `buildToolGroup(diam, len, null)` → the cylinder. The operator's T13 at 11:01 was not loaded until the run at 11:23.

**Collision body.**
- `_programToolDims` (ThreeViewer.vue:3044–3057) → `_toolVisual(D, L)` (ThreeViewer.vue:3034–3038) → `makeToolVariant` (collision.ts:1189–1203, 672ff.): a cylinder of the table D × (L + 20 mm, at least 40). The run's base tool is the same (`tool: _toolVisual(basis.toolDiam, basis.toolLen)`, ThreeViewer.vue:4123).
- Meta is never read.
- The Check basis card says so (checkContext.ts:191).
- After the operator's edit D 8 → 1.875 the T13 body is **Ø1.875** while the drawn cone reaches Ø7.95 at 47 mm and the shank Ø8. The check under-approximates the tool. Before the edit, the Ø8 cylinder over-approximated it. **Fixing the drawing alone leaves this (Codex's point).**

**Every tool's metadata is already available.**
- The WS `get_tool_table` (gateway.py:8795–8812) returns `_merge_tool_data` rows (tool_table.py:172–192) with every `_TOOL_META_FIELDS` field.
- A `tool_table_changed {version}` ping follows every table or library change, also LinuxCNC's own G10 L1 (P4-2 watch, gateway.py:13194–13205, 3369–3405).

### Proposed change

**P6-c1, the shape. Rule:** the sample's tool shows ITS library shape for every tool in the table. ONE store holds it:
- `toolLibraryStore.ts`: the merged rows of one `get_tool_table` read;
- read at connect and on each `tool_table_changed` version;
- ONE reader shared with the Tools tab, so there is no second RPC per ping;
- bound to that version.

The sim marker takes:
- its dims from the publication (`parse_tlos`, as today, the same values the sweep uses);
- its shape from the store at its version.

The marker rebuilds on (tool, dims, store version). The built shapes are cached per key, so ×100 playback across many tool changes builds no geometry again (a lathe profile can have up to 4096 arc steps). The live (loaded) marker keeps `st.tool_meta`. A tool without a library row → the cylinder, as today.

**Before Q5 goes to the operator:** the c1 red spec for the unloaded tool, and a count of the findings with BOTH bodies (table-D pin vs envelope) on a tapered-tool program (a T13-like tool beside a fixture), so the question carries numbers.

**P6-c2, the collision body (Q5). Rule:** the check's body for a tool with a library shape is the shape's ENVELOPE:
- a cylinder of the profile's widest diameter (from the same `buildToolProfile` over the stick-out length);
- a superset like every `collision` proxy (machine-model rule);
- for program tools (`_programToolDims`) and the run's base tool;
- a tool without a shape keeps the table-D cylinder.

A change of the store version that changes a program tool's envelope re-checks (`_colOnInputChange`) like a diameter change. The run check records the version in its `CheckBasis`; a change discards like "another basis revision". The card's note says what the body is.

**Files touched.**
- `ThreeViewer.vue` (marker, `_programToolDims`, base tool);
- the new `toolLibraryStore.ts` (+ its rule in `scripts/test_select/rules.py`);
- `ToolTablePanel.vue` (reads the store);
- `viewer/collision.ts` (the variant from an envelope; unchanged otherwise);
- `checkBasis.ts`, `checkContext.ts`;
- `docs/architecture/collision.md`, `machine-model.md`.

No gateway change. No new WS command.
- Checked: the merged `get_tool_table` rows carry every key of `tool_visual_metadata` (tool_table.py:91–106) except `stl_file`, and no client code reads `stl_file` (grep over `lcnc-webui/src`: no consumer). So the store's rows draw exactly what `st.tool_meta` draws for the loaded tool.

### Guards

- **c1:** a browser spec. Loaded tool T1; a program with `T13 M6`; T13 tapered in the mock's `get_tool_table`; sim; scrub past the change. The SCENE's tool marker (a diag reading the marker's profile: radius at the tip vs at the flute end, or its geometry type) is the tapered shape, not the cylinder. Then a `tool_table_changed` with a new version changes it. Red at 4eda3892.
- **c2:** unit over `collision.ts`: the variant's radius = the profile's max radius. A spec: a fixture beside the cone's upper part, outside the table-D pin, gives a contact with the envelope and none with the pin (the 4eda3892 state). Mutation: `_programToolDims` back to table D → red.
- **Perf:** a playback across N tool changes builds each shape once (`getToolShape` counter).

### Risks

- **c2 makes the check more conservative:** more contacts near stock on rapids, shank × fixture contacts that the pin missed. That is the safe direction, but it is visible. → Q5.
- **The collision model key** (machine parts) is unaffected; tool variants are per sweep (collision.ts:1185–1203). BVH cost: cylinders, negligible against F7's 79 s machine BVH.
- **Stale dims.** A store version newer than the publication's table read (a re-parse pending) pairs the new meta with the old dims until the re-parse. The path is then "stale" (muted) anyway; named in the doc.
- **Payload.** `native_mesh` makes the merged rows large; the store reads once per version, never per frame.

---

## F14 — an RFL that measures starts unverified (P6-d)

### Current behaviour at 4eda3892 (code path; NOT reproduced at this head)

**Machine day at 98748fab (trace).**
- Run 2 (11:31:41): the measuring (`T13 M600`) → job 9 (`tool_offset` edge) spawned 11:32:10 → safe_z / positioning (21 s) → starting 11:32:32 → `run_basis.start verified:false why "a parse runs or is pending"` (job 9 still running, published 11:32:40).
- Run 3 (11:33:12): the measuring → `table_mtime` edge job 10 at 11:33:40 → starting 11:34:04 → the same `verified:false`.
- Every `run_check_refused` "the run's start is not the preview's (a parse runs or is pending)" (checkBasis.ts:148).

**The code path at 4eda3892.**
- `run_start_check` returns `(False, "a parse runs or is pending")` while `refresh_running or reparse_pending` (bulk_pipeline.py:646–647).
- `_rfl_sequence` (gateway.py:6148–6290) is a background task. `auto_run` itself is no `input_action` (command_policy.py:957). Each MDI step (`_rfl_mdi_step`, gateway.py:6082–6091) is an input write: every MDI line (calc_lifetime.py:54–77), observed until the controller is done.
- P2b's restart rule (`_restart_wait`, gateway.py:4044–4070) lets the idle parse start only after the observed end + 2 s quiet AND interpreter idle AND the machine still.
- The idle drift edges themselves (the table edge among them) evaluate only through `drift_gate_open` (gateway_util.py:1670–1687): idle, still, 2 s debounce.
- The positioning is motion, and the step that follows it is the start (within milliseconds, gateway.py:6235–6265). The table edge's parse can therefore no longer run DURING the positioning, as it did at 98748fab.
- At the AUTO write `run_start_check` evaluates the drift edges WITHOUT debounce (bulk_pipeline.py:639–641, 676–692). The start is therefore unverified either with "a parse runs or is pending" (the edge already raised) or with "drift open: table_mtime" (not raised yet). Which one it is at 4eda3892 is for build step 0 to show; both refuse the run check.
- The toolsetter read-back is not due while `_rfl_busy()` (gateway.py:6544), and P2a holds the idle edges for an open confirmation (≤ 30 s). On the machine day the measuring RFL left the basis `applied` (`toolsetter.basis applied` 11:31:41.534; nothing after the M600, whose body writes only #3116, not a basis key, gateway_util.py:6201). So the hold should not apply; build step 0 asserts no `gcode.reparse_toolsetter_held` in the wait.

**Under the run** (expected from the code):
- "never a live basis under a run": no idle restart;
- the mid-run table edge (gateway.py:2170–2205) can schedule a PINNED parse with `run=_run_for_pin(...)`, which is None for an unverified run (gateway.py:4391–4402). It publishes without `for_run`, so its check is refused.
- The run check stays refused for the whole run.

**Not verified natively here:** the claimed P2b difference (pending instead of running at the start) and the mid-run pinned parse. → build step 0.

### Proposed change (the agreed direction: wait before the start, bounded and abortable; no retroactive confirmation)

**Rule.** Run from line with a measurement starts only on a preview that matches the start, or it names why not. In `_rfl_sequence`, after the positioning and BEFORE the spindle start and the AUTO switch, a phase `preview` begins (new `rfl_status.phase`):
- **Its exit condition is `run_start_check` itself**, with the arguments `_begin_run_basis` uses (gateway.py:4340–4343): the loaded file, a fresh STAT, the program's source hash (in a thread), `open_drift=_ts_open_drift()`. It waits until that returns verified.
  - A plain "no parse pending or running" would fall straight through: right after the positioning the table edge may not be raised yet (debounce), and the start would then be unverified with "drift open".
  - Waiting on the full check lets the idle edge rise (idle, still, 2 s), its parse run and publish, and then verify.
  - It is polled about once per second; the hash of an 8 MB program costs ~20 ms in a thread (cache it by mtime).
- it checks `still_bound()` every second;
- it is bounded (Q1; recommended 90 s: the N100 parses the 344k-line program in ~30 s + 2 s publish);
- it ends EARLY on a reason waiting cannot cure (Fable): the program changed or was unloaded, a preview refusal of this program (the parse failed / was refused, `preview_err`), no publication possible for the program at all — then the start proceeds unverified at once, named, instead of a 90 s delay before the same unverified start;
- an Abort or E-Stop cancels it (`_preempt_inflight` cancels the RFL task, gateway.py:12538–12543 → phase `aborted`).

During the wait the RFL holds no action, so P2b's restart rule lets the idle parse run (2 s quiet, idle, still).

**At the start nothing new is trusted.** `_cmd_blocking`'s `run_basis` capture and `run_start_check` compare the controller NOW with the publication (program identity, the table, the WCS, the toolsetter book, the start tool). `_basis_admit` / `_program_start_refusal` admit as today. The wait only makes a verified outcome possible; it never sets `verified`.

**On timeout (Q1):** recommended, start anyway, unverified, named in the phase (`rfl_status` "preview not ready — the run is not checked") and in the message log.

**Why after the positioning.** Every MDI step is an input write that begins a generation and cancels a parse in flight (`inflight_outdated`, gateway.py:2091–2105). After the positioning two steps remain before the AUTO_RUN write: (1) the optional spindle start — `set_mode(MODE_MANUAL)` and `command.spindle` (gateway.py ~6246–6252); neither is an input write (`input_write_class`, calc_lifetime.py:54–77: only MDI lines, a switch whose TARGET is MDI or AUTO, the synch and a table reload), so it begins no generation and changes nothing `run_start_check` compares (program identity, fixture and table, G92, kinematics, rotary seed, start tool, the drift edges); (2) the switch to AUTO (class `mode`, calc_lifetime.py:70–72). The wait sits before (1), so the spindle is not started while the operator waits for a preview. It begins a generation too, but:
- with the wait ended verified, no parse is in flight for it to cancel;
- `run_start_check` runs after the switch, at the AUTO_RUN write (`_begin_run_basis` inside `_cmd_blocking`, gateway.py:4321–4360, 4499–4503), and decides on the state then.

The cost is the parse time (~30 s on the N100) per measuring RFL. It cannot overlap with the positioning, because the parse needs the machine still.

**F2 overlap.**
- F2 (`~/claude-work/p2bf/plan.md` "P2b-F2") is the first PINNED parse for a run that started without any publication of its own; it needs a captured start record.
- F14's wait needs no such contract: the run starts on a regular idle publication, compared at the write by the existing `run_start_check`.
- The alternative "pin the pending re-parse to the run" WOULD need exactly F2's start record and a named unchecked stretch (MT418-03). It is not proposed.
- The same symptom outside RFL is F2's: Measure Current, then Cycle Start while the re-parse is pending → unverified, named. Waiting silently there would delay a start the operator pressed. → Q2.
- **Recommendation:** F14 in P6, independent of F2.

**Files touched.**
- `lcnc-gateway/gateway.py` (`_rfl_sequence`, `_RFL_UNDECIDED` += `preview`);
- `ws/statusStore.ts` (phase words);
- `lcnc.ts` if the phases are typed;
- `scripts/native_run.py` (the RFL case);
- `test_rfl_*` / `test_command_dispatch` (a gateway unit for the wait: pending → waits, published → starts, the bound → starts unverified and named, abort → `aborted`, program changed → `program_changed`);
- docs: `scrub-and-run.md` "Check during a run", `docs/decisions.md`.

### Guards

- **Build step 0a, the CONTROL first** (Fable): an RFL with the measurement but no table change must start verified at 4eda3892 — this shows the steps after the wait (spindle, AUTO switch) leave a start verified at all. Then a run paused at the wait point (a test seam holding the RFL before the spindle step) shows `run_start_check` turning verified while the RFL task is busy (the idle edge rises, its parse runs and publishes under the RFL). If either fails, the wait would only be a delay before an unverified start — worse than today — and the plan returns to the review.
- **Build step 0 (red first at 4eda3892), native stage with a real page** (the p2bf page driver's pattern, `~/claude-work/p2bf/native/p2bf_native.py`). Extend `rfl_cases` (scripts/native_run.py:3036ff., which already measures `MEASURED_TOOL` before line 7): plant the tool's table length 0.5 mm off so the measurement changes the table.
  - Judged on what the OPERATOR sees:
    - the run-check words in the bar and the Sim tab during the run: "Run check · …" admitted vs the refusal;
    - the RFL phase messages in the message center, including the new "waiting for the preview" phase;
    - the page's `browser.collision.run_check_start` / `_refused`.
  - Judged in the gateway: `run_basis` at the start (`verified` and its `why`) and no `gcode.reparse_toolsetter_held` during the wait.
  - At 4eda3892 expected `verified:false` ("a parse runs or is pending" or "drift open: table_mtime"), the refusal on the page; after the fix `verified:true`, the check admitted, the added wait recorded.
- **Control at the same head:** an RFL with the measurement but NO table change (the plant omitted, length unchanged; if LinuxCNC's G10 L1 rewrites the file anyway, an RFL without `pre_tool`) is verified and admitted at 4eda3892 too. So the red case is red for the table edge, not for the setup.
- A second native case with the parse made slower than the bound (a padded program, the `RFL_SPEED` case's padding pattern): it starts unverified with the named phase and its message.
- **Gateway unit:** the wait's outcomes as above (the check verified → start; the bound → start unverified and named; abort → `aborted`; program changed → `program_changed`; the check never polled before the positioning ended). Mutation: no wait → the native case red again.

### Risks

- **Time.** Every measuring RFL waits for the parse (~30 s on the N100). Name it in the merge record. W2 ("verschwendete Rechenleistung") is not touched: the parse would run anyway after the start, and now it runs before.
- **A parse refused or discarded during the wait.** It is restarted by P2b's rules or the bound ends the wait; never a hang. Guard: the bound.
- **Disconnect.** The RFL task is the gateway's; it continues as today.
- **The heartbeat and watchdog.** The wait is an `asyncio.sleep` loop: no blocking.

---

## F6 — program header D vs table D; importer D for tapered tools (P6-e; importer → P8)

### Current behaviour

- the machine-day program line 3: `(T13 D=1.875 CR=1. TAPER=3.7DEG - ZMIN=-25.777 - TAPERED MILL)` (the Fusion post's header).
- The table had `T13 D+8.000`; nothing compares them.
- `buildToolProfile` uses the table D as the cutting diameter (toolGeometry.ts:72ff.) → the fat cone. The operator's manual D 1.875 confirmed the profile code ("hat funktioniert").
- Importer: `"D": float(geom.get("DC", 0)) * tool_scale` (fusion_import.py:105). Tapered: `tapered_type`, `taper_angle × 2` (fusion_import.py:128–154).
- Why the table held 8: the May export's DC. Unproven without the operator's library file.

### Proposed change (P6-e, the hint only)

**Rule.** When the published program's header names a tool's diameter (the Fusion post's `(T<n> D=<d> …)` comment lines before the first motion block) and the table D of that PROGRAM tool differs (beyond 0.001 mm in machine units), the Check basis card's "Program tools" row of that tool says so (`warn`): "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875". **It is only a hint.** It never changes the table, a measured length, the drawing or the check.

**Edge cases.**
- Units: the header's G20/G21 before the first motion; none → no hint (unknown is no claim).
- A format other than Fusion's → no hint.

**Where.** A pure scanner `viewer/programToolHeader.ts` (bounded: the header lines up to the first motion word, at most 500 lines; on the identity-gated `gcodeContent`) and `checkContext.ts:184–197`. Rules and inventory as needed.

**Guards.**
- A unit over the scanner: the Fusion header, comments only, `T13D=…`, units, a second header line for the same tool, no header.
- A spec: the card row shows the hint for a mismatch and none for a match. Mutation: the comparison off → red.

### Goes to P8 (not P6)

- The importer's D for tapered tools (which Fusion field is the cutting diameter for a tapered mill).
- D as a conflict in the merge planner (P8: "Durchmesser geändert → Konflikt, nicht übernehmen").
- "refresh offers D".

**Owed for that:** the operator's current Fusion library export (T13's DC) as a golden test.

---

## Operator questions (asked by the main session; recommendations included)

Only **Q1** and **Q5** go to the operator (Fable: four questions are already open with them). Q2, Q3, Q4 and Q6 are decided by their recommendation and told to the operator, who may overrule: Q2 is "no change" and belongs to F2; Q3 has an obvious default; Q4 concerns the narrow bar their landscape panel does not show; Q6 follows their own rule (one fact, one place).

| # | Question | Recommendation |
|---|---|---|
| **Q1 (F14)** | An RFL that measured waits for the new preview before it starts (~30 s on the machine for the machine-day program). How long at most, and what if it is not ready? | Wait at most 90 s, then start **without** the run check, said in the message log. A stop would force a second measurement. |
| **Q2 (F14)** | The same after Measure Current + Cycle Start (not RFL): should Cycle Start also wait? | No. Cycle Start never waits silently; that run stays unchecked and says so until F2. |
| **Q3 (F11)** | Scrub fully left: show the program's top with nothing marked, or mark the first line the run executes? | The top, nothing marked. Nothing has run at position 0; the line is marked as soon as the scrub moves. |
| **Q4 (F10)** | ⏮ beside Play. In the narrow two-row bar (portrait, < 620 px) row 1 has no room. | There ⏮ takes the Sim-tab link's place; the Sim tab stays reachable through the side pane. Alternative: no ⏮ in the narrow bar. |
| **Q5 (F8)** | The collision check's tool body for a tool with a library shape: the shape's widest diameter (safer, more findings near the stock), or keep the table diameter (today: T13 is checked as a 1.875 mm pin)? | The widest diameter. |
| **Q6 (F6)** | Where should "program header Ø 1.875 ≠ table Ø 8" show? | Only in the Sim tab's Check basis card, at the tool's row (one fact, one place). |

No operator question for F9: it is a defect.

The merge record says that the beginnings checked before the update, including on the machine day, were checked along the wrong path.

---

## Order of work (each sub-package mergeable on its own)

1. **P6-a F9** (gateway worker, native pytest, client payload tests, a native page case). First: the operator's standard program shows a wrong sim path and checks the wrong beginning. No UI change.
2. **P6-b F11 + F10** (ScrubBar, GcodePanel, App). Frontend only; Q3, Q4.
3. **P6-d F14** (gateway RFL wait). Build step 0 = the native case red at the base; Q1, Q2.
4. **P6-c1 F8 shape store**, then **P6-c2 collision envelope** (Q5). c2 depends on c1's store.
5. **P6-e F6 hint** (depends on nothing; after c2 if the card's tool note changes there).

Every sub-package:
- `scripts/test_select/round_gate.py --base <accepted base>` per round;
- the full merge gate `round_gate.py --merge` on the agreed head (one per agreed head);
- mutations red at their rule;
- new files get their `rules.py` rule; new disk reads in tests their `READ_SITES` entry (the new `start_dep_payloads/*_g54.msgpack`, the F11/F10 spec's fixtures);
- the function inventory regenerated when its guard fires (F10's button, F14's phase words if inventoried).

**Native per sub-package.**
- P6-a: the offline native pytest (in the backend gate) + one native-stage page case.
- P6-d: the native-stage RFL cases.
- P6-b/c/e: mock only.

The LAN sim is given back through the runner's restore (`restore: complete`) every time.

## Owed live on the machine (after the update, with the operator)

- **F9.** the machine-day program at its G54, machine OFF, Sim:
  - the first move is Z only, then the routine's moves to G30 (xwd screenshot series);
  - the bar's total time ~5–6 s shorter at the beginning;
  - a run check's beginning `shift` in the trace ≈ 5.45 s, not 13.555.
- **F14.** An RFL with a measurement: `run_basis.start verified:true`, `run_check_start` during the run, the wait time measured on the N100.
- **F10/F11.** On the touch panel: ⏮ in the one-row bar, the code at the top after it.
- **F8.** T13 drawn tapered in the sim without loading it. After Q5: the check card names the envelope.
- **F6.** A program whose header D differs from the table shows the hint (a test program; the operator's T13 now matches).

## What was not verified

- **F9's fix as code** is not written. Its mechanism is prototyped at the value level: the interpreter's position at `_begin_program` for G54, rotary, zero fixture, G91 first line, inch and a G43 start. The unit conversion (program unit → the canon's inches) is derived from those values, not run as a fixed `start_believed`. The probe used LinuxCNC's offline interpreter (the parse worker's own), not the VM's running LinuxCNC with a page. The machine-day `shift` matching to 7 digits ties the cause to the machine.
- **F14 at 4eda3892:** code reading only. Whether the start's `why` is "a parse runs or is pending" or "drift open: table_mtime", whether a mid-run pinned parse follows, and whether P2a's toolsetter hold stays out of the RFL are claims from the code and the 98748fab trace until build step 0.
- **F8:** code reading only (no page probe). The c2 claim "Ø1.875 pin vs Ø8 cone" follows from `_toolVisual` + `makeToolVariant` with the table D.
- **F10's narrow-form width** (249 of 256 px) is from the code comment (ScrubBar.vue:1497–1501), not re-measured.
- **F6's header format:** only the Fusion post seen in the machine-day program.
- **The machine's real INI and G30:** the repo copy is stale. The F9 arithmetic matched with G30 X/Y = 0/0 and the repo's velocities.

## Probe files (none committed)

- `~/claude-work/p6/f9/`:
  - `f9_native_probe.py` (a copy of `native_start_probe.py` with an X/Y axis override and a case file);
  - `f9_cases.py`, `the head copy (.ngc)`;
  - `test_p6_f9_probe.py` (the pytest runner; removed from the worktree, which is clean). To rerun: copy it into `lcnc-gateway/` and run `F9_SPY=1 .venv/bin/python -m pytest -q test_p6_f9_probe.py`;
  - `p6probe.f9.test.ts` (the client chain);
  - outputs `*.json`, `*.msgpack`.
- `~/claude-work/p6/f11/`: `p6probe-f11.spec.ts` (removed from the worktree; it ran from `e2e/` under the heavy lock), `run-4eda3892.log`, `build.log`.

# P6-d (F14) — detail plan v4 (after Codex R461 and the native step-1 spike)

**Scope.** Code sites at development `6c78780c`. This plan replaces the P6-d part of `docs/reviews/maschinentag.r461.p6-plan-v3-cde.md`. It takes in Codex's R461 answers F14-1, F14-2 and F14-3 and the native spike they asked for. **Plan only.** The spike is throwaway: branch `feat/p6d14` (worktree `/home/cnc/lcnc-suite-p6d14`), local only, not pushed, not for merge.

**Evidence.**
- **Spike commit `65a8b419`** on `6c78780c`:
  - the wait phase `preview` in `_rfl_sequence`;
  - `_start_verdict`, the ONE start-check call shared by the wait and `_begin_run_basis`;
  - `run_basis.verified_against`;
  - a trace `run_basis.written` at the AUTO write itself;
  - `lcnc-gateway/test_rfl_preview_wait.py`, 10 unit tests with an injected clock;
  - `test_rfl_guard.py` (32 tests) green with the wait stubbed in `_SeqHarness`.

  There is **no test variable** anywhere (F14-3).
- **Record `docs/reviews/p6d.spike-65a8b419.json`** (commit `d48a655c` on `feat/p6d14`). Token-scanned: 0 hits for the live sim's token. The copies run tokenless on loopback.
- **Native runs** on the **VM's** real LinuxCNC: the 3-axis sim profile, a confined copy of the run tree at `65a8b419`, through the native stage's machinery. Restore and restore-post are `complete` in both runs, with no crashes.
  - **Run 1** `20261124T142722-spike`: a1, a2, confirm, b, c, d, e. The `confirm` step was a no-op: the read-back had already confirmed the basis at the load (N-F1).
  - **Run 2** `20261124T143737-spike-assumed`: prep (program C run in AUTO, then A loaded *from AUTO*), then a1, a1b, a2 on an **assumed** toolsetter basis.
- **Local driver**, never committed: `~/claude-work/p6d/f14/`.
  - `spike_native.py`, `spike_drive.sh`, `spike_analyze.py`, `spike_record.py`.
  - Step 0's `p6d_probe.mjs` (the page), unchanged.
  - Spike mutations: `mut/mutate.py`, `mut/mutations.log`.
- **The page code is `6c78780c`'s in every run.** The spike did not touch the page. Every page result below is the base page against a gateway that waits.
- **Programs:** A and B are step 0's programs. A has `T1 M600` on line 3, 20,000 padding lines, start line N = 20008 and about 25 s of motion. B is A without the M600. C is 3 lines.
- **Every RFL is one `auto_run` as the dialog sends it:**
  - line N, the published version, source and program id;
  - spindle forward at 1000;
  - `safe_z`, and the entry X100 Y100 in G54 G21;
  - with `pre_tool=1`, the section's values.
- **Value sets:**
  - "fast" = `#3006` 3000, `#3005` 200. It keeps the measurement short, so the P2a hold is still live when the wait begins.
  - "step 0" = `#3006` 500, `#3005` 20.

## Summary

| | |
|---|---|
| **F14-2 proven natively** (run 2 a1, a1b) | The full required order ran, on a fresh gateway whose toolsetter basis was never read back (`#3014` assumed before and after; no `toolsetter.read_back*` in either case):<ol><li>The RFL is held at the new wait point **by the wait itself**.</li><li>The read-back stays inadmissible (`_rfl_busy()`).</li><li>The hold holds the toolsetter and table edges **inside the wait** (`reparse_toolsetter_held` / `reparse_edge_held`).</li><li>The hold ends by its cap, 30.9–31.5 s after its anchor.</li><li>The table parse (toolsetter masked) publishes.</li><li>The full comparison becomes true: the wait exits `verified` 17–42 ms after the publication.</li><li>Only then the record (`run_basis.start verified:true`, naming that publication) and the AUTO write.</li></ol>The wait lasted **12.6 s and 8.7 s**. The hold's remainder was 12.1 s and 8.1 s of that; the bound started once. `assumed` was never renamed. |
| **Every measuring RFL that reached its start started verified** (6 of 6, plus the control e) | Waits: **2.40–2.81 s** on a confirmed basis or once the cap had passed; **8.7–12.6 s** with the hold live; **0.001 s** without a pre-measurement. At the base the same shapes started unverified: step 0 had 3 of 3 measuring RFLs unverified (`another tool start` 2×, `drift open: toolsetter` 1×). |
| **The wait cured the F4 near-tie** (run 1 a2, also seen in c) | In both, the drift tick hit the gap 2.004 / 2.007 s after the `#3116` step's end and scheduled a table parse.<ul><li>In a2 that parse was refused at its begin (`gcode.parse_refused_at_begin why: running`: the positioning had started).</li><li>In c it was spawned and superseded by generation 42 ms later.</li></ul>The wait's first poll said `a parse runs or is pending`. In a2 the table parse was scheduled again after the positioning's quiet window, published, and the start verified. This is the machine day's why at the base, now observed natively at the head and cured. |
| **Exits** | <ul><li>**Text changed on disk** in the wait → `program_changed` at the next poll (1.03 s).</li><li>**A `load_file` in the wait is refused** "Run from line is starting — abort it first". The text on disk is the only program change the wait can meet.</li><li>**Abort** in the wait → `aborted` within 33 ms.</li><li>In both of these: no spindle, no AUTO, no `run_basis.start`, the flag cleared about 2.4 s later.</li></ul> |
| **Record vs write** (F14-1, the timing language) | <ul><li>Wait exit → record (`run_basis.start`): 116–154 ms. That covers `still_bound` plus the spindle start.</li><li>Record → AUTO write (`run_basis.written`): **20.6–37.5 ms**.</li><li>Publication → write: 147–203 ms.</li><li>In every verified case the record names the wait's publication, and the write saw the same version and basis revision: no publication or basis change between the wait's end and the write.</li><li>No toolsetter booking at the write (program A's scan writes no basis key).</li></ul> |
| **The page (base code) still shows "Collisions not checked"** under every verified start (MT-F14-P confirmed 6 of 6) | Its first run-check attempt came **0.73–3.90 s after the write**. It was refused `not a parse made during the run`. The gateway's wait cannot cover the page: its publication preceded the write by only ≈ 0.15–0.20 s. → **The page's second admission path (section 3) is required.** |
| **New, plan-relevant** | <ul><li>**N-F1.** `load_file` has no AUTO pre-step (BG-03). A load from MDI/MANUAL leaves the task there, and the read-back confirms the basis about 1.7 s after the publication. An RFL meets an *assumed* basis only after a load in AUTO (after a run), or within about 2 s of a load.</li><li>**N-F2.** Run 2 a1: during the hold the page ran its idle fallback check on the *old* publication and showed "Clear · checked to the end" for 11 s inside the wait. From the write on it showed "Collisions not checked".</li><li>**N-F3.** The run check's full sweep covers the whole track, so an RFL's skipped lines are checked as if they ran (code reading). v4 carries the start line in the record.</li></ul> |

## 1. Native results

### 1.1 The verified runs (times in s; page by the browser's own clock)

| Run / case | Basis at the RFL | Measurement | First why in the wait | Hold inside the wait | Parse in the wait (reason; spawn → publish) | **Wait** | Publication → exit | Exit → record | Record → write | Page: first run-check attempt after the write |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 / a1 | **assumed** (fresh, never read back), fast | 15.27 | `drift open: toolsetter` | held at +0.01 s, ended by cap at +12.11 s (31.47 s after the apply's booking) | `table_mtime` (toolsetter masked); 0.45 | **12.607** | 0.042 | 0.129 | 21.0 ms | +0.73 refused "not a parse made during the run" |
| 2 / a1b | **assumed**, fast | 21.34 | `drift open: toolsetter` | held at +2.02 s, cap at +8.07 s (30.94 s after the apply) | `table_mtime` (masked); 0.66 | **8.747** | 0.017 | 0.132 | 21.2 ms | +1.13 refused, same why |
| 2 / a2 | **assumed**, step-0 values (cap passed in the measurement) | 111.81 | `drift open: toolsetter` | ended (cap) at the first evaluation, +2.01 s | `table_mtime` (masked); 0.54 | **2.570** | 0.024 | 0.128 | 20.6 ms | +3.90 refused, same why |
| 1 / a1 | confirmed (read back at load), values changed by the apply (fast) | 10.23 | `drift open: toolsetter` | none | `table_mtime` (masked); 0.36 | **2.395** | 0.024 | 0.127 | 20.6 ms | +0.81 refused, same why |
| 1 / a2 | confirmed, values back to step 0's | 111.90 | `a parse runs or is pending` (F4 near-tie, see 1.3) | none | `table_mtime` scheduled again; 0.77 | **2.811** | 0.008 | 0.116 | 23.2 ms | +2.23 refused, same why |
| 1 / b | confirmed (`#3014` read at the load; the other keys applied by a2 with the same values, applied again by b) | 108.39 | `another tool start` | none | `table_mtime`; 0.56 | **2.616** | 0.037 | 0.143 | 22.4 ms | +1.72 refused, same why |
| 1 / e | program B, no pre-measurement | — | — (first poll verified) | none | none | **0.001** | — | 0.154 | 37.5 ms | no run-check event; "Clear · checked to the end" throughout |

Common to every verified row:
- `run_basis.start` is `verified:true`, with `verified_against` = the wait's last publication, its program id, ctx digest and tool basis revision.
- `run_basis.written` saw the same `version_now` and `tool_basis_rev_now`, with `refresh_running` and `reparse_pending` false.
- No mid-run parse: the wait's publication already holds the new table mtime.
- The page words during the run were **"Collisions not checked"** in all six measuring rows, until about 1.1 s after the run's end, when the idle check ran ("Clear · checked to the end").
  - In run 1 a1/a2/b and run 2 a2 they had already stood since the measurement's table write.
  - In run 2 a1/a1b they appeared +0.70 s / +1.12 s after the write. Before that, the page's idle fallback check on the OLD publication had shown "Clear" during the hold (N-F2).

### 1.2 The exits

| Case | What the driver did on `rfl_status.phase == "preview"` | Result |
|---|---|---|
| 1 / c (fast, confirmed) | `load_file` of program B, then A's text changed on disk (a comment appended), within 1 ms of the phase | <ul><li>The load is **refused** "Run from line is starting — abort it first".</li><li>The wait's second poll (+1.03 s) says `program_changed` "the program text changed on disk — confirm Run from line again".</li><li>No spindle, no AUTO frame, no `run_basis.start`.</li><li>`rfl.flag_cleared` +2.36 s.</li><li>Page: "Collisions not checked" from the measurement's table write; the idle check ran after the quiet window.</li></ul> |
| 1 / d (fast, confirmed) | `abort` | <ul><li>`rfl.cancelled by abort`.</li><li>The wait ends `aborted` (waited 0.033 s; it was in its first sleep).</li><li>No spindle, no AUTO, no `run_basis.start`.</li><li>`rfl.flag_cleared` +2.37 s.</li><li>The table parse the drift tick had just spawned was discarded by the flag clear's MDI after the abort and restarted (`discarded:mdi`, published +2.9 s).</li></ul> |

The bound and the early end were not exercised natively. There is no test variable to force them; they are unit-tested (section 4).

### 1.3 What the spike adds to step 0

- **F14-2.** Codex's sequence held natively; see the summary.
  - The hold is the wait's dominant term **only** while it is live at the wait's start: apply → wait start was 19.4 s and 22.9 s.
  - The cap ends at the first drift evaluation after 30 s: 30.9–31.5 s after the anchor.
  - Not seen in any run: a read-back during an RFL, or a basis relabelled `confirmed`.
- **The F4 near-tie happened** in 2 of 9 measuring RFLs (run 1 a2, c):
  - the idle drift tick hit the ≈ 2 s gap after the `#3116` step (2.004 / 2.007 s after its end) and scheduled a table parse;
  - the positioning ended it: refused at its begin (`why: running`) in a2, superseded by generation in c;
  - the wait's first poll said `a parse runs or is pending`;
  - in a2 the table parse was scheduled again after the positioning's quiet window and published.

  Without the wait this is the machine day's unverified start.
- **N-F1, the assumed state is narrower than v3 assumed.**
  - Run 1's first a1 met a basis the read-back had confirmed 1.7 s after the load's publication. The load was made in MDI (BG-03: no AUTO pre-step).
  - Run 2 reached the assumed state only by loading A from AUTO, after a run of program C.
  - Realistic cases:
    - a program loaded right after a run, the operator then choosing RFL;
    - an RFL sent within about 2 s of a load;
    - the machine day's state (not traced).
- **N-F2, the page during the hold.**
  - Run 2 a1: the page dropped its result at the measurement's table write (+5.2 s).
  - During the wait it ran its idle check on the **old** publication after its decision fallback (sweep start 10.9 s before the write). It showed "Clear · checked to the end" from +21.6 s.
  - Then "Collisions not checked" from +32.95 s (0.7 s after the write) through the run.
  - Section 3's path 2 replaces that run-time "not checked" with the check of the verified publication. The idle fallback check during the wait is unchanged P2b behaviour, named here only.
- **No publication or basis change between the wait's exit and the write** in 7 of 7 verified exits. The window is 116–154 ms to the record plus about 21 ms to the write. The guard for a change in that window is therefore a unit test with fakes (U10); natively it cannot be provoked without a test variable.

## 2. The gateway (v4)

**G1. One start check.**
- `_start_verdict(file, source)` → `(verified, why, against)`.
  - It calls `_bulk.run_start_check(file, _stat_now(), source, open_drift=_ts_open_drift())` once.
  - `against` is the publication the check compared with: `preview_version`, `published_program`, `published_source`. It is read in the same synchronous step, with no await, and is `None` unless verified.
- The wait and `_begin_run_basis` both call it, after their own fresh `stat.poll()` and their own text hash. "The same arguments as `_begin_run_basis`" therefore holds by construction (spike: `gateway.py` `_start_verdict`).

**G2. Phase `preview`.**
- It sits in `_rfl_sequence` after the positioning and `_rfl_entry_reached`, before the existing `still_bound()` and the spindle start. It runs on every RFL path (with or without `pre_tool`).
- `"preview"` joins `_RFL_UNDECIDED`, so a cancel in it reports `aborted` (`_rfl_finished`).

**G3. The wait** (`_rfl_preview_wait(program, bound_s=None, clock=time.monotonic, sleep=asyncio.sleep)`, as in the spike):
- **One deadline**, taken once at the wait's start (`RFL_PREVIEW_BOUND_S`, Q1). Polls, publications and failed polls never move it.
- **Each poll:**
  1. One `program_source` hash of the loaded file in a thread. It serves both the binding (`_rfl_unbound_why(identity, loaded, source)`) and the check.
  2. Unbound → phase `program_changed`, return False: nothing further runs, and `finally` clears the flag.
  3. `stat.poll()` + `_start_verdict` → verified → return True.
  4. The early end (G5) → return True.
  5. The bound → return True.
- **Between polls:** `RFL_PREVIEW_POLL_S` = 1 s, or at once after a publication.
  - The spike looked at `_bulk.preview_version` every 50 ms; publication → exit was 8–42 ms.
  - **Product:** an `asyncio.Event` set from `_bulk.on_job_end` when the end is `{"published": …}`. It is chained with the existing `_dd_job_ended`, never replacing it.
- **No lock and no input action held** (unit U7). The idle drift parse, P2b's restart and the other clients run. An Abort or E-Stop cancels the plain await (`_preempt_inflight` → `rfl.cancelled`), and `CancelledError` is never swallowed.
- **Traces:**
  - `rfl.preview_wait {edge: start, bound_s, version, round, ts_version}`;
  - `rfl.preview_poll {n, why, version, waited_s, ts_version}` on each **new** why;
  - `rfl.preview_wait {edge: end, exit: verified|program_changed|early|bound|aborted|error, why, polls, waited_s, version, ts_version}`.

**G4. After the wait the start decides again** (R461: the wait's verified answer never pre-empts the start proof).
- `_begin_run_basis` runs `_start_verdict` again at the record.
- The message follows the **record's** result:
  - verified: none beyond the phase;
  - not verified: "Run from line started without the run check — \<why\>". It goes to the message center (`notify`, warn) and to the trace (`rfl.started_unverified {why, run_id}`).
- After the bound the sequence goes on, and the record's check decides (it may verify on a late publication).

**G5. The early end** (unchanged from v3, as built in the spike: `_rfl_preview_early_end(pid0, round0)`). Both must hold:
- a drift decision of a **later** round names a parse job of **this** load (`_active_program_id()` at the wait's start);
- that job ended unpublished with `refused:*` or `ended` (`_bulk.last_unpublished_end` for that job).

Not an early end: `cancelled:*`, `discarded`, `verified_same`, the round the wait began in, or another load's job. Unit-tested only (U6).

**G6. `verified_against` (F14-1).**
- When `verified`, the record's `program_id`, `version` and `source` are taken **from `against`**, the check's own read. Then `verified_against` = `{program_id, version, source, ctx_digest, tool_basis_rev}` is **projected from the record**. It is `null` when not verified, and never filled from anywhere else.
- The spike kept today's field sources and traced `run_basis.against_mismatch` on any difference. None occurred in 7 verified records.
- `run_check_wire.json` gains the key (the spike did this). `test_command_dispatch` holds the wire.

**G7. `start_line` in the record — a PROPOSAL for Codex to decide** (it rests on P4's code reading and changes path 1's behaviour for RFL runs).
- The AUTO_RUN line from the write's own `args` (0 for Cycle Start and Step), recorded by `_begin_run_basis`'s caller in `_cmd_blocking`, where `args` are known.
- It is a fact of the write, not a copy of another field. The page's run check uses it (section 3, P4).

**G8. `run_basis.written` stays** (trace only).
- Emitted in the write thread right after the AUTO call returns, before `state = "sent"`: `{run_id, version_now, tool_basis_rev_now, ts_version_now, refresh_running, reparse_pending}`.
- Timing statements use "record" (`run_basis.start`) and "write" (`run_basis.written`), never one for the other (R461 F14-1 last paragraph).

**G9. Words.** `statusStore.ts` `phaseText.preview = "Run-from-line: waiting for the preview…"`, plus the function inventory entry if its guard names phase words.

**Not changed:**
- `ACTION_QUIET_S` and the 2 s grace in `_rfl_wait_interp_idle` (the near-tie is now cured by the wait);
- the P2a hold (choice (i) of v3: `_rfl_busy()` keeps blocking the read-back; the hold ends by its cap inside the wait);
- Cycle Start never waits (Q2).

## 3. The page — the second admission path (MT-F14-P, R461 F14-1)

**P1. Parse.** `RunBasis.verifiedAgainst: {programId, version, source, ctxDigest, toolBasisRev} | null`.
- It is non-null **only** when `verified === true` and every field equals the record's own field.
- An inconsistent one parses to `null`, so path 2 refuses with "start proof inconsistent". It is never trusted half.

**P2. `admitRunCheck` has two paths, tried in order.** It is still pure.
- **Path 1 (unchanged):** a pinned origin with `forRun` of this run (`runId`, `ctxDigest`, `toolBasisRev`), the basis not moved since, plus the existing identity checks.
- **Path 2 (new): an unpinned origin, only with the explicit start proof for exactly this publication.** Every one of these must hold:
  1. A run is in progress (`runInProgress` on the same frame), `run.state === "sent"` and `run.verified`. An unsent or sending run, or an unverified one, is refused (R461: a refused or aborted write gives no usable `sent`).
  2. `run.verifiedAgainst !== null`.
  3. `origin.pinned === false`. A pinned origin is judged by path 1 only.
  4. `origin.version === run.verifiedAgainst.version`, **and** `shownVersion === origin.version`, **and** the shown payload adopted (`publishedVersion`, not basis-pending, not decoding). This is the "matching shown payload".
  5. `origin.programId === run.programId === shownProgramId`, all non-null. That is the same LOAD, and through the program id's epoch prefix the same gateway instance. A reload of the same file name is another program.
  6. `origin.file === run.file === shownFile`.
  7. `origin.source === run.source === run.verifiedAgainst.source`, all non-null.
  8. `origin.toolBasisRev === run.toolBasisRev === run.verifiedAgainst.toolBasisRev`, **and** `origin.toolBasisRevNow === origin.toolBasisRev`. That is the tool basis including its current revision.
  9. **The connection:** both `runBasis` and `previewOrigin` come from the current connection. Today `statusStore` keeps both through a disconnect until the next frame; v4 clears both on `connected=false`. That plus (5) binds them to the connection and the gateway instance.
- **Same version number alone never admits** (a test case, C2).
- **`ctx_digest`:** an unpinned origin carries none, and none is added. `pinned_ctx` is a pure function of the publication (`published_ctx` / params / rotary seed / tlo) and of `tool_basis`. Every change of `tool_basis` bumps `tool_basis_rev`. Equal `(version, tool_basis_rev)` therefore imply the run's digest, pinned by a gateway unit test (U11b). There is no second field filled independently.

**P3. Build from the record.**
- `basisFromRun(rb, payloadToolBasis)` as today: the start joints, the fixture terms and the tool at the start from `run_basis.start`, never the live status.
- Path 2 changes no basis code. It changes only the admission.
- A start proof is not a check result: the page still runs the check and shows its progress. "Run check" words as path 1, with telemetry `collision.run_check_start {path: "verified_start" | "pinned"}`.

**P4. The RFL range (R461 "ggf. RFL-Bereich", N-F3) — a PROPOSAL for Codex to decide**, not settled: it rests on a code reading and changes existing behaviour (path 1 too).
- **Today (code reading):** the run check's provisional range starts at the run playhead's attached segment. The **full** sweep that replaces it covers the whole track (`ThreeViewer.vue` 3761–3767, no `range`). An RFL's skipped lines 1..N−1 are therefore checked as if they ran.
- **v4:** with `run.startLine > 0` both sweeps take `range.from` = the first track point at or after line N. The start-dependent beginning binds the record's start joints to N's first point. The part before N is named "not run (run from line N)", not checked.
- This holds for **both** paths: the same record field.

**P5. No page is a precondition of a start.**
- The gateway never waits for a page (v3's option b stays rejected).
- A page that connects only during the run, switches its simulation on only during the run, or starts its check late, is admitted by path 2 as long as conditions 1–9 hold. The `run_basis` and `preview_origin` ride every frame.

## 4. Guards

**Native** (`native_run.py … --variant f14`, from the spike driver; the page probe judges the **page words** and the run-check telemetry):

| | Case | Base `6c78780c` | Head (gateway + page) |
|---|---|---|---|
| N1 | assumed basis (prep: a run, load in AUTO), fast measurement — the run-2 a1 shape | `verified:false` "drift open: toolsetter" (step 0 control-a2) | <ul><li>`held` + `edge_held` inside the wait;</li><li>`hold_ended cap`;</li><li>a parse publishes;</li><li>wait exit `verified`;</li><li>record `verified:true` naming that version;</li><li>no `toolsetter.read_back*`;</li><li>`#3014` still `assumed`;</li><li>`collision.run_check_start {path: verified_start}` and no `run_check_refused`;</li><li>the Sim tab shows the run check's words (never "Collisions not checked") from the first attempt to the run's end.</li></ul> |
| N1b | the same, step-0 values (cap passes in the measurement) | unverified | wait ≈ 2–3 s, then as N1 |
| N1c | the same with `#3102` planted 1 mm off, so the measurement really moves the table row | unverified | as N1 (not run in the spike) |
| N2 | confirmed basis, the values read (run 1 b) | unverified "another tool start" | as N1 without the hold |
| N3 | near-tie (run 1 a2): first why `a parse runs or is pending` | unverified, same why | verified after the restart; as N1. Not forced: it is recorded whenever the first why is that. |
| N4 | no pre-measurement (run 1 e) | verified | wait exits at its first poll (< 0.1 s); no run-check event needed |
| N5 | the text changed on disk in the wait (run 1 c), plus a `load_file` in the wait | — | <ul><li>the load is refused "Run from line is starting — abort it first";</li><li>`program_changed` at the next poll;</li><li>no spindle, no AUTO, no `run_basis.start`;</li><li>`rfl.flag_cleared`.</li></ul> |
| N6 | Abort in the wait (run 1 d) | — | `aborted`; nothing starts; flag cleared |
| N7 | a second page opened only after the write | — | path 2 admits on it; its Sim tab shows the run check |
| N8 | simulation switched on (Settings → Devices) only after the write | — | path 2 admits |

The bound (N7/N6 of v3) and the early end are **not** native cases: no test variable (F14-3). They are in U5/U6.

**Gateway unit** (`test_rfl_preview_wait.py` + `test_rfl_guard.py`; injected clock and fakes):

| | Asserts | Spike |
|---|---|---|
| U1 | the order: measure, flag, safe Z, positioning, **wait**, still_bound, spindle, AUTO (a recording `_SeqHarness` that also records the wait) | the harness stubs the wait; the order assert is owed |
| U2 | exit only on verified (`drift open: toolsetter`, `a parse runs or is pending`, `another tool start`, `drift open: table_mtime`, then verified → exactly 5 checks) | ✓ |
| U3 | text changed / another program loaded → `program_changed`, False, no check of another program | ✓ |
| U4 | a cancel propagates (`aborted`) | ✓ |
| U5 | the bound starts once: a publication on every sleep does not extend it; it ends at `bound` (± one wake); without a publication one check per second (11 checks in 10 s) | ✓ |
| U5b | after the bound, the record decides both ways, and the message follows the record | owed |
| U6 | early end: `refused:*` / `ended` of this load in a later round → early; **none** for `cancelled:*`, `discarded`, `verified_same`, the same round, or another load's job | ✓ |
| U7 | no `_cmd_lock` while waiting: another holder takes it during the wait | ✓ (red by hang; product: `asyncio.wait_for` so it fails as an assertion) |
| U8 | one `program_source` per poll | ✓ |
| U9 | `_begin_run_basis` and the wait call the same `_start_verdict` (spy) | owed |
| U10 | a publication V+1 between the wait's verified exit and the record → the record names V+1; a tool-table change in between → unverified with its why; a refused or failed write → `state` unsent, path 2 never admits | owed |
| U10b | a program whose scan writes a toolsetter basis key: the AUTO write's own pre-booking (`_ts_mark_assumed`, before `_begin_run_basis`) makes the record `drift open: toolsetter` after a verified wait exit, and the message names it (R2) | owed |
| U11 | `verified_against` is the projection of the record, `null` when unverified or when `ctx` is None, and never differs from `against` (the record's fields are taken from it) | partly (projection ✓, `against` traced) |
| U11b | same `(version, tool_basis_rev)` ⇒ same `ctx_digest` of `start_ctx`; a verify that moves the basis bumps the rev | owed |
| U12 | `start_line` = the AUTO_RUN arg, 0 for Cycle Start / Step | owed |

**Client unit** (`checkBasis.test.ts`, `runBasis` parse tests, the wire fixture):
- **C1:** path 2 admits a verified, sent, running run with an unpinned origin equal to `verifiedAgainst` on screen.
- **C2:** path 2 refuses each of the following, one at a time:
  - an unverified run; an unsent run; a sending run;
  - `verifiedAgainst` null; `verifiedAgainst` inconsistent with the record;
  - origin V+1 while the run names V; shown V while the origin is V+1;
  - a payload not adopted yet;
  - another program id with the **same file name** (the foreign publication);
  - another gateway epoch;
  - another source;
  - `toolBasisRev` differs; `toolBasisRevNow` moved;
  - **only the version equal**, everything else different;
  - a pinned origin without `forRun` (path 1's own refusal stays).
- **C3:** the basis comes from the record (start joints), not the live status. The range starts from `startLine` for an RFL, for both paths.
- **C4:** `runBasis` and `previewOrigin` are cleared on disconnect.

**Browser e2e** (mock gateway: `verified_against` and `start_line` in `mock-gateway.mjs`, the same commit, per the memory rule on new wire fields):
- a run with an unpinned verified origin → the run check starts and the Sim tab shows its words;
- a page that loads mid-run;
- simulation switched on mid-run;
- the late check (the page busy, then free);
- refused for unverified, unsent, a foreign publication with the same name, and version-only.

## 5. Mutations

| | Mutation | Red at | Spike |
|---|---|---|---|
| M1 | no wait | N1, N2, U1 | — |
| M2 | exit on any answer but `a parse runs or is pending` | U2, N1 (base why `drift open: toolsetter`) | **red** (U5/U2) |
| M3 | the wait after the spindle start, or before the positioning | U1 | owed with U1 |
| M4 | the bound writes `verified`, or skips the record's check | U5b, U10 | owed |
| M5 | no binding check in the wait | U3, N5 | **red** |
| M6 | early end not bound to this load / to a later round | U6 | **red** (both) |
| M7 | early end on `cancelled:*` / `discarded` | U6 | **red** |
| M8 | the wait under `_cmd_lock` | U7 | **red** (by hang) |
| M9 | the bound restarts with each poll or publication | U5 | **red** (by hang) |
| M10 | two text hashes per poll | U8 | **red** |
| M11 | `verified_against` filled when unverified, or from live state instead of the record | U11, C2 | owed |
| M12 | path 2 admits on the version alone | C2 | owed |
| M13 | path 2 ignores `toolBasisRevNow` | C2 | owed |
| M14 | path 2 ignores the program id (foreign publication, same file name) | C2, e2e | owed |
| M15 | path 2 builds from the live status instead of the record | C3 | owed |
| M16 | the full run sweep ignores `startLine` | C3 | owed |
| M17 | `runBasis` / `previewOrigin` kept through a disconnect | C4 | owed |

The spike's mutations are 8 of 8 red (`~/claude-work/p6d/f14/mut/mutations.log`); M8 and M9 are red by the 90 s timeout. In the product, U5 and U7 get a `wait_for` bound so that those mutants fail as assertions.

## 6. Q1 — the bound, with the measured numbers

**Measured on the VM** (20,016 lines; wait phase only; the measurement before it is 10–112 s):

| Situation | Wait | Made of |
|---|---|---|
| no pre-measurement | 0.001 s | the first poll |
| confirmed basis, or the hold's cap already passed | **2.40–2.81 s** | <ul><li>`ACTION_QUIET_S` after the positioning: 2.0 s;</li><li>the drift parse at nice 19: 0.36–0.77 s;</li><li>≤ 42 ms to the exit.</li></ul> |
| assumed basis, hold live at the wait start | **8.75 s, 12.61 s** | <ul><li>the hold's remainder: 8.07 s, 12.11 s. The cap is 30 s from the apply plus ≤ 1.5 s to the next drift evaluation;</li><li>the parse: 0.45–0.66 s.</li></ul> |

After the wait: exit → record 116–154 ms, record → write 21–38 ms.

**Formula:**

  wait ≈ max(positioning end + 2.0 s, apply + 30 s + ≤ 1.5 s, if the basis is assumed) + drift parse + ≤ 50 ms

**The N100 is owed, not measured. There is no N100 number for this wait.**
- The only N100 parse number is the machine day's: 30 s for the machine-day program, at **nice 0 under motion**, at `98748fab`. That is not comparable to a drift parse at nice 19 at standstill beside the page's check.
- Put into the formula as an **unproven estimate**, it gives about 32 s on a confirmed basis, and up to about 52 s on an assumed basis after a 10 s measurement.
- R461 F14-2: an estimate like this does **not** establish the 90 s bound, and this plan does not claim it does.
- The bound is the operator's decision (Q1), asked with the VM numbers above and with the N100 named as unmeasured. At the bound the start goes on, and the record's check decides (R456).

**For the operator** (Claude asks; Codex does not): "Run from line waits for its preview after positioning — on the VM 2.4–12.6 s; on the machine not measured yet — at most N s, then starts; if the preview is still not ready the run is not checked and the message says so. Which N (the spike used 90 s)?" Q1 stays the operator's decision (R461 F14-2); the N100 measurement is owed for it.

## 7. Risks

- **R1, the page's check CPU now runs during motion.**
  - Path 2 starts the run check 0.7–3.9 s after the write. Before, the page did no work during the run, because it refused.
  - On the N100 (2 non-RT cores; F7's 79 s cold BVH) that is the same work moved into the run, beside LinuxCNC's task.
  - Measure on the machine; the sweep's existing pauses (camera, hidden tab) apply.
- **R2, programs that write toolsetter keys.**
  - `_ts_mark_assumed(_ts_program_writes())` books at the AUTO write **before** `_begin_run_basis`. A program whose scan writes a basis key gets a new booking version between the wait's verified exit and the record, so the record says `drift open: toolsetter`.
  - Such a program can never start verified, waiting or not. Not seen for program A: no booking at the write.
  - v4 names it in the message and adds a unit case (U10b). No change to the rule.
- **R3, the hold stretches the wait.**
  - On an assumed basis with a short measurement the wait can reach about 30 s on its own (VM: 12.6 s after a 15 s measurement).
  - It is bounded by the cap and counted in Q1. N-F1 shows when that state arises.
- **R4, the near-tie can still cost a restart.** It costs the quiet window plus one parse (run 1 a2: 2.8 s); it no longer costs verification.
- **R5, the idle fallback check during the hold** (N-F2) shows "Clear · checked to the end" on the old publication for up to the hold's remainder.
  - This is unchanged P2b behaviour, but the operator sees it during the wait.
  - Codex may want the page to name the preview as being re-made while `rfl_status.phase == "preview"`. The proposal is to name it only, not change it here.
- **R6, a page that never adopts the payload** (decode failure) stays "Collisions not checked". Path 2 requires the shown payload, by design.
- **R7, P4 changes the run check's range for RFL runs on path 1 too.** That is a behaviour change for pinned mid-run parses of an RFL run. It is held by C3 and an e2e case.

## 8. Not verified

- **The N100:** the wait's real duration, the niced drift parse beside the page's check, and R1's CPU.
- **The page's second path:** not built in the spike. The native page words with path 2 (N1, N7, N8) are owed. Every page result here is the base page.
- **The bound's expiry and the early end:** unit only, by design (F14-3).
- **A publication or basis change between the wait's exit and the record** (U10): 0 of 7 natively, and not provokable without a test variable.
- **A measurement that changes the table row** (`#3102` planted, N1c): not run. This sim re-measures the stored row (0.67–4.8 µm per measurement here).
- **The machine day's exact basis state** at its RFL (assumed or confirmed): not traced. N-F1 says which loads lead to which.
- **P4's claim** that the full run sweep covers skipped RFL lines: from code reading (`ThreeViewer.vue` 3761–3767), not observed in a run.
- **The 1.5 s between the cap and the hold's end:** observed as the drift evaluation's cadence; the cadence itself was not traced.
- **An unload during the wait:** not tried. Only `load_file` was tried natively (refused). From the code, `_rfl_busy_reason` refuses an unload the same way.
- **The base comparison** ("unverified at the base") rests on step 0's record (`maschinentag.r461.p6d-step0-6c78780c.json`). It was not re-run beside the spike.
- **"The read-back stays inadmissible"** means that no read-back attempt was traced during the RFL: it was not due (`_ts_read_back_due` → False while `_rfl_busy()`). No attempt was made and refused.
- **"Aborted within 33 ms"** is the time from the wait's start to the abort's arrival. The cancel itself took about 1 ms (`rfl.cancelled` 17.222 → phase `aborted` 17.223).
- **The page's own tests against the changed wire fixture:** `checkBasis.test.ts` and `statusStore.test.ts` passed (55 tests). No other frontend suite, and no build of the spike tree, was run outside the native stage's own `npm run build`, which succeeded twice.

## 9. Files

**Gateway:**
- `lcnc-gateway/gateway.py`: `_start_verdict`, `_rfl_preview_wait`, `_rfl_unbound_why`, `_rfl_preview_early_end`, `_RFL_UNDECIDED`, `_begin_run_basis` (`verified_against`, `against`), `_cmd_blocking` (`start_line`, `run_basis.written`), the publication event chained onto `_bulk.on_job_end`.
- `lcnc-gateway/test_rfl_preview_wait.py` (new), `test_rfl_guard.py` (U1 with the wait recorded), `test_command_dispatch.py`, `test_bulk_pipeline.py` (U11b).

**Wire:** `scripts/test_fixtures/run_check_wire.json` (`verified_against`, `start_line`).

**Page:**
- `lcnc-webui/src/runBasis.ts` (parse);
- `viewer/checkBasis.ts` (path 2);
- `ThreeViewer.vue` (`_startRunCheck` passes the shown payload's adoption; the range from `startLine` for the provisional and the full sweep);
- `ws/statusStore.ts` (clear on disconnect; `phaseText.preview`);
- `checkBasis.test.ts`, `runBasis` tests, `statusStore.test.ts`;
- `e2e/mock-gateway.mjs` + a collisions e2e spec.

**Native:** `scripts/native_run.py` variant `f14` (the spike driver's cases, the page probe), with `scripts/test_native_stage.py` offline guards.

**Selector and inventory:** `scripts/test_select/rules.py` (the new test file), and the function inventory if the phase word or the wire key is an atom.

**Docs:**
- `docs/architecture/scrub-and-run.md` "the check during a run": two paths, the record's `verified_against` and `start_line`, record vs write;
- `docs/decisions.md`: the wait, F14-1/2/3, Q1 once answered;
- CLAUDE.md's short form only if a listed rule changes (the GcodePanel/RFL lines do not name the phases).

## 10. Order of work

1. **Gateway** (G1–G9) + U1–U12 + the native N1–N6 with the base page. The page words then still say "not checked" (expected; it is the gateway half).
2. **Page** (P1–P5) + C1–C4 + e2e + the native N1, N7, N8 with page words. This is where MT-F14-P closes.
3. **Docs**, then one round gate per step; the merge gate on the integrated head; the N100 numbers on the next machine day (Q1 answered before step 1 merges).

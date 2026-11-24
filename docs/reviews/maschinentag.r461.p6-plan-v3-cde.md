# P6 plan v3 — F14, F8, F6 (for Codex R461)
Three local plan files, concatenated unchanged except anonymization of the operator's program name. Code sites at development `6c78780c`.


---

<!-- P6-d (F14) — plan v3 -->

# P6-d (F14) — detail plan v3, the F14 part (after Codex R456 and build step 0)

**Scope.** Code sites are at development `6c78780c` (worktree `/home/cnc/lcnc-suite-p6d`, branch `plan/p6d`), with P6-a and P6-b merged. This file replaces the F14 section of `docs/reviews/maschinentag.r456.p6-plan-v2.md`. It takes in Codex's R456 direction comments on F14 and Fable's step-0 rule (the control first). **Plan only, no product code.**

**Evidence.**
- Record: `docs/reviews/p6d.step0-6c78780c.json` on `plan/p6d` (two native runs, token-scanned).
- Local driver, never committed: `~/claude-work/p6d/f14/`.
  - `p6d_native.py`: the cases, on the native stage's machinery.
  - `p6d_probe.mjs`: a real page that watches.
  - `analyze.py` and `mkrecord.py`.
- Runs:
  - `runs/20261124T132256-f14`: control-a, red, control-b.
  - `runs/20261124T133642-f14-cure`: cure-wait, cure-race, control-a2.
  - A first attempt, `runs/20261124T132054-f14`, failed in the driver itself: the page probe's ready step, before any case. Its restore is complete.

**Where it ran.** On the **VM**, not the N100. The VM's real LinuxCNC runs the 3-axis sim profile in a confined copy of the run tree at 6c78780c. Every restore and restore-post is `complete`.

## Summary

| | |
|---|---|
| **The control (Fable's step-0 rule)** | **The named control cannot be built.** "Measurement, table unchanged" needs a re-measured length equal to the stored one within the start check's epsilon of 1e-9 (`TLO_BASIS_EPS`). The probe moved T1 by 0.45 µm, so that RFL starts unverified like every measuring RFL. |
| | **The fallback control holds.** An RFL without a pre-measurement starts `verified:true`: the safe Z, the positioning, the spindle start and the AUTO switch leave a start verified. |
| | **The cure holds when emulated outside the sequence, for the start and table terms.** Measurement by MDI → its drift re-parse publishes → RFL without a pre-measurement: `verified:true`. A start 0.15 s after that publication is verified too. **The planned wait therefore leads somewhere.** |
| | **Scope of the cure.** It was shown on program B, which has no M600, so the toolsetter term can never be open and no read-back is ever due there. control-a2 shows that this term is live for the machine-day shape. Its cure inside the wait is from the code (section 3); build step 1 must show it (N3). |
| **The measuring RFL at the base** | Unverified in 3 of 3. The why at the AUTO write is `another tool start` (2×) or `drift open: toolsetter` (1×). Neither of v2's two candidates appeared: `a parse runs or is pending` and `drift open: table_mtime`. |
| | The why depends on the order of `run_start_check`'s terms and on timing, which is why the wait's exit is the full check. |
| **Under the run** | A mid-run **pinned** parse (`midrun:table_mtime`, nice 19, bound to no run) is spawned 0.11–0.12 s after the AUTO write and publishes mid-run. The page refuses its run check, and shows "Collisions not checked" from about 1.3 s after the measurement's table write through the whole run. |
| **New, plan-changing** | **`verified:true` is not what the operator sees.** A run that started verified 0.15 s after the publication still showed "Collisions not checked" for the whole run. The page had not started its check yet, and `admitRunCheck` refuses an unpinned origin ("not a parse made during the run"). The gateway's wait cannot cover the page. → **Open finding MT-F14-P** (section 4), for Codex to decide. |
| **The P2a hold** | `gcode.reparse_toolsetter_held` did not appear. That is **not exercised**: the idle drift block was never evaluated between the measurement and the start. |

---

## 1. What step 0 ran

**The program** (written into the copy; the head is `p6d_rfl_a`, 20,016 lines):

| Lines | Content |
|---|---|
| 1–6 | `G21 G90 G94 G17 G54`, `T1 M600` (line 3), `S1000 M3`, `G0 X100 Y100`, `G0 Z-100` |
| padding | 20,000 `G1` lines, parsed but skipped by the run |
| | `G0 X100 Y100` |
| N = 20008 onward | `G61.1 G1 X200 F3000` …, about 25 s of motion at the safe height, then `M2` |

Program B is the same program with line 3 replaced by a comment. On the VM a parse of it takes 0.35–0.62 s: 0.385 s for the load at nice 0, 0.35–0.62 s at nice 19.

**Every RFL** is ONE `auto_run` as the dialog sends it:
- line N, with the published version, source and program id;
- spindle forward at 1000;
- `safe_z`, and the entry X100 Y100 in G54 G21;
- with `pre_tool=1`, the toolsetter section's values.

The M6 helper serves its tool changes.

**Before each case** (unless the case names otherwise):
- no parse running;
- the drift decision not `pending`;
- the interpreter idle for 4 s;
- the page showing the published version.

**The page.** Chromium headless runs with the device's simulation ON and Sim mode off, on the Sim tab, never armed. It samples the Sim tab's summary line and the bar's check slot every 200 ms. Its telemetry (`browser.collision.*`) lands in the gateway trace.

| Case | What |
|---|---|
| control-a | Program A. The RFL measures T1, whose stored length is a measurement just made (the task's named control). |
| red | T1's row planted +0.5 mm by `save_tool`, its re-parse published, then the same RFL. |
| control-b | Program B. RFL **without** a pre-measurement (`pre_tool=0`). |
| cure-wait | Program B. `T1 M600` by MDI, its drift re-parse published, the page's check done, then RFL without a pre-measurement. This is **the planned wait, emulated outside the sequence.** |
| cure-race | Program B. `T1 M600` by MDI, then a plain `auto_run` from line N **the moment** the re-parse's version arrives. This is the head's timing as the page sees it. |
| control-a2 | Program A again. The measuring RFL, a third sample. |

## 2. Observed facts (VM, 6c78780c)

Times are seconds from each case's start mark, on the gateway trace's wall clock.

| Case | `run_basis.start` | Positioning end → AUTO write | Mid-run pinned parse | Page during the run |
|---|---|---|---|---|
| control-a | `verified:false` "another tool start" | 136 ms | spawn +0.12 s after the write, published +0.51 s | `run_check_refused` "the run's start is not the preview's (another tool start)" at +3.0 s; "Collisions not checked" from 23.4 s (table write 22.0 s) to after the run |
| red | `verified:false` "another tool start" | 216 ms | +0.12 / +0.73 s | the same, refused at +2.8 s |
| control-a2 | `verified:false` "drift open: toolsetter" | 65 ms | +0.12 / +0.77 s | refused "(drift open: toolsetter)" |
| control-b | `verified:true` | 64 ms | none | "Clear · checked to the end" throughout; no run-check event at all |
| cure-wait | `verified:true` | 44 ms | none | "Clear · checked to the end" throughout; no run-check event |
| cure-race | `verified:true` (0.15 s after the publication) | — (plain path) | none | "Collisions not checked" for the whole run; `run_check_refused` "not a parse made during the run" |

**F1. The tail keeps a start verified.**
- Positioning's observed end → `rfl.phase starting` takes 0–154 ms: the entry check, `still_bound()` (the text hash in a thread) and the spindle start (MANUAL switch and the spindle command).
- `starting` → the AUTO write (`run_basis.start`) takes 43–65 ms.
- Neither step changes what `run_start_check` compares (control-b, cure-wait).

**F2. The named control is impossible with a probe.**
- control-a re-measured T1 at 49.9991 against the stored 49.99955.
- `evaluate_start_drift` compares the applied offset with the published start at 1e-9 (`gateway_util.py:1951`, `1967`).
- G10 L1 rewrote the table file: same inode, a new mtime, new content. Each measurement wrote it twice, about 100 ms apart.

**F3. The why, and why it varies.** `run_start_check` (`bulk_pipeline.py:633`) returns its first failing term, in this order:

| Order | Term | Line |
|---|---|---|
| 1 | `a parse runs or is pending` | 646–647 |
| 2 | `drift open: <open_drift>` (the toolsetter book, `_ts_open_drift`) | 648–649 |
| 3 | … `another tool start` | 672–674 |
| 4 | `drift open: table_mtime` / row | 684–689 |

Observed:
- **control-a, red (run 1).** A read-back had confirmed every key before control-a (`toolsetter.read_back confirmed`, v4). The measurement's changed applied offset decides: `another tool start`.
- **control-a2 (run 2), from the trace:**
  - the run's gateway never confirmed its basis. Every key was `assumed` from the file at its start (v1, `#3014` included); there is no `toolsetter.read_back` anywhere in the run;
  - program A was loaded 4.8 s before the RFL, and no read-back ran in between. The driver's quiet check does not watch for an owed read-back, so this pre-state is part of the result;
  - the RFL's own apply booked v8–v11;
  - at the write, `_ts_open_drift` named `toolsetter` (term 2) before the start term.
- **Inferred, not traced:** `toolsetter_inputs_equal` treats only two fully confirmed inputs as equal, and `#3014` stayed assumed. This is the realistic state of a gateway after a restart.
- After the run the idle parse was a `tool_offset` one (`gcode.reparse_toolsetter_masked by: tool_offset`).
- The machine day at 98748fab showed term 1, by a different mechanism: its parse ran during the positioning.

**F4. The idle block is not evaluated between the measurement and the start, by a margin of milliseconds.**
- There is no `gcode.drift_decision` in that window. The page logged `check_waits why: decision` twice.
- The RFL's steps leave gaps of **1.984–2.013 s** from one step's observed end to the next phase, against `ACTION_QUIET_S = 2.0` (`gateway.py:3962`).
- The cause is `_rfl_wait_interp_idle`'s 2.0 s grace (`gateway.py:6056`) for blocks that never show busy: the `#3116` write and a null safe-Z move.
- In red the window stood open for about 13 ms and no tick evaluated it.
- A tick that lands in it schedules a parse. The next step's MDI write then discards that parse by generation (`reparse_pending`), and the AUTO write says `a parse runs or is pending`. This is a latent path at the head, not observed.
- **The wait's exit must therefore be the full check, never a single term.**

**F5. Under the run.**
- The mid-run table edge (`gateway.py:2170`) fires on the first tick in AUTO, because its 2 s debounce is long past. It schedules a pinned parse with `run=_run_for_pin(...)`, which is `None` for an unverified run (`gateway.py:4391`).
- That parse publishes without `for_run`, and the page refuses its run check.
- After the run's end the idle `tool_offset` verify parse publishes 1.8–1.9 s later (`gcode.verify same:false`).

**F6. The page.**
- It drops its result about 1.3 s after the measurement's table write: the live tool dims changed.
- When nothing publishes mid-run, the page never asks for a run check (control-b, cure-wait). The idle check's result stands for the run.
- When the run starts before the page has started its check on the new publication (cure-race), `_colScheduleAuto` → `_startRunCheck` → `admitRunCheck` refuses with `not a parse made during the run` (`checkBasis.ts:149`). The page shows "Collisions not checked" until the run's end.
- An idle check already running survives a busy interpreter: run 1's sweep 3 finished during the measuring MDI.

**F7. The wait's main component, measured outside the sequence.** After `T1 M600` by MDI:

| Measurement | Routine's observed end → drift re-parse spawned | → published | Parse (nice 19) |
|---|---|---|---|
| 1 | 2.022 s | 2.371 s | 0.35 s |
| 2 | 2.014 s | 2.490 s | 0.48 s |

The spawn waits for `ACTION_QUIET_S` plus a tick, and the reason was `table_mtime`. That one parse cured both the table term and the start term (cure-wait). The P2a hold ended by its 30 s cap at the same tick, because each measurement had taken more than 30 s.

**F8. The P2a hold inside the RFL: not exercised.** From the code:
- The RFL handler books its values `applied` (`toolsetter.basis` v6/v8, v10/v12). Nothing changed the booking during the measurement.
- `_ts_hold_reason` (`gateway.py:6658`) holds only an `assumed` view, for example a fresh gateway whose `#3014` comes from the file. It holds until the read-back's outcome or `TS_HOLD_MAX_S = 30` s after the booking.
- The read-back is **not due while `_rfl_busy()`** (`gateway.py:6544`).
- So inside the wait an assumed basis is held until the 30 s cap.

**F9. Other observations.**
- **The sim re-measures the stored row.** Red's planted 50.4991 came back as 50.498433, 0.67 µm away. The 0.5 mm moved the applied offset against the published start (49.9991 → 50.4984), not the table. **A measurement that changes the table row by 0.5 mm was not exercised.** The start term decides before the table term anyway.
- **Routine durations differ by start height.** Measurements started at the top took 39 s. Those started at Z −30, after a program's end, took 110–112 s. Not investigated; it is the routine's own path.
- **Base timings, table write → publication.** At the base the only publication after a measuring RFL's table write is the mid-run one: 23.7 s (control-a) and 52.3 s (red) after the write. Almost all of that is the routine's remaining part after its G10 L1 (17.3 s / 47.8 s) plus `#3116`, safe Z and the positioning (5.8 s / 3.6 s).

## 3. The verdict on the control

- **The task's control** (measurement, table unchanged) is not buildable. The table and the applied offset move with every real measurement, by 0.45–0.67 µm here. Every measuring RFL starts unverified at this head.
- **The fallback control holds** (control-b), and so does the emulated cure (cure-wait, cure-race). After a measurement, once its idle re-parse has published, the remaining steps start verified. **The planned wait does not merely delay an unverified start.**
- **That cure covers the start and table terms only** (program B: no routine, so no toolsetter term and no read-back). For the machine-day shape, the toolsetter term (control-a2) must be cured inside the wait too. From the code:
  - with an `assumed` basis the P2a hold holds the idle edges, and the read-back is not due while `_rfl_busy()`;
  - the hold ends at its 30 s cap from the apply's booking;
  - then `_ts_drift_reason` asks one toolsetter re-parse (or a table/start parse masks it), which reads the current booking version;
  - so `_ts_open_drift` (`pv == _ts_basis_version`) is cleared even with the basis still assumed.

  Not run.
- **What step 0 cannot show:** a parse publishing *while the RFL task is held at the wait point*. This is from the code:
  - nothing on the idle-parse path depends on `_rfl_busy()` or a live `_rfl_task`;
  - `_restart_wait` reads `_actions_quiet()` plus idle and still;
  - `drift_gate_open` reads idle, still and the debounce;
  - the only exception is the toolsetter read-back (F8).

  It is proven natively by build step 1 (section 5).

## 4. Open finding MT-F14-P — the page can stay "not checked" under a verified start

**Problem.** The wait ends on the gateway's publication. The AUTO write follows within one poll (≤ 1 s) plus 44–216 ms (F1).

To show a check, the page must in that time:
- adopt the payload;
- end its drift-decision wait (≤ 3 s);
- pass its 400 ms debounce;
- start the check.

Here the page started a check 0.86 s after a publication. On the N100 with the machine-day program, a page that is not done before the start is the normal case (F7's 79 s cold BVH). The run then shows "Collisions not checked" for its whole length although `run_basis.start` is `verified:true` (cure-race). The operator's symptom stays.

**Options** (for Codex; my recommendation is (a)):

- **(a) Admit the run check on the publication the verified run started on.** `admitRunCheck` would also admit an **unpinned** origin when all of these hold:
  - the run is `verified` and `sent`;
  - `origin.version === run.version` (`run_basis.version` is the version captured at the write, `gateway.py:4354–4357`);
  - program id and source equal;
  - `toolBasisRevNow === run.tool_basis_rev`.

  It is the same payload the idle check would use, under the run's basis, and the gateway verified it against the controller at the write. Effect: `_startRunCheck` runs the full check from the start, or its provisional range.
  - Frontend only: `viewer/checkBasis.ts`, `ThreeViewer.vue` `_startRunCheck`, `checkBasis.test.ts`; `docs/architecture/scrub-and-run.md` "the check during a run".
  - Cost: the page's check CPU during the run instead of during the wait (the same work).
- **(b) Extend the gateway's wait for the pages.** Rejected: the gateway cannot know its pages (headless, several pages, none).
- **(c) Keep it and name it.** The check runs after the run; the Sim tab says why. This leaves the machine-day symptom for every page slower than the wait.

**Decided either way:** v2's owed live check "`run_check_start` during the run" is wrong when nothing publishes mid-run. It becomes:
- `run_basis.start verified:true`;
- no `run_check_refused`;
- the Sim tab shows the check of the publication the run started on.

## 5. The wait phase (v2 adjusted to R456)

**Place.** In `_rfl_sequence`, after the positioning's `still_bound()` (`gateway.py:6244`) and before the spindle start (`6246`). A new phase `preview` joins `_RFL_UNDECIDED` (`5852`).

**Exit = `run_start_check` itself.**
- It is called with `_begin_run_basis`'s arguments (`gateway.py:4340–4343`): the loaded file, a fresh STAT poll, `program_source` of the text, and `open_drift=_ts_open_drift()`.
- It is polled once per second, and at once after each publication.
- **One text hash per poll:** `still_bound()` already hashes the text (`_rfl_program_changed`, `gateway.py:6038`), and the check reuses that hash. The hash is **not** cached by mtime: `program_source` is a content fingerprint by rule (`gateway_util.py:523`). An 8 MB text costs about 20 ms in a thread.
- F3/F4: the exit is the full check, so it covers every why seen (start, toolsetter, table, a parse pending).

**Each poll:**
1. `still_bound()`. A changed or unloaded program ends the bound sequence with **`program_changed`** (R456 point 1): nothing further runs, there is no unverified start, and the flag clear runs as today. The wait does not handle this itself; the existing path does.
2. `run_start_check` verified → leave the phase.
3. The early end (below).
4. The bound (Q1).

**No lock and no action while waiting.**
- The wait holds no `_cmd_lock` and no input action, so:
  - P2b's restart rule runs the idle parse after `ACTION_QUIET_S` (F7: 2.0 s);
  - other clients keep their commands;
  - the read-back's synch is not blocked by the lock.
- An Abort or E-Stop cancels the task (`_preempt_inflight`, `gateway.py:12538–12543`) → `aborted`. The wait is a plain `await`.

**The bound (Q1).** On expiry the sequence **goes on** to the spindle and the AUTO write. **The write's check decides** (R456 point 2): if the publication arrived meanwhile, the run starts `verified:true`. The wait never sets `verified`, and never a negative either.

**The message follows the ACTUAL result** of `run_basis` at the write:
- verified: no message beyond the phase;
- not verified: "Run from line started without the run check — <why>", in the message log, at `warn` in the trace.

**Early end only for a reason waiting cannot cure that belongs to THIS load** (R456 point 1).
- The wait records, at its start:
  - `_active_program_id()`;
  - the drift-decision round (`_dd_round`).
- It ends early, and proceeds to the start at once (the write's check decides and names the why), only when **both** hold:
  - a drift decision in a **later** round names a parse job of **that program id**;
  - that job ended **unpublished** with a terminal why: `refused:*` (`bulk_pipeline.py:944`) or `ended` (a worker failure or a timeout).
- These are **not** early ends: `cancelled:*`, `discarded` (a restart follows) and `verified_same`. Neither is any error of an older job or another program.
- Without a named job, the bound decides.

**The P2a hold inside the wait** (F8; a decision for Codex):
- **(i) recommended:** keep `_rfl_busy()` blocking the read-back. An assumed basis is then held for at most 30 s after its booking, inside the 90 s bound. On the machine day the measurement itself took about 29 s, so little of the cap would remain.
- **(ii) alternative:** let the read-back run during phase `preview`. Its synch is an input write (class `synch`) that discards a parse in flight, and it adds a writer inside the sequence.

**The near-tie gaps (F4) need no change** with the wait in place. `ACTION_QUIET_S` and the 2 s grace stay.

**Words.**
- `statusStore.ts:677` `phaseText` gets `preview: "Run-from-line: waiting for the preview…"`.
- `lcnc.ts`, only if the phases are typed there.
- The function inventory, if its guard names the phase words.

**Files.**
- `lcnc-gateway/gateway.py`: `_rfl_sequence`, `_RFL_UNDECIDED`, the seam.
- `lcnc-webui/src/ws/statusStore.ts`.
- With MT-F14-P (a): `viewer/checkBasis.ts`, `ThreeViewer.vue`.
- `scripts/native_run.py`: variant `f14`; its offline guards in `scripts/test_native_stage.py`.
- `lcnc-gateway/test_rfl_guard.py`.
- `scripts/test_select/rules.py` for anything new.
- `docs/architecture/scrub-and-run.md`, `docs/decisions.md`.

## 6. The test seam (to hold the RFL at the wait point)

**`LCNC_WEBUI_TEST_RFL_PREVIEW`** is an environment JSON, read once at the gateway's start. It is absent in production: the launcher never sets it, and the gateway traces `rfl.test_seam` at `warn` at start and at each use. It carries two fields.

**`hold_file: <path>`.** While the file exists, the sequence stays in phase `preview` at the wait point, and a verified `run_start_check` is **not** taken as its exit. Every other exit stays live:
- `still_bound()` each poll;
- Abort and E-Stop;
- the early end;
- the bound.

The driver removes the file to release it. The driver acts on a signal: `rfl_status.phase == "preview"`, never a fixed wait.

**`bound_s: <float>`.** Replaces Q1's bound for the timeout guards.

**The native stage passes the variable** through `start_copy`'s env: a named extra for variant `f14` only.

**Build order.**
1. **Step 1, the seam alone** (Codex's "Halt vor dem Spindelschritt", the positive control at the head): the hold at the wait point, no wait logic.
   - Native: a measuring RFL held at the wait point → the driver waits for the drift re-parse's version (F7: about 2.4 s on the VM) → releases → `run_basis.start verified:true`.
   - **Not the easy case.** Use the M600 program (the machine-day shape) on a gateway whose toolsetter basis was **never confirmed by a read-back**: a fresh instance, `#3014` from the file. That is control-a2's state. Otherwise step 1 passes on the start and table terms alone.
   - Step 1 measures what the P2a choice (i)/(ii) costs: the time from the hold's start to the publication, with `gcode.reparse_toolsetter_held` / `_hold_ended` traced.
   - This proves that a parse publishes under the held, busy sequence and that the start then verifies, before the wait is written.
   - Without the hold (the same build) → unverified, as at the base.
2. **Step 2, the wait** behind the same seam.

## 7. Guards

**Native** (`native_run.py … --variant f14`; the driver's shapes from `~/claude-work/p6d/f14/`, the page probe judging the **page words**):

| | Case | Base 6c78780c | Head |
|---|---|---|---|
| N1 | measuring RFL (control-a shape; a second variant with `#3102` planted 1 mm off, as the stage's M600 case does, so the measurement really moves the table row) — **red at base** | `verified:false` (any why), a mid-run pinned parse, `run_check_refused`, "Collisions not checked" through the run | phase `preview` traced, `verified:true`, no mid-run pinned parse, no `run_check_refused`, page words per MT-F14-P |
| N2 | control (no pre-measurement) | `verified:true` | `verified:true`; phase `preview` ends at its first poll (≤ 1 s) |
| N3 | step 1: hold, then release after the publication | — (seam absent) | `verified:true` |
| N4 | program loaded during the hold | — | `program_changed`; no spindle start, no AUTO write, no `run_basis.start`, the flag cleared |
| N5 | Abort during the hold | — | `aborted`; nothing starts, the flag cleared |
| N6 | the bound with the publication present (hold + `bound_s` 3) | — | starts `verified:true`; no "without the run check" message |
| N7 | the bound before the publication (`bound_s` 0.5, no hold) | — | starts at once, `verified:false` with the write's own why, named in the message |

**Unit** (`test_rfl_guard.py`, the `_SeqHarness` fakes):

| | Asserts |
|---|---|
| U1 | The order: measure, flag, safe Z, positioning, **wait**, spindle, AUTO. |
| U2 | The exit only on `run_start_check` verified. Fake answers in sequence: "drift open: table_mtime", "a parse runs or is pending", "another tool start", then verified → exactly one start, after the verified answer. |
| U3 | `still_bound()` false in the wait → `program_changed`; no spindle, no AUTO. |
| U4 | A cancel in the wait → `aborted`; nothing started. |
| U5 | The bound → it proceeds; the message comes from the write's `run_basis`, both ways. |
| U6 | An early end on THIS program's job in a later round with `refused:*` / `ended`. **None** on `cancelled:*`, `discarded`, `verified_same`, an older round, or another program id. |
| U7 | No `_cmd_lock` held while waiting: a concurrent `async with _get_cmd_lock()` acquires during the wait. |
| U8 | One `program_source` call per poll. |
| U9 | The seam: env absent → no hold. Set → only the verified exit is masked. |

**Client** (with MT-F14-P (a)): `checkBasis.test.ts`.
- An admitted unpinned origin equal to a verified run's version and basis.
- Refused for an unverified run, another version, a moved basis, or another program id.

## 8. Mutations

| | Mutation | Red at |
|---|---|---|
| M1 | No wait | N1, U2 |
| M2 | Exit on "no parse running or pending" instead of the full check | U2 (the first fake answer), N1 (the base's why `another tool start`) |
| M3 | The wait after the spindle start, or before the positioning | U1 |
| M4 | The bound writes an unverified basis, or skips the write's check | U5, N6 |
| M5 | No `still_bound()` in the wait | U3, N4 |
| M6 | Early end on any unpublished job end (no program id or round binding) | U6 |
| M7 | Early end on `cancelled:*` / `discarded` | U6 |
| M8 | The wait under `_cmd_lock` | U7 |
| M9 | The seam honoured without its env, or masking other exits | U9 |
| M10 | With (a): admit an unpinned origin for an unverified run | client test |

## 9. Q1 — the bound, with the measured numbers

**Measured on the VM** (20,016 lines, F7): after a measurement the drift re-parse spawns **2.01–2.02 s** after the routine's observed end and publishes after **2.37–2.49 s** (parse 0.35–0.48 s, nice 19).

**Expected wait on the VM.** Inside the sequence the same rule applies after the positioning's observed end: 2.0 s plus a tick, then the parse, then a poll of at most 1 s. That gives about **2.4–3.5 s** for this program. This is an estimate from the measured parts, not run inside the sequence; build step 1 measures it.

**The N100, not re-measured.** The only N100 number is the machine day's at 98748fab: the drift parse of the machine-day program took **30 s** (job 9, 11:32:10 → 11:32:40), **at nice 0, under motion**. Today's drift parses run at nice 19, with the page on the same two non-RT cores; that is not measured. Add:
- 2 s of quiet;
- with an assumed basis (a freshly started gateway, control-a2's state), the P2a hold until its 30 s cap from the apply's booking (F8). The cap counts from the sequence's own apply, so the measurement's duration uses it up: on the machine day the measurement took about 29 s, so little of it would remain.

**Estimated range on the N100:**
- about 32 s when the cap has passed;
- about 32 s + (30 s − the measurement's duration) when it has not: about 50–60 s for a 10 s measurement.

All of this is estimated from the parts, not run.

**Recommendation: 90 s stays.**
- About 32 s is expected for the machine day's shape, and up to about 60 s on a freshly started gateway with a short measurement. That leaves room for a slower niced parse.
- At the bound the start proceeds and the write's check decides (R456). A late publication can still verify, and stopping would force a second measurement.

**Ask the operator** with these numbers: "wait at most 90 s (expected ~35 s for the machine-day program), then start; if the preview is still not ready, the run is not checked and says so".

## 10. Not verified

- **A parse publishing while the RFL task is held at the wait point.** From the code only; build step 1 proves it (N3).
- **The wait's real duration inside the sequence**, on the VM and on the N100.
- **The P2a hold inside the RFL** (an assumed basis during the wait). Not exercised.
- **The latent `a parse runs or is pending` at the head.** The F4 gap race was not reproduced.
- **A measurement that changes the table row** (F9): this sim re-measures the stored row. The build's N1 can plant `#3102` 1 mm off to get one.
- **The cure of the toolsetter term inside the wait** (control-a2's state, an assumed basis): from the code only; N3 must use that state.
- **The slower measurements:** why those started at Z −30 took 110–112 s against 39 s.
- **MT-F14-P on the N100:** the page's timing with the machine-day program.
- **Q2 is unchanged:** Cycle Start never waits. cure-race shows that its page can stay "not checked" even when verified; MT-F14-P (a) would cover that path too.


---

<!-- P6-c (F8) and P6-e (F6) — plan v3 -->

# P6-c (F8) and P6-e (F6) — detail plan v3 (after Codex R456)

**Scope.** Code sites are at development `6c78780c`: worktree `/home/cnc/lcnc-suite-p6c`, branch `plan/p6c`, with P6-a and P6-b merged.

This file replaces the F8 and F6 sections of `docs/reviews/maschinentag.r456.p6-plan-v2.md`. It answers Codex's R456 direction comments on F8 (points 1 and 2) and F6. **Plan only, no product code.**

**Probes and their outputs** (`~/claude-work/p6/`):

- `f8/p6probe-f8-c1.spec.ts`: the c1 red spec.
  - Runs: `f8/run-c1-6c78780c.log` (final), `f8/run-c1-6c78780c.try1.log` (first try).
  - Build: `f8/build.log`, a build at 6c78780c.
- `f8/p6probe.f8counts.test.ts`: the counts probe. Output in `f8/f8-counts.json` and `f8/run-counts.log`, generated programs `f8/P*.ngc`.
- `f8/p6probe.f8hull.test.ts`: the stepped hull's superset check on the native branches. Run in `f8/run-hull.log`.
- `f8-counts.md`: the counts table for Q5.

## Summary

| Part | Cause / state at 6c78780c | Proof | Proposed change (one line) | Sub-package |
|---|---|---|---|---|
| **F8 shape** | While scrubbing, the marker's meta comes from a session cache filled only by the LOADED tool's `tool_meta`. A tool never loaded in the session is a cylinder of its table D. | **Red spec at 6c78780c:** scrubbing past `T13 M6` gives a cylinder, r 0.938 everywhere, length 83.19 (L + 20). **Control:** with T13 loaded once, the same reader sees R 4 at the shank, 3.977 at LCF 47, length 100. | A tool-data store with a **data revision** read under a coherent read rule (gateway change). The sample's tool shows its library shape **only when paired** with the dims it was read with. A bounded, owning shape cache. | **P6-c1** |
| **F8 body** | The collision body is a cylinder of the table D × (L + 20) for every tool. After the D edit, T13 is checked as a Ø1.875 pin. | **Counts** (`f8-counts.md`). On a tapered relief beside two clamps: pin **0** findings, envelope **22**, drawn shape **3**, stepped hull **5**. A Ø3 cutter on a Ø6 shank: pin 0, every shape-based body 2. | The check's body for a tool with a library shape is a **superset of its drawn geometry**, derived from the ONE geometry function. Q5 chooses: the stepped hull (recommended) or the plain envelope. | **P6-c2** |
| **F6** | The header's `(T13 D=1.875 …)` is not compared with the table. | Code reading, machine-day data. | A hint at the tool's row of the Check basis card, bound to the shown publication and its proven text. Units, duplicates and tolerance are explicit. | **P6-e** |

---

## Evidence at 6c78780c

### The c1 red spec (run 2026-11-24, base build of 6c78780c, heavy lock, 1 worker)

**How it reads the scene.**

- An init script installs three.js's own devtools seam: `window.__THREE_DEVTOOLS__` is an EventTarget, and every `Scene` dispatches `observe` at construction. It survives the production bundle; `dist/static/three-*.js` was checked.
- The spec walks the real scene. The marker is the group holding the mesh with `userData.toolVis` (ThreeViewer's rebuild key).
- Radii come from the marker geometries' position attributes, in the marker's frame. No product seam is used and no gated value is read.

**The setup.**

- A head moving X, Y and Z over a table, with no meshes.
- T1 is loaded, with its `tool_meta`.
- `get_tool_table` (through the mock's `replyFor`, followed by a `tool_table_changed`) carries T13: `tapered`, side angle 3.7°, R1, LCF 47, shoulder Ø5.8, shank Ø8, OAL 100.
- The payload has `tlo_events [[3, 0, 0, 63.19, 13]]` and `parse_tlos` with T13 at D 1.875.
- Sim on, the scrub at 75 %.
- Preconditions: `getScrubPose().tool === 13` and `toolVis.r === 0.9375`.

| Test | Result | The marker read |
|---|---|---|
| A control: T13 loaded once (status with `tool_meta`), then T1, then scrub to T13 | **pass** | live: maxR 4, coneR(44–47.5) 3.977, tipR 0.998, zMax 100, 850 vertices; scrub: the same (session cache) |
| B: T13 never loaded | **FAIL (red)** | maxR **0.938**, tipR 0.938, zMax **83.19**, 200 vertices: a cylinder of the publication's D over L + 20 |

**The first try** (`try1.log`) had A failing on a probe bug: `applyState` returns without `joint_pos`, which A did not send before loading T13. It was fixed and rerun, with no product involvement.

### The counts (Q5)

The full table and method are in `~/claude-work/p6/f8-counts.md`.

**Method.**

- One variable only: the synthetic 3-axis scene, two strap clamps and a stock, margin 2.
- The counts come through `sweepCollisions` → `ContactStore` → `buildContactView` → `viewCounts` / `targetAt`.
- Machining is taken from a twin sweep with the stock unflagged.

| P1 · T13 (D 1.875) | Findings (coll. + near) | Sweep time |
|---|---|---|
| pin (today) | **0** | 1.0 s |
| envelope Ø8 (plan v2) | **22** (6 + 16) | 1.1 s |
| stepped hull, 16 slabs | **5** (0 + 5) | 2.3 s |
| drawn lathe (reference) | **3** (0 + 3) | 21 s |

The other rows:

- **P2 end mill Ø6 on a Ø6 shank:** 2 = 2 = 2 = 2. The envelope changes nothing.
- **P2 end mill Ø3 on a Ø6 shank:** pin 0, every shape-based body 2. The pin misses the shank.
- **The body-independent counts:** rapid gouges into the stock are 0 and machining episodes 117 (P1), whatever the body.
- **The old table D 8:** the envelope follows the wrong drawing to 46 findings. F6's hint is its guard.

---

## P6-c1 — the shape: a revisioned tool-data store, the pairing rule, the marker

### Current behaviour (code reading; the red spec above)

**The marker.**

- `ThreeViewer.vue:2724–2771`: while scrubbing, `meta = getToolMeta(scrubTool)`, the session cache `machineAssetCache.ts:188–194`.
- The cache is filled at `ThreeViewer.vue:2762` and `5614`, only from `st.tool_meta`, which the gateway sends for the loaded tool alone.

**`get_tool_table`** (`gateway.py:8795–8813`).

- `parse_tool_table` runs in one thread, then `await`, then `load_tool_library` in another thread.
- No lock.
- Reply: `tools`, `current_tool`, `table` = path + bound instance (`_tool_table_identity`, `gateway.py:5526`). No data revision.

**The writers.** None of the three gateway writer sections lets a reader in coherently.

- `_persist_tool_edit` (`gateway.py:5575–5598`; save, add, delete, renumber):
  1. write the table;
  2. `_reload_tool_table_and_bump()`, which BUMPS the version;
  3. load the library, update it, save it.
- The import section (`gateway.py:3435–3449`): table → reload + bump → library.
- `_save_refreshed_metadata` (`gateway.py:11636–11651`): the library only, then a bump.

The race this leaves:

- A client pinged at the mid-section bump reads the new table with the OLD library.
- This is exactly Codex's point 1, now located in the code: the bump comes before the library write.
- `_cmd_lock` does not help. The handlers hold it, but the read never takes it.

**LinuxCNC writes `tool.tbl` itself** (G10 L1 of an M600).

- The file watch (`_tool_table_watch_step`, `gateway.py:3384–3402`) bumps within about 1 s of the signature change.
- Whether LinuxCNC rewrites in place (fopen "w") or atomically is not verified here; see "Not verified".

**Silent losses on the read path.**

- `parse_tool_table` without `strict` drops a line it does not understand.
- `ToolLibraryStore.load()` (`tool_store.py`) returns the PREVIOUS cache when the file cannot be read or parsed.
- Neither is said in the reply.

### Rule C1-R: the coherent read and its revision (gateway change)

1. **One lock** `_tool_files_lock` (`asyncio.Lock`).
   - Every gateway writer section of `tool.tbl` or `tool_library.json` holds it from before its table write to after its library write. That covers `_persist_tool_edit`'s `section()`, the import's `section()` and `_save_refreshed_metadata`'s `persist()`.
   - The order is always `_cmd_lock` → `_tool_files_lock`, never the reverse.
   - `get_tool_table` holds ONLY `_tool_files_lock`, across both reads. It never waits for `_cmd_lock`, so a long command does not stall the Tools tab.
   - The bump stays where it is: clients learn early, and their read waits for the section's end.
2. **The table read**, in one thread:
   1. Read the bytes from ONE fd, with `fstat` before and after and a `stat` of the path. The read is accepted when inode, `mtime_ns` and size are equal across all three.
   2. Otherwise retry, at most 3 times, 20 ms apart. If it is still changing, reply `ok: false`, "Tool table changing — read again". This is the LinuxCNC rewrite case.
   3. Parse from those bytes. Lines not understood are returned as `unread: [line numbers]`, never dropped silently.
3. **The library read is strict** for this reply.
   - It returns the section for this INI (or the seed, named `source: "seed"`).
   - An unreadable or unparsable file gives `ok: false`. The cached fallback stays for the status loop's `tool_meta`, not for this reply.
4. **The reply adds:**
   - `rev: { table: sha256(table bytes)[:16], library: sha256(canonical JSON of the section)[:16], source: "saved" | "seed" | "none" }`;
   - `version`: `_tool_table_version`, sampled under the lock;
   - `unread`.

   The content revision is what binds. The counter only orders pings.
5. **Rows are as they are today** (`_merge_tool_data`). The reply carries `unread`, the store keeps it, and a tool whose line is unread has no row. How the Tools tab shows `unread` is not part of P6.

### Rule C1-S: the client store

`toolLibraryStore.ts` is ONE reader, shared by the Tools tab, the strip and the viewer. There is one RPC per ping.

**When it reads.**

- After the hello on each connection.
- On each `tool_table_changed` whose version differs from the last one seen.
- On an INI change.

**Which reply applies.**

- Only the newest request's reply applies (sequence number). A reply to an older request is dropped.
- It keeps the Tools tab's existing behaviour: the slow note at 8 s, the end at 60 s, Retry, and "Tool table not read." is never "No tools".

**Per connection.**

- Everything is cleared on close, together with `connKey`.
- A reply whose `table` identity (path, instance) differs from the previous one's resets the history below.

**State words:** `none` / `reading` / `current` / `pending` (a ping is newer than the last good reply) / `failed` (with the reply's error).

**`seen` history.** Per tool, the set of (D, Z) rows (raw: D, and Z with its sign) that coherent replies showed under the store's CURRENT library revision, on this connection. It is reset when the library revision or the identity changes.

### Rule C1-P: pairing a shape with dims (Codex: never an unnamed mix)

**The rule.** A tool's library shape is used with a publication's dims for that tool ONLY when:

- the store has **seen that (D, Z) within ε** for that tool under its current library revision; and
- the store is `current` or `pending`. `pending` is a named older state; see the card.

**What is compared.**

- The publication's **raw** `parse_tlos` row: D, and Z with its sign, in machine units. Never `toolDimsFor`'s output, which takes the magnitude of Z and puts in 6 mm for a missing D.
- The base tool is compared on the status's `tool_diameter` and `tool_table_z` (signed; `tool_length` is only the magnitude). In a run it is compared on `run_basis.start`'s `toolDiameter` / `toolTableZ` (`runBasis.ts:19–21`).

**ε** is the tool-length drift edge's own eps (`evaluate_tlo_drift`, `gateway_util.py`: 1e-4 machine units), for D and for Z. A tighter rule would never pair, for two reasons:

- `parse_tlos` reads LinuxCNC's in-memory table (STAT). The store reads the file's printed digits. After a G10 L1 the two may differ below the printed precision; whether LinuxCNC rounds on save is not verified.
- A difference below the drift eps never triggers a re-parse, so such a mismatch would never be resolved.

**Why this is enough.** Every reply is one coherent state of both files (C1-R). Seeing (D, Z) and the library revision L together proves that the files once held both at once, to within the drift eps. The body built from them is a state that existed.

**Cases.**

- **M600 / Measure Current** (G10 L1 changes Z only): the old and the new Z are both seen under the same library revision. The old publication still pairs, with no churn while the re-parse runs.
- **Edit dialog changes D and type together:** this is a new library revision, and the old publication's row was not seen under it. T13 is **unpaired** until the re-parse publishes the new D. Then it pairs.
- **The operator's machine-day edit** (D 8 → 1.875, library unchanged): both rows are seen under the same revision. The old publication pairs, with D 8 and the library shape, which is the true old state.

**Unpaired** gives today's table cylinder from the publication's dims, and the card says why:

- "shape not read" (store `none` or `failed`);
- "the tool table changed since the preview" (row not seen under this library revision);
- "tool row not read (line N)" (`unread`).

The marker draws the same cylinder.

### The marker and the shape cache (Codex: bounded lifetime, clear release)

**The marker.**

- While scrubbing (`scrubTool != null`), the marker takes its dims from the publication, as today, and its shape from the store through C1-P.
- `getToolMeta(scrubTool)` is no longer read on that path.
- The live, loaded marker keeps `st.tool_meta`, as in v2. Whether it should also move to the store is open question 3.

**`toolShapeCache.ts`.**

- **Key:** (connection epoch, identity instance, library revision, tool, D, visual length, unit scale).
- **Value:** `{ cutter, shaft }` from `buildToolGeometries`, plus the extent and the collision hull (c2), computed once from those geometries.
- **Shared, not disposed by the marker.** The geometries carry `userData._shared = true`, so `disposeObject` (`viewer/disposal.ts`) skips them when `replaceToolMarker` removes a marker.
- **Ownership.** The cache owns the geometries and counts users:
  - `acquire(key)` / `release(key)`; the marker releases when it is replaced.
  - Evicting an entry with users marks it doomed. It is disposed at its last release, never under a drawn marker.
- **Bounds.**
  - At most 32 entries; the LRU among entries with no users goes first.
  - Dropped whole on a library-revision change, a connection close, an identity or unit change, and `clearScene`. The marker is released first.
- **A build counter** (`builds`) for the perf guard.

### Files (c1)

**Gateway.**

- `gateway.py`: `_tool_files_lock` in the three writer sections; `get_tool_table` builds its reply from the new read.
- A new pure `tool_files.py`: the fd read, the retry, the hashes, the strict library read, and `unread` from `parse_tool_table`. It gets its `rules.py` rule.

**Client.**

- New `toolLibraryStore.ts`, `toolShapeCache.ts`, each with its `rules.py` rule.
- `ThreeViewer.vue`: the scrub marker, cache release, and a `__viewerDiag.getToolMarker()` reader. The reader returns radii per z-band and the marker's length from its geometries, which is what the product spec reads.
- `ToolTablePanel.vue`, `ToolStrip.vue`: read the store.
- `ws/bulkData.ts`: `toolTableVersion` stays as the ping.
- `lcnc.ts`: the reply type.

**Docs.** `docs/architecture/machine-model.md` (tool geometry) and `frontend-modules.md` (the store), plus CLAUDE.md's one-liners.

**Inventory.** Regenerate it if the guard names the new lock, file or reply fields.

### Guards (c1), each with what it reads

**Gateway (pytest, fake_linuxcnc).**

- **GW-1, coherent read.**
  - Setup: a writer section stalled between its table write and its library write (an injected Event in `save_tool_library`), plus a concurrent `get_tool_table`.
  - Reads: the reply's rows and `rev`.
  - Passes when they are the section's after-state, both files, never the new table with the old library.
  - **Red at the base by construction**: the bump comes before the library write.
- **GW-2, changing file.**
  - Setup: the table rewritten between the two `fstat`s (a monkeypatched read that rewrites in place, same size).
  - Expected: a retry that sees the change. A rewrite that persists gives `ok: false` "Tool table changing".
  - A line not understood appears in `unread`, and the other rows are kept.
- **GW-3, strict library.** A corrupt `tool_library.json` gives `ok: false` with the reason, never the cached rows.
- **GW-4, rev.**
  - The same bytes give the same `rev`.
  - An in-place rewrite of the same size gives a new `rev.table`.
  - A metadata-only save changes only `rev.library`.
- **GW-5, structural (AST).** Every call of `write_tool_table` and `save_tool_library` in `gateway.py` is inside a `_tool_files_lock` section. `get_tool_table` never takes `_cmd_lock`.

**Client units.**

- **`toolLibraryStore.test.ts`.**
  - Newest request only; a late reply is dropped.
  - Close clears; an identity change resets `seen`.
  - A newer ping makes the store `pending`.
  - C1-P's three cases above, as tables of (reply, publication) → paired or not.
- **`toolShapeCache.test.ts`.**
  - One build per key.
  - A release disposes exactly once.
  - Evicting a used entry defers disposal to its last release.
  - A revision change drops all.
  - The LRU bound holds.

**Browser** (the red spec made product, `tool-shape-sim.viewer.spec.ts`; it reads `__viewerDiag.getToolMarker()`, the marker's own geometries):

1. **T13 never loaded:** the scrubbed marker is tapered (shank R 4, cone end 3.98, length 100). **Red at 6c78780c**, recorded above.
2. **A new library revision that changes T13** (`tool_table_changed` + a reply with a new `rev.library`) changes the marker. A reply with the old `rev` arriving late changes nothing.
3. **A table-only change** (Z) keeps the shape; a D + library change makes T13 a cylinder until a publication with the new D.
4. **Disconnect → cylinder** ("shape not read"); the reconnect's read restores the shape.
5. **Perf:** ×100 playback across 3 tool changes, 10 times: `builds` = number of distinct (tool, dims).
6. **The Tools tab's** `tool-table-read.spec` and `tool-edit.spec` stay green; they cover the slow note, the 60 s end, Retry and reconnect.

### Mutations (c1)

- `get_tool_table` without the lock: GW-1 red.
- The library read through the cached `load()`: GW-3 red.
- No `fstat` comparison: GW-2 red.
- The store keeps `seen` across a library revision: case 3 red.
- Pairing ignores Z: the unit for a D-unchanged row Z red.
- Pairing with ε = 0: the unit case "in-memory 63.2121551, file 63.212155" red.
- Pairing on `toolDimsFor`'s output: the unit case "a negative table Z" red.
- The marker reads `getToolMeta` again: browser 1 red.
- The marker disposes a cached geometry: the cache unit's double-dispose check red, and browser 5 sees a rebuilt key.
- No release on replace: the cache unit red.

### Risks (c1)

- **Lock order.** `get_tool_table` never takes `_cmd_lock`, and the writers take `_cmd_lock` first, so there is no inversion. GW-5 holds it.
- **Reader wait.** A reader waits for one writer section: a table write, a `load_tool_table` with no `wait_complete`, and a library write. That is tens of ms.
- **Payload.** Merged rows with `native_mesh` can be large, and every M600 means one full read. The read happens once per ping, never per frame. Its size and time on the N100 with the machine's library are owed.
- **The Tools tab refactor.** The shared reader must keep the tab's states, which its two specs guard.

---

## P6-c2 — the collision body: a superset of the drawn geometry (Q5)

### Coverage by geometry branch (Codex F8 point 2)

**The source of the body.** It is derived from the geometry `buildToolGeometries` returns (`toolGeometry.ts:539–564`), the function every drawn marker goes through, never from `buildToolProfile` alone. A branch therefore cannot be missed.

**Common origin.** In every branch the drawn tip is the marker group's origin, +Z up:

- the lathes are rotated with `rotateX(π/2)` in `buildToolGeometry`;
- a native mesh is placed as is.

The collision body's origin is the same tip, with −TLO applied per pose in the sweep.

| Branch (`buildToolGeometries`) | When | Radius | Axial extent | Uses table D / L? | Covered by |
|---|---|---|---|---|---|
| `native_mesh` | `meta.native_mesh` | max √(x²+y²) over the mesh, any shape incl. lugs off the axis | [min z, max z] of the vertices. The importer requires min z = 0 ± 1e‑5 and sets `oal` = max z (`freecad_import.py:_mesh`), but a hand-edited library can differ, so it is MEASURED, not assumed. | **neither** (never stretched) | the triangles themselves. **Probed:** a Ø6 shank mesh with a lug at r 12.04 (outside the table cylinder r 3) lies wholly inside the stepped hull at 8, 16 and 32 slabs, today's pin too (`f8/p6probe.f8hull.test.ts`, `run-hull.log`) |
| `native_profile` | `meta.native_profile` | max r of the profile | [min z, max z] (the importer shifts min to 0) | neither | the lathe's triangles. **Probed:** the xyz3 seed's FreeCAD tapered ballnose (T2013) is inside at 8, 16 and 32 slabs |
| parametric, `buildToolProfile` by `type` (endmill, reamer, blockdrill, tap, threadmill ×3 + legacy, slotmill, ball, bullnose, radiusmill, drill, centerdrill, cornerchamfer, chamfer, countersink, tapered, dovetail, lollipop, facemill, probe, formmill) | otherwise, with meta | max x of the profile. Mostly D/2 at the cutter, but the shank (`shaft_diameter`), the shoulder, the facemill's DCX and the radiusmill's r + cr can be wider. | [min y, max y]: max y = `meta.oal ?? len`, where `len` is the visual length L + 20. OAL sets the drawn length independently of table L (T13: 100 vs 83.19). `probe`: max(oal, ball top). `formmill`: any y range of its profile. | D (most types); L only as a fallback (`oal`, `flute_length` = 0.6·len) | the cutter and shaft lathes |
| no meta | no library row | D/2 | [0, L + 20] | both: identical to today's body | — |
| **not drawn, not covered** | `holder_segments` (not built by `buildToolGroup`, `ThreeViewer.vue:1897–1912`); `stl_file` (no client reads it) | — | — | — | **named in the doc and the card note** ("holders are not modeled") |

### Rule C2

**The body.** The check's body for a tool whose shape is paired (C1-P) is a **superset of its drawn geometry united with today's body**:

- every point of the drawn triangles is inside it;
- so is today's cylinder of D/2 over [0, L + 20].

A tool that is not paired, or has no library row, keeps today's cylinder. The shape follows Q5:

- **(recommended) stepped hull.**
  - Slabs of 5 mm (machine-unit scaled; at most 32 slabs) over [min(0, zmin), max(L + 20, zmax)].
  - Per slab, the radius is the largest radius of the drawn triangles clipped to that slab. The distance to the axis is convex, so its maximum lies at a vertex of the clipped polygon.
  - That radius is united with D/2 wherever the slab overlaps [0, L + 20].
  - It is built as **ONE closed lathe of the stepped profile**, every radius circumscribed (r / cos(π/n), n = 20). The probe's stacked separate cylinders were "surface not closed", and one lathe avoids that note.
- **(alternative) envelope.** One cylinder of radius max(D/2, R_drawn) over the same axial range, also circumscribed.

**Where it applies.** The same body is used for the program tools (`_programToolDims`) and for the run's base tool (`ThreeViewer.vue:4133`).

**Where it is computed and how it travels.**

- It is computed ONCE per cache entry, on the main thread, from the cached geometries.
- It reaches the worker as numbers only: `{ diam, len, hull: { z0, h, r[] } }`, never a mesh.
- `makeToolVariant(diam, len, hull?)` builds it. The worker's base-tool key (`collisionWorker.ts:188`) includes it.

**The check basis.**

- `CheckBasis` gains `shapes: { lib: rev.library | null, store: state word, tools: Record<T, { body: "hull" | "envelope", digest } | { body: "table", why }>, base: … }`.
- `sameCheckInputs` compares `shapes`.
- A library revision that changes a program tool's body re-checks through `_colOnInputChange`.
- A table-only change re-checks through the new publication, as today.
- A run check keeps the basis it was built from, as today. The end-of-run comparison re-checks.

**The card** (`checkContext.ts:184–197`).

- Each program tool's row names its body: "body: library shape, Ø max 8.000" or "body: table Ø — the tool table changed since the preview".
- The basis row says "changed since" when the live `shapes` differ.
- The note at `checkContext.ts:191` becomes: "The check's tool body: a tool with a library shape — a stepped body around its drawn shape, at least the table Ø over the table length + 20 mm; without one — the table Ø over the table length + 20 mm (none: a 6 mm stub). Holders are not modeled."

### Files (c2)

- A new `viewer/toolBody.ts` (the hull from triangles, pure), with its `rules.py` rule.
- `toolShapeCache.ts` (stores the hull).
- `viewer/collision.ts`: `makeToolVariant` with a hull; `toolCylinderPositions` unchanged.
- `viewer/collisionWorker.ts`: the base-tool key.
- `ThreeViewer.vue`: `_programToolDims`, the base tool, the basis.
- `viewer/checkBasis.ts`, `viewer/checkContext.ts`.
- Docs: `docs/architecture/collision.md` and `machine-model.md`.

### Guards (c2)

- **`toolBody.test.ts`, superset per branch.**
  - Inputs:
    - every tool in `examples/sim_config/*/tool.seed.json` and `tool-libraries/fusion-freecad.json`;
    - the T13-like tapered tool;
    - a native profile;
    - **a native mesh with a lug outside the table cylinder** (a box at r = 2·D, z 10..15; Codex's case);
    - a formmill whose profile has y < 0;
    - a tool with OAL < L + 20, and one with OAL > L + 20.
  - Passes when every drawn vertex lies inside the hull's polygon at its slab, and today's pin lies inside the hull.
  - The example libraries get `READ_SITES` entries.
- **Collision unit.** The probe's clampA case becomes a fixed test: a clamp face 3.0 mm from the pass axis. The pin gives no finding and the hull gives a near miss. The probe measured both with K = 16.
- **Closed body.** The hull's model body is `insideClosed`, and a sweep with it has no "surface not closed" note.
- **Card / basis units.** A library revision with a changed body makes `sameCheckInputs` false. The card names each tool's body and its reason.
- **Browser.** A program with T13 and a clamp body. The Sim tab's list shows the finding at the clamp, and the card names "library shape". It reads the list and the card.

### Mutations (c2)

- `_programToolDims` back to the table D: the collision unit red, the browser spec red.
- The hull without the D/2 union: `toolBody` red for a tool whose drawn length < L + 20.
- An inscribed polygon instead of circumscribed: `toolBody` red on the native-mesh lug at a polygon vertex direction.
- The radius from `buildToolProfile` instead of the triangles: `toolBody` red on the native mesh.
- `shapes` left out of `sameCheckInputs`: the basis unit red.

### Risks (c2)

- **More findings near fixtures.** The check becomes more conservative near fixtures. That is the safe direction, but it is visible; the numbers are in Q5.
- **A wrong table D enlarges the body.** The parametric shape scales with D: the old T13 D 8 gives 30–32 findings with the hull (16 or 8 slabs), against 22 with the pin. F6's hint is its guard.
- **Cost.** The hull costs 1.6–2.3× the pin's sweep time (probe, desktop). On the N100 the machine day's sweep was 9.2 s, so about 20 s is expected. The exact lathe (about 20×) is not proposed.
- **The collision model key** (machine parts) is unaffected; tool variants are per sweep.

---

## P6-e — F6: the program header's D beside the table's

### Rule E

**What is compared.** The **shown publication's** proven text, with the **same publication's** `parse_tlos` D for that tool. That is the value the card's row shows, not the live table.

**The text.** The scanner reads only text for which `gcodeLinesBound` holds for the publication of the check context (`bulkData.ts:829–832`). The context captures the scanner's result at its request, for exactly that publication version. Text not proven means no hint.

**The scanner** (`viewer/programToolHeader.ts`, pure, bounded).

- **Range.** Lines 1 to the line before the first motion word (G0, G1, G2, G3, G5.x, G33, G38.x, G73, G76, G8x), at most 500 lines.
- **Block numbers.** N-words are stripped before the words are read.
- **The machine-day program** (head copy `~/claude-work/p6/f9/mday_head (.ngc)`) is in this form:

  ```
  (<program name>)
  (T13 D=1.875 CR=1. TAPER=3.7DEG - ZMIN=-25.777 - TAPERED MILL)
  N10 G90 G94 G17 G91.1
  N15 G21
  ...
  N20 G53 G0 Z0.
  ```

  Its unit IS stated before the first motion, so the rule compares there. Its tool change is `T13 M600`, not M6; the scan does not depend on it.
- **An entry** is a parenthesized comment at the start of a line: `(T<n> D=<d> …)`, the Fusion post's form. Anything else is not read.
- **Units.**
  - The G20 / G21 words in code, not comments, before the first motion.
  - Exactly one kind present: that unit.
  - None, or both kinds: **unknown**.
- **Duplicates.**
  - The same T with values within the tolerance: one value.
  - The same T with values beyond it: **conflict**.

**The comparison.**

- The header D is converted from the header unit into machine units.
- **The tolerance (proposal; it rests on an assumption).**
  - The proposal is ONE unit of the post's last decimal, expressed in the header's unit and converted: **0.001 mm for a G21 header, 0.0001 in (0.00254 mm) for a G20 header**.
  - The assumption: the Fusion post prints 3 decimals in mm and 4 in inch and trims trailing zeros, so the printed digits do not show the precision. This is from memory of Fusion posts, not read from the operator's post.
  - Codex's literal R456 wording is "0.001 mm, converted for inch machines". On an inch machine that is 0.0000394 in, which holds for a G21 header. An inch header compared at that tolerance would hint on its own rounding if the post prints 4 decimals.
  - Open question 4 asks Codex to choose.

**The card's tool row**, one fact in one place:

- Mismatch (`warn`): "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875".
- Conflict (`warn`): "program header names T13 with Ø 1.875 and Ø 2.000 — not compared".
- Unknown units (plain): "program header Ø 1.875, units not stated — not compared". No claimed comparison.
- Match: nothing.

**It never changes** the table, a measured length, the drawing or the body.

### Files (e)

- New `viewer/programToolHeader.ts` (with its `rules.py` rule) and `viewer/checkContext.ts` (the context captures the header result).
- `ThreeViewer.vue`, where the context is captured.

### Guards (e)

- **Scanner unit.**
  - The machine-day header line.
  - Comment-only lines; `T13D=` (not the form, so not read); a tool comment after the first motion, ignored.
  - G20 only, G21 only, neither, both.
  - A duplicate, equal and conflicting.
  - The 500-line bound.
  - An inch header on a mm machine at 0.00005 in of rounding: no hint. Then a real difference: a hint.
  - A mm header on an inch machine.
- **Browser** (card): mismatch → hint, match → none, unknown units → "not compared". A re-publication with other text recomputes. While the text is not proven (`gcodeLinesBound` false): no hint.

### Mutations (e)

- The comparison switched off: the browser spec red.
- The mm tolerance applied to an inch header: the scanner unit red (rounding case).
- The scan not stopped at the first motion: red.
- Duplicates taking the first value: the conflict case red.
- The hint read from text not bound to the publication: the browser spec's unproven-text step red.

### Goes to P8 (unchanged)

- The importer's D for tapered tools.
- D as a merge conflict.
- "refresh offers D".
- The golden test from the operator's Fusion export of T13.

---

## Operator question Q5 (updated; asked by the main session)

| # | Question | Numbers (`f8-counts.md`) | Recommendation |
|---|---|---|---|
| **Q5 (F8)** | The collision check's tool body for a tool with a library shape: (a) keep the table diameter, (b) one cylinder of the widest diameter, or (c) a stepped body that follows the shape? | Tapered T13 (D 1.875) beside two clamps:<br>(a) **0** findings, missing 3 the real shape has;<br>(b) **22**, 6 of them collisions;<br>(c) **5**, 0 collisions, against 3 for the exact shape.<br>Sweep time (a) 1.0 s, (b) 1.1 s, (c) 2.3 s. A plain end mill: no change with (b) or (c). A Ø3 cutter on a Ø6 shank: (a) 0, (b) = (c) 2. | **(c)**, with (b) as the plainer fallback. Both are supersets; (a) under-approximates. |

## Open questions (Claude's; not for the operator unless Codex disagrees)

1. **Slab height.** 5 mm, at most 32 slabs, or a fixed count? The probe measured 16 slabs over 100 mm (6.25 mm): 5 findings. 8 slabs (12.5 mm) gave 7.
2. **Hold or no hold.** After an edit that changes D and the library together, should the idle check wait for the re-parse instead of checking once with T13 unpaired (named) and again after the publication? Proposed: no hold, since one extra check is the cost. Codex's preference is asked.
3. **The live marker.** Should the live (loaded) marker also take the store's paired shape instead of `st.tool_meta`, so there is one source? Proposed: c1 keeps `st.tool_meta`, as in v2. The status `tool_meta` and the store can then disagree for one ping after a library change.
4. **F6's tolerance for an inch header.** One unit of the post's assumed 4th inch decimal (0.0001 in), or Codex's literal 0.001 mm converted? The first avoids hints from the header's own rounding. The second is stricter and depends on how many decimals the post prints. Either way, G21 headers use 0.001 mm.

## Order of work

1. **P6-c1**: gateway read rule and store, then marker and cache. The browser guard is red first; it is recorded.
2. **P6-c2**: after Q5.
3. **P6-e**: after c2, which changes the card's tool rows.

Each sub-package goes through `round_gate.py --base <accepted base>` per round and one merge gate per agreed head. Every new file gets its `rules.py` rule and every new disk read in a test its `READ_SITES` entry. The inventory is regenerated when its guard fires. Mock only (no native stage), except GW-1 to GW-5 in the backend gate.

## Owed live on the machine (after the update)

- **F8.**
  - T13 is drawn tapered in the simulation without being loaded.
  - The check card names T13's body.
  - The check's time with the hull on the N100.
  - The store's read size and time with the machine's library, including any native meshes.
- **F6.** A test program whose header D differs from the table shows the hint. The operator's T13 now matches, so a test program is needed.

## Not verified

- **LinuxCNC's own `tool.tbl` write.** In place (fopen "w") or atomic: from memory of 2.9's `tooldata_save`, not read here; no source is on the VM. C1-R's fstat check covers both.
- **T13's real library entry.** `shoulder_length` 50 is an assumption, as is R1 without `tapered_type`.
- **The counts are a synthetic scene.** Real counts depend on clamp placement and stepover; they scale with 1/stepover.
- **The closed stepped lathe** was not built. The probe measured stacked separate cylinders with the same radii. Each run was noted "surface not closed".
- **The native branches were not swept.** They were probed only as geometry: the superset check above. No collision sweep ran with a native-mesh or native-profile tool.
- **The Fusion header format** beyond the machine-day example. Also the post's decimals (3 mm / 4 inch), which F6's inch tolerance rests on.
- **Fusion "personal use" rapids.**
  - The machine-day program's header says Fusion reduces the feedrate of rapid moves to the cutting feedrate.
  - Its 122-line head copy still has G0 for the positioning moves (N20, N50). Whether its links inside an operation are G1 is not visible there.
  - If they are, the counts' feed/rapid split does not carry over to the operator's programs. Tool × clamp findings are reported whichever way, since a clamp is not stock.
- **GW-1 to GW-5** are designed, not run: there is no gateway code in this round.


---

<!-- F8 counts for Q5 -->

# F8 · Q5 counts: the collision body of a tool with a library shape

Measured 2026-11-24 at development `6c78780c` (worktree `/home/cnc/lcnc-suite-p6c`, branch `plan/p6c`), for operator question Q5.

## How the numbers were made

**The chain.** The real collision chain, run under vitest:

- `buildCollisionModel` → `sweepCollisions` writing a `ContactStore`;
- `buildContactView` → `viewCounts` / `targetAt` / `targetKind`, which is what the bar and the Sim tab count;
- margin 2 mm (`COLLISION_MARGIN_MM`).

**One variable.** Machine, scene, track, margin and sweep are the same in every row. Only the `tool: true` body changes.

**Probe files.**

- the probe: `~/claude-work/p6/f8/p6probe.f8counts.test.ts`;
- the raw results: `~/claude-work/p6/f8/f8-counts.json`;
- the run log: `run-counts.log`;
- the generated programs: `P1-T13-D1.875.ngc`, `P1-T13-D8.ngc`, `P2-T1-D6.ngc`, `P2-T14-D3.ngc`.

**Machine.** A synthetic 3-axis head (X, Y, Z) over a fixed table, at G54 = (200, 150, −100). Every scene coordinate below is in the program frame, with the stock top at Z 0:

| Body | Where | Class |
|---|---|---|
| stock | X −10..110, Y −10..70, Z −30..0 | `stock: true` (feed contact = machining, muted) |
| clampA | X 20..40, Y −18..−2, Z 0..12 | strap clamp resting on the stock's Y− edge; face at **Y −2** |
| clampB | X 60..80, Y 63..80, Z 0..12 | strap clamp on the Y+ edge; face at **Y 63** |
| plate | X −60..160, Y −60..130, Z −45..−30 | fixture plate under the stock |
| spindle | 60 mm block from the gauge line (tip + L) up | rigid with the tool, so no pair with it |

**The three tool bodies**, each with its tip at the origin, +Z, posed per segment:

1. **pin**: today's body. `toolCylinderPositions(table D, L + 20)`, the same 20-gon as `makeToolVariant`.
2. **envelope**: the body the plan proposes. A cylinder of radius `max(D/2, R_drawn)` from `min(0, zmin)` to `max(L + 20, zmax)`. `R_drawn`, `zmin` and `zmax` are measured on the geometry `buildToolGeometries` returns, the drawn marker's own geometry. It uses the same 20-gon.
3. **drawn shape**: the reference. The `buildToolGeometries` cutter and shaft themselves, used as the body. It is what the library says is physically there.
4. **slab hull, K = 8 / 16**: Q5's third answer, profile-following.
   - The drawn geometry is cut into K equal slabs along the axis, over the envelope's length.
   - Per slab, the radius is the largest radius of the drawn triangles inside the slab. A triangle clipped to the slab has its farthest point from the axis at a vertex of the clipped polygon.
   - That radius is united with today's body (D/2 over 0..L+20).
   - Each slab is a 20-gon CIRCUMSCRIBED about its radius.
   - It reads only the triangles, so it works for every geometry branch, native meshes included.
   - In the probe the slabs are separate stacked cylinders. The sweep therefore notes "surface not closed" for them; the build makes ONE closed lathe of the stepped profile.

**Programs.** Generated with their G-code, one track point per motion line. The heights follow Fusion's usual ones.

- **P1, tapered relief.** A one-way parallel finishing pass in X over a relief that is 0 at its edge and −20 deep in its middle.
  - Passes run every 0.5 mm from Y 1 to Y 59, with points every 5 mm in X.
  - G0 Z5 retract and return, feed plunge, clearance 15.
  - 117 passes, 2 808 track points.
  - Tool: a T13-like tapered mill.
- **P2, the end-mill control.** A pocket at Z −3 and Z −6, zigzag in X, from Y 2.5 to 57.5 every 2.75 mm.
  - It is run twice, once with a Ø6 end mill on a Ø6 shank and once with a Ø3 end mill on a Ø6 shank.
  - The path is the same in both runs.

**The tools.** The T13 fields are synthesized from the findings excerpt. `shoulder_length` 50 is an assumption, because it is not in the findings. It only moves the Ø5.8 neck and never the Ø8 shank.

| Tool | Table D / L | Library shape | Drawn R / length |
|---|---|---|---|
| T13 (machine day, after the operator's D edit) | 1.875 / 63.19 | tapered, side angle 3.7°, R1, LCF 47, shoulder Ø5.8, shank Ø8, OAL 100 | **4.000** (shank) / 100 |
| T13 before the edit | 8 / 63.19 | same | 7.039 (cone end Ø14.08) / 100 |
| T1 | 6 / 50 | end mill, LCF 20, shank Ø6, OAL 60 | 3.000 / 60 |
| T14 | 3 / 40 | end mill, LCF 10, shank Ø6, OAL 50 | 3.000 (shank) / 50 |

## The counts

The columns count findings as the bar counts them:

- **coll.**: a touch;
- **near**: inside the 2 mm margin without a touch;
- **f / r**: feed / rapid. That is the target's kind, meaning whether a touching sample, or the margin entry, fell on a rapid.

| Program · tool | Body | Findings (coll. + near) | Tool × clampA coll. f/r · near f/r | Tool × clampB coll. f/r · near f/r | Tool × stock (rapid gouge) | Machining (feed into stock, muted) | Sweep ms |
|---|---|---|---|---|---|---|---|
| **P1 · T13 D 1.875** | pin Ø1.875 | **0** (0 + 0) | 0/0 · 0/0 | 0/0 · 0/0 | 0 | 117 | 987 |
| | **envelope Ø8** | **22** (6 + 16) | 3/2 · 4/4 | 1/0 · 4/4 | 0 | 117 | 1 089 |
| | drawn shape | **3** (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | 0 | 117 | 21 005 |
| | slab hull K = 8 | **7** (0 + 7) | 0/0 · 4/1 | 0/0 · 2/0 | 0 | 117 | 1 643 |
| | slab hull K = 16 | **5** (0 + 5) | 0/0 · 3/1 | 0/0 · 1/0 | 0 | 117 | 2 252 |
| P1 · T13 with the old D 8 | pin Ø8 | 22 (6 + 16) | 3/2 · 4/4 | 1/0 · 4/4 | 0 | 117 | 1 104 |
| | envelope Ø14.08 | 46 (30 + 16) | 9/8 · 4/4 | 7/6 · 4/4 | 0 | 117 | 1 265 |
| | drawn shape | 27 (10 + 17) | 4/3 · 5/4 | 2/1 · 4/4 | 0 | 117 | 22 447 |
| | slab hull K = 8 | 32 (16 + 16) | 6/4 · 4/4 | 4/2 · 4/4 | 0 | 117 | 1 598 |
| | slab hull K = 16 | 30 (14 + 16) | 5/4 · 4/4 | 3/2 · 4/4 | 0 | 117 | 2 046 |
| **P2 · T1 Ø6 on Ø6** | pin Ø6 | 2 (0 + 2) | 0/0 · 2/0 | 0 | 0 | 2 | 167 |
| | envelope Ø6 | 2 (0 + 2) | 0/0 · 2/0 | 0 | 0 | 2 | 157 |
| | drawn shape | 2 (0 + 2) | 0/0 · 2/0 | 0 | 0 | 2 | 191 |
| | slab hull K = 8 / 16 | 2 / 2 | 0/0 · 2/0 | 0 | 0 | 2 | 92 / 270 |
| **P2 · T14 Ø3 on Ø6** | pin Ø3 | **0** | 0 | 0 | 0 | 2 | 151 |
| | envelope Ø6 | **2** (0 + 2) | 0/0 · 2/0 | 0 | 0 | 2 | 158 |
| | drawn shape | **2** (0 + 2) | 0/0 · 2/0 | 0 | 0 | 2 | 197 |
| | slab hull K = 8 / 16 | **2** / **2** | 0/0 · 2/0 | 0 | 0 | 2 | 190 / 313 |

**Pairs not in the table.** None of the twenty runs had a finding on tool × plate or spindle × clamp. None had a static contact. Every run swept the whole track (no truncation).

**Runs noted "surface not closed".** Two kinds of run were reported as `uncertified`: "tool: surface not closed — a part wholly inside it is not found".
- The drawn-shape body of the end mills (P2): the cutter and the shaft are two lathes, and their joint is not a closed mesh. The P1 drawn-shape runs carry no such note.
- Every slab-hull run: its slabs are separate stacked cylinders.

The run log is `run-counts.log`. The two earlier runs without the hull rows are `run-counts.try1.log` (the vitest 5 s default timeout fired after the body had finished) and `run-counts.try2.log`. Their rows agree with these to within the timing.

## What the numbers say

1. **The pin misses real findings.**
   - P1: the true tapered shape comes within the margin of clampA 3 times (passes at Y 1.0 and 1.5, feed and the G0 Z5 return), and the pin sees none of them.
   - P2 with the Ø3-on-Ø6 tool: the pin misses the shank beside clampA twice. The drawn shape and the envelope both find them.
   - This is the under-approximation Codex named. Fixing the drawing alone leaves it.
2. **For an end mill whose shank is no wider than D, the envelope changes nothing** (P2 Ø6 on Ø6: 2 = 2 = 2).
   - **For a small cutter on a wider shank it does change**, and correctly: Ø3 on Ø6 gives 0 with the pin and 2 with both the envelope and the drawn shape.
   - "The envelope changes nothing for an ordinary end mill" therefore holds only where the shank is no wider than D.
3. **For the tapered mill, the envelope over-approximates heavily.** It gives 22 findings where the drawn shape gives 3, and 6 of the 22 are collisions where the drawn shape has none.
   - The Ø8 cylinder reaches down to the Ø1.875 tip, where the real tool is Ø1.9 to Ø3.5.
   - On P1, the 19 extra findings are passes 3 to 6 mm from a clamp face.
   - The count scales with 1/stepover: the same scene at a 0.2 mm finishing stepover would give about 2.5× as many.
4. **The envelope of today's T13 equals the old pin Ø8 exactly** (22 = 22): both are R 4 cylinders.
   - Before the operator's D edit, the check over-approximated this tool by the same amount that the envelope now would.
   - With the old D 8, the envelope follows the wrong drawing (the fat Ø14.08 cone) to 46 findings. A wrong table D now enlarges the body, and F6's hint is the guard for that.
5. **Rapid gouges into the stock and machining do not depend on the body here.**
   - No rapid of these programs passes beside the stock below its top, so there are 0 rapid gouges with every body.
   - There are 117 machining episodes, one per pass, with every body: the bigger body only makes each one longer.
6. **Cost.**
   - A cylinder envelope costs what the pin costs (about 1.1 s for 21k samples).
   - The drawn lathe as a body costs about 20× per query (21 s at the same sample count), because the BVH queries run against a 1 536-facet lathe. On the N100 (sweep 9.2 s on the machine day), the exact lathe would mean minutes.
   - The slab hull costs 1.6× (K = 8) to 2.3× (K = 16) the pin's time.
7. **The slab hull is close to the drawn shape at near-cylinder cost.**
   - P1: 7 findings (K = 8) or 5 (K = 16), against 3 for the drawn shape and 22 for the envelope. None of them is a collision. It finds every one of the drawn shape's findings, since it is a superset.
   - With a correct small-cutter tool (P2 Ø3 on Ø6) it equals the drawn shape.

## For Q5

| Body | P1 T13 (D 1.875) | Sweep time | What it is |
|---|---|---|---|
| pin (today) | 0 | 1.0 s | misses what the library says is there (3 near misses) |
| envelope (plan v2's proposal) | 22 (6 coll.) | 1.1 s | a superset; about 7× the drawn shape's findings on this program |
| **slab hull, K = 16** | **5** (0 coll.) | 2.3 s | a superset, profile-following, works for every branch |
| drawn shape | 3 (0 coll.) | 21 s | the reference; exact to the library, too slow as a raw lathe |

**Recommendation to put to the operator: the slab hull (a stepped, profile-following body).**
- It never finds less than the drawn shape and never less than today's pin.
- It costs about twice the pin's sweep time.
- On this program it adds 2 near misses to the drawn shape's 3, against 19 extra findings for the envelope.

The envelope stays the simpler fallback if the operator prefers the plainest rule ("the widest diameter"). The cost to state with it: about 7× the drawn shape's findings near clamps on a tapered-mill finishing program, and more at a finer stepover.

**Boundary placements in this scene.**

- clampA's face is 3.0 mm from the nearest pass axis.
  - Pin gap: 2.06, outside the margin.
  - Cone gap at ≤ 12.5 mm above the tip: ≥ 1.26, a near miss.
  - Envelope: an overlap of 1.0, a collision.
- clampB's face is 4.0 mm from the nearest pass. That is exactly the envelope's radius, and the one clampB collision of the envelope (line 2805) is the 20-gon's vertex at that boundary.

## Not verified

- **T13's real library entry.** The values are from the findings excerpt. `shoulder_length` 50 is an assumption, the corner radius is taken as R1 with no `tapered_type` (the machine's library predates it, per F6), and the true Fusion DC is unknown.
- **The operator's program and clamps.** Neither was used. The scene is synthetic, and real counts depend on the clamp placement and the stepover.
- **The hull as the build would make it.** The slab hull was measured as stacked separate cylinders. The build's ONE closed stepped lathe has the same radii per slab but other caps, so its counts can differ at slab borders.
- **Run as a test only.** The counts ran through the unit chain, not the page's worker pool and shards. On the page the sweep is the same function; the pool splits pairs over workers.

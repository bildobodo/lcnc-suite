# Start message — "check not finished" at a start (machine-day F14 + P2b-F2): plan v1

**Status:** plan only, nothing built. Code sites are at development `dbd14cab` (worktree `/home/cnc/lcnc-suite-start`, branch `feat/start-plan`). The renderings come from a throwaway prototype on the scratch branch `scratch/start-proto` (`bde06efe`), which is not for merge (see §9).

**The decision this plan implements.** The operator decided on 2026-11-25 (`docs/reviews/maschinentag.review.md`, "Operatorentscheidungen vom 25. November", row Q1 (F14)):

> statt „90 s warten“: eine Meldung beim Start, dass die Prüfung nicht fertig ist, mit der Wahl, jetzt sofort zu starten. Programmstart und Start ab Zeile gleich behandeln.

So:
- There is **no wait phase.** P6-d v4's G2/G3/G5 (the `preview` phase in `_rfl_sequence`, its deadline and its early end) are **dropped**.
- G1 (`_start_verdict`), G6 (`verified_against`) and P1–P3 (the page's path 2), all agreed in R462, are **kept** and used here.
- P4 (the RFL rest range, MT462-01) stays a package of its own.
- The F2 row of the same table reads: "keine Bedingung fürs Update; Lösung zusammen mit F14, siehe Q1".

**In one paragraph.** A start from idle asks the gateway in the start command itself. The command carries the page's own fact (is *its* collision check of the shown publication finished?), and with "Start now" an explicit acceptance. The gateway decides whether to ask, before anything of the start is written:

- its own start verdict (`run_start_check`, the same function the record uses) is not verified, **or**
- the page says its check is not finished, **or**
- the start is a run from line,

…and no matching acceptance came with the command. The page then shows ONE dialog. Its content is the gateway's why plus the page's live facts (preview loading, check 62 %, …). Its actions are **Cancel** and **Start now**; Start now is a hold.

- The record (`_begin_run_basis`) decides again. An acceptance given for a *verified* situation does not cover an unverified one, so the dialog's consequence line is never more optimistic than what happens.
- Run from line asks **in its existing dialog, before anything moves** (recommended variant A).
- After Start now, the run shows the truth with the run-time display that already exists:
  - the check goes on (verified start: path 2), **or**
  - "Not checked · started before the check".
- A check that catches up *during* an unverified run needs the deferred first pinned parse from the start capture (MT449-01). It is **stage 2, not in this package**, and named.

---

## 1. Today's start paths (code reading at `dbd14cab`)

### 1.1 The page — three gestures, one admission, no question

| Gesture | Site | What it does |
|---|---|---|
| **Start button** (a hold, 500 ms, `HOLD_FIRE_MS` machineControls.ts:39) | GcodePanel.vue:1159–1163 (`:hold="!opensRunDialog"`), `onStartClick` :904–916 → `emit("cycleStart")` → App.vue:1843–1845 `fire({cmd:"cycle_start"}, "run")` | With a selected line > 1 the tap only opens the Run-from-line dialog (:902, :905–912). |
| **Space** (instant, no hold) | useKeyboardShortcuts.ts:175–181: resume, else pause, else `startAdmitted(...)` → `fire cycle_start` | A dialog or keypad blocks it (:138, `modalOpen`). **No `e.repeat` check** on the `cycle` action: a held Space may repeat it. `cycle_start` has a 200 ms latch, `cycle_pause` none (lcnc.ts:249–291; code reading, not tried). |
| **Gamepad Start** | useGamepad.ts:241–243, the same rule | **No modal guard.** `gamepadGated` is the Settings dialog only (App.vue:2005), so a pad press acts behind any other dialog. |
| **Run from line** | the dialog GcodePanel.vue:1400–1477; its action is a hold (:1474) → `confirmRunFromLine` :918–942 → App.vue:1847–1880 ONE `auto_run` bound to program, version and source | Scans tool changes and the entry position at the tap (:906–911). |
| **Step** (a hold) | GcodePanel.vue:1166–1169 → App.vue:1881–1883 `fire({cmd:"auto_step"}, "step")` | From idle it starts the program. |

Notes on the table:
- One admission per action: `actionAdmission.ts:37–47` `startRefusal` (editing / no program / loading) plus the `run` gate.
- Nothing on the page looks at the preview or the check before a start.
- A hold button is never activated by a key: `MachineBtn.vue:130` drops the caller's `onClick` for a hold.

### 1.2 The gateway — a start never waits and never asks

**`cycle_start`** (gateway.py:9639–9658), in this order:
1. `require_armed`.
2. `_toolsetter_basis()`.
3. `_start_guard` (6883–6920):
   - the RFL busy refusal;
   - the `#3116` clear when unknown, which is an MDI switch and a write;
   - `_program_start_refusal` (kinematics).
4. `_toolsetter_sync` (7886–7925). It writes the server section when the booking does not already hold it (its own condition :7910–7913).
5. The admit; `set_mode(AUTO)`.
6. `_cmd_blocking(AUTO_RUN, 0)`. Inside it:
   - `_ts_mark_assumed(...)` (:5315);
   - then `_begin_run_basis` (:5321) → `run_start_check` (bulk_pipeline.py:633–711);
   - then the write.

**`auto_step` from idle** (9301–9316) is the same, under `_start_admit("step")`.

**`auto_run`** (9319–9425):
- It binds the command to the **published** version, source and `program_id` (9347–9360). A run from line therefore needs a publication of this load; F2 cannot happen for RFL.
- It checks the text on disk (9364–9378).
- Then either the sequence (`_rfl_start` → `_rfl_sequence` 7140–7281: measuring → `#3116` → safe Z → positioning → spindle → `starting` → AUTO_RUN at 7265 under `_basis_admit`), or a plain AUTO_RUN N.

**The record never refuses.** An unverified start goes out ("the machine never waits for the preview", `_unverified_run_basis` 5084–5106). The record names its why. Whether a pinned mid-run parse can belong to the run depends on it: `_run_for_pin` 5183–5196 needs `verified` and `sent`.

### 1.3 The page during the run

**Path 1 is the only admission of a check during a run.** `admitRunCheck` (checkBasis.ts:158–180) admits only a pinned parse made for this run (`for_run`), with `startLine === 0` and the start verified. Anything else refuses with "not a parse made during the run" (:165).

**A run from line is named not checked** (P6-d0): `uncheckedRun` (checkBasis.ts:147–150) → `_runNotCheckedKey` (ThreeViewer.vue:3334) → `_colEnterNotChecked` (4569–4596) drops every earlier result.

**An idle result or sweep is kept through a line-0 run, verified or not** (code reading, to be confirmed natively, case N3c):
- `_colOnInputChangeNow` returns early in a run (4629).
- Nothing in the run watchers (4552–4615) cancels a running idle sweep or a finished idle result. Only a new publication does (the `viewerGcode` watcher, 4659–4673).
- The idle sweep keeps the worker settings it was posted with: K shards and no 20 ms slices (4189–4193).
- So an earlier "Clear · checked to the end" stands on the bar through a run whose start was **not** the checked preview.

The relevant evidence:
- P6-d's N-F2: "Clear" on the old publication during the toolsetter hold.
- MT-F14-P: "Collisions not checked" all run long, because the run check was refused.

**F2 (a start before the first preview).**
- The record is unverified (`no publication of this program`, `ctx` None). No pinned parse can belong to the run.
- The unpinned parse waits for idle (`_restart_wait` 4810–4835, "not_idle").
- The page says "Preview after the run" in the HUD and in the banner "PREVIEW AFTER THE RUN" (previewWait.ts:93–99). Nothing catches up during the run.

---

## 2. Question 1 — when exactly is "the check not finished"?

### 2.1 The facts and where each is known

Column meanings:
- **page@press:** what the page holds when the gesture completes.
- **gw@entry:** the gateway at the start handler's entry, before anything is written.
- **gw@record:** the gateway at `_begin_run_basis`, right before the AUTO write. That is the decision that stands today.

| # | Fact | gw@record today (the authority) | page@press | On the wire | Gap |
|---|---|---|---|---|---|
| **F2** | No publication of this load | `no publication of this program` (bulk_pipeline.py:644–646) | `previewWaitWords` (previewWait.ts:135–153): "Preview not ready", "Preview waits for …", or "Preview loading" while `preview_refresh.first` | `preview_origin.program_id` ≠ `program_id`; `preview_wait` (gateway.py:4850–4874); `preview_refresh.first` | ≤ 1 status frame |
| **F14a** | A parse of this program runs, or is scheduled | `refresh_running` → `a parse runs or is pending` (:647–648) | `previewRefresh` (statusStore.ts:221, 617–645), `previewRefreshPct` (:245) | `preview_refresh` (bulk_pipeline.py:829–856, `phase` starting/running) | ≤ 1 frame |
| **F14b** | A restart is pending but not scheduled (`reparse_pending` alone, held by `_restart_wait`) | the same why | **invisible**: `preview_refresh_status` returns None unless `refresh_running` (:835), and `preview_wait` only exists without an own publication (gateway.py:4853) | — | **gateway only** |
| **F14c** | A drift edge evaluated without debounce: tool table mtime/rows, WCS snapshot, soft-limit window, the toolsetter book (`_ts_open_drift` gateway.py:5159–5171) | `drift open: …` (:686–711) | `drift_decision` pending makes the page's check wait (`_colDriftReady` ThreeViewer.vue:4395–4428), but only once the decision round began (cadence ~1.5 s, quiet 2 s) | `drift_decision` | **gateway only** until the decision (P6-d step 0: `another tool start`, `drift open: toolsetter` were not visible to the page) |
| **S** | The controller's start ≠ the published start: fixture, fixture table, G92, kinematics, rotary pose (> 0.01°), tool start, text on disk | `another …` (:657–677), `the program text is not the published one` (:649–650) | the page's own live inputs restart *its* check (`_colOnInputChange` 4618–4637). That is a check on the live basis, not a proof of the start | partly (`data.*`) | **semantic**: the page may be "Clear" where the gateway says "another fixture" |
| **M** | What the start itself moves after the entry: `_toolsetter_sync` writes (7910–7922) → `_ts_open_drift`; `_ts_mark_assumed(_ts_program_writes())` (5315) → booking change (R2 as corrected in R462) | seen at the record | — | — | **only at the record** (predictable at entry, see §4.3) |
| **P** | The page adopted the publication: decoded, no basis pending, text bound | — | `viewerGcode.publishedVersion`, `previewBasisPending`, `previewDecoding` | — | **page only** |
| **C** | The page's collision sweep of the shown payload (§2.2) | — (never a gateway fact: "no page is a precondition of a start", R461/R462 P5) | `simView.sweep` (simPanelStore.ts:52–68 ← ScrubBar.vue:1137–1263), `simulationOn` (defaults.ts:792) | — | **page only, per device** |
| **L** | Run from line N > 0: never checked (P6-d0) | `start_line` in the record (`_auto_start_line` 5065–5080) | the selected line (GcodePanel.vue:902) | `auto_run.line` | none |
| **T** | RFL with a pre-measurement: the tool row moves inside the sequence, so no preview made before can be the start | the record after measuring: unverified (P6-d step 0: 3/3) | `rflPreTool > 0` (GcodePanel.vue:820) | `auto_run.pre_tool` | none (predictable at the press) |
| **X** | Another client's or halui's start | no record unless through this gateway (P6-d0 limit) | — | — | out of scope, named |

**Conclusion for the decision rule.**
- No single place has all the facts. F14b, F14c, S and M are the gateway's; P and C are the page's. Deciding on the page alone **fails "the same facts"**: it would miss F14b/F14c/S/M, which are exactly the machine-day whys.
- So the start command carries the page's fact C, and the gateway makes the ask decision on its own facts plus that claim (§4).
- The two sides never compute "verified" twice. The gateway's `_start_verdict` is the only verdict, and the page only reports its own sweep.

### 2.2 "The page's check is finished" — a total function, default **not finished**

`pageCheck(inputs) → { state: "finished" | "unfinished" | "none", version, words }`, pure, in a new `startCheck.ts`.

| Page state | Source | Classified | Words (dialog line) |
|---|---|---|---|
| simulation off on this device | `simulationOn` false | **none** (no claim) | — (the device runs no check; only the gateway's facts can ask, §5.6) |
| no own payload on screen (F2) | `previewWaitWords(...).hud` non-null, or no `viewerGcode` for `program_id` | unfinished | the hud words ("Preview not ready", "Preview waits for standstill", …), or "Preview loading" + bar "40 %" while `preview_refresh.first`; with it "Collision check waits for the preview" |
| a newer publication is being made (F14a) | `previewRefresh.programId === program_id && !first` | unfinished | "Preview being updated — tool table change" (`previewRefreshLabel`, statusStore.ts:252); with it "Collision check waits for the new preview" |
| payload not adopted | `previewDecoding` or `previewBasisPending` | unfinished | "Preview being updated" |
| shown version ≠ `preview_origin.version` | — | unfinished | "Preview being updated" |
| `sweep === null`, not running (timer, drift wait, geometry) | `simView.sweep` null, `collisionBusy` false | unfinished | "Collision check not started yet" |
| `checking` | `sweep.state` | unfinished | "Collision check running" + `.progressTrack` with "62 %" beside it |
| `paused` (a rotary jog parked it) | | unfinished | "Collision check paused at 40 %" |
| `partial` (stopped short: contact tables full, truncated) | | unfinished (it never finishes by itself) | "Collision check stopped at 75 %" |
| `nopairs` with `uncertified` ("Not checked") | ScrubBar.vue:1182–1185 | unfinished (never finishes) | "Collision check not possible — see the Sim tab" |
| `done`, `nopairs` certified, done with a caveat ("checked to the end"), done with "start not checked" | | **finished** | — |

- `version` is the shown payload's `publishedVersion`, and the claim names it.
- A finished claim is only made for the shown payload of the active `program_id` (`viewerGcode.programId`).
- The gateway treats `finished` for another version than its publication as unfinished (§4.2).
- "Start not checked" and "checked to the end" are finished checks with a named limit. Asking about them would ask on every start of such a program. **Q-C4 for Codex.**

---

## 3. Question 2 — the dialog

### 3.1 One entry point for every gesture

`requestStart(kind: "start" | "step", via: "button" | "key" | "pad")` lives in App and is used by GcodePanel's Start and Step (from idle), the Space branch (useKeyboardShortcuts.ts:175–181) and the pad (useGamepad.ts:241–243). It is not used by Resume, Pause or a Step in a paused run, which take no new record.

What it does:
1. Admission as today (`startAdmitted`).
2. **While the start question is open, it does nothing.** The pad has no modal guard today, so its second Start press would otherwise send a plain `cycle_start`.
3. Send the start with `program_id` and `check` (§4.1), via `fire` + `awaitReply`. The awaited reply suppresses the generic "Command: …" message line (lcncWs.ts:360–369).
4. A reply `ask` opens the dialog. A reply `ok` closes it if open. Any other error goes to the message center, as today.

On the keyboard, the `cycle` action ignores `e.repeat`. A held Space neither repeats a start nor toggles pause and resume. By code reading it can today (no `e.repeat` check, `cycle_pause` never latched); the guard proves it red at the base.

### 3.2 What the dialog is

- A `DialogFrame kind="flow"` (the safety tier `--z-modal-top`; it closes by its own buttons only), `size="confirm"`, `initial-focus="container"`. That is the tool-change pattern (App.vue:2739): no button sits under Enter or Space when it opens.
- It is teleported into `#content-dialog-area`: the strip (E-Stop, Abort) stays reachable and Escape stays E-Stop.
- **Actions:** "Cancel" (`dialogCancel`, left), and **"Start now"**: a new catalog entry `startUnchecked: { gate: "run", variant: "warn", size: "md", hold: true }`.
  - The amber colour is the one jogging before homing uses: motion allowed with a guarantee missing. It is not `danger` (nothing destructive) and not `primary` (not the normal start).
  - "Step now" for a step from idle.
  - Its `holdKey` = `program_id | ask.version | ask.verified | reason class`. A change of any of them cancels a hold in progress ("Check changed — hold again"). The percentage is **not** in the key.
- **Title** (a question with its object, glossary "Case"): "Start before the check is finished?"; for a step "Step before the check is finished?". A `HelpIcon` beside it (§7).
- **Body:**
  - one line per unfinished thing (§2.2 words, plus the gateway's why words §7.2), live;
  - a `.progressTrack` under a percentage line;
  - then ONE consequence line from the reply (§3.4).
- **Size:** the `confirm` tier's min-width, capped by the room (ui-patterns "Dialog tiers"). Touch takes `--control-h` 44 px.

### 3.3 Gestures, focus and keys

- **Hold on Start** (button) → reply `ask` → the dialog. The finger is up by then; the reply takes ~50–300 ms, §4.4.
- **Space** → the dialog. Focus goes to the container.
  - The **same** Space press's keyup lands on the container, not a button. An autorepeat keydown is ignored: `e.repeat` (new), `modalOpen` (:138), and the active element is no button.
  - **"Start now" cannot be activated by any key** (a hold, MachineBtn.vue:130).
  - So a keyboard-only start before a finished check needs the mouse or touch. That is intended: the override is a deliberate hold.
- **Pad Start** → the dialog. A second pad press while it is open does nothing (`requestStart`'s guard).
- **Escape** stays E-Stop (capture listener, useKeyboardShortcuts.ts:115–124) and never closes the dialog.
- **Never an auto-start.** Nothing starts because a check finished, a timer ran out or a publication arrived.

### 3.4 What "Start now" promises — the consequence line, a function of (verdict, page state)

| `ask.verified` (the gateway's verdict at the entry) | Page state (§2.2) | Line | What happens after Start now |
|---|---|---|---|
| `true` | `checking`, `paused`, not started yet, or a preview/payload state | "Started now, the collision check goes on during the run." | The record verifies (else it refuses again: the acceptance was for a verified start, §4.2). The page keeps a running or parked sweep (it resumes; a run parks nothing) or runs the check from the record (path 2, §5.2). |
| `true` | `partial` ("stopped at 75 %", contact tables full) | "Started now, the run is checked only to 75 %." | Kept as it is: a stopped sweep does not progress, and re-running from the record would meet the same cap. |
| `true` | `nopairs` uncertified (bodies unusable) | "Started now, this run is not checked." | Nothing to check with. |
| `false` | any | "Started now, this run is not checked." | The run is named "Not checked · started before the check" (§5.1). The idle check begins after the run, as today. |
| RFL | — | "A run from line is not checked for collisions." (in the RFL dialog, §6) | P6-d0's "Not checked · run from line N", unchanged |

The line reads the **reply's** verdict and the page's **live** state (a pure `consequenceLine(verified, pageCheck)` in `startCheck.ts`). While the dialog is open the situation can only get better at the start, never worse: a worse one refuses at the record and the dialog asks again with the new why.

### 3.5 While the dialog is open

- **The lines update live:** the percentage, a publication arriving, a parse starting.
- **The check finishes** (`pageCheck` → finished, and the last reply was `verified: true`):
  - The body says "Collision check finished · Clear" (ok), or "… · 2 collisions" (danger tone).
  - The action **keeps its place and width** (the slot is reserved for "Start now"). Its words become "Start", it turns `primary` for Clear and stays `warn` with findings.
  - It now sends **without** an acceptance, so the gateway can still ask.
  - The `holdKey` changes, so a hold in progress ends with "Check changed — hold again".
  - Nothing starts by itself. (Alternative for the operator: close instead, Q-S3.)
- **It closes** on:
  - Cancel;
  - the active `program_id` changing, or an unload: the question was about that load;
  - a run beginning (`runInProgress`, anyone's);
  - the connection dropping;
  - the reply `ok` of its own start.
- **The gate closes** (disarm, E-Stop, machine off, homing lost): the dialog stays. "Start now" dims with its gate's reason at the control (`gateExplain`); Cancel always works.

### 3.6 States rendered (§9)

| | State | Line(s) | Consequence |
|---|---|---|---|
| D1 | the page's check running on a current preview | "Collision check running" + bar 62 % | goes on during the run |
| D2 | a re-parse after a tool measurement (F14) | "Preview being updated — tool table change", "Collision check waits for the new preview" | not checked |
| D3 | a start before the first preview (F2) | "Preview loading" + bar 40 %, "Collision check waits for the preview" | not checked |
| D4 | the gateway only: the toolsetter values changed (F14c/M) | "Preview older than the toolsetter values" | not checked |
| D5 | the check finished while open | title "Check finished — start the program?", "Collision check finished · Clear" → "Start" | — |
| D6 | the gate closed while open (disarmed) | as D1, "Start now" dimmed | — |
| R-A | Run from line, variant A (the note in its dialog) | "Not checked for collisions — run from line 7" | — |
| R-B | Run from line, variant B (a second dialog) | "A run from line is not checked for collisions." | — |
| B1 | the bar and the Sim tab after Start now with `verified:false` | "not checked" slot, "Not checked · started before the check" | — |

---

## 4. Question 4 — the gateway contract (recommended)

### 4.1 Wire

`cycle_start`, `auto_step` and `auto_run` gain three optional fields, each a named contract in `command_policy.COMMAND_SCHEMA` (1428 ff.) and `lcnc.ts` `WsCommand`:

```
program_id: str                                  — the load the page shows; always sent
check: { version: int|null, state: "finished"|"unfinished"|"none" }
                                                 — the page's own sweep (§2.2); always sent
unchecked_ok: { program_id: str, version: int|null, verified: bool }
                                                 — only from the dialog's Start now / the RFL dialog's hold
```

The reply when it asks:

```
{ ok: false, error: "Check not finished — confirm the start",
  ask: { program_id, version, verified: bool, why: str|null, start_line: int, at: "entry"|"record" } }
```

### 4.2 The rule — ONE verdict function, at two points

`_start_verdict(file, source)` → `(verified, why, against)`. It is P6-d v4's G1 (spike `65a8b419`, agreed R462): ONE `run_start_check` after a fresh `stat.poll()` and the handler's own text hash. `_begin_run_basis` uses the same call.

**At the entry**, before `_start_guard`, `_toolsetter_sync` and any write:
- `cycle_start` 9639: after `require_armed`;
- `auto_step` from idle (else-branch 9301);
- `auto_run` after its binding and text checks (≈9379).

```
ask = not verified
   or check.state == "unfinished"
   or (check.state == "finished" and check.version != against.version)
   or start_line > 0                          # P6-d0: a run from line is never checked
if ask and not acceptance_matches: reply ask (at "entry"), NOTHING written
acceptance_matches = unchecked_ok.program_id == active program_id
                     and (unchecked_ok.verified is False or verified)
```

- **`program_id` ≠ the active load** → refused "Program changed — start again", nothing written. That is new for `cycle_start`, which today runs whatever is loaded.
- **Absent fields** (an old cached page, a raw WS client):
  - an absent `program_id` means **not bound**, as today (traced `start.unbound`);
  - an absent `check` reads as `"none"` (no page claim);
  - an absent `unchecked_ok` means no acceptance.
  - So such a client starts whenever the gateway's verdict is verified, and gets the ask reply as an error line otherwise. It is never locked out.
- **At the record**, `_cmd_blocking` gets `start_ack`. After `_begin_run_basis` (5321), a record that is not verified and has no matching acceptance:
  - is set `unsent` with `refused: "ask"`;
  - raises `_StartAsk(_WriteRefused)` carrying the ask (`at: "record"`) — nothing of the run is written.
  - The page's claim is **not** re-judged there (that window is milliseconds; named).
- **The record** carries:
  - `accepted: {version, verified} | null`;
  - `verified_against` (G6: projected from the record when verified, else null; `run_check_wire.json`).
- **Traces:** `start.ask {at, why, verified, check, start_line, cmd}` and `start.accepted {why, verified, version, start_line}`. For timing, `run_basis.written` (G8).

### 4.3 What moves the verdict after the entry — and what the operator sees

| Step between entry and record | Moves it? | Plan |
|---|---|---|
| `#3116` clear in `_start_guard` (6902–6916) | No: 3116 is not a basis key (`TOOLSETTER_BASIS_KEYS` gateway_util.py:6233 is 3004…3014 + 3100–3115). A parse running at that moment is discarded (`discarded:mdi`), but then the entry was already unverified. | — |
| `_toolsetter_sync` writes (7910–7922) | **Yes**, for a program that runs the routine: the booking version moves and `_ts_open_drift` returns `toolsetter`. | **Predict at the entry:** the sync's own condition (:7910–7913) is pure. "Would write" and "the published parse runs the routine" give `verified = False, why = "toolsetter values to be written"`, so the ask comes before anything is written. Q-C2. |
| `_ts_mark_assumed(_ts_program_writes())` (5315) | **Yes**, when the booking changes (`applied → assumed`, R462 R2 corrected) | Predict the same way (`_ts_book`'s own "changed" rule, gateway.py:7321–7357; `_ts_mark_assumed` 7359). Q-C2. |
| `set_mode(AUTO)` | No (P6-d native: 7 of 7 verified records saw the same version and basis at the write) | — |
| Another client's write, a drift tick, a publication | rare: ms | The record refuses (ask at `"record"`). |

**What the operator sees when the entry said verified and the record did not:**
- The hold completes, and ~0.1–0.3 s later the dialog opens with the new why.
- The machine has switched to AUTO, cleared `#3116` and taken the toolsetter values: the start's own preparation, as after any refusal at the write's `admit` today (BG-09).
- Nothing of the run was written; the record is `unsent`.

### 4.4 Why this contract, and the alternatives

- **Page-only ask (no gateway change).** Rejected: the page cannot see F14b, F14c, S or M (the machine-day whys), so the question would be skipped exactly where it matters. It could also not bind "Start now" to what was shown.
- **A read-only "start check" query before the start.** Rejected: two commands whose second depends on the first's outcome (CLAUDE.md: such a command is ONE gateway command). The answer also ages between the query and the start.
- **The verdict on every status frame.** Rejected: a sha256 of the program per frame, or a cached hash whose staleness is exactly the R17 problem (timestamps can be kept).
- **Chosen: the start command is the question.**
  - The happy path stays one command with no extra round trip.
  - The cost is one more program hash per start (the entry's), plus the record's existing one. N100 cost unmeasured (an estimate only, not a measurement: ~30–100 ms for 40 MB).
- **Changed invariant, named for Codex:**
  - Today: "the machine never waits for the preview" (5089).
  - Now: **"the machine never waits; it asks."** A start whose run would not be checked needs the operator's acceptance in the command.
  - Still true: "No page is a precondition of a start". A page with no check (`state: "none"`) adds no ask, and the acceptance overrides every ask.
  - An old cached page (no fields) gets the ask reply as a plain error line ("Command: Check not finished — confirm the start") when unverified. Named.

---

## 5. After "Start now" — the run-time check, case by case

### 5.1 Stage 1 (this package): the truth with the existing display

| Situation at the ask | Record | What the bar, Sim tab and HUD show during the run | Today |
|---|---|---|---|
| The page's check running/waiting on V, gateway verified V | verified, `verified_against.version = V` | The check goes on (§5.2) with its existing words ("42 % checked" → "Clear · checked to the end") | The idle sweep runs on unadmitted (§1.3) |
| Preview being updated (F14), or another start (S/M) | unverified, accepted | **"Not checked · started before the check"**. The coverage slot "not checked" (P6-d0's form) | The earlier idle "Clear" stays shown (§1.3), or "Collisions not checked" |
| No preview (F2) | unverified (`no publication of this program`), accepted | "Preview after the run" (P2b-F1, unchanged) + "Not checked · started before the check" in the Sim tab | "Preview after the run" |
| Run from line N | either, accepted | "Not checked · run from line N" (P6-d0, unchanged) | the same |

**Change in `checkBasis.ts`:** `uncheckedRun` (147–150) also returns the run when it is `sent`, from line 0 and **not verified**, with the reason `started` ("started before the check").
- Every such run is an accepted one now: the gateway asks otherwise.
- The P6-d0 machinery does the rest: `_colEnterNotChecked`, the bar slot, the Sim tab, "never Clear".
- This also closes the stale "Clear" of §1.3. That is a behaviour change, held by N3c.

### 5.2 Path 2 for a verified start (P6-d v4 P1–P3, agreed R462; P4 stays out)

- **Admission:** `admitRunCheck` gets path 2. An unpinned origin is admitted only with the record's `verified_against` for exactly the shown publication: R462's nine conditions, version alone never.
- **Keep or re-run** (new, Q-C3). At the run's entry:
  - if the shown sweep, running or finished, is of `verified_against.version` and its basis equals the run's start basis — `sameCheckInputs(_colBasis, basisFromRun(rb))` (checkBasis.ts:90–97) **without** `startJoints`, which an idle basis never has — then it is **kept** as the run's check;
  - otherwise `_startRunCheck` builds it from the record: provisional from the playhead, then full.
- Keeping avoids a second full check during motion in the common case, a finished idle check followed by a start (R1 of P6-d: the N100's two cores).
- A kept *running* sweep keeps its idle worker settings. Re-posting it at the run's limits (2 shards, 20 ms slices, 4189–4193) is a **measured decision** (Q-C3).

### 5.3 Stage 2 (deferred, own plan): the check catches up in an unverified run

This would make "Started now" read "not checked yet → run check". It needs **the first pinned parse from the start capture**, which is P2b-F2 and Codex MT449-01. Every input is to be captured **at the record, before the AUTO write**:

| Input | Source at the record |
|---|---|
| program text | the record's `source` |
| parameters (`param_text`, G92) | the var file after the AUTO switch's synch, read once; a new inode proves it fresh (the G30 rule) |
| WCS table | the same read |
| kins type/frame | the reader snapshot |
| rotary seed | `stat.actual_position` |
| tool start | spindle tool + applied offset + `stat.tool_table` |
| toolsetter book | `_toolsetter_parse_ctx()` |
| limits | `stat.joint` |

How it works and what stays open:
- The pinned parse is built from that capture, never from a publication. It names the run (`for_run`), and path 1 admits it.
- Until it publishes, the bar reads "Not checked yet · preview being made", which reuses SimPanel's existing "Not checked yet" (SimPanel.vue:633).
- **Open points:**
  - unsupported components stay unpinned and named;
  - a run that ends or is aborted, or a new load, drops it;
  - a first publication whose basis revision moved since the capture (the publish-time check bulk_pipeline.py:1326–1347).
- **Q-S4** asks the operator whether stage 2 is wanted: it is a gateway package of its own size.

---

## 6. Question 3 — Run from line

**Its sequence:**
1. The tap on Start with a line opens the dialog. Nothing is sent.
2. The dialog's hold sends ONE `auto_run`.
3. The gateway then runs: entry checks → `_start_guard` → (pre_tool) values → `_rfl_start` → measuring → `#3116` → safe Z → positioning → spindle → `starting` → AUTO_RUN.

**Where the question is asked:**
- At step 2, **before anything moves**: the RFL dialog is the "message at start".
- At the gateway entry (≈9379, before `_start_guard` at 9396), `start_line > 0` always asks unless the command carries the acceptance.
- At the record inside the sequence (7265), the acceptance came with `verified: false`, so the verdict there (unverified after a measurement, F14 / T) never asks again.
- Nothing waits. The P6-d wait phase is dropped.

**Variant A (recommended):** the note inside the existing dialog, whose hold is the acceptance.
- A `.statusNote.warn` line above the actions: "Not checked for collisions — run from line 7", with a `HelpIcon`.
- The hold (GcodePanel.vue:1474, unchanged label) sends `unchecked_ok: {program_id, version, verified: false}`.
- One dialog, one hold, the same contract as Cycle Start.

**Variant B:** no note; the gateway asks; the same start dialog opens after the RFL hold.
- Title "Run from line 7 without collision check?"; action "Run from Line 7" (warn hold).
- That is two holds for every RFL. P6-d0 makes the answer "not checked" on every RFL, so it adds no information.

The operator chooses (Q-S2). Both are rendered.

**When the rest-of-program check (P4 / MT462-01) exists later:** the note becomes conditional, like Cycle Start's question. After an M600 pre-measurement it stays (T: the tool row moves inside the sequence), unless stage 2 exists.

**Step:**
- A Step from idle starts the program and takes a record (`_auto_start_line` → 0), so it asks like Start ("Step now").
- A Step in a paused run and Resume continue the run and never ask (no new record, `_begin_run_basis` returns None).

---

## 7. Question 5 — words (≤ 60 characters a reason or line, ≤ 120 a help)

### 7.1 Dialog

| Element | Words | Chars |
|---|---|---|
| Title | Start before the check is finished? | 35 |
| Title (step) | Step before the check is finished? | 34 |
| Help "?" | The collision check of the preview is not finished. Start now runs the program without waiting for it. | 103 |
| Consequence (verified) | Started now, the collision check goes on during the run. | 55 |
| Consequence (unverified, or nothing to check with) | Started now, this run is not checked. | 37 |
| Consequence (verified, stopped short) | Started now, the run is checked only to 75 %. | 45 |
| Action | Start now / Step now (warn, hold); after the check: Start (primary, hold) | — |
| Cancel | Cancel | — |
| Finished while open | title: Check finished — start the program? (35); line: Collision check finished · Clear / · 2 collisions (≤ 40); no consequence line | — |
| Lines with a bar | Collision check running / Preview loading (the bar names the %); Collision check waits for the (new) preview | ≤ 41 |
| Hold changed | Check changed — hold again (btnHint) | 26 |
| Reply as a message (old page) | Check not finished — confirm the start | 38 |

### 7.2 The gateway's whys, as lines (a pure `startWhyWords(why)` beside `previewRefreshLabel`)

| `why` | Line |
|---|---|
| `no publication of this program` | Preview not ready |
| `a parse runs or is pending` | Preview being updated |
| `drift open: table_mtime` / `table_row` | Preview older than the tool table |
| `drift open: toolsetter`, `toolsetter values to be written` | Preview older than the toolsetter values |
| `drift open: wcs…` | Preview older than the work offsets |
| `drift open: limits…` | Preview older than the soft limits |
| `the program text is not the published one` | Program changed on disk |
| `another fixture` / `another fixture table` / `another G92` | Preview made for other work offsets |
| `another kinematics state` | Preview made for another kinematics mode |
| `another rotary pose` | Preview made for another rotary position |
| `another tool start` | Preview made for another tool |
| status / capture / tool-table-unreadable whys | Start state not read |
| anything else | Preview is not the start state |

### 7.3 Run from line, bar, Sim tab, protocol

- **RFL note:** "Not checked for collisions — run from line 7" (44). Help: "The collision check covers a run from the program's beginning only. This run is not checked." (93)
- **Sim tab summary:** "Not checked · started before the check" (38). Help: "Started before its check was finished: this run is not checked for collisions." (79). The bar keeps P6-d0's "not checked" slot and ⊘.
- **Message center:** `log` (quiet), "Started before the check — not checked (Preview being updated)". The operator's own choice is recorded, not notified.

**Glossary** (docs/ui-glossary.md):
- extend the row "A run the collision check does not cover" with "Not checked · started before the check";
- a new row "A start before the check is finished": **Start now** (button), "Start before the check is finished?" (title). Never: "Start anyway", "Force", "Skip check".

**Layout.**
- Desktop and touch: the confirm tier; touch takes 44 px controls.
- Portrait 900 × 1200 at 150 %: the min-width capped by the room. The title wraps; the two actions stay on one row (`dialogs.spec` checks ≥ 8 px from the edges and every corner of the overlay).
- The action slot reserves the longer label.

---

## 8. Question 6 — guards, mutations, native cases

### 8.1 Unit (vitest / pytest)

**Page:**
- `startCheck.test.ts`: `pageCheck` over every row of §2.2 (total, default unfinished); `startWhyWords` for every `run_start_check` why (a scan of bulk_pipeline.py's literal whys, so a new why fails the test); `consequenceLine` for every (verified, page state) pair of §3.4.
- `checkBasis.test.ts`: `uncheckedRun` for an unverified line-0 sent run (reason `started`); path 2's admission, R462's C1/C2 (version alone never admits).
- The keep rule (`sameCheckInputs` without `startJoints`).
- `actionAdmission.test.ts` / a new `requestStart` test: one entry for button, key and pad; a second gesture while open does nothing.

**Gateway:**
- `test_start_ask.py` (new; fake_linuxcnc, conftest):
  - the ask at entry for each why;
  - nothing written before it (no MDI, no mode switch, no sync: a recording `_cmd_blocking`);
  - an acceptance with `verified:false` covers every unverified state; one with `verified:true` does not;
  - `program_id` mismatch is refused;
  - `check` finished for another version asks;
  - RFL `line > 0` asks without an acceptance and never at its record with one;
  - Step from idle asks; a paused step and Resume never do;
  - the record refuses with `at:"record"` and the record is `unsent`;
  - `verified_against` is projected only when verified (G6, U11/U11b of v4).
- `test_command_dispatch` / `commandShapes.test.ts`: the three fields bounded, named contracts.
- `run_check_wire.json`: `accepted`, `verified_against`.

### 8.2 Browser (mock gateway; `mock-gateway.mjs` answers `ask` in the same commit, memory rule "new wire fields update the mock")

- `start-ask.spec.ts` (new), checks the dialog, through each of the three gestures:
  - the dialog opens on the ask reply; Cancel sends nothing;
  - Start now sends `unchecked_ok` bound to what was shown;
  - the second pad press does nothing;
  - **Space held through the mount** (real `keyboard.down(" ")` → mount → 1 s → `up`): one dialog, no start, no button clicked;
  - "Start now" with Enter and Space does nothing;
  - finished while open: the words change, the button keeps its box (bounding box equal), the `holdKey` change cancels a hold under `page.clock`;
  - each close event;
  - E-Stop by Escape while open.
- `collisions.viewer.spec`:
  - an accepted unverified line-0 run shows "Not checked · started before the check", and an earlier "Clear" goes (the counter-case of §1.3);
  - path 2: a verified start keeps the running sweep (no new job) / re-runs it from the record;
  - version-only refuses.
- `dialogs.spec` (the new dialog in its row list), `layout.spec` / `layout-audit` (portrait 150 %).
- `controlInventory` + the function inventory: the new control, command fields and words. `scripts/test_select/rules.py` for the new files.

### 8.3 Native cases (VM sim, `native_run.py` variant `start`; the page probe judges page words)

| | Case | Expect (head) | Base `dbd14cab` |
|---|---|---|---|
| N1 | **Early start before the first preview** (load a 20 000-line program, press Start during its parse) | the ask at entry, why `no publication…`; the dialog "Preview loading N %"; Cancel → no AUTO, no `run_basis.start`; Start now → started, `accepted`, "Preview after the run" + "Not checked · started before the check" | starts at once, unverified, unasked |
| N2 | **Start after a tool measurement** (MDI `T1 M600`, Start within 2 s) | the ask (`a parse runs or is pending` or `drift open: table_mtime`); D2's words; Start now → "Not checked · started before the check"; control: wait for "Clear", press, then no dialog, verified, Clear stays | starts unverified; an earlier Clear stays |
| N3 | **Start with the page's check at x %** on a current preview | the ask, `verified:true`; D1's words; Start now → verified record; the sweep kept (no new job) and finishing "Clear" in the run | starts; the sweep runs on, unadmitted |
| N3c | the counter-case: a finished Clear, then an unverified accepted start | "not checked", no Clear | Clear stays (§1.3) |
| N4 | **Run from line** (variant A) | the note in the dialog; one hold; started; "Not checked · run from line N"; a raw `auto_run` without the acceptance (WS client) → the ask, no `rfl_status`, nothing moves | starts |
| N5 | **Toolsetter values changed** (server section ≠ booking), a program with M600 | with the prediction: the ask at entry, nothing written; without it: the ask at the record, the record `unsent`, no AUTO_RUN written | starts unverified |
| N6 | **Space held** 2 s on the real page | one dialog, no `cycle_start` with an acceptance, no click | today repeats |
| N7 | **Dialog open, another client starts** | the dialog closes | — |

Common to all cases:
- `restore` / `restore_post` complete, as the native stage requires.
- The LAN sim is given back with proof.
- No gamepad on the VM: the pad path is e2e only.

### 8.4 Mutations (each red at its guard)

| | Mutation |
|---|---|
| M1 | no ask at entry |
| M2 | the ask after `_start_guard` / sync |
| M3 | the acceptance ignores `program_id` |
| M4 | `verified:true` acceptance covers unverified |
| M5 | the record does not decide again |
| M6 | the RFL `line > 0` rule dropped |
| M7 | `check.version` ignored |
| M8 | `pageCheck` defaults to finished on an unknown state |
| M9 | `uncheckedRun` without the unverified rule |
| M10 | path 2 on version alone |
| M11 | the keep rule including `startJoints` (never keeps) / ignoring the basis (always keeps) |
| M12 | `requestStart` sends while the dialog is open |
| M13 | `e.repeat` not ignored |
| M14 | "Start now" not a hold |
| M15 | `holdKey` without the reason class |
| M16 | `start_ack` not passed into the RFL sequence's write |

### 8.5 What the operator sees

- **Start before the check is finished** → after the hold, a question naming what is not finished (with the percentage running), what starting now means, and Cancel / Start now (amber, hold).
- **After a tool measurement** → "Preview being updated — tool table change".
- **Start now** →
  - a verified start: the check goes on in the bar;
  - otherwise: the bar says "not checked" and the Sim tab says "Not checked · started before the check".
  - It never shows an old Clear.
- **Run from line** → its dialog says "Not checked for collisions" before the hold.
- **The check finishes** while the question is open → the button becomes "Start".

---

## 9. Renderings (prototype, not for merge)

**What the prototype is.** Scratch branch `scratch/start-proto`, commit `bde06efe` on `dbd14cab` (in the worktree, local, not pushed):
- `startCheck.ts` (the pure words);
- `StartCheckDialog.vue`;
- the catalog entry;
- the RFL note;
- the widened `uncheckedRun` words;
- a **render-only** hook `window.__startAskProto(view)` that opens the dialog in a given state. The real ask reply is not built.

**How they were made.**
- The real build (`npm run build`) and one throwaway Playwright spec on the mock gateway (the P5 renderings pattern), under the heavy lock.
- Viewports: `desktop` 1600 × 1000, `touch-fullhd` 1920 × 1080, and portrait 900 × 1200 at 150 % zoom.
- The PNGs are in `/home/cnc/claude-work/start/render/`; the page is `/home/cnc/claude-work/start/page/index.html` (German captions, with its own copy of the PNGs under `page/render/` so it stands alone).
- In portrait the two-row bar shows P6-d0's ⊘ glyph instead of the words in B1; the Sim tab names the reason. In RB the RFL line and the consequence say the same thing twice; variant B would keep only the first.

---

**States and file names.** `render/<viewport>-<state>.png`:
- viewports: `desktop`, `touch-fullhd`, `portrait`;
- states: `D1-check-running`, `D2-preview-updating`, `D3-no-preview-yet`, `D4-gateway-toolsetter`, `D5-finished-while-open`, `D6-gate-closed` (a real disarm: "Start now" dimmed by its own `run` gate), `RA-run-from-line-note`, `RB-run-from-line-second-question`, `B1-run-not-checked` (a real `run_basis` with `verified:false`, start line 0, running: the bar slot "not checked", the Sim tab "Not checked · started before the check"), and `00-base`.

**What the prototype showed (to carry into the build):**
- **P-F1 — a "?" as a direct child of `.statusNote` stretches into a wide oval.** `style.css:1460` gives every non-button child `flex: 1 1 12em`, and HelpIcon is a `span role="button"`. The "?" must sit **inside** the note's text span. (The first RFL rendering showed it; fixed in the second run.)
- **P-F2 — `stable-width` keeps the action's box** when "Start now" becomes "Start" (D5, portrait): no move under a press.
- **P-F3 — the RFL action is dimmed when the toolsetter is not set up** (the existing rule GcodePanel.vue:1474). The note still shows; the render program has no tool change before line 7, so the action is live.
- **P-F4 — the confirm tier at 150 % portrait** fits the title in two lines and the two actions in one row. The dialog sits in the content column, the strip stays free.

## 10. Files and order of work

**Order of work:**
1. **Gateway:** `_start_verdict` (G1); the entry ask in `cycle_start` / `auto_step` / `auto_run`; `start_ack` through `_cmd_blocking` and `_rfl_start` → `_rfl_sequence`; the prediction terms (Q-C2); `_StartAsk`; `accepted`, `verified_against`, traces; `COMMAND_SCHEMA`; tests §8.1.
2. **Page:**
   - `startCheck.ts`, `StartCheckDialog.vue`, `requestStart` in App;
   - the gestures (GcodePanel, useKeyboardShortcuts with `e.repeat`, useGamepad);
   - the catalog entry, the RFL note (variant per Q-S2);
   - `uncheckedRun` widening, path 2 (`runBasis.ts` parse, `checkBasis.ts`, ThreeViewer's keep rule);
   - `mock-gateway.mjs`; tests §8.2.
3. **Docs:**
   - `scrub-and-run.md` ("Check during a run": the ask, the acceptance, path 2; "The program identity": F2's start asks);
   - `safety-and-permissions.md` (the start's admission vs its ask; the changed invariant);
   - `frontend-modules.md` (StartCheckDialog, startCheck.ts);
   - `ui-glossary.md`; `decisions.md` (Q1's answer, the dropped wait, the contract);
   - CLAUDE.md short forms (the GcodePanel line, Key Patterns "Starting motion is a hold": Start now is a hold, never a key).
4. One round gate per step; the native cases N1–N7; the merge gate.
5. Stage 2 (§5.3) and the RFL rest check (P4) are separate plans.

---

## 11. Risks and not verified

- **R1 — a stuck "unverified".** The ask is as strict as `run_start_check`. A term that no idle edge re-parses would ask on every start until something re-parses. The active fixture index alone is a suspect (`run_start_check` compares `g5x_index`, bulk_pipeline.py:657; scrub-and-run.md says the index alone raises no re-parse). **Step 0 of the build** is a native probe of every `run_start_check` term: change it at idle, then show that a start after the re-parse is verified, or name the term.
- **R2 — CPU in motion** (path 2 on the N100): the same as P6-d R1. The keep rule reduces it; measuring it is owed.
- **R3 — two holds** for a start before the check (the strip's and the dialog's). That is intended: the second hold is the override.
- **R4 — an old page:** a cached page sends no fields and sees an error line on an unverified start. It stops being the case after a reload.
- **R5 — multiple devices:** a device with simulation off asks only on the gateway's facts. A device whose check is finished cannot vouch for another device's press.
- **Not verified:**
  - **The gestures.** The prototype has no `requestStart` and no ask reply: the dialog was opened by a render hook. Space held through the mount, its keyup on the container, the pad's second press and Enter/Space on "Start now" are design claims with guards owed (§8.2), not prototype results;
  - §1.3's stale Clear through an unverified run (code reading; N3c);
  - the prediction terms (§4.3) as pure functions (code reading);
  - the record-flip latency on the N100;
  - the page's `check.version` vs the gateway's publication in the one-frame lag;
  - no native run of anything in this plan.

---

## 12. Questions

### For Codex

- **Q-C1:** The contract (§4): the start command carries `check` and `unchecked_ok`, the gateway asks at its entry before any write, and decides again at the record; ONE verdict function. Is "the machine never waits; it asks" acceptable as the new invariant? Should `unchecked_ok` also bind the version (we bind `program_id` and the verdict class only, §4.2)?
- **Q-C2:** The two prediction terms at the entry (the sync's own "would write" condition, `_ts_book`'s "would change"). Are they enough to keep the record's ask an exception, or do you want the sync moved after the record?
- **Q-C3:** Path 2 plus the keep rule (`sameCheckInputs` without `startJoints`) for a verified start whose idle sweep is running or finished. And: should a kept running sweep be re-posted at the run's limits (2 shards, 20 ms)?
- **Q-C4:** Are "checked to the end" (caveat) and "start not checked" finished checks for the ask (proposed yes)?
- **Q-C5:** Widening `uncheckedRun` to every unverified line-0 run, which closes the stale Clear of §1.3. Any run you would keep checked there?
- **Q-C6:** Step from idle asks like Start (proposed). A step in a paused run never asks.

### For the operator (Claude asks)

- **Q-S1:** The dialog as rendered (D1–D6): the title "Start before the check is finished?", "Start now" amber and held, Cancel. Is that the message you meant?
- **Q-S2:** Run from line: **A**, the note "Not checked for collisions" inside the Run-from-line dialog (one hold, recommended), or **B**, a second question after its hold?
- **Q-S3:** When the check finishes while the question is open: the button turns into "Start" (recommended), or the question closes and you press Start again?
- **Q-S4:** After "Start now" without a current preview the run stays "not checked" (this package). Do you want the later package in which the check catches up during the run (a parse made from the start's own state)?
- **Q-S5:** A device with the simulation switched off: ask only about the preview (as planned), or not at all? And a finished check **with** collisions asks nothing today. Should it?

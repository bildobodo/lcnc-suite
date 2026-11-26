# Start message — "check not finished" at a start (machine-day F14 + P2b-F2): plan v2

**Status:** plan only, nothing built. Code sites are at development `dbd14cab` (worktree `/home/cnc/lcnc-suite-start`, branch `feat/start-plan`). The renderings of v1 come from the throwaway prototype `scratch/start-proto` (`bde06efe`), which is not for merge.

**Review:** Codex R502 accepted the direction:
- the start command decides;
- the first question comes before its writes;
- an explicit choice starts at once;
- there is never an auto-start.

It found four plan findings. MT502-01, -02 and -03 are P1; MT502-04 is P2. This version closes them.

## 0. Changes from v1

| Finding / answer | v1 | v2 |
|---|---|---|
| **MT502-01** The whole decision at the actual start | The record re-checked `not verified` only. `unchecked_ok.version` was carried but unused, so a consent to v10 passed at v11. | ONE rule (`_start_decision`) at **three points**: the entry, the record, and the AUTO write's own thread (§3.2). It carries the page's claim and the consent from the entry to the write. A **publication fence** under the `Generation` lock makes the write-thread decision and the write atomic against publications (§3.3). The consent is bound to the gateway's **ask** (`ask_id`: connection, program, publication version, action, start line) and has **two kinds**: `continue` (bound to its publication) and `unchecked` (promises no coverage; RFL) (§3.4). A refusal writes no AUTO and leaves the record `unsent`. `accepted` and `verified_against` belong to exactly that start. |
| **MT502-02** Reuse an idle check only for its proven parts | The keep rule compared `sameCheckInputs` without `startJoints` and kept the whole result, even a running sweep. | Only the **start-independent main part** (the sweep from K = `depEnd`, collision.ts:1673) may be reused, and only when **finished**, of the same publication, with every check input equal. The **beginning** is always bound to `rb.start.joints` as the run's own side job (`_runBoundTrack`, ThreeViewer.vue:4476); the sim entry side job is never reused. A **running or parked** main is cancelled and the run check is posted fresh under the run budget (`_startRunCheck`, ≤ 2 shards, 20 ms). Ownership moves to a new run generation. No percentage comes from another track. M11 reworded (§5.2). |
| **MT502-03** "Finished" is no substitute for the result and its limits | `done` was mapped to "finished · Clear" with a primary "Start". The hold key had no consequence class. | The page's claim separates **calculation** (running / ended / not checked) from the **result class** (full-clear / full-findings / restricted). The dialog shows the Sim tab's **own** verdict, coverage, caveat and "?" (`simView.sweep`). "Start" is primary only for full-clear. A whole-unbindable or whole start-dependent result is **not checked**, never "Clear". The hold key carries the **consequence class**. The claim "the situation can only get better" is removed (§2.2, §4.4–4.6). |
| **MT502-04** The attempt is owned from the send | Guarded "while the question is open"; it assumed the finger was up when the ask arrived. | ONE `startAttempt` per page: idle → awaiting → asking → submitting → terminal. No second start in awaiting or submitting. Replies must match the active attempt, its connection, program and action; a late reply after Cancel opens nothing. A timeout ends as an "unknown outcome", never retried. The dialog's visibility is held through the press (`heldThroughPress`, inputSession.ts:401): the hold fires while the finger is **down** (MachineBtn.vue:222–235), so the dialog appears only after that press has had its click (§4.1–4.3). |
| Q-C1 | — | Yes. An old page gets "Reload the page to confirm this start" (§3.6). |
| Q-C2 | — | Yes: the two predictions use exactly the sync's and the booking's own conditions. The sync stays **before** the record. The full final decision stays authoritative (§3.5). |
| Q-C3 | — | Path 2 with R462's full binding. Reuse only per MT502-02. Run budgets stay. |
| Q-C4 | — | Per MT502-03. Whether a restricted, ended check asks every time is operator question Q-S6. |
| Q-C5 | — | Yes, for every **proven** not-verified sent run from 0. No old Clear may stand, and late replies or publisher continuations may not restore one (§5.1). |
| Q-C6 | — | Yes. |
| RFL | — | Variant A is technically preferred; Q-S2 stays with the operator (§6). |
| Stage 2 | — | Separate and honest (§5.3). |

The renderings of v1 stay as layout evidence of the render hook only (R502). §9 names what a re-render would change (D5's words, the `done` sub-cases).

---

## 1. Today's start paths (code reading at `dbd14cab`)

### 1.1 The page — three gestures, one admission, no question

| Gesture | Site | What it does |
|---|---|---|
| **Start button**: a hold, 500 ms (`HOLD_FIRE_MS`, machineControls.ts:39) | GcodePanel.vue:1159–1163 (`:hold="!opensRunDialog"`), `onStartClick` :904–916 → `emit("cycleStart")` → App.vue:1843–1845 `fire({cmd:"cycle_start"}, "run")` | The handler runs **at the end of the hold time, with the finger still down** (`HoldGesture.due` → `fire` → MachineBtn.vue:222–235 `callClickHandler`). With a selected line > 1 the tap only opens the Run-from-line dialog (:902, :905–912). |
| **Space**: instant, no hold | useKeyboardShortcuts.ts:175–181: resume, else pause, else `startAdmitted(...)` → `fire cycle_start` | A dialog or the keypad blocks it (:138, `modalOpen`). There is **no `e.repeat` check**. `cycle_start` has a 200 ms latch and `cycle_pause` none (lcnc.ts:249–291). Code reading only. |
| **Gamepad Start** | useGamepad.ts:241–243, the same rule | **No modal guard.** `gamepadGated` covers the Settings dialog only (App.vue:2005). |
| **Run from line** | the dialog GcodePanel.vue:1400–1477; its action is a hold (:1474) → `confirmRunFromLine` :918–942 → App.vue:1847–1880 ONE `auto_run` bound to program, version and source | It scans tool changes and the entry position at the tap (:906–911). |
| **Step**: a hold | GcodePanel.vue:1166–1169 → App.vue:1881–1883 `fire({cmd:"auto_step"}, "step")` | From idle it starts the program. |

More facts about the page:
- One admission per action: `actionAdmission.ts:37–47` `startRefusal` plus the `run` gate.
- `fire` holds only a **time** latch: 200 ms by default (App.vue:1769–1791, lcnc.ts:275). It is no lock until the reply.
- A hold button is never activated by a key: MachineBtn.vue:130 drops the caller's `onClick` for a hold.

### 1.2 The gateway — a start never waits and never asks

**`cycle_start`** (gateway.py:9639–9658) runs these steps in order:
1. `require_armed`.
2. `_toolsetter_basis()`.
3. `_start_guard` (6883–6920): the RFL busy refusal, the `#3116` clear when unknown, `_program_start_refusal`.
4. `_toolsetter_sync` (7886–7925), which writes when its own condition (:7910–7913) says so.
5. The admit, then `set_mode(AUTO)`. **No write when the task is already in AUTO** (5467–5472) — which is where every program leaves it — and so no `Generation.began()` either.
6. `_cmd_blocking(AUTO_RUN, 0)`:
   - `_ts_mark_assumed(...)` (:5315);
   - `_begin_run_basis` (:5321) → `run_start_check` (bulk_pipeline.py:633–711);
   - the claim;
   - the write thread with its `admit`, then `cmd_fn`, then `written`.

**`auto_step` from idle** (9301–9316) runs the same steps.

**`auto_run`** (9319–9425):
- It binds to the published version, source and `program_id` (9347–9360).
- It checks the text on disk (9364–9378).
- Then it runs either the sequence (`_rfl_sequence` 7140–7281 → AUTO_RUN at 7265 under `_basis_admit`) or a plain AUTO_RUN N.

**Publications.** A publication assigns its fields inside `Generation.publish_if` under the generation's lock (calc_lifetime.py:80–126, used at bulk_pipeline.py:610). An input write's `began()` in its write thread takes away the right to publish from every parse snapshotted before it.

**`run_start_check` compares with the publication current at the moment of the call.** "Verified" does not mean "the same publication as before" (R502).

**The record never refuses.** An unverified start goes out (`_unverified_run_basis` 5084–5106). `_run_for_pin` (5183–5196) needs `verified` and `sent`.

### 1.3 The page during the run

- **Path 1 is the only admission:** `admitRunCheck` (checkBasis.ts:158–180) admits only a pinned parse with `for_run`, from line 0, start verified.
- **A run from line is named not checked:** `uncheckedRun` (147–150) → `_colEnterNotChecked` (ThreeViewer.vue:4569–4596).
- **The idle check and its three parts:**
  - The idle **main** sweep runs the base track from K = `depEnd`. Its baseline is point K, the first known pose (collision.ts:1670–1674). Before K, the beginning depends on the start.
  - The simulation's **entry** side job binds the beginning to the simulation's own pose.
  - A run check binds the beginning to `rb.start.joints` as its own side job (`_startRunCheck` 4432–4470, `_runBoundTrack` 4476 ff.).
- **An idle result or sweep is kept through a line-0 run, verified or not** (code reading; native case N3c):
  - `_colOnInputChangeNow` returns early in a run (4629).
  - The run watchers (4552–4615) do not cancel the idle job.
  - The idle job keeps its idle worker budget (4189–4193, set at the post by `_colBuildRequest` 4129).
- **F2:** an unverified record without context. The unpinned parse waits for idle, and the page says "Preview after the run" (previewWait.ts:93–99).

---

## 2. Question 1 — when exactly is "the check not finished"?

### 2.1 The facts and where each is known

Column meanings:
- **gw@record** is today's authority.
- **page@press** is what the page holds when the gesture completes.

| # | Fact | gw@record today | page@press | Wire | Gap |
|---|---|---|---|---|---|
| **F2** | No publication of this load | `no publication of this program` (bulk_pipeline.py:644–646) | `previewWaitWords` (previewWait.ts:135–153), `preview_refresh.first` | `preview_origin.program_id`, `preview_wait` (gateway.py:4850–4874) | ≤ 1 frame |
| **F14a** | A parse of this program runs or is scheduled | `a parse runs or is pending` (:647–648) | `previewRefresh` (statusStore.ts:221, 617–645) | `preview_refresh` (bulk_pipeline.py:829–856) | ≤ 1 frame |
| **F14b** | A restart is pending, not scheduled | the same why | **invisible**: `preview_refresh_status` is None unless `refresh_running` (:835) | — | **gateway only** |
| **F14c** | A drift edge evaluated without debounce: table, WCS, limits, toolsetter book (`_ts_open_drift` 5159–5171) | `drift open: …` (:686–711) | the page waits for `drift_decision` (`_colDriftReady` 4395–4428), but only once its round began | `drift_decision` | **gateway only** until the decision |
| **S** | Controller start ≠ published start: fixture, table, G92, kins, rotary pose, tool start, text | `another …` (:649–677) | the page re-checks on its live inputs (4618–4637): no proof of the start | partly | **semantic** |
| **V** | **The publication itself changes** between the entry and the write (a parse running at the entry publishes v11) | each call verifies against the **current** publication | — | `preview_origin` | **gateway only**, at each point (R502) |
| **M** | What the start itself moves: the sync (7910–7922), `_ts_mark_assumed` (5315) | seen at the record | — | — | predictable at the entry (§3.5) |
| **P** | The page adopted the payload | — | `viewerGcode.publishedVersion`, `previewBasisPending`, `previewDecoding` | — | **page only** |
| **C** | The page's sweep of the shown payload: calculation and result (§2.2) | — (no page is a precondition of a start) | `simView.sweep` (simPanelStore.ts:11–36, 52–68 ← ScrubBar.vue:1137–1263), `simulationOn` | — | **page only, per device** |
| **L** | Run from line N > 0: never checked (P6-d0) | `start_line` (`_auto_start_line` 5065–5080) | the selected line | `auto_run.line` | none |
| **T** | RFL with a pre-measurement | unverified after measuring | `rflPreTool > 0` | `auto_run.pre_tool` | none |
| **X** | A foreign or halui start | no record | — | — | out of scope |

**Conclusion.**
- The start command carries the page's claim C.
- The gateway decides with ONE rule on its facts plus that claim, and it does so at every point up to the write: the entry, the record and the write thread (§3).

### 2.2 The page's claim — calculation and result kept apart (MT502-03)

`pageCheck(inputs) → { calc, result, version, view }` is pure and lives in a new `startCheck.ts`.

`view` is the **Sim tab's own** `SimSweepView` (simPanelStore.ts:11–36): `verdict` (result · coverage), `tone`, `caveat`, `detail` and `state`. There are no new result words.

| Page state | Source | `calc` | `result` | Dialog shows |
|---|---|---|---|---|
| simulation off on this device | `simulationOn` false | **none** (no claim) | — | nothing about collisions (§4.7) |
| no own payload (F2) | `previewWaitWords(...).hud`, or no `viewerGcode` for `program_id` | running | — | the hud words, or "Preview loading" + bar; "Collision check waits for the preview" |
| a newer publication being made (F14a) | `previewRefresh` for this program, `!first` | running | — | "Preview being updated — tool table change"; "Collision check waits for the new preview" |
| payload not adopted / shown ≠ `preview_origin.version` | `previewDecoding`, `previewBasisPending` | running | — | "Preview being updated" |
| sweep not begun (timer, drift wait, geometry) | `simView.sweep` null, not busy | running | — | "Collision check not started yet" |
| `checking` / `paused` | `sweep.state` | running | — | "Collision check running" + bar / "Collision check paused at 40 %" |
| `done`, no `startDependent` restriction, no caveat, 0 findings ("Clear · checked in full"); `nopairs` certified ("No moving pairs") | ScrubBar.vue:1261, 1183–1184 | ended | **full-clear** | `verdict` (ok tone) |
| `done`, checked in full, with findings | 1261 | ended | **full-findings** | `verdict` (danger or warn tone) |
| `done` with the caveat ("checked to the end"), `done` "· start not checked" (sd.unbound with a result), `partial` ("stopped at 75 %") | ScrubBar.vue:1261 (caveat), 1258–1260, 1246–1249 | ended | **restricted** | `verdict` (its own tone), the caveat, the "?" detail |
| `done` whole start-dependent ("Depends on the machine's position"), `done` whole unbindable ("Not checked"), `nopairs` uncertified ("Not checked") | 1255–1257, 1183 | **not_checked** | — | `verdict` (warn): never "Clear" |

**Rules of the claim:**
- `version` is the shown payload's `publishedVersion`. A claim other than `none` is only made for the shown payload of the active `program_id`.
- `calc: ended` means "the calculation is over". It says nothing about full coverage, certification or no collisions (R502 Q-C4).
- **A positive "Clear" text or a primary action never covers a `not_checked` or `restricted` result.**
- Whether a `restricted` ended check asks at every start is a decision for the operator (**Q-S6**). v2's default does not ask: it is today's bar state, shown with its limit.
- **Total and default:** any state not named in the table is `calc: running`, so it asks.

---

## 3. The gateway contract (Q4; MT502-01)

### 3.1 Wire

`cycle_start`, `auto_step` and `auto_run` gain these fields. Each is a named contract in `command_policy.COMMAND_SCHEMA` and in `lcnc.ts` `WsCommand`:

```
program_id: str                         — the load the page shows (always sent)
attempt: int                            — the page's attempt number (always sent; echoed)
check: { version: int|null, calc: "running"|"ended"|"not_checked"|"none",
         result: "full-clear"|"full-findings"|"restricted"|null }   (always sent)
consent: { ask_id: int, kind: "continue"|"unchecked" }   — only from the dialog / the RFL hold
```

When the gateway asks, it replies:

```
{ ok: false, error: "Check not finished — confirm the start",
  ask: { ask_id, attempt, program_id, version: int|null, verified: bool, why: str|null,
         action: "start"|"step"|"rfl", start_line: int, at: "entry"|"record"|"write",
         offer: "continue"|"unchecked" } }
```

- `offer` is the consent kind the gateway would accept for this situation (§3.4).
- The page reads it into its consequence class (§4.5).

### 3.2 ONE rule, three points

`_start_decision(file, source, claim, consent, action, start_line, conn)` → `go | ask(why, offer)`.

It is built on `_start_verdict` (P6-d v4 G1), which runs `run_start_check` and returns `(verified, why, against)`, where `against` is `(published_program, preview_version, published_source)` read in the same synchronous step.

```
needs_consent =
      not verified
   or claim.calc in ("running", "not_checked")
   or (claim.calc == "ended" and (claim.version, claim.program) != (against.version, against.program))
   or start_line > 0                                   # P6-d0: never checked
   [or claim.result == "restricted" and Q-S6 says ask]
go  = not needs_consent or consent_matches(consent, situation)
offer = "continue" if (verified and claim.calc == "running" and start_line == 0) else "unchecked"
```

| Point | Where | What it reads | On `ask` |
|---|---|---|---|
| **Entry** | `cycle_start` after `require_armed` (9639); `auto_step` from idle (9301); `auto_run` after its binding and text checks (≈9379) — before `_start_guard`, the sync and any write | a fresh `stat.poll()`, the handler's own text hash, plus the two predictions (§3.5) | reply `ask` (`at:"entry"`); **nothing written** |
| **Record** | `_cmd_blocking` right after `_begin_run_basis` (5321): the record's own verdict and its `against`. Claim and consent are carried by a new `start_ctx` parameter (the handler, or `_rfl_start` → `_rfl_sequence` for RFL) | the record's fields | record `unsent`, `refused:"ask"`; `_StartAsk(_WriteRefused)` with the ask (`at:"record"`); no AUTO write |
| **Write** | inside the write thread's `admit`, as its **last** term after the controller/link/gate admissions, which stay as they are | under the `Generation` lock: the published identity `(program, version, source)` and the record's decision publication | the fence is not set; `_StartAsk` (`at:"write"`); record `unsent`; nothing written |

### 3.3 The publication fence — no unnoticed change between the decision and the write

- **Why a fence.** A parse running at the entry may still publish:
  - in AUTO, `set_mode(AUTO)` writes nothing (5467–5472), so no `began()` revokes earlier parses;
  - if the flag clear and the sync write nothing, nothing at all revokes them.
- **In the write thread**, under the `Generation` lock, ONE step:
  1. compare the published identity with the record's decision publication;
  2. if they are equal, set `start_fence = run_id`.
- **`publish_if`** checks the fence under the same lock. While it is set, the publication is **not applied**: the job ends unpublished `refused:start`, and the restart follows `_restart_wait`, which waits for idle under a run.
- **The fence is cleared** right after `cmd_fn` returns, in `written` and in the error path (`finally`).
- The lock is held only for the compare and the set, never across the write: the `Generation` docstring's rule (calc_lifetime.py:82–86) holds.
- **Result:** the publication the decision was made against is the one in force when AUTO_RUN goes out.
  - A publication after the write is a mid-run publication. Today's rules name the earlier verdict; path 2 refuses it, because the version differs from `verified_against`.
  - `start.publication_after_write` is traced.
- **Alternative**, if Codex prefers no change to `publish_if`: detect only. Read the identity again in `written` and trace and name a change. That leaves a µs window "noticed, not prevented". v2 recommends the fence.

### 3.4 The consent — bound to the ask, two kinds (MT502-01, Q-C1)

**The ask record.** Each `ask` reply creates ONE open ask for its **connection** (`conn_key`):

```
{ ask_id, conn, attempt, program_id, version, verified, why, action, start_line, offer }
```

- A new start command from that connection, a program change, a disconnect or a run beginning **voids** it.
- A consent **consumes** it, whatever the outcome.

`consent_matches(consent, situation)` at each point:
- `consent.ask_id` is the connection's **open** ask, unconsumed, and its `action` and `start_line` equal the command's.
- **`kind: "continue"`** — the dialog said "the collision check goes on during the run":
  - offered only when `verified`, `calc: running` and the start is from 0;
  - it matches only if the decision publication is **exactly** the ask's `(program_id, version)`, still verified;
  - a consent to v10 never passes at v11.
- **`kind: "unchecked"`** — the dialog said "this run is not checked":
  - it matches any situation of the same `program_id`, action and start line;
  - **it promises no coverage**: the record states it (`accepted: {kind:"unchecked"}`), and nothing derives a check from it;
  - if the full rule needs no consent at that point (an improvement), the start is an ordinary one.
- **The record carries** `accepted: {ask_id, kind, version}` and `verified_against`, projected from the record (G6), for **exactly** that start. A refused attempt leaves neither on a sent record.

**A consent that does not match does not start silently.** It answers a new `ask` with the current situation, and the dialog updates (§4.4).

### 3.5 What moves the verdict after the entry — the predictions (Q-C2)

| Step | Moves it? | Plan |
|---|---|---|
| `#3116` clear (6902–6916) | No: 3116 is not a basis key (gateway_util.py:6233). It revokes running parses (MDI `began`). | — |
| `_toolsetter_sync` writes (7910–7922) | yes, for a program that runs the routine | **Predicted at the entry with exactly the sync's condition** (:7910–7913, "every key booked applied/read with the basis value"): "would write" plus a routine-running publication gives `verified = False, why = "toolsetter values to be written"`. The sync stays **before** the record: the record names the prepared basis. |
| `_ts_mark_assumed(_ts_program_writes())` (5315) | when `_ts_book` would change the booking (7321–7357) | Predicted with `_ts_book`'s own "changed" condition. Positive controls: "already assumed, same value" (no change) and a real `applied → assumed`. |
| `set_mode(AUTO)` | no write in AUTO; one input write otherwise | — |
| A publication, another client's write, a drift tick | rare | the record, and the write with its fence, decide |

- The predictions make a late ask rare. They do not prove that nothing else changes. **The final decision stays authoritative.**
- **When the entry passed and the record or the write asks**, the operator sees this:
  - the dialog opens ~0.1–0.3 s after the hold with the new why;
  - the start's own preparation is done: AUTO, `#3116` cleared, toolsetter values taken;
  - no AUTO_RUN was written, and the record is `unsent`.

### 3.6 Old clients (Q-C1)

A command **without `check`** is an old cached page. The gateway still applies the rule with claim `none` and no consent:
- When it would ask, the reply is the error **"Reload the page to confirm this start"** (37 characters).
- It never gets an `ask` the page could not answer.
- An absent `program_id` means "not bound", as today (traced `start.unbound`).
- "No page is a precondition" is a property of the protocol, not a promise that an old client can give a new consent (R502).

---

## 4. The page (Q2; MT502-03, MT502-04)

### 4.1 One attempt, owned from the send (MT502-04)

There is ONE App-owned `startAttempt` store. Its states:

```
idle ─send→ awaiting ─ask→ asking ─Start now→ submitting ─ok→ started
                 │            │                   │
                 │            └─Cancel→ cancelled  ├─ask→ asking (updated)
                 ├─ok→ started                     └─error/timeout→ refused | no_reply
                 └─error→ refused / timeout→ no_reply
any state ─(program change | connection change | a run begins | another attempt)→ superseded
```

- **`requestStart(action, via)`**:
  - It is used by the Start hold, Space, the pad, Step from idle and the RFL hold.
  - It sends **only in `idle`** (or after a terminal state). In `awaiting` and `submitting`, every gesture sends nothing.
  - The button says "Start pending — wait" at the control (btnHint). Space and the pad only trace `start.gesture_pending`.
  - In `asking`, the open dialog is the only way on.
- **A reply is taken only when all of these hold:**
  - its `req_id` is the attempt's latest send;
  - the attempt is `awaiting` or `submitting`;
  - the reply's `ask.attempt` and `ask.program_id` equal the attempt's;
  - the connection key (`connKey.ts`) is the one the attempt was sent on.

  Anything else is dropped and traced (`start.reply_stale`). After Cancel, a late `ask` opens nothing.
- **Timeout:** `awaitReply` resolves null after 10 s. The attempt ends `no_reply`, and the message center gets "Start sent — no reply; see the machine state" (`notify`). **No automatic retry.** The status shows whether a run began.
- **After `started`,** closing anything undoes nothing; Pause, Abort and E-Stop are the way. A send error ends `refused` with its reason.
- **Space** ignores `e.repeat`. Without it, a held Space would neither start twice nor toggle pause and resume.

### 4.2 The press that caused the attempt (MT502-04)

- **The finger may still be down when `ask` arrives:** the hold fires at its time, not at its release.
- **The dialog's visibility is `heldThroughPress`** (inputSession.ts:401–407) of `attempt.state === "asking"`:
  - it **opens** only once every press has had its click;
  - it **closes** only once every press has ended.
  - So nothing moves under the original press, and nothing of the dialog lies under it.
- **The old press's pointerup and click land on the Start button**, which is a hold whose `onClick` is stripped, so they do nothing. Even if the dialog were already there, its buttons need their **own** pointerdown:
  - Cancel is a click;
  - "Start now" is a hold;
  - releaseClick only synthesises a click for the same control (ui-patterns "Starting motion is a hold").
- **Keyboard:** `initial-focus="container"`; the dialog has no key path to "Start now".

### 4.3 What the dialog is

- **Frame:** `DialogFrame kind="flow"` (the safety tier), `size="confirm"`, `initial-focus="container"`, teleported into `#content-dialog-area`. The strip stays reachable, and Escape stays E-Stop.
- **Title:** "Start before the check is finished?" ("Step …" for a step), with a `HelpIcon`.
- **Body:**
  - one line per fact not finished: §2.2's words, or the gateway's why words (§7.2);
  - while `calc` is running, a `.progressTrack` with the percentage beside it;
  - for an ended or not-checked check, the Sim tab's `verdict`, `tone`, caveat and "?" detail;
  - ONE consequence line (§4.5).
- **Actions:**
  - "Cancel" (`dialogCancel`, left);
  - the action, right, in a `stable-width` slot. Its box never moves when the words change (prototype P-F2).

### 4.4 The action and its consent

| Consequence class | Action | Variant | Sends |
|---|---|---|---|
| `continue` (verified, calc running, from 0) | Start now / Step now | warn, hold (`startUnchecked`) | `consent {ask_id, kind:"continue"}` |
| `unchecked` (unverified, not_checked, RFL variant B) | Start now / Step now | warn, hold | `consent {ask_id, kind:"unchecked"}` |
| `ended`, full-clear | Start / Step | **primary**, hold (`start`) | no consent (an ordinary start; the gateway may still ask) |
| `ended`, full-findings or restricted | Start / Step | warn, hold | no consent; the verdict stays in its own tone above it |

- **`holdKey`** = `attempt | ask_id | consequence class | action class`.
- Any change cancels a hold in progress, with "Check changed — hold again".
- Changes that cancel include: checking → partial, checking → not checkable, unfinished → finished, a new ask, and override ↔ normal start.
- **Progress percentages are not in the key:** a running percentage with no change of meaning keeps the hold.

### 4.5 The consequence line — what the action promises

| Class | Line |
|---|---|
| `continue` | "Started now, the collision check goes on during the run." |
| `unchecked` | "Started now, this run is not checked." |
| `ended`, full-clear | — (the verdict is the line) |
| `ended`, findings / restricted | — (the verdict, its caveat and its "?" say what is missing) |
| RFL (variant A) | in the RFL dialog: "Not checked for collisions — run from line 7" |

- It is a pure `consequenceLine(ask, pageCheck)`.
- The line promises only what the consent kind enforces at the gateway (§3.4). There is no promise about later states: a consent that no longer matches is asked again.

### 4.6 While the dialog is open

- The lines update live.
- When **the calculation ends**, the dialog shows the verdict exactly as the Sim tab does, and the action follows §4.4. It is never a plain "Clear" over a `not_checked` or `restricted` result, and nothing starts by itself (Q-S3).
- **It closes** on any of:
  - Cancel;
  - a program change;
  - a run beginning, anyone's;
  - a connection change;
  - its own `started`.

  Closing waits until every press has ended (§4.2).
- **The gate closes:** the dialog stays; the action dims with its gate's reason; Cancel always works.

### 4.7 A device with the simulation off

- The claim is `calc: none`, so only the gateway's facts ask.
- The dialog shows the gateway's why words and no collision lines.
- Q-S5 for the operator.

---

## 5. After the start — the run-time check (Q-C3, Q-C5; MT502-02)

### 5.1 An unverified start: named, never an old Clear (Q-C5)

- `uncheckedRun` (checkBasis.ts:147–150) also returns a run when all of these hold:
  - `state === "sent"`;
  - `startLine === 0`;
  - `verified === false`, proven by the record (not merely absent).
- The reason is "started before the check". The P6-d0 machinery (`_colEnterNotChecked`) releases every owner: the run check, the side job, a running, parked or finished main, the result, the context and the tint.
- No late main or side reply and no publisher continuation may bring a contact, coverage or tint back. That is P6-d0's guard pattern, extended to this reason.
- A foreign or unclear start stays as it is: no record, not verified afterwards.

### 5.2 A verified start: path 2 and the reuse boundary (MT502-02)

**Admission (P6-d v4 P1–P3, R462's nine conditions):**
- `verified_against` must name exactly the shown publication: program, version, source and tool basis revision.
- The record and the origin must come from the current connection.
- The version alone never admits.

**At the run's entry the page chooses ONE of these:**

| The shown main job of `verified_against.version` | Inputs | Run check |
|---|---|---|
| **finished** (`done` / `partial`) on the same publication object | every check input equal: `sameCheckInputs(_colBasis, basisFromRun(rb))` with **only** `startJoints` excluded | **reuse the main part** (from K to the end) as the run's main result, as in the rules below |
| finished, any input different | — | `_startRunCheck`: provisional from the playhead, then full, under the run budget |
| **running or parked** | any | cancel it; `_startRunCheck` under the run budget. No live re-budget of a posted job: `_colBuildRequest` set its shards and slices at the post (4129, 4189–4193). A provable switch would be a contract of its own. |
| none, or any doubt about the boundary | — | `_startRunCheck` |

**The rules of reuse:**
- **The beginning (0…K) is never reused.** Neither the idle result's beginning nor a simulation entry side job is taken. The run binds it to `rb.start.joints` (`_runBoundTrack` → `bindBeginning`) and sweeps it as **its own** side job under the run budget.
  - Until it is merged, the bar says "start still checking" (ScrubBar.vue:1214–1216).
  - Without joints it says "not checked: the run's start position was not read"; unbindable, "not checked" (startDep.ts:172–177).
  - A different linear start (Y0 vs Y100, R502's probe) is therefore checked on its own bound track.
- **Ownership moves to a new run generation** (`collisionRun.gen`, `_colReqRunGen`):
  - the reused main result, its contact tables and publisher steps, and its check context (P6-e header binding included);
  - end, abort, idle, a new publication or another run discard it as any run check (4552–4615);
  - a late reply of the old main id is no one's.
- **Coverage and percentages** come from the run check's own composition (reused main + bound beginning). They are never copied from another track's figure. A `partial` main keeps its own "stopped at …" coverage on the base track.
- **M11 reworded:** the mutations are "reuse with a different input", "reuse of the idle beginning or the sim entry job", "reuse of a running job without the run budget" and "a percentage taken over". Each is red at its guard. The binding protection is the property; it is not a mutation target.

### 5.3 Stage 2 (deferred, own plan)

A check that **catches up** in an unverified run needs the first pinned parse from the start's own capture (P2b-F2, MT449-01):
- the program text by its source;
- parameters and G92 from the var file after the AUTO switch's synch (proven fresh by a new inode);
- the WCS table, kins, rotary seed, tool start, toolsetter book and limits — all taken at the record, before the write.

Until then the run is **explicitly not checked**. Neither a first pinned parse nor the RFL rest is done by this package. **Q-S4** asks whether the operator wants it.

---

## 6. Run from line (Q3)

- **The question comes in the existing RFL dialog** (variant A, technically preferred by R502), before the measurement and the positioning.
  - A `.statusNote.warn` line: "Not checked for collisions — run from line 7", with its "?" **inside** the note's text span (prototype P-F1).
  - Its hold sends `auto_run` with the ask that the **dialog's opening** obtained, and `consent {kind: "unchecked"}`.
- **How that ask is obtained:**
  - Opening the RFL dialog (a tap, nothing moves) does not send a start.
  - With variant A the page sends `auto_run` without a consent. The gateway replies `ask` (`start_line > 0`, `offer: "unchecked"`, `at:"entry"`). The page answers at once with the consent it has **already** shown in the RFL dialog.
  - The page answers on its own **only** when the ask equals what the RFL dialog showed: the same program, version and start line, and `offer: "unchecked"`. Any other ask opens the start dialog with its own words.
  - That is one gesture and one hold, and two messages bound by `ask_id`. Or (**Q-C7**) the RFL hold sends a consent of kind `unchecked` bound to a dialog-side `ask` that the tap requested with a non-moving `start_preview` probe. The plan prefers the first form: no new command.
- **The sequence:**
  - The entry asks before `_start_guard` and `_rfl_start` (9396–9425).
  - The consent travels with `_rfl_start` → `_rfl_sequence` → the AUTO write at 7265, so the record and the write apply the rule.
  - Kind `unchecked` matches any verdict after the measurement (T). Variant A never asks a second time.
- **Variant B:** no note; the start dialog opens after the RFL hold (two holds). That is Q-S2.
- **Step:** a Step from idle asks like Start. A Step in a paused run and Resume take no record and never ask (Q-C6, yes).

---

## 7. Words (≤ 60 for a reason or line, ≤ 120 for a help)

### 7.1 Dialog

| Element | Words | Chars |
|---|---|---|
| Title | Start before the check is finished? / Step before the check is finished? | 35 / 34 |
| Help "?" | The collision check of the preview is not finished. Start now runs the program without waiting for it. | 103 |
| Lines (running) | Collision check running (+ bar and %) / Collision check paused at 40 % / Collision check not started yet / Preview loading (+ bar) / Preview being updated — tool table change / Collision check waits for the (new) preview | ≤ 41 |
| Lines (ended, not checked) | the Sim tab's own `verdict`, e.g. "Clear · checked in full", "Clear · start not checked", "2 collisions · checked to the end", "No contact · stopped at 75 %", "Depends on the machine's position", "Not checked" | — |
| Consequence | Started now, the collision check goes on during the run. / Started now, this run is not checked. | 55 / 37 |
| Action | Start now / Step now (warn hold); Start / Step (primary hold for full-clear, warn otherwise) | — |
| Hold changed | Check changed — hold again | 26 |
| Pending | Start pending — wait | 20 |
| No reply | Start sent — no reply; see the machine state | 44 |
| Old page | Reload the page to confirm this start | 37 |

### 7.2 The gateway's whys (`startWhyWords`, pure)

| `why` | Line |
|---|---|
| `no publication of this program` | Preview not ready |
| `a parse runs or is pending` | Preview being updated |
| `drift open: table_mtime` / `table_row` | Preview older than the tool table |
| `drift open: toolsetter`, `toolsetter values to be written` | Preview older than the toolsetter values |
| `drift open: wcs…` | Preview older than the work offsets |
| `drift open: limits…` | Preview older than the soft limits |
| `the program text is not the published one` | Program changed on disk |
| `another fixture` / `fixture table` / `G92` | Preview made for other work offsets |
| `another kinematics state` | Preview made for another kinematics mode |
| `another rotary pose` | Preview made for another rotary position |
| `another tool start` | Preview made for another tool |
| `publication changed` (record or write: v ≠ claim, or ≠ consent) | Preview updated since — confirm again |
| status / capture / table-unreadable whys | Start state not read |
| anything else | Preview is not the start state |

### 7.3 RFL, bar, Sim tab, protocol, glossary

- **RFL note:** "Not checked for collisions — run from line 7" (44). Help: "The collision check covers a run from the program's beginning only. This run is not checked." (93)
- **Sim tab:** "Not checked · started before the check" (38). Help: "Started before its check was finished: this run is not checked for collisions." (79)
- **Message center:** a `log` entry "Started before the check — not checked (…)", plus `notify` for "no reply".
- **Glossary:**
  - extend the not-checked row with "started before the check";
  - a new row, "Start now": title "Start before the check is finished?". Never "Start anyway", "Force" or "Skip check".

---

## 8. Guards, mutations, native cases (Q6)

### 8.1 Gateway unit (`test_start_ask.py`; fake_linuxcnc, conftest)

**The rule:**
- the ask at the entry for every why, with **nothing written** before it (a recording `_cmd_blocking`);
- `calc: running` and `not_checked` ask; `ended` with the same version goes; `ended` with another version asks;
- `start_line > 0` asks without a consent.

**MT502-01:**
- **v10 claimed and verified at the entry; v11 published between the entry and the record and verified there** → the record asks (`at:"record"`), the record is `unsent`, no AUTO write. Control: the same version starts.
- **v11 published between the record and the write thread's admit** → the write asks, the fence is not set, nothing written.
- **A publication attempt while the fence is set** → `publish_if` does not apply, the job ends `refused:start`, the fence clears after `cmd_fn`. The lock is never held across the write (a spy on the lock).
- **Old consent with a new publication:**
  - `continue` for v10 at v11 → ask;
  - `unchecked` for v10 at v11 → go, with `accepted.kind = "unchecked"`;
  - `continue` given verified, record unverified → ask.
- **Consent binding:**
  - an `ask_id` of another connection, a consumed one, or one voided by a newer start, a program change or a disconnect → ask;
  - another action or start line → ask.
- **Start, Step from idle and RFL apart.** A paused Step and Resume never ask.
- `accepted` and `verified_against` sit only on the record of the start that was written.

**Q-C2, the predictions:**
- a sync that would write → ask at the entry, nothing written;
- "already assumed, same value" → no prediction;
- `applied → assumed` → prediction.

**Old client:** no `check` field → "Reload the page to confirm this start".

**Wire:** `test_command_dispatch` and `commandShapes.test.ts` (fields bounded, named contracts); `run_check_wire.json` (`accepted`, `verified_against`).

### 8.2 Page unit and browser

**`startCheck.test.ts`:**
- `pageCheck` over every row of §2.2;
- the `done` sub-cases each in their class, the whole unbindable one never `ended`;
- the default is `running`;
- `consequenceLine`, `startWhyWords` (a scan of bulk_pipeline.py's literal whys: a new why fails the test).

**`startAttempt.test.ts`:** every transition, including:
- a gesture in `awaiting` or `submitting` sends nothing;
- a stale reply is dropped;
- after Cancel, a late `ask` opens nothing;
- a timeout ends `no_reply` with no resend;
- a program, connection or run change gives `superseded`.

**`checkBasis.test.ts`:**
- `uncheckedRun` for a proven `verified:false` line-0 sent run;
- path 2 C1/C2 (version alone never admits);
- the reuse decision: finished and equal → reuse; running or parked → re-post; any input different → re-post.

**Browser (`start-ask.spec.ts`; `mock-gateway.mjs` answers `ask` in the same commit):**
- **MT502-04:**
  - two devices (a key and the pad) with the reply delayed > 200 ms → one start sent;
  - a second `ask` after Cancel → nothing opens;
  - a reply after a program change, a connection epoch change or a foreign run → dropped;
  - a timeout → `no_reply`, no restart;
  - **the original Start press held through the reply** (`page.clock`, the finger down) → the dialog opens only after its click; nothing clicked, nothing moved;
  - then a new normal gesture works (positive control).
- **Space held** through the mount → one attempt, no click.
- **MT502-03:**
  - with the question open, the `done` sub-cases (whole unbindable with no finding, whole start-dependent, start not checked, checked to the end, stopped at 75 %, full Clear) → the dialog's verdict words, caveat and button variant equal the Sim tab's; "Clear" + primary only for full-clear;
  - **during a hold** with an unchanged ask: `checking → partial`, `checking → not checkable` and `unfinished → finished` cancel the hold;
  - a percentage change alone keeps it.
- **Finished while open:** the button's box is unchanged (bounding box).

**`collisions.viewer.spec` (MT502-02):**
- the same publication with another **linear** start → the beginning is bound and swept anew, and a contact only in the newly bound stretch is found;
- a simulation entry at another pose is not reused;
- a whole start-dependent program;
- missing joints;
- a reuse of an independent main part as the positive control (no new main job);
- a running, a parked and a finished main at the run's entry;
- a late old side reply; abort; a new publication;
- the worker's shards and slices of the run job measured at the transition (≤ 2, 20 ms).

**Q-C5:**
- an accepted unverified line-0 run → "Not checked · started before the check";
- an earlier Clear goes and does not come back from a late reply or a publisher continuation.

**Also:** `dialogs.spec`, `layout.spec` (portrait 150 %), `controlInventory`, the function inventory, `scripts/test_select/rules.py`.

### 8.3 Native cases (VM sim, `native_run.py` variant `start`; the page probe judges the page words)

| | Case | Expect |
|---|---|---|
| N1 | Early start before the first preview | ask at the entry; Cancel → no AUTO, no record; Start now → `accepted.kind unchecked`, "Preview after the run" + "Not checked · started before the check" |
| N2 | Start within 2 s of an MDI `T1 M600` | ask (`a parse runs or is pending` / `drift open: table_mtime`); Start now → not checked. Control: wait for the finished check → no dialog, verified |
| N3 | Start with the page's check running on a current preview | ask, `offer continue`; Start now → the record verified against that version, the run check re-posted under the run budget and finishing in the run |
| N3b | Start after a **finished** idle check | no dialog; the main reused, the beginning bound to the start joints (the run log shows no new main job, one side job) |
| N3c | A finished Clear, then an accepted unverified start | "not checked", no Clear |
| N4 | RFL, variant A | the note; one hold; started; "Not checked · run from line N". A raw `auto_run` without consent → ask, nothing moves |
| N5 | Toolsetter values changed, a program with M600 | the prediction asks at the entry, nothing written |
| N6 | Space held 2 s | one attempt, no consent sent |
| N7 | Dialog open, another client starts | the dialog closes; a late reply is dropped |

A publication between the entry, the record and the write (MT502-01) cannot be provoked natively without a test variable. It is held by the unit cases with fakes, as R461 F14-3 agreed.

### 8.4 Mutations (each red at its guard)

| | Mutation |
|---|---|
| M1 | no ask at the entry |
| M2 | the ask after `_start_guard` / the sync |
| M3 | the record applies only `not verified` (R502's v10/v11 case) |
| M4 | the write thread has no last decision / no fence |
| M5 | `publish_if` ignores the fence |
| M6 | a `continue` consent matches another version |
| M7 | an `ask_id` not bound to its connection / not consumed |
| M8 | the RFL `line > 0` rule dropped |
| M9 | `check.version` ignored |
| M10 | `pageCheck` defaults to `ended` / maps whole-unbindable to `ended` |
| M11a | reuse with a different input |
| M11b | reuse of the idle beginning or the sim entry job |
| M11c | reuse of a running job without the run budget |
| M11d | a percentage taken over |
| M12 | a second gesture sends in `awaiting` |
| M13 | a late `ask` reopens after Cancel |
| M14 | a timeout retries |
| M15 | the dialog not held through the press |
| M16 | `e.repeat` not ignored |
| M17 | "Start now" not a hold |
| M18 | `holdKey` without the consequence class |
| M19 | `uncheckedRun` without the unverified rule |
| M20 | path 2 on the version alone |
| M21 | the consent not passed into the RFL sequence's write |

---

## 9. Renderings

The v1 PNGs (`/home/cnc/claude-work/start/render/`, 30 files; the page `/home/cnc/claude-work/start/page/index.html`) stay valid as **layout** of the render hook (R502).

**What v2 changes in them:**
- **D5:** the line becomes the Sim tab's verdict, e.g. "Clear · checked in full". "Start" is primary only then.
- **Not rendered yet:** the `done` sub-cases with the question open (start not checked, whole unbindable, stopped at 75 %).

No re-render was run for v2; on request, the same script runs under the heavy lock.

**Prototype findings kept:**
- P-F1: the "?" sits inside the note's text span.
- P-F2: `stable-width`.
- P-F3: RFL dimmed without the toolsetter set up.
- P-F4: the portrait fit.

---

## 10. Files and order of work

1. **Gateway:**
   - `_start_verdict`, `_start_decision`, the open ask per connection, `_StartAsk`;
   - `start_ctx` through `_cmd_blocking` / `_rfl_start` / `_rfl_sequence`;
   - the write-thread last term and the fence (`calc_lifetime.Generation`, `publish_if`);
   - the predictions; `accepted` and `verified_against`; traces; `COMMAND_SCHEMA`;
   - tests §8.1.
2. **Page:**
   - `startCheck.ts`, `startAttempt.ts`, `StartCheckDialog.vue`, `requestStart` in App;
   - the gestures (GcodePanel, useKeyboardShortcuts `e.repeat`, useGamepad);
   - the catalog entry; the RFL note (Q-S2);
   - `uncheckedRun`; path 2 and the reuse decision (`runBasis.ts`, `checkBasis.ts`, ThreeViewer);
   - `mock-gateway.mjs`; tests §8.2.
3. **Docs:**
   - `scrub-and-run.md` ("Check during a run": the decision at three points, the fence, the consent, path 2 and reuse);
   - `safety-and-permissions.md` ("never waits; it asks");
   - `frontend-modules.md`, `ui-glossary.md`, `decisions.md`;
   - CLAUDE.md short forms (GcodePanel line; "Starting motion is a hold": Start now is a hold, never a key; one start attempt at a time).
4. A round gate per step; native N1–N7; the merge gate.
5. Stage 2 and the RFL rest (P4) are separate.

---

## 11. Risks and not verified

- **R1 — a stuck "unverified":** a `run_start_check` term no idle edge re-parses (the active fixture index alone is suspect, bulk_pipeline.py:657). Step 0 of the build: a native probe of every term.
- **R2 — CPU in motion:** the run budget holds (≤ 2 shards, 20 ms). Reuse of a finished main avoids a second full check in the common case.
- **R3 — the fence delays a publication** that lands exactly at a start. It restarts under `_restart_wait`. The cost is rare and measured by the trace (`refused:start`).
- **R4 — two holds** for an override (intended); one for RFL variant A.
- **R5 — multiple devices:** a sim-off device asks only on the gateway's facts.

**Not verified:**
- the gestures (the prototype has no `requestStart` and no reply);
- the stale Clear through an unverified run (N3c);
- the predictions as pure functions;
- the N100's hash cost and how often a late ask happens;
- the RFL ask-then-consent round trip (§6) on the VM.

---

## 12. Questions

### For Codex (R503)

- **Q-C7:** RFL variant A. The hold sends `auto_run`, gets the `ask` (`offer unchecked`) and answers with the consent the RFL dialog already showed: two messages, one gesture, bound by `ask_id`. Or should the RFL hold carry the consent at once, bound to the dialog's program, version and line, without an `ask_id`? The second form is a consent the gateway did not issue.
- **Q-C8:** The fence in `publish_if` (§3.3), or detect-only after the write?
- **Q-C9:** The open-ask lifetime: per connection, voided by a new start, a program change, a disconnect or a run, consumed by any consent. Is a time limit needed as well?

### For the operator (Claude asks)

- **Q-S1:** Is the dialog as rendered what he meant?
- **Q-S2:** RFL A or B?
- **Q-S3:** When the check finishes during the question: the button becomes "Start", or the dialog closes?
- **Q-S4:** Stage 2 (the catch-up check)?
- **Q-S5:** A sim-off device, and a finished check with collisions?
- **Q-S6 (new):** A check that ended with a named limit ("start not checked", "checked to the end", "stopped at 75 %"): ask at every start, or show it only in the bar as today?

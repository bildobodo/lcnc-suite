# Start message — plan v3: delta on v2, limited to Codex R503's four rests

**Status:** plan only, nothing built. Product code is `dbd14cab`.

**Base:** `/home/cnc/claude-work/start/plan-v2.md`. Everything there stands unless a section below replaces it.

**Not redesigned here** (R503 accepted them):
- the geometry and beginning binding;
- the run budget;
- the result presentation;
- the normal press binding.

**R503's answers taken over:**
- **Q-C7 yes:** the RFL hold authorizes. Its first message writes nothing, and a matching ask at the entry may trigger the second message with the consent. That is §D.
- **Q-C8 yes** to the fence, with the lifetime rule in §E.
- **Q-C9:** no ask timeout. The 10 s timeout for a pending reply stays: an unknown outcome, no retry.

## Change list

| Rest | v2 | v3 |
|---|---|---|
| **A** consent | The consent consumed the ask at every point, so the confirming start voided its own ask. The kind was not checked against the offer. | Redeemed **once** at the entry, atomically, into an immutable **start proof** owned by this start job. The record and the write check the proof, never the ask store. The confirming start of the same attempt is exempt from "a new start voids the ask". `consent.kind ∈ ask.offers`, `attempt` checked, RFL job digest checked (§A). |
| **B** reuse key | `sameCheckInputs` without `startJoints` (misses `eoffsetZ`/`eoffsetEnabled` and the model identity) | A **complete job key**: the digest of the main job request `_colBuildRequest` would post for the run's basis, minus only id, run generation and budget. Equal key → reuse; anything else → re-run (§B). |
| **C** action precedence | §4.4 had overlapping rows; Q-S6 "ask" had no consent to send | Every ask offers `unchecked`; `continue` and the new `limited` only where they fit. ONE priority list decides the action from the still-valid ask and the page's live situation. The old check is never shown as the check of a deviating start (§C). |
| **D** RFL | Every `ok` was "started"; "never asks again" sat beside "a new ask at the write" | "RFL sequence accepted" (`seq_id`) is distinct from "AUTO written". The proof and the frozen job are owned by the sequence. The end is reported through the bound `rfl_status`. The broad `unchecked` proof covers a later publication change: the record stays unchecked and there is no ask after acceptance. Never a second `auto_run` (§D). |
| Reply rule | `ask.attempt` checked on every reply | The gateway echoes `attempt` on **every** start reply (ok, error, ask); `ask` additionally names program and action (§D.4). |
| Fence | cleared "after `cmd_fn`, in `written` and the error path" | One `try/finally` from the set in `admit` to the end of the write, owned by the concrete `run_id` (§E). |
| Removed | v2 §6 line 426 (the ask "the dialog's opening obtained") and the `start_preview` alternative (line 431) | — |

---

## A. The consent: redeemed once, carried as a proof (Rest A; replaces v2 §3.4)

### A.1 The open ask

Each `ask` reply creates ONE open ask for its connection:

```
OpenAsk { ask_id, conn, attempt, program_id, version, verified, why, action, start_line,
          offers: ⊆ {"continue","limited","unchecked"}, job_digest }
```

- **`offers`** always contains `unchecked`: it promises no coverage, so it is always a truthful consent.
  - **`continue`** is added only when the decision was verified, the page's claim was `calc: running`, and the start is from line 0.
  - **`limited`** (§C.1) is added only when the decision was verified, the claim was `ended/restricted`, the start is from line 0, and the Q-S6 policy is "ask".
- **`job_digest`** binds the whole start job (§D.2). For Cycle Start and Step it is the action and line 0.

### A.2 The redemption at the entry

ONE synchronous step at the entry, with no await between the look-up and the consumption:

```
redeem(conn, cmd):
  a = open_ask[conn]
  ok = a is not None and cmd.consent.ask_id == a.ask_id
       and cmd.attempt == a.attempt and cmd.program_id == a.program_id == active_program_id
       and cmd.action == a.action and cmd.start_line == a.start_line
       and digest(cmd.job) == a.job_digest
       and cmd.consent.kind in a.offers
  if ok: del open_ask[conn]                      # consumed by THIS redemption only
         return StartProof(ask_id, conn, attempt, program_id, version=a.version,
                           kind=cmd.consent.kind, action, start_line, job_digest, job=new_job_id)
  return None
```

- **Voiding.** A start command from the same connection with **another** `attempt` voids the open ask first: that is a really new attempt. A command of the **same** attempt carrying a consent is the confirmation, and it redeems instead of voiding. A program change, a disconnect or a run beginning voids the open ask.
- **Proof lifetime.** The proof is immutable and held only by its start job: the handler, and for RFL the sequence task. There is no store keyed by `ask_id`. A second job naming the same `ask_id` finds no open ask and gets a new ask.
- **No redemption** (any mismatch) → the entry decides without a consent. If a consent is needed, it replies a **new** ask with a new `ask_id`.
- **A page cannot widen an ask.** It may only send a kind the gateway offered, and `continue` never becomes `unchecked` by renaming. It may choose the weaker `unchecked`, because the gateway always offers it.

### A.3 What the proof matches — at the entry, the record and the write

The same rule as v2 §3.2 decides `needs_consent`. If no consent is needed, the start is an ordinary one: the proof is recorded as `accepted: {…, needed: false}` and nothing derives from it. Otherwise the proof matches only if:

| Kind | The situation at this point |
|---|---|
| `continue` | decision verified; its publication is exactly `(program_id, version)` of the proof; claim `calc: running`; action and line equal |
| `limited` | the same as `continue`, but with claim `ended/restricted` |
| `unchecked` | the same `program_id`, action, start line and `job_digest`; any publication, any verdict; **no coverage is promised** |

- A mismatch at the **entry** gets a new ask.
- A mismatch at the **record or the write** (Cycle Start and Step only, §D.3): record `unsent`, no AUTO write, and the same request's reply is a new ask (`at: "record"`/`"write"`).
- **On a written start** the record carries `accepted: {ask_id, kind, version, needed}` and `verified_against`, for exactly that start and job.

### A.4 Guards (gateway unit, fake_linuxcnc)

- **The positive chain:** ask → the same attempt sends its consent → the entry redeems → the record matches → the write matches → **exactly one** AUTO write, `accepted` on that record, the ask consumed.
- **The same consent in a second job:** nothing redeemed, a new ask, no write.
- **A new attempt with an old ask:** voided, a new ask.
- **Mismatches:**
  - wrong offered kind (`continue` against an ask offering only `unchecked`);
  - wrong connection, action, start line or `job_digest`.
- **A real version change:**
  - `continue` for v10 → at v11 a new ask;
  - `unchecked` for v10 → at v11 it starts, with `accepted.kind = "unchecked"`.
- **Situation improved:** no consent needed → an ordinary start, `needed: false`.

---

## B. The reuse key: complete by construction (Rest B; replaces v2 §5.2 "every check input equal")

The main job's reuse criterion is a **job key**:

```
jobKey(req) = digest of the request _colBuildRequest(track, id, false, basis) builds,
              over every field except: id, run gen, maxShards, sliceMs, witness,
              the body transfer (bodies are named by modelKey)
```

- The idle main job's key is kept with its result.
- At the run's entry the page builds the key of the main request it would post for the run: the same track, `basisFromRun(rb)`, no range.
- **Reuse only if** the keys are equal, the result is finished and the publication object is the same. Otherwise `_startRunCheck` runs (v2 §5.2, unchanged).

**What the key covers, by construction:**
- `externalOffsetZ {enabled, z}` (ThreeViewer.vue:4219), which decides the main result's restriction note (collision.ts:1364–1370). The `run` gate does not require the external offset off (command_policy.py:650).
- The model identity `modelKey` (ThreeViewer.vue:4133, 4177), and so the tool body dims.
- `wcs`, `epochTerms`, `tloEvents`, `toolDims`, `liveTool`, `probeStops`, `probeBands`, `unknownTools`, the stale-offset and start-untracked flags, `margin`, and the track copy.

A field added to the request later is in the key automatically. The beginning's `startJoints` is not part of the main request; it belongs to the run's side job (v2 §5.2), so the key excludes it without a special case.

**No split** of "geometry reused, notes recomputed". With equal keys the worker's notes are equal too. When in doubt, re-run.

**Guards** (browser, real worker; they read the final notes and the card, not the return value of the reuse decision). On a track with a probe band:
- the external offset `{enabled:false, z:0}` at idle against `{enabled:true, z:0}` in the run → re-run, and the final note names the external offset;
- `z` changed → re-run;
- unread (`null`) → re-run;
- unchanged → reuse (no new main job), with the same notes as the idle result: the positive control.
- Plus: a different model or tool dims → re-run.

**Mutation M11e:** a key without `externalOffsetZ` or without `modelKey`.

---

## C. The action: one priority from the ask and the live situation (Rest C; replaces v2 §4.4)

### C.1 The consents and their lines

| Kind | Offered when (§A.1) | Line |
|---|---|---|
| `continue` | verified, claim `running`, line 0 | "Started now, the collision check goes on during the run." |
| `limited` | verified, claim `ended/restricted`, line 0, Q-S6 = ask | "Started now, the run is checked as shown: <coverage>." (e.g. "… as shown: start not checked") |
| `unchecked` | always | "Started now, this run is not checked." |

### C.2 The priority — the first row that applies decides

Inputs:
- `A` — the open ask this attempt holds (still valid: same attempt, program, connection);
- `P` — the page's live claim (v2 §2.2) and the version it is about;
- `R` — the Q-S6 policy.

| # | Condition | Action | Sends |
|---|---|---|---|
| 1 | `A` void (attempt, program or connection changed, a run began) | the dialog closes (superseded) | — |
| 2 | `P` is about a **newer** publication than `A.version`, and `P` needs no consent by the page's rule (`ended` with full-clear or full-findings, or `ended/restricted` with R = do not ask) | **Start** (hold; primary only for full-clear) | no consent. The gateway re-decides, and a remaining gateway reason gets a new ask. |
| 3 | `A.verified == false` (the gateway denies the start basis) | **Start now** (warn hold) | `unchecked` (the only kind offered) |
| 4 | `A.verified`, `P` is about `A.version`, `P.calc == running`, `continue ∈ A.offers` | **Start now** (warn hold) | `continue` |
| 5 | `A.verified`, `P` is about `A.version`, `P` is `ended/restricted`, R = ask, `limited ∈ A.offers` | **Start now** (warn hold) | `limited` |
| 6 | `A.verified`, `P` is about `A.version`, `P` needs no consent (as in row 2) | **Start** (hold; primary only for full-clear) | no consent |
| 7 | anything else: `P.calc == not_checked`, or the fitting kind was not offered (e.g. `continue → not_checked` under the same ask) | **Start now** (warn hold) | `unchecked` |

**What the dialog shows (row 3):** the page's check is captioned as the **preview's** check, e.g. "Preview check: Clear · checked in full", followed by the gateway's why ("— Preview older than the tool table"). It is never presented as the check of this start. Its tone stays the Sim tab's; there is no primary action.

**The hold key** stays `attempt | ask_id | consequence class | action class` (v2 §4.4). A row change is an action-class change, so it aborts a hold in progress.

**Termination.**
- A consent is always one the open ask offered for the class shown when the hold completed. At the entry it redeems or gets a new ask (§A.2).
- Every new ask needs a new gesture, so there is no automatic loop and no silent start.
- A plain Start (rows 2 and 6) can only start when the gateway's full rule needs no consent. That is an ordinary start, never a silent override.
- **`continue → not_checked`** under the same ask moves to row 7: the action sends the offered `unchecked`, the hold aborts, and one new hold starts the run.

**Q-S6 consistency.**
- If the operator answers "ask": the gateway's rule asks on `ended/restricted` and offers `limited`; row 5 sends it.
- If "do not ask": the rule does not ask, no `limited` is offered, and row 6 sends no consent.
- Both branches end in a start after one confirmed hold.

### C.3 Guards (browser with the mock; gateway unit for the offers)

- Gateway denies, page `ended/full-clear` of the old check → row 3; the words say "Preview check …"; one hold sends `unchecked`; no primary action.
- Q-S6 = ask, `ended/restricted` → row 5 sends `limited`, and one hold starts. Q-S6 = no → row 6 sends no consent and starts.
- `continue → not_checked` with the same ask → row 7, the hold aborted, a new hold sends `unchecked` and starts.
- A newer publication while open → row 2, no consent; the mock answers a new ask → the dialog updates. No auto-send at any step (the mock's command log).

---

## D. Run from line: accepted sequence, owned proof, bound end (Rest D, Q-C7; replaces v2 §6)

### D.1 The gesture and the two messages

- The RFL dialog shows the note "Not checked for collisions — run from line 7" (variant A).
- Its hold **freezes the job**: program file, version, source and `program_id`, the line, the pre-measure tool and its `probe_vars`, the retract, the entry X, Y, frame and unit, and the spindle direction and speed.
- **Message 1** is `auto_run` with the frozen job and **no consent**. The entry asks (`start_line > 0`, offers `unchecked`, `at: "entry"`). Nothing is written.
- **Message 2** is sent by the page on its own **only** under all of these:
  - the attempt is still `awaiting`;
  - the reply is that request's ask, `at: "entry"`;
  - the ask's program, version, line and `job_digest` equal the frozen job;
  - `unchecked ∈ offers`;
  - no Cancel, timeout, superseding or foreign run has occurred.

  It is the **same frozen job object** plus a new request id and `consent {ask_id, kind: "unchecked"}`. Nothing is read again from the form. Any other ask opens the start dialog with its own words, as for Cycle Start.

### D.2 The gateway: acceptance is not the AUTO write

- **The entry** redeems the proof (§A.2). The `job_digest` is the digest of message 1's job fields, and message 2 must carry the same digest.
- **`_rfl_start(job, proof)`** creates the sequence with a new `seq_id`. The proof and the frozen job belong to that sequence task alone.
- **The reply** is `{ok: true, rfl: "accepted", seq_id, attempt}` — today `rfl: "started"` (gateway.py:9427–9429). It means the **sequence was accepted**, not that AUTO was written.
- **`rfl_status`** carries `seq_id` (and the `attempt`) in every phase (`_rfl_phase` 7085–7089).
- **At the record and the write inside the sequence** (7265), the proof is `unchecked` (§A.3). It matches any publication of the same program, action, line and job. **So a publication change after the record is covered:**
  - the record stays unverified or unchecked;
  - "Not checked · run from line N" (P6-d0);
  - **no ask after acceptance.**

  A program or text change ends the sequence by name (`program_changed`, through `still_bound`) without AUTO, as today.
- **Other late refusals** (kinematics, link, toolsetter basis; `_WriteRefused` at 7267–7269) end the sequence by name (`failed`, with its why) and write no AUTO.
- **Never a second `auto_run`** from the page after acceptance. Nothing in the gateway replays the sequence.

### D.3 Cycle Start and Step: the only asks after the entry

These have no background sequence. The handler awaits `_cmd_blocking`, so a mismatch at the record or the write is the **same request's reply**: a new ask with `at: "record"` or `"write"`. This is the positive control beside RFL.

### D.4 The page's attempt and the reply rule by kind (replaces v2 §4.1's reply rule)

- **The gateway echoes `attempt`** in every reply of a start command: `ok`, error and `ask`.
- **Every reply:** `req_id` is the attempt's latest send, the attempt is in `awaiting`, `submitting` or `sequence` as fitting, the connection is unchanged, and `attempt` is equal.
- **`ask`:** additionally the program and the action are equal.
- **The states:**
  - Cycle Start and Step: `awaiting → (ok → started | ask → asking | error → refused)`.
  - RFL: `awaiting → ask(at entry, matching) → submitting → ok(rfl accepted, seq_id) → sequence → terminal`.
  - **`sequence` ends only by `rfl_status` with that `seq_id`:**
    - `running` → started (AUTO written);
    - `aborted`, `failed`, `measure_failed`, `safe_z_failed`, `positioning_failed`, `flag_failed`, `program_changed` → ended, with the why at the RFL action's status line.
  - A late `rfl_status` of another `seq_id` is not this attempt's.
- **In `sequence`** every start gesture sends nothing ("Run from line is starting — abort it first" stays the gateway's word).

### D.5 Guards

**Gateway unit:**
- RFL with acceptance and a delayed pre-measurement → one `rfl_status` chain with one `seq_id` → `running`.
- A publication change after the record, before the AUTO write → the write goes (`unchecked` proof); the record is unverified with `accepted.kind = "unchecked"`; no ask, no second reply.
- Text changed on disk → `program_changed`, no AUTO.
- **Exactly one M600 and one positioning** per sequence (a recording `_rfl_mdi_step`).
- Message 2 with a different `job_digest` → a new ask, no sequence.

**Browser (mock):**
- The hold → message 1 → the ask → message 2 with the identical job object (a deep-equal on the command log) → `accepted` → status `running` → started.
- Cancel or a timeout between message 1 and its ask → no message 2.
- Cycle Start's record ask is the control.

**Native (N4, v2 §8.3):** add the `seq_id` binding and "no second M600".

---

## E. The fence's lifetime (Q-C8 build requirement; amends v2 §3.3)

**Today's order in `_cmd_blocking._run`** (gateway.py:5358–5382):
1. `admit()`;
2. the second link compare;
3. `_calc_gen.began`;
4. `_probe_book.invalidate`;
5. `began()`;
6. then the `try` around `cmd_fn`.

**The fence:**
- It is set as the **last** term of `admit` (under the `Generation` lock: compare, then set `start_fence = run_id`).
- From that moment, **one `try/finally`** spans every later step through the end of `cmd_fn`: the link compare, `began`, `invalidate`, the call, and an exception in any of them.
- `finally: _fence_release(run_id)` clears it **only if** `start_fence == run_id`. No other attempt or run can clear it.
- An admission that refuses before setting it sets nothing.

**Guards:**
- a link change after `admit` → refusal, fence cleared;
- an exception in `began`/`invalidate` before the call → cleared;
- an exception inside `cmd_fn` → cleared;
- success → cleared after the call;
- a publication attempted while fenced → not applied, the job ends `refused:start`, a named restart through `_restart_wait`;
- a second run's release never clears the first run's fence.

**Mutation M4b:** the release only in `written`, or only around `cmd_fn`.

---

## F. Mutations added or changed (on v2 §8.4)

| | Mutation |
|---|---|
| M7a | the record or the write re-checks the ask store instead of the proof (the positive chain goes red) |
| M7b | a redeemed proof usable by a second job |
| M7c | `consent.kind` not checked against `offers` |
| M7d | `attempt` not compared at the redemption |
| M7e | the confirming start voids its own ask |
| M11e | the job key without `externalOffsetZ` / `modelKey` |
| M22 | row 3 shows the old check as the start's check / offers a primary Start |
| M23 | Q-S6 = ask: `ended/restricted` sends no consent |
| M24 | RFL `ok` taken as started (no `sequence` state) |
| M25 | a later publication change makes the RFL sequence ask / end |
| M26 | message 2 re-reads the form instead of the frozen job |
| M4b | the fence released only in `written` / only around the call |

---

## G. Questions

**For Codex (R504):**
- **Q-C10:** `limited` as a third consent kind (Q-S6 = ask), bound like `continue`. Or merge it into `continue` as "as shown"?
- **Q-C11:** The job key as the digest of the hypothetical run request (§B). Is the excluded-field list right?

**For the operator:** Q-S1–Q-S6 unchanged (v2 §12).

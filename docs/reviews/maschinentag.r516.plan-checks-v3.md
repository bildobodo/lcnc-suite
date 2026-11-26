# Checks run through — plan v3 (a delta on v2, Codex R515)

**Base:** `plan-v2.md` (archived as `docs/reviews/maschinentag.r515.plan-checks-v2.md`) on `plan-v1.md`. Everything there stands unless this delta replaces it.

**Review:** "## Codex · Prüfungen laufen durch · Planreview R515" (`maschinentag.review.md:10778ff`) and `maschinentag.r515.codex-*`. Code is read at `dbd14cab`.

Still a plan: nothing built, no runs, no heavy lock.

**State after R515**
- **Closed:** MT514-01.
- **Accepted:** the direction of MT514-02 / -03; the 20 ms run slices; the shard and copy caps; cancel and re-post; start-ask first; the VM measurement before this merge; the README scope.
- **This delta closes the three contract gaps:**
  - A: the settings path without the poller (§1);
  - B: the start gate until a fresh status is ADOPTED (§2);
  - C: a witness predicate over the whole phase (§3).

---

## 1. Rest A — the settings reconcile does not depend on the poller (replaces v2 §2.2)

### 1.1 Where

- **The problem:** v2's branch sat behind two early `continue`s of the per-client status loop:
  - the no-link branch (`gateway.py:14606-14625`: `status_error`, sleep 2 s, `continue`);
  - the no-new-generation wait (`:14627-14647`: the 1 s `wait_for` loops back, as does the 50 ms "no event yet").
- **The fix:** the reconcile moves to the **top of every loop iteration, before both**, for EVERY client (visible and hidden).
- **It replaces the push at `:14883-14912`,** so there is ONE settings path and no double send.
- **The machine side effects stay where they are,** under their own version mark (`_fb_scale`, the spindle-load pin): `:14886-14895`, still on the linked path.
- **Cadence without a new producer:**
  - each iteration costs one integer compare (`_settings_store.version` against the booked version) and sends a message ONLY on a change of this connection's view;
  - delivery latency is bounded by the loop's own wake: ≤ 2 s without a link, ≤ 1 s without a new generation, ~33 ms with the poller.
  - A settings wake event, so the no-link sleep and the generation wait also wake on a store change, is optional. Recommended only if the 2 s is judged too long (Q-C12).

### 1.2 The helper and its delivery contract

**One helper,** `settings_reconcile(client, …) -> "none" | "sent" | "retry" | "closed"`, extracted into a module with no LinuxCNC import, so pytest can drive it with fakes. Its rules:

1. **Gate.** Only a device-bound client (`client.device_bound`), and only while no send of this connection is pending (`send_pending`). Otherwise "none"; the next iteration tries again.
2. **Read a (version, view) pair, conservatively.**
   - Take `v = _settings_store.version` BEFORE reading `settings_view(client.device_id)` (`gateway.py:4382`, in the executor).
   - The view is therefore at least as new as `v`. Book only `v`, never a version that appeared during an await.
3. **No change for this device:** the view's JSON equals `client.settings_sent` → book `v` and return "none", no message.
4. **A change → send through the timed path** (`ws_send_json` → `ws_send_measured`, `ws_fanout.py:342-349, 392-431`).
   - Book `client.settings_sent` and `v` ONLY when the send returned bytes > 0.
   - `(encode_ms, 0)` is the timeout branch, which has already scheduled the close (`:427-431`): book nothing, return "closed", and the loop `break`s. A reconnect receives `settings_init` with everything.
   - An exception from the send: the same.
5. **A failed read** (`OSError`, `JSONDecodeError`, `ValueError`; today traced as `status.settings_changed_broadcast_failed`): book nothing, return "retry". The next iteration reads again, at the loop's cadence, traced once per failure streak.
6. **Coalescing is by construction:** each attempt reads the LATEST view; an intermediate version is never queued.
   - **The race Codex names:** an ON view is read at `v = 5`; OFF is stored during the send (version 6); ON is booked at 5 → the next iteration sees 6 ≠ 5, reads OFF, and sends it. **OFF stays owed until it is delivered or the connection is closed.**

**Today's block books before its awaits** (`:14884-14904`). That is exactly the "attempted ≠ delivered" defect, and the extraction removes it.

**Hidden clients get this and nothing else of the iteration.** The `continue` at `:14665-14668` stays after the reconcile.

### 1.3 The page

- **Unchanged:** `settings_changed` moves `simulationOn`, and `_simulationOff` (:4516ff) terminates the worker and its pool.
- **A hidden or status-less page** still handles messages and microtasks.
- **A frozen page stays the named limit** (v2 §2.2).

### 1.4 Guards (replace v2 §2.4's gateway unit; the browser and native cases stay)

**Gateway unit,** with fakes for the store, the view and the send:
- **R1:** no link (a `current_link()` stand-in returning None): a store change → ONE `settings_changed` within the no-link iteration. Hidden and visible alike.
- **R2:** link present, the poller with no new generation (`pub.gen` unchanged, the event never set): the same.
- **R3:** the ON→OFF race above → two messages, the last one OFF.
- **R4:** a send returning `(x, 0)` books nothing and ends the loop. A raising send likewise. A failed read retries and books nothing.
- **R5:** N iterations without a store change → zero messages. With `send_pending` → none, then only the latest view.
- **R6:** a client of ANOTHER device gets nothing. An unbound client gets nothing.

**Endpoint level** (fake_linuxcnc, the real WS route): the link dropped with the WS open; the profile's own switch turned off from a second connection of the same profile — no arm, as `_settings_admission` allows (`:6595-6608`) → the first connection receives `settings_changed`.

**Mock gateway:** learns the same rule — settings independent of status, also while hidden, also in its "quiet" and `status_error` modes.

**Browser (new cases):**
- **S5:** the controller gone (the mock's `status_error` mode), a hidden tab computing, a visible tab of the SAME profile switches the simulation off → the hidden tab's worker ends.
- **S6:** the same with the poller quiet (`ctl quiet`, no new frames).
- **S1–S3 and the native heavy-check case** stay from v2.
- **Under session binding** a gateway exits when its LinuxCNC instance ends (`session_bind.py`). A long no-link state is therefore the startup or a lost NML link, so the no-link cases are covered in pytest and the mock, not natively.

**Mutations:**
- **M21:** the reconcile placed back behind the early `continue`s → red at R1/R2, S5/S6.
- **M22:** booking before the send (today's order) → red at R3/R4.
- **M23:** booking the store's version after the send instead of the pre-read `v` → red at R3.
- **M24:** a message every iteration → red at R5.

---

## 2. Rest B — the start gate opens only on an ADOPTED fresh status (replaces v2 §2.3's rule)

### 2.1 The freshness proof: a visibility epoch echoed by the gateway (no clocks)

**The page**
- Keeps `visEpoch`, incremented at every visibility change and at every new connection.
- The WS worker sends it with every `tab_visibility`, `{cmd, hidden, epoch}` (`wsWorker.ts:295, 411`). That includes the one right after `hello`.

**The gateway**
- The reader handler (`gateway.py:15476-15503`) stores `client.vis_epoch` with `client.hidden`.
- The status envelope carries `vis_epoch` (`ws_fanout.build_status_envelope`, `:194ff`), the latest epoch processed for THIS client.
- A frame built after the gateway processed the show of epoch `v` carries `v`. Frames are built only from the current `pub`, and a hidden client was sent none.

**A QUALIFIED status:**
- a `type: status` frame (`status_delta` rebased) of the CURRENT connection whose `vis_epoch` equals the page's current `visEpoch`, and the page is visible;
- the store stamps that on the flushed object, as `_rxOf` stamps the receipt (`statusStore.ts:486-494, 755-760`).
- **Not qualified:**
  - an old frame flushed by rAF at show (counter-case 2: it carries the earlier epoch or none);
  - a `mergeStatusPatch` (a `status_error` client-list patch, `:766-770`): a new object without a stamp;
  - a frame of a closed connection (`resetOnClose` already drops the store's state).

**The order — the gate opens IN the flush:**
- The gate opens in the flush that assigns the qualified object to `status.value` (`_flushPending` :751-762), synchronously in the same task.
- Its envelope fields (`run_basis`, `preview_origin`, `preview_refresh`, `drift_decision`) were applied when the frame was handled (`:617-667`), i.e. no later than the flush.
- The starting watchers (interp :4598, `runBasis` :4558, `previewOrigin` :4552, `_runNotCheckedKey`) run after that task, on the fresh status with the gate open. No timer can run between the assignment and the opening.

**The wire contract grows by one field each way:**
- `lcnc.ts:216` (`tab_visibility.epoch`);
- `commandShapes.test.ts:92, 129` (the worker frame's fields, the bound);
- the reader's check (an integer ≥ 0, else the state stays and the trace says so, as for `hidden`);
- the envelope field in the payload contract tests.

### 2.2 The gate

**ONE admission, `_colStartAdmitted()`:**
- simulation on;
- NOT closed by visibility: the page is visible AND the qualified status of this connection and this epoch has been adopted;
- plus every existing rule (`_colNotChecked`, admission, drift wait, …, unchanged).

**Every NEW start reads it:**
- `runCollisionCheck` (new job) :4244;
- `_colPostSide` (new side job) :4300;
- `continueCollisionCheck` (a parked check) :3869;
- `_startRunCheck` :4433;
- the `_colScheduleAuto` timer body :4355;
- `runEntryCheck` :3890.

A refusal is noted. The catch-up is ONE `_colScheduleAuto()` and one settle check, run from the opening flush.

**Closing:**
- hiding closes the gate and drops a pending release;
- a connection change does the same (`connected` false, the store's close);
- a new show waits for the qualified status of ITS epoch.

**The counter-cases:**
- **Counter-case 1:** hidden idle, the machine starts, the tab shows.
  - `document.hidden` is false at once, but the gate stays closed.
  - A due re-check timer, a payload adoption or a settings adoption reaching a start is refused.
  - The qualified status brings the run and opens the gate in the same flush. The run watchers then decide (no idle check in a run, MR-I03 / P6-d0 as today).
- **Counter-case 2:** the old pending status flushes at show without opening the gate; a `status_error` patch does not open it either.

### 2.3 Own repairs of an OWNED job — allowed through the closed gate

- **A logical job number.** `_colJob` is assigned at a gated start (`runCollisionCheck` of a new job) and cleared by every end of ownership:
  - `cancelCollisionCheck` :3833;
  - `_simulationOff` :4516;
  - `_colEnterNotChecked` :4565;
  - `_discardRunCheck` :4485;
  - a superseding start.
- **The main check's needBodies repost** (:3711-3726) re-calls `runCollisionCheck(_colPendingTrack, _colPendingRun)` with a new transport id.
  - It passes `{ repairOf: _colJob }`.
  - `runCollisionCheck` admits a repair WITHOUT the gate only when `repairOf === _colJob` (the job still owned), the track is the same object (`_colPendingTrack`), the basis is the same object (`_colPendingRun.basis`) and the simulation is on.
  - A passed `run` argument alone proves nothing.
- **The side check's retry** (:3956-3966) passes `{ repairOf: side.id }`. It is admitted only while `_colSide === side` and the slice, entry, base and run are unchanged.

**Guards:**
- **S7:** the model is lost while hidden (a seam that makes the worker answer `needBodies` once) → the owned main job re-posts and finishes while hidden. The same for a side job.
- **S8:** after sim-off, a cancel or an owner change, a late `needBodies` reply re-posts nothing.

### 2.4 Guards (S4 extended)

- **S4a, counter-case 1** (mock: the machine goes AUTO while the tab is hidden; status is skipped for the hidden client):
  - at show, before the qualified frame, a due re-check timer, a payload adoption and a settings adoption all start nothing;
  - the qualified frame then shows the run: no idle check, the run's own rules apply.
- **S4b, counter-case 2:** a status pending in the store at hide flushes at show and opens nothing; a `status_error` patch opens nothing.
- **S4c, positive control:** a fresh admissible idle status after show → exactly ONE catch-up start (`getCollisionActivity().starts` +1).
- **S4d:** hidden again before the qualified frame → the pending release is dropped (no start at the later frame of the old epoch); a reconnect needs the new connection's qualified frame.

**Mutations:**
- **M15:** the gate opens on `document.hidden === false` → red at S4a.
- **M16:** it opens on any `status.value` change → red at S4b.
- **M17:** the epoch is not compared → red at S4b / S4d.
- **M18:** a repair admitted for any `run` argument → red at S8.
- **M19:** a repair blocked by the gate → red at S7.

---

## 3. Rest C — the witness predicate covers the whole phase (replaces v2 §3.2's "inside the phase" and "bounded gaps")

### 3.1 The events (page clock only)

- **Tick `i`:** issued at `issue(i)`. ONE monotone counter for driver and heartbeat ticks: the seam `__viewerDiag.collisionTick()` calls the same issuing function as viewerPerf's heartbeat-driven tick, so the worker's max (`collisionWorker.ts:848-853`) stays meaningful.
- **Word `(s, i)`:** shard `s` confirms tick `i`, i.e. a slice that began after the shard received tick `i` has ended. Received at `recv(s, i)`; it carries the shard's own progress.
- **Compute end `(s)`:** NEW. The shard posts `{computeEnd: {shard, tick}}` when its iterator finishes, at `slice.done`, before any final ack wait (`collisionWorker.ts:461-471`), received at `recv_end(s)`. **A shard is duty-bound until its compute end.** A shard whose compute-end word names a tick issued before the phase entry `E` is not duty-bound in the phase.
- **Phase:** `[E, X]` on the page clock (the driver reads `performance.now()` in the page at entry and exit).

### 3.2 The predicate

For every shard `s` duty-bound at `E`, take its confirmed ticks inside the phase in order, `i1 < i2 < … < in` (`issue ≥ E`, `recv ≤ X`). The proof holds when:
1. `recv(s, i1) − E ≤ 1 s`;
2. for consecutive confirmed ticks, `recv(s, i(k+1)) − issue(i(k)) ≤ 1 s`;
3. either `X − issue(in) ≤ 1 s`, or the shard's compute end is inside the phase with `recv_end(s) − issue(in) ≤ 1 s`. From that point the shard leaves the duty.

**Why it covers the phase.**
- Every confirmed word places a real slice inside `(issue(i), recv(s, i))`.
- So:
  - by 1 the first slice lies within 1 s of `E`;
  - by 2 two consecutive slices are at most 1 s apart, even with late delivery, since both lie inside `(issue(i(k)), recv(s, i(k+1)))`;
  - by 3 the last slice lies within 1 s of `X` or of the compute end.
- **Missing or bunched words fail 1 or 2.** The driver issues ticks every 200 ms (via CDP, unthrottled even when hidden).
- **The phase counts only if at least one shard is still duty-bound at `X`.** The long-job fixture must keep real COMPUTE open past the exit (no compute-end word before `X`). A result not yet arrived proves nothing.

**One evaluator:**
- pure, `e2e/phaseProof.ts`;
- the specs (G1 / G2 / G3, v2 §3.3) use it;
- the VM report runs the SAME module over the recorded telemetry (vite-node, as `scripts/simDump.ts`). No twin.

**Its unit test:**
- **Codex's three counter-cases RED:**
  - words only at 9.8 / 9.9 s of a 10 s phase → 1 fails;
  - ticks at 50 / 150 ms with words received at 4.8 / 4.9 s → 1 and 2 fail;
  - every shard at compute end before `X`, waiting on the last ack → no duty-bound shard at `X`.
- **A positive control GREEN:** ticks every 200 ms, words ≤ 300 ms later, one shard computing past `X`.
- **A shard finishing inside the phase:** green with 3's compute-end branch, red without its compute-end word.

### 3.3 The costs, named (replaces v2's four)

| Cost | Measured as | Clock |
|---|---|---|
| **Cold build** | `collision.model_built` ms per instance | the worker's own |
| **Compute** | per shard, active slice time to the compute end (`shard_sweep_ms`) | the worker's own |
| **Inter-slice wait** | per shard, the sum of the gaps between one slice's end and the next one's start, up to the compute end (`shard_gap_ms`) | the worker's own |
| **Final wait** | per shard, compute end → its final post (the last contact ack, the result; `shard_final_ms`) | the worker's own |
| **Finish remainder** | `recv_end` (the last shard) → the result's receipt | page |
| **Observed remainder** | the last word → the result. Named a remainder, never "delivery": it may still contain the last slice | page |

No page-minus-worker arithmetic anywhere.

### 3.4 The join (build notes from R515)

- **Witness for idle checks too:**
  - `_colTick` / `_colNoteWitness` filter on `_colRunReqs` (`ThreeViewer.vue:3353-3370`);
  - a registry `_colWitnessReqs` (id → {kind: idle | run, gen}) admits the idle requests posted under `setCollisionWitness(true)`;
  - run checks stay as they are.
- **Shard ↔ instance:**
  - the coordinator forwards a shard's `model` word without its index (`collisionWorker.ts:646-649`); it adds `shard: k` as it does for witness words (:644);
  - the local path (no pool, or after a fall back) says `shard: null`, instance its own;
  - `collision.model_reused` and `model_built` carry both;
  - after a fall back, the new generation's words bind to the coordinator's instance;
  - the evaluator binds each word to (instance, shard, generation, request).

**Guards:**
- **J1:** a warm model (`model_reused`) and a pool fall back each yield words bound to the right instance and shard.
- **J2:** interleaved driver and heartbeat ticks keep one order: a heartbeat tick never re-uses a driver number.

**Mutations:**
- **M25:** the evaluator measures receipt gaps instead of `recv − issue` → red at the delayed-delivery case.
- **M26:** the phase edges are not checked → red at the phase-edge case.
- **M27:** a result not yet arrived counted as duty → red at the ack case.
- **M28:** the model word without a shard → red at J1.

---

## 4. Unchanged from v2 and R515

- The 20 ms run slices.
- K: at least 1, at most cores − 2, at most 8 shards, within the copy budget.
- Cancel and re-post, with `maxShards` / `sliceMs` outside the job key.
- Start-ask integrated first.
- The VM measurement is a precondition of this merge (v2 §3.3, with §3 here); the machine reading stays owed before main, with the operator's go.
- The README text of v2 §5. The settings and start contracts above are what make its two hidden-tab sentences true; the wording stays.
- MT514-01 (closed) with the `diag` seam's reparse lifetime: the former camera specs set and clear it explicitly (`afterEach` clears it).
- G6 / G7 as in v2: the boundary tap plus its mutants. The `"diag"` type alone forbids nothing.

## 5. Questions (Codex)

- **Q-C12 (§1.1):** is the loop's own cadence enough (≤ 2 s without a link, ≤ 1 s without a generation), or should a settings wake event wake both waits?
- **Q-C13 (§2.1):** is the visibility epoch echoed in the envelope the freshness proof you want? It is a wire field each way: the worker frame `tab_visibility.epoch` and the envelope `vis_epoch`.
- **Q-C14 (§3.2):** 1 s bounds with 200 ms driver ticks. Agreed, or a different bound for the N100 reading?

**For the operator:** none.

# Central Abort — plan v2: DELTA on plan v1 after Codex R505

**Status:** delta for Codex. Base: development `dbd14cab`; every `file:line` is read from `git show dbd14cab:<file>` (`proto/check_citations.py plan-v2.md`). Binding together with plan v1 (`~/claude-work/abort/plan-v1.md`, filed as `docs/reviews/maschinentag.r505.plan-abort-v1.md`) and Codex R505 (end of `docs/reviews/maschinentag.review.md`, origin/feat/backlog-integration `d190424a`, evidence `maschinentag.r505.codex-*`).

**Accepted by R505 and NOT reopened here:** the banner slot, G0/G1 with the base-width rule, H2, S1 and S3 (the start build takes S1/S3 in now, at today's abort/estop entry). Layout and the start check are not renegotiated. No new browser or native run in this round.

## 0. Change list

| Finding | Closed by | § |
|---|---|---|
| **MT505-01** one owner per accepted stop, independent of its socket | Abort/E-Stop leave the client queue: a gateway-owned **stop lane** owns each from its arrival to its write or a named write failure. Kept client-queue stops are handed to ONE orphan task at a disconnect, and the one in flight is no longer cancelled. `arm` is never handed off. A guard covers each of the 5 points. | 1 |
| **MT505-02** the stop cap can reject the Abort | The lane takes no cap from the client queue. It is bounded by **coalescing**: at most ONE pending job per kind; a join keeps its origin and its own reply; E-Stop never folds into Abort; the origin list is bounded and its overflow is answered by name. A guard is red at today's rule. | 2 |
| **MT505-03** the worker awaits "Preempted by abort" before the Abort | Every reply goes through a per-connection **outbox**; no stop path, worker or reader awaits a socket. Dropped action holds are released before any reply exists. A guard blocks the sender's socket at three places. | 3 |
| §3.4 delivery wording | The reply proves the NML write, not standstill. The send happens at release. Transport outcomes are correlated per `req_id`. Each press keeps its own outcome. | 4 |
| Q-C9 "MACHINE OFF" without status | A `nostatus` state with the banner label "WAITING FOR MACHINE STATUS"; also after a reconnect | 5 |
| Q-C5/Q-C6 | ONE logical Jog instance with two surfaces (moved by a dynamic Teleport, never remounted); the switch waits for held pointers, jog keys and the stick | 6 |
| Texts | The new words, counted | 7 |
| S2 | The boundary is the already DISPATCHED write job; S1/S3 guards from R505; `_stop_arrival` keeps the start build's void | 8 |
| N8 / N9 | N8 bound by request, handler and write log plus motion; N9 also after a confirmed M6/RFL start and during its next step | 9 |
| Q-C8 | The "150 %" runs are renamed *layout/density emulation*; real browser zoom is owed at the choke points | 10 |
| Prototype counts | The non-stop failures (G0 15, G1 6, Firefox G1 1) are reported as NOT passed | 11 |
| XZ missing X jogs | A separate named follow-up, F-XZ | 12 |
| Q-C1 | The drop set stays operator question **Q505-1 (= Q-O3)**; R4 is reworded "read after the arrival" | 13 |

---

## 1. MT505-01 — exactly one owner per accepted stop

### 1.1 Today
- A disconnect cancels the worker. The worker's cancel branch cancels the handler in flight, a stop handler waiting for `_cmd_lock` included (`lcnc-gateway/gateway.py:15146–15153`).
- The following drain sees only the items still queued (`:15631–15641`).
- R505's probe: queue depth 0, in flight `abort`, nothing written, and after the disconnect still nothing written.
- Plan v1's R8 (a hand-off of the queued stops only) cannot rescue that job.

### 1.2 Abort and E-Stop: the stop lane
- **Arrival.** `_stop_arrival(by, from_client, msg)` (v1 §6.2, synchronous) creates or joins (§2) a **StopJob** in the gateway-owned STOP LANE. Abort and E-Stop are no longer put into the sender's `cmd_queue`.
  - StopJob = `{job_id, kind: "abort"|"estop", origins: [{client_id, conn_key, req_id, arrived_mono}], state}`.
  - `state` is `pending → taken → written | write_failed(why)`.
- **ONE lane task** (`_stop_lane`) runs the jobs in the arrival order of their first origin.
  - It is created at lifespan start through `register_bg_task`.
  - For each job it runs the command's existing body through `handle_command` under `_cmd_lock`; the write is unchanged (`_cmd_blocking(…, wait=None)`, `:8848`; the E-Stop branch `:8738–8746` with its `_estop_hold` and `_hal_send` side effects).
  - It records the outcome and puts each origin's reply into that origin's connection outbox (§3).
  - It never awaits a socket.
- **Independent of every socket.** The lane is no client task:
  - a disconnect cancels the connection's `cmd_task` and its handler; neither is the lane;
  - `_preempt_inflight` (`:14297`) cancels client handlers only, so a second Abort never cancels a lane job;
  - only lifespan shutdown cancels the lane; it traces the pending jobs it leaves (`stop_lane.cancelled_at_shutdown`), and HAL owns the machine then.
- **Exactly once.**
  - Only the lane executes a job, and a job leaves `pending` only by the lane taking it.
  - Joins go to `pending` jobs only. A `taken` job takes no joins: an equal stop arriving after the take is a new job and a second write — a later arrival, never a duplicate of the same request.
  - A `written` job leaves the lane. A disconnect between the write and the reply cannot cause a second write; the reply is undeliverable and traced (`ws.stop_reply_undelivered`).
- **A write that fails** (an exception in `_cmd_blocking`, `LINK_CHANGED`, no controller) ends the job `write_failed` with its reason. Every origin is told by name ("Abort not taken — press E-Stop if it still moves"). It is never retried silently.
- **Order relative to the sender's kept stops.** The lane lets Abort/E-Stop overtake stops the sender queued BEFORE them: `jog_stop`, `jog_stop_multi`, `cycle_pause`, `spindle_stop`, `jog_change`, `jog_lease_end`, and `arm`.
  - Each of these is a stop, a no-op or client state after an Abort. A `jog_change` keeps only its stop half, because its lease ended at the arrival.
  - Their order among themselves is unchanged.
  - No non-lane accepted effect is reordered.
  - This is **Q2-C1**, so it is not decided silently.

### 1.3 Kept client-queue stops at a disconnect: the orphan hand-off
- **The worker's cancel branch** (`:15146–15153`) no longer cancels an in-flight handler whose command is STOP-class (`_WS_STOP_CMDS`, `:377`). It detaches it. A non-stop handler is cancelled as today.
- **The disconnect drain** (`:15631–15641`) splits the queue:
  - STOP-class items are kept in FIFO;
  - non-stops are dropped as today;
  - **`arm` is dropped, queued or in flight**, traced `ws.arm_dropped_on_disconnect`. It is never handed off: a closed connection is never armed afterwards.
- **ONE gateway task per closing connection** (`_orphan_stops(client_id, inflight, stops)`, registered as a bg task):
  - it awaits the detached handler to its END;
  - then it runs the kept stops in their order, through the same command body, with replies discarded (the socket is gone);
  - each runs exactly once.
- **A `jog_change` among them** runs under its lease already ended at the disconnect (`_end_client_leases(…, why="disconnect")`, `:15619`). Its stop half is written; its start half is refused at the write (`_lease_write_refusal`, `:5591–5602`). No new start.
- **The armed jog stop of the disconnect path** (`lcnc-gateway/gateway.py:15659–15671`) stays as it is. It is the wider net, not the owner of these commands.

### 1.4 Guards (`test_ws_command_worker.py`, the existing `_Harness`, fake_linuxcnc call log)
- **The 5 points, for {abort, estop}.** A disconnect at each:
  1. arrived, job `pending` (the lane held behind a blocked `_cmd_lock` owner);
  2. `taken`, before its handler starts;
  3. waiting on `_cmd_lock`;
  4. during the write (the fake `cmd.abort` / `cmd.state` blocks);
  5. written, reply not yet sent (the outbox blocked).

  Each case gives exactly one controller write or one named write failure. There is no second write, and the undeliverable reply is traced. Point 3 is red today (R505's probe).
- **The same 5 points for a kept `jog_stop` and a kept `jog_change` in the client queue.** The orphan task writes each once; the `jog_change`'s start half is refused.
- **`arm`** queued, or in flight, at a disconnect: never executed after it; no `client.armed` flip after the close.

## 2. MT505-02 — guaranteed admission for Abort and E-Stop

- **No client cap.** Abort and E-Stop never enter the client queue, so the client cap (`:15548–15558`: depth ≥ 4 × 32 = 128 for stops → "Command queue full") cannot reject them. The cap for every other command is unchanged.
- **Coalescing keeps the lane bounded:**
  - **at most ONE `pending` job per kind.** An arrival of the same kind while one is pending JOINS it. Its origin is appended; the job's one write serves every origin; each origin gets the job's outcome as ITS OWN reply, its `req_id` echoed.
  - **Kinds never join.** An E-Stop never folds into a pending Abort: its stronger effect is its own job and its own write. Lane length is ≤ 2 pending + 1 taken.
  - **Origins per job ≤ `_STOP_ORIGINS_MAX` = 64.** A join beyond that is still joined (its effect is the job's) and is answered AT ONCE with `{ok: false, error: "Abort already pending — joined, no own reply", joined: job_id}`, traced `ws.stop_join_unreplied`. Never a silent drop, never an unbounded list.
  - **Order.** Jobs run in the arrival order of their first origin, so a join never makes an effect later. It can make a repeated press's identical effect earlier, which is harmless. There is no reordering of an Abort and an E-Stop between themselves: a pending Abort followed by an E-Stop writes Abort, then E-Stop.
- **Guards.** The control case is red at today's rule:
  - A client queue holding 128 kept stops behind a blocked handler, then an `abort`: today "Command queue full"; new: written. The same for `estop`.
  - The mixed orders abort→estop and estop→abort, each with a full queue, each followed by a disconnect (combines with §1.4).
  - The join bound: 65 aborts while the lane is held give one write, 64 outcome replies and 1 immediate `joined` reply.
  - An E-Stop arriving while an Abort is pending gives two writes, Abort first, then E-Stop.
  - A deliberate later normal command stays separate: it is admitted or capped as today.

## 3. MT505-03 — no socket wait anywhere in a stop's path

### 3.1 Today
- The worker awaits the "Preempted by abort" reply (`:15155–15167`) before it takes the next item.
- A handler's own reply is sent inside its in-flight task (`:14448`), which the worker awaits.
- The reader awaits every "Superseded by" reply and the lease notices, item by item, with the hold releases interleaved (`:15531–15545`).
- Each send is bounded to 200 ms (`lcnc-gateway/ws_fanout.py:49`, `:403`), so nothing hangs forever. But the stop's way to the controller depended on its own socket (R505's probe 2: nothing written until the reply was released).

### 3.2 The per-connection reply outbox
- `ClientState` (`ws_fanout.py:93`) gets an `outbox` (an `asyncio.Queue`). ONE sender task per connection drains it through `ws_send_json`, with the same 200 ms bound, so reply order per connection is kept.
- **Everything that answers a command goes there and is never awaited by its producer:**
  - the handler's reply (`lcnc-gateway/gateway.py:14448`);
  - the worker's "Preempted by …";
  - the reader's "Superseded by …" (own and other clients);
  - `jog_lease_expired` notices;
  - `start_ask_voided` (S3);
  - the lane's outcomes.
- The worker therefore takes its next item as soon as a handler ENDS. Kept `jog_stop`s no longer wait up to 200 ms behind a reply either.
- **Bound:** `_WS_REPLY_OUTBOX_MAX` = 256. An overflow closes the connection as a slow consumer — the same rule as the send timeout — and is traced. A socket error never touches the lane job of MT505-01.

### 3.3 `_stop_arrival`'s order (all synchronous, one loop step)
1. drain every client's queue (v1 §6.2 a–b);
2. **release every dropped item's action hold** (`_release_action(…, "superseded")`) — before any reply exists;
3. void every open start ask (S1, the start build's call, kept — §8);
4. `_preempt_inflight`;
5. end every client's live jog leases;
6. create or join the lane job;
7. put the replies and notices into the outboxes.

### 3.4 Guards
- **The sender's socket is blocked** (a fake socket whose send does not return until released) during:
  - (a) the worker's "Preempted by abort" reply;
  - (b) a kept `jog_stop`'s reply;
  - (c) `arm`'s reply.

  In each case the abort is written while the reply still blocks, ordered by the fake_linuxcnc call log. (a) is red today (R505's probe 2).
- **The holds** of the dropped items are released before the outbox receives its first item (the action table read at that moment).
- **A slow foreign client** (from v1) still holds nothing up.

## 4. Delivery at the control (replaces v1 §3.4)
- **What the reply proves.** A successful `abort` reply proves the **NML write** (`_cmd_blocking(…, wait=None)`, `lcnc-gateway/gateway.py:8848`), not standstill. The banner and the Safety strip show what the controller then reports. v1's sentence "the reply is [a controller stop]" is withdrawn.
- **The connection check and the send** happen at the RELEASE (the click, P1a), never at the pointerdown.
- **Transport outcomes are correlated per request.**
  - Today the worker's drop names only the command (`lcnc-webui/src/wsWorker.ts:388`, `:394`).
  - New: the page posts `{type: "send", payload, cmd, req_id, dropIfClosed}`. The worker answers each with one of `{type: "sent", req_id}` after `ws.send` returned, `{type: "dropped", req_id}` (socket not OPEN), or `{type: "send_failed", req_id}`.
  - `lcncWs` resolves that request's pending outcome.
- **What the control shows:**
  - `dropped` → "Not sent — no connection to the gateway";
  - `send_failed`, or `sent` and no reply within 3 s → "No reply from the gateway — press E-Stop if it moves";
  - reply `ok: false` → "Abort not taken — press E-Stop if it still moves";
  - reply `joined` (§2) → "Abort already pending";
  - reply `ok: true` → nothing; the banner shows the state.

  Never "sent" from a mere post to the worker, never "not sent" from a timeout.
- **Several stops.** Each press has its own `req_id` and outcome. No press waits for an earlier one: stops are never debounced, as today (`lcnc.ts` `NEVER_DEBOUNCED`). The control shows the outcome of its LATEST press only; a late outcome of an older press never replaces it. Pressing E-Stop does not read the Abort's pending outcome, and the reverse.
- **Guards:**
  - a press with the socket closed → "Not sent";
  - a drop in the worker after the page's check → the same, matched by `req_id`;
  - two presses where the first's reply arrives after the second's → the hint is the second's;
  - a press during another stop's pending reply → sent at once.

## 5. Q-C9 — never "MACHINE OFF" without a status of this connection

### 5.1 Today
- Before the first status, `st` is `{}` (`lcnc-webui/src/App.vue:822–825`; `status` starts `null`, `lcnc-webui/src/ws/statusStore.ts:93`), so `machineState` is `off` (`App.vue:189–197`) and the banner reads "MACHINE OFF".
- After a reconnect, `status` keeps the previous connection's object: `connectionGone` (`lcnc-webui/src/lcncWs.ts:113`) does not clear it.

### 5.2 New
- **`statusFresh`.** True from the first status frame of the CURRENT connection; false at connect and in `connectionGone`.
- **`machineState` gains `nostatus`**: connected and not `statusFresh`. It comes after `disconnected` and before `estop`.
  - The banner reads **"WAITING FOR MACHINE STATUS"**, in the neutral tone and without a flash.
  - The Safety strip's state words show "—" (`NO_VALUE`).
  - The permission overlay reads no machine permissions, as before a first status: all closed but `always`, `armEnable` and `abort`.
  - The banner Abort stays live (v1 §3.2).
- **Guards** (the status frames are withheld by a mock op; the prototype used a Worker filter):
  - the first connect with no status: the label, no OFF / E-STOP / IDLE words, the Abort pressable (§4);
  - a reconnect after a status, with the new connection's frames withheld: the same, never the old connection's words;
  - the first status then switches to its real state in one frame.

## 6. Q-C5 / Q-C6 — ONE logical Jog, several surfaces

- **ONE `JogStrip` instance**, mounted once, with one gesture registry, one lease owner and one set of document listeners.
- **The G1 block move.** Its full block moves between the head slot and the window's first slot by a section-level `<Teleport :to>` with a dynamic target, which moves the DOM and keeps the instance. It is never a Teleport inside `MachineBtn`; that rule concerns a button's root.
- **The Stop column** (the H2 and G1 fold, and `!hasXyPad`) is a stateless SURFACE: it holds no gesture or lease and calls the one instance's `stopAllJog` through an injected function. A second visible face of the jog Stop is allowed (R505); a second owner is not.
- **One held form.** G0/G1 and the H2 fold read ONE held form: `stripForm`, a `heldThroughPress` whose hold also covers every live jog gesture — a pointer, a jog KEY (`jogGestures`, `useKeyboardShortcuts.ts`) and a deflected stick (its live lease). Opening, closing and focus hand-over (LA411-04) read that same held form.
- **No two instances, ever.** Never mount two active Jog instances, not even for a frame.
- **Guards:**
  - the instance count is 1 across G0 → G1 → H2 → G0 (component setup count and document listener count);
  - no frame with two mounted `JogStrip` (a MutationObserver over each switch);
  - a held jog key across a threshold crossing → no form change until its keyup, then exactly one;
  - the same for a deflected stick and a held pointer;
  - one lease owner throughout.

## 7. Texts (delta; counted by `count_texts.py`)

| Where | Text | Limit |
|---|---|---|
| Banner without a status of this connection | `WAITING FOR MACHINE STATUS` | ≤ 60 |
| Joined beyond the origin bound (reply) | `Abort already pending — joined, no own reply` | ≤ 60 |
| Joined (at the control) | `Abort already pending` | ≤ 60 |
| Lane write failed (reply / control) | `Abort not taken — press E-Stop if it still moves` | ≤ 60 |
| Transport drop matched by `req_id` (control) | `Not sent — no connection to the gateway` | ≤ 60 |
| Sent, or send failed, no reply in 3 s (control) | `No reply from the gateway — press E-Stop if it moves` | ≤ 60 |

## 8. S2 and the S1/S3 guards

### 8.1 The dispatched write job (rewords v1 §6.6(b) and §6.3 R3)
- **The boundary is the write job ALREADY DISPATCHED**: `inner = asyncio.ensure_future(asyncio.to_thread(_run))`, awaited by `_thread_to_end` (`lcnc-gateway/gateway.py:5420–5421`; `_thread_to_end` `:1707`).
  - `Task.cancel()` only sets the slice flag (`on_cancel=cancel.set`). It is **no veto before `admit` / `cmd_fn`** (`lcnc-gateway/gateway.py:5358–5382`).
  - R505's probe: a cancel before admit, then admit and AUTO still ran, and only then the outer task ended cancelled.
- **The contract:**
  - a start job dispatched before the Abort's write may still write AUTO, strictly BEFORE the Abort's write, which waits for `_cmd_lock` held to the job's end, and is then ended by it;
  - a handler cancelled before dispatch writes nothing;
  - there is no start phase after the dispatched one: the next phase's await raises;
  - the start fence stays owned to the end of the dispatched job and is released in its `finally` (start v3 §E);
  - no revocable `StartProof` kind.
- **Guards, both sides of the dispatch:**
  - a cancel at the last await before `ensure_future` → no write, record `unsent`;
  - a cancel right after dispatch, before admit → exactly one AUTO write, then the Abort's write, the fence released, no next RFL phase.

### 8.2 S1/S3 guards (R505)
- The void frame closes only the matching `attempt` + `ask_id` of that connection.
- A late void never closes a fresh dialog; a pending reply never reopens a voided attempt.
- The page stops a hold WHEN it learns of the void. A hold that ended earlier cannot redeem the voided ask: S1 refuses it on the server.
- The plan does not claim "from A's press on, B sends nothing".

### 8.3 Keeping the start build's void
- The start build lands S1 at today's abort/estop entry (the reader branch `lcnc-gateway/gateway.py:15518`).
- `_stop_arrival` absorbs that call unchanged as its step 3 (§3.3).
- A guard drives both arrival kinds after the refactor and asserts every open ask is voided in the same loop step as the drains. Mutation M29 removes it.

## 9. Native cases (amends v1 §10)
- **N8:**
  - bind the victim MDI through its request id → its handler start/end trace → the write log (`_cmd_blocking` begin/written, the claim's serial);
  - plus a VISIBLE motion effect: B's MDI is a long `G1` from a recorded position;
  - STAT position is sampled at ≥ 30 Hz from before A's press until 2 s after;
  - the axis never moves toward B's target; B's request has its superseded reply and NO handler-start trace.

  One later `echo_serial_number` snapshot is not enough.
- **N9** adds:
  - after a CONFIRMED M6 / RFL start (accepted `seq_id`, before its next step);
  - DURING that next step (the M600 probe move, the positioning MDI).

  The Abort ends the running step; no later step runs; `rfl_status aborted` carries the `seq_id`.
- **The machine INI** is read only when it is in the authorised material. The example routines prove nothing about the operator's machine.

## 10. Q-C8 — naming
- The runs v1 calls "150 %" (`proto-z150`, `ff-proto-z150`) are a **layout/density emulation** (CSS viewport ÷ 1.5 with `deviceScaleFactor: 1.5`), not a browser zoom. v1 §11.7/§11.8 are retitled so.
- The build owes **real browser zoom at 150 %** in Chromium AND Firefox at the choke points: the G0/G1 threshold on both sides, the scrollbar band, the helpers, and the fixed stop faces. The method per browser is named in the build plan. The full cross-product is not repeated.

## 11. Prototype counts (corrects v1 §11 and the report)

| Run | Stop faces | Cases with OTHER failures — NOT passed |
|---|---|---|
| G0 Chromium 100 % | 36 × 47 whole, head fixed | **15** |
| G1 Chromium 100 % | 30 × 31 | **6** |
| G1 Chromium, emulated 150 % | 12 × 31 | 0 |
| G1 Firefox 100 % / emulated 150 % | 12 × 31 + 4 × 31 | **1** (TWP 900 × 1200, at 100 %) |

- The other failures are "last control after a keyboard focus" (v1 §11.1). They are **not** passed reachability.
- The build's guard reaches every last SINGLE control by Tab. A section wider than the window is allowed; an unreachable single control is not.
- **H2:** "both helpers whole" is not general. The owner + keypad pair is cut at XYZ 1000 and with 9 axes at 1280. The build shows the real operating sequence there, focus and scroll included.

## 12. F-XZ — a separate named follow-up
An XZ (or X-only) machine has no X jog buttons today (`lcnc-webui/src/JogStrip.vue:144`, `:538`). That is the follow-up **F-XZ**, not part of this package. The Stop column ships regardless.

## 13. Q-C1 — the drop set stays an operator question
- **The drop set.** "All queued non-stops except `arm`" is the technical recommendation (Claude and Codex R505).
  - It is **Q505-1 (= Q-O3)** for the operator. It is NOT approved by Q453-1, whose words were "Bewegungsbefehle".
  - The build implements the drop through ONE predicate (`_dropped_at_stop(cmd)`) so the answer is one line.
  - Variant (b), motion only, needs the class table named in v1 §6.4.
- **R4 wording.** A command READ after the arrival may run before the Abort's write and be ended by it, or run after it. No barrier (R505). The plan says "read after the arrival", not "a deliberate new operation".

## 14. R505 answers recorded
- **Q-C2:** yes — E-Stop takes the same entry (drains, lease ends, ask voids), with its own controller effect.
- **Q-C3:** yes.
- **Q-C4:** yes.
- **Q-C10:** 44 px recommended; Q-O8 stays with the operator.
- **Q-C11:** S1/S3 accepted.

## 15. New questions for Codex
- **Q2-C1:** the lane lets Abort/E-Stop overtake the sender's kept stops queued before them (§1.2: each is a stop, a no-op or client state after the Abort; their own order is unchanged). Acceptable, or must the Abort keep its FIFO place behind them? That would need a reserved slot in the client queue instead of the lane, plus the orphan hand-off for it.
- **Q2-C2:** the reply shape `{ok: false, joined}` for a join beyond the origin bound.
- **Q2-C3:** closing a connection whose reply outbox overflows (256), the same rule as the send timeout.

## 16. Mutations added (on v1 §9.1)
- **M21** the lane created as a client task (a disconnect cancels it);
- **M22** the disconnect cancels an in-flight stop handler again;
- **M23** `arm` handed off at a disconnect;
- **M24** Abort enqueued into the client queue again (the cap rejects it);
- **M25** an E-Stop joined into a pending Abort;
- **M26** joins without the bound;
- **M27** the worker awaits the "Preempted by" reply;
- **M28** holds released after the first reply;
- **M29** the S1 void lost in the `_stop_arrival` refactor;
- **M30** two `JogStrip` instances during a switch;
- **M31** a form switch under a held jog key;
- **M32** the control shows "Not sent" on a timeout;
- **M33** `machineState` `off` from an empty or stale status.

## 17. Operator page — changes needed (named, NOT republished)
- **The "no status" banner image** shows "MACHINE OFF" (the prototype predates the Q-C9 fix). Caption it "will read WAITING FOR MACHINE STATUS", or re-render after the fix.
- **The question "XZ without X jog buttons — fix together or separately?"** becomes a note: "a separate follow-up (F-XZ)".
- **The question on what other screens lose** is marked Q505-1, with the recommendation; still open.
- Nothing else on the page changes. Layout, G1, H2 and the start-dialog questions stand.

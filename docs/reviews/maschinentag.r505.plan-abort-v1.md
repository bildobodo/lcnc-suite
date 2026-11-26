# Central Abort and the fixed Safety/Jog strip — plan v1

**Status:** plan for Codex review (no build). Base: development `dbd14cab`. Every `file:line` below is read from `git show dbd14cab:<file>` (check script: §14). Prototype (throwaway, never merged, never pushed): commit `dd394007` on the local branch `proto/abort-render` in `~/lcnc-suite-abort` (the worktree itself is back on `feat/abort-plan` at `dbd14cab`; its ignored `lcnc-webui/dist` still holds the prototype build); measure/render spec `lcnc-webui/e2e/abort-proto.spec.ts` (copies of spec, configs, runners and `proto.diff` in `~/claude-work/abort/proto/`). Measurements: §11; tables `~/claude-work/abort/runs/tables.md`. Renderings for the operator: `~/claude-work/abort/page/index.html`.

**Decided before this plan** (sources: `docs/reviews/maschinentag.review.md` "Designfrage: zentraler Abort … R453", "Codex · Zentraler Abort … Designreview R453", "Operatorentscheidungen vom 25. November 2026"; `docs/reviews/leiste-achsen.review.md` R411–R416, LA411-01):

- A PERMANENT Abort at the right end of the banner: its own reserved slot, constant danger style, always live, fires on RELEASE (P1a: only E-Stop fires on the press), works without a first status.
- It stops program/MDI, jogs, homing and the spindle (LinuxCNC task abort).
- **Q453-1 = YES** (operator 2026-11-25): an Abort also drops the QUEUED motion commands of OTHER clients — its own gateway contract, boundary at the Abort's arrival, with a two-client counter-case; a deliberate new operation after it is separate.
- Stage B of the strip: Safety AND Jog stand fixed, the scroll window begins at Setup; NO fourth "Jog stop" button in Safety; the targeted jog Stop stays (LA411-01) and joins the dialog focus scope; Spindle stop stays in its block.
- Codex R453 requires a MEASURED prototype before plan approval (§11).

---

## 1. What the operator sees

- The banner always ends with a red-marked **Abort** button at the same place — at rest, running, paused, during a safety trip, disarmed, before the machine has reported anything and while the connection is down. It never moves and never greys out.
- A tap (or a long press) on it stops what the machine is doing: the program or MDI line, every jog, a homing run, and the spindle. Power stays on; it is not an E-Stop.
- If the page has no connection, the button says so at the button ("Not sent — no connection to the gateway"); it never pretends.
- In the bottom strip, Safety and Jog stand still; only the part from Setup on scrolls. The jog Stop (the centre of the XY pad; a Stop column of its own on machines without an XY pad) is always on screen.
- Another screen's queued jog/MDI/program start that had not run yet when someone pressed Abort does not run afterwards; that screen is told "Superseded by abort from another client".

## 2. Today's code (dbd14cab) — what the plan changes

| # | Fact | Where |
|---|---|---|
| T1 | The banner's Abort exists only while running or paused: `bannerShowAbort = isRunning \|\| isPaused` and `v-if="bannerShowAbort"` | `lcnc-webui/src/App.vue:338`, `:2347` |
| T2 | The same flag also HIDES the 5 s message line while running/paused | `App.vue:2325` |
| T3 | Abort is the last child of `.bannerActions` (one flex row with Acknowledge, Reload/Load program, Home All, the message count, Refresh); `.bannerActions { flex-shrink: 0 }`, the text `.bannerContent { flex: 1; min-width: 0 }` | `App.vue:2335–2347`, `:3276`, `:3229` |
| T4 | The client closes `abort` before the first status and against a gateway without the class: `BACKEND_ONLY_GATES` → `out[g] = !!machine?.[g]`; the reasons twin names it "Gateway lacks this permission — restart it" | `lcnc-webui/src/permissions.ts:236`, `:286`, `:261` |
| T5 | The gateway's rule has no requirement: `"abort": ()`; `STATELESS_GATES` passes it before the first status | `lcnc-gateway/command_policy.py:678`, `:740`, `:812` |
| T6 | `fire()` refuses a closed gate into the message center only | `App.vue:1769`, `:1776` |
| T7 | A command sent on a closed socket is dropped by the worker; the operator hears it only in the message center ("Command dropped — not connected: abort") | `lcnc-webui/src/wsWorker.ts:390`, `lcncWs.ts:267–271`, `lcncWs.ts:439`, `ws/wsTransport.ts:201` |
| T8 | The only jog Stop is the XY pad's centre (`label: "Jog Stop"`) under `v-if="hasXyPad"`, which needs X AND Y: an XZ or one-axis machine has NO Stop (and no X buttons either) | `lcnc-webui/src/JogStrip.vue:144`, `:333`, `:538` |
| T9 | The pad Stop is never refused (`padRefusal` → `axisRefusal(-1)` skips negative indices), catalog `jogStop` gate `always`; it acts on its click (P1a) and sends `stopAllJog` (lease end + `jog_stop` per axis) | `JogStrip.vue:350`, `:378`, `:420`; `machineControls.ts:97` |
| T10 | The dialog focus scope is the top dialog, its helpers, `.safetyStrip` and `[data-dialog-reachable]` (today: Acknowledge and the banner Abort) | `lcnc-webui/src/modalRegistry.ts:177`, `:127` |
| T11 | Keyboard: Escape = E-Stop (capture, not re-bindable); Abort = Backspace (default map), refused behind any dialog/helper and in a text field; checks `permissions.abort` | `useKeyboardShortcuts.ts:114`, `:138`, `:140`, `:184`; `defaults.ts:1031` |
| T12 | Gamepad: `btn_b` = abort (default map), checks `perms.abort`, no modal guard | `useGamepad.ts:251`; `defaults.ts:896` |
| T13 | The whole strip is ONE horizontal scroller (`overflow-x: scroll`), Safety `position: sticky; left: 0`; a text helper hides every section but Safety, the number keypad all but its owner | `App.vue:2840`, `:3083`; `lcnc-webui/src/style.css:2179–2185`; `App.vue:619–621` |
| T14 | Abort/E-Stop at the reader: drain THIS client's queued non-stops (kept: stops + `arm`), **await** a reply per dropped item, THEN `_preempt_inflight`, THEN **await** the lease notices, THEN enqueue the abort | `lcnc-gateway/gateway.py:15518–15545`, `:15564` |
| T15 | `cmd_queue` is a local of `ws_endpoint`: no other reader can reach it | `gateway.py:15112` |
| T16 | `_preempt_inflight` cancels every client's in-flight non-stop handler (not stops, not `arm`) and the RFL sequence, the toolsetter read-back and the reserved-fixture heal | `gateway.py:14297–14335`, `:393` |
| T17 | Only the SENDER's jog leases end at the arrival; the abort's write settles the leases ended "by abort" | `gateway.py:15545`, `:8850`; `_end_client_leases` `:6126` |
| T18 | The abort handler: `_cmd_blocking(linuxcnc.command.abort, wait=None)`, then lease settle and `_actions.end_all("aborted")` | `gateway.py:8845–8853` |
| T19 | A client's disconnect cancels its worker and DROPS everything queued — a queued, not yet written abort or E-Stop included | `gateway.py:15631–15641` |
| T20 | LinuxCNC 2.9.4 `EMC_TASK_ABORT`: `emcTaskAbort` (motion abort, interp list cleared, plan closed, synch queued), `emcMotionAbort`, `emcIoAbort`, `emcSpindleAbort` for every spindle (= `emcSpindleOff`), `mdi_execute_abort`, `emcAbortCleanup` → `Interp::on_abort` → `reset()` and, when set, `ON_ABORT_COMMAND` | upstream `emctaskmain.cc:2108–2121`, `emctask.cc:225–262`, `:743–749`, `taskintf.cc:1899–1902`, `rs274ngc_pre.cc:2626–2650` (local copy `~/claude-work/bg/upstream-2.9.4/`) |
| T21 | Motion abort: teleop → `axis_jog_abort_all`; coord → `tpAbort`; free → every joint planner off and **homing cancelled** | upstream `motion-command.c:494–531` |

## 3. The banner Abort

### 3.1 Slot and geometry
- The Abort leaves `.bannerActions` and gets its own last child of `.statusBanner`: `.bannerAbortSlot { flex: 0 0 auto }`. It is rendered in EVERY state (no `v-if`).
- `.bannerActions` becomes `flex: 0 1 auto; min-width: 0`: the text shrinks first (ellipsis, as today), then the transient actions; the slot never shrinks. The slot holds BY CONSTRUCTION; the nine measured states never overflowed the actions, so they cannot tell the slot from today's CSS minus its `v-if` — the red-first case is a constructed overflow (actions wider than the banner minus the slot), owed in the build. **Banner floor:** the widest action set (394 px) + the slot (Abort 78 + gap + "?" ≈ 100 px) + paddings and gaps (≈ 50 px) ≈ 545 CSS px; below that the actions run under the slot (the Abort stays whole, an action does not) — a narrower banner would need the actions to fold, not planned. Whatever the actions need beyond their box lies UNDER the slot (the slot is later in the paint order and `z-index: var(--z-raised)`), never over it — the Abort cannot be pushed or covered by its own banner. The measured budget (§11.2) says whether the action row ever needs that; a row that overflows is a defect of its own (each banner action is whole — a guard).
- Constant style: catalog `bannerAbort` (`variant: 'danger'`, md) — the state may change the banner's tint, never the button's place, size, label or colour.
- Size (measured, touch): today a banner `md` button is **78 × 36 px**, sized by its padding (`Btn.vue:70`); the 44 px floor (`:84`) applies only inside `.sidePane, .dialog, .macroBar`, and the banner is 44 px high with 4 px padding (`App.vue:3211`). Proposed and prototyped (v2): the slot's button takes the touch floor (`min-height: var(--control-h)`) → **78 × 44 px**, the banner 52 px high in every state (a layout reference change; the other banner buttons stay 36 px) — **Q-C10 / Q-O8**.
- Contrast (found in the renders): the `danger` button is a light red tint with red text; on the trip banner (danger tint, flashing between `--tint-heavy` and `--panel`) its edge almost vanishes. The slot's button keeps a 3 : 1 edge against EVERY banner background it can stand on (state tints, both flash phases, both themes) — `contrast.spec` gains these pairs; if the catalog variant cannot hold it, the slot gets a `--control-edge` ring (style.css token), never a one-off colour.
- Label stays "Abort" with the square glyph (`MachineBtn.vue:62`, `useAbortDefault`). A `HelpIcon` sits INSIDE the reserved slot, left of the button (part of the slot's constant width; §7).

### 3.2 Always live
- Client: `applyClientOverlay` returns `abort = true` in every state — before the first status, against a gateway without the class, disarmed, busy, in simulation mode. The reasons twin never names a reason for `abort` (it is never closed). `pause` and `spindleStop` stay backend-judged (STOP_GATES unchanged); every other unknown class stays closed (BG-15 unchanged). (Changes `permissions.ts:236`, `:286`.)
- Gateway unchanged: `"abort": ()`, in `STATELESS_GATES`, in `STOP_COMMANDS`, never debounced (`lcnc.ts` `NEVER_DEBOUNCED`, `MachineBtn.vue:123`).
- The other Abort buttons (tab heads, macro bar, Macros tab) use the same gate and so become live in the same states; they keep their places (`App.vue:2497`, `:2557`, `:2753`; `MacroBar.vue:58`).

### 3.3 Firing
- A tap: the click (P1a — `releaseClick.ts` gives a long touch press its click at the release; a press that moved past the slop or slid off acts nowhere). No hold, no confirmation. Enter/Space on the focused button (native). A held key's repeats send nothing more (one abort per key press — `e.repeat` guarded like the jog Stop).
- Exactly ONE `abort` per gesture; nothing else is sent by the gesture (no M5/M9/jog_stop sequence from the page — the gateway's `abort` is the one path, Codex R453 §4).

### 3.4 Delivery at the control (feedback rule: what a touch triggers answers AT the control)
- Socket not OPEN at the press → nothing is posted; `btnHint` at the button: **"Not sent — no connection to the gateway"**; the message center records the same (as today's `dropped_command`). No queued replay after reconnect (issue #18 contract kept).
- Sent → the page awaits ITS reply (`awaitReply` by `req_id`, 3 s): `ok:false` → hint **"Abort not taken — press E-Stop if it still moves"** + message; no reply → hint **"No reply from the gateway — press E-Stop if it moves"**; `ok:true` → nothing at the button: the banner's state line shows what the machine does (no optimistic "stopped", the trip display untouched).
- A send handed to the worker is not a controller stop (Codex R453 §2): the reply is.

### 3.5 Message line
`bannerShowAbort` is split: the message rule reads `runLineOwnsBanner = isRunning || isPaused` (today's behaviour: a running/paused program keeps its line); the Abort reads nothing. Same behaviour, separate concerns (T2).

### 3.6 Covers
Nothing may cover the slot: (a) DialogFrame teleports into `#content-dialog-area` (below the banner) — measured; (b) top-layer popovers (MoreMenu, HelpIcon) are placed outside the banner's Abort rect (their placement gets the slot as an exclusion rect); (c) `btnHint` / the keyboard glyph (`FloatingOverlays.vue`) avoid the slot the same way. Guard: open each kind at the top of the page and re-run the 13-point hit test on the Abort — including the slot's OWN HelpIcon, whose top-layer popover opens beside the Abort (not opened in the prototype).

## 4. Keyboard, gamepad, focus

| Input | Today | Plan |
|---|---|---|
| Escape | E-Stop, capture phase, every state (T11) | unchanged |
| Backspace (default Abort) | refused behind a dialog/helper and in a field; needs `permissions.abort` | unchanged rules; the gate is now always open, so it works before the first status. Behind a dialog it stays refused (a dialog's fields own Backspace) — **Q-C4** |
| Enter/Space on the banner Abort | native button | unchanged; one abort per press |
| Gamepad `btn_b` (default abort) | `perms.abort`, no modal guard | unchanged; gate always open |
| Tab inside a dialog | scope: dialog, helpers, Safety, `[data-dialog-reachable]` | + the jog Stop (its face only, `data-dialog-reachable` on the Stop buttons — never the jog starts) |

The dialog-scope test (§11.5) Tabs 80 times from inside the Tools "New" dialog and records every reached element.

## 5. The strip: Safety and Jog fixed, the window from Setup

### 5.1 Construction (prototype)
- `.strip` stops scrolling (`overflow: clip`, see below). Its children: `SafetyStrip`, `JogStrip`, then ONE new `.stripScroll` (`flex: 1 1 0; min-width: 0; overflow-x: scroll` in landscape, `overflow-y: scroll` in portrait) holding Setup, the text-helper place, Overrides, Spindle, Tool, the number keypad (+ its place) and the far fade. No sticky overlay carries a stop (Codex R453 §3).
- Moves with it: the divider rule (`.stripScroll > * + *`), the far fade and its `strip-more` toggle (`attachScrollFades` observes `.stripScroll`, `App.vue:1593`), the helper place (`.stripScroll > .stripHelperPlace`). The near fade moves from Safety's `::after` to the window's start (not prototyped). `dragScroll` attaches to every `.scroll-thin` element (`lcnc-webui/src/dragScroll.ts:3`): the window carries the class, the strip drops it (it is no scroller any more). The portrait safety-fold measurement (`measureStripColumn(strip)`, over `strip.children`) must measure the head + window — re-derived in the build.
- The always-reserved scrollbar band moves to the window. Landscape: the strip's height is unchanged (Safety/Jog have the fixed `--strip-section-h`; the window = sections + band). Portrait: the head stands beside no band, so Safety and Jog are padded by the window's band (`--strip-band-w`, read from the window's ResizeObserver: `offsetWidth − clientWidth − clientLeft`) — every section keeps ONE width.
- Jog never leaves the head; it FOLDS to its Stop column (`.axisCol.stopCol`, 69 px wide in landscape, touch) in two cases: a helper is open (H2, §5.4) and the narrow form G1 (§5.2). The fold is ONE form of Jog, prototyped as `JogStrip` prop `folded`.
- The jog Stop exists without an XY pad: the same Stop column (`stopAllJog`, catalog `jogStop`, `data-jog-stop data-dialog-reachable`) whenever `!hasXyPad` (T8). The pad's centre Stop gets the same two attributes.
- The strip is NO scroll container: `overflow: clip` (prototype v1 used `hidden`, and a keyboard focus scrolled the head away at TWP/9 axes 1000 px — Jog moved 77 px). The strip's right padding (landscape) and its inline padding (portrait, the window spanning it with `margin-inline: -gap; padding-inline: gap`) live INSIDE the window: prototype v1 lacked them and XYZ at 1920 overflowed by 8 px, portrait ran 4 px sideways; prototype v2 measures XYZ at 1920 rect-identical to today with NO overflow and portrait without a sideways run (§11.1).

### 5.2 Width budget and the fallback rule (G0 / G1)
Measured base sizes (touch, 100 %, §11.1) — Safety 280 px wide everywhere; Jog XYZ 523.5, XZ/Z 344 (with the new Stop column), XYZAC 662.5, TWP 735.5, 9 axes 859.5; Setup XYZ 360, Z 328, XYZAC 456, TWP 544, 9 axes 574. With Safety + whole Jog fixed, the window left (its 2 × 8 px padding included) is: XYZ 1082 / 762 / 442 / **162** px at 1920 / 1600 / 1280 / 1000; XYZAC 943 / 623 / **303** / **23**; TWP 870 / **550** / **230** / **16**; 9 axes 746 / **426** / **106** / **16**. Portrait (strip column 280 px): the head is Safety 269 + Jog 590.5 (XYZ) … 758.5 (9 axes) px high; the window keeps 913 (XYZ) / 783 (TWP) / 745 (9 axes) px at 1080 × 1920 but **157 / 49 / 27 / 8** px (XYZ / XYZAC / TWP / 9 axes) at 900 × 1200. A window that thin is no working area, so the division has to change there (Codex R453 §3), never the hit targets.

- **G0 (default):** Safety + whole Jog in the head, the window from Setup.
- **G1 (narrow form):** Safety + Jog FOLDED to its Stop column in the head; Jog's whole block becomes the window's FIRST section (it scrolls with Setup …). The Stop column is in the head in every G1 state; the pad's centre Stop, when the window shows the pad, is a second face of the same action.
- **The rule, on BASE widths (each section's own measured size, never the overflow state):** G0 iff the window would hold **Setup whole** — landscape `safety + jog + setup + 2 dividers + gaps + padding ≤ strip width`, portrait `safety + jog + setup ≤ strip height` (heights). Else G1. ±1 px hysteresis; a form change waits until no press holds (`heldThroughPress`) and hands focus over (LA411-04). With the v2 numbers (Setup + the window's 2 × 8 px padding against the window): XYZ G0 down to 1280, G1 at 1000; XZ and Z G1 at 1000 (Z misses by 3 px — a ±1 px case in practice); XYZAC G1 from 1280; TWP and 9 axes G1 from 1600 (TWP misses by 10 px there); portrait 1080 × 1920 G0 for every set; 900 × 1200 G1 for every set with an XY pad, G0 for XZ and Z.
- G1 is measured in §11.6 (Stop whole at every sample, head unmoved, every section incl. the window's Jog reachable).
- The prototype ran G1 as TWO `JogStrip` instances (the head's folded one and the window's full one). The build has ONE owner of every started jog across a G0↔G1 or H2 change: pointer jogs are held by `heldThroughPress` (no form change under a press), but a jog started by a KEY or the GAMEPAD runs outside any press — the form change must also wait for held jog keys and a deflected stick (the R411 LA411-04 rule "waits for held keys"), and the Stop that ends them is `stopAllJog` in whichever instance shows it.
- Alternative not taken: keeping Jog's "core" (pad + Z + linear speed, 357.5 px for XYZ) in the head and moving only its rotary/UVW and step/mode parts — it splits Jog's own layout into two arrangements per axis set; the fold reuses the one form H2 needs anyway.

### 5.3 Jog's width per state
Jog must keep ONE box per axis set and density over every machine state (homed, unhomed, joint jog, TCP, Plane, Plane stale), or the window's origin — and Setup under a finger — moves. Measured in §11.3.

### 5.4 Helpers (number keypad, text keyboard)
- **H0 (today):** a text helper hides every section but Safety, the number keypad all but its owner (`App.vue:619–621`) — Jog and its Stop vanish while a jog may still run: the gamepad jogs with a helper open (no modal guard, T12) and an incremental jog runs on after its release.
- **H1 (Jog stays whole):** measured at 1280: the text keyboard (475 px) and the keypad beside Setup (319 + 360 px) do NOT fit a 442 px (XYZ) or 230 px (TWP) window (v2) — the helper is cut and must be scrolled while typing (§11.4).
- **H2 (proposed): Jog folds to its Stop column while a helper is open** (unless the keypad's owner is Jog itself). The window then has 896 px at 1280 (v2) — both helpers whole; the Stop whole; Safety and Jog's origin unmoved. The fold follows the HELD layout (`stripLayout`, `heldThroughPress`): it never happens under a press, so the Stop does not move under a finger.

### 5.5 What survives of the agreed stage B (R413–R416)
| Clause | Fate |
|---|---|
| Fourth Safety button "Jog stop", stop on pointerdown | **void** (operator 2026-11-23; P1a: stops act on release) |
| F2/F3 pinned right groups (Overrides/Spindle sticky right), `order`, scroll-padding per form | **void** for now — no sticky groups; a pinned right group would be a second window (**Q-C3**) |
| Strict whole-box hit tests (control/children/own `.btnTip`, edge midpoints + quarter grid) | **kept** (this spec's 13 points) |
| Keyboard-only focus scroll, deferred through every held press; Tab under a held press taken over in window BUBBLE (respects `defaultPrevented`, modifiers, tree position); press-aware `preventScroll` for every programmatic focus | **kept**, now for the window |
| Form change waits for held presses/keys; focus hand-over when a focused control disappears (LA411-04) | **kept** for G0↔G1 |
| Stage A (F0/F1, Tool yields) | unaffected; F1 applies inside the window |

## 6. Gateway contract for Q453-1 (Abort drops other clients' queued commands)

### 6.1 The boundary
**The abort's ARRIVAL** = the moment its reader takes the `abort` frame (one event-loop step on the gateway's single loop). Every command any reader enqueued BEFORE it and that has not begun is dropped; every command read AFTER it is a new operation. Readers run on one loop thread, so "before/after" is a total order of reader steps.

### 6.2 Construction
1. `ClientState` (`lcnc-gateway/ws_fanout.py:93`, created at `gateway.py:14478`, already carrying `ws` and `conn_key`) gets `cmd_queue` = the worker's queue (T15).
2. ONE synchronous function `_stop_arrival(by, from_client)` — no `await` inside — called by the reader for `abort` (and `estop`, Q-C2):
   a. drain the sender's queue (keep stops + `arm` in order — today's rule);
   b. drain EVERY other client's queue with the same rule (§6.4 which commands);
   c. `_preempt_inflight(by, from_client)` (T16, unchanged);
   d. end EVERY client's live jog leases (`_end_client_leases(conn_key, why=by)` per client) — a lease begun before the arrival cannot start motion after it (a `jog_change` start half of it is refused at its write by `_lease_write_refusal`, `lcnc-gateway/gateway.py:5591–5602`);
   e. enqueue the abort on the sender's queue (behind its kept stops/arm), with today's cap (4 × `_WS_CMD_QUEUE_MAX` for stops, `gateway.py:15549`) and today's action hold rule (`abort` holds none, `command_policy.py:962`).
   It returns the dropped items and ended leases per client.
3. Only THEN the replies: the sender's own drops and lease notices awaited on its own socket as today; every OTHER client's replies ("Superseded by abort from another client", with each item's `req_id`, `_release_action(…, "superseded")`) and lease notices (`jog_lease_expired` with `reason: "abort_other"`) as one scheduled task per victim client (`register_bg_task`) — a slow victim socket never delays the abort or the sender's reader.
4. Traces: `ws.command_superseded` per victim client with `by`, `from_client`, `client_id`, `cmds`; `jog.leases_ended` with `why`, `from_client`.

Sketch (reader branch, replacing `gateway.py:15518–15545`):
```python
if _rcmd in _WS_PREEMPT_CMDS:
    dropped, ended = _stop_arrival(_rcmd, client_id, msg)   # sync: drains, preempt, leases, enqueue
    for cid, items in dropped.items():                      # own: awaited on its own socket (as today)
        ...                                                 # others: one register_bg_task per victim
    await _tell_leases_ended(ws, ended.get(client_id, []), _rcmd)
    continue                                                # the abort is already queued
```
`_stop_arrival` touches only loop-thread state (`asyncio.Queue.get_nowait/put_nowait`, `Task.cancel`, the lease table) — no `await`, no `_cmd_lock`.

### 6.3 Race boundaries (each a guard in §9)
| R | Case | Why it holds |
|---|---|---|
| R1 | B's command queued, its worker woken but not yet resumed | `asyncio.Queue.get` leaves the item IN the queue until the getter resumes (`while self.empty(): await getter … return self.get_nowait()`, CPython 3.13 `asyncio/queues.py`); the synchronous drain takes it, the woken getter waits again |
| R2 | B's worker has dequeued (`get_nowait` returned) | it runs synchronously to `client.cmd_inflight_task = inflight` (`gateway.py:15118–15143`, no await) → `_preempt_inflight` sees and cancels it before its first step |
| R3 | B's handler is inside a write (`_cmd_blocking` thread) | the write ends (`_thread_to_end`, the lock held to its end); its next await raises CancelledError; the abort's write comes after → LinuxCNC aborts what that write began. A write LinuxCNC took is never taken back. |
| R4 | B's frame READ after the arrival | a new operation: it runs. If it takes `_cmd_lock` before the abort's write, the abort ends it (the safe direction); if after, it runs after the abort (deliberate). Never: a command read BEFORE the arrival written AFTER the abort. **Q-C1** asks whether R4's first branch must be closed by a barrier |
| R5 | B holds a jog key/stick (live lease) — also with a `jog_change` QUEUED before the arrival | `jog_change` is in the stop class (`lcnc-gateway/command_policy.py:1805`), so the drain KEEPS it (its stop half must run); only the lease end at the arrival (6.2d) refuses its start half at the write (`_lease_write_refusal`). B's gesture is spent until its own release — only a NEW gesture (new lease) starts motion. Without 6.2d this is the one queued command that would start motion after the abort |
| R6 | Today's yield between arrival and preempt (T14 awaits replies first) | removed: drain, preempt, lease end and enqueue happen in one loop step; replies after |
| R7 | Two aborts (A and B at once), abort + E-Stop | each runs 6.2; the second finds nothing to drop; both written |
| R8 | The sender disconnects after the arrival, before its worker wrote the abort | today the queued abort is DROPPED (T19). New: at disconnect, queued STOP-class commands are written by a detached task in their order (`ws.stop_written_after_disconnect`), the others dropped as today. "No stop command may be droppable" (`docs/decisions.md:324`) |
| R9 | Background sequences (run from line, toolsetter read-back, reserved heal) | cancelled by `_preempt_inflight` as today; the `#3116` clear that waits for the abort to be processed is a named post-abort write (a parameter MDI, no motion) |

### 6.4 Which commands are dropped
Recommendation: **the same set as the sender's own supersede** — every queued command except the stop class and `arm` (`_WS_NO_PREEMPT`, `gateway.py:393`). Reasons: `_preempt_inflight` already cancels every client's in-flight non-stop handler of any kind (reads included); one rule for queued and in-flight; no new classification table every future command must join. The operator said "Bewegungsbefehle"; the narrower alternative (only motion-starting commands) needs a new class in `command_policy.COMMAND_EFFECTS` style → **Q-C1 / Q-O3**.

### 6.5 What it is not
- No lock-out: nothing is refused after the arrival; a new press is a new operation (Codex R453 §4: no automatic block until an acknowledgement).
- Not other sources: halui, another GUI, a HAL MPG (`control.c:1059–1163` re-enables the free planner on new counts), a REST write — the abort stops what runs at its write, it does not hold them.
- The local simulation playback and the collision check keep their own controls; the Abort names the MACHINE.

### 6.6 The start-message contract (R503 v2 + R504 v3, AGREED; being built on `feat/start-ask`) under a central Abort
Binding documents: `docs/reviews/maschinentag.r503.plan-start-v2.md`, `maschinentag.r504.plan-start-v3.md` and Codex R504 at the end of `maschinentag.review.md` (origin/feat/backlog-integration `78330e43`). This plan does NOT change them; it names what an Abort does to each of their objects and the deltas it needs from the start side.

| Object | What a central Abort does | Start-side change? |
|---|---|---|
| **(a) An OPEN start ask of a connection** (v3 §A.1; voided today by another attempt, a program change, a disconnect, a run beginning — v3 §A.2) | The ask is no queued command, so the Q453-1 drain does not reach it, and an Abort is not on the voiding list: as agreed today it would SURVIVE the Abort, and a confirmation hold completed after it would start the program. Proposed: **an abort or E-Stop arrival voids every connection's open ask** — inside `_stop_arrival`, in the same loop step as the drains (§6.2), so "before/after the arrival" is the same order for asks and commands. A confirmation sent after it finds no open ask → no redemption → a NEW ask (v3 §A.2 "No redemption"), never a silent start. | **Yes — Delta S1** (gateway, v3 §A.2): add "an abort or E-Stop arrival" to the voiding list; guard: ask → abort (any connection) → the same attempt's consent → a new ask, no AUTO write. |
| **(b) A redeemed `StartProof` whose write has not happened** (v3 §A.2: immutable, held only by its start job — the handler, or for RFL the sequence task; no store) | The proof dies with its job: a Cycle Start / Step handler in flight is cancelled by `_preempt_inflight` (T16) — before its record or before the write thread's `admit` → no AUTO write; the attempt's reply is "Preempted by abort" (an error → `refused`, v3 §D.4). A handler already INSIDE the AUTO write's thread (past `admit`, the fence set, v3 §E) finishes that write — begun before the arrival (R3) — and the abort's own write, which comes after under `_cmd_lock`, ends the run; the fence is released by the write's `finally` (v3 §E). A start command still QUEUED at the arrival never redeemed (redemption is at the handler's entry), so no proof exists; the Q453-1 drain replies "Superseded by abort…". | **No** change to the proof. Guards on the start side's unit tests (with this plan's drain): abort between redemption and the record → no AUTO write, the ask not restored; abort while the write thread holds the fence → exactly one AUTO write, then the abort, the fence released. |
| **(c) An accepted RFL sequence** (`rfl: "accepted"`, `seq_id`; v3 §D.2) — **before** its AUTO write | `_preempt_inflight` cancels `_rfl_task` (`gateway.py:14320–14323`, today): no further M600, positioning or AUTO write; an MDI write already begun ends and is then aborted by the abort's write. Today the cancel already ends the sequence by name: `except asyncio.CancelledError: _rfl_phase("aborted", …)` (`gateway.py:7269–7272`) and, for a cancel before its first step, the done-callback (`:6962–6963`); v3 §D.2 puts `seq_id` and `attempt` on every phase, so the page's attempt leaves `sequence` by the terminal v3 §D.4 lists. | **No contract change — S2 is guards only** (start side, `test_start_ask.py`): an abort at each step (pre-measure wait, positioning MDI, the AUTO write) → exactly one `aborted` with that `seq_id`, no AUTO write after the abort, "exactly one M600" unchanged. |
| **(c′) The same sequence AFTER its AUTO write** | The task abort ends the run like any run (T20); the run's record keeps `accepted` (v3 §A.3); the run-time check ends as for any run (v2 §5.2: "end, abort, idle … discard it"). A cancel that arrives DURING the AUTO write's `_cmd_blocking` lets the write finish and raises at its return — before `_rfl_phase("running")` (`gateway.py:7268`) — so the page gets `aborted`, not `running`, for that `seq_id`: true, the run was written and aborted. The `#3116` clear after the abort is the named post-abort write (§6.3 R9). | **No change** (S2 guard): a cancel during the AUTO write → `aborted` with that `seq_id`, the record `written` with `accepted`. |
| **(d′) The operator's OWN start dialog open when he presses Abort** (the banner Abort is in the dialog's Tab scope and under the pointer) | With S1 his own ask is voided by his own abort's arrival; with S3 the dialog closes as superseded ("Aborted — press Start again") — an Abort pressed over an open start question means "do not start". Without S1/S3 the dialog would stay open on a live ask after the abort. | covered by **S1 + S3**; guard: own dialog open → own Abort → dialog closed, no AUTO write, the next Start press asks anew. |
| **(d) The start dialog open on ANOTHER client** | That client's open ask is voided by S1; its page learns it from the gateway (Delta S3) and the dialog closes as superseded (v3 §C.2 row 1) — a hold in progress ends with the row change (v3 §C.2: a row change aborts a hold) and sends nothing. The page cannot see this void today: row 1 of v3 §C.2 ("attempt, program or connection changed, a run began") and the close list of v2 §4.6 (Cancel, a program change, a run beginning, a connection change, its own `started`) are all observable states, an abort is none of them. Without S3 the dialog stays open on a dead ask until its confirmation, which then gets a new ask (still never a silent start). The dialog's own words for this row: "Aborted — press Start again" (≤ 60, 27 chars). | **Yes — Delta S3** (gateway + page, v3 §C.2 row 1): a frame `start_ask_voided {ask_id, attempt, why: "abort"}` to the owning connection; the page treats it as row 1 (superseded) with the words above; guard: two clients, B's dialog open (a hold in progress), A aborts → B's dialog closes, B's hold sends nothing, B's later Start press gets a fresh ask. |

Order of work: S1 and S3 are small deltas (S2 is guards only) on the agreed start contract; they go to Codex as a delta on R504 (not re-planned here) and land with whichever package comes second (start-ask or the Q453-1 gateway step), with the guards above in `test_start_ask.py` / `test_ws_command_worker.py`.

## 7. Texts (counted by `count_texts.py`, §14)

| Where | Text | Limit |
|---|---|---|
| Banner Abort label | `Abort` | — |
| Help (HelpIcon in the slot) | `Stops the program or MDI, every jog, homing and the spindle. Power stays on — not an E-Stop.` | ≤ 120 |
| Not sent (at the button) | `Not sent — no connection to the gateway` | ≤ 60 |
| Refused reply | `Abort not taken — press E-Stop if it still moves` | ≤ 60 |
| No reply in 3 s | `No reply from the gateway — press E-Stop if it moves` | ≤ 60 |
| Other client's dropped command (reply) | `Superseded by abort from another client` | ≤ 60 |
| Other client's ended jog (at its control) | `Jog stopped by an abort on another screen` | ≤ 60 |
| Start dialog closed by an abort (Delta S3) | `Aborted — press Start again` | ≤ 60 |
| Jog Stop column (no XY pad) | `Stop` (name "Jog Stop" as the pad's) | — |

The help states only LinuxCNC-core effects (T20/T21). `ON_ABORT_COMMAND` is per INI: the shipped examples run `O<on_abort> call` (`examples/sim_config/lcnc_suite_sim_3axis_xyz.ini:170`, `examples/sim_config/lcnc_suite_sim_5axis_xyzac.ini:64`; the routine `subroutines/probe_basic/on_abort.ngc:5–9`: `M5 M9 M50 P1 G90 G40`) and TWP `O<on_abort_twp> call` (`examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini:98`; `examples/sim_config/twp/remap_subs/on_abort_twp.ngc:27–29` the same tidy-up, `:35–37` a WCS-index resync that keeps the plane) — **static evidence only** (INI lines, the routine files, `Interp::on_abort`); no live abort was run for this plan (the VM sim was read, never driven); the operator's machine INI is unread. Coolant and tool-change pins after `emcIoAbort` are NOT stated (no local `emcIoAbort` body) — native case N4.

## 8. Permissions and gates (summary)
- `abort` stays a STOP gate: no arm, sim or busy term (BG-08). New: the client never closes it (§3.2). Backend unchanged.
- `jogStop` stays `always`. The new Stop column uses the same type.
- `controlInventory.ts:48` keeps the banner Abort as `stop`; a new row for the Stop column (`JogStrip.vue|MachineBtn:jogStop|@click=stopAllJog`).
- No new permission class (no `mock-gateway.mjs` change for gates).

## 9. Guards (tests the build adds)
Frontend unit:
- `permissions.test.ts`: `abort` open with `machine` null/undefined, without the class, disarmed, busy, sim; `pause`/`spindleStop` unchanged; another missing class still closed.
- `useKeyboardShortcuts`/`useGamepad`: Backspace / `btn_b` send abort before the first status; Backspace in a field and behind a dialog sends nothing.
Browser (Chromium touch + desktop, Firefox desktop for the narrow cases):
- `banner-abort.spec`: the 13-point whole test and ONE rect over rest, running, message, paused, disarmed, trip(+3 messages), all-actions, no-first-status (status frames withheld), disconnected; at 1920/1600/1280/1000/portrait × 100/150 % (viewport ÷ 1.5, DPR 1.5). One `abort` per tap, long press (contextmenu path), Enter, Space; none for a press that slid off; a held press while the banner changes state through all of them → one abort, rect unchanged. Not-connected hint at the control; refused/no-reply hints (mock `replyFor abort`).
- `strip-fixed.spec`: per axis set (XYZ, XZ, Z, XYZAC, TWP, 9 axes) × window (1920/1600/1280/1000, 1080 × 1920, 900 × 1200; 100 % and 150 % as viewport ÷ 1.5 with DPR 1.5): Safety and the head's Jog one rect over 25 positions, a smooth scroll, wheel steps, drag and keyboard focus scrolls; the jog Stop whole at every sample; every scrolled section's last control reached by Tab and whole; Jog one box over every machine state; XYZ at 1920 rect-identical to today and no window overflow; the G0/G1 rule at ±1 px of each threshold, both directions, with a held press (no change until the release, focus handed over); H2 (fold on a helper: Stop whole, Jog's origin unmoved, the helper whole); the outer strip never scrolls (`scrollLeft`/`scrollTop` stay 0 after focus on the last control of every section). Chromium touch + Firefox desktop at the narrow cases.
- `dialogs.spec` addition: Tab/Shift+Tab from the top dialog reaches the banner Abort and the jog Stop, never a jog start; the Abort whole with a dialog, a MoreMenu, a HelpIcon popover and a btnHint open.
Gateway (`test_ws_command_worker.py`, the existing `_Harness`):
- two clients: B queues `mdi`, `jog_cont`, `read_g30` behind a blocked handler; A sends `abort` → B's queued items replied "Superseded by abort from another client" with their `req_id`s, none executed; B's in-flight "Preempted by abort"; A's abort written.
- counter-case: B sends `mdi` AFTER A's abort was read → it runs (not dropped, not refused).
- R1: B's worker woken (item put, getter not resumed) when the abort is read → the item is dropped and never runs.
- R5: B's live lease, then A's abort, then B's `jog_change` with starts → the start half refused, B told `reason: "abort_other"`; and the same with B's `jog_change` QUEUED behind a blocked handler before the abort (kept as a stop: its stop half written, its start half refused).
- R6: no await between the drain and `_preempt_inflight` (a victim socket whose send blocks does not delay the abort's write — a stalled fake socket).
- R8: A queues `abort` behind a blocked handler and disconnects → the abort is written.
- E-Stop variant of each (Q-C2).

### 9.1 Mutations the guards must turn red
M1 `bannerShowAbort` back on the slot (`v-if`); M2 `.bannerActions { flex-shrink: 0 }` back + abort inside it; M3 `abort` back into `BACKEND_ONLY_GATES`; M4 the not-connected hint removed (message only); M5 `stripVis('jog')` false under a text helper; M6 `.strip { overflow-x: scroll }` (Jog scrolls again); M7 the Stop column `v-if` removed; M8 `data-dialog-reachable` off the jog Stop; M9 the other-client drain removed; M10 the drain after an `await` (yield before preempt); M11 other clients' replies awaited in the reader; M12 other clients' leases not ended; M13 queued stops dropped at disconnect; M14 the drain also drops `jog_stop`/`arm`; M15 the abort sent twice per gesture (keydown + click); M16 `.strip { overflow: hidden }` instead of `clip` (a focus scrolls the head away — measured at TWP/9 axes 1000 px); M17 the G0/G1 choice read from the overflow state instead of base widths; M18 the fold (G1 or H2) applied under a held press; M19 the window without the strip's right padding (XYZ 1920 overflows 8 px — measured); M20 the Abort's button inside `.bannerActions` again — red only in a CONSTRUCTED overflow case (actions forced wider than the banner minus the slot): no measured state overflowed (widest action set 394 px, ≥ 103 px of text left at 667 px).

## 10. Native cases (VM sim — owed; never on the operator's machine without his go)
Fixture: `lcnc_suite_sim_3axis_xyz.ini` (+ the TWP INI for N6), the start state named, restored afterwards; the controller state read (STAT), never just `ok`; a positive stop proof (motion observed BEFORE the abort).
- N1 AUTO run → Abort: interp IDLE, motion stopped, `exec_state` done; the program does not resume.
- N2 MDI `G1` long move → Abort.
- N3 continuous jog (teleop and joint jog before homing) → Abort: velocity 0; versus the jog Stop: the spindle (MANUAL, `WEBUI_SPINDLE_BEFORE_HOMING`) keeps turning.
- N4 spindle in MANUAL + flood/mist on → Abort: spindle off; coolant state READ (on_abort M9 vs. `emcIoAbort`); the modal state after `on_abort` (G90, G40, M50 P1 — the feed override enabled, NOT 100 %).
- N5 homing in progress → Abort: homing cancelled, joint not homed.
- N6 TWP INI: `on_abort_twp` keeps the plane, the WCS index restored.
- N7 Abort at rest: what changes (interp reset, modal codes per on_abort; the loaded program stays loaded in the suite).
- N8 two clients: B's queued MDI behind a slow handler, A's Abort → B's MDI never reaches the interpreter (STAT `echo_serial_number` / interp state), B's reply as specified.
- N9 tool change pending (M6 dialog), probe and run from line → Abort: no continuation afterwards.

## 11. Measurements (prototype `proto/abort-render`, mock gateway, `abort-proto.spec.ts`)
All tables, every row: `~/claude-work/abort/runs/tables.md` (from `proto/analyse.py`); raw JSONL per run under `~/claude-work/abort/runs/<run>/`. The prototype is commit `dd394007` on the scratch branch `proto/abort-render` (local, never pushed; built with `vite build` only — not type-checked). Runs: `today-z100` (dbd14cab as is: the red baseline), `proto-z100-v1` (the first prototype — superseded, kept for the record), `proto-z100` (prototype v2, Chromium touch: strip, jog states, banner, held, dialog, page renders, 29 of 48 helper cases — the step was stopped to free the lock for a Codex review), `proto-z100b` (the G1 narrow form and all helper cases), `proto-z150` (Chromium, real 150 %), `ff-proto-z100`, `ff-proto-z150` (the pinned Firefox 160, mouse/keyboard). The prototype stamps `data-proto="abort-v1"`; every test asserts the served build matches its variant. "Whole" = 13 hit points (3 × 3 at the quarters + 4 edge midpoints 2 px in), each topmost on the control, a child or its own `.btnTip`.

### 11.1 Strip, Safety + Jog fixed (Chromium touch, 100 %, prototype v2)
Per case 47 samples: 25 even scroll positions, 12 frames of a smooth scroll, 6 wheel steps, 4 keyboard-focus scrolls. Window = the scroll window's client size (its own 8 px start and end padding included).
| Axes (Jog / Setup width) | 1920 | 1600 | 1280 | 1000 | 1080 × 1920 | 900 × 1200 |
|---|---|---|---|---|---|---|
| XYZ (523.5 / 360) | 1082 (no overflow) | 762 | 442 | **162** | h 913 | **h 157** |
| XZ, Z (344 with the Stop column / 360, 328) | 1261 | 941 | 621 | 341 | h 1111 | h 355 |
| XYZAC (662.5 / 456) | 943 | 623 | **303** | **23** | h 805 | **h 49** |
| TWP (735.5 / 544) | 870 | **550** | **230** | **16** | h 783 | **h 27** |
| 9 axes (859.5 / 574) | 746 | **426** | **106** | **16** | h 745 | **h 8** |
Width (landscape) or height (portrait) in CSS px; **bold** = Setup does not fit whole → G1 by the rule of §5.2. Safety 280 px wide (landscape), 269 px high (portrait).
- jog Stop whole: **47/47 in all 36 cases**. Today: XZ and Z have no Stop (47/47 bad); every other overflowing case loses it for 11–31 samples mid-scroll (`today-z100`).
- Safety and Jog one rect over all samples, and the outer strip never scrolled (`scrollLeft`/`scrollTop` 0): **all 36 cases**. (Prototype v1 with `overflow: hidden` failed this at TWP/9 axes 1000 px: a focus scrolled the head 77 px / 217 px.)
- XYZ at 1920 vs today (the operator's machine): Safety, Jog, Overrides, Spindle, Tool rect-identical; Setup's divider moved to the window (its content at the same place); **no overflow** (v1: 8 px).
- Portrait: no sideways run (v1: 4 px).
- "Last control after a keyboard focus" fails in some wide cases in BOTH variants (today and prototype: XYZAC 1920 Tool, 9 axes 1920 Overrides, XZ 1600 Tool …) — a harness limit (programmatic `focus()` on a roving-focus option / a redirected control), not a prototype effect; the build's guard reaches the controls by Tab (R413 contract). In the bold (narrow) cases they fail because the window is narrower than the control.

### 11.2 Banner (Chromium touch, 100 %, prototype v2: HelpIcon in the slot, 44 px touch floor)
States: rest, running, message while running, paused, disarmed, trip (+3 messages), all actions (Load program + Home All + 16 messages + Refresh), connected but no status (every status frame withheld — 5 dropped), disconnected (socket refused, page reloaded).
"Live" = rendered ENABLED (not pressed — a press without a status or while disconnected is owed, §11.9).

| Window | Abort rect (x, y, w, h) | present / live / whole | one rect | actions max width | text min width |
|---|---|---|---|---|---|
| 1920 × 1080 | 1820, 56, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 (all actions) | 1356 |
| 1600 × 900 | 1500, 56, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 | 1036 |
| 1280 × 800 | 1180, 56, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 | 716 |
| 1000 × 800 | 900, 92, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 | 436 |
| 1080 × 1920 | 980, 56, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 | 516 |
| 900 × 1200 | 800, 92, 78, 44 | 9/9 · 9/9 · 9/9 | yes | 394 | 336 |
The banner is 52 px high in every state (v1: 44 px, the Abort 78 × 36). Acknowledge and the message count whole wherever shown. Today the Abort is absent in 6 of the 9 states (rest, disarmed, trip, all actions, no status, disconnected). At 1000 and 900 px the banner starts at y = 92 instead of 56 — something above it is taller there (not measured); within each window the Abort keeps one rect over all nine states.

### 11.3 Jog's box per machine state
One box per axis set over homed, unhomed, joint jog before homing, TCP, Plane, Plane stale (XYZ, XZ, XYZAC, TWP, 9 axes; 1280 and 1080 × 1920) — today and in the prototype: the window's origin never moves with the state.

### 11.4 Helpers (1920 / 1280 / 1000 / 1080 × 1920; XYZ, TWP, 9 axes — `proto-z100b`)
| Rule | Text keyboard (475 px) | Number keypad beside Setup (319 + Setup) | Stop |
|---|---|---|---|
| H1 Jog stays whole | whole at 1920 and in portrait; CUT at 1280 and 1000 in every set (windows 442 / 230 / 106 / 162 / 16 px) | whole only for XYZ at 1920 and in portrait; at TWP / 9 axes 1000 the Setup field could not even be pressed (90 s timeout: a 16 px window) | whole |
| H2 Jog folds to its Stop (69 px) | whole everywhere (windows 1536 / 896 / 616 px) | whole at 1920 and 1280 for XYZ and TWP; cut at XYZ 1000 and 9 axes 1280 (Setup + 319 px exceed the window — the owner + keypad pair, not the fold); TWP / 9 axes at 1000: not measured (the field could not be pressed in G0 — in G1 it can) | whole |
Portrait: both helpers whole under both rules (the window is a 268 px column). No H0 (today) baseline was measured for the helpers.

### 11.5 Held presses and the dialog scope
- The banner Abort held (mouse) while the banner went paused → trip → all actions → rest → running: the rect never moved; ONE `abort` reached the mock at the release.
- The jog Stop held while the window scrolled 4 × 150 px: its rect never moved.
- With the Tools "New" dialog open, the banner Abort and the jog Stop are whole (13 points). Tab × 80 from inside the dialog reached: the dialog, Safety's controls, the banner **Abort** and the jog **Stop** — no jog start, nothing else of the strip. Today, AT REST: the dialog and Safety only — while a program runs today's banner Abort is already in the scope (`data-dialog-reachable`, `App.vue:2347`); the new parts are the Abort at rest and the jog Stop.

### 11.6 Narrow form G1 (`proto-z100b`, Chromium touch, 100 %; G1 forced in 30 cases)
Head = Safety + Jog folded to its Stop column (landscape 69 × 264 px; portrait 262 × 87.5 px incl. the "Jog" heading — there the Stop is one grid cell, 60 px wide: the build lets it span the column). Window = Jog's whole block first, then Setup …; 31 samples per case (25 positions, 6 wheel steps).
| | 1600 | 1280 | 1000 | 1080 × 1920 | 900 × 1200 |
|---|---|---|---|---|---|
| Window (all sets) | 1216 | 896 | 616 | h 1416 | h 660 |
- The head's Stop whole **31/31 in all 30 cases**; Safety and the head one rect; the outer strip never scrolled.
- The window's Jog is Jog's own block (its width minus the divider: XYZ 514.5 … 9 axes 850.5 px); its pad Stop is a second face of the same action when on screen.
- "Last control after focus" fails in 6 cases — the same harness class as §11.1 (e.g. XYZAC 1000: the window's Jog, 653.5 px, is wider than the 616 px window).
- Seen in the renders: the head and the window both carry the heading "Jog" — the build names the head's column "Stop" or drops the window block's heading (a wording choice, **Q-O9**).
- 150 %: §11.7; Firefox: §11.8.

### 11.7 150 % (Chromium, viewport ÷ 1.5 with `deviceScaleFactor: 1.5` — the page reports `devicePixelRatio` 1.5 and `innerWidth` 1280 / 853 / 667 / 720)
- **Banner:** the Abort present, live, whole and at ONE rect in all 9 states at 1280 × 720, 853 × 533, 667 × 533 and 720 × 1280 CSS px (x = 1180 / 753 / 567 / 620, 78 × 44). The text is the part that yields: at 667 px it keeps 103 px beside the widest action set (394 px) — the Abort and the actions stay whole.
- **Strip G0:** the jog Stop whole 47/47 and Safety/Jog fixed in all 16 cases; windows XYZ / XYZAC / TWP / 9 axes = 442 / 303 / 230 / 106 px at 1920·150 %, **16 px** at 1280·150 % and 1000·150 %, portrait 720 × 1280 **h 237 / 129 / 107 / 69** — by the rule every case but XYZ 1920·150 % is G1.
- **Strip G1:** the head's Stop whole 31/31, head fixed, every section reachable in all 12 cases; windows 469 (853 px), 283 (667 px), h 740 (portrait).
- **The floor:** below about 760 CSS px (Safety 280 + Stop column 69 + Setup 360 + paddings/gaps) even G1 cannot show Setup whole — the window still scrolls, Safety and the Stop stay whole. That is the stated limit of "fixed", not a promise for any window (Codex R453 §3).

### 11.8 Firefox 160 (pinned, BiDi, mouse/keyboard — no touch)
- **Strip G0** (`ff-proto-z100`, XYZ / XZ / TWP / 9 axes at 1280, 1000 and 900 × 1200; `ff-proto-z150`): the jog Stop whole 47/47 and Safety/Jog fixed in every case that ran (13); Firefox's Jog is 1–7 px narrower (XYZ 521.8, TWP 726.3, 9 axes 853.3) — the G0/G1 rule reads the base widths of the running browser, never a constant. Not measured: TWP and 9 axes at 1000 and TWP at 1280 · 150 % — the harness's wheel position fell outside a 16 px window ("move target out of bounds"), a harness limit in exactly the cases the rule sends to G1.
- **Strip G1:** the head's Stop whole 31/31, head fixed, in all 16 cases (100 % and 150 %).
- **Banner:** the Abort present, live, whole, one rect in all 9 states at 1280, 1000, 900 × 1200, 853 × 533 and 720 × 1280 (76.1 × 32 px — desktop density; the 44 px floor applies on touch only).
- **Held press** (mouse): the Abort's rect constant through five banner states, ONE `abort` at the release; the jog Stop constant through window scrolls. **Dialog:** Abort and Stop whole under the dialog; Tab reaches the banner Abort and the jog Stop, no jog start.
- `deviceScaleFactor: 1.5` was honoured through BiDi (the 150 % runs report the scaled viewport).

### 11.9 What R453 demanded — measured, owed, not prototyped
| R453 item | State |
|---|---|
| Axis sets XYZ, XYZAC, TWP, 9 axes, XZ, Z | measured (Chromium touch, 100 %) |
| Windows 1920/1600/1280/1000, 1080 × 1920, 900 × 1200 | measured at 100 % and (four windows) at 150 % (§11.7) |
| Chromium AND Firefox at the narrow places | measured in both (§11.8); three Firefox G0 cases not reached (harness) |
| Stop whole at every position, during smooth scroll, wheel, focus scroll | measured |
| Drag and scrollbar scrolling | NOT measured (the drag path is `dragScroll.ts`; owed in the build's guard) |
| Safety/Jog budget incl. gaps, the remaining window, portrait heights | measured (§11.1) |
| Desktop vs touch | touch in Chromium, desktop (mouse/keyboard) in Firefox — measured |
| Before/after homing, TWP frame states, joint jog | measured for Jog's box (§11.3) |
| Open number / text helpers | measured (H1, H2; §11.4) — no H0 baseline on today's build |
| Every transition of the chosen forms just before/after | NOT measured: G0/G1 is a manual toggle in the prototype (`window.__narrowFold`); the base-width rule and its ±1 px cases are owed in the build |
| Banner: first status pending, disconnected, disarmed, sim, idle, running, paused, trip, long text, many messages, Refresh | measured except sim mode, tool change, probe/scan/macro running (owed) |
| A held Abort while the banner changes | measured with the MOUSE; touch long press, contextmenu, a second pointer and keyboard Enter/Space on the slot owed |
| Covers: MoreMenu, HelpIcon popover (the slot's own "?" included), btnHint, stacked dialogs, the tool-change flow | one dialog measured (Abort whole, Tab scope); the rest owed |
| A PRESS of the Abort before the first status and while disconnected (R453 §2: the send path, not only the enabled button) | NOT measured — the prototype showed the button enabled; the send and the hint at the control are owed |
| The slot itself vs. a forced action overflow (red-first) | NOT measured (no measured state overflowed) |
| The disconnected press answering at the control | NOT prototyped (only the plan, §3.4) |
| Native proof of the stop effect | owed (§10), no live run in this round |

## 11a. Project rules the build must carry
- Motion buttons: `scripts/twp_buttons_check.py` is the acceptance gate for any change touching a motion button — the Stop column and the fold are one (CLAUDE.md "Motion buttons").
- Docs to update with the build: CLAUDE.md (frontend modules: `SafetyStrip`/`JogStrip`/the strip, `modalRegistry` scope, `permissions.ts` STOP gates; Safety layers: the supersede now crosses clients), `docs/architecture/frontend-modules.md`, `ui-patterns.md` (nothing moves under a press: the fold), `safety-and-permissions.md` (abort gate, Q453-1 contract), `docs/decisions.md` (the decisions of §5/§6).
- Existing specs that treat `.strip` as THE scroller (layout/strip specs: `layout.spec`, `strip-fit.spec`, `strip-actions.spec`, `safety-during-edit.spec`, `layout-audit.ts` `sidewaysOverflow`, `e2e/layout-fixtures.ts`) move to `.stripScroll`; their red-first proof is part of the build.
- New sources and specs get their `scripts/test_select/rules.py` rules and `READ_SITES`; the new control (Stop column) and the slot's HelpIcon their `controlInventory.ts` rows and inventory claims (`scripts/inventory/`).
- The page's `jogLease.ts` (`onLeaseExpiredFrame`) maps `reason: "abort_other"` to its own words at the control ("Jog stopped by an abort on another screen"); today a reason ends the gesture silently.
- The mock gateway (`e2e/mock-gateway.mjs`) learns the lease frame `jog_lease_expired` with `reason: "abort_other"` and an op that withholds status frames (the prototype filtered them in the page instead).
- `npm run build` (vue-tsc -b) and the round gate (`scripts/test_select/round_gate.py`) as usual; the prototype was built with `vite build` only — NOT type-checked.

## 12. Open questions
### For Codex
- **Q-C1 (drop set and the R4 branch).** Other clients' queued commands: the same set as the sender's own supersede (all but stops and `arm`, recommended) or motion-starting only (a new class every command must join)? And is R4's first branch acceptable — a command READ after the arrival but written before the abort's write is ended by the abort — or must a barrier hold every non-stop write until the abort is written (a new wait on every worker)?
- **Q-C2 (E-Stop).** Does `estop` take the same `_stop_arrival` (other clients' queues dropped, every lease ended)? Recommended: yes, one function for `_WS_PREEMPT_CMDS`.
- **Q-C3 (stage B clauses).** Are F2/F3 (pinned Overrides/Spindle) and the per-form scroll-padding void with the window construction (§5.5), or do you require a pinned right group as a second window now?
- **Q-C4 (shortcut behind a dialog).** Backspace (Abort) stays refused behind a dialog/helper (a dialog's fields own Backspace); the banner Abort and the jog Stop are in the Tab scope. Agree?
- **Q-C5 (G1).** The narrow form folds Jog to its Stop column in the head and puts Jog's whole block first in the window, keyed on "Setup whole beside Safety + Jog" (base widths). Is that the division change R453 §3 asks for, including a second visible face of the jog Stop when the window shows the pad?
- **Q-C6 (H2).** Jog folds to its Stop while a helper is open (the measured alternative H1 cuts both helpers at 1280). The Stop moves from the pad centre to the column when the fold happens — only under the held layout (no press). Agree?
- **Q-C7 (R8).** Queued STOP-class commands of a closing connection are written by a detached task instead of dropped (`gateway.py:15631–15641`). Agree, or is the armed disconnect's jog stop enough?
- **Q-C8 (harness).** "Real 150 %" measured as CSS viewport ÷ 1.5 with `deviceScaleFactor: 1.5` (what a browser zoom does to layout and media queries) — accepted? (Firefox through BiDi honoured it: `devicePixelRatio` 1.5, §11.8.)
- **Q-C11 (start contract).** Deltas on R504 (§6.6): S1 an abort/E-Stop arrival voids every connection's open start ask (in `_stop_arrival`); S3 the owning page is told (`start_ask_voided`) and closes its dialog as row 1 with "Aborted — press Start again"; S2 needs no contract change (today's cancel path + v3 `seq_id` on every phase), only guards. Agree?
- **Q-C10 (touch height).** The banner Abort is 78 × 36 px on touch (§3.1). Give the slot the 44 px touch floor (banner 44 → 52 px in every state), or keep 36 px for a stop that is also on the keyboard/gamepad and in every tab head?
- **Q-C9 (found).** Before the first status the banner reads "MACHINE OFF" (`machineState` from an empty status, `App.vue:189–197`): fix in this package ("Waiting for the machine's status") or separately?

### For the operator (German on the page)
- **Q-O1** Narrow windows: Jog folds to its Stop column and leads the scroll window (G1) whenever Setup would not fit whole beside Safety + Jog — measured: 3 axes (also XZ, Z) from 1000 px down; 5 axes from 1280 down; TWP (6) and 9 axes from 1600 down; portrait 900 × 1200 for every set with an XY pad, 1080 × 1920 never. OK?
- **Q-O2** While the keyboard or keypad is open, Jog shows only its Stop (H2). OK?
- **Q-O3** Q453-1 detail: other screens lose only queued MOTION, or everything still queued there (reads, saves) except stops? Recommendation: everything but stops — what the own screen already does today.
- **Q-O4** Backspace inside a dialog stays text editing; Abort there by button/Tab. OK?
- **Q-O5** May I read the machine INI (read-only) for `ON_ABORT_COMMAND` before the help text is final?
- **Q-O6** Help text: "Stops the program or MDI, every jog, homing and the spindle. Power stays on — not an E-Stop." OK?
- **Q-O8** The banner Abort is 36 px high on the panel (the strip's buttons are larger). Make the banner 8 px taller so the Abort gets the full touch height?
- **Q-O9** In the narrow form the folded column and Jog's block in the window would both be headed "Jog". Head the column "Stop"?
- **Q-O10** An open start dialog — on this screen or another — closes on an Abort with "Aborted — press Start again"; starting again needs a new press (S1/S3, §6.6). OK?
- **Q-O7** (found) A machine with X and Z but no Y has no X jog buttons today (only the Z column). Fix together with the Stop column, or separately?

## 13. Order of work (after approval)
1. Gateway Q453-1 (§6) with its tests and mutations — independent of the UI.
2. Banner slot + client gate + delivery hints (§3, §4).
3. Strip construction (§5): the window, the Stop column, H2 and G1 with their guards (G1 is not optional: TWP at 1280 leaves 222 px, 9 axes 98 px, portrait 900 × 1200 35–165 px).
4. Native cases N1–N9 on the VM sim.

## 14. Checks and tools (all under `~/claude-work/abort/proto/`)
- `check_citations.py` prints every `file:line` cited here from `git show dbd14cab:<file>` (upstream LinuxCNC from `~/claude-work/bg/upstream-2.9.4/`): 90 citations, 0 unresolved.
- `count_texts.py` counts §7 against 60 / 120: all within.
- `analyse.py` → `runs/tables.md`; `numbers.py` → `runs/page-numbers.json`; `../page/build.py` → `page/index.html` + `render/*.png`.
- `run2.sh` runs the measurement steps inside ONE heavy-lock hold and stops before the next step when the Codex review flag appears; a step counts as done only when Playwright reported its tests.

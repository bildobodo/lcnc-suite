# F-G5X step 1 — protecting the coordinate basis: plan v1

**Status:** plan for Codex. No build, no browser or native run in this round.
**Base:** development `dbd14cab`. Every `file:line` is read from `git show dbd14cab:<file>`; LinuxCNC 2.9.4 upstream from the local copy `~/claude-work/bg/upstream-2.9.4/` (check: `~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v1.md`).
**Sources:** R507 (request and Codex's answer, end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `a19c49af`, evidence `maschinentag.r507.codex-*`); the start agent's runs `~/claude-work/start/step0/runs/20261126T112706-step0c`, `…114857-p1p3`, `…115523-p2` (drivers `p1p3_native.py`, `p2_native.py`).
**Order:** lands BEFORE the central Abort merges; the start-message merge waits for this rule (R507 MT507-01).

**Scope (R507 MT507-02):**
- **In scope (protection):** a provenance rule for the coordinate inputs, ONE gateway function for it, targeted write refusals, the doubt in the display, and the named reconfirming read.
- **Not in scope:** the automatic recovery of the controller STATUS (an M2 program, an MDI fixture toggle, an interpreter reset). That is step 2, measured by the start agent; step 1 does not wait for it.

---

## 1. What is broken today (dbd14cab)

### 1.1 The controller side (LinuxCNC 2.9.4)
- **The four coordinate messages are queued.** G5x origin, XY rotation, G92/G52 and tool length offset reach the controller as messages appended to `interp_list` "so it gets updated at the right time, not at read-ahead time":
  - `send_g5x_msg`, `send_g92_msg`: `src/emc/task/emccanon.cc:436–469`;
  - `SET_XY_ROTATION`: `:472`;
  - `USE_TOOL_LENGTH_OFFSET`: `:2018–2040`.

  Task copies them into the status only when it EXECUTES them (`emctaskmain.cc:1887–1907`).
- **A drop clears the queue.** `emcTaskAbort` clears `interp_list` (`emctask.cc:225–262`). It is reached from:
  - a task abort (`emctaskmain.cc:2108–2121`);
  - a mode switch to MDI or AUTO (`emctask.cc:284–297`);
  - machine off, E-Stop and E-Stop reset (`emctask.cc:318–362`);
  - leaving the ON state (`:690–698`);
  - interpreter, exec and motion/IO errors (`emctaskmain.cc:2264–2272`, `:2564–2588`, `:3494–3517`);
  - an aux E-Stop (`:3410–3416`).

  **Any** of these, while read-ahead messages are still queued, leaves the status on the old values while the interpreter (and the motion it plans) uses the new ones.
- **M2 / M30.** `convert_stop` resets the origin to G54 from `#5221…#5230` and sends `SET_G5X` and `SET_XY_ROTATION` (`interp_convert.cc:4557–4640`). It clears G92/G52 only with `DISABLE_G92_PERSISTENCE` and sends no G92 message (`:4683–4686`). It leaves the TLO alone.
- **G52** shares the G92 storage (`interp_convert.cc:1080–1100`). G92 and G52 are therefore ONE input here.
- **The parameter file** holds `#5210–#5219` (G92/G52 enable and offsets), `#5220` (the active index) and `#5221–#5390` (nine rows, rotation at `base+10`) — the installed sim `sim.var`. It holds no TLO. `Interp::synch` writes it (`rs274ngc_pre.cc:2010–2062`).

### 1.2 The gateway side
- **The active index** is the status's `g5x_index` (`lcnc-gateway/status_runtime.py:1064`).
- **The row cache** (`_wcs_cache`, `lcnc-gateway/gateway.py:2980`; `status_runtime.py:670–674`):
  - every var-file mtime change reseeds all nine rows (`status_runtime.py:1069–1089`, `seed_wcs_cache` `:896–916`);
  - then the status's ACTIVE row OVERWRITES its row with the status's `g5x_offset` and `rotation_xy` (`:1090–1095`).

  The comment says it itself: the path never sees "an interpreter-side G10 to an inactive slot" (`:1069–1081`).
- **The DRO / HUD work position** is `machine − g5x − tool_offset`, rotated, `− g92`, all from the status (`status_runtime.py:1136–1200`).
- **Touch-off / Zero** writes `G10 L20 P<p>` with `p` = the status's `g5x_index`:
  - the pre-check runs on the snapshot (`gateway.py:10112–10170`);
  - the last check re-reads the status (`_controller_touchoff_state`, `gateway.py:11692–11717`; used at `:10171–10196`);
  - `p` is taken at `:10228` and written by `G10 L20 P<p>` at `:10242`;
  - afterwards it adopts the status's `g5x_offset` into row `p` (`:10256–10263`).

  **R507 measured** `index: 2` written while `#5220` = 1 (`p1p3` run).
- **`set_wcs` / `clear_wcs`** name their row (`G10 L2 P<n>`, absolute values) and update the cache from the request (`gateway.py:10395–10450`, `:10066–10111`). Neither checks the MDI's rc.
- **The strip's WCS choice** is a plain MDI of the G-code word (`lcnc-webui/src/useTouchoffMath.ts:80–81`), run by the MDI handler (`gateway.py:8863`).
- **The idle re-parse** takes the index from the status (`lcnc-gateway/bulk_pipeline.py:984`, ctx `:992`) and the rows from `_wcs_cache` (`_build_wcs_rotation_patches`, `gateway.py:12117–12157`).
- **The start check** compares the publication with the same two sources (`bulk_pipeline.py:659–662`, `:690`). Equal derivations of a stale table prove nothing (R507 MT507-01).
- **The page** reads the same status:
  - the strip's fixture label `fixtureLabel(st.g5x_index)` (`lcnc-webui/src/App.vue:1116`);
  - the Offsets active row `row.name === g5xLabel` (`lcnc-webui/src/OffsetPanel.vue:204`);
  - the HUD work coordinates (`lcnc-webui/src/ThreeViewer.vue:6184`).

### 1.3 Measured (R507, Codex's re-read)
- **P2 (`20261126T115523-p2`, seq[8..9]):** `#5220` = 1, `gcodes` 540, status index 2.
  - Publication 1795690547, then `run_id 2` verified.
  - The machine at X10/Y10 (G54) while the display computed G55.
- **`20261126T114857-p1p3`, seq[28], after `set_wcs G54`:**
  - the codes agree (`gcodes` 540, index 1, TLO-Z 0, rotation 0);
  - yet the G55 row shows X50 while the interpreter's `#5241` = 2.861907 (the earlier touch-off).
  - Equal codes repaired nothing.
- **Not measured:**
  - an abort after the first move, a long program, E-Stop / machine off / interpreter error mid-run;
  - the inactive G10 path with a program that selects that row;
  - the source of the G92 value (R507: "ungeklärt").

---

## 2. The provenance rule (task 1)

### 2.1 Inputs, each with its own state
| Input | Values | Today's source |
|---|---|---|
| `index` | the active system 1…9 | status `g5x_index` |
| `row[n]`, n = 1…9 | nine axes + rotation | var file, then overwritten by the status for the active row |
| `axis_offset` | G92/G52 enable + nine axes | status `g92_offset` |
| `tlo` | the nine-axis tool length offset vector | status `tool_offset` |

Each input has ONE state:
- `CONFIRMED(source, epoch)`;
- `UNCONFIRMED(reason, since)`;
- `INCONSISTENT(reason)` — a named read showed the status and the interpreter disagree.

The state is the gateway's knowledge, never an event name. "Abort" appears nowhere in the rule: an abort is one of many ways to leave a session undisturbed-unproven.

### 2.2 What makes an input UNCONFIRMED — state-based

**The basis-affecting transitions (BAT):**

- **B1 — a SESSION ended without a proof of an undisturbed end.**
  - A session is the interpreter out of IDLE (an AUTO run, an MDI, a remap, a macro, a probe or toolsetter job — any source) until it is IDLE again with execution done.
  - It ended UNDISTURBED only if the gateway's poller saw, over the whole session, every one of:
    - the task state ON at every poll;
    - every `echo_serial_number` seen belongs to the session's own starting command or to a gateway command of the NON-DROPPING class (§2.4);
    - the final RCS state DONE — never ERROR, and never a later command's DONE (today's `controller_done` "done" accepts `echo ≥ serial`, `lcnc-gateway/gateway_util.py:6672–6727`; here the session needs its OWN `echo == serial` or a non-dropping successor);
    - no error-channel error during the session;
    - no poll gap longer than `_SESSION_GAP_S` (1 s);
    - the same Link (no relink).

    Anything else — an abort from any client or GUI, an E-Stop through HAL, machine off, an interpreter error, a mode switch while non-idle, a gap, a relink, a session the gateway did not start — is DISTURBED, so B1.
  - **B1 makes `index`, every `row[n]`, `axis_offset` and `tlo` UNCONFIRMED.** Rows are included because the active row's cache value comes from the stale status (`status_runtime.py:1090–1095`), and the reseed that may have followed cannot be proven to be the interpreter's own write.
- **B2 — an UNDISTURBED session that may have written rows the status never shows.**
  - It runs no SET_G5X for an inactive row: a G10 L1/L2/L10/L11/L20 to a row, read into the interpreter's parameters, is invisible to the status (`status_runtime.py:1069–1081`).
  - The rows it may have written:
    - an AUTO program: from the parse's record of its coordinate writes (`lcnc-gateway/gcode_canon.py:98`, `:324`; `lcnc-gateway/gcode_parse_worker.py:454`, `:568`) — a named P row exactly, `P0` the active row, anything opaque (an o-call, a remap, an untracked write) ALL rows;
    - a gateway MDI: from a scan of its text with the same tokenizer;
    - a macro, probe or toolsetter job: the routine's text when the gateway can name it, else ALL rows.
  - Those rows become UNCONFIRMED.
  - `index`, `axis_offset` and `tlo` stay as they are: an undisturbed session executed every message, so the status shows what the interpreter has.
- **B3 — a FOREIGN command.** An `echo_serial_number` not written by the gateway, seen while idle (a fast foreign MDI can complete between two polls). The gateway records every write's serial in `_cmd_blocking` (`gateway.py:5391` already reads `conn.cmd.serial` for claims; it extends to every write). B3 makes every input UNCONFIRMED. Conservative; the noise it causes is Q-C2.
- **B4 — a gateway coordinate write whose effect is not proven.**
  - an rc other than DONE — `set_wcs` / `clear_wcs` / `touchoff` today do not check it;
  - an interpreter-computed value (`G10 L20 / L10 / L11`) not read back.

  B4 makes the target row UNCONFIRMED (§2.3 R-OWN-ROW).
- **B5 — the gateway's start, and every relink.** Every input is UNCONFIRMED ("not read since the gateway connected"), unless R-FRESH (§2.3) holds.

**NOT a reconciliation:** a new status, an equal G-code (`gcodes` 540 = index 1 — R507 seq[28]), an equal parse hash, equal derivations of the cache (`bulk_pipeline.py:659–662`), a finished collision check, a var-file reseed by mtime (another writer may have made it), a gateway restart, an unchecked start consent.

**Unknown is conservative.** A field unread, a session not observed from its start, a routine that cannot be named — each takes the UNCONFIRMED branch.

### 2.3 The NAMED reconciliations that confirm again

- **R-READ — the confirmed parameter read.**
  - **The read:** `task_plan_synch` RCS_DONE, plus a NEW INODE, plus ONE fstat snapshot. This is today's G30 mechanism (`_g30_synch_read`, `gateway.py:14147–14174`; `_synch_interp_params` `:14090–14111`; `read_var_snapshot` `lcnc-gateway/gateway_util.py:6200–6219`), applied to `#5210–#5219`, `#5220`, `#5221–#5390`.
  - **It confirms** the INTERPRETER's `index` (#5220), every `row[n]` and `axis_offset` as the interpreter holds them.
  - **The status compared with them** (1e-6; index exact): STAT `g5x_index` vs #5220; `g5x_offset` and `rotation_xy` vs that row; `g92_offset` vs #5211….
    - Equal → those inputs CONFIRMED (source `read`, the inode).
    - Unequal → INCONSISTENT: the interpreter values are known, the status lags. That needs step 2, or R-END.
  - **TLO is not in the file.** R-READ leaves `tlo` as it is.
  - **Side effects (named):**
    - `Interp::synch` writes the parameter file (`.new`, `.bak` link, rename);
    - the interpreter re-reads its external state (`rs274ngc_pre.cc:2010–2062`);
    - the gateway's poller then reseeds the cache from that file;
    - in AUTO with the machine ON it is refused (`gateway.py:14104–14110`): nothing is sent and nothing confirmed.
  - Under `_cmd_lock` then `_var_file_lock`, as G30.
- **R-OWN-ROW — the gateway's own named write, proven.**
  - `set_wcs` / `clear_wcs` (`G10 L2 P<n>`, absolute values) with its OWN RCS_DONE (`controller_done` with `echo == serial`) and no B1 during it → the WRITTEN axes of `row[n]` CONFIRMED with the written values; unwritten axes keep their state.
  - A touch-off's `G10 L20 P<p>` to the CONFIRMED active row `p`: the interpreter sends `SET_G5X(p)`; the status read back after its own DONE (today `lcnc-gateway/gateway.py:10256–10263`) → `row[p]` CONFIRMED, and `index` stays CONFIRMED.
- **R-TLO — an executed tool-length word, proven.** An undisturbed session that EXECUTED a TLO message: an own MDI containing `G43`/`G43.1`/`G43.2`/`G49` (scan), the tool-change flow's G43, or an AUTO program whose parse has a TLO event (the per-segment `tlo_events`). Afterwards the status's `tool_offset` is the executed value → `tlo` CONFIRMED. No read exists for TLO in step 1 (Q-C6).
- **R-END (candidate, NATIVE proof owed).**
  - An undisturbed AUTO run that ended at an executed M2/M30. `convert_stop`'s `SET_G5X(1)` and rotation executed, so the status shows the interpreter's G54.
  - It confirms `index` = 1, the written row G54 and its rotation.
  - Not `axis_offset` (no G92 message) and not `tlo` (untouched).
- **R-FRESH (candidate, NATIVE proof owed).** The first sight of a LinuxCNC instance (session binding) with `echo_serial_number` 0 and the interpreter idle: no command ever ran, the plan-init state is consistent. It confirms every input from the var-file seed.

### 2.4 The command classes
- **Non-dropping** (no `interp_list.clear()` in their task path): `cycle_pause`, `cycle_resume`, `auto_step`, the overrides, spindle, coolant, jog (teleop / joint), `jog_stop`.
- **Dropping:** `abort`, every `state` write (E-Stop, off, reset), `mode` (MDI / AUTO run `emcTaskAbort`, `emctask.cc:284–297`), `reset_interpreter`.
- **Unknown:** everything else.

A dropping command while the interpreter is IDLE after an undisturbed end drops nothing: the queue is empty (task's DONE needs every queue empty, `lcnc-gateway/gateway_util.py:6680`). It is no BAT. The same command during a session makes the session disturbed. That is the state-based form of "a drop with queued messages".

### 2.5 ONE gateway function

```python
coordinate_basis_reason(need: BasisNeed, stat=None) -> Optional[str]
```

- **Order:**
  1. the start agent's live contradiction term (af48, `feat/start-ask`: the active G5x code in the status `gcodes` ≠ `g5x_index`; G49 against the FULL TLO vector) — its own reason;
  2. then this ledger: the first input in `need` that is INCONSISTENT, then UNCONFIRMED.
- **Pure** over (`stat`, the ledger snapshot, `need`), with a ledger kept in a new module `coord_basis.py` (pure transitions, unit-tested). The gateway holds one ledger: `_coord_basis`. Writes to it happen on the loop thread (the poller's session tracker, the handlers' completions).
- **`BasisNeed`:**

| Need | Inputs |
|---|---|
| `START` (entry, record, write, RFL — the start contract's points) | `index`; every row the publication's parse SELECTS plus the active one (opaque → all); `axis_offset`; `tlo` |
| `TOUCHOFF(axes)` | `index`; `row[p]`; rotation of `row[p]` when X/Y is written; `axis_offset` for the written axes; `tlo` components of the written axes |
| `DISPLAY(axis)` | `index`; the active row's axis; rotation for X/Y; `axis_offset` and `tlo` for the axis |
| `ROW(n)` | `row[n]` |
| `PUBLICATION` | as `START`, for the snapshot the idle parse took |

- **The start verdict** — the start contract's three points and RFL — calls it with `START`. A reason means NOT VERIFIED, with its own why. An unchecked consent never turns it into `verified=true` and legitimates no old Clear (R507 MT507-01).

---

## 3. Targeted write refusals (task 2)

| Write | Rule |
|---|---|
| **Touch-off / Zero** (derived from "the active system") | Refused while `coordinate_basis_reason(TOUCHOFF(axes))` names a reason — checked at the PRE-CHECK (after `touchoff_expect_check`) AND at the LAST ADMISSION, after `set_mode(MDI)` and `_controller_touchoff_state`. When the ledger is only UNCONFIRMED (not INCONSISTENT), the last admission first runs **R-READ** itself (it is already in MDI, so the synch is admitted), then decides on the read: <br>• the target `p` = the interpreter's `#5220` from that read, which must equal the status's `g5x_index`, else INCONSISTENT and refused; <br>• the G10 line keeps its explicit `P<p>`; <br>• the write thread's `admit` re-polls and requires `g5x_index == p`. <br>Never `gcodes` for the index with the cache's offsets. An unchanged status target or a start consent authorises nothing. |
| **`set_wcs` / `clear_wcs`** (a named row, absolute values) | Admitted in every basis state: they depend on no active index. Effect: R-OWN-ROW on a proven DONE; B4 otherwise (the rc is now checked and named). |
| **General MDI** (typed, macro, routine) | NEVER refused for basis reasons — no MDI lock. Effect only: B1 / B2 / B4 by its scan. |
| **The strip's WCS choice** (MDI G5x) | Admitted. Confirms nothing (a same-system word sends no message — R507). |
| **Jog, the stops, overrides, spindle, coolant** | Untouched: no basis term. |
| **The idle re-parse** | Runs. Its publication carries `basis: {confirmed: false, reason}` when `coordinate_basis_reason(PUBLICATION)` names one at its snapshot; such a publication never yields a current Clear and never a verified start (`run_start_check` returns the reason first). Index and rows: while INCONSISTENT after an R-READ, the ctx takes the interpreter's `#5220` WITH the read's rows (both from the same read) — never `gcodes` plus the stale cache (Q-C5). |
| **Writes of the status's active row into the cache** (`lcnc-gateway/status_runtime.py:1090–1095`) | Only while `index` is CONFIRMED and the status agrees. While UNCONFIRMED or INCONSISTENT the status's offset is not written into a row. |

**Texts (≤ 60, counted):**
- `Controller coordinate state is inconsistent` — the start agent's term (R507 wording)
- `Work offsets not confirmed — read them in Offsets`
- `Offsets not read since the gateway started`
- `G56 written by MDI — read the offsets` (the row named)
- `Another program changed LinuxCNC — read the offsets`
- `G92/G52 offset not confirmed — read the offsets`
- `Tool length not confirmed — apply G43 or G49`
- `Touch-off refused — controller coordinates inconsistent`
- `Offsets not readable in AUTO — switch to MDI`

## 4. The display carries the doubt (task 3)

- **The status payload** gains `coord_basis`:

  ```
  {state: "confirmed"|"unconfirmed"|"inconsistent", reason,
   index: {value_stat, value_interp|null, state},
   rows: [{state, source}],
   axis_offset: {state}, tlo: {state},
   read: {at, inode}|null}
  ```

  It is built from the ledger in the poller, never from the page.
- **DRO / HUD.** The work coordinates of every affected axis carry a mark:
  - the value keeps its place;
  - a `hudWarn` line `Work position not confirmed` in `.hudNotes` (the viewer-warning pattern, not a chip);
  - the axis value in the muted role;
  - the MACHINE position stays plain and separate.
- **Offsets table.**
  - The active marker (`OffsetPanel.vue:204`) shows `Active fixture unclear` while `index` is not CONFIRMED.
  - After an R-READ with INCONSISTENT it shows the interpreter's row active, plus a note `Status says G55`.
  - Each row not CONFIRMED gets `not confirmed` in its state cell.
  - A **Read from LinuxCNC** action under More runs R-READ (its side effects in the help, ≤ 120: "Reads the offsets LinuxCNC uses now. LinuxCNC rewrites its parameter file. Not in AUTO with the machine on.").
- **The strip's WCS title.** `G55?`, with the reason in its title and HelpIcon.
- **The scrub bar and Sim tab.** A publication with `basis.confirmed: false` shows no Clear: the coverage words read `Not checked — coordinates not confirmed`.
- **Renderings:** not made in this round (no browser run). One run of the prototype tooling — injected marks on the mock — can render the HUD line, the Offsets row and the strip title when wanted.

## 5. The reconfirming read (task 4)

- **R-READ is the existing confirmed read**, widened from G30's keys to `#5210–#5390`.
  - **Usable:** it proves a FRESH file of the interpreter's own values (a synch's RCS_DONE plus a new inode plus one descriptor snapshot) — the same proof G30 relies on (`gateway.py:14080–14086`).
  - **Side effects:**
    - the parameter file is rewritten (`.bak` link, rename);
    - the interpreter re-reads its external state;
    - refused with the machine ON in AUTO;
    - in MANUAL / MDI / machine off it is admitted;
    - a start that lands first puts the task in AUTO and the synch is refused there (no abort, `gateway.py:14104–14110`).
- **It reads; it never writes the status back.** It does not make the status consistent. That is step 2 (an M2 program, an MDI toggle, a reset), measured by the start agent with its side effects.
- **When it runs:**
  - inside the touch-off's last admission when UNCONFIRMED;
  - on the operator's **Read from LinuxCNC**;
  - automatically at the gateway's connect when idle and not ON+AUTO, and after a gateway row write (`set_wcs` / `clear_wcs` / touch-off — the gateway is in MDI then) — both automatic cases are Q-C3.
- **Never** on a status poll, never at a normal start.

---

## 6. Guards
**Unit (pure, `coord_basis.py`)** — Codex R507's list (a)–(e) first:
- (a) P2 as the positive failure: a disturbed session (an abort's echo) with `gcodes` 540 and index 2 → `START` gives a reason; the publication's ctx is not verifiable.
- (b) Equal active codes with a stale inactive row (seq[28]): `index` CONFIRMED by codes alone? NO — rows UNCONFIRMED until R-READ; R-READ shows G55 = 2.861907 against the cache's 50 → that row is corrected and CONFIRMED.
- (c) The same G43 mode with an unconfirmed offset value → `tlo` UNCONFIRMED (the flag confirms nothing).
- (d) A re-parse from unconfirmed inputs stays unverified.
- (e) After R-READ (consistent) and a matching publication → verified again.

Further unit guards:
- the session classification on recorded poll sequences:
  - undisturbed run to M2;
  - pause/resume (stays undisturbed);
  - an abort from the gateway, from a foreign serial, by E-Stop (task state), by an interpreter error (RCS_ERROR own), by a mode switch while running;
  - a poll gap of 1.5 s;
  - a relink;
  - a session never seen starting;
- B3: a foreign serial while idle;
- B4: `set_wcs` rc ≠ DONE;
- R-OWN-ROW: confirms only the written axes;
- R-TLO: by an MDI `G43`;
- the precedence: contradiction before ledger.

**Gateway (`fake_linuxcnc`, conftest):**
- touch-off refused at the PRE-CHECK and, with a basis that flips between check and write, at the LAST admission (red without it);
- the touch-off's own R-READ admits with `p` = #5220 = status index and refuses when #5220 ≠ index;
- `set_wcs` / `clear_wcs` admitted while UNCONFIRMED;
- typed MDI admitted while INCONSISTENT and marking the scanned row;
- jog, stops and overrides untouched;
- `run_start_check` unverified with the ledger reason;
- an unchecked consent does not set `verified`;
- the active-row overwrite skipped while not CONFIRMED;
- R-READ refused in ON+AUTO (nothing sent, nothing confirmed).

**Browser (mock):** the four marks appear from a `coord_basis` frame and clear on `confirmed`; the machine position never carries a mark; no Clear on a `basis.confirmed: false` publication.

## 7. Mutations (each red at its guard)
- **MF1** the active-row overwrite kept while not CONFIRMED;
- **MF2** the touch-off's last admission dropped;
- **MF3** `gcodes` used for the index with the cache's offsets;
- **MF4** a new status treated as a reconciliation;
- **MF5** equal codes treated as one;
- **MF6** equal parse hash or equal cache derivations treated as one;
- **MF7** a finished check giving Clear on an unconfirmed publication;
- **MF8** the rule keyed on the abort command (an E-Stop or interpreter-error session does not invalidate);
- **MF9** pause/resume classified disturbed (the control turns noisy);
- **MF10** a foreign echo ignored;
- **MF11** R-READ without the inode check;
- **MF12** an unchecked consent setting `verified`;
- **MF13** `set_wcs` confirming unwritten axes;
- **MF14** a general MDI refused by the basis;
- **MF15** a jog refused by the basis;
- **MF16** the idle re-parse taking the status index while INCONSISTENT;
- **MF17** an `rc` ≠ DONE confirming a row.

## 8. Native cases (VM sim; run by the start agent's matrix or after it — not in this round)
Each case has a start state, a restore, a positive control, and the controller read by STAT plus the interpreter's parameters.
- **NF1** P2 replay: the touch-off is refused; R-READ gives INCONSISTENT (#5220 1 vs index 2); the start is unverified; the marks are shown.
- **NF2** seq[28]: after `set_wcs G54`, G55 stays UNCONFIRMED; after R-READ, G55 shows 2.861907.
- **NF3** an inactive G10 by typed MDI (`G10 L2 P3 X5`), then a program selecting G56: the start is unverified until R-READ, then verified (positive).
- **NF4** an undisturbed run to M2: nothing invalidated (control); R-END as a candidate.
- **NF5** E-Stop, machine off and an interpreter error mid-run: disturbed, so B1.
- **NF6** pause / resume / step: stays confirmed.
- **NF7** a foreign MDI from a second NML client: B3.
- **NF8** a fresh LinuxCNC: R-FRESH (echo 0).
- **NF9** TLO: `G43 H1`, then a disturbed session that read `G49` ahead → a Z touch-off is refused; MDI `G43` → confirmed.
- **NF10** R-READ in ON+AUTO: refused, named.
- **NF11** G92 set, then a disturbed session with `G92.1` read ahead: where does the status's G92 come from (R507's open G92 question).

---

## 9. Questions

### For Codex
- **Q-C1:** is the session classification — every echo the session's own or a non-dropping gateway command, an OWN RCS_DONE, task ON throughout, no error, no gap, no relink — an acceptable proof of an undisturbed end? Is the non-dropping class (§2.4) right?
- **Q-C2:** a foreign command (B3) makes every input UNCONFIRMED. That is conservative and noisy with halui or a second GUI. Or count only foreign SESSIONS?
- **Q-C3:** automatic R-READ (a parameter-file write as side effect) at connect and after own row writes — acceptable, or operator-initiated only? Inside the touch-off it stays automatic.
- **Q-C4:** R-FRESH and R-END as reconciliations once natively proven?
- **Q-C5:** while INCONSISTENT after an R-READ, may the idle re-parse take the interpreter's `#5220` with the read's rows? The start stays unverified either way.
- **Q-C6:** TLO is confirmed only by an executed TLO word; step 1 has no TLO read. Acceptable?
- **Q-C7:** the start state after a gateway restart is UNCONFIRMED (without R-FRESH), so the first start asks. Acceptable?

### For the operator (Claude asks)
- **Q-O1:** Offsets › **Read from LinuxCNC** in AUTO: refuse ("switch to MDI"), or switch to MDI by itself?
- **Q-O2:** after a program was stopped early, a Z touch-off can be refused until G43 or G49 is applied. Acceptable?
- **Q-O3:** the marks' words: `G55?` in the strip, `Work position not confirmed` in the DRO, `Active fixture unclear` in Offsets.
- **Q-O4:** does the machine run halui or a second GUI? That decides how noisy B3 is.

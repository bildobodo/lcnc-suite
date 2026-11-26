# F-G5X step 1 — plan v2: DELTA on plan v1 after Codex R508

**Status:** delta for Codex. No build, no browser or native run in this round.
**Base:** development `dbd14cab`. Every `file:line` is checked against `git show dbd14cab:<file>`; LinuxCNC 2.9.4 upstream against `~/claude-work/bg/upstream-2.9.4/` (`~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v2.md`).
**Binding:** plan v1 (`docs/reviews/maschinentag.r508.plan-fg5x-v1.md` = `~/claude-work/fg5x/plan-v1.md`), Codex R508 (end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `287e4472`, evidence `maschinentag.r508.codex-*`), and this delta. Where they differ, this delta wins.

**The smaller contract (R508's own summary):**
- uncertainty booked before each own effect;
- foreign effects observed within a named limit;
- confirmation bound to a VALUE snapshot;
- one reconfirming read with a named provenance limit;
- no confirmation from AUTO preview events or R-FRESH;
- the whole need checked at the write point and for the current Clear.

The automatic recovery of the STATUS stays out (step 2).

**And the coordinator's constraint: the routine must not ask at every start.** §9 shows, sequence by sequence, which start asks and what confirms the basis. The confirming read runs only inside deliberate operator actions (a start, a touch-off, an explicit Read), never in a background loop.

## 0. Change list

| Finding | Closed by | § |
|---|---|---|
| **MT508-01** observed echoes prove no undisturbed run | The session classification is DROPPED. Every own write books its possible effect as OPEN in `_cmd_blocking`'s write thread BEFORE the effect, classified by NML operation; an own AUTO/MDI session leaves its inputs OPEN until a read. Foreign evidence (an echo or a serial gap not ours) only adds invalidations. No claim of an undisturbed end anywhere. | 2 |
| **MT508-02** confirmation bound to values and a revision | One thread-safe ledger: confirmed VALUES + revision + link + an OPEN set. Both cache writers can only invalidate. Publications bind their input VALUES; their current Clear/start claim is recomputed against the ledger. | 2, 6 |
| **MT508-03** an inode is no provenance | R-READ (var file) confirms nothing any more. The confirming read is **R-LIVE**: the gateway's OWN DEBUG MDI, read back from the error channel by a nonce and bound to its own serial, own DONE, link and revision. The exact key union, the G92 effective rule and units are named. | 3 |
| **MT508-04** preview events are not machine effects | R-TLO and every use of `tlo_events` are dropped; TLO is confirmed only by R-LIVE. The MDI write set gets a precise scan contract; G10 L1/L10/L11 are TOOL writes; anything opaque counts as ALL. B4 corrected: the touch-off already checks rc. | 3, 7 |
| **MT508-05** XY coupling, whole need at the admit | Whole-row and whole-vector states (no masks). DISPLAY/TOUCHOFF needs include the XY-coupled components. The Plane route gets its own need. The order is: hard gates → read step → re-judge everything → the write-thread admit checks the whole need, revision, link and a fresh status. | 4, 5 |
| Answers Q-C3…Q-C8 | adopted (§8) | 8 |
| Texts | Codex's wording; the strip's DRO also carries the notice | 10 |
| The routine | the table | 9 |

---

## 1. What v1 had that v2 removes
- **B1's "undisturbed session" proof** (§2.2 v1): gone. A poll sequence is no proof (R508's hidden abort; a short own G10 between two polls).
- **R-READ as a confirmation** (§2.3, §5 v1): gone. `_g30_synch_read` (`lcnc-gateway/gateway.py:14147–14174`) binds inode and values to one descriptor, but not to its writer (R508's probe). The var file stays a data seed for the display cache only.
- **R-TLO, R-END, R-FRESH:** gone.
  - `tlo_events` also carries M6 carry-overs (`lcnc-gateway/gcode_canon.py:850–876`), and a preview event is no machine effect.
  - R-END would need the proven execution of M2's messages.
  - R-FRESH is no initialisation proof.
- **Per-axis confirmation** (R-OWN-ROW of single axes): gone. Rows and vectors are whole.

## 2. The ledger (MT508-01, MT508-02)

### 2.1 Shape
ONE immutable record replaced under a `threading.Lock` (`coord_basis.py`, pure transitions, unit-tested). Read by the loop and by write threads as one atomic snapshot.

```
CoordLedger {
  rev: int,                        # bumped by every booking and every confirmation
  link_seq: int | None,            # the Link the values belong to
  values: Snapshot | None,         # the CONFIRMED values, see §3.4
  open: {input: reason} | ALL,     # inputs with a possible unconfirmed effect since `values`
  inconsistent: {input: (interp, status)} | None,   # the last read's mismatch
  read: {serial, nonce, at, rev} | None
}
inputs = index | row[1..9] (whole row: the configured axes + R) | g92 (stored, enable, effective) | tlo (whole vector)
```

For a need N, the basis is:
- **CONFIRMED** iff `values` exists, `link_seq` is the current Link, no input of N is in `open` and none is `inconsistent`;
- **INCONSISTENT** iff an input of N is in `inconsistent` (and not re-opened since);
- **UNCONFIRMED** otherwise.

### 2.2 Booking BEFORE the effect, by NML operation
- **Where.** In `_cmd_blocking._run` (`lcnc-gateway/gateway.py:5338`), at "the BEGIN: the last check passed, the effect is next" (`:5367`) — after the admission and the second Link check, right before `getattr(conn.cmd, command.name)(*args)` (`:5375`).
- **What.** `book(op) → rev+1, open |= effect(op)`.
- **The three outcomes:**
  - a write refused before that point books nothing (no effect);
  - a write whose call raises stays booked (unknown effect);
  - the serial the call returns (`:5385`) is recorded with the Link for §2.4.
- **No loop-side booking** at a handler's end (v1 §2.5): too late for the admit.

**`effect(op)` — classified by the NML operation, never by the web command that wrote it.** A jog or spindle handler that writes a mode switch books that mode switch.

| NML operation | `effect` |
|---|---|
| `mdi(text)` | the text scan of §7 |
| `auto(AUTO_RUN)`; `auto(AUTO_STEP)` from IDLE (a START) | **ALL** — a program can do anything; nothing from the preview |
| `auto(AUTO_RESUME)`; `auto(AUTO_STEP)` in a pause; `auto(AUTO_PAUSE)` | nothing new (the run's ALL is already booked) |
| `abort`; `state(*)` (E-Stop, off, reset, on); `mode(MDI\|AUTO)` | **ALL**, unless the ledger is CONFIRMED and nothing was booked since its read (§2.3) |
| `reset_interpreter`; `program_open`; `task_plan_synch` | **ALL** (conservative: `Interp::reset` / plan state) |
| `jog*`, `home`, `unhome`, `teleop_enable`, `spindle*`, `flood`/`mist`, `feedrate`/`spindleoverride`/`rapidrate`/`maxvel`, `set_optional_stop`/`set_block_delete` | nothing (no coordinate effect) |
| `tool_offset`, `load_tool_table` (tool table writes) | nothing in this ledger: the tool basis rules own the table (`tlo` = the APPLIED offset, unchanged until a TLO message executes) |
| anything not listed | **ALL** |

### 2.3 Dropping operations — invalidating at once
- **During an open session** (anything booked since the last confirmed read), a dropping op (`abort`, `state`, `mode`, `reset_interpreter`) can only keep ALL open. Nothing new — and nothing ever claims the session ended undisturbed.
- **While CONFIRMED with nothing booked since the read,** the controller's queue is empty: the read's own MDI ended with its own DONE, and task's DONE needs every queue empty (`lcnc-gateway/gateway_util.py:6680`). A dropping op then drops nothing. It books nothing only under that proven condition; otherwise ALL.

### 2.4 Foreign evidence (a named, bounded detector — no completeness claim)
- **The serial is task's command-buffer counter, shared by every writer** (measured natively, `docs/architecture/ui-patterns.md:52`). Two kinds of evidence:
  - (a) a GAP between two consecutive own serials on one Link (a foreign write in between);
  - (b) a polled `echo_serial_number` that is not an own serial on that Link.

  Either books **ALL**, reason `foreign`.
- **The limit, named:** a foreign write AFTER the last own write and never polled is caught only at the next own write's serial (the read's own serial included, §3.3). That bounds it to the time before the next read; it is no complete history.
- A HAL E-Stop or machine-off needs no serial: it can only drop a queue the ledger already holds open (§2.3), or one that is empty.

### 2.5 The two cache writers can only INVALIDATE
- **The writers:** the var-file reseed (`lcnc-gateway/status_runtime.py:1069–1089`, `seed_wcs_cache` `:896–916`) and the status overlay of the active row (`:1090–1095`).
- **The rule:** neither may change a CONFIRMED value. If a write would change a confirmed input's value, that input is booked OPEN (reason `changed_outside_read`, traced). If the value is equal, nothing.
- **The confirmed values live in the ledger.** The cache remains the display copy. A read ADOPTS its values into both — never a later reseed as the data carrier (R508).

### 2.6 Old results never override newer state
- A read confirms only if the ledger's `rev` at its completion equals the `rev` it captured before its own write (§3.3).
- A late completion — a read, a publication, a collision result — never replaces a newer invalidation or another Link's state.

## 3. R-LIVE — the confirming read (replaces R-READ; MT508-03)

### 3.1 What it is
- **The gateway's own MDI**, a comment only, evaluated by the interpreter at READ time:

  ```
  (DEBUG,F5X<nonce> <part>/<parts> <v1> <v2> … END)
  ```

  - `<vi>` are parameter references (`#5220`, `#5221`, …), substituted with `%lf` — six decimals (`src/emc/rs274ngc/interp_convert.cc:1274–1330`);
  - the text is emitted as an operator display message only while `#5599 > 0` (`:1537–1543`);
  - `MESSAGE` queues it on `interp_list` and truncates it to `LINELEN − 1` (`src/emc/task/emccanon.cc:2362–2370`). It therefore appears on the error channel only when EXECUTED.
- **Several lines**, each ≤ 254 bytes as sent (`mdi_line_refusal`). Each expanded text ends with `END`; a missing `END` means truncation, so the read failed.
- **The nonce** is fresh and random per read. The gateway consumes its own read messages; they never reach the message center.

### 3.2 The key union (exact, per need)
- `#5220` (the active index, an integer 1…9);
- per needed row n: `base_n + 1 … base_n + 9` restricted to the CONFIGURED axes, plus `base_n + 10` (R). The bases are `5220 + 20·(n − 1)`, as the gateway's `_WCS_BASES`; the R slot is `#5230`, `#5250`, …;
- G92/G52: `#5210` (enable, must be 0 or 1) and `#5211 … #5219` restricted to the configured axes;
- TLO: `#5401 … #5409` restricted to the configured axes (the applied tool offset — **units and meaning owed natively, NR1**);
- the unit state: `#<_metric>` and `#<_metric_machine>`.

Need sets: START = `#5220` + the active row + every row the program selects (from its parse; opaque → all rows) + G92 + TLO. TOUCHOFF = `#5220` + the target row + G92 + TLO. Offsets **Read** = everything.

A missing, unparsable or non-finite value makes the read fail; nothing is confirmed.

### 3.3 Provenance binding — all must hold, else nothing is confirmed
1. Capture `rev0`, the Link and the last own serial before the first read line. The caller holds `_cmd_lock`.
2. Each line is an own `mdi` through `_cmd_blocking`. It books NOTHING: a comment line has no coordinate effect (§7).
   - Its serial must be the last own serial + 1 (§2.4 (a)), else foreign → ALL, no confirmation.
   - It must end with its OWN completion: `controller_done` "done" with **`echo == serial`**, a stricter use of `lcnc-gateway/gateway_util.py:6672–6727`. `wait_complete` alone may answer DONE for a higher echo (R508).
3. Each line's message must arrive with its nonce and part number between its write's begin and its completion poll.
4. A fresh status poll on the same Link after the last line:
   - `echo_serial_number` == the last read line's serial (nothing foreign after it);
   - the interpreter IDLE, execution done.
5. The ledger `rev` still equals `rev0`; the Link is unchanged.
6. **Then the compare,** against that same poll (§3.4):
   - all equal → the read's values are ADOPTED (ledger and cache), the inputs read leave `open`, `inconsistent` cleared for them;
   - unequal → those inputs `inconsistent` with both values; the interpreter's values are still adopted as the interpreter side, and the status side is marked.

### 3.4 The compare (named values, named units)
- **index:** `#5220` == status `g5x_index` (exact).
- **the active row:** status `g5x_offset` (configured axes) vs row `#5220`; status `rotation_xy` vs its R. Tolerance 1e-6 in machine units, after conversion by `#<_metric>` / `#<_metric_machine>` where the parameter's unit is the program's — **which parameters are stored in machine units is NR1**.
- **G92/G52 — three statements kept apart:**
  - stored `#5211…#5219`;
  - enable `#5210`;
  - effective = enable ? stored : 0.

  The status `g92_offset` is compared with the EFFECTIVE vector. After a normal `G92.2` (enable 0, stored kept) the basis is consistent, not inconsistent (R508). A stored-vs-effective difference is not erased by "enable 0 ⇒ healed": the stored values stay recorded as the interpreter's, and the effective vector is what is compared.
- **tlo:** status `tool_offset` (configured axes) vs `#5401…#5409`, units per NR1.
- **inactive rows:** the interpreter is the only source. They are adopted as confirmed (the status holds no inactive rows).

### 3.5 Side effects (named)
- **A mode switch to MDI** when the task is not in MDI: `emcTaskSetMode` runs `emcTaskAbort` (an empty queue under §2.3's condition) and `emcTaskPlanSynch` (`emctask.cc:284–297`). `Interp::synch` writes the parameter file (`rs274ngc_pre.cc:2010–2062`).
- **The MDI lines themselves:** comments only, no motion, no parameter write.
- **The mode stays MDI** unless the caller returns it (a start returns to AUTO itself).
- **`#5599 ≤ 0`** (DEBUG output switched off by a program) → no message → the read fails by name; nothing is written to change it.
- **Refused:** while the interpreter is not idle; for the STANDALONE Read action in ON+AUTO (Codex's recommendation, Q508-1: no mode switch to get around it).

## 4. Needs with XY coupling (MT508-05)
- **Granularity:** a row is one input (all configured axes + R); G92 is one input; TLO is one vector. No masks. A partial write opens the whole input.
- **`DISPLAY(axis)`:**
  - for **X or Y**: `index`, the active row (X, Y, R together), G92 (X/Y effective), TLO (X and Y) — `work_pos` subtracts G5x and TLO, then rotates XY (`lcnc-gateway/status_runtime.py:1136–1200`);
  - for another axis: `index`, the active row, G92 and TLO for it.
- **`TOUCHOFF(axes)`:** `index`, the target row, G92, TLO — whole inputs. A G10 L20 in a rotated row writes X AND Y (`convert_setup`, `src/emc/rs274ngc/interp_convert.cc:4234–4260`), so the write books the whole row OPEN.
- **`TOUCHOFF_PLANE`** (`o<twp_touchoff>`, G54 written through the plane while G59 is active, `lcnc-gateway/gateway.py:10200–10220`): needs `index` (G59) and the rows G54 and G59…G59.3, plus G92 and TLO. Its remap is opaque, so it books **ALL**. A post-write R-LIVE is its effect proof, and the remap's own datum pins stay as today.
- **`START`** and **`PUBLICATION`:** as §3.2.

## 5. The order of admission (MT508-05)

### 5.1 Touch-off / Zero
1. **Hard gates and the target expectation** (today's checks: arm, eoffset, AUTO, `touchoff_expect_check`, `touchoff_route`) on the snapshot (`gateway.py:10120–10160`).
2. **Basis.** INCONSISTENT for the need → refused (`Touch-off refused — controller coordinates inconsistent`). UNCONFIRMED → step 3. CONFIRMED → step 4.
3. **The read step** (part of the requested touch-off, Q-C3): `set_mode(MDI)` — the touch-off writes it today anyway, `lcnc-gateway/gateway.py:10169` — then R-LIVE for the TOUCHOFF need.
4. **Re-judge EVERYTHING** on the read's values: the gates, `touchoff_expect_check` with the read's `#5220` as the target (the keypad's expected `G55` against the interpreter's `G54` → refused, "target changed"), the route, the basis (now CONFIRMED or INCONSISTENT).
5. **The write**, `G10 L20 P<#5220>`, with the write thread's `admit` (synchronous, no file or MDI inside) checking:
   - the ledger `rev` == the rev the read left;
   - the Link is unchanged;
   - the WHOLE need is CONFIRMED;
   - a fresh in-thread `stat.poll()` still matches the confirmed STATUS-comparable values (index, active row, rotation, G92 effective, TLO).

   The admit confirms nothing; it only admits a basis that is still valid. Its booking (§2.2) opens the target row.
6. **The post-write read** (R-LIVE, ROW + index) confirms the new row (the effect proof). It replaces today's adoption of the status's offset (`:10256–10263`).

### 5.2 The start (delta S-F1 to the agreed start contract, R504)
- **When the entry reads.** The entry evaluates its verdict WITHOUT the basis term first. Only if the basis term ALONE stands between the start and `verified` (UNCONFIRMED, not INCONSISTENT), the entry runs the read step: `set_mode(MDI)`, R-LIVE for START. It then re-judges the whole verdict.
- **Why that order.** If another term already asks (a check not finished, a newer publication, the toolsetter), no read is made — nothing would turn the start verified.
- **The deviation, named for Codex:**
  - the agreed contract writes nothing at the entry when it asks;
  - with S-F1 the entry may have written the read (a mode switch and comment-only MDI) before an ask that the read itself causes (INCONSISTENT);
  - the start then continues in its own mode handling (`set_mode(AUTO)`), or asks.
- **The record and the write-thread points** consume the CONFIRMED basis with the write-thread admit of §5.1 step 5 (no read there).
- **RFL:** the same at its entry. Its sequence's own MDI steps are booked like every MDI.

## 6. Publications and the Clear (MT508-02)
- **What a publication binds:** its input VALUES — `g5x_index`, the row patches (`var_patches`), G92, TLO, as the ctx already carries them (`lcnc-gateway/bulk_pipeline.py:984–992`, `gateway.py:12117–12157`) — plus the ledger `rev` and state at its snapshot.
- **The current claim.** Its Clear and its verified start hold iff, NOW:
  - the ledger is CONFIRMED for its need;
  - its bound values EQUAL the confirmed values (need-restricted; exact on the 6-decimal machine-unit form);
  - it is the publication shown.

  An invalidation removes the claim at once. A later confirmation restores it ONLY through that value equality — never because the ledger turned CONFIRMED. A result built from other values is re-checked.
- **The idle re-parse.** While INCONSISTENT after a read it takes the read's index WITH the read's rows (Q-C5 yes, bound to that whole snapshot); the start stays unverified while INCONSISTENT.
- **The current basis and the shown result's basis are named separately** (Codex), §10.

## 7. The MDI write set (MT508-04 B2) — a scan contract with ALL as its default
- The gateway's MDI text is tokenized by the suite's G-code tokenizer, the same as the editor's highlight. The effect is the union per line:

| Found | Opens |
|---|---|
| a comment-only line (the read) | nothing |
| `G54…G59.3` | `index` |
| `G10 L2 P<n>` / `G10 L20 P<n>` with a literal n ≥ 1 | `row[n]` |
| `G10 L2/L20 P0` or a P not literal | **all rows** + `index` (P0 is the active row at that line, which may have changed — R508) |
| `G10 L1 / L10 / L11` | nothing here: TOOL writes (`convert_setup_tool`, `src/emc/rs274ngc/interp_convert.cc:3696–3711`) → the tool basis, plus `tlo` conservatively |
| `G92`, `G92.1`, `G92.2`, `G92.3`, `G52` | `g92` |
| `G43`, `G43.1`, `G43.2`, `G49`, `M6`, `M61`, `T` with `M6` | `tlo` |
| `M2`, `M30` | `index`, `row[1]`, `g92` |
| a parameter assignment (`#…=`), an expression in any coordinate word, an `o`-call, a user M-code (`M100–M199`), any remapped code of the INI, a macro, a probe or toolsetter job, anything the tokenizer cannot classify | **ALL** |

- An own AUTO run or start step is ALL (§2.2), whatever its parse says.
- **B4 corrected:** the touch-off route already checks its rc (`lcnc-gateway/gateway.py:10242–10245`, the Plane route `:10209–10212`). `set_wcs` / `clear_wcs` do not; in v2 their rc is checked AND their effect is confirmed only by a post-write R-LIVE (§5.1 step 6), never by the request's values. Values typed under G20 are no machine values.

## 8. Codex's answers adopted
- **Q-C3:** reads only inside deliberate actions — the requested touch-off (§5.1), the start (§5.2, S-F1, Q2-C1) and the Offsets **Read**. No read at connect, after a relink, after an abort, or on a poll.
- **Q-C4:** no R-FRESH; R-END omitted.
- **Q-C5:** yes, bound to the whole read snapshot (§6).
- **Q-C6:** yes — TLO only through R-LIVE.
- **Q-C7:** yes — after a gateway restart the basis is UNCONFIRMED; the first start reads (§9, so it does not ask).
- **Q-C8:** no exception from `tlo_events`.

## 9. The routine — does the next start ask, and what confirms?

The start reads when needed (S-F1). "Asks" means the start message's question (the start contract), not the read.

| Sequence | Basis after it | The next Cycle Start | What confirms | Seen between |
|---|---|---|---|---|
| **Run to M2, then start** | OPEN — ALL, booked at the AUTO write | reads (MDI detour; from ON+AUTO idle, AUTO→MDI→AUTO). M2 executed every message, so status = interpreter → CONFIRMED. The re-parse after M2 (G54 reset) was built from equal values → **verified, no ask**. If that re-parse has not published yet → the start contract's existing "check not finished" question. | the start's own read | the Sim tab and scrub bar: `Check basis not confirmed`; the DRO: no mark (§10) |
| **Abort, then start** | OPEN — ALL | reads. (a) Nothing was read ahead → consistent → **no ask**, as above. (b) Coordinate messages were dropped → **INCONSISTENT → asks** `Interpreter: G54 · Status: G55`. | (a) the start's read; (b) nothing in step 1 — a status recovery (step 2), or a program run to its end and then the next start's read. Until then each start asks, and the touch-off is refused. | (b) the DRO, strip, Offsets and Sim marks |
| **Touch-off, then start** | the touch-off's own pre-read and post-write read → CONFIRMED | the WCS edge re-parses from the confirmed values → **verified, no ask** (after the re-parse; earlier → "check not finished") | the touch-off's reads | — |
| **Tool measurement (M600), then start** | OPEN (the job is opaque → ALL) | reads; the TLO the routine applied is executed → status = interpreter → CONFIRMED. The TLO re-parse was built from equal values → **no ask** (after the re-parse) | the start's read | the Sim tab: `Check basis not confirmed` until the start |
| **The first start after homing** (fresh LinuxCNC + gateway) | UNCONFIRMED (gateway start; homing books nothing) | reads → consistent → the publication's values (var-file seed + status) equal the read's → **no ask** | the start's read | the Sim tab: `Check basis not confirmed`; the DRO: no mark |
| **A second start with nothing in between** | CONFIRMED | **no read, no ask** | — | — |
| **Typed MDI `G10 L2 P3 X5`, then a program selecting G56** | `row[3]` OPEN | reads G56 → the publication was built from the OLD G56 → values differ → re-parse → "check not finished" until it publishes, then no ask | the start's read | Offsets row G56 `not confirmed` |
| **Jog, spindle, coolant, overrides, homing between** | unchanged | as before | — | — |

**Cost of the no-ask routine.**
- Each start after any program or MDI makes ONE read: a mode detour through MDI, two synchs that rewrite the parameter file, one to three comment MDI lines.
- The latency and the visible mode flicker are **owed natively (NR2)**.
- A start in ON+AUTO idle leaves AUTO for the read. That is the operator's call (Q508-1b).
- The only routine sequence that asks is (b) after an abort: the controller then really disagrees with the interpreter.

## 10. Display and texts (Codex's wording)
- **INCONSISTENT after a read:** `Interpreter: G54 · Status: G55` with the read's time, in Offsets and in the DRO notice.
- **An existing result on an unconfirmed basis:** `Check basis not confirmed` (the Sim tab, the scrub bar coverage words). The result's own basis and the current basis are named separately: "Check basis: values read 10:42" / "Current: not confirmed".
- **TLO:** `Tool length not confirmed`, with a HelpIcon (≤ 120): "The tool length LinuxCNC applies has not been read since the last program or MDI. A start or touch-off reads it."
- **No "Another program changed LinuxCNC".** A foreign serial gives `Coordinate basis not confirmed`.
- **The DRO OUTSIDE the viewer** — the Setup strip's axis values — gets the same notice line, not only muted digits or a `title`. The machine position stays plain, the stops untouched.
- **Marks by state:**
  - INCONSISTENT → the DRO, strip and Offsets marks;
  - UNCONFIRMED with an observed drop (an own dropping op or a task-state change during an open session) or foreign evidence → the DRO notice `Work position not confirmed`;
  - merely OPEN after an own program/MDI with nothing observed → no DRO mark; Offsets shows `Not read since the last program`, the Sim tab `Check basis not confirmed`.
  - **The named limit:** a hidden disturbance (R508's poll gap) shows no DRO mark until the next read. The writes and the start are protected by the read itself (Q2-C3).

**Texts (≤ 60):**
- `Interpreter: G54 · Status: G55`
- `Check basis not confirmed`
- `Tool length not confirmed`
- `Coordinate basis not confirmed`
- `Work position not confirmed`
- `Not read since the last program`
- `Touch-off refused — controller coordinates inconsistent`
- `Coordinates not readable — DEBUG output is off (#5599)`
- `Offsets not readable in AUTO — switch to MDI` (the standalone Read)

## 11. Guards, mutations, native cases (R508's counter-cases first)

### 11.1 Unit — pure `coord_basis.py` and `_cmd_blocking` with `fake_linuxcnc`
- R508's hidden abort: own run serial 100, foreign 101 unpolled, own override 102. The run already booked ALL → never confirmed by the sequence; the gap 100 → 102 books `foreign`.
- A short own `G10 L2 P3 X5` between two idle polls → `row[3]` OPEN at its begin.
- A write refused at `admit` books nothing; a write whose call raises stays booked.
- The cache writers: the STAT overlay or a reseed with a different value on a confirmed row → OPEN; an equal value → nothing.
- Index 1 confirmed, row 1 open, STAT index 1 with X0, a read X7 → X7 is never overwritten by X0.
- A read whose `rev` changed during it → no confirmation. A read answered DONE at a higher echo → no confirmation. A missing nonce, part or `END` → none. A foreign echo at the compare poll → none.
- G92.2: enable 0, stored X5, status effective 0 → consistent (red against v1's raw compare).
- `tlo_events` with only an M6 carry-over → never confirms TLO (MF-v1 R-TLO red).
- XY: R90, TLO-Y changed → `DISPLAY(X)` unconfirmed.
- A publication built from values V, the ledger confirmed later at V → claim restored; at V' → re-check; an invalidation after a visible Clear → the claim is gone at once; an old result arriving after a newer confirmation → not current.

### 11.2 Gateway
- Touch-off:
  - the pre-step reads, then re-judges; the keypad's `G55` against the read's `G54` → refused;
  - the write-thread admit fails on a rev bump between the read and the write;
  - the post-write read confirms.
- Start (S-F1):
  - the read happens only when the basis term alone blocks `verified`;
  - another reason asks without a read;
  - INCONSISTENT asks after the read.
- `set_wcs` rc checked; confirmed only by its post-write read.
- The jog, spindle, overrides and stops are never refused; general MDI is never refused.

### 11.3 Mutations (beside v1's MF1–MF17, which stay where still meaningful)
- **MF18** a session-end classification confirming ("undisturbed");
- **MF19** booking at the handler's end instead of before `cmd_fn`;
- **MF20** classification by web command name (a jog handler's mode switch unbooked);
- **MF21** R-LIVE accepting `echo > serial`;
- **MF22** R-LIVE without the nonce, part or `END`;
- **MF23** R-LIVE without the rev check;
- **MF24** the G92 raw compare;
- **MF25** confirming TLO from `tlo_events`;
- **MF26** per-axis confirmation;
- **MF27** `DISPLAY(X)` without Y/R/TLO-Y;
- **MF28** the admit checking only `g5x_index`;
- **MF29** a ledger turning CONFIRMED restoring a publication with other values;
- **MF30** the standalone Read switching ON+AUTO to MDI;
- **MF31** S-F1 reading although another term asks.

### 11.4 Native (VM sim; the start agent's matrix or later)
- **NR1** R-LIVE's units and meaning:
  - `#5221…`, `#5211…`, `#5401…` under G20 and G21 on a mm machine and an inch machine;
  - `#5401–#5409` against the status `tool_offset` after `G43 H1`, `G43.1`, `G49`;
  - the six-decimal form against the 1e-6 compare.
- **NR2** the read's latency and mode flicker at a start from MANUAL, MDI and ON+AUTO idle; the DEBUG lines kept out of the message center.
- **NR3** the routine table natively, row by row; the abort row both ways (nothing read ahead / messages dropped).
- **NR4** `#5599 = 0`: the read fails by name.
- **NR5** a foreign MDI from a second NML client: the serial gap is booked.
- **NR6** v1's NF1/NF2/NF3/NF9 re-expressed with R-LIVE.

## 12. Questions

### For Codex
- **Q2-C1 (S-F1):** May the start's ENTRY run R-LIVE — a mode switch to MDI plus comment-only MDI lines — when the basis term alone blocks `verified`? The deviation is that an ask caused by INCONSISTENT then follows a read already written. This is a delta to the agreed start contract (R504).
- **Q2-C2:** A publication's current claim is restored by VALUE equality with a later confirmed read (§6). Is that the binding you meant by "bound input values / revision … must match"?
- **Q2-C3:** Display tiers: admissions are proof-based (always read), DRO marks evidence-based. A hidden disturbance therefore shows no DRO mark until the next read. Acceptable as a named limit?
- **Q2-C4:** Is the NML-operation table of §2.2 right? Especially `program_open` and `task_plan_synch` as ALL, `tool_offset` / `load_tool_table` as tool-basis only, and a dropping op while CONFIRMED-and-unbooked booking nothing.
- **Q2-C5:** Is R-LIVE's provenance binding (§3.3) sufficient as the reconfirming read, with its named limit (a foreign write between the last read line and the compare poll is caught by the echo check; one before the read is captured by the read)?

### For the operator (Q508-1…4, Claude asks)
- **Q508-1a:** in ON+AUTO the standalone Offsets **Read** refuses ("switch to MDI"), no automatic mode switch (Codex's recommendation).
- **Q508-1b (new):** may a START from ON+AUTO idle detour through MDI for its read and return to AUTO? Without it, "run to M2 then start" asks every time.
- **Q508-2:** the TLO sequence: after any program, the tool length counts as not confirmed until the next start or touch-off reads it; no G43/G49 tip.
- **Q508-3:** the marks' words (§10).
- **Q508-4:** other controller or parameter-file writers on the machine (halui, a second GUI, scripts).

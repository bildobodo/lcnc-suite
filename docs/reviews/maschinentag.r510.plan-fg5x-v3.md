# F-G5X step 1 — plan v3: DELTA on v1 + v2 after Codex R509

**Status:** delta for Codex, complete for option (ii). Option (i), the Python read on `[PYTHON]` configs, is specified in §3.7 but needs Codex's approval of running Python in task. The sources are settled by the start agent's native experiment **NR-src** (two passes, §1); every claim there is marked native, source, derived or owed. No build, browser or native run of my own in this round.
**Base:** development `dbd14cab`; LinuxCNC 2.9.4 upstream from `~/claude-work/bg/upstream-2.9.4/`. Every `file:line` is checked with `~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v3.md`. Start-WIP references (`14404a9d`) are named by function, not by line.
**Binding:** v1, v2 (`maschinentag.r509.plan-fg5x-v2.md`), Codex R509 (end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `d2f41c16`, evidence `maschinentag.r509.codex-*`), and this delta. Where they differ, this delta wins.

**Agreed in R509 and kept:** book before the effect in the write thread; the ledger owns the confirmed values; whole inputs; cache writers only invalidate; later results bound to value, Link and revision.

**R509's main point, accepted:** R-LIVE as written in v2 did not read what it claimed. v3 does not weaken the confirmation rule. It names, field by field, which interpreter field a read value is.
- Without `[PYTHON]` there is no direct source for the applied row, the applied G92 or the applied TLO separately.
- v3 therefore confirms the applied TRANSFORM at the standing point (X/Y jointly through the rotation), narrowed by direct reads (§1.4 (ii)); where `[PYTHON]` exists, it reads every applied component exactly (§1.4 (i)).
- The split residual is named for Codex.

## 0. Change list

| Finding | Closed by | § |
|---|---|---|
| **MT509-01** read parameters ≠ applied interpreter fields | Every input is split into STORED (parameter table) and APPLIED (`_setup` field). #5401–#5409 are the spindle tool's table entry, never the applied TLO. #5220 is the stored selection, never the applied index. Per NR-src, without `[PYTHON]`: the applied index comes from `#<_coord_system>`. The applied TRANSFORM comes from `#<_x…>` against the status's mirrored unoffset, X/Y jointly. The split is narrowed by the stored values and `#<_tool_offset>`. With `[PYTHON]`: the exact Python read (`#<_coord_system>` is shadowed there, natively). Stored ≠ applied is a calm state, never INCONSISTENT. | 1, 2.1, 3.2, 3.4 |
| **MT509-02 A** an empty queue proves nothing about the abort's own effect | The op table separates QUEUE LOSS from OWN EFFECT. Abort and every state/error path that reaches `emcAbortCleanup` book ALL when a hook is configured (every shipped sim), CONFIRMED or not. In AUTO the abort's state restore re-selects G5x, G43/G49 and G92 itself. `mode(MDI\|AUTO)` is its own row: queue loss only, by source. `mode(MANUAL)` and `state(ON)` are listed (book nothing). v2 §2.4's last bullet is withdrawn: leaving ON runs the hook with no gateway write. | 2.2–2.4 |
| **MT509-02 B** comment form is no proof of no effect | The read's exception belongs to the generated read JOB, passed as an object, never to its text. General MDI detects active comments before stripping: PY/PYRUN/PYRELOAD/ABORT → ALL; DEBUG/PRINT/LOG with a named parameter → ALL; only listed passive forms book nothing. | 3.1, 7 |
| **MT509-03** completion and reception are different events | ONE collector inside the poller's existing error-channel read, registered before the first write, served only by cycles begun after it (the `_cal_drain_proof` pattern). Completion = own DONE AND full reception; a reply read after the DONE poll is accepted up to a named deadline; then re-check, then adoption under the ledger lock. No second `ERR.poll`. The text becomes `Coordinate read incomplete — no reply`. Sent and expanded length are budgeted. The rounding and units rule is fixed. | 3.3–3.6, 10 |
| **MT509-04 A** start ≠ touch-off | At a start the basis is a VERIFICATION term. An unchecked consent proceeds unverified, with no Clear. At a touch-off it stays a hard condition. | 5.2 |
| **MT509-04 B** a read at the entry does not survive the preparation | The read MOVES from the entry to the end of the start's preparation, after `_start_guard`, `_toolsetter_sync` and RFL's positioning, and before the switch to AUTO. **This is the one choice with start-contract weight** (§13); the alternative is named. | 5.2 |
| **MT509-04 C** the existing generation and drift observers | The read stays an ordinary input write for `calc_lifetime`: no exemption. Value equality never adopts a parse that is in flight. | 5.3 |
| **MT509-04 D** routine claims too strong | The routine table is rewritten as EXPECTATIONS with preconditions P1–P8. The second start is split. The extra ask paths are listed. The three moments are kept apart. | 5.4, 9 |
| **Q2-C3** calm notice | A calm DRO notice appears at idle for a known unconfirmed basis; INCONSISTENT is louder; no mark while running. "Protected by the read" is limited to the real read paths. | 10 |
| **Q2-C4** | `tool_offset` / `load_tool_table` book the new input `tooltable`, never the applied `tlo`. | 2.2 |
| **v2 §2.5** "a read adopts into both" | Withdrawn: the read adopts into the LEDGER only. `run_start_check` compares the patches exactly (`lcnc-gateway/bulk_pipeline.py:659`). | 2.5 |

---

## 1. The sources — settled by NR-src (two passes)

**Evidence.** The start agent's native runs on the 3-axis sim at `4abc58ba`, each with its restore complete. The drivers are `docs/reviews/maschinentag.start-probes.*` on feat/start-ask (`9d399d49`; second pass `33c20a50`).

| Pass | Run under `~/claude-work/start/step0/runs/` | Config |
|---|---|---|
| 1 | `20261126T133029-nrsrcA2` | the shipped INI |
| 1 | `20261126T133807-nrsrcB2` | `DISABLE_G92_PERSISTENCE = 1` + `[PYTHON]` with an empty TOPLEVEL |
| 1 | `20261126T131401-exposure2` | — |
| 2 | `20261126T134657-nrsrc2A` | the shipped INI |
| 2 | `20261126T135215-nrsrc2B` | `DISABLE_G92_PERSISTENCE = 1` + `[PYTHON]` whose TOPLEVEL imports a `namedparams` module defining `_coord_system` → 999 |

Each pass-2 snapshot is STAT, DEBUG, STAT, plus a direct `echo_serial_number`, the var file, and in B a `;py,` read. Every claim below is marked **native** (measured), **source** (read in 2.9.4 only), **derived** (my reasoning from the source) or **owed** (a native case still to run).

### 1.0 The headline
- **The defect is proven on the deployed product** (native, pass 2, A and B alike) — Codex's MT507-01 (b):
  1. A real tag move in G54, then a program that reads `G10 L2 P1 X5 R5` ahead, aborted in its dwell. The status keeps G54 X0 R0 (code 540); the interpreter has G54 X5 R5. The codes are equal, so the R507 term is silent.
  2. A plain program with no fixture word started VERIFIED, with no ask.
  3. The machine went to **X14.0904 Y10.8335** — the program's X10 Y10 in G54 X5 R5 — while the preview, built from the status, showed X10 Y10.
- **The term alone is not enough; the ledger and the read are needed.**
- **Without `[PYTHON]` there is no direct source of the applied active row, the applied G92 or the applied TLO separately** (native + source).
- **What IS readable everywhere, and natively correct on the shipped config:**
  - the applied INDEX (`#<_coord_system>`);
  - the interpreter's program position, and with it the applied TRANSFORM at the standing point;
  - whether any TLO is applied (`#<_tool_offset>`);
  - every STORED value.
- **The recommendation (§1.4), by config:**
  - **(i) the Python read** where `[PYTHON]` already exists (the TWP sim): exact components, no INI change;
  - **(ii) the TRANSFORM compare** everywhere else, including the operator's 3-axis machine.

### 1.1 Settled facts
- **TLO (native, both passes).** `#5401–#5409` = `tool_table[0]`, the spindle tool's table entry (`src/emc/rs274ngc/interp_convert.cc:4119–4127`). The applied `_setup.tool_offset` is set by G43/G43.1/G43.2/G49 (`src/emc/rs274ngc/interp_convert.cc:5651–5760`). T1 is loaded (table Z 50), T2 = 47.690467; the Z sum is read with row Z and G92 Z at 0.

  | Case | STAT TLO-Z | `#5403` | `#<_tool_offset>` | the Z sum | Python `tool_offset.z` |
  |---|---|---|---|---|---|
  | G43 H1 | 50 | 50 | 1 | 50 | 50.0 |
  | G43 H2 | 47.6905 | 50 | 1 | 47.690467 | 47.690467 |
  | G43.1 Z7 | 7 | 50 | 1 | 7 | — |
  | G43 H1 + G43.2 H2 | 97.6905 | 50 | 1 | 97.690467 | — |
  | G49, T1 still loaded | 0 | 50 | 0 | 0 | 0.0 |
  | **stale:** last move under G49, then G43 H1 with no move, then a program reading G49 ahead, aborted in its dwell | **50** | 50 | **0** | **0** | **0** |

  - In the stale row, the status g-codes already say G49. The sum, Python and `#<_tool_offset>` discriminate; `#540x` would falsely confirm.
  - `#<_tool_offset>` is only "any component ≠ 0" (`src/emc/rs274ngc/interp_namedparams.cc:577–581`).
- **Index.**
  - `#<_coord_system>` returns `_setup.origin_index` ENCODED: 540…590 for 1–6, then 591…593 (`src/emc/rs274ngc/interp_namedparams.cc:571–575`). Decode: `(v − 530)/10` for v ≤ 590, else `v − 584`.
  - **Native A:** after `G54`, then `#5220=2`, it reads 540 while `#5220` reads 2 and STAT 1. `G0 X12` lands at machine X12, so G54 applies. The synch wrote `5220 2.000000` to the var file.
  - **Native B: `#<_coord_system>` reads 999 every time — shadowed by `namedparams`** (`src/emc/rs274ngc/interp_namedparams.cc:796–811`, `src/emc/rs274ngc/interp_namedparams.cc:360–372`). Python `origin_index` reads 1, which is correct.
  - So `#<_coord_system>` is trustworthy only on a config WITHOUT `[PYTHON]`.
  - `#5220` is writable, the stored selection only (`src/emc/rs274ngc/rs274ngc_pre.cc:362–365`, `src/emc/rs274ngc/interp_array.cc:239–255`).
- **Rows (native).** A G5x selection writes `#5220` and loads the APPLIED row from the stored one (`src/emc/rs274ngc/interp_convert.cc:1806–1822`). Re-selecting the active system is a no-op (`src/emc/rs274ngc/interp_convert.cc:1793–1798`).
  - `#5221=5` with G54 active → stored 5, applied 0. `G54` again applies nothing; `G55` then `G54` applies 5, and STAT follows.
  - **The stale row at R5** (§1.0): the sum `#<_abs_x/y>` − `#<_x/y>` reads x 4.147 / y 0.474 against a status of 0. Under a rotation the sum shows a DEVIATION, not the parts.
  - Python `origin_offset_x` / `rotation_xy` read 5.0 / 5 applied while STAT shows 0 / 0 — correct.
- **G92 (native).**
  - `G92 X3` at X10 → `#5210` 1, `#5211` 7, applied 7. `G92.2` → enable 0, `#5211` kept, applied 0. `G92.3` → 7.
  - M2 keeps it with persistence on. G52 X2 shares `#5211`, and M2 keeps it.
  - **M2 under `DISABLE_G92_PERSISTENCE`:** `#5210–#5219` → 0 (`src/emc/rs274ngc/interp_convert.cc:4684–4687`), while the applied G92 stays 7. STAT shows 7; `G0 X11` lands at machine X18; Python `axis_offset_x` reads 7.0. So effective(stored) is WRONG under that option. No shipped INI sets it.
- **Units (native, pass 2).** The program position, the sums and Python are in PROGRAM units.
  - Under G20 + G43 H1: the sum reads 1.968504, Python 1.968503937 (`length_units` 1, `_metric` 0, `_metric_machine` 1), while STAT stays 50 mm.
  - Rows and G92 under G20: owed.
  - Rows are STORED in machine units (`lcnc-gateway/gateway.py:12124–12134`) and converted on selection (`src/emc/rs274ngc/interp_convert.cc:1811`).
- **Where the program position comes from** (source; native through the cases above). After a synch, `#<_x>` is the commanded `traj.position` minus the external offset, with CANON's tool, G5x, rotation and G92 offsets removed, in program units (`src/emc/task/emccanon.cc:2658–2689`, `src/emc/task/emccanon.cc:226–239`, synch `src/emc/rs274ngc/rs274ngc_pre.cc:2012–2024`).
  - Canon's offsets are written only by the interpreter's own canon calls, at interpretation time: `SET_XY_ROTATION`, `SET_G5X_OFFSET`, `SET_G92_OFFSET` (`src/emc/task/emccanon.cc:472–503`), `USE_TOOL_LENGTH_OFFSET` (`src/emc/task/emccanon.cc:2018–2040`), `INIT_CANON` (`src/emc/task/emccanon.cc:2542–2570`).
  - So `#<_x…>` is the program point under the INTERPRETER's transform, never the status's.
  - `#<_abs_x…c>` adds the `_setup` offsets back, through the rotation, without U/V/W (`src/emc/rs274ngc/interp_namedparams.cc:725–762`).
- **The Python read with `[PYTHON]`** (native, B and B2): `;py,import emccanon;emccanon.MESSAGE('… %r' % (this.<field>,))`. `this` is the interpreter object, and `this.tool_offset` is an `interpreter.EmcPose`. It reads the applied `origin_index`, `origin_offset_*`, `rotation_xy`, `axis_offset_*` and `tool_offset`, all correct in every case (source of the fields: `src/emc/rs274ngc/interpmodule.cc:910`, `src/emc/rs274ngc/interpmodule.cc:936–938`, `src/emc/rs274ngc/interpmodule.cc:952–954`, `src/emc/rs274ngc/interpmodule.cc:959`, `src/emc/rs274ngc/interpmodule.cc:990`).
  - `(PY,…)` cannot hold parentheses ("Nested comment found", native).
  - Without `[PYTHON]` the source answers "Python plugin not initialized" (owed).
- **Serials (native, checked in the driver):** the driver's "DEBUG read" was TWO MDI lines (its key groups, `debug_read` in `33c20a50`), so each own MDI line and each mode switch takes ONE echo serial. v2's rules stand: a read line's serial is the last own + 1; DONE means `echo == serial`; a gap is foreign.
- **NR7 — read → AUTO → MDI → read (native, both configs).**
  - The values were identical: DEBUG, the sums, and in B Python.
  - Each switch takes ONE echo serial and REWRITES the var file: a new inode and mtime, from the synch's `save_parameters`.
  - No error-channel message and NO `ON_ABORT_COMMAND`: G91 and M50 P0 survived the switch to AUTO.
  - Source: the switch runs `emcTaskAbort()` on an empty `interp_list`, queues `PLAN_SYNCH`, then `emcTaskPlanSynch()` (`src/emc/task/emctask.cc:284–297`).
  - **§2.3's load-bearing rule now has its native case.**
- **The abort (native).**
  - An abort with an EMPTY queue ran the hook in MDI and in AUTO idle: G91 → G90, spindle and coolant off, override re-enabled. Its coordinate half is unprobed.
  - B8: an AUTO abort's tag restore re-selected the program's last fixture (G56 over a typed G55), with status and interpreter agreeing.
  - A program run to M2 re-sent the stale row (STAT G54 X5 R5 afterwards) — after it had moved in the interpreter's frame.
  - Both support §2.2's ALL for every abort.
- **For step 2 only:** exposure-2 measured three recovery candidates — MDI the fixture the status shows (R1), an M2-only program (R2), Unload (R3).

### 1.2 What the read confirms, per input

| Input | Read | Compared with | Role | Evidence |
|---|---|---|---|---|
| applied index | `#<_coord_system>` (no `[PYTHON]`); Python `origin_index` (with `[PYTHON]`) | STAT `g5x_index` | INCONSISTENT term | native A; shadowed in B |
| applied TRANSFORM at the standing point | P_i = `#<_x…_w>` | P_s = canon's own unoffset (`src/emc/task/emccanon.cc:226–239`) mirrored on (STAT `position` − eoffset) with STAT's tool, G5x, rotation and G92, converted to program units. **X and Y together through the rotation**, the other axes each | INCONSISTENT term | the stale TLO and stale R5 rows deviate (native); healthy R ≠ 0 equality owed (NR15) |
| interpreter self-check | `#<_abs_x…_c>` | (STAT `position` − eoffset) in program units | the read fails if unequal (canon ≠ `_setup`) | native for Z and X/Y at R5; eoffset and healthy R ≠ 0 owed (NR12, NR15) |
| TLO applied ≠ 0 | `#<_tool_offset>` | any STAT `tool_offset` ≠ 0 | INCONSISTENT term | native (the stale row: 0 vs 50) |
| stored active row | `#5201+20n … #5210+20n` | STAT `g5x_offset`, `rotation_xy` | NARROWING term (§1.4) | native |
| stored G92 | `#5210–#5219` → effective(stored) | STAT `g92_offset` | NARROWING term; under `DISABLE_G92_PERSISTENCE` no witness → counts as differing | native (wrong under the option) |
| stored rows, other | `#5201+20n…` | the var-file seed (§2.5) | the start's later selections | native |
| stored index | `#5220` | the applied index | calm state | native |
| units | `#<_metric>`, `#<_metric_machine>` | — | the conversion factor of P_s | native for the TLO under G20 |
| applied components separately | Python only | STAT component by component | the FULL class (option (i)) | native in B |

### 1.3 Transport facts
- **T-a, order — a native sample, not a bound.** Of 116 replies, 58 came in the same poll cycle right after the claim release and 58 one cycle earlier; none came later.
  - The source agrees: DONE only with `interp_list` empty (`src/emc/task/emctaskmain.cc:3553–3561`); the display written at issue (`src/emc/task/emctaskmain.cc:1663–1667`, `src/emc/task/emctaskmain.cc:254–272`); the status at the cycle's end (`src/emc/task/emctaskmain.cc:3571`).
  - **The deadline stays the rule** (§3.3 (i)).
- **T-b, a second reader (native): a second `error_channel()` reader takes messages away COMPLETELY** (10/10 went to the test reader, 0 to the gateway). It is a single-consumer queue.
  - With any other reader process the read gets "no reply" and fails closed.
  - So does the message center: a second reader steals every operator message, not only the read's.
- **T-c, room (native):** 300 DEBUG lines of about 80 characters all arrived — task waits for room (`src/emc/task/emctaskmain.cc:170–195`). The 8192-byte drop path was not reached.
- **T-d, DEBUG output (native):** `#5599` is 1 at boot (`src/emc/rs274ngc/rs274ngc_pre.cc:1223`) and writable. After `#5599=0`, DEBUG gives NO reply, silently → "no reply", fail closed. Q3-C8 asks whether the read may set `#5599=1` itself.
- **T-e, case (native):** kept.
- **Latency (native):** action start → message median 26 ms, max 45 ms at the gateway.
- **Line limit:** each DEBUG line under 240 bytes, sent and expanded (§3.5).
- **Owed before build:** multi-part reads and the per-packet cap with drain (NR13).

### 1.4 The choice for the applied components (Q3-C5)

**Per config — the recommendation.**
- **A config WITH `[PYTHON]` (the TWP sim): (i) the Python read.**
  - It reads every applied component exactly (`%r`) — the FULL class, compared with STAT component by component. There is no split residual.
  - `#<_coord_system>` is NOT used there: shadowing is native.
  - It costs no INI change; that config already runs Python in milltask.
  - The job is an MDI execution like R-LIVE (mode switch, synch, message through `interp_list`), recognised by its object (§3.1).
- **A config WITHOUT `[PYTHON]` (the operator's 3-axis, the 3- and 5-axis sims): (ii) the TRANSFORM compare**, narrowed by direct reads.
- **Adding `[PYTHON]` to the operator's machine** to get (i) there is NOT needed for step 1. It would be Q509-2, with its consequence: every `;py,` line in MDI or a program then runs Python inside milltask.

**(ii) The TRANSFORM compare.**
- **What it compares.** The interpreter's program point P_i against P_s, the program point the STATUS's offsets give for the same standing machine position. X and Y are compared together, through the rotation, by mirroring canon's own unoffset; never per component.
- **What it cannot hide** (native where marked): any difference in the transform at the current point.
  - the stale TLO row (native);
  - the stale R5 row (native: `#<_x>` 5.852531, `#<_y>` 9.526168 against P_s = (10, 10); the stored row X5 R5 against STAT 0 also differs);
  - a lost message of any single component;
  - a different index (its own term);
  - an applied G49 against a stale STAT TLO (`#<_tool_offset>`, native).

  It covers the DRO's work position exactly, and the program's beginning: every move before the first word that changes one component.
- **What it can hide — the SPLIT residual** (derived; native cases owed, NR16):
  - two components wrong by exactly opposite amounts (a compensated split);
  - two different rotations that happen to coincide at the current point (two rigid XY transforms with different angles agree at exactly one point);
  - differences below the bound of §3.6.
- **When a hidden split reaches the motion** (derived):
  - **Exposing words** replace one component with a value independent of the current split: G54…G59.3 selecting ANOTHER system (it loads the stored row), G10 L2 of the active row, G43 Hn, G43.1, G49, G92.1, G92.2, G92.3, G52, M2/M30.
  - **Neutral words** recompute from the current point: G92 X…, G10 L20, and G43.2 (additive). The preview's motion stays right at that word; the status DRO after them carries the error.
  - Nearly every program has a G43 after its M6, so gating "verified" on "no exposing word" would verify almost nothing. **Codex decides whether NARROWED's residual is acceptable.**
- **NARROWED class** — the direct reads that shrink the residual:
  - the applied index equals STAT (with `#<_coord_system>` only on a config without `[PYTHON]`);
  - `#<_tool_offset>` agrees with STAT;
  - the stored active row (axes + R) equals STAT `g5x_offset` + `rotation_xy`;
  - effective(stored G92) equals STAT `g92_offset` (no witness under `DISABLE_G92_PERSISTENCE`: counts as differing, so at most TOTAL there).

  **Why that narrows it** (derived; native case owed, NR16). A G10 L2/L20 or a G92-family word moves the interpreter's stored value WITH its applied one. So a lost row or G92 message shows in a stored compare; only a lost TLO message has no stored witness, and that shows in the transform. **What NARROWED leaves:** a TLO error cancelled EXACTLY by a row or G92 error whose stored value still equals the status — a lost TLO message plus a stored ≠ applied state (a direct `#52xx=` write, or M2 under `DISABLE_G92_PERSISTENCE`) with exactly the opposite value.
- **The compensating case that DOES occur, and where it lands** (a source model, owed natively, NR16).
  - The setup: the same tool; its TLO applied for the first time (G49 → G43 H1, TLO 0 → 50); the same point re-touched with `G10 L20 P1 Z0`.
  - Before: origin Z 100 (touched without a TLO), total 100. After: origin 50, TLO 50, total 100.
  - Both messages lost (an abort between their interpretation and execution): STAT keeps origin 100 + TLO 0 = 100. **Equal transforms, different split.**
  - The G10 moved the STORED row to 50 while STAT shows 100, so the stored compare fails → **TOTAL**, not NARROWED.
  - With a DIFFERENT tool and correct TLOs, re-touching leaves the origin unchanged; a lost TLO message then shows in the transform itself.
  - An AUTO abort's tag restore (`src/emc/rs274ngc/interp_convert.cc:2857–2895`) would re-apply G43 or G49 and change the case again.
- **TOTAL class** — the transform, the index and `#<_tool_offset>` agree, but a narrowing term differs. That is a healthy stored ≠ applied state or a compensated split; the read cannot tell which.
  - DISPLAY: confirmed.
  - START: not verified when the program has an exposing word (an unresolved sub counts as one), with the calm reason (§10). It is decided at the ENTRY when the TOTAL is still current (§5.2 B).
  - TOUCHOFF: admitted. The touch-off writes the active row's stored AND applied value, and its post-write read is the detector: G10 L20 sends the INTERPRETER's row to the status, so a compensated split shows as INCONSISTENT at once, before any move.

**(iii) Drop the input with a named residual.** It misses the native stale TLO and stale R5 rows — the defect itself. Dominated.

**(iv) Ask or refuse.** Every start after a program asks and every Z touch-off is refused, which breaks the routine. Dominated.

**Stored ≠ applied is a HEALTHY state (Q3-C6, extended).**
- In the native cases (`#5220=2`, `#5221=5`, M2 under `DISABLE_G92_PERSISTENCE`), the applied value and STAT agree. So a stored-vs-status mismatch is never INCONSISTENT; it is a CALM state with its consequence:
  - **Index** (`#5220` ≠ applied): nothing in this run. A restart loads `#5220`, and the TWP abort hook re-selects it (`examples/sim_config/twp/remap_subs/on_abort_twp.ngc:35–45`). The class can stay NARROWED.
  - **Active row:** the start's patch for the active row is the APPLIED value (the STAT overlay, `lcnc-gateway/status_runtime.py:1090–1095`). A program that re-selects that system loads the STORED one, so the class is TOTAL. A touch-off, or a select-away-and-back, heals it.
  - **G92** (under `DISABLE_G92_PERSISTENCE`): no witness, so TOTAL on such a config — after an M2 the stored value is natively wrong. G92.3 restores the stored value on both sides.

**Untested, each marked so that the 3-axis mm routine keeps working.** Every one of these can fail only CLOSED — a false INCONSISTENT or "no reply", never a false NARROWED:
- **Healthy R ≠ 0 equality:** owed before build (NR15). The stale R5 case already deviates natively.
- **Rows and G92 under G20:** owed before build (NR14). The TLO under G20 converts natively.
- **The `_abs` self-check's healthy equality, and the external offset (surface compensation, Z):** owed before build (NR12). P_s subtracts the reader's `axis.z.eoffset` (`lcnc-gateway/status_runtime.py:379`); a stale reader under compensation leaves Z UNCONFIRMED. If the self-check fails its native case, it is dropped and P_i stands alone.
- **Multi-part reads and the packet cap:** owed before build (NR13).
- **`;py,` without `[PYTHON]`:** unmeasured; it matters only if (i) is ever offered there.

---

## 2. Ledger deltas

### 2.1 Inputs (replaces v2 §2.1's `inputs` line)
```
inputs = index (applied) | index_stored (#5220)
       | transform (the APPLIED transform at the standing point: row + G92 + TLO, X/Y through R) | tlo_on (#<_tool_offset>)
       | row[1..9] (STORED table rows, whole: axes + R) | g92_stored (#5210–#5219)
       | tooltable (the table incl. #5400–#5413) | units
```
- **How the op table maps:** v2's `row[n]`, `g92` and `tlo` bookings map onto these inputs:
  - an effect on `tlo` opens `transform` and `tlo_on`;
  - on `row[n]` it opens `row[n]`, plus `transform` when n may be the active row;
  - on `g92` it opens `g92_stored` and `transform`;
  - on `index` it opens `index`, `index_stored` and `transform`.
- **Classes per need:**
  - **NARROWED** — the need's inputs are read, they agree with STAT, and the narrowing terms hold (§1.4);
  - **TOTAL** — they agree, but a narrowing term differs;
  - **INCONSISTENT** — index, transform or `tlo_on` differ from STAT;
  - **UNCONFIRMED** — open since the last read, or Z with a stale reader under compensation;
  - **FULL** — option (i), on a config with `[PYTHON]`: every applied component read and equal.
  - Where v2 or a table below says CONFIRMED, it means NARROWED (or FULL) for that need.
- **The needs** (v2 §3.2 and §4 amended):
  - **DISPLAY(axis):** `index`, `transform`, `tlo_on`. Confirmed at NARROWED or TOTAL.
  - **START:** DISPLAY's inputs + `index_stored` + `row[n]` for every row the program selects (opaque → all) + `g92_stored` + `units`. Verified at NARROWED (FULL); at TOTAL only when the program has no exposing word (§1.4).
  - **TOUCHOFF:** `index`, `transform`, `tlo_on`, `row[target]`, `g92_stored`. Admitted at NARROWED or TOTAL, with the post-write read as the detector (§5.1).

### 2.2 The NML-operation table (replaces v2 §2.2's table)

| NML op | Queue loss | Own effect (source) | Books |
|---|---|---|---|
| `abort` | `interp_list.clear()` (`src/emc/task/emctask.cc:225–262`) | <ul><li>`Interp::reset` (`src/emc/rs274ngc/rs274ngc_pre.cc:1765–1785`): no coordinate field</li><li>in AUTO, the state restore (`src/emc/task/emctask.cc:214–223`) runs `gen_settings`, which RE-SELECTS G5x, G43/G49 and the G92 apply state from the motion tag (`src/emc/rs274ngc/interp_convert.cc:2857–2895`)</li><li>`emcAbortCleanup` → `Interp::on_abort` → `ON_ABORT_COMMAND` (`src/emc/task/emctaskmain.cc:2108–2119`, `src/emc/task/emctask.cc:743–748`, `src/emc/rs274ngc/rs274ngc_pre.cc:2626–2646`)</li></ul> | **ALL** — always when a hook is configured (every shipped sim: `examples/sim_config/lcnc_suite_sim_3axis_xyz.ini:170`, `examples/sim_config/lcnc_suite_sim_5axis_xyzac.ini:64`, `examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini:98`) and always in AUTO; **CONFIRMED does not exempt it**. Outside AUTO with NO hook: only `Interp::reset`, so the queue-loss rule of §2.3 decides |
| `state(ESTOP)`, `state(ESTOP_RESET)`, `state(OFF)` | yes | `emcAbortCleanup` → the hook (`src/emc/task/emctask.cc:314–328`, `src/emc/task/emctask.cc:339–366`) | **ALL** |
| `state(ON)` | none | none (`src/emc/task/emctask.cc:330–337`) | nothing |
| `mode(MDI)`, `mode(AUTO)` | yes (`emcTaskAbort`, `src/emc/task/emctask.cc:284–297`) | <ul><li>`emcTaskPlanClose` / `Reset`: `Interp::close` → `reset` (`src/emc/rs274ngc/rs274ngc_pre.cc:242–262`)</li><li>`ON_RESET` = `drop_segments` (`src/emc/task/emccanon.cc:1033–1035`)</li><li>`unwind_call` restores only #1–#30 (`src/emc/rs274ngc/rs274ngc_pre.cc:1674–1728`)</li><li>`Interp::synch`: positions, units from canon, tool table, parameter file — no origin, axis or tool offset (`src/emc/rs274ngc/rs274ngc_pre.cc:2010–2062`)</li><li>its `load_tool_table` → `set_tool_parameters` refreshes `#5400–#5413` only (`src/emc/rs274ngc/rs274ngc_pre.cc:1329–1338`, `src/emc/rs274ngc/rs274ngc_pre.cc:2562–2587`)</li><li>its `write_settings` sets feed, speed and tolerances only (`src/emc/rs274ngc/interp_write.cc:210–221`)</li><li>units: unchanged while canon's unit equals the interpreter's — owed to NR7</li><li>no hook, no state restore</li></ul> | `tooltable`; for the coordinate inputs, the queue-loss rule of §2.3 — no own coordinate effect by source, and NATIVE (NR7, §1.1: values identical, no hook, one serial per switch, var file rewritten) |
| `mode(MANUAL)` | none (no `emcTaskAbort`, `src/emc/task/emctask.cc:274–282`) | none | nothing |
| `task_plan_synch`, `program_open`, `reset_interpreter` | — | conservative (R509: acceptable) | **ALL** |
| `mdi(text)` | — | §7 | §7 |
| `mdi(<read job>)` | — | none: DEBUG reads only (§3.1) — bound to the job OBJECT | nothing |
| `auto(AUTO_RUN)`; `auto(AUTO_STEP)` from idle | — | a program | **ALL** |
| `auto(AUTO_RESUME / PAUSE / STEP in a pause)` | — | nothing new | nothing |
| `tool_offset`, `load_tool_table` | — | the table and `#5400–#5413` change; the applied offset does not (Q2-C4) | `tooltable` — **never `tlo`** |
| `jog*`, `home`, `unhome`, `teleop_enable`, `spindle*`, coolant, overrides, `set_optional_stop` / `set_block_delete` | — | none | nothing |
| anything not listed | | | **ALL** |

### 2.3 The queue-loss rule (replaces v2 §2.3)
- A drop of a non-empty queue books ALL; a drop of an empty queue books nothing for queue loss. The OWN effect is booked by its own row, whatever the queue held.
- **"Empty" is proven only in the write thread**, by a fresh `stat.poll()` in the admit:
  - `echo_serial_number` == the last own serial;
  - execution DONE and the interpreter IDLE;
  - nothing booked in the ledger since the last confirmed read.
- **This rule is load-bearing.** Every start variant writes `mode(AUTO)` AFTER its read (§5.2). If that switch booked ALL, no start would ever be verified. The source path is in the table above; the native proof is NR7 (§1.1): read → AUTO → MDI → read gave identical values, no hook, one echo serial per switch.

### 2.4 Effects without a gateway write (replaces v2 §2.4's last bullet; (a) and (b) stay)
- **(c) Leaving ON.** The task leaves ON or enters ESTOP (HAL E-Stop, aux E-Stop, machine off). `emcTaskUpdate` then runs `emcAbortCleanup` with no gateway write (`src/emc/task/emctask.cc:689–700`, `src/emc/task/emctaskmain.cc:3413–3422`). The poller observes the state and books **ALL**, reason `left_on`.
- **(d) An own write ending in ERROR.** The MDI error path runs `emcAbortCleanup` (`src/emc/task/emctaskmain.cc:2268–2276`). This covers a failed read line and an `(ABORT,…)` line. Booked **ALL**, reason `own_error`:
  - at the completion, for a write that waits for one;
  - for a write sent without a wait, at its calc-lifetime observer's `error` outcome, set from the status by `decide` / `apply` (`lcnc-gateway/calc_lifetime.py:380–391`).

  (e) catches the interpreter's error text as well.
- **(e) An error-kind message on the channel** (anything but OPERATOR_TEXT/DISPLAY, `lcnc-gateway/gateway.py:1939`). It may come from a cleanup on another path: the interpreter error in AUTO (`src/emc/task/emctaskmain.cc:545–551`), the execution error (`src/emc/task/emctaskmain.cc:2565–2589`), or the motion/IO error (`src/emc/task/emctaskmain.cc:3495–3520`). Booked **ALL**, reason `error_path`.
- **The limit, named:** a cleanup whose state change or message the poller has not yet seen when an admit runs.
  - The touch-off admit's fresh poll sees (c).
  - (d) is booked at the completion, before anything else is written.
  - (e) is seen at the next poller cycle. Q3-C3: should the touch-off demand one drained cycle first?
  - A second error-channel reader process takes messages away completely (native, T-b). It blinds (e) as well as the read. The read fails closed ("no reply"); (e) does not — named.

### 2.5 The cache (amends v2 §2.5)
- **The read adopts into the LEDGER only.**
  - `_wcs_cache` keeps its own values: the var-file seed and the STAT overlay (`lcnc-gateway/status_runtime.py:1069–1095`).
  - The patches are built from it as `:.6f` strings (`lcnc-gateway/gateway.py:12151–12153`).
  - `run_start_check` compares those patches EXACTLY and G92 at 1e-9 (`lcnc-gateway/bulk_pipeline.py:659–663`).
- **So a read must never change what those comparisons see.**
- **Ledger vs cache** are compared with §3.6's printed-vs-double bound, each side against its OWN kind: equal → nothing; different → that input OPEN (`changed_outside_read`).
  - The ledger's STORED rows are compared with the var-file seed (`seed_wcs_cache`, `lcnc-gateway/status_runtime.py:1069–1089`).
  - The APPLIED side (index, transform) is compared with the STAT overlay (`lcnc-gateway/status_runtime.py:1090–1095`).
  - A healthy stored ≠ applied active row (§1.4) therefore never re-opens itself: the cache's active slot holds the applied value, and the ledger's stored row is checked against the file.

## 3. R-LIVE deltas

### 3.1 The read job — provenance is the object, not the text (MT509-02 B)
- **The job.** `coord_basis.read_job(need, nonce)` returns an immutable `ReadJob`: its lines, nonce, part count and need. Only `_coord_read()` writes it, under `_cmd_lock`, as an internal action (`_actions.internal("coord_read")`, `lcnc-gateway/calc_lifetime.py:225`).
- **The write.** Each line goes through `_cmd_blocking(…, effect=job)`. The booking accepts "nothing" only for `effect is job`, with `job` registered and the written text one of `job.lines`.
- **An imitation.** A client MDI with the same text is classified by §7, and its reply is never collected (unregistered nonce → passed on as an ordinary message, traced `coord.read_foreign_reply`).
- **The line form:** `(DEBUG,F5X<nonce16hex> <p>/<n> %.6f<ref> <ref> … END)`.
  - The `%.6f` directive sets the format for every following reference (`src/emc/rs274ngc/interp_convert.cc:1280`, `src/emc/rs274ngc/interp_convert.cc:1296–1330`).
  - References are numeric `#nnnn` or the built-in read-only names of §3.2 only. On a config with `[PYTHON]`, the read uses option (i)'s job form instead (§3.7).
- **A fresh position.** The read FORCES its switch to MDI (`set_mode(MDI, force=True)`, `lcnc-gateway/gateway.py:5442–5446`), so `#<_x…>` comes from the controller at the read (`Interp::synch`). The switch books by the queue-loss rule, before `rev0` (§3.3).
  - The machine must STAND (`motion_still_of`, `lcnc-gateway/command_policy.py:155`) at the switch and at the re-check.
  - STAT `position` must be unchanged between the two.
  - The read's own lines are comments and move nothing.
- **The existing books** the job's MDI passes through `_cmd_blocking` (`lcnc-gateway/gateway.py:5298–5326`):
  - a start claim (`_start_kind` "mdi") — kept;
  - the probe book — the job passes an explicitly EMPTY key set;
  - the toolsetter book — none;
  - the calc-lifetime observer (`input_write_class` "mdi") — kept (§5.3).

  The empty sets come from the job's provenance, not from a text scan.

### 3.2 Key union (replaces v2 §3.2's TLO line)
- **Per need, per §2.1:**
  - `#<_coord_system>` (applied index) and `#5220` (stored);
  - `#<_x>` … `#<_w>` for the configured axes, plus `#<_abs_x>` … `#<_abs_c>` for the configured X–C axes (the cross-check A);
  - `#<_tool_offset>`;
  - the stored rows the need names (axes + R);
  - `#5210–#5219` restricted to the configured axes;
  - `#<_metric>`, `#<_metric_machine>`.
- **The status side of the same moment:** the re-check poll's `position`, `g5x_index`, `g5x_offset`, `rotation_xy`, `g92_offset`, `tool_offset`, plus the reader's `axis.z.eoffset` when compensation is enabled.
- **`#5401–#5409` are not TLO.** They may be read as the `tooltable` input's spindle entry only.

### 3.3 Completion and reception — the collector (MT509-03)
1. **Register before the first write.** A `CoordReadRequest` (nonce, parts, Link seq, `cycle0 = _poll_cycle`) joins `_coord_reads` before the read's first write (the mode switch, if any). This is the shape of `_cal_drain_proof` / `DrainRequest` (`lcnc-gateway/gateway.py:8350–8367`).
   - **`rev0` is taken AFTER the read's own mode switch** and before its first line — as in v2. A read runs only when the need is open, so that switch may book ALL and bump `rev`. Taken earlier, `rev0` would make every such read fail its own check.
   - **A booking with an empty effect leaves `rev` unchanged.** Only a booking that opens something bumps it, so the read's own lines and a `mode(MANUAL)` never move `rev`.
2. **The one reader.** While a request is registered, the poller reads the channel to empty (`drain=True`, the way `_cal_wants_drain` asks, `lcnc-gateway/gateway.py:8313–8317`; `lcnc-gateway/status_runtime.py:1000–1030`). Its new step `_coord_read_cycle` runs right after `_cal_status_cycle` (`lcnc-gateway/gateway.py:1899–1904`) and BEFORE the consumers, the `nml.error` trace and the forwarding (`lcnc-gateway/gateway.py:1913–1940`).
   - It consumes OPERATOR_DISPLAY texts with a registered `F5X<nonce>` prefix and records each part with its cycle and Link. `F5X`, the hex nonce and `END` are matched CASE-INSENSITIVELY, whatever T-e finds.
   - Everything else passes on.
   - The read itself never calls `err.poll()`.
3. **Own completion.** Each line ends with `controller_done` "done" with `echo == serial` (v2 §3.3 step 2). An ERROR books ALL (§2.4 d) and fails the read.
4. **Reception.** Every part 1…n exactly once, each with `END`, in any cycle — before, at or after the DONE poll. The read completes when BOTH 3 and 4 hold. It fails when:
   - (i) the deadline `COORD_READ_REPLY_S` passes, counted from the last line's DONE poll: 1.0 s, two drains' worth (`ERR_DRAIN_S` 0.5, `lcnc-gateway/status_runtime.py:998`);
   - (ii) NOT adopted: a cycle begun after the DONE poll that drains empty with parts missing does not fail the read early. NR-src's order data is a sample (§1.3); the deadline stays the rule;
   - (iii) a part is duplicated, cut off (no `END`) or unparsable;
   - (iv) the Link changes.
5. **Re-check after reception.** In the read's own thread under `_cmd_lock`, a fresh `stat.poll()`:
   - `echo` == the last read line's serial;
   - the interpreter IDLE and execution DONE;
   - the same Link;
   - the machine standing, with `position` unchanged since the forced switch (§3.1);
   - the reader fresh when compensation is enabled.

   This poll is the STATUS side of every compare (§3.4). Then, **under the ledger lock in ONE step:** `rev == rev0` → adopt with the class of §3.4. Else nothing is confirmed.
6. **Texts by cause:**
   - `Coordinate read incomplete — no reply` for (i)/(ii). The help names DEBUG output off (#5599) and a full or shared error channel as POSSIBLE causes; none is asserted.
   - `Coordinate read incomplete — reply unreadable` for (iii) and for a failed self-check (§3.4).
   - `Coordinates changed during the read — try again` for the rev or Link check, and for a machine that moved between the forced switch and the re-check.

The provenance bindings of v2 §3.3 (own nonce, parts/`END`, exactly own echo, no higher serial, rev and Link) stay. Their limit is the one R509 named: a bounded provenance, not the exclusion of every parallel action.

### 3.4 The compare and the class (replaces v2 §3.4 where it used stored values as applied)
**INCONSISTENT terms** — the interpreter against the status, from the read and the re-check poll of the same standing moment:
- **The applied index vs `g5x_index`, exact.** From `#<_coord_system>` decoded, only on a config without `[PYTHON]`; from Python `origin_index` with it.
- **The TRANSFORM: P_i vs P_s.**
  - P_i = `#<_x…_w>`, the interpreter's program point.
  - P_s = canon's unoffset mirrored on (STAT `position` − eoffset) with STAT's `tool_offset`, `g5x_offset`, `rotation_xy` and `g92_offset` (`src/emc/task/emccanon.cc:226–239`), converted to program units by `#<_metric>` / `#<_metric_machine>`.
  - X and Y are compared TOGETHER, through the rotation; the other configured axes each. This is never a per-component compare of offsets.
  - The bounds are those of §3.6, in program units.
  - The mirror is pinned by golden tests against canon's function, as every RS274 mirror is.
- **`#<_tool_offset>` vs "any STAT `tool_offset` component ≠ 0".**
- **With `[PYTHON]` (option (i), §3.7):** NO named built-in is read — any of them can be shadowed (native for `_coord_system`). The index, P_i, `length_units` and every applied component come from the Python job, and each applied component is compared with its STAT field — the FULL class.

**The self-check (the read fails if it fails).**
- `#<_abs_x…_c>` must equal (STAT `position` − eoffset) in program units. That is the interpreter's `_setup` offsets agreeing with canon's: a Python remap could set `_setup` fields without a canon call.
- The check is native for Z, and for X/Y at R5 (pass 2: `#<_abs_x/y>` 10 / 10 = the machine position in the stale row). Its healthy cases under compensation and a healthy R ≠ 0 are owed (NR12, NR15). If one fails, the check is dropped and P_i stands alone.
- It also requires the machine standing, with `position` unchanged since the forced switch (§3.1).

**NARROWING terms** — the stored values against the status. They are never INCONSISTENT:
- the stored active row (axes + R) vs `g5x_offset` + `rotation_xy`;
- effective(stored G92) = `#5210` ? `#5211…` : 0 vs `g92_offset`. Under `DISABLE_G92_PERSISTENCE` it is natively wrong after M2, so it is no witness there: it counts as DIFFERING, and the class on such a config is at most TOTAL (no shipped INI sets the option).

**The class:**
- any INCONSISTENT term differs → **INCONSISTENT**;
- else FULL (with `[PYTHON]`), or every narrowing term agrees → **NARROWED**;
- else → **TOTAL**, with the differing narrowing term named;
- a stale reader under compensation → **UNCONFIRMED** for Z.

The owed native cases (healthy R ≠ 0, rows and G92 under G20, the self-check, the eoffset) can only produce a false INCONSISTENT or a failed read, never a false NARROWED (§1.4).

**Calm states, beside the class:** `#5220` ≠ the applied index, a stored active row ≠ STAT, a stored G92 ≠ STAT. Each is shown calm with its consequence (§1.4, §10).

**The other stored rows** are the interpreter's own, adopted, and compared only with the var-file seed (§2.5).

### 3.5 Length budget (MT509-03; NR-src: each DEBUG line under 240 bytes)
- **Sent.** `(DEBUG,F5X<16 hex> pp/nn %.6f` (37 bytes) + the references, each with one space + `END)` (4). So the references may take ≤ 199 bytes. The MDI limit is 254 (`lcnc-gateway/command_policy.py:1072`); 240 is the bound used.
- **Expanded.** MESSAGE keeps 254 characters (`src/emc/task/emccanon.cc:2362–2370`); 240 is the bound used.
  - Header `F5X<16> pp/nn ` = 26; trailer `END` = 3.
  - One value at `%.6f` with |v| < 1e9 is at most sign 1 + digits 9 + `.` + 6 + space = 18.
  - So at most **k = 11 values per line**: 26 + 11·18 + 3 = 227.
- **The packer** fills each line greedily under BOTH bounds. The named references are long: `#<_metric_machine>` is 18 characters.
- **The 3-axis START, G54 only: 19 values in 2 lines.**
  - Line 1 holds `#<_coord_system> #5220 #<_x> #<_y> #<_z> #<_abs_x> #<_abs_y> #<_abs_z> #<_tool_offset> #<_metric> #<_metric_machine>`: sent 158, expanded ≤ 227.
  - Line 2 holds `#5221 #5222 #5223 #5230 #5210 #5211 #5212 #5213`: sent 89, expanded ≤ 173.
  - Each further selected row adds 4 values.
- **Offsets Read:** all 9 rows on 3 axes = 51 values, 5 lines. On 9 axes = 120 values, 11 lines. Every line is its own MDI with its own DONE: about 26 ms median, 45 ms max per message (native, §1.3).
- **Overflow.** A value with |v| ≥ 1e9 overflows → `END` is missing → "reply unreadable". That is correct.
- **Guard:** the generator never emits a line over 240 bytes, sent or worst-case expanded.

### 3.6 Rounding and units (MT509-03)
- **Precision 6:** the suite's canonical form everywhere — the patches `:.6f` (`lcnc-gateway/gateway.py:12151–12153`), the var-file writes `%f` (`src/emc/rs274ngc/rs274ngc_pre.cc:1954`), the gateway's parameter MDI `#n=%.6f`.
  - More digits (`%.9f` is possible) would buy nothing without a source and a provenance (R509).
- **Numbers, not strings.** A stored row and its status value share a unit but not a double: the status value has been through the program-unit conversion and canon. A 1-ulp difference flips the 6th decimal at a half-way value, and `-0.000000` vs `0.000000` differ as strings. So every compare parses the token to a number.
- **Printed vs double** — a read token against a status or cache double: |t − d| ≤ 0.5e-6 + s, with the float slack s = 1e-9·max(1, |d|). It lets true differences up to about 0.5e-6 through.
- **Printed vs printed** — two 6-decimal forms made from different doubles: the ledger against a publication's patch string, or two reads. The bound is |a − b| ≤ 1e-6 + s, because two doubles 1e-12 apart can straddle a half-way value and print 1e-6 apart. It lets true differences up to about 1e-6 through.
- **Converted unit.** `#<_x…>` are in PROGRAM units, the status in machine units. P_s is converted into program units (native for the TLO: G20 + G43 H1 → 1.968504 against 50 mm). The bound is then applied in program units. Rows and G92 under G20 are owed before build (NR14); a fault there fails closed.
- **Where the bounds apply:** the read's compare (§3.4), the ledger-vs-cache check (§2.5) and publication equality (§6, Q2-C2).
- **The consequence, named:** differences up to about 1e-6 count as equal everywhere. That is below what the DRO and the patches show.

### 3.7 Option (i) — the Python job form (only on a config with `[PYTHON]`; needs Codex's approval)
- **Why it needs approval.** R509 called the binding a hint, not an approval of running Python in task. The config already runs Python in milltask, so no INI change is needed. Q3-C5 asks.
- **The form** (native in B2 / nrsrc2B): `;py,import emccanon;emccanon.MESSAGE('F5X<nonce> <p>/<n> %r %r … END' % (this.<f1>, this.<f2>, …))`.
  - It uses the `;` comment form, because `(PY,…)` cannot hold parentheses.
  - The message goes through `interp_list`, like DEBUG, and the same collector takes it (§3.3).
  - It is recognised by its job object, never by its text (§3.1).
- **The fields** (`src/emc/rs274ngc/interpmodule.cc:910–1011`):
  - `origin_index`;
  - `origin_offset_x/y/z` and the A/B/C/U/V/W origin offsets;
  - `rotation_xy`;
  - `axis_offset_*`;
  - `tool_offset` (an `EmcPose`: `.tran.x/y/z`, `.a` …);
  - `current_x/y/z` and the rotary and U/V/W currents (P_i);
  - `length_units`;
  - the stored values through `this.params[n]`.
- **Budget.** `%r` prints a round-tripping double of up to about 24 characters, so about 8 values per line under the 240-byte bound, sent and expanded. A 3-axis START is about 3 lines.
- **Compare.** Each applied component against its STAT field, converted by `length_units`, with §3.6's printed-vs-double bound (`%r` is exact, so the bound is only the conversion's). P_i against P_s as in §3.4. The stored values as narrowing terms are not needed: FULL has no split residual.
- **What it costs:**
  - an MDI execution like R-LIVE (mode switch, synch);
  - the job's own Python runs in milltask and is trusted like the TOPLEVEL it runs beside;
  - a TOPLEVEL that rewrites the `interpreter` class could mislead it (named).
- **If Codex says no:** a `[PYTHON]` config has no shadow-proof applied source. Its reads answer UNCONFIRMED: every start after a program asks, and a touch-off reads and is refused. Only the TWP sim is affected, not the operator's machine.

## 5. Admission deltas

### 5.1 Touch-off
- v2 §5.1's order stands. The basis stays a **hard** write condition, now in classes:
  - NARROWED (or FULL) and TOTAL admit the write;
  - INCONSISTENT and UNCONFIRMED do not — UNCONFIRMED reads first, as before.
- **The post-write read is MANDATORY and is the detector.** G10 L20 sends the INTERPRETER's computed row to the status. So a split error that the total hid before the write shows as INCONSISTENT in the post-write total at once, before any move. It is marked loud (§10).
- **TOTAL admits** because the touch-off writes the active row's stored AND applied value: a healthy stored ≠ applied row is healed by it.
- **Eoffset:** the touch-off is closed while compensation is active (the `probe` gate's `!eoffset`). Whether that gate's condition matches canon's "external offset applied" (`src/emc/task/emccanon.cc:3067–3069`) was not read — owed under NR12. Until then P_s subtracts the reader's eoffset in the touch-off too.

### 5.2 The start — S-F1′ (replaces v2 §5.2)

**A. A verification term, not a hard condition (MT509-04 A).**
- At the entry, the record and the write term, the basis enters the start verdict as ONE more verification term beside `run_start_check`.
- **The basis term by class (§3.4):**
  - NARROWED (FULL) + equal values → verified;
  - TOTAL → verified only if the publication's parse shows NO exposing word (§1.4: no G5x change away from the active system, no G10 L2 of the active row, no G43/G43.1/G49, no G92.1/.2/.3, no G52; an unresolved sub counts as exposing), else not verified with the calm reason (§10);
  - UNCONFIRMED → not verified ("basis open");
  - INCONSISTENT → not verified ("interpreter ≠ status").
- **An unchecked consent** redeemed at the entry (the agreed contract: `_sa.redeem` in WIP `_start_entry`) proceeds with UNCONFIRMED or INCONSISTENT:
  - the record keeps that class;
  - no verified Clear;
  - no read is forced on it.
- The other hard admissions stay unchanged: arm, run gate, kinematics, the toolsetter basis, the consent's binding.

**B. Where the read sits (MT509-04 B) — after the preparation, before the switch to AUTO.**
1. **Entry** (nothing written):
   - INCONSISTENT already known → asks there (`Interpreter: G54 · Status: G55`);
   - another term asks → asks, no read;
   - TOTAL still current (nothing booked since its read) with an exposing word in the program → the outcome is known: asks HERE (`G54 table differs from its applied offset`), with nothing written;
   - NARROWED, or TOTAL without an exposing word, still current → no ask from the basis. Step 3 reads only if the preparation books something after the entry.
   - UNCONFIRMED alone → no ask, "basis to be read";
   - UNCONFIRMED and the read is KNOWN not to run (ON+AUTO idle with the Q508-1b detour refused) → asks HERE, with nothing written — never at the record after the preparation.
2. **The preparation, as today:** `_start_guard` (`lcnc-gateway/gateway.py:6883`) and `_toolsetter_sync` (`lcnc-gateway/gateway.py:7886`). For RFL also `T M600`, `#3116=`, `G53 G0 Z0` and the positioning MDI with its WCS word (`lcnc-gateway/gateway.py:7162`, `lcnc-gateway/gateway.py:7186`, `lcnc-gateway/gateway.py:7207`, `lcnc-gateway/gateway.py:7228`). Their writes book per §2.2 and §7 (parameter MDI → ALL) — and that no longer matters, because the read follows them.
3. **The read** when the START need is UNCONFIRMED (open since the last read) and no redeemed unchecked proof covers the start: the forced `set_mode(MDI)` (§3.1), then R-LIVE. For RFL it runs after the positioning and BEFORE the spindle start (`lcnc-gateway/gateway.py:7238–7244`; `mode(MANUAL)` and `spindle` book nothing).
4. `set_mode(AUTO)` books nothing under §2.3's proven-empty rule (native, NR7).
5. **The record** (`_start_at_record` in the WIP): its verdict includes the basis term on the ledger NOW. INCONSISTENT or a failed read → the record's existing ask (rb `unsent`, nothing written — R502 MT502-01).
6. **The write term** (`_start_write_term`, in the write thread with the fence): the ledger `rev` equals the record's.
   - A booking in between → the existing downgrade (an unchecked proof covers it: not verified, consent kept) or an ask.
   - Then the AUTO_RUN BEGIN books ALL (§5.4).
- `cycle_start`'s order today is guard → sync → admit → `set_mode(AUTO)` → AUTO_RUN (`lcnc-gateway/gateway.py:9639–9657`). The read goes between the sync and the admit.
- **A Step from idle** has the same order (`lcnc-gateway/gateway.py:9304–9315`) and gets the read at the same place. A Step in a pause books nothing new (§2.2).

**Why there.** It needs no exemption for parameter MDI: the guard's `#3116=0`, the sync's values and RFL's own steps are all BEFORE the read. The only write between the read and the record is the switch to AUTO (§2.3). An ask the read causes lands at the record, an ask point the agreed contract already has after the preparation's writes.

**The alternative, named (§13):** the read at the entry (v2 S-F1) plus a proven narrower class for the gateway's own var-write jobs: `_apply_probe_vars_detail`'s `#n=%.6f` chunks for declared keys below #5000 (`lcnc-gateway/gateway.py:7694–7720`), whose effect is the parameter table only (`src/emc/rs274ngc/rs274ngc_pre.cc:362–365`). It needs its own native proof, and RFL stays unverifiable, because its positioning selects a WCS after the entry.

### 5.3 The existing calculation lifetime (MT509-04 C)
- **No exemption.** The read's `mode(MDI)` and its MDI lines are input writes as today (`lcnc-gateway/calc_lifetime.py:54–77`).
  - Each BEGIN calls `_calc_gen.began` (`lcnc-gateway/gateway.py:5367–5369`): every parse snapshotted before loses its right to publish.
  - Its internal action's end opens a drift decision (`lcnc-gateway/gateway.py:4939–4942`).
  - This is the mechanism the WIP's preparation writes already ride. The fence compares the published IDENTITY (program, version, source) at the AUTO write, not the generation (WIP `Generation.fence_if`).
- **A matching publication stays current:**
  - the read changes no value the drift edges compare;
  - the synch's var-file rewrite carries the same values;
  - `evaluate_wcs_offset_drift` compares values (`lcnc-gateway/bulk_pipeline.py:690–692`);
  - `run_start_check` evaluates every edge itself (`lcnc-gateway/bulk_pipeline.py:634–700`).

  Native proof owed (NR8): a read under an active publication leaves it active and the decision `none`.
- **A parse in flight at the read** is superseded and restarts. The verdict says "a parse runs or is pending" (`lcnc-gateway/bulk_pipeline.py:646–647`). **Value equality never adopts it** — the generation binding stays. Since the entry asks when a parse runs, this happens only when a drift edge fires between the entry and the read: honestly not verified.

### 5.4 The three moments (MT509-04 D)
1. **The confirmed start snapshot:** the ledger state (rev, canonical values, read id and time) the record's verdict read.
2. **The run record:** rb gets `basis = {class, rev, read: {id, at}, digest}`. It is immutable once the AUTO write is sent.
3. **From the AUTO_RUN BEGIN the ledger is ALL** (reason `run`) for a FUTURE start. It never rewrites (2), and (2) never makes the current basis look confirmed.

The display names which moment it shows (§10).

## 6. Publications (Q2-C2 adopted)
- **The rule.** A publication's current claim is restored by value equality (§3.6, printed vs printed) with a LATER confirmed read when all of these hold:
  - the whole actual need is equal;
  - the other check assumptions are equal;
  - the Link is the same;
  - nothing relevant has been booked since.
- **The restored claim** records the read (id, rev) it now rests on, so it is not merely flipped back to green.

## 7. The MDI scan — active comments first (replaces v2 §7's first row)
- **Before** stripping comments, every comment (`(…)` and `;…`, as the header scan, `lcnc-webui/src/viewer/programToolHeader.ts:118–135`) is classified case-insensitively after leading white space, as `convert_comment` does (`src/emc/rs274ngc/interp_convert.cc:1499–1597`).

| Comment form | Opens |
|---|---|
| `py,`, `pyrun,`, `pyreload` (`src/emc/rs274ngc/interp_convert.cc:1570–1581`) | **ALL** (Python runs) |
| `abort,` (`src/emc/rs274ngc/interp_convert.cc:1582–1588`) | **ALL** (the MDI error path runs the hook, §2.4 d) |
| `debug,` / `print,` / `log,` with a NAMED `#<…>` reference | **ALL** (a named reference may call Python, `src/emc/rs274ngc/interp_namedparams.cc:360–372`) |
| `debug,` / `print,` / `log,` with numeric `#n` only (`src/emc/rs274ngc/interp_convert.cc:1537–1559`) | nothing |
| `msg,` (`src/emc/rs274ngc/interp_convert.cc:1533–1536`), `logopen,` / `logappend,` / `logclose` (`src/emc/rs274ngc/interp_convert.cc:1560–1569`, `src/emc/rs274ngc/interp_convert.cc:1589–1593`), any other comment (`src/emc/rs274ngc/interp_convert.cc:1594–1597`) | nothing |

- **The code rows** of v2 §7 stay: the union of words per line, remaps and user M-codes → ALL. A parameter assignment of any kind → ALL. The gateway's own var writes are NOT exempted in v3 (§5.2 B).
- **The read job** is not scanned; it is recognised by its object (§3.1).

## 8. Codex's answers adopted
- **Q2-C1:** adopted as a narrowly named contract change, in the placement of §5.2 B:
  - hard gates and the expected program first;
  - another ask reason → no read;
  - a full re-judgement after the read;
  - an unchecked consent is never blocked by a forced read.
- **Q2-C2:** §6.
- **Q2-C3:** §10.
- **Q2-C4:** §2.2 (`tooltable`; no exemption for abort/state; no comment-form exemption).
- **Q2-C5:** §3.3: the one reader, the reception order and the bounded foreign observation, in the contract.

## 9. The routine — expectations with preconditions (replaces v2 §9)

**Preconditions** — a "no ask" below holds only with all that apply:
- **P1** the read classes the START need NARROWED, or TOTAL with no exposing word (§1.4, §3.4). This needs a fresh reader under compensation. Healthy R ≠ 0 and rows/G92 under G20 are owed before build; they fail closed (§1.4);
- **P2** the reply arrives: `#5599 > 0` (1 at boot) and no second error-channel reader process (T-b, T-d — native);
- **P3** the switch to AUTO after the read books nothing (§2.3; native, NR7);
- **P4** the shown publication was built from values equal to the read's, and no parse runs or is pending;
- **P5** no other start term asks (program text, toolsetter, check finished …);
- **P6** for a start from ON+AUTO idle: the operator allows the AUTO→MDI→AUTO detour (Q508-1b);
- **P7** the need is determinable (the program's rows from its parse; opaque → all rows: a longer read, no ask by itself);
- **P8** nothing is booked between the read and the record but the switch to AUTO.

| Sequence | Basis after it | The next Cycle Start — EXPECTED | Holds only if | Otherwise |
|---|---|---|---|---|
| Run to M2, then start | ALL (the AUTO write) | reads after the preparation → NARROWED → verified, no ask | P1–P8 | asks at the record (inconsistent, or no reply), or "check not finished" (P4). Under `DISABLE_G92_PERSISTENCE` (no shipped INI): always TOTAL — the G92 term has no witness (after M2: stored 0, applied 7, native) → asks when the next program has an exposing word |
| Abort during a run, then start | ALL (the hook; in AUTO also the state restore) | reads → (a) consistent → no ask; (b) dropped coordinate messages → INCONSISTENT → asks at the record. **Native (pass 2): the read-ahead `G10 L2 P1 X5 R5` aborted in the dwell — today the next plain program starts VERIFIED and runs at X14.0904 Y10.8335; with v3 the abort books ALL, and the read sees `#<_x>`/`#<_y>` = 5.852531 / 9.526168 (native) against P_s = (10, 10) → INCONSISTENT → asks** | P1–P8 | (b) also refuses every touch-off of the need until a status recovery (step 2). A later program that selects the SAME system re-sends nothing (`src/emc/rs274ngc/interp_convert.cc:1793–1798`); only another system and back, a G10 of the active row, or M2/M30 re-sends (native: STAT showed G54 X5 R5 after the plain program's M2 — once the program had moved in the interpreter's frame) |
| Touch-off, then start | the touch-off's reads → NARROWED | after the WCS re-parse publishes: no read, verified, no ask | P1 for TOUCHOFF, P3, P4 | "check not finished" until the re-parse publishes; a post-write INCONSISTENT asks |
| M600 tool measurement, then start | ALL (opaque job) | reads → the new TLO is inside the transform; `#<_tool_offset>` agrees → NARROWED → no ask | P1–P8 | a TLO the status did not get → the transform differs → INCONSISTENT → asks (native: exposure-1 B3; the pass-2 stale TLO row) |
| First start after homing (fresh gateway) | UNCONFIRMED | reads → no ask | P1–P8 | as above |
| Second attempt after an attempt that wrote NO AUTO_RUN (it asked, or was refused before the write) | as the attempt's read left it, minus bookings since | still NARROWED → no read → verified | P3, P4, P8 | the earlier INCONSISTENT asks again (or the unchecked consent proceeds) |
| A start after a REAL run (AUTO_RUN written) | ALL | as "Run to M2" | | |
| Typed `G10 L2 P3 X5`, then a program selecting G56 | `row[3]` OPEN | reads → the publication was built from the old G56 → re-parse → "check not finished", then no ask | P1, P4 | — |
| Typed MDI with an active comment, a parameter or a remapped code | ALL | reads → no ask | P1–P8 | — |
| Jog, spindle, coolant, overrides, homing, MANUAL switch, machine ON between | unchanged (§2.2) | unchanged | — | — |
| E-Stop, machine off, an error message between | ALL (§2.4 c/e) | reads → no ask | P1–P8 | — |
| The Offsets **Read** between | NARROWED | no read at the start | P3, P4, P8 | — |
| A typed `#5221=5` (or any stored ≠ applied state) between | ALL; the read then gives TOTAL (native: stored 5, applied 0) | asks with `G54 table differs from its applied offset` when the program has an exposing word | — | a touch-off or a select-away-and-back heals it |

**The ask paths beyond "abort with dropped messages"** (R509 D):
- a failed read (no reply, unreadable, changed during the read, Link change);
- DEBUG output off, which shows only as "no reply";
- a booking between the read and the record (P8);
- a publication not matching (P4);
- a TOTAL class with an exposing word (a stored ≠ applied state, or a compensated lost message the read cannot tell from one);
- a stale reader under compensation (Z UNCONFIRMED); a false INCONSISTENT, should one of the owed cases NR12, NR14 or NR15 fail;
- a second error-channel reader process, or `#5599=0` (both native: "no reply");
- Q508-1b refused (P6): every start from ON+AUTO idle after a run asks.

**The cost of the no-ask routine.** One read per start after any program, MDI, abort, error or E-Stop:
- a mode switch to MDI if needed;
- one MDI line per 11 values (19 values = 2 lines on a 3-axis G54 start);
- up to one poller cycle and drain for the reply.

The latency is native: about 26 ms median, 45 ms max per line (§1.3). The visible mode flicker is still owed (NR2).

## 10. Display and texts (Q2-C3; amends v2 §10)
- **While a program or MDI runs:** no basis mark on any DRO. The running state is its own.
- **At idle, with the need of `DISPLAY(axis)` UNCONFIRMED** (after every run, abort, error or E-Stop until a read):
  - a CALM line `Work position not confirmed` on the viewer DRO card and the Setup strip DRO: `--fg-muted`, a line in `.hudNotes`, NOT a `.hudWarn` and not counted in `hudWarnCount`;
  - a HelpIcon.
  - If `.hudNotes` has no calm line form, it goes into `style.css` first (CLAUDE.md "New patterns").
- **INCONSISTENT** stays loud: a `.hudWarn` line, the strip and Offsets marks, `Interpreter: G54 · Status: G55`. A post-write INCONSISTENT after a touch-off is shown the same way, at once.
- **Stored ≠ applied (healthy, §1.4)** gets a CALM line in Offsets and on the DRO card (`--fg-muted`, never `.hudWarn`), each with a HelpIcon naming its consequence:
  - `Stored fixture G55 · in effect G54` (a restart or the TWP abort hook switches to the stored one);
  - `G54 table differs from its applied offset` (a program that re-selects G54 loads the table) — also the start's ask reason at TOTAL;
  - `Stored G92 differs from the G92 in effect` (G92.3 restores the stored one).
- **The three moments, each named where shown:**
  - the shown result's basis: `Check basis: values read 10:42`;
  - the run's start in the run record / start message: `Run started on values read 10:42`;
  - the live ledger at idle: `Current: not confirmed`.
- **v2 §10's "protected by the read" is limited** to the real read paths: the touch-off when UNCONFIRMED, and the start's read when its need is not NARROWED. With a NARROWED basis no read runs; the protection is then the bookings, the write-thread admit and the foreign detector with its named limits (§2.4).
- **Withdrawn:** `Coordinates not readable — DEBUG output is off (#5599)` — it asserted a cause.

**Texts (≤ 60):**
- `Coordinate read incomplete — no reply`
- `Coordinate read incomplete — reply unreadable`
- `Coordinates changed during the read — try again`
- `Work position not confirmed`
- `Check basis: values read 10:42`
- `Run started on values read 10:42`
- `Current: not confirmed`
- `Stored fixture G55 · in effect G54`
- `G54 table differs from its applied offset`
- `Stored G92 differs from the G92 in effect`

Unchanged from v2: `Interpreter: G54 · Status: G55`, `Check basis not confirmed`, `Tool length not confirmed`, `Coordinate basis not confirmed`, `Not read since the last program`, `Touch-off refused — controller coordinates inconsistent`, `Offsets not readable in AUTO — switch to MDI`.

**Help (≤ 120):**
- "no reply": `No answer from LinuxCNC. DEBUG output off (#5599) or another program reading its messages can cause this.`
- "Work position not confirmed": `The offsets LinuxCNC applies were not read since the last program. A start, touch-off or Read confirms them.`
- "G54 table differs…": `G54's table was changed without selecting it again. A program that selects G54 again uses the table.`
- "Stored fixture…": `The stored fixture differs from the one in effect. A restart of LinuxCNC selects the stored one.`

## 11. Guards, mutations, native cases (additions to v2 §11)

### 11.1 Unit / gateway (pure `coord_basis.py`, `_cmd_blocking` and the poller with `fake_linuxcnc`)
- **G1** NARROWED, then `abort` with a hook configured → ALL. Red against v2's "drops nothing ⇒ books nothing". Also an `abort` in AUTO without a hook → ALL (the state restore).
- **G2** after the read, `mode(AUTO)` with the proven-empty poll → nothing. With `echo ≠` the last own serial, or a booking since → ALL. `mode(MANUAL)` and `state(ON)` → nothing.
- **G3** leaving ON observed by the poller → ALL `left_on`. An own MDI completing in ERROR → ALL. An error-kind message → ALL.
- **G4** MDI comments, each case:
  - `(PY,…)`, `;py,…`, `(pyrun,…)`, `(abort,x)` → ALL;
  - `(debug,#<_foo>)` → ALL;
  - `(debug,#5221)`, `(msg,hi)` and a plain comment → nothing.
- **G5** the own read job → nothing. A client MDI with byte-identical text → the §7 scan, and its reply passes on as a message, never completing a job.
- **G6** the collector, each case:
  - the reply before the DONE poll;
  - the reply queued but read only in the cycle after DONE;
  - parts split over two drained cycles;
  - a Link change between;
  - a rev bump between reception and adoption;
  - the deadline → "no reply";
  - a part without `END` → "reply unreadable";
  - a duplicate part → fail;
  - another nonce → passed on;
  - a read whose own `mode(MDI)` booked ALL still confirms (`rev0` taken after it);
  - a lower-case `f5x…end` reply is collected.
- **G7** no second `err.poll` caller: a static guard that `read_errors` is the only one.
- **G8** the length budget: every generated line ≤ 240 bytes sent AND worst-case expanded; ≤ 11 values per line; the 3-axis G54 START packs into 2 lines; 9 rows × 9 axes into 11.
- **G9** rounding:
  - a status double `1.0000004` vs the token `1.000000` → equal;
  - `1.0000016` vs `1.000000` → unequal;
  - `-0.000000` vs `0.0` → equal (red against a string compare);
  - the half-way case: two doubles `1.0000004999999` and `1.0000005000001` print as `1.000000` and `1.000001` → equal under the printed-vs-printed bound;
  - a read never changes `_build_wcs_rotation_patches()`'s output.
- **G10** an unchecked consent with UNCONFIRMED → proceeds, record unverified, no Clear. Red against v2 §5.2's touch-off admit. Without consent, INCONSISTENT at the record → ask, rb `unsent`.
- **G11** the order: guard `#3116=0` and the toolsetter sync BEFORE the read → the read confirms after them. An injected booking between the read and the record → not verified.
- **G12** a parse in flight at the read → superseded; the verdict "a parse runs or is pending"; never adopted by value equality.
- **G13** the three moments: after AUTO_RUN the ledger is ALL; the record keeps its read id; at idle after the run, `Current: not confirmed` and the calm DRO line; no DRO mark while running.
- **G14** `tool_offset` / `load_tool_table` book `tooltable`, never `tlo`.
- **G15** the native cases as models (NR-src values):
  - `#5220=2` with G54 active → index NARROWED-eligible, calm `Stored fixture G55 · in effect G54`, never INCONSISTENT;
  - the five healthy TLO rows of §1.1 → each consistent through the transform, never through `#540x`;
  - exposure-1 B3 (applied 47.69, STAT and `#5403` 50) → INCONSISTENT by the transform;
  - the pass-2 stale TLO row (applied G49, STAT 50) → INCONSISTENT by `#<_tool_offset>` and by the transform;
  - the pass-2 stale R5 row (`#<_x>`/`#<_y>` 5.852531 / 9.526168, `#<_abs_x/y>` 10 / 10, P_s = (10, 10), equal codes) → INCONSISTENT; red against a code-only term;
  - with `[PYTHON]`, `#<_coord_system>` = 999 → never used; the index comes from Python `origin_index`;
  - `#5221=5` with G54 active → TOTAL with `G54 table differs…`, never INCONSISTENT;
  - any read under `DISABLE_G92_PERSISTENCE` (after M2: stored 0, applied 7) → at most TOTAL, never INCONSISTENT by the G92 term.
- **G16** the split residual:
  - the first-TLO re-touch (origin Z 100 without a TLO; then G43 H1 = 50 and `G10 L20 P1 Z0` at the same point, both messages lost): interpreter 50 + 50, STAT 100 + 0 → equal transforms, stored row 50 ≠ STAT 100 → TOTAL, not NARROWED;
  - the same with a different tool (correct TLOs, the origin unchanged, the TLO message lost) → INCONSISTENT by the transform;
  - a start at TOTAL with a G43 in the program → not verified;
  - without any exposing word → verified;
  - an unresolved sub → exposing.
- **G17** the transform compare:
  - X/Y compared jointly through R (the golden mirror of canon's unoffset);
  - the self-check `#<_abs_…>` ≠ the machine position → "reply unreadable";
  - `position` changed between the forced switch and the re-check → "changed during the read";
  - G20 → P_s converted (1.968504 in against 50 mm → equal);
  - a stale reader under compensation → Z UNCONFIRMED.
- **G19** the entry: a current TOTAL with an exposing word asks at the entry with nothing written; a current NARROWED does not read.
- **G18** the touch-off: at TOTAL it writes; a post-write transform that differs → INCONSISTENT and the loud mark.

### 11.2 Mutations
- **MF32** abort/state booking nothing while NARROWED (the hook ignored).
- **MF33** the mode-switch exception without the proven-empty poll.
- **MF34** comment-only → nothing for PY/ABORT.
- **MF35** the read exception by text (the F5X prefix) instead of the job object.
- **MF36** the collector requiring reception before the DONE poll (v2's window).
- **MF37** a second `err.poll` in the read.
- **MF38** adoption without the post-reception re-check.
- **MF39** `#5401–#5409` as the applied TLO.
- **MF40** `#5220` as the applied index.
- **MF41** the touch-off admit used at the start (an unchecked consent blocked).
- **MF42** the read at the entry with the preparation's bookings dropped "because the same start caused them".
- **MF43** value equality adopting a parse in flight.
- **MF44** the "no reply" text naming #5599 as the cause.
- **MF45** the read writing rounded values into `_wcs_cache`.
- **MF46** `rev0` taken before the read's own mode switch (every read from MANUAL or AUTO fails).
- **MF47** the compare on strings instead of numbers (`-0.000000`, the half-way case).
- **MF48** the entry not asking when the read is known not to run (the ask moved after the preparation's writes).
- **MF49** a stored-vs-status mismatch classed INCONSISTENT (the healthy `#5221=5` / `#5220=2` states alarm).
- **MF50** TOTAL treated as NARROWED (the re-touch case verified).
- **MF51** X and Y compared per component instead of jointly through R (the stale R5 row passes under rotation).
- **MF52** the machine form without the eoffset, or without the standstill and unchanged-position check.
- **MF53** the touch-off without its mandatory post-write read.
- **MF54** §2.5 comparing the stored active row with the STAT overlay (it re-opens forever).
- **MF55** `#<_coord_system>` used on a config with `[PYTHON]` (the native 999).
- **MF56** effective(stored G92) counted as a witness under `DISABLE_G92_PERSISTENCE` (the native M2 case reaches NARROWED).
- **MF57** P_s left in machine units under G20.

### 11.3 Native (VM sim)
- **NR-src** (the start agent): run, §1 (A2, B2, exposure2).
- **NR7** read → `mode(AUTO)` → `mode(MDI)` → read: DONE natively (pass 2, A and B; §1.1). Still owed: the TWP config.
- **NR8** a read under an active publication leaves it active and the drift decision `none`.
- **NR9**
  - an abort from NARROWED with each shipped hook (`subroutines/probe_basic/on_abort.ngc:3–12`; the TWP hook re-selects through G59.x, `examples/sim_config/twp/remap_subs/on_abort_twp.ngc:35–45`), then a read;
  - an `(abort, x)` MDI → the hook ran (observed as the error message);
  - a `;py,…` line on the TWP config (the `(PY,…)` form cannot hold parentheses).
- **NR10** the routine table, row by row with its preconditions (replaces NR3).
- **NR11** a false VERIFIED under equal codes with a stale row: DONE natively (pass 2) — today it starts verified (§1.0). Owed: the same case through the built read, which must answer INCONSISTENT.
- **NR12** the `#<_abs_…>` self-check's healthy equality, and the external offset (surface compensation) on the 3-axis: P_s with the reader's `axis.z.eoffset`; whether the `probe` gate's `!eoffset` matches canon's "offset applied" — owed before build.
- **NR13** multi-part reads (5 and 11 lines) and the per-packet cap with drain — owed before build.
- **NR14** G20 on a mm machine with rows and G92 non-zero (the TLO converts natively) — owed before build.
- **NR15** a HEALTHY rotation ≠ 0: the mirrored unoffset must answer equal (the stale R5 row already deviates, natively); also non-Z TLO components — owed before build.
- **NR16** the split cases: the first-TLO re-touch (→ TOTAL); a stored ≠ applied row plus a lost TLO message (→ NARROWED's residual, to see it hide); the exposing and neutral words of §1.4, each.
- NR2 (the mode flicker), NR4, NR5 and NR6 of v2 stay. NR1 is replaced by NR-src, NR14 and NR15.

## 12. Questions

### For Codex
- **Q3-C1 (the placement, §5.2 B):** the read moves from the entry to the end of the preparation, after `_start_guard`, `_toolsetter_sync` and RFL's positioning, and before `set_mode(AUTO)`. Asks it causes come at the record — an ask point that already follows preparation writes. Is that the "later, narrowly bounded read after the preparation" of R509 B, and acceptable as the narrow start-contract change of C1?
- **Q3-C2 (§2.3):** `mode(AUTO)` / `mode(MDI)` book nothing iff the write thread's fresh poll proves the queue empty (echo == the last own serial, DONE, IDLE) and nothing has been booked since the read. The source path is in §2.2, and NR7 is now native (identical values, no hook, one serial per switch). Acceptable as the narrow exception?
- **Q3-C3 (§2.4):** paths without a gateway write are observed as leaving ON, an own ERROR completion, or an error-kind message → ALL, with the named limit. Should the touch-off additionally demand one drained poller cycle before its write?
- **Q3-C4 (§7):** the passive list — `msg,`, plain, `logopen` / `logappend` / `logclose`, and `debug` / `print` / `log` with numeric references only. Enough?
- **Q3-C5 (§1.4) — the choice by config.** NR-src found no direct applied row, G92 or TLO source without `[PYTHON]`, and `#<_coord_system>` shadowed with it.
  - v3 recommends **(i) the Python read where `[PYTHON]` already exists** (§3.7 — this needs your explicit approval of running Python in task; without it those configs answer UNCONFIRMED) and **(ii) the TRANSFORM compare everywhere else**. (iii) misses the native stale rows, and (iv) breaks the routine.
  - (a) Is **NARROWED** enough for "basis verified" at a start and for admitting a touch-off? It is the transform at the standing point, X/Y jointly through R, plus the direct narrowing reads. Its residual is a split cancelled EXACTLY — a TLO error against a row or G92 error whose stored value still equals the status — or two rotations coinciding at the current point.
  - (b) Is the **TOTAL** rule right?
    - DISPLAY is confirmed.
    - A start is verified only without an exposing word, else it asks — at the entry when the TOTAL is still current.
    - A touch-off is admitted, with the mandatory post-write read as the detector.
  - (c) Is the list of exposing vs neutral words (§1.4, derived) complete?
- **Q3-C8 (new, T-d):** `#5599=0` makes every read "no reply", silently. May the read job write `#5599=1` itself — a parameter, no coordinate effect, booked like the job — or does the operator's own setting stand, and the read keeps failing with its help text?
- **Q3-C6 (§1.4) — proposed answer:** stored ≠ applied is a CALM state of its own, never INCONSISTENT, for the index, the active row and G92 alike. In all three native cases the applied value and STAT agree. Each state shows its consequence: a restart or the TWP hook, a re-selection, a G92.3. The active-row and G92 states make the class TOTAL; the index state does not. Agreed?

### For the operator (Claude asks)
- Q508-1a, 1b, 2, 3 and 4 stay (v2 §12).
- **Q509-1 (new):** after every program, abort or E-Stop, the work DRO shows a calm `Work position not confirmed` at idle until the next start, touch-off or Read (Q2-C3). Acceptable?
- **Q509-2 (only if the exact read should also run on the operator's machine; step 1 does not need it):** may the machine INI carry a `[PYTHON]` section (an empty TOPLEVEL suffices)? It would give an exact read of every applied offset. Said plainly: every `;py,` line in MDI or a program then runs Python inside LinuxCNC.

## 13. For the coordinator — the one choice with start-contract weight
- **The read moves from the ENTRY to the end of the PREPARATION** (§5.2 B).
  - The entry writes nothing when it asks, as agreed.
  - The read's own ask lands at the record — an existing ask point that already follows the guard and sync writes.
  - It needs no exemption for parameter MDI and covers RFL's WCS-selecting positioning.
- **The alternative:** keep v2's entry read and prove a narrower class for the gateway's own `#3116` / toolsetter var jobs. RFL then stays unverifiable.
- **The load-bearing claim in every variant** is §2.3 (the switch to AUTO after the read books nothing) — now NATIVE (NR7).
- **The decisive choice now** is Q3-C5: (i) the Python read where `[PYTHON]` exists; (ii) the TRANSFORM compare everywhere else, narrowed by direct reads, with the split residual named for Codex.
- **The defect is native** (§1.0): with equal codes and a stale row, a start runs VERIFIED at X14.0904 Y10.8335 where the preview showed X10 Y10.
- **Owed before build:** NR12 (the self-check, eoffset), NR13 (multi-part reads), NR14 (rows/G92 under G20), NR15 (healthy R ≠ 0). Each fails closed.

# F-G5X step 1 — plan v4: DELTA on v3 after Codex R510

**Status:** delta for Codex. No build, no browser or native run of my own in this round.
**Base:** development `dbd14cab`; LinuxCNC 2.9.4 upstream from `~/claude-work/bg/upstream-2.9.4/`. Every `file:line` is checked with `~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v4.md`. Start-WIP references are named by commit and function, not as `file:line`.
**Binding:** v1, v2, v3 (`maschinentag.r510.plan-fg5x-v3.md`), Codex R510 (end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `6ed2fb0b`), and this delta. Where they differ, this delta wins.

**The decision this plan follows (coordinator, after R510).**
- Codex's SMALLER build scope:
  - the full component read via Python on configs that already have `[PYTHON]` (R510 C5(i): approved);
  - the ledger, the collector and the last admission;
  - the point compare as a DETECTOR only;
  - an honest unconfirmed rest.
- No further search for a confirmation without a full read: three rounds each offered one, and each was refuted.
- "The routine must not ask" is dropped for configs WITHOUT a full read. Whether the operator's machine asks is the operator's decision (Q509-2: `[PYTHON]` on the machine).

## 0. The deciding table — per config, per ledger state

**The ledger states, per need:**
- **CONFIRMED** — a full component read (§2) with the need's values bound and nothing booked since. Only a config with `[PYTHON]` can reach it.
- **UNCONFIRMED** — open since the last read, never read, a failed read, or any state on a config without `[PYTHON]`.
- **INCONSISTENT** — a full read or the point detector found the interpreter ≠ the status.

**(a) A config WITH `[PYTHON]`** (the TWP sim; any machine whose INI carries the section):

| Ledger state | START (Cycle Start, Step from idle) | TOUCH-OFF / ZERO | DRO at idle |
|---|---|---|---|
| CONFIRMED, and the publication's inputs equal the read (§2.4), including the STORED rows the program selects later | verified — no read, no ask | admitted: the drain (§6.3), the write-thread admit (rev, Link, fresh poll); the post-write full read is the effect proof | no mark |
| CONFIRMED, but a publication input ≠ the read (e.g. stored G54 X5, patch X0, and the program selects G55 then G54) | not verified: "check not finished" while a re-parse runs, else asks; consent → unverified | admitted — its need does not include the publication | no mark |
| UNCONFIRMED | the full read after the preparation, before `set_mode(AUTO)` (§6.1): CONFIRMED → as row 1; INCONSISTENT or a failed read → asks at the record (no AUTO_START written). With a redeemed `unchecked` consent the read still runs: failed → proceeds unverified; INCONSISTENT → asks again (Q4-C2) | the full read first: CONFIRMED → admitted; anything else → refused | calm `Work position not confirmed` |
| INCONSISTENT (known) | asks at the entry, nothing written; consent → unverified | refused | loud `Interpreter: G54 · Status: G55` |

**(b) A config WITHOUT `[PYTHON]`** (the operator's 3-axis machine, the shipped 3- and 5-axis examples):

| Ledger state | START | TOUCH-OFF / ZERO | DRO at idle |
|---|---|---|---|
| UNCONFIRMED — **the only state (b) reaches without a finding**; no read can confirm here | asks at the ENTRY, nothing written (`unverified`; WIP `4abc58ba` `start_ask.consent_reason`, lines 153–174). With consent → the preparation → the point detector (§3): agreement → runs unverified, the record names "point agreed, basis not confirmed"; disagreement → INCONSISTENT → asks again at the record (proposed, Q4-C2) | **refused, in every state** — no narrower contract is provable before the write (§1) | a calm standing line; the detector's point statement only while the machine stands at its point (§3.2) |
| INCONSISTENT (detector) | asks at the entry with the finding; consent → unverified | refused | loud |

**Both configs, run from line (`start_line > 0`):** asks `run_from_line` at the entry, offering `unchecked` only (WIP `4abc58ba` `start_ask.consent_reason` / `offers_for`, lines 160–161 and 176–190). There is no read; the run is unverified (P6-d0). RFL is OUT of the verification promise (§6.2).

**The coordinator's reading of R510 for (b), sharpened.**
- Touch-off and Zero are refused not only after every program, abort and gateway start but in EVERY state: (b) has no event that can reach CONFIRMED.
- A gateway start is UNCONFIRMED, and so is a fresh LinuxCNC; only a full read confirms.
- **So step 1 as scoped cannot go onto a deployed machine without `[PYTHON]`** — it would switch off Touch-off and Zero there, which `dbd14cab` offers always.
- §1 examines the narrower contract MT510-02 leaves open. The answer is **no**.
- §1.4 lists what remains.

### 0.1 The routine on (a), restated (replaces v3 §9 for (a); v3 §9 is WITHDRAWN for (b))
This is what Q509-2 = yes buys on the operator's machine. Each "no ask" holds only if:
- the Python read succeeds;
- the switch to AUTO books nothing (NR7, native);
- the publication's inputs equal the read (§2.4);
- no other start term asks;
- for a start from ON+AUTO idle, Q508-1b allows the detour.

| Sequence | Basis after it | The next Cycle Start |
|---|---|---|
| Run to M2 | ALL | reads after the preparation → CONFIRMED → verified, no ask |
| Abort during a run | ALL (the hook; in AUTO the state restore) | reads → consistent: no ask; dropped coordinate messages → INCONSISTENT → asks; the touch-off refused until a status recovery (step 2) |
| Touch-off | its post-write full read → CONFIRMED | after the WCS re-parse publishes: no read, verified; before: "check not finished" |
| M600 | ALL (opaque job) | reads → the exact applied TLO → no ask |
| First start after a gateway or LinuxCNC start | UNCONFIRMED | reads → no ask |
| **A jog, a manual spindle start or homing between** | each switches MDI → MANUAL first (the jog: `set_mode(MODE_MANUAL)` in `_start_jogs`, `lcnc-gateway/gateway.py:5697`) → the dispatcher path (§4.2) → OPEN until NR17 proves the empty switch | reads again (one extra read); after NR17: unchanged. The touch-off after a jog reads first anyway. v3 §9's "jog between: unchanged" was wrong until NR17. |
| Coolant, overrides between | unchanged | unchanged |
| Typed `G10 L2 P3 X5`, then a program selecting G56 | `row[3]` open | reads → the publication's G56 patch differs from the read stored row → re-parse → "check not finished", then no ask |
| A stored ≠ applied active row (e.g. `#5221=5`) | open (a parameter assignment) | reads → CONFIRMED. A program that re-selects that system after another → not verified (§2.4) → asks; a program staying in it → verified |
| A second attempt after one without AUTO_RUN | as left, minus bookings since | still CONFIRMED → no read |
| E-Stop, machine off, an error message between | ALL | reads → no ask |
| Run from line | — | asks `run_from_line`, unverified (P6-d0) |

**On (b), every start asks** (`unverified`, at the entry), and Touch-off and Zero are refused — in every state.

---

## 1. Is there a narrower touch-off contract on (b)? — No

### 1.1 What a plain Z touch-off computes (source)
- **The gateway writes `G10 L20 P<applied index> Z<v>`.** The interpreter takes the current point in system P (`find_current_in_system`, `src/emc/rs274ngc/interp_find.cc:467–530`) and sets the stored row: `z_new = cz + stored_row_z(P) − v` (`src/emc/rs274ngc/interp_convert.cc:4284`). For the active P it is also applied, and `SET_G5X_OFFSET` is sent (`src/emc/rs274ngc/interp_convert.cc:4324–4364`).
- **`cz` = the applied program Z + applied G92 Z + applied origin Z − stored row Z(P) − the STORED G92 Z when `#5210` is set** (`src/emc/rs274ngc/interp_find.cc:517–527`). With m the machine Z (program units):
  - z_new = m − tlo_i − eff_stored_g92 − v;
  - **the interpreter then reads** v + (eff_stored_g92 − g92_applied);
  - **the status DRO**, once the new row has arrived, reads v + (tlo_i − tlo_s) + (eff_stored_g92 − g92_s).
- **For the touch-off to do what the operator asks, BEFORE the write the following must hold:**
  1. the applied index is the target (`P<applied index>`);
  2. **the applied G92 Z equals the effective STORED G92 Z** — for the interpreter's result;
  3. tlo_i + eff_stored_g92 = tlo_s + g92_s — for the DRO's result.

### 1.2 What (b) can read before the write
- **The applied index:** `#<_coord_system>` (native; shadow-free without `[PYTHON]`).
- **The applied SUM per axis** (applied origin + G92 + TLO), as `#<_abs_z>` − `#<_z>` (`src/emc/rs274ngc/interp_namedparams.cc:744–747`).
- **`#<_tool_offset>`.**
- **Every stored value.**
- **The point detector** (§3): agreement of the work position at this machine point.
- **No named or numeric parameter carries the applied G92 or the applied origin alone.** The named list holds only the position, the sums and flags (`src/emc/rs274ngc/interp_namedparams.cc:571–762`), and `#5420–#5428` are the program position (`src/emc/rs274ngc/rs274ngc_pre.cc:1605–1613`).

### 1.3 Why conditions 2 and 3 cannot be proven there
- **Condition 2** fails, with the point detector AGREEING and every read value matching the status, in either of two cases:
  - after a direct assignment to `#5210–#5219` (by MDI, a program, a hook);
  - after M2 under `DISABLE_G92_PERSISTENCE` (native: stored 0, applied 7).

  The interpreter's own G10 L20 then lands off by the difference. A program's text is opaque by rule, so the ledger cannot exclude such an assignment either (no general language analysis — R510).
- **Condition 3** fails under a split like Codex's counter-case B with a different origin: interpreter origin Z 10 / TLO 40, status origin 0 / TLO 50. The point detector agrees and `#<_tool_offset>` agrees. After `G10 L20 P1 Z0` the interpreter reads 0, but the DRO reads −10.
- **A post-write read** would show both, but R510 rules out supplying a hard precondition after the write (MT510-02).

**Plainly: on a config without `[PYTHON]`, no touch-off contract — not even a plain Z touch-off at a standing machine — can prove its need before the write.**

**Status of this conclusion:** DERIVED from the source (§1.1). Condition 2's premise has no native case yet; NR19 owes it (§10.3). The model predicts that after `G92 X3` at X10 (applied 7), M2 under `DISABLE_G92_PERSISTENCE` (stored 0) and `G10 L20 P1 X0`, the interpreter's `#<_x>` reads −7, not 0.

### 1.4 What remains (decisions, not proposals of mine)
1. **Q509-2 — `[PYTHON]` on the operator's machine** (the operator's decision). The machine becomes (a): Touch-off works whenever the full read confirms. The start agent is measuring what a missing or broken TOPLEVEL costs (pending).
2. **Q4-C5 — `[PYTHON]` in the shipped 3- and 5-axis examples** (for Codex, §8). This covers the sims, not the operator's machine.
3. **A contract change, NOT proposed by me** — R510 keeps the touch-off's hard proven need. On (b) the touch-off keeps today's behaviour (no basis condition), and the point detector refuses only on a found disagreement.
   - Strictly better than `dbd14cab`.
   - No proof; it would need Codex and the operator explicitly.
4. **Step 1 active only on (a).** On (b) the ledger, collector and detector are built but the start and touch-off terms stay off. The routine is as today, with no protection — named as such.

Without 1, 3 or 4, step 1 must not be deployed to the operator's machine.

The operator updates the machine from development before EVERY start. Option 4 is therefore what lets a merge land on development without a regression on (b) while Q509-2 is open.

## 2. The full read on `[PYTHON]` configs (R510 C5(i) approved)

### 2.1 The job form
- **The line:** `;py,import emccanon as e;t=this;e.MESSAGE('F5X<nonce16> <p>/<n> %r %r … END'%(t.<f1>,t.<f2>,…))`.
  - The `;` comment form, because `(PY,…)` cannot hold parentheses (native).
  - The message goes through `interp_list`, like DEBUG, and the SAME collector takes it (v3 §3.3, amended §6.3).
  - It is the same write path (`_cmd_blocking`, `effect=job`) and the same completion contract.
  - It is recognised by its job object, never by its text (v3 §3.1).
- **Fixed generated field accesses only.** No client-supplied Python, and **no named built-in** — every one can be shadowed (native for `_coord_system`: 999).
- **The fields** (`src/emc/rs274ngc/interpmodule.cc:910–1011`), kept in three SEPARATE groups:
  - **applied:** `origin_index`; `origin_offset_x/y/z`; `AA/BB/CC_origin_offset`; `u/v/w_origin_offset`; `rotation_xy`; `axis_offset_*`; `tool_offset` (`.tran.x/y/z`, `.a/.b/.c`, `.u/.v/.w`); `current_x/y/z`, `AA/BB/CC_current`, `u/v/w_current`;
  - **units:** `length_units`;
  - **stored:** `params[5220]`, the rows the need names, `params[5210…5219]`.
- **`#5599` plays no part.** `emccanon.MESSAGE` does not depend on the DEBUG switch.
- **The measured form.** The line is the one NR-src ran: `;py,import emccanon;emccanon.MESSAGE('…' % (this.<f>, …))`, with no aliases. What `import emccanon` leaves in the site's Python namespace is owed (NR18).
- **What decides (a) or (b).**
  - The INI section alone does not prove the plugin loaded. A config is treated as (a) only after a successful Python read in this LinuxCNC session; until then, and after a failed one, it behaves as (b).
  - A `;py,` line on an uninitialised plugin is an INTERPRETER ERROR. It runs the MDI error path and the abort hook, and is booked ALL as `own_error` (v3 §2.4 d). The read fails closed, but the hook HAS run — named.
  - This ties to the start agent's pending measurement of a missing or broken TOPLEVEL.

### 2.2 The self-check (kept as a condition — MT510-01)
- **The check:** the machine point recomputed from the applied components — the mirror of `#<_abs_…>` (`src/emc/rs274ngc/interp_namedparams.cc:725–762`) — must equal (STAT `position` − eoffset) in program units.
- **A failure:** the read fails (`Coordinate read incomplete — reply unreadable`), and the need stays UNCONFIRMED.
- **Never dropped.** A red native case is fixed at its cause (units, the eoffset, the mirror), or the read stays unconfirmed.

### 2.3 The TOUCHOFF need on (a)
- **Applied vs STAT:**
  - the applied index = the target = STAT;
  - for every touched axis, the applied origin, G92 and TLO = STAT; X and Y together, with R.
- **L20's G92 premise (§1.1), now READABLE:** the applied G92 = effective(stored G92) per touched axis. Else refused: `Touch-off refused — G92 parameters differ from G92 in effect`.
- **The target's stored row** (for an inactive target).
- **The Plane route** stays its own case (opaque → ALL, as v2).

### 2.4 The START need on (a) — the publication binding, also for CONFIRMED
- **Each part of the publication's ctx is compared with the read:**
  - the initial applied state (index, the active row's patch as the applied value, G92, TLO) against the read's APPLIED values;
  - the patched rows for every row the program selects LATER against the read's STORED rows.
- **The active row counts as "selected later"** when the program selects another system and then it again.
- **The case R510 names:** stored G54 X5, applied and overlay X0; the program selects G55, then G54. The patch for G54 is X0, but the interpreter will load X5 → **not verified**.
- **Step 1 does not repair the cache.** A mismatched input stays unconfirmed.
- This replaces v3 §2.5's two separate "each against its own kind" compares as the START rule. §2.5 stays for the ledger's own invalidation.

## 3. The point compare — a DETECTOR (MT510-01)

### 3.1 What it proves — and nothing more
- **The claim:** the work position the interpreter holds (`#<_x…_w>` on (b); Python `current_*` on (a)) equals the one the status's offsets give for the same standing machine position. The latter is canon's unoffset mirrored on STAT (`src/emc/task/emccanon.cc:226–239`). X and Y are compared together, at that position, within §5's bound.
- **It does not prove** the applied basis, the path that follows, or a DRO at another position.
  - Codex's A: R90 against R0 agrees at the origin. `G0 X10 Y0` then goes to (0,10), not (10,0).
  - Codex's B: TLO 50 / G92 0 against TLO 40 / G92 10 agrees at Z50; after `G49`, `G0 Z0` goes to Z0, not Z10.

### 3.2 Its lifetimes are asymmetric
- **A DISAGREEMENT → INCONSISTENT.** It is bound to the transform, not the point: two transforms that differ at one point are different transforms. It lasts until the next full read, or a booking that may change the transform. A jog does not end it.
- **An AGREEMENT → a point statement `Work position checked here 10:42`.**
  - It is bound to (STAT `position`, ledger `rev`, Link). It ends on any position change beyond §5's bound (a jog, any move), on any booking, and on a Link change. The DRO then returns to the calm line.
  - The jog books nothing in the ledger (v3 §2.2), so the end comes from the position binding, not from a booking.
  - It never confirms the ledger, a start or a touch-off.
- **The `_abs` self-check** (`#<_abs_…>` = the machine position) stays a condition of the detector on (b). If it fails, there is no statement, and the cause is fixed — never dropped (MT510-01).

### 3.3 Where it runs (deliberate actions only)
- **(b) the start's read slot**, after a consent (§0).
- **(b) the Offsets Read.**
- **(a) a cross-check inside the full read:** a component disagreement is INCONSISTENT anyway.

The touch-off on (b) is refused before any read. The refusal text names the missing read, not a finding.

## 4. Corrections (MT510-02, MT510-03)

### 4.1 G16 and the post-write read (MT510-02)
- **v3 §5.1's "the post-write read is the detector" is withdrawn.** On (a) the post-write full read is the EFFECT proof of the new row; it never supplies a precondition.
- **v3 G16's first-TLO example** (interpreter TLO 50, status 0) is **INCONSISTENT**: `tlo_on` differs. On (b) the detector finds it too (Z deviates by 50). The guard expects INCONSISTENT.
- **New case, both TLO flags true** (Codex's B, and MT510-02's touch-off case):
  - on (b): the detector agrees → UNCONFIRMED, the touch-off refused;
  - on (a): the full read → INCONSISTENT (TLO 50 ≠ 40, G92 0 ≠ 10);
  - in both: never admitted, never verified.

### 4.2 `mode(MANUAL)` through the whole dispatcher (MT510-03)
- **The dispatcher path.** Leaving AUTO or MDI for MANUAL first runs `emcTaskAbort`, `mdi_execute_abort` and `emcTaskPlanClose`, clears `emcTaskCommand` and `interp_list`, and queues the plan synch — all BEFORE `emcTaskSetMode` (`src/emc/task/emctaskmain.cc:2125–2169`). There is no `emcAbortCleanup`, so no hook.
- **v3 §2.2's row "`mode(MANUAL)` → nothing" is replaced:**

| Case | Books |
|---|---|
| `mode(MANUAL)` from AUTO or MDI | the queue-loss rule of v3 §2.3, plus the close/synch path's own effect — no coordinate field by source; its empty-queue exception needs its own native case (NR17), as MDI/AUTO had NR7 |
| already MANUAL | no write at all: `set_mode` returns without writing (`lcnc-gateway/gateway.py:5468–5473`) |

- **Fixes:**
  - **v3 G2** becomes three cases: MDI→MANUAL with an open queue → ALL; MDI→MANUAL empty → nothing only after NR17; already MANUAL → no write.
  - **v3 §3.3:** "a `mode(MANUAL)` never moves `rev`" is withdrawn. Only "already MANUAL" (no write) moves nothing.
  - **v3 §5.2's RFL spindle preparation** is moot — RFL is out (§6.2).

## 5. Tolerance and budget (MT510-04)

### 5.1 One bound per quantity, in a named canonical unit
- **The canonical unit:** the machine's linear unit (`[TRAJ] LINEAR_UNITS`; mm on the operator's machine) for lengths, degrees for angles and R.
- **A compare's bound is q_a + q_b + e + a:**
  - **q — print quantisation of each printed side, converted to the canonical unit.**
    - DEBUG `%.6f`: 0.5e-6 of the PRINTED unit. That is 0.5e-6 mm for a mm value, and **1.27e-5 mm for an inch value on a mm machine** — the program unit changes the physical limit, so this is named.
    - Python `%r`: **0** (repr round-trips the double).
    - The publication's patch strings `:.6f`: 0.5e-6 machine units.
    - A STAT double: 0.
  - **e — float and unit arithmetic:** 16·2⁻⁵²·max(1, |v|) in the canonical unit. It covers the mirrored unoffset and one ×25.4. At |v| = 1e6 mm it is 3.6e-9 mm — not v3's 0.001.
  - **a — the accepted difference:** **0** in step 1. A business tolerance would be its own decision.
- **Examples:**
  - a Python value vs STAT: e only;
  - a DEBUG mm token vs STAT: 0.5e-6 mm + e;
  - a G20 DEBUG token: 1.27e-5 mm + e;
  - the read's stored row vs a patch string: q_patch (+ q_read on (b)) + e.
- **v3 §3.6's `s = 1e-9·max(1,|d|)` is withdrawn.**
- **Guards at the edges:** |v| = 0, −0, a half-way value, 1e5 and 1e6 mm (the largest the configs allow), all under G20 and G21 alike.

### 5.2 Value range and END
- **END proves completeness only** — v3 §3.5's "|v| ≥ 1e9 ⇒ END missing" is withdrawn.
- **Every parsed value is checked against the named range** the budget assumed (|v| < 1e9 for DEBUG). A value outside it fails the read (`reply unreadable`), whatever END shows.

### 5.3 The budget, split
- **SENT bytes and PRINTED characters are counted separately**, each ≤ 240.
- **DEBUG** (b): the packer of v3 §3.5 — references sent, at most 18 printed characters per value.
- **Python** (a):
  - sent = the prefix (about 45 bytes) + about 25 bytes per field access (`t.origin_offset_x,` is 18 bytes, `%r ` is 3);
  - printed = 26 + at most 25 per value (`repr` of a double ≤ 24 + a space) + 3.
  - So at most about 8 values per line.
  - "About 3 lines for a 3-axis START" stays an estimate until NR13.

## 6. Start contract, collector, wording

### 6.1 C1 — what "nothing written" means
- At the ENTRY, nothing is written (the ask comes before the guard).
- At the RECORD, an ask means only **no AUTO_START**. The guard, the sync and the read have already written; their bookings stand.

### 6.2 RFL is out of the verification promise
- The WIP already asks `run_from_line` at the entry for every `start_line > 0`, offering `unchecked` only (`4abc58ba` `start_ask.consent_reason`, lines 160–161: "never checked (P6-d0)"). With that consent v3 §5.2 skipped the read anyway, so the promised RFL read after the positioning was unreachable.
- **P6-d0 stays:** RFL is unverified, and v3 §5.2 B's RFL read is withdrawn.
- A future verified RFL needs its own contract before the first dependent move.

### 6.3 C3 — the drain before the final admit
- **The drain:** on the SAME Link, a drain that BEGINS after the touch-off's (and the record's) admission began, and runs to EMPTY (not to the time or packet bound).
  - It books its error effects (v3 §2.4 (e)) BEFORE the read completes and before the final ledger admit.
  - A new invalidation between that drain and the write blocks again.
- **Guards, both orderings in one drain:**
  - a valid last read part, then an invalidating error message;
  - the error, then the part.

  Both must end unconfirmed.

### 6.4 C4, C6, C8
- **C4** is agreed. `logopen` / `logappend` are no coordinate writers but are not free of side effects (files). The read's exemption stays with the job.
- **C6 — stored ≠ applied is a separate CALM distinction, never "healthy" or "confirmed" by itself.**
  - With a confirmed applied basis (a), the calm note is right.
  - On (b) it is only a stored-vs-status difference, with no claim either way.
  - Help text fixed: re-selecting the active G54 is a no-op (`src/emc/rs274ngc/interp_convert.cc:1793–1798`); selecting another system and then G54 applies the stored row.
- **C8 — no `#5599` write.** A missing DEBUG reply stays unknown, with the help text naming possible causes. On (a) the Python read does not depend on `#5599`.

### 6.5 Wording
- The equal-codes false VERIFIED (X14.0904 Y10.8335 against a preview of X10 Y10) ran at the start WIP **`4abc58ba`**, not at `dbd14cab`. Gateway and bulk pipeline differ between the two heads.
- It stands as a native finding at that WIP. The start agent is re-running it at `dbd14cab`.
- v3 §1.0 and §9 are corrected accordingly.

## 7. What v3 content is withdrawn, what stays
- **Withdrawn:**
  - the NARROWED and TOTAL classes and the class rules of v3 §1.4, §3.4, §5.1 and §5.2 A;
  - the exposing/neutral word list as a protection;
  - "TOTAL admits the touch-off";
  - the post-write read as a detector;
  - dropping the `_abs` self-check on a red case;
  - v3 §3.6's slack;
  - the `|v| ≥ 1e9` END rule;
  - the RFL read;
  - Q3-C8's `#5599` write.
- **Stays:**
  - the ledger (v2 §2, v3 §2.1–§2.5 with the classes reduced to CONFIRMED / UNCONFIRMED / INCONSISTENT);
  - the op table (v3 §2.2 with §4.2);
  - the effects without a gateway write (v3 §2.4 with §6.3);
  - the read job's provenance and the collector (v3 §3.1, §3.3);
  - the MDI scan (v3 §7);
  - the calculation lifetime and the three moments (v3 §5.3–§5.4);
  - the read placement at the end of the preparation (v3 §5.2 B, without RFL; C1 wording).

## 8. `[PYTHON]` in the shipped 3- and 5-axis examples — its own question (Q4-C5)
- **The proposal, for Codex:**
  - `scripts/install_examples.py` writes a `[PYTHON]` section into the installed 3- and 5-axis INIs (`TOPLEVEL = python/toplevel.py`, `PATH_PREPEND = python`), with a suite-owned TOPLEVEL that imports nothing — the native B2 form;
  - `install.sh` installs it;
  - the same report lines as the other suite-owned entries.
- **Undo:** the next install with an opt-out flag removes the section and the file. The installed config is a copy, so a hand removal works too.
- **Costs to state plainly:**
  - every `;py,` / `(PY,…)` line in MDI and programs then runs Python inside milltask — today it fails;
  - the §2.1 read becomes available, and so do Touch-off and Zero on the sims;
  - what a missing or broken TOPLEVEL does to the start of LinuxCNC is being measured by the start agent (pending).
- **Not assumed.** It changes only the sims, not the operator's machine (Q509-2).

## 9. Display and texts (delta to v3 §10)
- **(b) at idle:** one calm standing line `Coordinates not confirmed — no full read here` on the DRO card and the Setup strip.
  - The detector's agreement shows `Work position checked here 10:42` while its binding holds (§3.2).
  - INCONSISTENT stays loud.
- **(b) touch-off refusal:** `Touch-off needs a full coordinate read`, with help.
- **(a) touch-off refusal for L20's G92 premise:** `Touch-off refused — G92 parameters differ from G92 in effect`.
- **Withdrawn:** the start's calm TOTAL reason (`G54 table differs from its applied offset` as an ask reason). The text stays as the C6 calm note only.

**Texts (≤ 60):**
- `Coordinates not confirmed — no full read here`
- `Work position checked here 10:42`
- `Touch-off needs a full coordinate read`
- `Touch-off refused — G92 parameters differ from G92 in effect`

**Help (≤ 120):**
- "no full read": `This machine cannot read the offsets LinuxCNC applies. A [PYTHON] section in its INI enables the read.`
- "G54 table differs…": `G54's table was changed without selecting it again. Selecting another system and then G54 applies it.`

## 10. Guards, mutations, native cases (delta)

### 10.1 Guards
- **G20 — the deciding table**, every row of §0, as gateway tests: (a) CONFIRMED / binding equal / binding unequal / UNCONFIRMED (read → CONFIRMED, INCONSISTENT, failed) / INCONSISTENT; (b) UNCONFIRMED (entry asks; consent → detector agrees → unverified; disagrees → asks at the record) / INCONSISTENT; RFL.
- **G21 — the touch-off on (b)** is refused in every state, including after a detector agreement and right after a gateway start.
- **G22 — Codex's A**, at a NARROWED-like state: the detector agrees at the origin.
  - The start is NOT verified on either config: (b) asks; on (a) the full read finds R90 ≠ R0.
  - The touch-off on (b) is refused.
  - Then a jog to (10,0): the point statement ENDS (`position` changed), and the DRO shows the calm line, not "checked".
  - The real target of `G0 X10 Y0`, (0,10), is computed against the preview's (10,0).
- **G23 — Codex's B, both TLO flags true:** (b) detector agrees → UNCONFIRMED, touch-off refused; (a) INCONSISTENT. Then `G49` + `G0 Z0` targets are computed (Z0 vs Z10).
- **G24 — §1.1's L20 premise on (a):** applied G92 7, stored 0 (M2 under the option) → the touch-off is refused with the G92 text. A direct `#5213=` case likewise.
- **G25 — the publication binding:** stored G54 X5, applied and overlay X0.
  - A program selecting G55 then G54 → not verified.
  - A program staying in G54 → verified.
- **G26 — `mode(MANUAL)`:** see §4.2.
- **G27 — the tolerance at the edges** (§5.1) under G20 and G21: a G20 DEBUG token 1.27e-5 mm off → equal; 1.3e-5 off → unequal; |v| = 1e6 with a 0.0005 difference → unequal (red against v3's slack).
- **G28 — a value out of range** with END present → the read fails.
- **G29 — the drain's two orderings** (§6.3).
- **Corrected:**
  - v3 G16's first-TLO example → INCONSISTENT;
  - v3 G2 → §4.2;
  - v3 G15/G17/G19 lose their NARROWED/TOTAL expectations.

### 10.2 Mutations
- **MF58** a detector agreement counted as confirmation (start verified on (b)).
- **MF59** a point statement surviving a position change.
- **MF60** the touch-off on (b) admitted by the detector.
- **MF61** a named built-in in the Python job.
- **MF62** the self-check dropped on failure.
- **MF63** the publication binding without the stored rows for later selects.
- **MF64** `mode(MANUAL)` from MDI booking nothing without NR17.
- **MF65** the `%r` compare with a 0.5e-6 print term (it hides a 4e-7 difference).
- **MF66** an RFL read offered as verification.
- **MF67** a drain that may end at its time bound counted as EMPTY.

### 10.3 Native (VM sim)
- **NR17** read → MDI→MANUAL → MANUAL→MDI → read, empty queue: the `mode(MANUAL)` exception's case. It is load-bearing for the (a) routine's "jog between: no extra read" (§0.1), not for its correctness.
- **NR19** the `G10 L20` G92 premise (§1.1): `G92 X3` at X10, M2 under `DISABLE_G92_PERSISTENCE`, then `G10 L20 P1 X0` → the model predicts `#<_x>` = −7. A direct `#5211=0` instead of the M2 is the same case on a shipped INI.
- **NR18** on a `[PYTHON]` config: the full Python read in every routine row of §0 (a); the self-check; G20; R ≠ 0; the publication-binding case.
- **NR11′** the equal-codes false VERIFIED at `dbd14cab` (the start agent is re-running it).
- **Kept:** NR12 (eoffset), NR13 (multi-part budgets for both forms), NR14 and NR15 (as checks of the full read and of the detector).
- **NR16** is reduced to the detector's documented misses (A and B).

## 11. Questions

### For Codex
- **Q4-C1 (§0, §1):**
  - Is the deciding table right?
  - In particular, is it right that on (b) the touch-off is refused in EVERY state, since none of them is CONFIRMED?
  - Is §1's "no narrower contract" right: L20's G92 premise and the DRO split are not provable before the write without `[PYTHON]`?
- **Q4-C2 (§0, both configs):** after a redeemed `unchecked` consent, v4 still runs the read — the full read on (a), the detector on (b). This replaces v3's "no read is forced on it".
  - A FAILED read proceeds unverified; the consent covers "not confirmed", so a failing read never blocks a consent (R509).
  - A positive INCONSISTENT asks AGAIN at the record (rb `unsent`, a kind of its own).
  - The reason: on (b) every start asks, so the consent becomes habitual. A positive finding must still stop the native X14.09 case.

  Agreed, or does the generic consent cover a positive finding, as v3 §5.2 A said?
- **Q4-C3 (§2.3):** L20's G92 premise as part of the TOUCHOFF need on (a) — agreed?
- **Q4-C4 (§5.1):** `a = 0` and the bounds as defined; the inch quantum named as 1.27e-5 mm?
- **Q4-C5 (§8):** `[PYTHON]` in the shipped 3- and 5-axis examples, with the install and undo story above — yes or no?
- **Q4-C6 (§1.4):** which of options 3 and 4, if any, would you accept for (b)? I do not propose either.

### For the operator (Claude asks)
- **Q509-2 is now decisive:** may the machine INI carry a `[PYTHON]` section (an empty TOPLEVEL suffices) for an exact read of every applied offset?
  - Said plainly: every `;py,` line in MDI or a program then runs Python inside LinuxCNC.
  - Without it, step 1 would switch Touch-off and Zero off on the machine, and EVERY start would ask — not only after a program.
  - The start agent's measurement of a missing or broken TOPLEVEL is pending.
- Q509-1 and Q508-1a/1b/2/3/4 stay. On (b), Q509-1 becomes the standing calm line of §9.

## 12. For the coordinator
- **The deciding table is §0.** On (b), Touch-off and Zero are refused in EVERY state, because (b) never reaches CONFIRMED. No narrower Z contract is provable before the write (§1).
- **So step 1 cannot go onto the operator's machine without Q509-2 = yes,** or without one of two decisions for you and Codex (§1.4) — not proposals of mine:
  - option 3: (b) keeps today's touch-off, plus the detector;
  - option 4: step 1 is active only on (a).

  The operator updates from development before every start, so option 4 is what lets a merge land without a regression on (b).
- **On (b) every start asks**, and Touch-off and Zero are refused in every state.
- **The "no narrower contract" answer is DERIVED from the source.** NR19 owes its native case.
- **(a)** works as R510 scoped it.
- **New source finding (§1.1).** LinuxCNC's own `G10 L20` subtracts the STORED G92, not the applied one. The touch-off need on (a) therefore includes "applied G92 = effective stored G92" — readable there.

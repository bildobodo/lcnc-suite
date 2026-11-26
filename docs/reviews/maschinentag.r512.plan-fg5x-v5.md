# F-G5X step 1 — plan v5: build-ready DELTA on v4 after Codex R511

**Status:** delta for Codex, meant to be build-ready. No build, browser or native run of my own.
**Base:** development `dbd14cab`; LinuxCNC 2.9.4 upstream from `~/claude-work/bg/upstream-2.9.4/`. Every `file:line` is checked with `~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v5.md`. Start-WIP references (`4abc58ba`) are named by function and line range, not as `file:line`.
**Binding:** v1–v4 (`maschinentag.r511.plan-fg5x-v4.md`), Codex R511 (end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `38aea3a2`), and this delta. Where they differ, this delta wins.

**What R511 agreed, and v5 keeps:**
- NARROWED/TOTAL withdrawn;
- the full component read via Python;
- the point detector with a bounded lifetime;
- stored vs applied publication inputs;
- the MANUAL dispatcher path;
- the mandatory drain;
- L20's G92 premise (Q4-C3 yes);
- no confirmation without a full read, so the touch-off is refused on a config without it (Q4-C1 yes).

## 0. Closure per point

| Point | Closed by | § |
|---|---|---|
| **MT511-01** configuration, capability and confirmation were one state | Three separate quantities: the CONFIGURED read path (fixed per controller instance; UNKNOWN after a mid-session INI edit), the instance's CAPABILITY (untried / ok / failed / error / unavailable), and the BASIS per need plus an explicit static DELIVERY mode. A read result never changes the path; no read failure switches protection off; no fallback to `#<_…>` names on a Python config; a known plugin-init failure is not re-provoked at every start. | 2 |
| **MT511-02** Q4-C2 re-ask after consent | Q4-C2 WITHDRAWN. The agreed contract stands: a valid `unchecked` covers UNCONFIRMED and INCONSISTENT, needs no read, and leaves the run unverified. A KNOWN contradiction is in the question (the `why` of `decide`). A later finding is kept in the record and the display. There is no `if inconsistent: ask`. | 3 |
| **MT511-03** the error bound from the result | The bound is derived from the INPUT operands of each computation path (position, eoffset, TLO, origin, G92, rotation, units), with separate terms for component and point compares. Edge tests use large, nearly equal operands. | 4 |
| L20 on (a) | Two admission terms with their own reasons, derived for X/Y and Z: applied G92 = effective stored G92, and (on the active system) applied R = stored R. They never make the basis INCONSISTENT. CONFIRMED is never carried from START to TOUCHOFF. XY stays coupled; Plane is its own contract. | 5 |
| §4.1 the compensated first-TLO case | The point does NOT differ there; the `tlo_on` flag compare is a named finding of the detector and is tested as such. | 6 |
| **Q4-C5** `[PYTHON]` in the 3- and 5-axis examples | Yes, as a SEPARATE change, with an ownership-tracked migration (new section inserted; own TOPLEVEL never replaced; opt-out removes only what the migration created and is unchanged). | 7 |
| **Q4-C6 / C7** options 3 and 4 | Option 3 is not the agreed hard protection (MT507-02). Option 4 is not R507 on (b). The delivery choice is Q511-1, laid out neutrally; Codex recommends settling Q509-2 first, with no silent fallback. | 8 |
| Help text (§9 of v4) | A `[PYTHON]` section does not guarantee an available read — the texts are split. | 9 |

---

## 1. The final per-config table

**Three quantities (§2):**
- the configured **PATH** — PYTHON or DETECTOR, from the INI LinuxCNC runs;
- the session's **CAPABILITY** on a PYTHON path — `untried`, `ok`, `failed`, `unavailable`;
- the **BASIS** per need — CONFIRMED, UNCONFIRMED, INCONSISTENT.

The **DELIVERY mode** is static and explicit, `active` by default; `interim` exists only if Q511-1 chooses it.

**The rows below are `active`.**

### 1.1 (a) PATH = PYTHON (the INI has `[PYTHON]`; TWP sim; a machine after Q509-2; the 3- and 5-axis examples after §7)

| Capability | Basis of the need | START (Cycle Start, Step from idle) | TOUCH-OFF / ZERO | DRO at idle |
|---|---|---|---|---|
| any | START need CONFIRMED; publication inputs equal the read: initial APPLIED state, and the STORED rows the program selects later (v4 §2.4) | verified — no read, no ask | its OWN need (§5), never the START verdict | no mark |
| any | START need CONFIRMED, a publication input ≠ the read | not verified: "check not finished" while a re-parse runs, else asks with the reason; consent → unverified | its own need | no mark |
| `untried`, `ok`, `failed` | UNCONFIRMED, no consent redeemed | the full read after the preparation, before `set_mode(AUTO)`. CONFIRMED → as above. INCONSISTENT → the record asks with the finding in the question. A read failure → capability `failed`; the record asks ("Full coordinate read failed — …") | the full read first. Admitted only if the TOUCHOFF need is CONFIRMED AND the L20 premise holds AND the drain is clean (§5). L20 premise fails → refused with ITS reason. INCONSISTENT or a failure → refused | calm `Work position not confirmed` |
| `error` / `unavailable`, or PATH UNKNOWN | UNCONFIRMED | NO automatic read; asks at the ENTRY, nothing written, the reason in the question; consent → unverified | refused (`Full coordinate read unavailable`). `error`: one Offsets → Read per press; `unavailable` / UNKNOWN: a new LinuxCNC session | calm, with the reason |
| any | INCONSISTENT known | asks at the entry, nothing written; the finding in the question; consent → unverified | refused | loud |
| any | a redeemed `unchecked` consent | no read; unverified; a later finding stays in the record and display | a consent never authorises a touch-off | — |

### 1.2 (b) PATH = DETECTOR (no `[PYTHON]`: the operator's 3-axis machine as of now, the shipped 3- and 5-axis examples before §7)

| Basis of the need | START | TOUCH-OFF / ZERO | DRO at idle |
|---|---|---|---|
| UNCONFIRMED (the only state without a finding), no consent | asks at the ENTRY, nothing written (as v4); any known finding in the question; consent → unverified. The detector runs only at Offsets → Read (variant: Q5-C2) | **refused, in every state** (`Touch-off needs a full coordinate read`) | calm standing line; `Work position checked here 10:42` only while bound (v4 §3.2) |
| INCONSISTENT known | asks at the entry, the finding in the question; consent → unverified | refused | loud |
| a redeemed `unchecked` consent | no read; unverified | — | — |

### 1.3 Run from line, both paths
Asks `run_from_line` at the entry, offering `unchecked` only (WIP `4abc58ba` `start_ask.consent_reason`, lines 160–161). There is no read; the run is unverified (P6-d0).

### 1.4 `interim` (only if Q511-1 chooses it; §8)
It changes ONE cell: (b)'s TOUCH-OFF becomes "as `dbd14cab`; refused only on a KNOWN INCONSISTENT". Everything else stays as above. It is NOT the agreed hard protection (MT507-02), and it is named as such everywhere it shows.

---

## 2. Path, capability, basis, delivery (MT511-01)

### 2.1 The configured PATH — fixed for the controller instance
- **The plugin is configured once, in `Interp::init`,** from the INI's `[PYTHON] TOPLEVEL` (`src/emc/rs274ngc/rs274ngc_pre.cc:1016–1022`; the plugin is instantiated at construction, `src/emc/rs274ngc/rs274ngc_pre.cc:136`). So the PATH belongs to the controller INSTANCE, not to the INI file as it is now:
  - **PYTHON** when the INI LinuxCNC runs (STAT `ini_filename`) had `[PYTHON]` with a `TOPLEVEL` at the instance's start; else **DETECTOR**.
  - It is fixed for the life of the `session_bind` instance (`lcnc-gateway/session_bind.py`).
- **An INI modified after the instance started** (its mtime newer than the instance's start) gives a PATH of **UNKNOWN**:
  - no `#<_…>` name read and no `;py,` attempt;
  - the basis stays UNCONFIRMED, the start asks at the entry, the touch-off is refused;
  - only a new LinuxCNC session fixes a new PATH.

  This closes the hole where removing `[PYTHON]` mid-session would move a session whose plugin can still shadow names onto the DETECTOR path. A gateway restart after such an edit lands in the same rule.
- **`reset_interpreter`** (PLAN_INIT → `Interp::init`) re-reads the INI. With the INI unchanged it keeps the PATH; with a changed INI the PATH is UNKNOWN as above. Whether it re-configures a failed plugin is owed with the TOPLEVEL measurement.
- **A read result never changes the PATH.**

### 2.2 The CAPABILITY — per controller session, PYTHON path only

| State | Entered by | What it allows |
|---|---|---|
| `untried` | a new session or INI identity — with no earlier success stamp required | the FIRST allowed read does attempt the full path (in a start's read slot, a touch-off, or Offsets → Read) |
| `ok` | a full read completed (v3 §3.3 + §2) | reads as normal |
| `failed` | a TRANSPORT failure: no reply by the deadline, a part missing, a reply unreadable, a Link change — the job itself completed DONE | the basis stays UNCONFIRMED and protection stays active; the next read — a start's read slot included — attempts again |
| `error` | the job's own completion is ERROR (`controller_done` "error" for the job's serial), whatever text arrives. A Python exception from the fixed job (`src/emc/rs274ngc/interp_python.cc:284–286`) lands here. Classified by the completion, not by the message text: a second reader can take the text | NO automatic attempt — each one is an interpreter error that runs the MDI error path and the abort hook (v3 §2.4 d). Only a deliberate Offsets → Read attempts again, once per press |
| `unavailable` | `error` together with the text `py_execute(…): Python plugin not initialized` (`src/emc/rs274ngc/interp_python.cc:282`; `PYUSABLE`, `src/emc/rs274ngc/interp_internal.hh:835`) — the plugin did not start in this instance | NO attempt at all: Offsets → Read refuses with the restart hint. Retrying cannot help, because the plugin is configured only in `Interp::init`. Recovery is a new LinuxCNC session (or, if the TOPLEVEL measurement shows it, `reset_interpreter`) |

- **Never** a fallback to `#<_…>` names on a PYTHON path, in any capability state: a loaded plugin can shadow them (native 999), and a partly loaded one is unknown.
- On a PYTHON (or UNKNOWN) path with `failed`, `error` or `unavailable` the detector does not run either; the basis stays UNCONFIRMED.
- **The capability is not a basis state.** `ok` confirms nothing by itself; every need is confirmed only by a read's values in the ledger.

### 2.3 The BASIS and the DELIVERY mode
- **The basis** is CONFIRMED / UNCONFIRMED / INCONSISTENT per need, as in v4, with CONFIRMED reachable only on a PYTHON path.
- **The delivery mode** is a static setting chosen explicitly. It never changes at runtime and never follows a read result:
  - `active` (default): the table of §1;
  - `interim`: §1.4, only if Q511-1 chooses it.
- **No read failure ever switches to legacy behaviour.**

### 2.4 Guards (MT511-01)
- **G30 — a first session, no stamp:** a first session on a working PYTHON config, with no earlier success stamp. The first start's read attempts the full path and confirms.
- **G31 — failure and recovery:** after `ok`, a missing part or a timeout → `failed`, UNCONFIRMED, protection active (the touch-off refused, the start asks). The next deliberate read attempts again and can confirm.
- **G32 — no name fallback:** a PYTHON config whose `namedparams` shadows `_coord_system`, plus a failed read → UNCONFIRMED. No `#<_coord_system>` is ever read on that path.
- **G33 — `error` and `unavailable`:**
  - after a job ERROR, three further starts send NO `;py,` MDI; each asks at the entry; one Offsets → Read sends exactly one;
  - after "plugin not initialized", Offsets → Read sends none either;
  - a `failed` (transport) state retries at the next start.
- **G34 — identity change:**
  - a new controller instance drops every capability state and fixes the PATH anew;
  - an INI modified mid-session gives PATH UNKNOWN, with no name read and no `;py,` (the `[PYTHON]`-removed-mid-session case is red against a recompute).
- **G35 — delivery mode:** `active` with a read failure never behaves like `interim` or legacy.

## 3. The start consent — the agreed contract stands (MT511-02)
- **Q4-C2 is withdrawn.**
- **What a valid `unchecked` consent does:**
  - it covers UNCONFIRMED and INCONSISTENT;
  - the run stays unverified;
  - every other hard admission still applies (arm, run gate, kinematics, the toolsetter basis, the consent's binding).
- **No read is a condition of that consent:** with a redeemed `unchecked` proof there is no read at all.
- This is the WIP's rule as is: `proof_matches` lets a matching `unchecked` stand for any verdict (WIP `4abc58ba` `start_ask.proof_matches`, lines 211–230).
- **A KNOWN contradiction is in the question.** `decide` asks with `why = sit.why` for an unverified situation (WIP `start_ask.decide`, lines 233–244). The basis term's `why` carries the finding, e.g. `Interpreter: G54 X5 R5 · Status: G54 X0 R0`.
- **A finding known LATER** (a later read) stays in the record of that run and in the display. It never turns `unchecked` into verified, and it never re-asks a redeemed consent.
- **There is no `if inconsistent: ask` branch.**
- **The (b) start asks at the ENTRY, nothing written (as v4).** The ask is certain there, so no preparation is written before it. A finding already known — from an Offsets → Read — is in the question.
- **The detector-first variant** (preparation, detector, then the record asks with the fresh finding) is Q5-C2's alternative, not the plan.
- **The R507 start finding is closed by this:** the run is no longer silently `verified=true`.

## 4. The error bound from the input operands (MT511-03)
- **Kept from v4:** the bound is q_a + q_b + e + a; the canonical unit; `%r` has no print term; a = 0; the inch print quantum 1.27e-5 mm.
- **What changes: e is derived from the operands of each path, not from the result.** With u = 2⁻⁵³ (the unit roundoff) and all magnitudes in the canonical unit:

| Compare | Operands | e |
|---|---|---|
| **component** — a Python applied field vs its STAT field (one conversion each side) | v_py, v_stat | 4·u·(\|v_py\| + \|v_stat\|) |
| **stored vs patch** — the same stored double on both sides, one printed | — | 0 (only the q terms) |
| **point (detector)** — the interpreter's program point vs P_s mirrored from STAT | S = \|M\| + \|E\| + \|T\| + \|O\| + \|G\|, summed over X and Y together when R ≠ 0 (they mix), else per axis; M position, E eoffset, T TLO, O origin, G G92 | 32·u·S |

- **Why 32.** The mirror of canon's unoffset (`src/emc/task/emccanon.cc:226–239`) on the status side is about 9 rounded operations: −E, −T, −O, two products and a sum per rotated axis, −G, one unit conversion. Canon's own path on the interpreter side (`src/emc/task/emccanon.cc:2658–2689`) is about the same plus its unit conversions. Each first-order term is ≤ u·(operand magnitude). So 2 × ~10 operations, with margin. The factor is a derived bound and the edge tests below must hold it; it is not claimed for paths it does not describe.
- **Codex's counter-case:** M = 1000, O = 999.9 gives a path difference of 4.55e-14 mm; S = 1999.9 → e = 7.1e-12 ✓. At 1e6 operands the difference is 2.04e-11 and e = 7.1e-9 ✓.
- **G36 — edge tests:**
  - large, nearly equal operands with a small remainder (M 1e6, O 1e6 − 0.1) on the mm and inch paths;
  - the same with R = 30° and R = 90°;
  - −0 and half-way values;
  - G20 and G21.

  All must pass with a healthy pair and fail with a pair 2·(q + e) apart.
- **The native G20/G21 check stays owed** (NR14).

## 5. The TOUCHOFF need on (a) — its own admission (Q4-C3, R511)
- **What the touch-off evaluates — its OWN need, against the ledger's read values:**
  - the applied index = the target = STAT;
  - for every touched axis, applied origin, G92 and TLO = STAT (X and Y coupled through R);
  - the target's stored row.
- **A start's verdict is never an input.** CONFIRMED is not carried from START to TOUCHOFF.
- **The L20 premises are SEPARATE admission terms, checked before the write.** Applied, stored and status values are compared in one canonical unit.
- **L20-G92 — for every touched axis, applied G92 = effective stored G92.**
  - Z: `src/emc/rs274ngc/interp_find.cc:517–527`, `src/emc/rs274ngc/interp_convert.cc:4282–4287`.
  - X/Y: the XY branch takes the current point through `find_current_in_system` — the applied rotation in, the STORED R out (`src/emc/rs274ngc/interp_find.cc:515`) — then rotates by the stored R and subtracts the desired point (`src/emc/rs274ngc/interp_convert.cc:4234–4261`).
  - Worked through, the new origin is m − Rot(R_stored)·(G_stored + d). The interpreter then reads d + G_stored − G_applied, for X and Y as for Z.
  - Refused if not: `Touch-off refused — G92 parameters differ from G92 in effect`.
- **L20-R — a touch-off on the ACTIVE system re-applies the STORED rotation** of that row: `r` is the stored R (`src/emc/rs274ngc/interp_convert.cc:4227–4232`), and the active branch sets `rotation_xy = r` and sends `SET_XY_ROTATION` (`src/emc/rs274ngc/interp_convert.cc:4367–4369`). This holds for Z-only touch-offs too.
  - So applied R = stored R of the target is a premise for every touch-off on the active system.
  - Refused if not: `Touch-off refused — stored rotation not in effect` — the write would silently turn the frame.
- **In both cases the basis stays CONFIRMED.** They are no interpreter/status contradiction and are never booked INCONSISTENT.
- **The drain** (v4 §6.3) and the write-thread admit follow.
- **The post-write full read** is the effect proof of the new row (not a detector).
- **The Plane route** is its own contract (opaque → ALL, unchanged).
- **G37 — the premises:**
  - a CONFIRMED frame with applied G92 X7 and stored 0 → the touch-off (X, Y and Z each) is refused with the G92 reason; the basis stays CONFIRMED and the start is unaffected;
  - the same with a direct `#5211=0`;
  - applied R 0 with stored R 5 on the active row (a direct `#5230=5`) → a Z-only touch-off is refused with the rotation reason.

## 6. The detector's flag compare (correction to v4 §4.1)
- **In v3 G16's compensated first-TLO case the POINT does NOT differ.** The interpreter has origin 50 + TLO 50, the status origin 100 + TLO 0, and the sum is 100 on both sides; v4 §4.1's "Z deviates by 50" is wrong.
- **Only the `tlo_on` flag compare finds it:** `#<_tool_offset>` 1 against STAT TLO all zero. It is a NAMED finding of the detector, beside the point compare, in both directions:
  - `Tool length: interpreter applied · status none` (this case);
  - `Tool length: interpreter none · status applied` (the native pass-2 stale case: interpreter G49, STAT 50 — there the point differs as well).
- On (a) the full read finds the component difference anyway.
- **G38 — the flag finding:** this case gives point agreement + flag disagreement → INCONSISTENT by the flag finding alone. Codex's B (both flags true) gives agreement on both → UNCONFIRMED (b) / INCONSISTENT by components (a).

## 7. `[PYTHON]` in the shipped 3- and 5-axis examples (Q4-C5: yes, a separate change)
- **Today's installer.** It REPLACES `PYTHON.TOPLEVEL` and `PATH_APPEND` as managed keys whenever the template carries them (`scripts/install_examples.py:347–358`). It replaces them in place (`scripts/install_examples.py:410–417`), and inserts missing managed keys only right after a section header that already EXISTS in the installed INI (`scripts/install_examples.py:397–405`). So a missing `[PYTHON]` section would never be inserted, and an own TOPLEVEL would be overwritten.
- **The migration** — its own function, not the managed-key mechanism:
  - **No `[PYTHON]` section in the installed INI** → insert one with `TOPLEVEL = <suite>/examples/sim_config/python/read_toplevel.py` (an empty module). Record the ownership in a migration file beside the INI (`.lcnc-suite-python-migration.json`): the lines inserted and the toplevel file's SHA-256.
  - **The section exists with the suite's recorded, unchanged values** → keep it (repeat installs are idempotent).
  - **The section exists with an own TOPLEVEL or path** → never replaced. Kept and reported ("own Python TOPLEVEL kept; the full read uses it").
  - **The 3- and 5-axis templates do NOT carry `[PYTHON]`,** so the managed-key replacement never touches it. The TWP template keeps its own managed section as today.
- **Opt-out** (`install_examples.py --no-python-read`) removes ONLY the lines and the file the migration file records, and only while they are unchanged (byte-equal lines, matching hash). Anything edited since, or with unclear ownership, is kept and reported.
- **Guards:**
  - G39 a new install;
  - G40 a repeated install;
  - G41 an existing own TOPLEVEL;
  - G42 a local edit of the inserted lines or the file after install;
  - G43 opt-out after each of these.
- **Owed before this change ships:** the start agent's native measurement of a missing or broken TOPLEVEL — does LinuxCNC still start, and what does the first `;py,` answer? A known init failure maps to capability `unavailable` (§2.2).
- **Not a decision about the operator's machine INI** (Q509-2).

## 8. Delivery — options 3 and 4, and Q511-1 (Q4-C6 / C7)
- **Option 3** (the touch-off as today on (b), refused only on a found contradiction) adds detection. It is **NOT** the agreed hard protection of dependent writers (MT507-02), and "strictly better" covers only that added detection. As a delivery it exists only as the explicit `interim` mode (§1.4), never as a silent default or a runtime fallback.
- **Option 4** (step 1 active only on (a)) is possible as development or a bounded trial on (a). It is **NOT** a fulfilment of R507 on (b), where the false VERIFIED would remain possible. It is never activated by a read failure.
- **Q4-C7, accepted as Codex split it:** on (b), "START honestly unconfirmed, ask, unverified after consent" fulfils the START part of R507. It does not fulfil the TOUCH-OFF part while `interim` keeps the old write admission. Neither a start consent nor an unverified run authorises a touch-off.
- **Q511-1 (Claude asks the operator; only if Q509-2 stays open or is declined and a delivery is wanted before)** — neutrally:
  - **(A) an explicitly incomplete interim:** every start unverified, with a question; Touch-off and Zero as today, refused only on a detected contradiction; the screens say so;
  - **(B) holding back** the activated F-G5X protection on the machine until a full read exists (Q509-2 or a later change).

  **Codex's recommendation: settle Q509-2 first; no silent fallback.** Development and the native proofs for (a) continue either way.
- **Merge consequence:** `active` on (b) refuses Touch-off and Zero, and development reaches the machine before every start. So the build must not merge to development with `active` on the operator's machine before Q509-2 is yes or Q511-1 is answered — the coordinator's call.

## 9. Texts (delta to v4 §9)
- **(b) standing line:** `Coordinates not confirmed — no full read here`. Help (DETECTOR path): `This configuration has no [PYTHON] section, so the offsets LinuxCNC applies cannot be read in full.`
- **(a) `error` / `unavailable` / PATH UNKNOWN:** `Full coordinate read unavailable`. Help (`unavailable`): `LinuxCNC's Python plugin did not start. Fix the [PYTHON] section, then restart LinuxCNC.`
- **(a) `failed`:** the record's ask reason `Full coordinate read failed — no reply` / `… — reply unreadable`, as v3 §3.3's causes.
- **The detector's flag findings:** `Tool length: interpreter applied · status none`, `Tool length: interpreter none · status applied`.
- **(a) L20-R refusal:** `Touch-off refused — stored rotation not in effect`.
- **Withdrawn:** v4's single help text "A [PYTHON] section in its INI enables the read" — a section does not guarantee an available read.

**Texts (≤ 60):**
- `Full coordinate read unavailable`
- `Full coordinate read failed — no reply`
- `Full coordinate read failed — reply unreadable`
- `Tool length: interpreter applied · status none`
- `Tool length: interpreter none · status applied`
- `Touch-off refused — stored rotation not in effect`

**Help (≤ 120):**
- "detector path": `This configuration has no [PYTHON] section, so the offsets LinuxCNC applies cannot be read in full.`
- "unavailable": `LinuxCNC's Python plugin did not start. Fix the [PYTHON] section, then restart LinuxCNC.`

## 10. The build package (for the implementing round)

| Piece | Where | Content |
|---|---|---|
| `coord_basis.py` (new, pure) | `lcnc-gateway/` | the ledger (v2 §2.1, v3 §2.1, classes per v4); the op-table effects (v3 §2.2 + v4 §4.2); the PATH / CAPABILITY / DELIVERY state machine (§2); the tolerance (§4); the publication-binding compare (v4 §2.4); the Python and DEBUG job generators with their budgets (v4 §5.3) |
| the booking hook | `_cmd_blocking` at the BEGIN (`lcnc-gateway/gateway.py:5367–5369`) | `book(op)` before the effect; the job object as `effect` |
| the collector | the poller after `_cal_status_cycle` (`lcnc-gateway/gateway.py:1899–1904`) | consumes registered replies; the drain request (v4 §6.3) |
| the start | `cycle_start` / Step from idle (`lcnc-gateway/gateway.py:9639–9657`, `lcnc-gateway/gateway.py:9304–9315`); WIP `_start_entry` / `_start_at_record` / `_start_write_term` | the read slot after the preparation; the basis term with its `why` |
| the touch-off | the route (`lcnc-gateway/gateway.py:10112–10273`) | its own need, L20 premise, drain, admit, post-write read |
| the start check | `run_start_check` (`lcnc-gateway/bulk_pipeline.py:634–700`) | the publication binding against the read's stored rows |
| the display | the DRO card, Setup strip, Offsets, Sim tab | the calm and loud lines, the capability reason, the point statement's lifetime |
| the examples | `scripts/install_examples.py` | §7, as its own change |

**Tests:** v3 §11 and v4 §10 minus the withdrawn NARROWED/TOTAL expectations, plus G30–G43. **Native, before the build ships:** NR7 (done), NR12, NR13, NR14, NR15, NR17, NR18, NR19, NR11′ at `dbd14cab`, and the TOPLEVEL failure measurement.

## 11. Questions

### For Codex
- **Q5-C1 (§2):** is this what MT511-01 asks?
  - the PATH fixed per controller instance, with UNKNOWN after a mid-session INI edit;
  - the capability states: `failed` retries automatically, `error` only on a deliberate read, `unavailable` only after a new session;
  - the static DELIVERY mode.
- **Q5-C2 (§1.2, §3):** on (b), v5 keeps v4's entry ask, with no preparation written before a certain ask, and runs the detector only at Offsets → Read. The variant: preparation → detector → the record asks with a fresh finding (more writes before a certain ask, a concrete finding in every question). Keep the entry ask?
- **Q5-C3 (§4):** e = 32·u·S for the point compare, and 4·u·(|a|+|b|) for component compares — acceptable with the edge tests as the proof obligation?
- **Q5-C4 (§7):** the ownership-tracked migration and opt-out — enough?

### For the operator (Claude asks)
- **Q509-2** (decisive; Codex: settle it first): `[PYTHON]` in the machine's INI.
- **Q511-1** (only if Q509-2 stays open or is declined and a delivery is wanted first): (A) the explicit interim, or (B) holding back the activated protection (§8).
- Q509-1 and Q508-1a/1b/2/3/4 stay.

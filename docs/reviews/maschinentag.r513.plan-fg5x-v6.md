# F-G5X step 1 — plan v6: DELTA on v5 after Codex R512

**Status:** delta for Codex, closing only MT512-01..04. Nothing run of my own.
**Base:** development `dbd14cab`; LinuxCNC 2.9.4 upstream from `~/claude-work/bg/upstream-2.9.4/`. Every `file:line` is checked with `~/claude-work/abort/proto/check_citations.py ~/claude-work/fg5x/plan-v6.md`.
**Binding:** v1–v5 (`maschinentag.r512.plan-fg5x-v5.md`), Codex R512 (end of `docs/reviews/maschinentag.review.md` at origin/feat/backlog-integration `e72272ed`), and this delta.

**Accepted in R512 and unchanged here:**
- PATH, CAPABILITY, BASIS and DELIVERY kept separate;
- the first read without a success stamp; `failed` re-readable; `error` re-read only deliberately; no name fallback;
- the `unchecked` contract;
- the entry ask on DETECTOR (Q5-C2);
- L20-G92 and L20-R as admission terms;
- the operand-scaled terms for component compares.

**Native addendum noted from R512:** the equal-codes false VERIFIED now also ran at `dbd14cab` (`20261126T143949-fgx-eq`, run 2 `verified: true`, machine `(14.0903895534, 10.8335044084, 0)`).

## 0. Closure per point

| Point | Closed by | § |
|---|---|---|
| **MT512-01** L20 writes the whole active origin | The TOUCHOFF need is bound to L20's FULL after-effect, computed from the read: every requested coordinate takes its value; no unrequested coordinate and no orientation may change. The rule is derived in closed form per axis, with XY as a coupled plane. An unrequested change is refused with its own reason (`would also change X`) — never "healed". G92 matters for REQUESTED axes only. `m` is defined. | 1 |
| **MT512-02** an old mtime proves no loaded content | The PATH comes from a START RECORD the launcher writes for this instance: INI hash, `[PYTHON] TOPLEVEL`, mtime, instance identity. Its start condition is mtime ≤ the instance's start. Without a record, or with a current hash ≠ the record's, the PATH is UNKNOWN — never DETECTOR. `error` is added to the tables; the DETECTOR help also names "section without TOPLEVEL". | 2 |
| **MT512-03** opt-out must not delete the shared asset | The TOPLEVEL is a regular suite asset the installer NEVER deletes; opt-out removes only the recorded config lines. Ownership is per INI/profile. The `[PYTHON]` header goes only if the migration inserted it AND the section is otherwise empty. | 3 |
| **MT512-04** the angle conversion in the error term | The real degree→radian and trig paths are named (canon `r*M_PI/180.0`, interpreter `r*(M_PI/180.)`); an angle term is added wherever the two paths meet (the self-check, the Python point). The proven domain is \|R\| ≤ 360°; outside it the XY compare is UNPROVEN with a named limit — never INCONSISTENT, never "unreadable". `stored vs patch: e = 0` holds only for the same stored double in the same unit. | 4 |

---

## 1. L20's full after-effect (MT512-01)

### 1.1 What `G10 L20 P<active> <words>` does (source)
- **Every axis the block does not name keeps its STORED value.**
  - Z, A, B, C, U, V, W take `parameters[52xx + 20·P]` in their `else` branches (`src/emc/rs274ngc/interp_convert.cc:4282–4364`).
  - In the XY branch, a missing X or Y word keeps the current point in system P, so its stored offset stays (`src/emc/rs274ngc/interp_convert.cc:4234–4261`).
  - The active branch then sets the WHOLE applied origin, sets `rotation_xy = r` (the stored R) and sends `SET_G5X_OFFSET` with all components and `SET_XY_ROTATION` (`src/emc/rs274ngc/interp_convert.cc:4331–4369`).
- **The terms.** Applied quantities have the subscript `a`, stored ones `s`. ΔO = O_a − O_s(P) per axis. `p` is the interpreter's current program point. R_a = R_s = R (L20-R, v5 §5).
- **`m` defined:** m = Rot(R_a)·(p + G_a) + O_a — the machine point minus the eoffset minus the APPLIED TLO, in program units. This is the term v5 §5's `O_new = m − Rot(R)·(G_s + d)` meant; written with the raw machine point, the TLO subtraction was missing.
- **Worked through `find_current_in_system`** (`src/emc/rs274ngc/interp_find.cc:467–530`), the work point AFTER the write is:

| Axis | Requested (value d) | Not requested |
|---|---|---|
| a non-XY axis k | d_k + (G_s,k − G_a,k) | p_k + ΔO_k |
| XY plane, X and Y both requested | (d_x, d_y) + (G_s − G_a)_xy | — |
| XY plane, only X requested | x: d_x + (G_s,x − G_a,x) | y: p_y + [Rot(−R)·ΔO_xy]_y |
| XY plane, only Y requested | y: d_y + (G_s,y − G_a,y) | x: p_x + [Rot(−R)·ΔO_xy]_x |
| XY plane, neither requested | — | (p_x, p_y) + Rot(−R)·ΔO_xy |

- **The orientation after** is R_s (L20-R).
- **G10 L2** on the active row runs the same active branch: unnamed axes and R take the stored values. The gateway's `set_wcs` / `clear_wcs` writes are therefore OUT of this delta's admission. They keep v2's rule (rc checked; confirmed only by a post-write read) until their own L20-ROW / L20-R terms are planned.
- **G92 enters only REQUESTED axes.** An applied G92-X7 against a stored X0 does not make a Z-only write wrong; for the Z premise, G92-Z is what matters (G37 made precise).

### 1.2 The TOUCHOFF admission on (a) — replaces v5 §5's need and premises with the full effect
- **The TOUCHOFF need (restated):**
  - the WHOLE target row, for every configured axis plus R — applied and stored;
  - the applied index;
  - the applied G92 and the EFFECTIVE stored G92 (`#5210` ? `#5211…` : 0) for every configured axis;
  - the applied TLO;
  - STAT for each.

  This is the need bound to L20's full effect. v5 §5 named the touched axes only.
- **What is computed.** Before the write, from the full read's values, the after-effect of §1.1 for the requested set Q at the current point.
- **What must hold — each a separate admission term with its own reason; none makes the basis INCONSISTENT:**
  - **L20-G92:** G_s,k = G_a,k for every REQUESTED axis — G_s being the EFFECTIVE stored G92 — refused as `Touch-off refused — G92 parameters differ from G92 in effect`.
  - **L20-R:** R_s = R_a — refused as `Touch-off refused — stored rotation not in effect`.
  - **L20-ROW (new):** every unrequested coordinate stays within §4's bound:
    - ΔO_k = 0 for every unrequested non-XY axis;
    - the unrequested component(s) of Rot(−R)·ΔO_xy = 0 for the XY plane — both components when neither X nor Y is requested.
  - Refused as `Touch-off refused — would also change <axis>`, naming the first such axis. The write would silently shift a coordinate the operator did not touch.
- **There is no "healing".** A single Zero never re-applies the rest of the stored row. Applying a stored row is a deliberate act (selecting another system and back, or G10 L2), and it is not offered here.
- **The requested axes' own ΔO does not matter:** the new value replaces it. Refusing for it would be a needless refusal.
- **A pure mirror** of `find_current_in_system` + `convert_setup` L20 in `coord_basis.py` computes the after-effect. It is pinned by golden tests against the source formulas and by NR20.

### 1.3 Guards (replace v5 G37)
- **G37a — Z-only, stored X differs:**
  - applied G54 0/0/0, stored X5, machine (10, 20, 50), TLO Z50;
  - `Z0` → refused, `would also change X`; work X stays 10.
- **G37b — X-only, stored Z differs:** stored Z5 → `X0` refused, `would also change Z`.
- **G37c — healthy coupled XY:**
  - X and Y both requested with stored X/Y ≠ applied X/Y → admitted; both set, no unrequested change. A refusal here is a needless-refusal failure.
  - Only X with stored Y ≠ applied Y at R = 0 → refused (Y would change).
  - Only X with stored X ≠ applied X at R = 0 → admitted (needless otherwise).
  - Only X at R = 30° with ΔO_x ≠ 0 → refused: Y changes through the rotation.
- **G37d — G92 by axis:** applied G92-X7 / stored X0 → a Z-only touch-off is admitted (L20-G92 concerns Z only); applied G92-Z7 / stored Z0 → refused with the G92 reason.
- **G37e — rotation:** applied R0 with stored R5 → any touch-off refused with the rotation reason.
- **G37f — needless vs unrequested:** each case records which term refused. A refusal the after-effect does not require fails the guard, as does an admission with an unrequested change.
- **NR20 (native, owed):** each of G37a–e on the VM with the Python read. The predicted after-effect must equal the post-write read.

## 2. The PATH from a start record (MT512-02)

### 2.1 The record
- **The launcher writes it when LinuxCNC starts the display.** The linuxcnc script starts the display right after `halcmd start`, with milltask spawned just before (`lcnc-suite:218–224`). The record is `$LCNC_RESOLVED_LOG_DIR/ini_start.json` — state, like `loaded_program.json`:

  ```
  { instance: [linuxcncsvr pid, start_ticks],   # session_bind.discover_instance (lcnc-gateway/session_bind.py:136–160)
    ini: <absolute path>, sha256: <of the INI bytes>, mtime: <INI mtime>,
    python_toplevel: <inivar [PYTHON] TOPLEVEL or null>, recorded_at: <wall time> }
  ```
- **The start condition:** the record is VALID only if the INI's mtime ≤ the instance's start (the linuxcncsvr start ticks as wall time). Then the file was not modified after LinuxCNC started, so milltask's `Interp::init` read this content.
  - A newer mtime → the record says PATH UNKNOWN for this instance.
  - **The limit, named:** a replacement with an OLD mtime during the seconds of LinuxCNC's own start is not detected. No general anti-manipulation is claimed (R512).
- **PATH from a valid record:** PYTHON if `python_toplevel` is set, DETECTOR if not.

### 2.2 The gateway
- **What exists today:** nothing at `dbd14cab` records the INI at an instance's start. `session_bind` gives the process identity only (`lcnc-gateway/session_bind.py:66`). The start record is new in this step.
- **At its bind**, the gateway takes the record whose `instance` equals its bound instance:
  - **no record** (a standalone gateway, `DISPLAY = dummy`, a dev harness, an older launcher) → PATH UNKNOWN;
  - **a record** → its PATH, unless the CURRENT INI's sha256 ≠ the record's → UNKNOWN. The content changed since the start, and the plugin is configured in `Interp::init` from the INI (`src/emc/rs274ngc/rs274ngc_pre.cc:1016–1022`).
  - Whether `reset_interpreter` (PLAN_INIT) re-runs `Interp::init` and re-configures the plugin is NOT read here; it is owed with the TOPLEVEL measurement, and the rule does not depend on it.
- **The hash is compared again in the SAME step as every name read and every `;py,` attempt** — not only at the bind. A mismatch → UNKNOWN before that read is written.
  - The case this covers: a DETECTOR session; the operator adds `[PYTHON]` (what Q509-2 = yes invites) and presses Unload. Any later detector read finds the hash changed and reads no `#<_…>` name that a newly configured plugin might shadow.
- **An old mtime never replaces the record. Nothing ever derives DETECTOR from today's file.**
- **A gateway restart** reads the same record → the same PATH, while the INI is byte-equal.
- **UNKNOWN behaves as v5:** no `#<_…>` name read and no `;py,`; the basis stays UNCONFIRMED; the start asks at the entry; the touch-off is refused; the reason is shown.

### 2.3 Guards (G34 extended)
- **G34a — restore:** a session started with `[PYTHON]`; then an older backup without it is restored with `copy2` (an OLDER mtime, different content). A gateway restarted after that gets UNKNOWN, never DETECTOR.
- **G34b — gateway restart:** the INI is unchanged → the same PATH from the record.
  - The capability state is also kept in the instance-keyed record (`capability`, updated on every transition).
  - So an `unavailable` or `error` instance stays so across gateway restarts, and a restart does not run the error and the abort hook once more.
  - With no capability entry yet → `untried`, no stamp needed.
- **G34c — edit after the start:** a newer mtime at the launcher's record → UNKNOWN for that instance.
- **G34d — no record:** UNKNOWN.
- **G34e — a new instance:** a new record, a new PATH.
- **G34f — mid-session edit, gateway running:** a DETECTOR session; `[PYTHON]` is added to the INI, then Unload. The next Offsets → Read finds the hash changed → UNKNOWN; no `#<_…>` name is read.

### 2.4 The tables, completed
- **The capability states in v5 §1's overview** are `untried`, `ok`, `failed`, `error`, `unavailable` (`error` was missing).
- **The PATH states** are PYTHON, DETECTOR, UNKNOWN. The (a) row "`error` / `unavailable`, or PATH UNKNOWN" stays as v5 wrote it.
- **The DETECTOR help names both forms:** `This configuration has no [PYTHON] section with a TOPLEVEL, so the applied offsets cannot be read.`

## 3. The shared TOPLEVEL asset (MT512-03)
- **`examples/sim_config/python/read_toplevel.py` is a regular suite asset.** It is tracked in the repository like the TWP example's Python files. The installer NEVER deletes it: not on opt-out, not on reinstall.
- **The migration records ownership per INI** in `<config dir>/.lcnc-suite-python-migration.json`, keyed by the INI's FILENAME. The installed 3-axis, 5-axis and TWP INIs share one directory (`~/linuxcnc/configs/lcnc_suite_sim/`). Each entry holds:
  - the lines it inserted (byte-exact);
  - whether it inserted the `[PYTHON]` header itself;
  - the profile.

  No file hash is used as an ownership proof.
- **Opt-out (`--no-python-read`)** works per INI:
  - it removes only the recorded lines that are still byte-equal;
  - it removes the header only if the migration inserted it AND no other key remains in the section;
  - a key added later keeps the header and itself;
  - anything changed or unclear is kept and reported.
- **G43 extended:**
  - G43a — the 3- and 5-axis profiles use the asset at once; opt-out of one leaves the other's INI and the asset working;
  - G43b — two installed copies of one profile, likewise;
  - G43c — a key added to `[PYTHON]` after the install; opt-out keeps the header and that key;
  - G43d — the asset is present after every opt-out;
  - G39–G42 of v5 stay.

## 4. The angle in the error term (MT512-04)

### 4.1 The real computations
- **Canon:** `D2R(r) = r*M_PI/180.0`, then `cos`/`sin` (`src/emc/task/emccanon.cc:174–185`).
- **The interpreter:** `D2R(r) = r*(M_PI/180.)` (`src/emc/rs274ngc/interp_internal.hh:43–45`), then `Interp::rotate` (`src/emc/rs274ngc/interp_convert.cc:1743–1749`).
- **The two radian values can differ by up to ~4·u·|θ|:** two roundings each, in a different order. Each of sin and cos adds ≤ 1 ulp of a quantity ≤ 1.

### 4.2 The proven domain and the term
- **Domain:** |R| ≤ 360° (θ ≤ 2π). Inside it, a rotation applied to a vector of magnitude ρ contributes at most e_θ = (4·u·|θ| + 4·u)·ρ, with ρ ≤ \|v_x\| + \|v_y\| of the rotated operands.
- **The domain is DERIVED.** Its proof obligation is G36 and NR15, not a general theorem.
- **Where the term applies — only where the two paths meet:**

| Compare | Angle path | Term |
|---|---|---|
| detector point compare: the canon mirror vs canon's `#<_x…>` | the mirror reproduces canon's expression `r*M_PI/180.0` and the same libm `sin`/`cos` | 32·u·S + 4·u·ρ (trig only) |
| the self-check `#<_abs_…>` (the interpreter's forward rotate) vs the machine point; the Python `current_*` point vs P_s | interpreter vs canon formula | 32·u·S + e_θ per rotation applied (two: forward and back) |
| component compares (Python field vs STAT field), stored rows | no rotation | v5's 4·u·(\|a\|+\|b\|), or 0 |

- **Codex's counter-case** (R = 100000°, M = (1000, 0), residual 2.274e-10) lies OUTSIDE the domain. The model's θ-term at that angle would be 4·u·1745·1000 ≈ 7.8e-10 ≥ 2.274e-10, but the domain rule decides, not the formula.
- **Outside the domain** (|R| > 360°, or a non-finite R): the X/Y point compare and the self-check are **UNPROVEN**.
  - Those two compares adopt no XY confirmation and report no contradiction; the reason is named `Rotation outside the checked range`. The component compares (no rotation) still count normally.
  - It is never INCONSISTENT and never "reply unreadable". The other axes and the component compares still count.
- **`stored vs patch: e = 0`** holds only for the SAME stored double in the SAME unit. A value converted again (a G20 read of a mm table) takes the component path and its term.

### 4.3 Guards (G36 extended)
- **Inside the domain:** R = 0, 30, 90, 359.999 and −360, with large, nearly equal operands and a small remainder. The healthy pair passes; a pair 2·(q + e) apart fails.
- **The self-check:** forward (interpreter) and backward (canon) over the same set.
- **Outside the domain:** R = 100000 → UNPROVEN with the named limit; red against both INCONSISTENT and "unreadable".
- **The native G20/G21 cases** remain the acceptance (NR14), not a general proof from a few angles.

## 5. Texts (delta)

**Texts (≤ 60):**
- `Touch-off refused — would also change X`
- `Rotation outside the checked range`

**Help (≤ 120):**
- "would also change": `The stored fixture row differs from the one in effect on this axis. Touching off would move it as well.`
- "detector path": `This configuration has no [PYTHON] section with a TOPLEVEL, so the applied offsets cannot be read.`

## 6. Questions for Codex
- **Q6-C1 (§1):**
  - Is the closed-form after-effect right, with XY coupled, G92 on requested axes only, and `m` as defined?
  - Is L20-ROW (no unrequested change, no healing) the binding MT512-01 asks for?
- **Q6-C2 (§2):** is the launcher's start record with mtime ≤ instance start, the gateway's hash check and "no record ⇒ UNKNOWN" enough for the small scope?
- **Q6-C3 (§4):** is |R| ≤ 360° as the proven domain, with UNPROVEN outside, acceptable?

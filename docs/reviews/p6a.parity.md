# P6-a — the believed start before and after (parity corpora, the in-tree corpus, the metamorphic run)

Build item 3 of `maschinentag.r457.p6a-plan-v3.md` and Codex R457's build
note 3: every changed `start_believed` and every newly unbound beginning,
explained. Base = development `4eda3892`; fix = `feat/p6a-start-believed`
(rule 1, `gcode_canon._start_read`, commit `f6f01351`). All runs offline:
LinuxCNC 2.9.4's native interpreter in the REAL parse worker, synthetic
STAT, machine commands prohibited, one process per parse; the base runs used
a `git archive` of `4eda3892` with the SAME case file (the fix tree's
`native_start_probe.py`), so the case list is identical and each run imports
its own tree's worker and canon.

## 1. The parity corpora (TWP gantry, XYZAC)

Harness: `docs/reviews/p6a.parity.py` (`run <tree> <out>`, `compare`). Every
program of `scripts/parity_corpus/twp_gantry.json` (6) and `xyzac.json` (1)
under the profile's own INI from that tree's `examples/sim_config` (cwd = the
INI's directory, its var file, tool table, remaps, the TWP Python), STAT
synthetic (axis mask, mm, the profile's tool table, the rotaries pinned at 0
as `rotary_pose`, a G49 start), twice: the template's stored fixtures
(`stored`) and the fixture the corpus names for its live runs (`corpus`).
**Basis: offline, synthetic STAT — not the live parity gate** (that needs the
matching config running; the parse inputs it reads from STAT are pinned
here, the same for base and fix).

28 parses, none with a parse error. Result, base → fix:

| Profile | Programs × variants | `start_believed` | Every other field (points, masks, unknown starts, `start_unbound`, the digest without the start fields) | Dependent axes at the first point |
|---|---|---|---|---|
| TWP gantry | 6 × 2 | (0, 0, 0) → **(0, 0, 200)** in all 12 | identical | none |
| XYZAC | `m600_live` × 2 | identical | identical | X, Y (`rapid_dep` [3, 3]) |

**TWP — explained.** Every head is `g10 l2 p0|p1 …` then `m6 t1 g43 h1` in
ONE block, then a move commanding X, Y and Z (`g0 x0 y0 z50` / `g0 x0y0z100
a0`). In that block the M6 converts before the G43 (interp_execute.cc
`convert_m` before `convert_g`) and the M6's resync takes effect at the next
read, restoring gcodemodule's last endpoint (zero, no motion yet) under the
G43 H1 that is already in effect (T1, 200 mm): the interpreter's position at
the first point is (0, 0, 0) under a 200 mm offset — re-based to the begin's
G49, Z + 200. That is the position the first point is made of (the plan's
`twp_head_shape_rot`, (0, 0, 80) with an 80 mm tool, and Codex's `cx_m6_g43`,
(0, 0, 20) with 20 mm, both bound to the commanded endpoint by the client).
Before, the rotary sync's `lo` (the init-end position) stood there. **Nothing
visible changes**: no axis depends on the start at the first point (all three
commanded), so no point is shifted by Δ and no beginning is bound; every
other field is byte-identical. The client reads the value only behind a
dependent beginning: `buildScrubTrack` keeps `startBelieved` only with
`depEnd > 0` (scrubTrack.ts:343) and `bindBeginning` returns the base track
at K = 0 (startDep.ts:92); the gateway's verify (VP-I20) compares it between
two parses of the same worker. This is the F9-R0 shape of the plan's triage
(the resync before the first point — rule 1's), not F9-R.

**XYZAC — unchanged.** `G53 G0 Z0` first, then `T1 M600`: the rotary sync
makes `lo` the init-end position and no resync comes before the first point —
the read equals it. Both fixture variants: equal.

No beginning became unbound in either corpus.

## 2. The in-tree corpus (`native_start_probe.py`, 445 cases)

355 cases of `4eda3892` + the 90 of this package, today vs fix (fields:
`parse_error`, `start_unbound`, `rapid_dep`, `feed_dep`, `rapid_ustart`, the
digest without the start fields, `violations_total`,
`start_dep_unavailable`; `start_believed` within 1e-9):

- **Of the 355 cases at the base: `start_believed` differs in exactly two,
  nothing else in any.** `e_no_interp` (VP-I80's injection: no interpreter
  words) ships none instead of a value from `lo` — X, Y, Z were unbound
  before already. `m600_result` (G54 Z = 10, no dependent axis): (0, 0, −10)
  → (0, 0, 0), an F9 instance in the tree with no binding moved.
- **The 90 new cases**: `start_believed` changes in 60 (every one the plan's
  v3 column, `maschinentag.r457.p6a-plan-v3.md` value table); `start_unbound`
  newly [X, Y, Z] in the 7 cutter-compensation cases (`comp_first`,
  `comp_first_g55`, `comp_next_xyz_g55` with their rotary twins, `cx_comp_g40`)
  — no `start_believed` there; no other field changes anywhere.
- Rotary twins at the last bit only: `g20_g55_rot`, `g43_start_g55_rot`,
  `g43h_g55_move_rot` differ in `start_believed` by ≤ 7e-15 mm (the synced
  `lo` against `rotate_and_translate(current)`); the guards compare with a
  tolerance (`places=9`), VP-I20's verify with `VERIFY_F32_REL`.
- Payload bytes: of the 445 encoded payloads 65 differ, all by
  `start_believed` / `start_unbound` alone. Every case the other native
  fixture generators take (`gen_tool_change_payloads` 33,
  `gen_limit_origin_payloads` 11, the 26 earlier `gen_start_dep_payloads`)
  encodes byte-identically before and after — no committed fixture moves.
  (`e_m600_return.msgpack` as committed is older than 7e7eb91c and differs
  from what BOTH trees generate today — a stale fixture, not this package's;
  left as it is.)

Differential against the two independent prototypes: the 81 plan cases this
package shares with the planning agent's `cand` variant
(`~/claude-work/p6/f9b/out/*.cand.json`) and the 21 of Codex R457's
`cand` observations (`maschinentag.r457.codex-native-observations.json`)
are identical in `start_believed`, `start_unbound`, the masks, the unknown
starts and the payload digest.

## 3. The metamorphic run (guard 10)

Every case once more with all fixture rows G54…G59.3 moved by D = (100, 200,
0) (`START_PROBE_SHIFT`), each against its own unshifted run:

| | `start_believed` stays | moves by exactly −D | moves otherwise | masks / unknown starts changed |
|---|---|---|---|---|
| base `4eda3892` | 49 | **390** | 6 | 4 |
| fix | **441** | 0 | 4 (named) | the same 4 |

The fix's four moves are the absolute writes of the first point's fixture
before it — the written frame does not move, so the believed start in it
moves by D on the written axes: `r133_g55_before_first` (`G10 L2 P2 X5 Y6 Z7`
/ `G55`) +(100, 200, 0), `r133_inline_explicit_write` (an inline sub's
`G10 L2 P1 X1 Y2 Z3`) +(100, 200, 0), `r107_body_g92_numbered_like_explicit`
(`G10 L2 P1 X0`) +(100, 0, 0), `cx_g10_active` (`G10 L2 P1 X50 Y70 Z-9`)
+(100, 200, 0). The base moved none of them correctly.

The four mask changes are translation variances that are no start's, alike
before and after: `e_arc_dep` (an arc's segment count follows its
machine-frame radius) and `r108_explicit_alone`, `r109_py_explicit_alone`,
`r109_py_line4_explicit_alone` (an absolute `G10 L2 P1 X0` after an unknown
start: the moves after it change shape under D). `start_unbound` and
`start_dep_unavailable` never move. The guard
(`test_start_dep_worker.TestAFixtureTranslationMovesNoBelievedStart`) names
both lists; at the base it fails in 399 cases (the same judge over the base's
runs).

## 4. The client chain and the page

`startDepPayloads.test.ts` (the believed start under fixtures that are not
zero): 11 native payloads bound at the believed physical start P AND at Q =
P + (13, −17, 7) mm (inch: + (0.5, −0.7, 0.3)) — the first endpoint in
machine joints keeps every uncommanded axis at the live value, a commanded
one lands on its target; the machine day's head (anonymized `mday_head`):
(238.525, 379.696, 0), the beginning `cum[K+1]` = 5.4515 s (13.555212 s at
the base — the trace's figure, to the digit, with the anonymized head too);
the comp payloads: no believed start, [X, Y, Z] unbound, no entry. The bar's
total for that head at the G54 origin: 34.27 s (base 42.37 s).

`e2e/start-believed.viewer.spec.ts` reads the scene on the mock page: the
tool tip at the entry move's end — `mday_head` (238.525, 379.696, 0) and the
bar's total 00:34; `g55_first` (310, 200, −30). Red at the base: the
mutation record (`p6a.mutations.txt`, M1 = the base's rule).

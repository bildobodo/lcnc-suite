# Stock mute — plan v2 (2026-11-25, after Codex R484)

Base: development `24f3bd3a`, worktree `/home/cnc/lcnc-suite-sm` (branch `feat/stock-mute`). Plan and scratch probes only (`~/claude-work/p6/sm/`); no product code. Replaces v1.

## Changes against v1

| R484 | Change |
|---|---|
| **new, found on the way (§0)** | The real G83 payload holds no pecks: the parse worker's decimation drops the feed / rapid changes. The check's path is then not the program's: a rapid into the stock read as a FEED, a ramp drawn from the wrong corner (15.6 mm off), one long rapid plunge no program makes. **Not a stock-pair matter, it hits every pair.** H needs it fixed first (step 0, reviewed apart, **landing in the same merge**: each alone makes a stock machine's G83 worse) |
| MT484-01 | Open body: APART only by disjoint WHOLE boxes of both bodies in the open one's frame, 40 facet orders of both bodies: one answer each (§3.1). **Taken alone that keeps the mute and loses findings today's rule gives** (measured), so an open container gets a state of its own, UNRESOLVED: it claims no separation, but machining is not proven any more either, and a rapid touch is reported |
| MT484-02 | Own hole by IDENTICAL poses only: one program coordinate moves, every other bit-equal, exact comparisons, no tolerance anywhere; the top bound is the proven free side of the entry's bracket; the basis is asked at every point, zero-length ones first (§3.4). Real payloads carry that equality in every case tried (§3.4) |
| MT484-03 / Q3 | (i) withdrawn. This package may come before c2 and closes nothing of the shank window; what c2 must add, its acceptance cases and a measured comparison of its options: §6 and appendix A |
| Q1 | Both reported; the five in-slot retraces are counted apart, neither as false nor as uncut reference |
| Q2, Q5, Q6, Q7, Q8 | Taken as answered; "free stretch" in the guarantee is exactly APART; Q8's wording changed |
| Q4 | Rule D is out of this plan (measured in v1, kept there) |
| Frame | Independent analytic cases for the hole; scan cost measured, CAP 4096 → 1024, no temporary intervals; 1289 → 6893 samples kept as extra work; the unverified contact / union / range / worker paths are a merge condition (§4) |

**In one sentence:** the cut rule gets its own state, begun by a PROVEN touch on a feed and ended by a PROVEN separation, apart from the margin episode; one exemption keeps peck drilling silent: a rapid along the tool axis on bit-identical poses the same cutter has just been fed through.

## 0. Step 0 — the payload must keep the changes of kind (own review, same merge)

**Found** by parsing real G83 programs with the worktree's parse worker (synthetic STAT, no NML, `sm/g83/`). `gcode_parse_worker.py:1181–1300` thins the feed and the rapid list each for itself (RDP 0.005 mm). A rapid vertex that lies on a chord of the RAPID list is dropped although feeds run between; its neighbours in execution order are then joined by a segment of the wrong kind or place.

| Program (real parse) | Path the program drives | Path in the payload, so in scrub and check |
|---|---|---|
| `G83 X50 Y30 Z-18 R3 Q3` | 40 → R3 → F0 → R3 → R0.25 → F−3 → … (24 points) | R40 → **F0** → **R−14.7** → F−18 → R40 (6 points): feed from 40, then one rapid plunge of 14.7 through the block |
| `G0 Z15 / G0 Z-2 / G1 Z-5 / G0 Z15 / G0 Z-4.5 / G1 Z-8` (a rapid 2 mm into the block) | rapid to −2, feed to −5 | R40 → **F−5**: the rapid is gone; **no rule reports it** (with the changes kept: today 2 findings) |
| ramp entry: `G0 Z3 / G1 X26 Z-3 …`, next level by `G0 Z-2.5` at the same X / Y | (6,6,40) → (6,6,3) → ramp (26,6,−3) | (6,6,40) → **straight to (26,6,−3)**, 15.6 mm off the corner |

**Contract:** every point next to a change of list in execution order is a decimation anchor, in both lists. **Guard:** the merged payload's runs of one kind and their end points equal the canon's before the thinning, bit for bit; the three programs above; G81 / G82 / G73 / G83 / expanded. **Size** (scratch copy of the worker): `cds`, `arcspiral`, `3D_Chips`, `3dtest`, a 200 × 200 relief: the SAME bytes; `tort` +0.2 %; G83 200 holes × 30 pecks 28.7 → 543 kB (its real 17 000 vertices). No new key, no schema change; the time axis keeps its sums. A run of ONE kind is thinned as today.

**Why it must come first** (real G98 payloads, Ø6, block top 0; findings per hole):

| R | today's payload: R0 / A / A + H | changes kept: R0 / A / A + H |
|---|---|---|
| 1, 2 | 0 / 0 / 0 | 1 / 6 / **0** (+ 1 near miss) |
| 3 | 0 / 0 / 0 | 0 / 5 / **0** |
| 5 | 0 / **1** / **1** (the plunge that does not exist) | 4 / 6 / **0** |
| 10 | 1 / 1 / 1 | 7 / 6 / **0** |

So on today's payload A + H would ADD a false finding per hole wherever the first peck ends above the stock; and step 0 alone would show today's rule the real pecks (4 and 7 false per hole at R 5 and 10, today 0 and 1). **Neither may ship without the other.** The programs of §1.3 are built vertex by vertex: their numbers hold for the payload with the changes kept.

## 1. The physical question

### 1.1 What "machining contact" means for a check that never cuts

The stock body is never cut away. After one feed pass the cutter (the WHOLE tool body, shank included) stands inside the stock's geometry for the rest of that stay. Inside it a rapid's touch proves nothing about uncut material:

| A rapid touches the stock … | known | verdict |
|---|---|---|
| … in a contact a feed began and that never ended | no uncut volume is proven | silent, as today (every plain retract; also the blind spot of limit 2) |
| … after a proven separation | a NEW entry into the unchanged stock model by rapid | a finding. Conservative: it says nothing about material really left |
| … after a proven separation, on poses the same cutter was just fed through, along its axis | the cutter stood exactly there on a feed | silent (own hole) |

A volume cut earlier (a roughed pocket re-entered elsewhere, another tool's hole, the slot just cut) stays stock: its rapid re-entry is reported, whatever the retract height. Today it depends on that height.

### 1.2 What today's rule does (measured on complete paths)

| # | Fault | Evidence |
|---|---|---|
| a | `cutMute` at `d <= margin` on a feed: a feed that never touched mutes a later rapid plunge | feed to 0.05 / 0.5 / 1.5 above, rapid down: nothing |
| b | it ends only past 2 × margin | slot fed out 5.0 mm past the face (3.5 free), rapid back or beside: nothing |
| c | and 2 × margin is not even SEEN reliably: the advancement never has to sample a peak between 2 and 4+ mm | G83, R 4.5: silent; R 5: 1 of 5 re-entries; R 10: 5 of 5 |
| d | **the other way round**: a rapid to R ≤ margin opens a rapid-begun near episode; the feed's touch does not close it, the retract's touch opens an interval bisected back over the FEED | G81 R 1: "collision, rapid" on the G1 line, one per hole; a relief with R 1.5: 59; `cds.ngc`: 1 |
| e | after a rapid part that ended at a feed (`cutPart`), a later real separation and second gouge is folded into the first | rapid gouge, feed out 1 free, gouge again 4 beside: 1 finding instead of 2 |

### 1.3 Scene and references

Scene of `p6/c5/probe/mute.ts` (block 120 × 80 × 30, margin 2): 32 normal programs, 5 slot retraces (Codex's 2 … 8 mm, listed apart), 15 gouge programs (27 events), 5 LinuxCNC example files (stock box assumed). **Truth**: a 0.25 mm height map cut by every feed. **Fidelity**: the sweep against the contract's own states on dense samples (0.02 / 0.03); it tests the sampling, not the rule. **The hole** has its own analytic reference (§3.4).

## 2. Candidates

| Rule | 32 normal programs: false collisions / near misses | 5 retraces reported (deliberate) | gouges (27): lost / false | examples (16): lost / false | fidelity: lost / extra |
|---|---|---|---|---|---|
| **R0** today | 209 / 32 | 2 | 13 / 1 | 9 / 1 | **95 of 375 / 22** (400 programs) |
| **N** mute ends at the first free sample | 240 / 152 | 5 | 2 / 1 | 7 / 1 | 4 existing tests red |
| **A** the contract of §3 | 325 / 143 | 5 | 2 / 0 | 8 / 0 | 0 of 375 / 0 (400) |
| **A + H** + own hole, identical poses — **this plan** | **25 / 143** | **5** | **2 / 0** | 8 / 0 | 0 of 185 / 0 (200; the reference's hole test is a separate one) |

The near misses rise by 111: 110 are former false collisions of fault d. A's 325: 300 are G83 re-entries. A + H's 25: multi-level pocket re-entered by rapid to the last level + 0.5 (12), open slot driven back at depth + 0.2 (12), a finishing pass rapid into the roughed pocket (1). The 2 + 8 lost are rapids sideways in a contact that never ended (limit 2).

| Guard case | R0 | A | A + H |
|---|---|---|---|
| slot fed out 2, 3.2, **5.0** past, rapid back in it / 4 beside it | — / — | 1 / 1 | **1 / 1** |
| **6.2**, 8 past, in it / beside it | 1 / 1 | 1 / 1 | **1 / 1** |
| feed → 0.05 / 0.3 / 1 / 1.9 free → rapid back | — | 1 | **1** |
| feed near, no touch → rapid down | — | 1 | **1** |
| G83 re-entry above / 0.1 and 2.5 below the last depth | — / — | 1 / 1 | **— / 1** |
| the same, 0 / 5e-5 / 1.5e-3 / 2.1e-3 / 0.02 off in X | — | 1 | **— / 1 / 1 / 1 / 1** |
| continuous feed contact, plain retract; feed out and feed back in | — | — | **—** |

## 3. The contract (A + H)

### 3.1 What a sample proves

| Class | Condition |
|---|---|
| **TOUCH** | decided, not on a braking range, `d <= CONTACT_EPS` (inside, or inside by its certificate, counts) |
| **APART** | decided, not on a braking range, `d > CUT_SEP` (1e-3 machine units; 0.0254 mm on an inch machine), AND the inside question answered for both directions: a CLOSED container by its own verdict or certificate (`pairInside`, as today); an OPEN container only by a complete exclusion: the WHOLE box of the other body, taken into the open body's frame, and the open body's whole box do not meet |
| **UNRESOLVED** | decided, not on a braking range, `d > CUT_SEP`, but an OPEN container is not excluded: the surfaces are apart, the inside is unknown |
| **nothing** | undecidable; on a braking range (and its end pose); 1e-4 < d ≤ 1e-3; the tool unknown; a pose nobody sampled |

Whole boxes, not component boxes: a soup of separate panels encloses room no panel's box holds, and a whole box depends on no triangle order. Measured: Codex's tool 5 deep through the open top, 40 random facet orders of both bodies: not proven, every time; 0.5 wholly above: proven, every time; boxes just meeting: not proven.

**Why UNRESOLVED and not "nothing".** An open stock is easily made: one missing facet, or two boxes that share a face (their common edges do not close). Keeping the mute there would be a LOSS against today, whose 2 × margin ends it:

| L-shaped block 120 × 80, fed out `c` clear into the notch, rapid back beside | R0 | boxes, mute kept | boxes + UNRESOLVED |
|---|---|---|---|
| closed solid, c 1 / 3 / 8 / 20 | — / — / 1 / 1 | 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 |
| one facet missing, or two boxes sharing a face | — / — / 1 / 1 | **— / — / — / —** | 1 / 1 / 1 / 1 |
| a 5 mm tool fed wholly inside the open block, rapid up | 1 (false) | — | 1 (false, as today) |

UNRESOLVED ends only the PROOF of machining. A rapid touch from it is a finding (unknown is never Clear), a feed touch is MACHINING, the own hole is refused. It depends on no triangle order. Both shipped stock bodies are closed (44 and 12 facets) and never see it.

Call sites of `noteQuery`: the main loop and the re-sampling after a touch ask the inside question or hold its certificate; `searchBack` and the boundary's `d0` run where the near sample certified "no touch". `finish()` notes nothing.

### 3.2 The state, per cutting pair: none / UNRESOLVED / MACHINING / RAPID

| State | TOUCH | APART | discontinuity (tool body, offset, unknown start, tool unknown) |
|---|---|---|---|
| none, UNRESOLVED | the kind of the move the bisected ENTRY lies on (a point on a move's end is that move's): feed → MACHINING; rapid → own hole (from none only)? MACHINING : RAPID. A range's first sample → MACHINING | none | none |
| MACHINING | stays, nothing written | **none** | **none**; the earlier free sample is no floor, the hole question no longer reaches back |
| RAPID | as today (ended at a feed, later rapid parts continue it) | **none**; `cutPart` / `cutFeedAt` cleared | as today |

- An UNRESOLVED sample (open container only) takes MACHINING and RAPID to UNRESOLVED (rows as at APART).
- The program's first known pose in the stock: a first feed is MACHINING, a first RAPID a finding (Q7). `collision.md` and the comment at `collision.ts:1741` are corrected. An unknown approach is not made a checked pose by it. A range's start has its own boundary report and stays MACHINING.
- A stationary relabel is no discontinuity. A braking range or an undecidable sample is no separation and no begin.
- A feed 0.108 deep followed by a rapid up is first SEEN on the rapid: the entry's move decides (feed). The mirror, a rapid that ends 0.1 inside and a feed, is a finding on the rapid's line.

### 3.3 Rows

MACHINING writes nothing; at its begin an open episode without an open interval closes at its last near sample. RAPID opens its episode where there is none, `onset` = the bisected entry. The near part keeps today's rule as `stayMute` (set by a feed sample inside the margin or MACHINING's begin, cleared past 2 × margin, never while MACHINING). No schema change, which proves nothing about the union (§4).

### 3.4 Own hole (`viewer/fedPath.ts`, pure)

Asked once per rapid begin and once where a near episode would open on a rapid. True only when ALL hold, every comparison exact:
1. On the rapid exactly ONE program coordinate changes; the other two and A, B, C are bit-equal. The same holds for every point of the run before it.
2. Same basis at every segment read, **asked before any length is looked at**: `tlo` (tool and offset), `wcs`, `mode`, `frame`, `cond` equal; no `brk`, `ustart`, `band`, `unpredicted`; after `depEnd`.
3. That coordinate is the tool's axis in the stock's frame (two poses; rotation equal, displacement ∥ the tool's Z within 1e-6). This is the operator's distinction (hole, not slot), no proof of cut volume: its tolerance excuses nothing that 1, 2 and 4 do not prove.
4. The feed stretches of the run, merged outward from the deepest pose the rapid run reaches, cover that pose and everything up to the FREE side of the entry's bracket (a proven free sample outside the entry; never the contact side plus a resolution). An interval that does not meet the union when it is read is dropped (conservative).
5. A following rapid that leaves the line does so at or outside that free side.

At most 1024 segments back and 1024 forward; past that: not excused. Any doubt refuses. Then every pose of the touching rapid is one the sweep itself would pose identically for an earlier feed of the same body in the same basis.

**What the real payload carries** (worktree worker, changes kept; 16 programs: G83 G98 / G99, G54 with 6-decimal offsets, XY rotation 33.3°, G92, G91 L3, G20 on a mm machine, an inch machine, G73, expanded pecks with and without X / Y words, a subroutine with a loop, A 30): **one bit pattern of X and one of Y per hole, and the feed union without a gap under exact f32 comparison, in all 15 that peck along Z.** (The 16th, G18's cycle, runs along Y: condition 3 refuses it.) LinuxCNC's own sequence: `interp_cycles.cc:161–168`, back-off 0.010 in.

**What it refuses, named:** pecks along a TILTED axis written in X Y Z (TCP, identity with the line not on a program axis): f32 points on an oblique line are never bit-collinear, and a CAM's 3 decimals put them up to 0.0007 off, 7 × CONTACT_EPS. They are reported (TCP on the shipped models, two 5-peck holes: 5 findings, today 1–3). A hole in a tilted WORK PLANE runs along program Z and is bit-equal (not yet seen on a real G68.2 payload).

**References and guards apart from the sweep:** 20 000 random 1-D programs against an integer cell union: 12 284 negatives, 0 excused; 6262 positives, 111 refused (rule 4's dropped intervals). Lateral 0 / 5e-5 / 1.5e-3 / 2.1e-3: excused / refused ×3. Nine changes at a zero-length point (tool row, fixture, kinematics, frame, relabel, unknown start, braking range, unpredicted, A by 1e-5), behind AND ahead of the entry: all 18 refused, the two controls excused. The hole fed from 0.5 above the top: excused; from 0.0005, 0 or −0.0005: refused. On tilted models: re-entry 1 below the last depth 4 of 4 reported; program-Z pecks under a tilted TCP axis 4 of 4 reported.

**Cost of the scan** (VM, Node, no temporary arrays): worst ask 4098 steps 189 µs median, 826 µs max; with the cap at 1024: 48 / 241 µs. A real 10 × 33-peck payload: 290 asks, 12 760 steps in the whole sweep, at most 86 in one. The sweep reads its clock every 32 samples and a sample can ask once per cutting pair, so the adversarial worst case between two checkpoints is COMPUTED as 32 × 0.24 ms ≈ 8 ms in the worker (4096: 26 ms), never on the page; no such task was measured. N100 not measured.

### 3.5 Sampling

- R88's condition (`collision.ts:2678`) loses `!onsetRapid`.
- **Guarantee:** a stretch that is APART, and the rapid touch after it, each wider than MIN_ADV (0.25 machine units of path) are found. "Apart" is §3.1's class and nothing wider.
- Held by the dense reference: synthetic 0 lost / 0 extra (§2); shipped XYZAC identity and gantry TCP with rotary moves 11 of 11 and 14 of 18 (the other 4 narrower than MIN_ADV), 0 extra (v1's hole).
- **Cost:** LinuxCNC examples and normal milling unchanged (`tort` +32 probes); G83 at R 1 **1289 → 6893 samples, real extra work** (it was not re-sampled before; R 3 costs 7277 today); with step 0 a peck program is checked on its real path (10 holes × 33: 43 618 samples under every rule).
- Shards split by pair; split 2 / 3 / 4: same rows within the bisection (7e-4).
- **Range:** touching at its first sample → MACHINING (the boundary contact names it); near → not MACHINING, a rapid touch after it is a finding. The hole question may read feeds that **lie before the range in this complete modelled execution**, under the same body, basis and every break including `depEnd`; a range proves no material removed on the machine. A run from line is not checked at all (P6-d0); **its package must put a floor here.**

## 4. Build

**Files.** New `viewer/cutRule.ts` (§3.1 / 3.2 as a pure step), `viewer/fedPath.ts`. Changed `viewer/collision.ts` (sink 1881–2090, boundary reset 2416–2430, R88 2678; ~90 lines). Docs `collision.md`, `decisions.md`, CLAUDE.md's line. `scripts/test_select`: the new tests' read sites. No store, transport or UI change. ~200 product lines, ~550 test lines. Step 0 is a package of its own (`gcode_parse_worker.py`, ~15 lines + its guards).

**Order.** Step 0 (own plan and review; merged together with this package) → 1 references and guards red → 2 `cutRule` + rows → 3 R88 → 4 boundary, range, first pose → 5 `fedPath` → 6 docs → round gate. The state machine may be reviewed apart; delivery needs 5.

**Guards and the mutation each must catch** (133 of 133 tests of `collision.test.ts` + `collisionRange.test.ts` pass unchanged under A + H; both oracles exclude the tool × stock pair today):

| Guard | Mutation |
|---|---|
| 5.0 and 6.2, pin and stepped body, in the slot AND beside it, depth 8; depth 20: 3.1 … 8 reported, 1.6 / 2.9 pinned as c2's open window | end at > 2 × margin |
| feed → 0.05 … 1.9 free → rapid back | the same; `!onsetRapid` back |
| feed near, no touch → rapid; range start near → rapid | begin at `d <= margin`; boundary near → MACHINING |
| G81 / relief at R 1: one near miss of 1.0, nothing on the feed line | MACHINING only without an open episode |
| plain retract makes no near miss | `stayMute` ended by APART |
| gouge, apart, gouge beside: two findings | `cutPart` not cleared |
| braking range: out and in again; ends 0.1 free, then rapid (silent) with its control; R126's two | range sample as APART / as TOUCH |
| T1 → T2, G43, unknown tool, unknown start (reported on a rapid, silent on a feed); relabel (silent) | each reset dropped; relabel resets; the old free sample as floor |
| feed 0.108 deep, rapid up; rapid 0.1 inside, then feed | the sample's kind instead of the entry's |
| 5e-4 off and back (silent) | `CUT_SEP` = CONTACT_EPS |
| open stock: Codex's tool, 2 × N facet orders, one answer; the wholly outside control; the L-block ladder (closed, one facet missing, two boxes); short tool wholly inside (a finding, as today) | representative point instead of boxes; UNRESOLVED keeps the mute; UNRESOLVED allows the hole |
| first pose in the stock: feed silent, rapid reported | engaged = MACHINING |
| hole: the list of §3.4 with its 1-D reference, lateral ladder, 18 zero-length changes, top ladder, mm and inch, tilted models, other hole between, sideways at depth, T2 in T1's hole, first peck on a range, 1025th segment, lateral retrace (reported) | a tolerance anywhere; basis after a `continue`; contact side as top; following rapids ignored; axis test dropped; `depEnd` ignored; cap dropped |
| range from inside a G83 (silent); shards 1–4; inch machine | scan floored at `range.from` |
| height map (truth): the 32 + 15 programs with their counts; dense reference (fidelity) | any of the above |

**Before the merge** (v1's "not verified", now conditions): `sweepShards`, `contactUnion*`, `contactUnionSweep`, `contactView*`, `contactPublisher`, `collisionRange(Oracle)`, `collisionWorker` on the new rows; a stock pair through a worker fallback (two generations with different shard counts: same events, an earlier key kept); range then full; entry move joined to a base that begins in the stock; `collisions.viewer.spec`. Browser and N100 times stay open and are not claimed.

**What the operator sees.** Only models with a `stock` body (XYZAC and gantry examples, a user's own). The shipped 3-axis model has none. With one: the false rapid collisions on feed lines at R ≤ 2 become near misses, a rapid re-entry is a finding whatever the retract height, G83 along a program axis is quiet. The shipped machines with a stock body are exactly the five- and six-axis ones: TCP pecks written in X Y Z stay loud there (limit 5). No new word or control. **The operator question (hole yes, slot no) is asked by the coordinator; a "no" drops step 5 and nothing else, at G83's price.**

## 5. Limits (named in `collision.md`)

1. The whole tool body cuts (§6).
2. A rapid sideways in a contact that never ended is silent (2 constructed cases, 8 of 11 in `tort.ngc`). As today.
3. A volume cut earlier is still stock.
4. A free stretch or touch narrower than MIN_ADV can be missed (6.35 mm on an inch machine).
5. Pecks along an axis that is no program axis are reported (§3.4).
6. A rapid retract after a probe touch on its braking range stays a finding (R126).
7. A feed-begun near stay mutes a rapid's near MISS, never its touch.
8. On an open stock or tool machining is proven only while the surfaces touch: a short tool wholly inside an open block and then rapid out is a false finding, as today.

## 6. What this package leaves to c2, and c2's acceptance

It closes the R477 gap for a tool whose shank is above the stock: 0 of 367 pin findings without one of the body under this plan's rule (today 10 of 330). **With the shank in the stock it closes nothing:** 7 of 370 stay missing, and the shank's own contact is no finding, so nothing replaces the warning. c2 stays open there until it has either the cutter / shank split or the pin as an additional independent decision for stock pairs. Neither the larger body's mute nor its state may decide for the other.

**Acceptance inputs for c2** (Ø3 flutes 10 on Ø6, `q9.ts` program generator, seeds and sweep parameter): deep (tip to 19) 67: 57.15–90.87 (Codex: today's pin AND the pin under A + H, five intervals against four); 75: 47.25–85.25; 186: 149.83–170.74; 232: 94.42–120.99 and 125.68–140.12; 280: 77.73–83.31 and 107.02–120.72. Flat (tip to 9.5): seed 67 five of five, all 300 seeds none missing. Slot at −20 fed out 1.6 and 2.9 past, rapid back; at −8: e 1.6 … 8.
**c2's plan must add:** where the cutting part ends and from which data; what a tool without that data gets; the union of the decisions, its limits and its cost; that each decision keeps its own cut state.

## 7. Questions

**Q1.** Step 0 with the contract of §0, reviewed as its own plan and merged TOGETHER with this package (each alone makes G83 on a stock machine worse)? It is a defect of the preview for every pair, with or without a stock body (a rapid into the part read as a feed). Recommendation: yes, next.
**Q2.** Identical poses only, and limit 5 (oblique pecks reported) as its price: agreed? A conservative containment for oblique lines would need the CAM's rounding as an error range of its own; not proposed.
**Q3.** Open bodies (§3.1): whole boxes prove APART, and UNRESOLVED reports instead of muting. Your "keep the inside question open" read as: no claim of separation, and no proof of machining either. Agreed, or is the kept mute (with its loss against today) meant?
**Q4.** CAP 1024 and the dropped intervals of condition 4 (111 of 6262 positives refused in random programs, none in the real peck sequences).
**Q5 (c2, not this package).** Appendix A favours the split where the body is WIDER than the cutter, the pin as second decision only for tools without a flute length. Direction?

## Appendix A: c2's two options, measured (one page)

Rule A + H throughout; probe `q18.ts`. **S1** split at the flute length; **S2** the non-cutting part begins at the first height at or above the flute length where the contour is wider than the largest cutting radius; **P** body + pin, each with its own state, findings united. The shank is an ordinary body: any touch counts, near misses inside 2 mm too.

| Setup | one body | S1 | S2 | P |
|---|---|---|---|---|
| **fine setups** (a collision is false): T14 (Ø3 / 10 / Ø6) pocket 6 | — | — | — | — |
| T14 slot 8 and 9.5 (shank 2 and 0.5 above the top) | — | 1 near each | 1 near each | — |
| Ø6 flutes 20 on Ø6: pocket 18 / slot 24 | — | 1 near / **2 collisions** | — | — |
| Ø6 flutes 8, neck Ø5.6: slot 18 | — | **6 collisions** | — | — |
| V 60° engraving; taper T13 engraving and pocket 9; chamfer 90° edge | — | — | — | — |
| T-slot Ø12 on a Ø6 neck at −14 | — | **1 collision** | — | — |
| **wrong setups**: T14 slot 20 (shank in the block on every feed) | — | 3 + 1 near | 3 + 1 near | — |
| T14 fed out 1.6 / 2.9 at −20, rapid back (pin: 1) | — | 2 (shank and cutter) | 2 | 1 |
| **hunt**, 100 programs, pin findings without one of it: tip to 9.5 / 19 | 0 / 2 | 0 / 0 | 0 / 0 | 0 / 0 |
| **cost** against one body in the hunt (queries, probes) | 1 | +27 … +34 %, +0 … +13 % | the same | +90 … +96 %, +95 … +100 % |

- S2 reports the crash itself (the shank touching on the feed) and closes the window; P closes the window only, and a shank fed into the block stays silent.
- S1 reports every shank that is no wider than its cutter: not usable.
- S2 is silent for a neck narrower than the cutter, deeper than its flutes: right while the neck follows the cutter's own slot, blind for a T-slot cutter lifted straight up (as today).
- **No flute length** (a table row without a library row): no split can be proven. The drawing's `flute_length ?? 0.6 × length` (`toolGeometry.ts:82`) is no basis. Such a tool is today's cylinder anyway (P6-c: unpaired = cylinder), so body = pin and there is nothing to lose; a paired shape without the field gets P.
- V-bits and chamfer tools: the cutting radius is the cone's largest, the shank no wider: one body, no change.
- Not measured: a swap of two bodies per tool in the worker, the near-miss flood of a real deep pocket under S2, several shank diameters, tilted work, times.

## Appendix B: probes

`~/claude-work/p6/sm/probe/`: `mkvar.mjs` → `coll_v.ts` (rules R0, N, A, **S = A + H of this plan**; C = v1's hole), `fedpath2.ts` (the hole, v2), `q16.ts` (MT484-01 / -02 guards, 1-D reference, scan cost), `q15.ts` / `q17.ts` (real payloads through the product's track builder), `q10.ts` (tilted), `q3.ts` → `q3s.out`, `run.ts` → `run3.out` … `run6.out`, `q4.ts` → `q4.out`, `q4b.out`, `q4s.out`, `q9.ts` / `q9l.ts` / `q9f.ts` → `q9l.out`, `q9f.out`, `q18.ts` → `q18h.out`, `q19.ts` (open stock); `vt/` (existing tests against the copy). `sm/g83/`: `g83_probe.py` (the worktree's `native_start_probe.py` with own cases: synthetic STAT, private HOME, no NML), `cases.py`, `mkworker.py` (the worker's scratch copy with kind anchors), `eq.py`, `show.py`, `out/`.

**Not verified:** step 0 beyond the scratch copy (the drawn toolpath, the parity goldens and the limit flags were not looked at); a G68.2 payload (the recorded parity payloads hold no peck); the UNRESOLVED state beyond §3.1's cases (the corpus, the hunts and the 133 tests ran on closed bodies); a real worker, the union, the range oracle, the browser, the N100, any product time; the shipped-model hunt with v2's hole (run with v1's); XYZAC TCP only by the tilted holes; `sweepShards` and the union tests under the variant.

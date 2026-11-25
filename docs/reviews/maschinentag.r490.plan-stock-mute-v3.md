# Stock mute — plan v3 (2026-11-25, delta on v2 after Codex R487 / R488)

Base for the build: `feat/path-kinds` `fd1878e0` (step 0, R487-H1 `2803cd89`, the lines of rapids `342bacbf`, development `82301aa6` merged in), then development once that is merged. v2 stands; this names what changes. Plan and scratch probe only, no product code.

## Changes against v2

| Review | Change |
|---|---|
| R488 | A + H, identical poses, whole boxes, UNRESOLVED and CAP 1024 are accepted at plan level (MT484-01 / -02 closed). Unchanged here |
| **MT488-01** | The "32 × 0.24 ms ≈ 8 ms" bound of §3.4 is withdrawn (it left out the pairs). The hole question gets a checkpoint of its own by counted asks (§A) |
| R488, state | The step function is total; UNRESOLVED from `none` too, and it survives a discontinuity (§B). The guard "UNRESOLVED allows the hole" must be red against a mutant that has its own UNRESOLVED state (the scratch sweep had none) |
| R487 / Q1 | Step 0 and H1 land FIRST and alone (§C). "Same merge" is gone |
| R487-H1 | The oracles read the UN-THINNED path (§D) |
| Q484-1 (operator) | A re-entry of the own hole along the axis is **no finding**, sideways into the own slot **is one**: step 5 (`fedPath`) stays, the question is closed |
| Q5 | S2 is the preferred direction for c2, no release; nothing of c2 is in this package |

## A. MT488-01 — the hole question's own checkpoint (replaces the last paragraph of v2 §3.4)

**What is bounded and what is not.** One ask reads at most 1024 + 1024 segments. Asks per sample are as many as there are tool × stock pairs whose entry is decided there; the pose counter `done` counts none of them. A slice between two checkpoints was therefore `asks × cost`, with no bound in either factor.

**The rule, in `collision.ts`:**

1. The sink counts every ask (`holeAsks`), per sweep, nothing else. The ask itself never yields and never looks at a clock: **its answer depends on the track and the caps alone.**
2. After EVERY `noteQuery` that asked — the main loop's, the re-sampling's, `searchBack`'s and the boundary's (four call sites, one generator `holeCheck()`) — the clock is read; the sweep yields when `yieldMs` has passed since the last yield **or** when `HOLE_ASKS_PER_YIELD` = 4 asks were made since it (the counted floor: a frozen clock yields too). It is independent of `done`.
3. The yield stands AFTER the pair's note is complete (state and rows written) and before the next pair's query. After it the model is posed again for this sample (`interpPose`, the rule of the two re-samplings). An abort there ends like theirs: progress is the last whole sample's.
4. No clock read where nothing was asked: an ordinary sample costs one integer comparison per pair noted.

So between two yields: at most 4 asks (8200 steps) with a frozen clock, at most 1 ask more than the clock allows otherwise, **whatever the number of pairs.** The pair queries and bisections of the sweep itself are not changed by this and not bounded by it (they are today's; the bisection of a begin runs before the ask and is inside the same slice).

**Measured in the scratch sweep** (the checkpoint at THREE of the four call sites; the boundary's `d0` note is not in the scratch copy; Codex's program, 1 / 4 / 16 / 64 stock bodies; VM, other load running; whole `next()` calls, geometry included — no isolated ask time, no N100):

| pairs | asks between two yields, before → after | longest slice at `yieldMs` 8, before → after | frozen clock, asks |
|---|---|---|---|
| 1 | 2 → 2 | 29 → 23 ms | 2 |
| 4 | 8 → 4 | 87 → 20 ms | 4 |
| 16 | 32 → 4 | 311 → 28 ms | 4 |
| 64 | 128 → 4 | 1330 → 30 ms | 4 |

Rows equal in all six runs per row (checkpoint on / off × `yieldMs` 0, 8, never). Shipped models have ONE tool × stock pair (XYZAC `fixture_blank`, gantry `work_piece`; the 3-axis model none); c2 would make it two.

**Before the merge (build acceptance):** (a) the multi-pair guard above on the real sweep: asks and steps between yields ≤ 4 / 8200 at 1, 4, 16 pairs, both with `yieldMs` 0 and a frozen clock; rows equal across `yieldMs` 0 / 8 / never and shards 1–4; mutations: checkpoint dropped at each of the four call sites, the counter tied to `done`, the pose not restored after the yield, H refused past a time. (b) Through the worker: the longest slice and the time from a cancel message to the stop, on the real maximum of each shipped model with a stock body and on the 16-pair model. Browser and N100 times stay open and are not claimed.

## B. The step function is total (replaces the table of v2 §3.2)

States: `N` none, `U` unresolved, `M` machining, `R` rapid-begun. `nothing` changes no state.

| State | TOUCH, entry on a feed | TOUCH, entry on a rapid | APART | UNRESOLVED | discontinuity |
|---|---|---|---|---|---|
| N | M | own hole ? M : R | N | **U** | N |
| U | M | **R** (the hole is never asked) | N | U | **U** |
| M | M | M | N | U | N |
| R | R (ended at the feed) | R | N | U (rows as at APART) | as today |

- `U` ends only by a sample that says something else: a TOUCH or APART. A discontinuity says nothing about where the tool stands, so it does not end it (v2 said `none`: from there the hole could have been asked).
- The hole question needs, besides v2 §3.4's five conditions, that the free side of the entry's bracket is an **APART** sample. For a closed pair this is what it was; for an open container "surfaces apart" is not enough, whatever the state.
- A range's first sample: TOUCH → M, everything else by the table from `N`.
- **Guard, red for real:** open block, a feed down the axis (`M`), up and out beside it with the surfaces apart and the inside open (`U`), then a rapid on the fed poses into touch: a finding. Mutant: `U` treated as `N` in the rapid column → silent. The same with a tool change between (`U` kept), and from the program's first samples (`N` → `U` → rapid). Each must be red with a state machine that HAS `U`; the closed control (the same course) stays silent.

## C. Order and what the operator sees (replaces v2 §0's "same merge" and §4's order)

1. `feat/path-kinds` (step 0 + H1) into development, with the tool guard's joint gate. **It is a deployment** (the operator updates before every start). He sees, on every machine: the simulation, the drawn path, the run display and the collision check follow the program's own order of feeds and rapids. Findings can appear that were hidden (a rapid into a clamp hidden behind a feed; a second and third pass to and fro) and wrong ones go (a ramp drawn from the wrong corner, a plunge no program makes). A finding names the line that drives it, on a straight run of rapids over several lines too. His shipped 3-axis model has no stock body: no false stock finding. On a model WITH a stock body (the XYZAC and gantry examples, or an own model) a G83 at R 5 / 10 shows 4 / 7 false rapid collisions per hole until step 2 lands (today 0 / 1). Big programs: the payload grows only where it lost moves (200 holes of 33 pecks 29 → 543 kB).
2. This package. He sees, only on a model with a stock body: those false findings gone (own hole along a program axis quiet), the G81 / relief false collisions at R ≤ 2 become near misses, a rapid re-entry sideways into a slot is a finding whatever the retract height.
3. c2 after it, its own plan (S2 direction).

v2 §4's file list loses `gcode_parse_worker.py`; its build order is 1 references and guards red → 2 `cutRule` + rows (§B) → 3 R88 → 4 boundary, range, first pose → 5 `fedPath` + the checkpoint (§A) → 6 docs → round gate.

## D. Oracles on the un-thinned path

The truth of v2 (height map, dense reference) and the 1-D hole reference take the un-thinned parse (`START_PROBE_UNTHINNED`, `.full` payloads); the rule runs on the shipped one. Equal results are part of the guard: the shipped path is at the same place at every time within 0.005 mm and no way back is lost any more, so a difference is a defect of one of them. Not covered by it: a lateral deviation under the decimation's tolerance (0.005 mm) changes poses of a chord; the hole's bit-equality is asked on the shipped vertices alone, and a straight even run thinned to its ends keeps the fed interval.

## E. What this plan does not claim

v2's "not verified" list stands except its first item (step 0 and H1 are built and reviewed apart). New: the checkpoint is measured in the scratch sweep only; a G68.2 payload with pecks is still to be parsed for the acceptance of Q2.

Probe: `~/claude-work/p6/sm/probe/q22.ts`, `coll_v3.ts` (= `coll_v.ts` + the checkpoint).

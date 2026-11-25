# Stock mute — plan v1 (2026-11-25): when a cutter's contact with the stock is machining

Base: development `24f3bd3a`, worktree `/home/cnc/lcnc-suite-sm` (branch `feat/stock-mute`). Source of the demand: Codex R477, "Rohteil-Paar". Plan and scratch probes only (`~/claude-work/p6/sm/`); no product code.

**In one sentence:** the cut rule gets its own state, begun by a PROVEN touch on a feed and ended by a PROVEN separation, apart from the margin episode; one exemption keeps peck drilling silent: a rapid along the tool axis on poses the same cutter has just been fed through.

## Summary

| Question | Answer |
|---|---|
| What is wrong today | Five faults, not one (§1.2). The mute also ERRS THE OTHER WAY: a rapid to R ≤ 2 mm, feed, retract is reported as a rapid collision on the FEED line |
| Measured | height-map reference: today 13 of 27 constructed gouges and 9 of 16 in LinuxCNC's examples lost, 211 false collisions in 37 normal programs. Against the contract's own brute force (sampling fidelity, not truth): today 95 of 375 rapid touches after a separation lost and 22 without one, the contract 0 / 0 |
| The plain contract floods peck drilling | 60 findings per 12 holes × 6 pecks at ANY R plane (G83). With the own-hole exemption: 0 |
| Recommended | **A + H**: contract + own hole. Normal programs 211 → 30 false collisions, constructed gouges 13 → 2 lost |
| **Does it give P6-c "never fewer than the pin"?** | **Only with the shank above the stock** (random programs, Ø3 flutes on a Ø6 shank: 0 of 367 pin findings without one of the body; today 10 of 330). **With the shank in the stock 7 of 370 stay missing**: the body is still touching, it has not separated. Against TODAY's pin: 0 and 1 real finding lost (of 153 / 152). That rest is a documented exception, which R477 did not accept: Q3 |
| **The crux** | Codex's 5.0 and 6.2 cases drive back through the slot the same cutter has just cut. They are the same motion as "rapid re-entry along the same slot". A + H reports them; a rule that excuses every cut volume would not. Q1, and the operator question |
| Blind spot that stays | a rapid SIDEWAYS inside a contact that never ended ("forgot the retract"): silent before and after. Q4 |

## 1. The physical question

### 1.1 What "machining contact" means for a check that never cuts

The stock body is never cut away. After one feed pass the cutter (the WHOLE tool body, shank included) stands inside the stock's geometry for the rest of that stay. So inside the stock a rapid's touch proves nothing about uncut material, and three cases must be told apart by what IS known:

| A rapid touches the stock … | known | verdict |
|---|---|---|
| … in a contact a feed began and that never ended | no uncut volume is proven | silent, as today (it is every plain retract; also the blind spot of Q4) |
| … after a proven separation | a NEW entry into the modelled stock by rapid | a finding |
| … after a proven separation, on poses the same cutter was just fed through, along its axis | the volume there IS cut, for any tool shape | silent (own hole) |

Everything else stays a finding, also where a real program has cut the volume before (a roughed pocket re-entered elsewhere, another tool's hole): the model cannot know, and unknown is never Clear. Today reports those too, but only when the retract was high enough (below).

### 1.2 What today's rule does (measured)

| # | Fault | Evidence |
|---|---|---|
| a | `cutMute` at `d <= margin` on a feed: a feed that never touched mutes a later rapid plunge | feed to 0.05 / 0.5 / 1.5 above, rapid down: nothing |
| b | it ends only past 2 × margin | slot fed out 5.0 mm past the face (3.5 free), rapid back: nothing |
| c | and 2 × margin is not even SEEN reliably: conservative advancement never has to sample a peak between 2 and 4+ mm | G83, R 4.5 (distance 4.5 > 4): silent; R 5: 1 of 5 re-entries per hole; R 10: 5 of 5 |
| d | **the other way round**: a rapid to R ≤ margin opens a rapid-begun near episode; the feed's touch does not close it, so the retract's touch opens an interval bisected back over the FEED | G81 R 1: "collision, rapid" on the G1 line, one per hole; a relief with R 1.5: 59; the LinuxCNC example `cds.ngc`: 1 |
| e | after a rapid part that ended at a feed (`cutPart`), a later real separation and second gouge is folded into the first finding | rapid gouge, feed out 1 free, gouge again 4 beside: 1 finding instead of 2 |

### 1.3 The probe scene and its reference

Scene of `p6/c5/probe/mute.ts` (trivkins, block 120 × 80 × 30, margin 2). 37 normal programs (G81 / G83 / G73 at R 1…10, pockets, multi-level re-entry, adaptive-like G0 links, side milling, facing, open slots with G0 back, relief, helix, finishing pass, and the five in-slot cases), 15 gouge programs (27 events), 5 LinuxCNC example files (`tort`, `cds`, `arcspiral`, `3D_Chips`, `3dtest`, read by a small interpreter; **the stock box around them is the probe's assumption**). Independent reference: a 0.25 mm height map cut by every feed; a rapid that runs > 0.15 mm deep through what is still there is a real gouge. The operator's program was not used.

## 2. Candidates

The first three columns are measured against the height map. The last is the sweep against the CONTRACT'S own state machine on dense samples (for A + H it shares the hole test): sampling fidelity, not truth.

| Rule | normal (37 programs, 0 real): false collisions / near misses | gouges (27 events): lost / false | examples (16 events): lost / false | fidelity, 400 random programs: lost / extra |
|---|---|---|---|---|
| **R0** today | 211 / 32 | 13 / 1 | 9 / 1 | **95 of 375 / 22** |
| **N** mute ends at the first free sample, nothing else changed | 245 / 152 | 2 / 1 | 7 / 1 | — (4 existing tests red, the plain retract's) |
| **A** the contract of §3 | 330 / 143 | 2 / 0 | 8 / 0 | 0 of 375 / 0 |
| **A + H** + own hole along the tool axis — **recommended** | **30 / 143** | **2 / 0** | 8 / 0 | 0 of 183 / 0 (200 programs) |
| **A + R** + ANY retrace of fed poses | 17 / 119 | 2 / 0 | 8 / 0 | — |
| **A + H + D** + a rapid in contact that is no withdrawal along the axis is a finding | 33 / 143 | 0 / 0 | 0 / 0 | — |

- The near misses rise by 111: 110 are former FALSE COLLISIONS of fault d (a rapid to R 1–2 mm is a near miss of 1–2 mm, as the margin says).
- A's 330: 300 are G83 re-entries (5 R planes × 60). Under today's rule the same program gives 12, 24, 0, 12 or 60 depending on R alone.
- A + H's 30: a multi-level pocket re-entered by rapid to the last level + 0.5 (12), an open slot driven back at depth + 0.2 (12), a finishing pass rapid into the roughed pocket (1), the five in-slot cases (5). Today reports 17 of these 30, by retract height.
- A + R removes the five in-slot cases and the plunge-point re-entries. It is the more truthful rule, but it silences 6.2 (which the pin reports today) and needs a search over every earlier feed. Not in this package.
- A + H + D finds every reference gouge and closes the shank window of Q3 (0 of 481). It turns two accepted range tests red (R114: the diagonal "rapid out"), reports a sideways rapid away from a side-milled wall (2) and G0 links inside a pocket (1). Not in this package (Q4).

### The guard cases under each rule (twins: in the slot / 4 mm beside it)

| Case | R0 | A | A + H | A + R |
|---|---|---|---|---|
| slot fed out 2, 3.2, **5.0** past, back in the slot (retrace, physically cut) | — | 1 | **1** | — |
| the same, back BESIDE the slot (uncut) | — | 1 | **1** | 1 |
| **6.2**, 8 past, in the slot / beside | 1 / 1 | 1 / 1 | **1 / 1** | — / 1 |
| feed → 0.05 / 0.3 / 1 / 1.9 free → rapid back | — | 1 | **1** | — |
| feed near, no touch → rapid down | — | 1 | **1** | 1 |
| G83 re-entry above / 0.1 and 2.5 below the last depth | — / — | 1 / 1 | **— / 1** | — / 1 |
| continuous feed contact, plain retract; feed out and feed back in | — | — | **—** | — |

## 3. The contract (A + H)

### 3.1 What a sample proves

Per call of `noteQuery`; only the first two classes move the state.

| Class | Condition |
|---|---|
| **TOUCH** | decided, not on a braking range, `d <= CONTACT_EPS` (inside, or inside by its certificate, counts) |
| **APART** | decided, not on a braking range, `d > CUT_SEP` (1e-3 machine units = 10 × CONTACT_EPS; the bisections' own resolution), and no inside answer is open: both bodies closed, or every inside point of one lies outside the other's component boxes (`pairInside`'s exact exclusion). A lower bound, or "beyond the horizon", proves this: it is > margin |
| **nothing** | undecidable; on a braking range (and its end pose); 1e-4 < d ≤ 1e-3; an OPEN body whose inside is not excluded; the tool unknown; a pose nobody sampled |

Call sites: main loop and the re-sampling after a touch ask the inside question or hold its certificate; `searchBack` and the boundary's `d0` run where the near sample certified "no touch", so a free `d` there is a proof. `finish()` notes nothing.

### 3.2 The state, per cutting pair: none / MACHINING / RAPID

| State | TOUCH | APART | a discontinuity (tool body or offset changes, unknown start, tool unknown) |
|---|---|---|---|
| none | the kind of the move the bisected ENTRY lies on (a point on a move's end is that move's): feed → MACHINING; rapid → own hole? MACHINING : RAPID. At a range's first sample → MACHINING | none | none |
| MACHINING | stays (nothing is written) | **none** | **none**; the pair's earlier free sample is no floor any more |
| RAPID | as today (ended at a feed, later rapid parts continue it) | **none**; `cutPart` / `cutFeedAt` are cleared (fault e) | as today |

**The program's first pose in the stock** (its begin unknown): by the first move's kind, as the sink does today — a feed is MACHINING, a rapid a finding; `collision.md` and the comment at 1741 ("a later retract is benign") say otherwise (Q7). A range's first sample is MACHINING whatever its move: the boundary contact names it and the full check decides it.

A stationary relabel (`brk` without `ustart`) is no discontinuity. "Entry" matters at kind changes: a feed 0.108 deep followed by a rapid up is first SEEN on the rapid (the touch is narrower than MIN_ADV) and was a false gouge in the hunt until the entry's move decided; the mirror (a rapid that ends 0.1 inside, then feed) becomes a finding on the rapid's line.

### 3.3 Rows

- MACHINING writes nothing. At its begin an open episode without an open interval is closed at its last near sample.
- RAPID opens its episode where there is none, `onset` = the bisected entry. No schema change, no new flag; `contactUnion`'s structure holds (intervals disjoint, by entry; free evidence after its own interval).
- The NEAR part keeps today's rule under its own name (`stayMute`): set by a feed sample inside the margin or by MACHINING's begin, cleared past 2 × margin (never while MACHINING). So a retract makes no near miss. A rapid approach inside the margin without a touch is a near miss, as today.

### 3.4 Own hole (`viewer/fedPath.ts`, pure)

Asked once per rapid begin, and once where a near episode would open on a rapid. True when ALL hold:
1. the rapid and the segments straight before it lie on ONE line of the program, at one orientation and one basis (`tlo`, `wcs`, `mode`, `frame`, no `brk`, no braking range, after `depEnd`); lateral tolerance 2e-3 mm (× unit scale);
2. that line is the tool's axis in the stock's frame: two poses of the rapid, rotation equal, displacement ∥ the tool's Z;
3. every pose from the entry on to the next feed lies in the union of those earlier FEED stretches (gap ≤ CONTACT_EPS; top tolerance 2e-3, the bisection's resolution); a following rapid that leaves the line does so at or outside the entry.
At most 4096 segments back and forward; past that: not excused. Reads the track only, so a range sweep and every shard answer alike: feeds before `range.from` have run, since a run from line is not checked at all (P6-d0, `scrub-and-run.md:408`). **The later run-from-line package must put a floor here.**

What it is for: LinuxCNC's own G83 feeds to depth, rapids to R and rapids back to depth + 0.254 mm at the same X / Y (`interp_cycles.cc:161–168`, `G83_RAPID_DELTA` 0.010 in, `interp_internal.hh:55`); that exact sequence, R 1 … 10: A 4–19 findings per hole, A + H 0. G73 rises 0.254 in the contact and is silent under every rule.

Measured on tilted axes (XYZAC identity and TCP A −30 C 40, gantry TCP A −30 C 40 and B 25 C 30, shipped stock bodies, 5-peck holes). It excuses: two holes, A 5 findings, A + H 1 (the rim's real touch, distance 0.0000 at R 1.5 on the oblique face). It refuses: re-entries 1 below the last depth, A 4, A + H 4; pecks along PROGRAM Z under a tilted TCP axis, A 4, A + H 4. A test on program Z alone leaves the tilted axis pecks reported (measured: 5) and by construction excuses the program-Z ones.

### 3.5 Sampling

- **The R88 re-sampling** (`collision.ts:2678`) asks `pairCutting && rapidBetween(…)`, without `!onsetRapid`: `onsetRapid` is the MARGIN's begin and hid a separation and re-entry inside one 5 mm stride (G83, R 1: 2 of 4 re-entries lost with the new state and the old condition).
- Guarantee: a free stretch and the rapid touch after it, each wider than MIN_ADV (0.25 of the path), is found. Held against a brute force at 0.02 (synthetic) and 0.03 (shipped XYZAC identity and gantry TCP with rotary moves: A 12 of 12 and 14 of 18, A + H 11 of 11 and 14 of 18, the other 4 narrower than MIN_ADV, 0 extra; 1 of 62 600 touch samples between 1e-4 and 1e-3).
- **Cost** (counts, no times): LinuxCNC examples and normal milling unchanged in samples and queries; G83 R 3: the same samples, +12 % probes; a program with R ≤ 2 was not re-sampled before and now costs what R 3 costs today (G83 R 1: 1289 → 6893 samples, R 3: 7277). No carried certificate, horizon or advancement step changes.
- **Shards** split by PAIR: a pair's whole track is one shard's. Split 2 / 3 / 4: same count and flags, entries within 7e-4. The real "starts inside a stay" are the next line.
- **Starts**: range sweep, touching at its first sample → MACHINING of unknown kind, named as boundary contact (today); **near** there → not MACHINING, a rapid touch after it is a finding (today lost). The first pose: §3.2, Q7. The entry move and the bound beginning are tracks of their own: each begins with `none`.

## 4. Build

**Files.** New `viewer/cutRule.ts` (the step of §3.1 / 3.2 as a pure function), `viewer/fedPath.ts`. Changed `viewer/collision.ts` (sink 1881–2090, `noteState`'s neighbours, boundary reset at 2416–2430, R88 at 2678; ~90 lines). Docs `collision.md` ("CUTTING SEMANTICS", range sweep, sampling), `decisions.md`, CLAUDE.md's one line. `scripts/test_select`: `viewer/**` already has its rule; the new tests' read sites. No store, worker, transport or UI change. About 200 product lines, 500 test lines.

**Order.** 1 reference oracle and guards red → 2 `cutRule` + rows → 3 R88 → 4 boundary and range → 5 `fedPath` → 6 docs → round gate. Built before P6-c c2. Steps 2–4 alone flood G83, so 5 is not separable.

**Guards** (`collisionCut.test.ts`, `cutRule.test.ts`, `fedPath.test.ts`, `collisionCutOracle.test.ts`; all 133 tests of `collision.test.ts` + `collisionRange.test.ts` pass unchanged under A and A + H in the probe — none pins the fault, and both oracles exclude the tool × stock pair today, so the rule has no brute-force reference until now):

| Guard | Mutation that must turn it red |
|---|---|
| 5.0 and 6.2, pin and stepped body, in the slot AND beside it, depth 8 (shank free) and 20 (shank in the stock: 3.1 … 8 reported; 1.6 and 2.9 pinned as the known window) | end at > 2 × margin |
| feed → 0.05 … 1.9 free → rapid back | the same; R88 condition back to `!onsetRapid` |
| feed near, no touch → rapid; range start near → rapid | begin at `d <= margin`; boundary near → MACHINING |
| G81 / relief at R 1: no collision, one near miss of 1.0, none on the feed line | MACHINING's begin only without an open episode |
| plain retract makes no near miss | `stayMute` ended by APART (rule N) |
| gouge, apart, gouge beside: two findings | `cutPart` not cleared |
| continuous feed contact; feed out and in; rapid in the contact (silent, the named blind spot) | — / D switched on |
| braking range: out and back in; ends 0.1 free, then rapid (silent) with its control (reported); R126's two | range sample as APART; range touch as TOUCH |
| T1 → T2, G43 change, unknown tool, unknown start (each reported on a rapid, silent on a feed); relabel (silent) | each reset dropped; relabel resets; the old tool's free sample used as floor |
| feed 0.108 deep then rapid up (silent); rapid ends 0.1 inside then feed (one, on the rapid line) | the sample's kind instead of the entry's |
| 5e-4 off the surface and back (silent) | `CUT_SEP` = CONTACT_EPS |
| open stock, short tool wholly inside, rapid up (silent; today a false collision) | open body counts as APART |
| own hole: above / 0.1 below / 2.5 below the last depth; 0.02 off; another hole between; sideways at depth; down and up again; T2 in T1's hole; first peck on a braking range; tilted TCP axis; a lateral retrace (NOT excused); the 4097th segment | run not contiguous; following rapids ignored; axis test dropped; basis ignored; `depEnd` ignored; cap dropped |
| range from inside a G83 (silent); shard split 1–4 (same rows); inch machine | back-scan bounded by `range.from` |
| normal programs that stay silent: G81, G83, G73 at R 1.5 / 3 / 5 / 10, zigzag pocket, relief, helix, facing, side milling | — (count guard: 0 collisions) |
| oracle (fidelity): random programs, box and stepped stock, XYZAC identity and gantry TCP; hunt by environment | any of the above |
| height map (truth): the normal and the gouge programs of §1.3, each with its count | any of the above |

**What the operator sees.** Only models with a `stock` body: the XYZAC and gantry examples, a user's own. **The shipped 3-axis model has none, so nothing changes there.** With one: false rapid collisions on feed lines at R ≤ 2 disappear (near misses instead), rapid re-entries become findings whatever the retract height, G83 is quiet at every R plane. No new word, mark or control.

## 5. Limits (named in `collision.md`)

1. The whole tool body cuts; the shank is no body of its own.
2. A rapid sideways in a contact that never ended is silent (2 constructed cases, 8 of 11 in `tort.ngc`). As today.
3. A volume cut earlier (roughing, another tool, another level) is still stock: its rapid re-entry is reported.
4. A free stretch or touch narrower than MIN_ADV (0.25 machine units of path, 6.35 mm on an inch machine) can be missed, as everywhere in the sweep.
5. A rapid retract after a probe touches the stock on its braking range stays a finding, as today (R126).
6. A feed-begun near stay still mutes a rapid's near MISS (never its touch).

**Not verified:** a recorded G83 payload of the live preview (that the cycle's X / Y and depths come out identical in f32; the fixtures hold none — first build step); the union after a fallback (reasoned only: no schema change; an entry within 1e-3 of a hole's fed top could be excused by one generation, the union then shows it); the browser; the N100; a worker run; the other contact tests (`sweepShards`, `contactViewIndexed`, union) under the variant; the recorded TWP payloads say nothing (they never reach the stock's margin); XYZAC TCP only by the tilted G83, the hunt found no pose near its stock; times (host shared, no lock).

## 6. Questions

**Q1 (Codex, the crux).** The 5.0 and 6.2 cases are retraces of the slot just cut. Recommendation: they stay findings (a rapid at full depth into the modelled block; today's pin reports 6.2), each guarded together with its twin beside the slot. Agreed, or is the twin the guard and the retrace silent (A + R)?
**Q2.** Own hole in this package? Recommendation yes: without it every G83 is `pecks − 1` false findings per hole, at every R plane.
**Q3 (a documented exception again, so it needs your word and perhaps the operator's, Q477-1).** The window is there only where the SHANK is already fed into the stock (T14, 10 mm of flutes, slot 20 deep: pin radius … shank radius past the face, 1.5 … 3.0 mm), that is on a setup that is a crash before the rapid comes; with the depth inside the flutes the body reports every pin finding (depth 8: e 1.6 … 8 equal). The contract cannot close it: there the body truly has not separated. Three ways: (i) c2 accepts every pin stretch on which the body itself separated, the window pinned as a test — recommended; (ii) rule D now (0 of 481 missing, at the price of Q4); (iii) first a cutter / shank split, a shank feeding into the stock being a crash — the honest end state, its own package.
**Q4.** Rule D (a rapid in contact that is no withdrawal along the axis) finds all 10 remaining gouges and closes Q3's window, against an accepted test (R114) and two false classes. Recommendation: own package, after c2.
**Q5.** A tool or offset change and an unknown start END the proof of machining, so a rapid touch right after is reported. Recommendation yes ("no continuous motion here"); the braking range and an undecidable answer do not end it.
**Q6.** `CUT_SEP` 1e-3 machine units and the box exclusion for open bodies: agreed as "proven"?
**Q7.** The program's first pose in the stock: a first RAPID is a finding (as the sink writes today), or MACHINING like a range's first sample (as the comment and `collision.md` say)? Recommendation: finding — nothing else names it there, and unknown is never Clear; the two texts are corrected.
**Q8.** The own-hole scan may read feeds before `range.from` (§3.4): agreed on the ground that only a run from the program's beginning is checked?

**Operator (one, through Claude).** "Ein Eilgang zurück in eine Bohrung oder Nut, die dasselbe Werkzeug gerade selbst geschnitten hat: als Kollision melden?" Recommendation: Bohrung entlang der Werkzeugachse nein (Tieflochbohren), seitlich zurück in eine Nut ja.

## Appendix: probes

`~/claude-work/p6/sm/probe/` — `mkvar.mjs` writes `coll_v.ts` (a copy of `collision.ts`, rule by `globalThis.__RULE`: R0, N, A, B = Z-only hole, C = A + H, RT = A + R, BD = A + H(Z) + D), `owncut.ts`, `corpus.ts` + `zref.ts` + `run.ts` (→ `run4.out`, `run5.out`), `q3.ts` (guard cases → `q3c.out`), `q4.ts` (hunt → `q4.out` R0, `q4b.out` A / B, `q4c.out` C), `q6.ts` (shipped models → `q6.out`), `q8.ts` (inch, shards), `q9.ts` (pin / body → `q9.out`, `q9c.out`), `q14.ts` (today's pin / body under A + H → `q14.out`), `q10.ts` (tilted holes), `q13.ts` (LinuxCNC's own G83 / G73), `q11.ts` (cost → `q11.out`), `q6b.mjs` (q6 with the hole in its reference); `vt/` runs the existing tests against the copy.

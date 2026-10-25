# Collision check: entry move, sweep, range sweep, contact store, fallback union, publisher

> Moved verbatim from `CLAUDE.md` on 2026-10-25 (the guide keeps a short form and points here).
> The entries record each rule with the reason and the review round that set it.

**Entry move + auto-check**: at sim entry the live machine position is
captured (joints→machine→program via `machineToProgram`, the exact
inverse of the preview transform) and `prependEntry` puts the rapid from
the machine's ACTUAL position to the program's first point at the front
of the track (scrub 0 = live position, labeled "entry", rapid-flagged) —
run-time-only motion no parse can know, and the classic crash. The
conversion runs under the TRACK's first-segment labeling (mode[0] +
frame[0] + epoch-0 terms as ONE triple — W3 P3: joints are the physical
invariant, kins maps are labelings; mixing the live kins pin/plane pins
with epoch-0 terms landed the entry ~900 mm off when parked labeling ≠
track labeling); the live pin is only the legacy fallback for mode-less
tracks. Since schema 6 the track's first point is the program's own
first-move ENDPOINT (`rapid_ustart` — the canon records suppressed
first moves as zero-length unknown-start rapids instead of dropping
them; ustart unions into brk client-side, and the entry move supersedes
the unknown approach), so the sim reproduces the run's real multi-stage
approach. A G43 / G49 / G43.1 is NO unknown start (operator 2026-10-07,
haus.ngc L18 `G43 Z15. H13`: the move after every G43 was a zero-length
unknown-start endpoint — 0 s on the timeline, its limit row tied with the
next line's collision, swept at its end only): the machine stands, the
canon re-expresses `lo` in the new offset's frame (it always did) and no
longer sets `first_move` (`gcode_canon.tool_offset`), and every such
program-line event (`canon.offset_events`) gets a RELABEL vertex in
`insert_flip_relabels` like an epoch flip — whatever its value, so the
payload's structure never depends on the start offset (the VP-I20 verify
compares parses at two starts) — then the next move, traverse, feed or arc,
is recorded from it: timed, limit-checked, swept along its path. An M6 is
an unknown start only where the CONTROLLER moves at it unseen: [EMCIO]
TOOL_CHANGE_POSITION (`canon.tool_change_moves`, from the INI) — and then
not just for one move: the preview interpreter resyncs from its OWN last
endpoint (gcodemodule's GET_EXTERNAL_POSITION_* answer in C, never through
the canon), so every axis a block leaves out, an arc's centre and every G91
move are computed from the old position. The canon keeps the axes the tool
change position names STALE (`canon.stale`, `tool_change_axes` from the
value count 3 / 6 / 9; another count makes all nine stale, said on stderr);
while one is, every motion — traverse, feed, probe, tap, arc (collapsed to
its end) — is a zero-length unknown-start endpoint. A BLOCK re-establishes
the stale axes whose PROGRAM coordinate it ENDED away from where it began
(`_block_start`; `_program` inverts rotate_and_translate: under a rotated
frame an X move changes machine X and Y, and Y was never commanded — Codex
R93 B; a G76 ends on its drive line, the stale X — R94 C), and only after
it ran, if it ran absolute: `next_line` delivers the state BEFORE its block,
so the mode a block ran in is the next line's (R93 A: a `G91 G81` in one
block recorded its feed and retract as known; a `G90 G0 X Y Z` left the next
move unknown). A canned cycle under G98 never re-establishes its plane's
normal axis (G17 Z, G18 Y, G19 X, the .1 planes W V U): it retracts to
max(the height before it, R) — the REAL, unknown height (R94 C; the believed
height above R returned to it, below R the preview retracts to R). Slot 0 of
the state's `gcodes` is the LINE NUMBER, never read as a code (line 910 is
no G91). A change of the XY rotation — G10 L2 R or a switch to a rotated
fixture, both through `set_xy_rotation` — while X or Y is stale makes both
stale: the new program X holds the unknown old Y (R94 D). Nothing is
re-established inside a block; an axis commanded to the value the preview
already believes cannot be told from one left out and stays stale; no
relabel is inserted in front of an unknown start. An OFFSET, a tool offset
or a stored position written FROM the position while an axis is stale (`G92`,
`G10 L20` / L10 / L11, `G28.1`, `G30.1`) is the preview's guess for good —
an absolute move repairs the program coordinate, never such a value — so
those axes stay stale to the program's end (`_frame_unknown`; Codex R95
VP-I53). No canon call tells an L20 from an explicit `G10 L2` (kept known:
its values do not depend on the position), an L20 on an inactive fixture and
a `G28.1` make no call at all, and the state's non-modal slot is overwritten
by a following `G90` before any `next_line` sees it (measured), so the MAIN
file's text decides (`gateway_util.position_write_lines`: every line as
explicit / fixture n / active / all, the G / L / P words read as NUMBERS in
any spelling — `G92.0`, `G092`, `G28.10`, a sign `L+20` / `G+28.1` — while a
G word the text cannot settle, `G[90+2]`, or an L / P word it cannot read
counts as a write: Codex R96/R97; the worker hands it to the canon only with
a tool change position) and a MODE: `ordered` (no o-words, no M98 — at each
`next_line` the lines run since the last one, in the main-file lines the
interpreter names (`main_line`, Codex R107 — a remap body's blocks run inside
the line that called it): the previous line under every stale set seen
while it ran, its body's blocks too, the call-less lines after it under the
set its end left),
`inline` (o-words whose every called sub is defined in the file: the numbers
are the file's, but a gap proves nothing ran — an `if [0]` branch, R96
VP-I54 — so only the line that had its own `next_line` counts, as having
run), `foreign` (a call into another file, or M98: a number may be that
file's — no text). The o-words are read the interpreter's way, by ONE
reading for both questions (`gateway_util._flow_of_block`): whitespace counts
nowhere outside a comment (`o<touch> c a l l` is a call, Codex R98), and an
o-word is the statement at a block's start after an optional `/` and N word
(so `ROUND` / `MOD` / `OR` and an O inside a name are none); one whose name is
no literal `<name>` or digit string (`o+100`, `oABS[-100]`, `o[100]`,
`o100.0` — all valid, R99) or whose word LinuxCNC does not know is `foreign`
too: a line it could not read is never "no o-word". An inactive fixture's write takes effect at the switch to
it (`_reg_unknown`). Behind the text, the active registers' callbacks
(`set_g92_offset`, `set_g5x_offset` at an unchanged index) report a write
as an EVENT — never judged by its value: a `G92 Z40` at a believed Z40
computes the old offset again (R97); re-selecting the active fixture makes no
call at all (measured), and a switch's own G92 re-apply is the switch's. A
reported write counts unless this file's text says the line is explicit, or,
in text order, lists it for its own scan — and the text speaks only for a
write of its OWN: a remap body's or a called file's callback is named by the
main line it ran in, never excused by it (Codex R108 VP-I65: `G10 L2 P1 X0
M200`, the body's G92 from the unknown position; `_in_main_file`, the
interpreter's word: no remap level and the main file — a PYTHON remap keeps
the main file's name, its execute() passes a number of its own or 0, Codex
R109; it is named by its trigger, the controlling block's byte offset
`blocks[1].offset`, and a callback numbered 0 after the program began is the
program's, never the initcodes' — the program begins at its first positive
line or at the first callback the interpreter shows inside a remap, before
anything it applies, the start state taken there: a program OPENING with a
Python remap, Codex R110; the initcodes run with the file already open and
trigger no remap); named by its line where the
numbers are the file's, else 0 — a main-file write listed under the same
number proves no shared origin (R98 VP-I56). A cause line is named once
a move runs after it (`stale_offset_lines` on the wire); the payload says
`stale_offset_untracked` when the text cannot place every write (inline,
foreign, unreadable), and the note says "not checked to the program's end:
the offset set from that position at L4 stays unknown whatever is positioned
after (L5, L6)" (+ "; in subroutines and loops, stored positions (G28.1 /
G30.1) and fixture writes in called files are not tracked"). The
interpreter's own quill-up / G30 moves at an M6 are canon traverses and
recorded — they arrive as line −1, which the canon keeps on the M6's line
(`next_line`; a −1 ended every such parse in an OverflowError on the wire's
uint32 lines; a Python remap's `execute("M6")` numbered 0 too — its −1 moves keep line 0, Codex R110 VP-I66). Every unknown start after the program's own is NAMED in the
sweep's `uncertified` ("N moves after a tool change run from a position
the preview cannot know — not checked until the position is known again
(L…)") — the page hands `ustart` to
the worker (`collisions.viewer.spec`). Tests: `test_tool_change_motion_worker.py`
(the real worker + native interpreter: G43 alone, in the block of a G0 / G1,
before an arc, after an unknown start; M6 in place, at G30, at a tool change
position; every motion kind after it, partial and G91 re-establishment,
the block's end, G98 / G99 in G17 and G18, G76, a later rotation and a
rotated fixture, line numbers 810 / 910; offsets from the unknown position:
G92, L20 active / inactive, hidden by a `G90` or a comment, G28.1 / G30.1, an
explicit L2, G92.1, an o-word loop, a G92 in a sub file, every spelling of
the number and an expression, a sign, a branch that never runs and branches
that run — a G92 / L20 computed equal to the old value, an inactive fixture's
L20 — and G54 again),
`toolChangePayloads.test.ts` (the native payloads, `scripts/gen_tool_change_payloads.py`,
through the client's decode, track and sweep, the track handed over as the
page does (`wcs` = its epochs: without them a rotated move is swept
unrotated) — red on the previous worker's payloads; the note's offset line handed over by the page: `collisions.viewer.spec`), `collision.test.ts` (an obstacle only in the middle of the move
after the relabel is found; an unknown start is said). An M600's own motion:
see "M600 in the preview". The preview goldens change
for every program with a G43 (the live gate; regenerate at the next suite
stop). The sweep
keeps itself current with NO manual trigger: auto-runs on program load
(base track — marks appear before sim is entered), on sim entry (entry
track, fresh position = fresh baseline), and on WCS/tool changes while
idle (stale results clear + re-run, debounced; in sim ScrubBar re-checks
with the rebuilt entry track). SWEEP STATES (2026-09-13, no button): the sweep has NO control on the bar
— it is OPEN-ENDED (the 300 s budget and the ❚❚ / ▶ / ↻ button of
2026-09-12 are gone, operator decision), its progress is the TIMELINE's
swept band (`sweptFrac`; the iterator's progress and `covered` are
TRACK-AXIS fractions, `distToTrackCum(s) / cum[n-1]`, so a scrub shows
which section is already checked), and its findings show LIVE from its
CONTACT TABLES (step 4 package 2, C2 — the sweep writes no records any more,
see "Contact store"): the worker sends their deltas at the end of a slice, and
posts the running sweep's METADATA as `partial` (collision.ts
`SnapshotHandle.meta`: static contacts, notes, a range's start and boundary
contacts, `truncated.reason === "running"` — no findings) after the first
slice and whenever it changes, at most every META_MS (500 ms; a progress
carries the coverage) — so progress, a park, the end, the basis card and the
caveats show without a single table row. The viewer's publisher builds the
views from the tables and publishes them with what the bar shows (plan 3.6):
the list, the ticks, the bands, the tint and the code marks appear as the
sweep finds them and the verdict reads "N collisions so far"; the result is
the sweep's metadata. The FIRST touch of a request shows at once (step 4 plan
1b): the delta that brings its first touch interval goes out beside a delta
still unacknowledged, once (R170: a held acknowledgement behind a near miss's
delta held it back by the whole hold, at the stand before C2 too), and the
viewer marks that message (`firstTouch`) and publishes at once. Side runs
(the entry move, the start-dependent beginning — the whole program on a
dependent one) post no partials (VP-I93): their first touch interval sets
`collisionSideFirst` — a run check merges it onto the base while its
beginning stays "start still checking" (the base's `startDependent` kept: one
contact answers no coverage), the simulation's entry result shows it, said
"entry move still checking" — never their start (C2), ended with the side
sweep. The bar and the
code marks take the result and the partial WITH a run check's beginning in
them (`collisionResultShown` / `collisionPartialShown`, `_colWithRunSide`;
`_colEmitMarks`) — they took the bare ones, and the beginning's findings,
early and final, never reached the list, the marks or the verdict (Codex
R137 VP-I93 A, a gap since E5: only the tint read the merged result). Before
the main request's first partial — a main sweep finding nothing posts none
until it ends — the beginning's contact, early or final, shows on the main
request as it stands (`_colRunSideBase`: nothing found so far, its progress,
the start-dependent beginning it names — `startDependentOf`, the sweep's own
rule — on the run's track only, never a finished one; Codex R138 VP-I93). The worker
PAUSES for camera interaction (auto-expires after 30 s — a lost pointer-
up) and for a HIDDEN tab (no expiry; `visibilitychange`), two independent
holds; a ROTARY jog PARKS it (`stop`, honoured at the next checkpoint — the
iterator yields on TIME, 8 ms of active clock, the 16-segment / 512-
sample checkpoints as the floor) and a settled pose continues it — the
worker keeps the suspended generator with every clearance certificate and
contact state, `SnapshotHandle.take` hands out the sweep-so-far's metadata
without ending it; parked reads "no clash in N % swept" / "in N % swept". The
iterator's sample backstop is the only hard limit: past 4 M samples it
steps coarser (`coarsened`), past 16 M it stops (`truncated`, reason
"samples"). The findings, the verdict and the line readout are
the Simulation tab's (since 2026-10-05); the bar's time readout is a
FIXED slot sized PER PROGRAM (flex basis, ellipsis; "mm:ss/mm:ss" + "~";
the timer shows always — "00:00/45:00" at idle, never "live") — a
min-width floor let a readout eat the timeline. Timeline BANDS
span the thumb's EDGES (an extent to program end reaches the track's
end); ticks sit at thumb centres. Dragging the timeline PAUSES playback
(`@input`). Only a ROTARY jog (> 0.05°) parks; nothing cancels but a
superseding change (program, touch-off, tool). A motion-parked sweep resumes by itself
once the pose has held still 4.5 s with no re-parse in flight; a re-parse
that lands drops it and starts fresh. SIM ENTRY never touches the
program's sweep (the MAIN run, always on the BASE track): the ENTRY
SEGMENT (the live position → first point rapid, `sliceTrack`) is a SIDE
sweep in the worker (`side: true` — beside a running or parked main run,
milliseconds) whose result is the entry OVERLAY, merged onto the base
AT DISPLAY TIME: the two results' metadata (`collisionEntryResult` =
`sweepMerge.ts`; TWO baselines, both reported — the live pose's and the first
point's static contacts) and their contact tables in ONE view, the base on
the entry track's axis shifted by the entry length; ONE contact seen by both
sweeps — an entry contact still open at the entry's end + a base contact of
the same pair from its first checked point — counts ONCE: the base episode's
first interval continues the entry's (`contactMerge.ts`, the entry join),
its re-entries stay the program's findings under their own keys (Codex R34
VP-I09). `viewer/sweepEntry.ts`
(pure, pinned) decides what runs: base unknown → base + side; base
current / running / parked → side only; overlay already swept for this
entry track → nothing; machine at the first point → the track IS the
base, nothing new. The entry track STAYS after sim exit — the entry move
is the rapid the next cycle start will make from where the machine sits,
and its verdict must not vanish with the mode (operator-caught: a clash
in sim, "clear" on exit); a run start or program change drops it, and
when the machine moves outside sim ScrubBar rebuilds it from the settled
pose (500 ms) and re-asks for the segment. The base result keeps its
identity, so a re-entry sweeps only the new segment.
The first attempt cancelled a base sweep at 59 % for that one segment and
re-swept the whole program on every re-entry; its full entry-track sweep
also had the LIVE pose as its only baseline, so a program that starts in
contact reported a continuation record per line (200 capped hits at 3 %).

**Range sweep (plan „Prüfung im Lauf“ 3b)**: `CollisionOptions.range =
{from}` sweeps from track point `from` on with the PROGRAM's baseline (first
pose and rest pose decide the static exclusions — a baseline at the range
start would take a pair touching there and at rest for a mount, VP112-04),
the first pose's seeds cleared and every pair queried afresh at the first
segment with length after it. A pair inside the margin there (cutting pairs
too) is a BOUNDARY contact (`result.boundaryContacts`): begun before the
range, its onset and kind are the full check's; it is an episode of origin
BOUNDARY in a key space of its own (a separation and a re-entry is a
collision of its own), counts nowhere and ends with a verified separation; a
cutting boundary contact is taken as feed-begun and writes nothing. Nothing
before the start is swept or reported; progress and a park's coverage count from it;
`result.range` names the start, `empty` a range with nothing of positive
length. The shard merge carries the range and unites the shards' boundary
contacts. `collisionRangeOracle.test.ts` holds it to the brute-force oracle
on the shipped models (completeness after the start, every interval real, the
boundary set = the pairs inside the margin at the start, nothing before, the
program's statics).

**Collision sweep (offline dry run, stage 3)**: the scrub bar's Check
button sweeps the machine model through the scrub track off-thread
(`viewer/collisionWorker.ts`) and reports tool-side vs work-side body
pairs inside a 2 mm clearance margin. `viewer/collision.ts` (pure,
unit-tested, incl. against the real machine-xyzac STLs during dev):
full-group-tree pose evaluation (same compose semantics as
applyState/partFrame), machine.json STL bodies — UNGROUPED parts
(column, base, spindle housing) attach to an implicit root node and are
fully collidable; everything moves relative to the frame — + a
parametric tool cylinder (the DISPLAYED marker dims — tip at origin,
+Z), three-mesh-bvh
`closestPointToGeometry` with margin early-out behind a bounding-sphere
prescreen, and CONSERVATIVE ADVANCEMENT stepping: every distance query
certifies the pair can't reach the margin within (d − margin)/V of
sweep parameter — the sweep runs in its OWN distance parameterization
(mm, 1° ≙ 1 mm), never the track's cum, which may be time: the guarantee
constants are spatial; hits convert back to track-cum on report —
(V = provably conservative relative-speed bound from the
pair's connecting DOFs — translations exact under identity kins,
rotations × endpoint levers with ×2 inflation, chunked so the SUMMED
rotary sweep stays ≤22.5° (capping only the largest let three
simultaneous rotaries reach 67.5°, where the inflation's
1/(1−rotRad)≤1.65 argument goes negative); under a world kins the linear
joints are trigonometric in the swept rotary, so endpoint deltas can
read 0 across a symmetric bulge and a pair whose path lacks the rotary
has no lever budget — the miss class. Each kins family bounds its OWN
per-joint mid-chunk CURVATURE via `KinsModel.jointBulge` (= M/8, M a bound on
|j''| over the chunk — the chord deviation), and the sweep spends a SPEED,
`jointSpeedBound(|Δj|, bulge)` = |Δj| + M/2 (Codex R101 VP-I57: it spent
|Δj| + bulge — a quarter of x = 1000·cos C's speed over C ±11.25° — and a C
sweep crossed a part unseen); collision.ts
reads no family's parameter names (it used to read the trt-only
`KinsParams`, which a trsrn spec does not carry, collapsing a 2 m rotary
lever to the distance from the machine origin). Bounds are CERTIFIED per
family by `kinsBulge.test.ts` — randomized chunks, densely resampled,
requiring the sampled excursion never to exceed the declared bound for
any joint, and the sampled speed never to exceed |Δj| + 4·bulge (the old
|Δj| + bulge is exceeded on every world family); trivkins and trsrn mode 2 are exactly 0 because their inverses
are affine in the coords. Adversarial pins: the trt C-sweep-into-wall and
the trsrn A-sweep, both verified red with the bound stubbed to 0);
pairs re-query only on certificate
expiry. Guarantee: no margin crossing wider than 0.25 units of path is
missed — clear programs stride in a handful of samples (adversarial
tests: a 2 mm graze and a 2.3°-window large-radius rotary clash that
fixed 5 mm/4° sampling provably missed). NOTE that 0.25 is a fixed floor
(`MIN_ADV`) in a parameterization where 1° ≙ 1 mm, so on a metre-scale
machine a forced 0.25° step is ~8.7 mm of surface travel: the bound
removes the systematic blind spot, not the sampling floor (recorded in
docs/decisions.md). Certificates CARRY across chunk boundaries (2026-09-10):
a query's clearance d − margin is decremented by each chunk's V × Lc and
re-expressed in the next chunk's V, so a far pair costs nothing until the
motion could have closed the gap — the old per-chunk reset re-queried every
pair at every segment, which on a program of a million 0.09 mm segments
was ~2 h per sweep (now 31 s, certified). A pair inside the margin that
is TOUCHING keeps the EXPLORE re-probe cadence; one inside the margin but
not touching advances by its distance to a touch (d / V, the same MIN_ADV
floor) — the fixed cadence stepped over a touch between two in-margin
samples and reported "near miss, 1.5 mm apart" for parts that met 1 mm
deep (2026-10-07); its clearance carries across chunks in each chunk's V
like any certificate. A touching pair found NOT touching at its next sample
has the stretch since its last touch re-sampled at MIN_ADV — inside one
EXPLORE stride the contact could end and a second, 1.25 wide, begin and end
unseen (Codex R86 VP-I45) — each sample through the main loop's own state
step (`noteQuery`) in time order, queried to HORIZON: a separation past
2 × margin there ends the old contact, a touch after it is a new onset on its
line and kind of move (a cutter's rapid re-contact after its feed contact was
taken for the benign retract, R87); a pair still touching keeps the stretch
as contact, so an unchecked gap never reads as clear — except a cutter in a
FEED-begun contact whose stretch reaches a rapid: re-sampled even when the
next sample touches again, or a separation and a rapid re-entry inside it
inherited the feed contact's benign origin (R88). No LINE owes a pair in
contact a sample of its own (step 4 package 2, plan 5, B8 — the per-line sample
existed for the continuation record per line; on haus.ngc it was most of the
sweep): it samples at the cadence, where the KIND of move changes (feed ↔
rapid: a touch's kind decides the cutting rules and an interval's rapid flag),
and re-sampled at MIN_ADV at every separation — a touch's end (above) and a
NEAR pair's margin exit (`nearQ`): a pair inside the margin without a touch
steps to where it could first touch (d/V, up to EXPLORE), and its stay, which
ends at its last sample inside the margin, ended that far before the exit —
lines it was inside the margin on got no stay (plan 7.3 check 2, the oracle at
0.05, found it; the per-line sample had covered them). That stretch holds no
touch (the near sample's distance certified none; `nearQ` names only a DECIDED
near sample), so it asks only "inside the margin?" — a query bounded at 2 ×
margin, beyond it short of a separation, no inside check — and only for its
LAST pose inside the margin (the stay covers the rest by continuity): a search
BACK from the sample outside, certified — the distance changes no faster than
the chunks' speed bounds since the near sample, a history of at most 16
entries a pair (`viewer/nearHistory.ts`, pure: a full one merges the
neighbours whose larger bound adds least; `nearHistory.test.ts` holds it to
bound every chunk from above, to merge where least is added and to step back
exactly its room), so from a pose at d outside the margin the pair
stays outside back to where those bounds use up d − margin, at least MIN_ADV
back; the first sample inside the margin is noted. A jump or a tool / offset
change ENDS an open near stretch on the pose, tool and offset before it (noted
there when still inside the margin, else searched back from there): the
search never starts from a distance after such a boundary — no motion bounds
it (Codex R175 VP-I129); a stationary relabel keeps its stay. Both re-samplings pass the
main loop's checkpoints — yield, budget, abort — with the progress the last
whole sample's (Codex R174 VP-I127: one largest bound walked a long slow
stretch at a fast chunk's pace, 66 656 samples in one iterator call; a
forward MIN_ADV grid had cost 158 s of 264 on haus.ngc Fall B). `CollisionOptions.
lineSample` is the old rule, for the comparison (`collisionLineSample.test.ts`:
tables, stays per line and views of the run without it cover the run with it,
else the truth shows a run no wider than MIN_ADV — an exemption bound to that
run's stretch and pair, never the pair elsewhere, Codex R174 VP-I128) and the
measurement only; `collisionWindows.test.ts` holds near stays to closed-form
margin windows and the search to its checkpoints. Facets WITHOUT AREA (three distinct
collinear vertices, coincident ones, a coordinate not finite) are dropped
when the model is built (`withoutArealessFacets`): three-mesh-bvh read a
collinear facet as touching a triangle 1.5 mm away (VP-I46); a body left
with none is not checked and every result's `uncertified` names it
(`model.unusable`); a body that lost facets with a coordinate that is not a
number is checked on the rest and named "partly checked" (`model.damaged`,
`geometryNote`). With no moving pair left, the Simulation tab says "Not
checked" with the marker instead of "No moving pairs" (R87). The shipped
models have none. A body WHOLLY INSIDE another (collision-inside.plan.md,
Codex R96/R97, Fassung 3; operator 2026-10-07: haus.ngc's y_guide_endcaps in
the column foot, untinted) has its surfaces apart, so a distance alone reads
it clear. `insideCheck.ts` decides one vertex per component (`meshClosure`)
three-valued — inside / outside / undecidable — by the first non-degenerate
of six fixed rays (a hit near an edge or vertex, a grazing one or two at one
distance make a ray degenerate) after an exact exclusion (the point outside
every LOCAL component box of the container); the winding number is the
independent check. Between two surface contacts the answer cannot change,
so the sweep asks (`pairInside`) only where it is not known: the baseline
(the first pose; the rest pose for a candidate), the first query after a
break or a tool change (`needInside`), every separation decision (a pair
whose last query touched — Infinity past the horizon included — and every
re-sampled point after a touch), a pair whose surfaces' distance at its
last query is used up since (`surf` / `surfQ`, carried across chunks like a
clearance: the sampling floor steps past a touch narrower than MIN_ADV, and
through it a part can go wholly inside — a pair taken for clear was never
asked again, on identity kins too), and a pair whose last answer was
undecidable (the store's bisections ask it too: touching OR inside OR
undecidable). Inside is a touch (distance 0) with a certificate of its own:
the answer can change only through a surface crossing, so it holds until
the surfaces' distance at that query (beyond the horizon: the horizon) is
used up at the pair's speed bound — carried across chunks like a clearance,
dropped at a break or a tool change (`inClear` / `inQ`): a long inside
contact's samples need no query (haus.ngc's end caps in the column foot, while
every line still owed a sample: 268 s → 3.3 s for that pair). Undecidable gives no
touch, no separation, no clearance certificate (asked again at the contact
cadence), never a static exclusion: its stretch is a GAP_UNDECIDABLE gap,
named in the bar's caveat ("inside check undecidable for A ↔ B (L5–L9)") —
derived with the view, every generation's gaps united (Codex R170 VP-I123),
three stretches a pair and "…"; the rest pose's undecidable answer is the
result's note (VP167-01). A container whose surface is NOT CLOSED is
not asked — it has no inside at any pose, asking again never decides it —
but named once per model (`CollisionModel.open`, `geometryNote`: the 3-axis
model's frame, x_axis, y_axis); its pairs keep the surface's guarantee.
`CollisionResult.notes` are the statements `uncertified` joins, and the shard
and entry merges unite them (`unitedNotes` — shard 0's note alone lost the
other shards' pairs). Tests: insideCheck.test.ts, collision.test.ts ("a body
wholly inside another"), collisionInside.test.ts (undecidable, the rays
mocked), the oracle (below); 18 mutations red. The sweep is a
resumable iterator (`sweepCollisionsIter`, checkpoints every 16 segments /
512 samples and every 8 ms of clock) with an optional WALL-CLOCK budget
(`maxMs`, sync API + tests only — the worker runs sweeps OPEN-ENDED since
2026-09-13): on breach it stops and the result says `truncated`
{covered, reason} — ScrubBar reads "no clash in N % swept", never "clear".
The sample budget is only a runaway backstop (coarser steps past 4 M
samples, a stop past 16 M), and its breach is
`truncated.reason = "samples"`, no longer a silent break.
A sweep whose guarantee does not hold — a declared kins this client
cannot evaluate falls back to trivkins, whose bound is legitimately 0 —
reports `uncertified` with the reason, surfaced in ScrubBar on BOTH the
"Clear" and the "N collisions" branches.
What a sweep found is its contact tables (see "Contact store"): every touch
interval's boundaries are bisected, so a jump poses the model at first touch,
never a sample-step deep; contact within one line can be INTERMITTENT (rotary
return moves brush parts twice — user-caught) — each interval is its own
target, a re-entry its own stop. The count, the ticks, the list, prev/next,
the tint and the code marks all read ONE contact view (`contactView.ts`:
targets — touch intervals, near misses at their closest approach —, their
keys, kinds and pieces; count ≡ ticks ≡ stops); a target's LINE is the
display line at its position (plan 1.3, C3: a called file's moves read their
call line, an untrusted move without one reads its subroutine's name, else
"—", and marks nothing — never the raw line). A rapid touch is flagged
`rapid` — always real. ThreeViewer owns the worker (geometry from machineAssetCache, tool
dims from live status); the worker drives the iterator in 40 ms slices
(`viewer/sweepPump.ts`) and reads `{cancel}` / `{pause}` / `{resume}`
between them — no terminate, the BVH model stays RESIDENT under a
`modelKey` (STL copies are re-sent only when it changes; a worker that
lacks the model answers `needBodies`); OrbitControls start/end pause and
resume a running sweep, because a busy worker is off the main thread but
not off the machine (it starved the Mac's GPU 3–4 frames behind,
2026-09-10). PARALLEL (2026-10-07, operator): a main request is split over
K sub-workers — instances of collisionWorker.ts itself, each sweeping one
SHARD of the model's pairs (`CollisionOptions.shard`: after the baseline
every shard splits the pairs the same way, longest first by a cost — a pair
inside the margin at the first pose weighs its two meshes' triangles, else
1 — and checks only its own;
`pairAssign.ts`) — and the worker the page holds only coordinates: it keeps
the bodies and sends them to a shard that lacks the model, forwards cancel /
stop / continue / pause / resume to every shard, reports the least swept
shard's progress, merges the shards' metadata (`sweepShards.ts`
`mergeShardResults`: notes united, static contacts and the prescreened count
from shard 0 alone; their tables travel as deltas, one per shard),
posts `stopped` when every shard is parked or done, and runs the entry
move's side sweep on shard 0. A partial is every shard's LATEST word — its
result once it has one — with a shard not heard from counted as swept 0, a
finished shard's word posted at once, shard partials at most every
META_MS (Codex R90 VP-I47). The pair is the unit because each carries its
own certificates, contact state, cutting origin and table rows — no state
crosses a shard. K = the cores but TWO (the page and the browser's own
processes — Codex R90; four cores make two shards), at most 8, and no more
copies of the model than 4 M triangles allow (every shard holds the whole
BVH model); one shard or no Worker in the worker's scope: the single-core
path as before. A sub-worker that FAILS takes the pool down for good and
moves what was in flight to this core WITH the owner's state (VP-I48/I49):
a running sweep starts again with its pauses, a cancelled one is
acknowledged, a parked one (or one whose stop is unanswered) computes
nothing — the owner keeps or gets the shards' sweep as the parked result and
a continue starts it from the beginning; with nothing swept yet to hand
over, the stop is answered as an error at once (Codex R91: a run started
for it waited under a hidden pause, the stop unanswered) — and the side run
on shard 0 runs again here; a shard that ends at its sample backstop counts
in the progress with what it swept, never as done (R91); the coordinator handles the sub-worker's error event
(`preventDefault`): unhandled, Chromium and Firefox pass it on to the page's
`onerror`, which drops the sweep (measured). "No side run on a shard" is
`null`, never an id (−1 is the owner's first side id, VP-I50). The sample
backstop is per shard: `coarsened` from 4 M samples, the hard stop
(`truncated.reason = "samples"`) past 16 M — a pool may take K times that. The ceiling is the costliest pair: on
haus.ngc (XYZAC, A 61°) the rear column against the C faceplate is 24.5 % of
the query time — ×3.9 with 4 shards, ×4.1 from 6 on (measured per pair with
`profile`). Measured in the browser (headless Chromium, the live payload, 4
cores): one worker 1036 s, 3 shards 482 s (×2.15), the same 85 onsets (a
measurement of the record sink; since C2 an interval's line is the display
line at its bisected entry, the same in every split). `result.shards` says how many swept; `__viewerDiag.
getCollisionSummary`. Tests: `sweepShards.test.ts` (the merged shards
against the single sweep on the shipped models — 2, 3, a random split and
the shard option; a touch in one run only must be a run no wider than
MIN_ADV, the truth decides — red when a shard loses pairs or the merge loses
static contacts), `collisionWorker.test.ts` (the coordinator
through fake sub-workers: partials, the fall back with every owner state,
the side id −1, the kept bodies — 12 mutations red), `collisions.viewer.spec`
(more than one worker in Chromium and Firefox, the same onsets — red with one
shard forced).
Results reflect check-time
WCS/tool and clear on program change; GcodePanel reuses
`.codeLine.violation` markers via `collisionLines`. SEMANTIC LIMIT (no
stock model): a program cutting at the work surface reports tool-vs-
platter contact — cutting and crashing are indistinguishable without
stock; the high-value signals are non-platter pairs and any rapid-flagged
hit. CUTTING SEMANTICS: only a body flagged `stock: true` is cuttable —
machine parts NEVER are (without a stock body the tool may touch nothing:
real programs cut stock sitting above the fixture, so tool contact with
any machine body is a crash by definition; the platter is workholding).
Only the CUTTER cuts: the tool body (`CollisionBody.tool`) × a stock body
is a cutting pair, never any other tool-side body — the spindle nose, the
ram or the head feeding into the stock is a crash (2026-10-07: every
tool-SIDE body counted, and since the tool chain's ancestors are on it, the
column and the bed on the shared frame group did too — a ram in the work
piece on a feed, a column against the blank on a feed were never reported).
For the cutter in the stock: FEED contact is machining and never reports;
contact whose ONSET falls in a RAPID is the gouge class and reports; a rapid
RETRACT leaving feed-begun contact is benign (the cutter body is the whole
tool cylinder: a shank in the stock counts as cutting). Stock pairs are never
baseline-excluded (parked-on-work is normal); they seed the in-contact
state instead. The (local-only) machine-dmu160p example carries the first
stock body
(`work_piece` cube, `stock: true` — flag flows gateway → `viewer_init`
parts → collision bodies); the deferred user-placed stock-box feature
would provide one for arbitrary machines/programs. Pair scope: DERIVED from relative motion
— any two bodies whose
group-tree path crosses a kinematic DOF below their lowest common
ancestor form a pair (tool-vs-work, tool-vs-frame, and same-side pairs
like platter-vs-table across the A tilt); rigid pairs are skipped. A whole-program REACH PRESCREEN (2026-09-13) then
drops pairs that can provably never come within the margin at any pose the
sweep will evaluate: every joint's range over the track (both endpoints of
every segment under its own kins labeling, bulge-padded on world-kins
segments) pushed through each body's chain below the pair's LCA as a reach
sphere (translations widen by half their range, rotations by the chord
2ρ·sin(min(Δ/4, π/2))); reported as `pairsPrescreened`. Query side (same day, from the opt-in
`CollisionOptions.profile`): the larger body is always the OUTER BVH
traversal (three-mesh-bvh prunes the outer tree by the inner body's whole
box — a wall-spanning inner box prunes nothing: 12.8 ms → 0.02 ms per
query), each body carries its connected components' AABBs
(`componentBoxes`) whose box-to-box distance is a valid lower bound that
answers every above-margin query without the BVH, and a cutting pair in
feed-begun contact owed no per-line sample (since B8 no pair does). The wall gantry's ~450 pairs
over 236k triangles made a 1.2 M-point sweep take hours; a 20k-point slice
went 203 s → 5.1 s (docs/decisions.md 2026-09-13). The BVH query runs with
a horizon (`HORIZON`, 20 mm) and a distance it returns ABOVE the horizon is
"beyond the horizon", never a clearance: three-mesh-bvh visits only the
bounds nearer than its threshold and returns the closest of the triangles
it visited — 291 mm at a true 82 on the XYZAC column, and the certificate
jumped 230 mm past the yoke's first contact (operator 2026-10-06, live;
`collisionHorizon.test.ts` drives that entry move over the real model and
requires every part's first contact to 0.01 mm). The library's own pruning
distance was wrong too: `OrientedBox.distanceToBox` (three-mesh-bvh 0.9.14,
still in 0.9.15) built the axis-aligned box's edges with `max[f2]` for
`max[f3]` and could overstate a node's distance — a query below 121 mm missed
a pair 120 mm apart on the TWP gantry. `viewer/bvhBoxDistance.ts` installs a
corrected distanceToBox on the library's OrientedBox when collision.ts loads
(`bvhBoxDistance.test.ts`: exact against a 15-axis / surface-triangle
reference; the library's original still overstating, so an update that fixes
it says the file can go). The estimators are held to the truth on every
shipped model by `collisionBounds.test.ts` (sphere and component boxes per
body, the bounded query at the sweep's scale, small pairs against a brute
force over every triangle pair — `triDistance.ts`, written apart from the
library), the sweep itself by `collisionOracle.test.ts` (random tracks on
the shipped models, identity / TCP / TWP TCP, stepped every 0.5 of the
sweep's parameter: every touch and in-margin pose reported unless narrower
than MIN_ADV, every reported onset a real touch; a body wholly inside another
is a touch by the winding number — `collisionFixtures.insideTruth`, no BVH, no
rays — and each case also sweeps a short track from a recorded pose where one
is, `Case.inside`, which a hunt searches afresh).
Baseline subtraction keeps it quiet: pairs inside the margin at the
program's FIRST pose AND at the model's REST pose (every joint at zero —
the designed pose the machine-model tests require to be self-collision-
free but for the designed bearings; slides, bearings, trunnion mounts —
found automatically, no annotations) are reported once as
`staticContacts` and excluded from per-line reporting. A pair CLEAR at
rest but touching at the first pose is a crash the program starts in
(operator-caught 2026-09-12: the entry rapid drove the ram into the
column; the first-pose-only rule filed the pair as static, never queried
it again, and its tint and extent stopped at L1): seeded as an onset on
the first line and checked throughout. NEVER a TOOL pair either
(operator decision, same day): the tool is no one's mechanical neighbour
(`CollisionBody.tool`, set by the worker on the parametric cutter;
`pairTool` in the model). The tint and the timeline's red extent read the
contact view per PAIR at the position (`contactView.tintAt`, the bands —
one test for the whole line put the Y saddle and the yoke out on every line
another pair re-entered, operator 2026-10-06, haus.ngc on XYZAC). Test fixture:
`~/linuxcnc/nc_files/5axis_collision_test.ngc` — in-limits program whose
low rapid traverse rams the trunnion (stage 1 quiet, stage 3 flags it).

**Contact store (step 4 package 2; plan `docs/reviews/kollision-paket2.plan.md`
Fassung 5, Codex R139–R144; the ONE sink since C2, Codex R167–R171)**: the sweep
writes what it finds as typed column tables (`viewer/contactStore.ts`: blocks of 4096 rows, appended, never
copied) — EPISODES (a pair's stay inside the margin, from the sample that found
it to the last sample in the margin before a verified separation, its closest
approach, origin program / entry / beginning / boundary), TOUCH INTERVALS
(opened only by a confirmed touch or inside — that sample is the interval's
WITNESS, the one ID anchor; each boundary bisected once when seen, no line
floor, never across a jump — a jump has zero width in the sweep's parameter
and every pair is queried at its first sample, so a re-sample below it bounds
an exit or a re-entry on its own side (the jump before it the floor),
DECIDED only where its contact side was a decided touch; the first
decided free sample after the exit is the separation's evidence with its free
radius r = (d − CONTACT_EPS)/V of the chunk — open edges, inside the chunk, the
smaller side in track units, f32 rounded inward; at a chunk's start the radius
is 0 and the free POINT alone is the evidence — Codex R144 decision 6) and
KNOWLEDGE GAPS (undecidable; a tool without a length — for EVERY tool pair, in
contact before or not, and the contact after it is flagged after the unknown
tool, the cutting state begun anew — gaps open, separate, certify, count and
tint nothing). A cutter's rapid part after a feed begins where the rapid does
(its entry never reaches back over the feed — R144 VP-I95/I96). `CollisionOptions.contacts = {store, origin}` gives the sweep its store
(noteQuery; the sweep restores its pose after the store's bisections); without
one a sweep reports its metadata only. A store whose budget is spent stops the sweep (`truncated.reason
"budget"`, `incompleteFrom` = the earliest position of a row it refused — every
pair of that sample still tries, and a row the closing refinement in `finish`
cannot write counts before the result goes out; the shard merge keeps the
shards' minimum — R144/R145 VP-I100). Transport (`collisionWorker`, a request's
`contacts: {generation}`): deltas `{id, contacts: StoreDelta[]}` — new rows
plus rows changed since, each once with its latest state — at most ONE
unacknowledged per path (`{contactsAck: id, generation}` — bound to the
generation it acknowledges; the delta with a store's FIRST interval goes out
beside it, once, so at most two — C2, R170: an acknowledgement held behind a
near miss's delta held the first touch back by the whole hold; the pool's
forward and a fallback's drain count the same way), the last delta with the
result; a receiver writes a
delta column by column, a block's stretch at a time, its updates in pieces, in
counted steps (`ContactStore.applySteps`: a budget's delta 2.7 ms in Node, 175 ms
a row at a time; an update delta over the whole budget took 68–78 ms at once on
the page, Codex R155), and checks all three tables' bounds before it writes — a
message out of order or past its budget is refused WHOLE, nothing written; the coordinator
applies and acknowledges each shard's delta at once and sends the owner one
message per round; a fall back to this core is the next generation, a side run
started again too. A failed pool still DRAINS its generation: what the
coordinator took over and had not forwarded, and a result computed and held for
the acknowledgement, go out one delta at a time; a run already computed is not
run again, and the newer generation computes meanwhile but says nothing on the
request's path until the drain is delivered and acknowledged — the drain
takes the pool's count of messages out and says nothing until each is
acknowledged, generations in order (R144/R145 VP-I98/I99, C2). `viewer/contactMerge.ts`: the entry join (an entry
contact still OPEN at its end — no exit, not ended at a gap — continues the base
episode's FIRST interval when it begins at the base's first checked point;
a closed one has its separation evidence, and no nearness tolerance joins
across it — R144 VP-I97), the beginning on the base axis. Checks: `collisionContacts.test.ts` (the
store against the truth on the shipped and generated machines),
`collisionOracle.test.ts` / `collisionRangeOracle.test.ts` / `collisionHorizon.test.ts`
(the reliability guards on the tables, C1), `collisionWindows.test.ts` (contact windows in closed
form, widths 0.26–0.5, every one found to 1e-3; a free gap narrower than the
touching stride EXPLORE may stay unsampled and read as contact, one wider is
always proved), `collisionSpeed.test.ts` (V ≥ every vertex's relative speed at
interior points; the generated machines and a rotary not about Z),
`sweepShards.test.ts` (the contact tables of 1, 2, 3 shards and a random
split: every touch interval's witness, entry and decided exit inside the other
run's intervals of its pair, else a touch run no wider than MIN_ADV by the
truth), `contactStore.test.ts`, `contactMerge.test.ts`,
`collisionWorker.test.ts`. `CollisionOptions.profile.probes` counts the
distance probes away from the main step (re-sampling, the store's bisections).

**After a fallback (round B4, plan 3.5; Codex R140–R143, R150–R152)**: a pool
that falls back to one core reruns the request as its next generation; the
receiver keeps the earlier one (`held`) together with how far each of its
shards swept — the coordinator's `{id, heldCoverage: {generation, covered[]}}`
(track fractions by shard; the side run on shard 0 its own), posted before any
word of the next generation and queued with the tables' deltas: an open
contact's rows name its entry only, so the furthest row position is a lower
bound beside it, never the coverage (VP150-02). A source with held tables
(`ContactSource.held`, `heldCoverage` on its own axis through
`ShownSource.ownEnd`) shows, per pair AND origin, the union of both
generations' intervals less the proven free stretches of both
(`viewer/contactUnion.ts`, pure): a free sample proves (p − r', p + r') free,
r' its radius cut back to the nearest confirmed point (a witness, a decided
boundary) of either generation inside it — none where one lies on the sample
itself; the point stays contact, the sample free, and no neighbourhood of the
point is made contact (VP150-01: ±1e-3 around a point swallowed a whole free
gap). A confirmed point deeper than the refinement's 1e-3 from both edges of
the original stretch — possible once its radius exceeds 1e-3 (VP-I114) — is a
contradiction of the two runs, kept and NAMED in the sweep's caveat ("its two
runs disagree at N places (from L…) — kept as contact"). A TOOL gap (the tool
unknown) of either generation SEPARATES events (VP-I113: the contact before it
ended, one after it begins anew — an empty rerun joined two old events at a
point gap and lost the second's key): the pair's tool gaps become SEPARATORS
(`mergeSeps`) — never two gaps of one generation (the sweep closes a gap
before it opens the next; a time axis collapsed in f32 puts several on one
point, and a known instant between them holds a contact of its own — R152),
across generations the same gap aligned (equal, or overlapping: one cut at
its coverage). They cut the axis into ZONES closed at both ends (between two
that only touch, the shared point is a zone), each its own union; a part at a
zone's bound with length elsewhere belongs where its interval goes on; a
POINT interval lies in a zone holding its point, chosen by its generation's
order where several do — never before the interval before it, one further
when it began after the unknown tool. An undecidable gap separates nothing; a
knowledge gap does not split a piece, and a piece's contact on screen is its
intervals' own less each one's generation's gaps. Named limit (accepted
R153): two contacts of a pair touching at one point within one known stretch
(exit, free sample, re-entry in zero time, no separator between) — their
generation's rows order them, but how that order maps onto the other
generation at the collapsed coordinate is not decided — the union joins them
under the first key and hands the second over (the shown count may drop by
one per such boundary). At one position a target list puts contacts before
near misses, then by source, table and row — never by a piece's or a
generation's bits, so a union lists ties as the view without a fallback. A piece is ONE u32 in the target list (its start
evidence: an interval's enter, a free stretch's end, or — an interval of the
other generation reaching over a separator — the zone's start, named by the
gap it ends at and the piece's origin); the build walks each group ONCE
(`eachPiece`, VP-I112/R151: the intervals read into a scratch reused group
after group, each free stretch computed once, both generations' parts merged
by start and the free union cut out), and every later question asks
`pieceFrom` from the piece's start evidence alone — the view keeps a fixed
context of its last group, nothing per row (a memo of free stretches per
interval grew with the group, outside the budget). Its identity: the earlier
event's key where it holds that event's witness, else `<lead row key>#g<generation>/<b |
f<gen>:<evidence row key> | s<gen>:<gap row>>` — an interval's number in its
episode read from the source's group index (every source has one: intervals
by pair, origin and enter — an episode's stand together in time order), never
by walking the episode's chain, which a pair with many re-entries makes as
long as the table; an earlier event whose witness
a piece another earlier event keeps holds (a free stretch refuted on its
sample) is HANDED OVER — `findKey` with its key answers that piece. A base
contact an entry contact continues is that entry's finding in every generation
of either side (VP-I111): the joins are formed between each side generation
swept to its end (the current one by the side's result, an earlier one when
every shard of it reached 1) and each base generation, and the piece holding
where a joined base row begins is the continuation, whatever else it holds;
a later piece of the pair stays a finding of its own. Near misses of the two
generations are matched one to one per group by overlap in order: a matched
one shows the current approach under the earlier key, an earlier one not found
again is `earlier` (the Sim tab: "from the earlier run"). Code marks read both
generations' episodes (a free stretch proves no touch, not that the pair left
the margin). `contactUnion.test.ts` holds the walk AND the search to a brute
force over open and closed spans with zones (7 seeds × 3000 random generation
pairs with tool gaps — realistic ones where a contact ended, point gaps and
clusters of restarts at one point with a touch in some known instants —
piece by piece and zone by zone, each asked again from its start, the
contradictions the walk names equal to `eachWideConflict`'s) and to Codex's
R140–R142, R150–R152 sequences; `contactUnionSweep.test.ts` drives the REAL
sweep (a Ø20 tool past a vise, the tool unknown on random stretches, zero-time
clusters of restarts; a 32-bit generator — a product of doubles past 2^53
loses its low bits) and requires the earlier generation's events — keys,
places, ends, kinds — unchanged by an empty and by an identical rerun, every
earlier key answering in both (1000 passes; the named limit counted apart,
at most one merge per boundary);
`contactViewUnion.test.ts` holds the view through real tables (keys, gaps,
separators, the handover, near misses, the reported coverage in three steps,
conflicts, origin groups, a point gap inside a longer one, the budget);
`contactViewBudget.test.ts` holds what a view holds to `derivationBound` —
derived from the store budgets term by term (pieces from union splits, zone
starts and near misses, the episode list, the group index, the gap index with
its pair's furthest end, the separators as two gap references, the near-miss
matching, the joins): 10.91 MB at the request and side budgets (the 8.4 MB
first agreed held none of the union's splits, gaps, separators or near
matching) — at the budget, after the queries, every free sample cutting, full
gap budgets of both reasons on one pair and on a pair each, near misses
matched, pieces begun at separators (7.99–9.20 MB). The gap index holds each
gap's row (4 B) and its pair's furthest end so far (8 B — a bisection's point
gap may lie inside a longer gap), the values read from the table; a copy of
every span and reason was 21 B a gap;
`shownContacts.test` the joins (base, side, both, a side not swept whole, a
later contact); `collisions.viewer.spec` fails a real sub-worker (the worker
script served with a hook that holds the pool's words after its first
contact, then fails shard 0): the earlier finding stays listed under its key
through the paused rerun, each contact once after it — and answers both
requests itself for the joins (the base's fallback after the side ended, both
at one failure, a later contact).

**The view built in steps, published with what the bar shows (plan 3.6 Form 1,
Codex R152–R156; `viewer/contactPublisher.ts`, `viewer/steps.ts`)**: the view's
build ran on the page in one task — 0.3–1.2 s at the budget, and a long task
holds the handlers of Escape and the E-Stop button too (the heartbeat runs in
the WebSocket worker). Every job is a generator that yields after `STEP_OPS`
(4096) COUNTED operations — never a time: `runSteps` drives it in slices of
about 8 ms with a macrotask between, `sortSteps` sorts (stable, natural runs),
`copySteps` copies a list into a typed array, and every loop counts the work
it DID, never a flat figure after it: a held table's coverage read at once
(`provenCoverage`, 16 ms) and the target lists copied at once (20 ms) were
single steps in the browser, and Codex R157 VP-I115 found more — a coarse held
contact over a rerun's every contact was gathered as one component at once
(792 248 scratch reads between two yields): the union walk now scans at most
`SCAN` (64) intervals a call between its counts, writes a piece's ranges in
steps, and a piece's callback may be a job (`PieceEach`; a piece of more than
`SMALL_PIECE` (64) candidate intervals is described and banded in steps —
`describePieceSteps`, `pieceIntervalsSteps`); one pair's gaps merge in steps
(`mergeSepsSteps`), the gap index, the joins and the near-miss list sort and
copy in steps. ONE interval's own contact less its pair's gaps is walked in
steps too (`piecesOfSteps`; Codex R158 VP-I115 rest A: one open contact over
the gap budget of undecidable gaps — an undecidable answer suspends a
contact, never ends it — was one step of 49 189 reads, 98 420 as a union of
two), and the bands light by DIFFERENCES (+1 where a run begins, −1 after it:
a piece lights its run at once, however wide). Every QUESTION is bounded by
bisections, never by the intervals a piece holds or a search passes (R158
rest B: a rapid/feed alternation — every contact ended at the feed, no free
sample, Codex's real sweep — made `pieceFrom`'s end search walk every later
interval, 65–89 ms; a piece was described interval by interval): a block index
per generation (the next block of 64 positions holding a free sample; another
for an interval that is not a possible contact) finds the next free sample in
at most two blocks; the union's reach from a piece's start is the COMPONENT END
the build's walk wrote per interval (`UnionGen.comp`, its last part's zone; an
interval reaching past the zone: the zone's end) — the u32 an interval Codex
accepted for the free-sample index, spent there; a piece's facts
(`pieceFacts`: the lead among the few holding its start, the heir by a
bisection on the witnesses, possible by the block index, an open end among
those ending where it ends) and its ranges come from bisections; a target's
position from its start evidence alone (`pieceStart`); a free stretch is cut
back by the k−1…k+1 rule at every question as the walk does; per gap the next
tool gap (`hTool`: `ownEnd`) and the last gap of its touching stretch
(`hComp`: `freeOf` by two bisections); `lineMark` stops at a contact beginning
on the line and asks an episode's kind of the block index; a KEY is found
from the event it names, never by asking targets (5 s at the budget in Node
when a fallback moved a shown finding; R159: at ONE position every pair's
finding may stand, so not even the targets there): the episode index per
table (`eIdx`, by pair, number, row) gives the interval or near miss, the
matched near misses by the earlier reference (`nearByHeld`) the current one,
a new piece's evidence its reference, and the reference its place in the
target list — sorted by position, tie bits and reference, one bisection
(`indexOfRef`); an earlier event's key is carried by the piece holding its
witness, derived from the indexes (`pieceContaining`: the component's start
by a bisection over the rising component ends, the last free stretch before
it through a third block index — the previous free sample —, then `pieceFrom`
names its evidence), and the handover is that piece (one holding the interval
AND its witness; none for a witness inside a separator only the other run
saw). After a fallback the free block indexes hold only the samples whose
stretch the UNION keeps — the walk's verdict, written into the spare top bit
of `comp` (`FREE_HOLDS`) and the blocks rebuilt from it (`freeHeld`): a run of
samples each refuted by a confirmed point of the other run was asked one by
one, back and forth (R160 rest D: 7.2 M reads for one key at 8 192 contacts).
The walk counts every sample it looks at, a dropped one too, and finds the
other run's interval before a sample by galloping from the last one, each probe
counted (R160 rest E: an empty rerun's 32 768 samples, a late sample after a
coarse contact's 32 768 finer ones, were each one step). The searches' windows
over the free samples are, where the walk found every kept stretch between its
own witness and the next one's on a side whose witnesses rise
(`UnionSide.local`), the witnesses around the asked range — two bisections, no
reach (R161 rest F: one long VALID free stretch in another pair, or later in
the same one, widened every window to every sample: 116 568 reads for a key at
8 192). A stretch never reaches past the nearest confirmed point on either side
(`cutStretch`, the build's and every question's one rule: max(p − r', below),
min(p + r', above)) — p − (p − x) rounds below x (0.9 − 0.8 < 0.1), the open
stretch held the confirmed point and the structure check failed for the whole
generation (R162); else the KEPT stretches' reach (`back` / `front`), which the walk
reports with each (a raw radius over everything, cut back or refuted, opened
every window over every sample: 1.2 M reads for a target's end at 8 192); a
sample a confirmed point contradicts is named ONCE, at its least deep point,
found by three bisections a side (`firstDeepX` — witnesses, enters and ends
rise with the index): the count is of contradicted samples, no longer of
(sample, point) pairs — samples × intervals of work, 402 M "places" for 8 192
such samples. The steps from a position skip a block of tied findings by the least and
largest jump point per block of 64 (`RefList.sMin/sMax`). A union piece is
tinted where each interval's OWN table proves contact (R159 VP-I119: cut at
the start evidence's coverage, the current run past the earlier one's went
dark). The test seam `linearPiecesForTest` asks the old way, and
`contactViewIndexed.test.ts` holds every answer to it. `derivationBound`
14.93 MB (R152's 10.91 + the component ends 2.36 + three block indexes 0.11 +
two u32 a gap 0.29 + the episode index 0.59 + the near misses' order 0.29 +
the jump points per block 0.37). The steps that ask positions — the start pairs, the timeline
marks (`ClashIndex.work`) — count what each query read (`viewWork`, every cell
`rd` reads), and a view keeps its last decoded piece. The boundary contacts'
stretches are built with the view and published with it
(`derived.boundaries`). The publisher holds each request's current
generation in TWO copies — `pub`, which the published views read and nothing
writes, and `work` — and the held generation shared. A PASS: 1 takes the
messages received so far in arrival order, each one's deltas into `work` in
steps, then its effects on the viewer's live state (`_colOnMessage`); 2 builds
the views of the tracks the live state shows (`deps.tracks()`: the result's,
the partial's, the track a run check's beginning stands on, the entry track)
from `work`; 3 publishes in ONE task, and only when the live state still shows
exactly the specs it built (else the build begins anew, the messages stay
taken): `work` becomes `pub`, the views and the state the viewer stages THEN
(`colShown`: what the bar shows, bound by ScrubBar — never ahead of its
tables); 4 catches the dead copy up in steps, and only then acknowledges. A
fallback (`heldCoverage`) discards a build, never evidence: the complete copy
that is not published takes the drain (acknowledged as each delta lands) and is
held from the new generation's first delta; `pub` stays shown until the union
is published. Every ticket closes once (the catch-up, the fallback's
transition, or a request let go — whose tables, queue, tickets and views go).
A discarded build (a fallback, a request let go) stops at its NEXT step and is
closed, and a let-go request's delta stops going in at its next step too — it
used to run to its end (Codex R157 VP-I116). A view's life ends at the
publication that replaces it or with its request: `retire` → `retireView`, and
every query of a retired view throws (`check`), even over unchanged tables
(VP-I117). `viewOf` is a PURE read of the last publication (a request without
tables yet — nothing found so far — reads as one). `stats()` counts every live
store ONCE — the published, work and held copies and the tables only a still
published view reads (`byOwner.shown`: the old generation's published copy
until the union replaces it, VP-I118) — and the views' own bytes apart:
`views.published`, `.waiting` (built, not yet published), `.inProgress` (what
the build running now has ALLOCATED from its first step: every typed array of
the view and of its derived data and every build buffer, counted where it is
made — `steps.withMeter` around each step, `allocF64/U32/I32/U8`, the growable
`Grow` lists the build's per-row buffers became; an upper bound, the toolpath
ledger's rule; Codex R158 VP-I118), `.building` = waiting + in progress
(`heldBytes` for a built view). The build's lists grow by BLOCKS (`Grow`: the
first doubles up to `STEP_OPS` elements, then a push starts a new block and
copies nothing; `done` makes one array a block a counted step — a doubling
copied 32 768 elements in one `TypedArray.set`, Codex R159). The union walk's
buffers (66 B × the capacities of both sides + 18 B × the merged free list's,
kept per side, reused group to group) are made once a build and shared by
the view and its bands. The publication begins a task of its own when the
slice before it has worked (`runSteps`' `endSlice`): its task held up to a
slice of build steps before it (52 ms in Codex R159's run under a low
priority). A pass's later slices go in a macrotask
(`steps.macrotaskSchedule`: a MessageChannel, one message out at a time, and
the next animation frame takes a slice over once its message has waited
`STARVED_MS` = 32 — never a timer): under continuous key input Chromium held
the page's posted tasks back behind input and frames, a pass's slices waited
up to 20 s each with the main thread idle (24–52 s per publication, R163); a
slice in every frame instead delayed the pointer to 123 ms, a frame or a
message per slice piled up into 332 ms tasks. A pass never discards itself: the
viewer's stage watcher (`_colOnStageChange`) does nothing while a pass takes or
builds — its publication stages the state then — and the code panel's marks
and the tint follow the publication alone (the `contactsVersion` watcher), so
a taken message's effects re-emit nothing early; only the clears (a failed
worker, a program change) go at once. The page's own layout reads after a DOM
change were forced in the task that made it: `v-sticky-head` reads the head's
height from its ResizeObserver only, the scroll fades re-check in the next
animation frame, and the Sim tab follows the marked row and fits its summary
line in the next frame, before it paints (each forced 22–25 ms at the list's
first arrival); the kept picture stays in the task that changed the rows (every
reader after it sees the row where it was) and reads only when a row on screen
was anchored — never at a first list. `__viewerDiag.getContacts()`:
`passes`, `discards`, `publications`, `lastPassMs`, `longestStepMs` (per phase),
`running` / `pending` / `phase`, `stats.byOwner` (pub / work / held). Measured
(Chromium in the VM, 262 144 targets, the page at rest; R157): no task over
50 ms at the tables' arrival, an update delta over the whole budget, a
fallback and a rebuild; the longest step of a phase ≤ 5 ms; the publication a
task of 30–33 ms (Vue's render of the 400 rows and the marks — the marks' and
the rows' lucide glyphs are WRITTEN OUT as the components render them, a
component per mark cost ~18 ms there; `glyphMarkup.test.ts` renders the
components and holds the markup to them); a key's input delay p95 2–8 ms, at
most 20–34 ms in an update, a fallback or a rebuild and 15–89 ms at a budget's
first arrival (its frame: the publication, layout and paint of ~9000 new
elements); a cancel inside one big group takes effect (one discard, nothing of
the old request acknowledged); 15.1 MB per copy at the budget. A program change's own
long tasks (64–88 ms, compositor commits under software GL) occur with no
contact tables at all — outside 3.6; the browser-PC measurement is owed. Tests:
`contactPublisher.test.ts` (the phases, both copies, a fallback in every phase,
tickets, release, no self-discard, a spec changed under the build, the
transport's rules and owners carried over from the removed `contactsReceiver`,
Codex R157's lifecycle, cancel and memory probes as guards),
`contactMeter.test.ts` (a constructor spy over whole builds equals the meter,
no JS array grows past the columns, Codex R158's memory probe),
`contactViewIndexed.test.ts` (the indexed answers equal to the old walk on
random generations with an entry union, joins and the keys of the run before
a fallback; the worst reads of one question on five shapes the same at a size
and at eight times it),
`checkWiring.test.ts` (the worker handler through the real publisher,
`_colOnStageChange`, the cancel), `steps.test.ts`, `contactView.test.ts` and
`simWindow.test.ts` (every table cell read per step — the direct block reads
too — on five edge shapes: the build and the bands within the step's share, the
start pairs and the marks within it and one search; no list sorted or copied at
once — Codex R158's gap shape too), `contactUnion.test.ts` (Codex R157's component probe, a piece over every
part, a zone that skips every interval, the indexed search against the walk
and the brute force, a radius over the other run's every confirmed point), `stickyHead.test.ts`, `scrollFade.test.ts`, `glyphMarkup.test.ts`,
`contactStore.test.ts`.

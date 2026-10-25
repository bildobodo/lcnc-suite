# Toolpath preview: rotary-aware path, soft limits, refusals, bounds, reach, chunked draw

> Moved verbatim from `CLAUDE.md` on 2026-10-25 (the guide keeps a short form and points here).
> The entries record each rule with the reason and the review round that set it.

**Toolpath preview modes (rotary-aware preview)**: on machines whose
work/tool chain has a rotary DOF, the programmed XYZ polyline is not the
tool-versus-workpiece path. The parse worker ships per-vertex A/B/C
(`feed_abc`/`rapid_abc`, present whenever the tool-vs-work POSE depends
on abc — `should_ship_abc`, W2 P3: a rotary sweeps, raw abc ≠ 0 anywhere
(a constant tilt — the per-epoch peel can zero it, the TWP pattern), or
switchkins markers are present; absence = programmed polyline already
exact) and decimates in 6D under the same condition so rotary sweeps
survive RDP; `viewer/partFrame.ts`
(pure, unit-tested; run off-thread by `partFrameWorker.ts`) subdivides
rotary segments (~4°/sample) and transforms each sample into the work
frame by evaluating the machine.json chain — same normalize code as the
live scene (`viewer/kinematics.ts`), so the preview overlays the backplot
by construction. TLO rule (W3 P0 + schema 8): the tool-length offset is
PER-SEGMENT state — the wire's `tlo_events` rows ([seq, xo, yo, zo, tool],
recorded by the canon at every G43/G43.1/G49 and executed M6 on a program
line; segments before the first row ran under the START tool state the
parse was seeded with — `tlo_start`, see "Start tool state" below — and
resolve to the payload's tool basis) — resolved by ONE function
(`viewer/tloEvents.ts` tloForIndex) and LIFTED by one (`partFrame.ts`
liftToJoints, on TIP-space terms: epoch terms carry no tool, so the offset
can never ride twice). It subtracts in the TOOL NODE'S WORLD ROTATION —
the same frame in applyState phase 3 (local .position under the rotated
spindle chain; the scrub SAMPLE's offset while a scrub pose is shown), the
part-frame tip peel (lift and peel from the same per-vertex value) and the
collision sweep (a per-pose tool-local translation of the tool body, no
longer baked into its verts). A world-axis subtraction is off by a
constant rigid offset whenever the spindle chain is tilted (operator-
caught: 12.58 mm at the TWP hold); ONE live offset for the whole track
posed every post-G43 joint a tool length high on a fresh boot (the corpus
gate's 22.000 catch). The sweep and the scrub marker also wear the tool the
program has active per segment (`parse_tlos` rows carry diameter). An M6 names its tool to the canon by the tool's ROW in the table (LinuxCNC's CHANGE_TOOL(slot)); the number is that row's id (`gcode_canon.change_tool`) — with a library tool ahead of T1 (the XYZAC sim's table) every T1 used to read as 37 and the program's tools had no length or diameter on the client (live 2026-10-09; `TestToolNumberIsTheRowsId`). Settings → 3D Viewer → "Path on part" (default) vs
"Programmed XYZ". The transform re-runs on live WCS changes (debounced —
part-frame vertices depend on pivot-vs-work-origin). Machine-limit
overflow + bounds boxes stay in programmed/machine space (the correct
space for limits). CRITICAL mapping: kinematics `joint` indices ↔ axis
letters via `viewer_init.axes` (joint order) — on XYZAC, C is joint 4 but
canonical axis 5; never index axis-lettered data by joint number. Known
limits: trivkins assumption (non-trivial kins would need joint-space
samples), and UVW joints evaluate as 0 in the preview transform (linear,
virtually never in a work/tool chain; the live model still articulates
them from joint_pos).

**Per-line soft-limit validation (offline dry run, stage 1)**: the parse
worker checks every canon segment — pre-RDP, since decimation can shave
extremes — against per-axis INI limits. Pure helpers in `gateway_util.py`
(`read_axis_limits`: `AXIS_<letter>` preferred, `JOINT_<n>` fallback in
joint order; `check_limit_violations`: machine-frame, joint-side — TLO
added back to XYZ — all axes incl. rotary; both unit-tested; VECTORIZED
with numpy since 2026-09-05 — the per-segment Python loops stay as
`_check_limit_violations_scalar` / `_check_limit_violations_trsrn_scalar`
oracle twins pinned by `TestVectorizedLimitChecks`, and the trsrn inverse
has a vectorized twin `_trsrn_inverse_np` pinned to the scalar to 1e-9).
WORLD-mode (TCP) segments (phase 2c): joints ≠ words, so those segments
route through `check_limit_violations_world` — rotary-subdivided (4°,
mid-segment extremes are the point: the phase-0 capture's joint X hit
−22.36 on a program whose X words never left ±20) through the Python
kins twin, TLO applied to BOTH world coords and the pivot param; a
declared kins without a twin leaves its segments UNCHECKED — the count
rides the wire as `violations_world_unchecked` (present only >0) and the
stats dialog appends "N TCP segments not validated" (warn, never OK) —
never identity-checked wrongly. Marker policy (`kins_marker_policy`):
markers on a NON-switchable declared kins (trivkins / no `[KINS]`) are
IGNORED with one stderr note — the machine can't switch, so emitting
flags would map startup type 0 to "world" (no sparm) and gut the identity
check; only 'twin'/'unchecked' configs get mode arrays. Client honesty:
world-flagged segments arriving with NO kins spec pose as trivkins but
log loudly once per JS context (`warnWorldWithoutSpec` — scrub pose,
entry move, part-frame, collision sweep). RDP anchors both flip vertices
(`mode_boundary_indices`: i-1 ends the old-mode span, i starts the new —
keeping only i relabels a collapsed collinear span). Reports merge per
(origin, line, axis) — the line is the RAW number of the file the move ran
in, so a record is bound to its motion and to where it ran (Codex R177
VP-I130): origin = the main program, or the innermost marked subroutine with
the verified call line of its outermost span (`limit_scope_of`, the span walk
of the per-point attribution; per call SITE — a loop's calls are one record),
`sub` / `site` on the record, and its violating stretches as seq runs
(`runs` [[first, last], …] in execution order, at most `LIMIT_RUN_CAP` 32,
`nruns` all — a row over the cap says it per axis, "the timeline bands only
the first stretches: Y 32 of 40, X 32 of 40", and the summary's
"?" counts such rows, Codex R178/R179 VP-I131), one shared bookkeeping (`_limit_records`) in all five checkers
and `merge_violation_records`; both ends of every reported stretch survive the
decimation (`seq_boundary_indices` in both streams); records are sent in
execution order (by their first stretch). Attribution
rule: only a line that MOVES an axis while out of bounds is flagged; lines
where the axis merely sits parked past a limit are not re-flagged, so the
culprit line stands alone. Wire: `violations` (records, the first 200 the
program runs) + `violations_total` (distinct origin, line and axis); `null` means the INI had no MIN/MAX_LIMIT —
unchecked ≠ clean, and the stats dialog says "Not validated". UI is
centralized in the Simulation tab's list (one row per mark — a window of
400 around the shown one, plan 4.4 —, ‹ › named
for the shown kind, anchored to the CURRENT timeline position — scrubbing
re-anchors it; collisions and tool changes in the same list) and the
scrub bar's timeline marks — one tick per kind plus a lucide glyph
under the track in the tick's colour (the collisions one per OCCUPIED
column of the timeline's pixels — at most `TIMELINE_COLUMNS` (8192) like
the bands, so at most min(targets, columns) marks — at its first target, a
near miss only where every target in it is one — `simWindow.clashTicks`,
never one per target; ▲ limit, × clash, ● tool change;
the dark theme cannot separate red from amber) and extent BANDS (warn over
each record's violating stretches, danger over every contact interval, red
wins) — plus warn-tinted line numbers in GcodePanel (`.codeLine.violation`,
global: the lines the PLACED limit rows show — `limitMarks`, published by
the bar from `limitPlaces`: a record marks the line its own move shows, a
called file's move its call line, and nothing without a place or a line,
never a raw number (Codex R178); collision hits are danger via
`.codeLine.collision`) and
a Soft limits row in the program stats dialog. Limitation: validated
against the parse-time WCS — touch-off after load requires a file reload
to re-validate (the live overflow box remains the coarse always-current
check).

**Preview refusals are loud (2026-09-05)**: the preview interpreter runs
from the machine's LIVE state (active fixture, kinematics), so a TWP remap
can refuse a program in preview exactly as a run would (G68.2 while the
machine sits in G59 with a plane active: "Must be in G54"). In the preview
module `CANON_ERROR` is a stub and every remap refusal `yield INTERP_EXIT`
(= 1 < MIN_ERROR), so `gcode.parse` reports an EMPTY success — the fork's
`_canon_error` records the first refusal (`webui_preview_refusal`), the
worker ships `parse_refused {line, message[, sub, sub_line]}` + the
`__REFUSED__` stderr twin (`gcode.parse_refused` trace), and the client's
`previewRefusal` feeds the "Preview stopped — …" banner and a "Parse" stats
row. Line attribution is the unique-site rule (inside a marked sub span →
the span's verified caller line; else the one main-file line matching the
trigger text or the message's G-word), because `sequence_number` reads 0
inside a remap, `linetext` is empty in preview and the canon never fires
`next_line` for a remap trigger line — `line: null` rather than a guess.

**Sectioned preview streams**: the wire ships feed/rapid as separate
endpoint lists, which loses their interleaving — rendered as plain strips,
every stream switch drew a FALSE connector (a feed after a `G0 Z` lift
appeared to start at the pre-lift position, and the part-frame transform
subdivided that phantom into a long wrong curve; user-caught on a
post-lift rotary sweep). `splitTrackStreams` (viewer/scrubTrack.ts, pure,
unit-tested) re-derives both drawn streams from the seq-merged scrub
track as SECTIONS — each section's first vertex is the true start (the
other stream's last point) — plus `feedBreaks`/`rapidBreaks` (section-
start indices); `makeLine` turns breaks into an index buffer +
`THREE.LineSegments` so only real segments draw, and
`transformToPartFrame` never subdivides a break segment (breaks are
remapped through subdivision). Track-less legacy payloads keep the old
strips (no seq = no honest interleaving — same degradation as the scrub
bar). ANCHOR INVARIANT: baked geometry (part-frame output, or a programmed
multi-epoch rebase) hangs under its OWN `pathAnchor`/`pathRot`, posed only
by `toolpath.apply` from `anchorTerms` of the WCS it was baked with —
never from live status. `workOrigin` (stock, surface map, axes) keeps
following the live offsets. A mid-run G10 L2 / fixture switch used to move
the live origin ahead of the 300 ms re-bake: the whole path jumped, then
returned.

**Machine bounds (2026-09-12)**: the drawn box, the toolpath-bounds clip
planes and the camera reframe all use ONE box in the MACHINE frame
(`machineFrameGrp`): the LIVE per-joint limits the status
carries as `joint_limits` (`viewer/machineBounds.ts` boundsFromJointLimits,
joint order → letters via `viewer_init.axes`), with the INI-derived
`viewer_init.machine_bounds` as the documented fallback. The box is the
JOINT window and does not change with kins mode — the TWP sim's HAL mux
switches the AXIS-letter `ini.z.*` window (the WORLD pose LinuxCNC checks
programmed moves against), never `[JOINT_2]`. It bounds the HEAD reference
point while the drawn path is the TIP, so the yellow outside-limits overlay
never compares vertices with the box (that was off by the TLO in Z and the
tilt lever under B/C). ONE SOURCE OF TRUTH (2026-09-12 pm, operator: "so
not one source of truth?"): the GATEWAY validator emits, next to its
per-line records, one byte per shipped vertex — `feed_outside` /
`rapid_outside`: the segment ENDING there had a joint beyond the window,
raw geometric verdict with no parked exemption or attribution
(`gateway_util.segment_outside_flags` for identity segments,
`trsrn_segment_outside_flags` / `world_segment_outside_flags` for the
4°-subdivided world-mode ones, `reduce_outside_flags` onto the kept
vertices after RDP). The window is the LIVE joint window from STAT
(`live_joint_limits`; INI file fallback offline) and rides a `__LIMITS__`
stderr line into `published_limits`; `evaluate_limits_drift` reparses when
the live window leaves a live-sourced one (never loops). The client only
CARRIES the flag: previewDecode → track `outside` (merged like mode) →
`splitTrackStreams` feedOutside/rapidOutside → the part-frame transform
stamps every sample of a segment with its flag → `buildOverlays` draws the
pairs whose run (a, b] holds a flagged vertex as per-chunk index subsets
(prefix sum, so a decimated LOD chord over an excursion stays yellow) — no
clip planes, no box gate, nothing derived from tip geometry in the
browser. No flags on the wire = no overlay (unchecked ≠ clean). The
per-line records keep their attribution rule (the culprit line stands
alone) and stay the HUD chip / marks / scrub stops; the flags paint every
move motion would refuse.

**Reach envelope (2026-09-12)**: layers `reachRoom` / `reachPart`
(Settings → Layers → Machine Reach / Part Reach, both off by default) draw
the reachable-volume OUTLINES — lines only, no fills — from the live joint
limits, the machine.json chain and the live tool length — no program: `viewer/reachEnvelope.ts` (pure) hulls the travel box's corners
through the chain at every head-rotary sample (ROOM solid, under
`machineFrameGrp` like the bounds box; the box is what LinuxCNC enforces on
the joints, the hull is where the TIP can be), then sweeps that solid about
each work-chain rotary over its limit range — per-slice ray spans and a
circular min/max angle window; radial-table solids chain for a second
rotary — into the work frame (PART solid, rides `_workGrp`). The 5-D
workspace (position + tool direction) projects onto these two 3-D solids;
which tilt reaches a point is not shown, and no collision is subtracted
(the sweep answers that per program). `reachWorker.ts` computes off-thread
(~0.5 s on the trsrn model, one computation serves both layers), only
when the inputs change while either layer is on; the worker ships line
soups (hull creases at 8°, the swept solid's cage), never triangles. Three's quickhull produced non-supporting faces on this input (8
translated copies of one orbit): `HullSolid` deduplicates, jitters 1e-3,
VALIDATES every plane against the hull's own vertices and rebuilds with a
fresh seed, dropping faces that still fail (noted in the reply). Outlines:
the swept solid ships a CAGE (rings, generators, spokes — a body the camera
sits inside has no silhouette; crease edges showed only its caps and the
layer read as "still a cube"), the hull draws its 8° facet creases (the
head-lever fillets). With no tool loaded the room solid on the trsrn model
IS the travel box plus the 130 mm pivot lever — the honest answer. The TWP
sim's travels are model-derived since 2026-09-12 (X ±1500, Y −2000..1300
asymmetric — the head homes 1 m in front of the trunnion axis — Z
−2000..0.01; the upstream ±5000 was a 10 m box); every corpus and demo
program was validator-probed inside them. The box never hangs
under the rotating work group (7a04909 moved the planes but not the mesh —
"yellow while inside the box"). A stale path is ONE neutral grey
(`--bg` lifted toward `--fg` by `--opacity-disabled`, opaque) with the
overlays hidden; the soft-limit HUD chip shows the validator's count and is
not clickable (the scrub bar navigates violations).

**Chunked draw, display LOD, room-fixed prefix (2026-09-12)**: the drawn
streams are CHUNKS (`viewer/lineChunks.ts`, pure): real segment pairs
(`buildFrameIndex`, breaks index-skipped) binned SPATIALLY into ≤ 64 grid
cells by a counting sort — the index buffer is permuted, the vertex order
(`feedSrc`'s address space) never is — each cell one
object per LOD LEVEL with an explicit bounding sphere (a null one makes
Three compute the whole shared attribute's sphere per chunk). Per rendered
frame `toolpath.updateCulling` hides each chunk's outside-bounds overlay
whose box lies inside the machine bounds at the parent's current pose (the
overlay used to be a full second draw of every segment) and picks the
coarsest LOD level under 0.5 device px at the chunk's nearest point. Levels
are Douglas–Peucker pair lists over the SAME vertices (`decimatePairs`,
runs end at breaks and frame flips; tolerances `[1e-4, 5e-4] × envelope
diagonal`), cut by the worker that produced the vertices (`buildLodLevels`
in previewWorker for the programmed path, partFrameWorker for the bake);
scrub/sweep stay at full resolution. The machine-bounds clip
planes and the box live in `machineFrameGrp` = the work group's frame with
every WORK-chain rotary at zero (machine coordinates; a child of the parent
of the topmost work-chain rotary, offset by the base translates; `_workGrp`
itself without one) — never under the rotating table. ROOM-FIXED PREFIX:
the parse worker ships `rotary_cmd` (per rotary letter the seq of the
segment that first COMMANDS it — raw endpoint moved from the seed, or the
source line carries the letter as a word, `rotary_word_lines` /
`first_rotary_commands` in gateway_util — plus `unknown` and the seed);
`ScrubTrack.inheritedEnd` (per-axis leading-point counts), `roomEndOf(track,
work-chain letters)`; identity-kins vertices before it bake in the room
frame (`tipInRoomFrame`; the part-frame bake DUPLICATES the previous vertex
as a break at every flip inside a section) and hang under roomOrigin/
roomRotGroup (live) or roomAnchor/roomRot (baked) beneath `machineFrameGrp`,
so an uncommanded table rotary never moves them; world-kins segments and
everything from the first command on ride the part as before. A payload
without the key keeps the old picture. Follow-on hooks: `published_rotary_cmd`
in the bulk pipeline (skip the rotary reparse when the drifted axes are never
commanded), `rapidSrc`, `roomEnd` plumbing. Every payload from schema 10 on
carries the key (the 2026-10-01 stop's bump re-parsed every cache); never bump
`PREVIEW_SCHEMA` while the suite is live: the fresh worker emits the new number
against the running gateway's imported old one and the schema-mismatch edge
reparses forever.

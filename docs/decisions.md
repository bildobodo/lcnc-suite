# Decision record

Why things are the way they are — specifically, why some things are **not** built.

This file exists because "we decided not to do that" is worthless if it lives in a
chat log. Every item below is closed on the record, with the reason and the condition
that would reopen it. If you are about to build something in the "Closed" table, read
its row first: either the condition has been met (build it, and move the row), or it
has not (don't).

## The completeness rule

> **Complete = every claim the UI makes is true, every reachable unsafe action is
> gated, and every gap is either closed or visibly labeled. NOT: every capability
> exists.**

Three tests decide whether an item must be built:

| Test | Question | Verdict |
|---|---|---|
| **TRUTH** | Does the current behavior tell the operator something false? | Must fix |
| **REACH** | Can a machine we support actually reach this unsafe state? | Must gate |
| **DEMAND** | Does this need a machine or a user we do not have? | Close and record |

This is the project's existing "no silent fallbacks" ethos (see the HAL reader and
preview-limit design notes) applied as a stopping rule rather than a coding rule.

---

## Closed

### Per-segment WCS in the preview transform
**Test:** — · **Closed:** 2026-08-20 · **FALSIFIED and BUILT:** 2026-08-22 (review P2)

The preview subtracts one work-offset basis for the whole program. Making it
per-segment was scoped at ~180 lines across 8 files and blocked on two structural
facts: the drawn preview is a single `THREE.Group` (`workOrigin` → `workRotGroup`), so
per-segment offsets would need vertex-baking or N line objects; and `wcs_table`'s
per-index offsets are not reliable enough to key off.

~~Closed on merit, not obstacle: fixing the *reference basis* (parse against the
program-start WCS, with the live table patched into the parse var file) makes
multi-fixture programs render exactly, so per-segment state buys nothing.~~
**The "buys nothing" claim was measured wrong** by the TWP preview defect (see
the Fixed row below): `G53.x` writes the plane origin into G59 and every TWP
program cuts in two fixtures *sequentially*, so single-basis rendering was
wrong by the whole fixture delta on the NORMAL path, not a pallet-changer
corner case. Per-segment WCS is now implemented — canon `wcs_events` epochs,
per-epoch subtraction at extraction, `wcs_frames` on the wire, per-epoch
re-add client-side (`viewer/wcsEpochs.ts`) with vertex-baked display rebase —
and the two structural blockers dissolved: the rebase bakes the epoch delta
so the single `THREE.Group` survives, and `wcs_table` reliability is handled
by the `rewritten` flag (program-written fixtures pin the parse snapshot
instead of the live row).

### Websocket request IDs (issue #28)
**Test:** DEMAND · **Closed:** 2026-08-20 (deferred by agreement 2026-06)

Command→reply correlation. The single-client UI has never observed a mis-routed
reply, and every command's effect is visible in the next status frame.

**Reopens if:** a second concurrent controlling client ships (pendant, second
operator station), or a reply-routing bug is actually observed.

### Gantry dual-joint axes
**Test:** DEMAND · **Closed:** 2026-08-20

Two motors on one axis letter breaks the one-joint-per-letter assumption behind the
joint-ordered status arrays, `viewer_init.axes`, and the homing grid. Needs a
joints→letter map from STAT/INI, per-joint homing UI, and a decision on which joint
drives the viewer group. No such machine exists here to validate against.

**Reopens if:** a gantry machine is proposed — quote it as an architecture task, not
a machine.json job.

### Lathe UI semantics
**Test:** DEMAND · **Closed:** 2026-08-20

Axis math has been correct for XZ since the canonical↔joint fix, but there is no
lathe UI: G7/G8 diameter mode in the DRO, tool orientation display, CSS/G96 readout,
back-tool layouts. Building it blind would produce a lathe UI nobody has used.

**Reopens if:** a lathe is brought up on this stack.

### UVW in the preview/scrub transforms
**Test:** DEMAND · **Closed:** 2026-08-20

UVW axes are displayed and joggable, but evaluate as 0 in the part-frame and scrub
transforms. They are virtually never in a work/tool kinematic chain, the live model
still articulates them from `joint_pos`, and the limitation is documented in
CLAUDE.md's preview-limits section.

**Reopens if:** a machine with UVW in its work or tool chain appears.

### Rotary work-offset zero tick
**Test:** DEMAND · **Closed:** 2026-08-20

Zeroing a work-side rotary correctly changes only the DRO (RS274: offsets never
reorient the frame). A cosmetic tick on the platter rim showing where the angle
scale's zero points would be nice; nothing is wrong without it. Tool-side rotaries
have nothing to visualize by nature.

**Reopens if:** an operator reports being unable to find rotary zero.

### HAL-pin-driven auxiliary DOFs in machine.json
**Test:** DEMAND · **Closed:** 2026-08-20

Vises, tailstocks and ATC arms driven by HAL pins rather than joints (a vtk-vismach
capability). `hal_reader` could sample the pins, but collision semantics for
non-joint DOFs need real design — is a closing vise a crash or a clamp?

**Reopens if:** a machine here has a modeled auxiliary axis that matters for
collision.

### User-placed stock box / material removal
**Test:** DEMAND · **Closed:** 2026-08-20 (material sim rejected earlier by design)

CAM already covers material simulation; the control-side gap is motion safety, which
the collision sweep addresses. A user-placed stock body would give arbitrary machines
the cutting semantics that currently require a `stock: true` body in machine.json.

**Reopens if:** operators routinely run programs whose cutting contact is
indistinguishable from a crash on machines without a stock body.

### Timeline motion verbs (unified-timeline phase 3)
**Test:** — (design position) · **Closed:** 2026-08-20

Agreed design: the timeline unifies **display**, not actuation. Cycle start, pause
and abort stay in their constant home so a control never means two things. The
timeline never starts motion.

**Reopens if:** never, without revisiting the unified-timeline design position
explicitly.

### Stronger token mode
**Test:** DEMAND · **Closed:** 2026-08-20

Today's token is generated by the operator, set in the INI, and injected into the
served `index.html`, so browsers the gateway serves get it automatically.

**Threat model this accepts.** The gateway is a machine-control surface on a trusted
LAN. The token defends against: cross-origin WebSocket hijack from a page the
operator visits, and unauthenticated REST mutation by another device on the LAN. It
does **not** defend against an attacker already executing code on the LAN or on the
operator's browser host — such an attacker can read the token from the served page.
That is accepted: a machine tool on a network with a hostile host has larger problems
than the web UI, and physical E-stop remains the backstop. The launcher refuses to
bind a non-loopback interface without a token at all.

An operator-entered token (never served by the gateway) would close the read-from-page
vector at the cost of typing a secret into every browser on every reconnect.

**Reopens if:** the gateway is deployed on an untrusted network, or a multi-tenant /
remote-access story appears.

### Dedicated `run_surface_scan` websocket command
**Test:** — (superseded) · **Closed:** 2026-08-20

The surface scan reaches the backend as a generic `mdi` "O<surface_scan> CALL", which
the command policy cannot distinguish from any other MDI line. A dedicated gated
command was considered and rejected: the in-macro guard in `surface_scan.ngc` covers
strictly more — it also stops an operator typing the MDI call by hand, which a command
gate cannot — and it aborts before any probe motion, so the safety is equivalent.
Adding the command would have been a middle layer that dominates nothing.

**Reopens if:** the scan needs to be refused with a UI-level error *before* the
interpreter runs, e.g. because the G-code abort proves too coarse for operators.

### Gamepad stick → arbitrary machine axis
**Test:** DEMAND · **Closed:** 2026-08-20

Per-controller mapping profiles and the capture wizard shipped (5f1e2a4) and are
hardware-validated. Profiles map physical sticks to logical XY/Z; machine axes are
still resolved by letter. Assigning a stick to any axis letter is a want with no
reported need.

**Reopens if:** an operator needs to jog a rotary or UVW axis from a stick.

### Per-group machine-model visibility toggles
**Test:** DEMAND · **Closed:** 2026-08-20

Cheap and genuinely useful for looking inside a machine model, but it is a want, not
completeness. Nothing is wrong or unsafe without it.

**Reopens if:** it blocks diagnosing a model problem.

---

## Bounded — built to a stated line

### Websocket command coverage contract
**Line:** every command reachable on **any** dispatch path is gated, read-only, or
listed in `INLINE_EXEMPT` with a written reason.

Not bounded to the dispatched ladder, which is how four commands hid. Not extended to
proving handlers *behave* — that is each command's own tests. `test_command_policy`
parses both ladders out of `gateway.py` source, so a new handler on either path fails
the build unless someone classifies it.

### Payload validation (`COMMAND_SCHEMA`)
**Line:** bounds, arity and enum membership — nothing else.

Type (is it a finite number at all?) stays with `finite_int`/`finite_float` in the
handlers. Two non-overlapping claims cannot drift; merging them would mean either a
duplicated claim or rewriting 41 call sites. MDI is length-capped and nothing more —
parsing G-code server-side to decide policy is an open-ended project, deliberately
not started.

**Out-of-range posture.** Continuous operator inputs (override sliders, jog velocity,
spindle speed) **clamp** to the machine's ceiling and report the corrected value, so
the UI snaps back visibly; erroring on a slider drag is noise. Discrete and structural
values (axis index, joint, tool number, G10 axis words) **reject** — a clamped index
would silently act on the *wrong* axis or tool, which is worse than refusing.

**Bounds source.** Whatever the machine declares (INI, STAT), never a literal in a
handler. Where the INI declares nothing, `_OVERRIDE_FALLBACKS` substitutes exactly the
literal the handler used before, so a silent INI keeps today's behavior — but the
substitution is traced (`limits.ini_fallback`) instead of being invisible.

### WCS var-file units — settled by experiment, not inference
**Finding (2026-08-20):** the LinuxCNC var file stores G5x offsets in **machine
units**, independent of program units (G20/G21).

This overturns a comment in `gateway.py` that claimed the var file held
"interpreter-internal units" and that `_wcs_cache` therefore mixed units — a claim
that was never verified, and that was blocking the parse from being given the live
axis offsets. It also retires a suspected display bug: the Offsets panel renders all
nine rows in one table, so mixed units would have been an operator-facing lie. There
is no mixture; the seed and STAT agree.

**Experiment** (stock `sim/axis/minimal_xyz.ini`, `LINEAR_UNITS=inch`):

| Command | Program units | Persisted | Meaning |
|---|---|---|---|
| `G10 L2 P1 X2.5` | inch (default) | `#5221 = 2.500000` | matches `STAT.g5x_offset[0] = 2.5` |
| `G21 G10 L2 P2 X63.5` | **mm** | `#5241 = 2.500000` | 63.5 mm → 2.5 in — machine units, not program units |

The second row is the one that matters: it rules out "the file follows G20/G21", which
the first row alone could not.

**What IS true** from that old comment: LinuxCNC writes the var file only on shutdown,
so inactive rows on disk go stale within a session. That is a staleness problem, not a
units problem, and it has a different fix.

### Machine-asset cache: what the generation token covers
**Line:** a superseded load publishes nothing — not `failedParts`, not
`machineReady`, not the dedup slot. Its GEOMETRY is still cached, because that work
is paid for and valid for its own part ids.

The in-memory geometry cache stays keyed by part id, which assumes an id always means
the same geometry. True for every supported case: the model directory is fixed per
config. It would break only if one page session swapped to a different machine model
that reused an id for different geometry — recorded at the declaration with its reopen
condition rather than solved speculatively (IndexedDB is already URL-keyed, so only
the in-memory layer is exposed).

### Code-quality tooling (issue #36)
**Test:** — (answered) · **Not closed on GitHub**

An external contributor offered a PR for typechecking, linting, testing and dedup. The
project has since grown all of it: `vue-tsc -b` in the build, eslint plus a scoped-CSS
audit in `npm run lint`, vitest, pytest, Playwright e2e, and CI green since 2026-08-18.
So there is no work item left here.

Replying to or closing someone else's issue is the maintainer's call, not something to
do on their behalf — it is a conversation with a person, not a task. Left open
deliberately.

### HTTP-fetched bulk channels in the status object
**Line:** surface points and comp grid are carried across every status frame, keyed by
the version the gateway pinged, and consumers react on the version EDGE. The carry
survives a reconnect. It is not extended to anything the server already re-sends.

These arrive out of band — the gateway pings a version over the socket, the client
fetches the payload over HTTP — so the value is not part of any status envelope.
Writing it into `status.value` alone survived at most one animation frame, because the
next frame replaced the whole object; `status.value.surface_points` was therefore
`undefined` for any consumer not already latching it in a watcher.

Three things that made the obvious fix wrong, all now handled:

- **Fold in at FLUSH, not on arrival.** Stamping the carry onto a message when it
  arrives freezes whatever was carried at that moment, so a fetch resolving while the
  frame sat in the rAF buffer would be overwritten by the older value.
- **React on the version edge.** With the value on every frame, the old
  presence-triggered `compGrid = null` would blank the grid mesh ~30×/s. The edge also
  lets an EMPTY result clear the display — the previous `&& .length` guard existed
  only because the value kept vanishing.
- **Carry the same array reference.** Consumers watch these by identity; a fresh copy
  per tick rebuilds the surface `InstancedMesh` about thirty times a second.

The version sentinels in `bulkData` are now cleared on socket close, because the
gateway tracks "last sent to THIS connection" and re-pings the same version after a
reconnect — which the dedupe swallowed, so nothing refetched. Note the abort branch
there is defensive only: the sole abort today is the supersede, where releasing the
sentinel is correctly a no-op. Claiming it fixes a teardown dead-end would have been
wrong — nothing cancels those fetches on close.

`clearBulkCarry()` exists for test isolation only; production never clears the carry.

### Which fixture the program cuts in — and whether the preview is stale
**Line:** the preview names the fixtures a program actually cuts in when they differ
from the active one, says when it was parsed against offsets that are no longer live,
and offers one action that fixes it. It does not try to re-parse automatically.

The fixture list comes from the parse — the canon samples the work system at every
emitted segment — not from a regex over the source, which read the first 8 KB and took
the first WCS word, so a program that started in G54 and switched to G55 produced no
hint at all. Sampling at MOTION also means `M2`'s reset to G54 never counts as a
fixture used.

Staleness is detected by shipping the offsets the parse actually used, in machine
units, and comparing them against live status — not inferred from "did anything
change since load". `reparse_preview` is the one action: re-loading the same path at
the same mtime is a no-op (the poller's edge is `file != last or mtime != last`), so
the "reload the file to re-validate" promise in CLAUDE.md was not keepable in one step
before this. The same action refreshes the render, the soft-limit annotations and the
collision/scrub basis, because they all derive from the same parse.

Auto-re-parsing on every touch-off was rejected: it spawns a multi-second parse of a
possibly multi-MB program while the operator is mid-setup, repeatedly.

### Client command path (`fire()` vs `send()`)
**Line:** no command may travel BOTH paths, and no stop command may be droppable.
Commands that are raw everywhere stay raw, listed and justified.

"Route everything through `fire()`" would be wrong: 28 call sites are hold-to-move jog
pairs where a busy latch swallows the paired `jog_stop` and the machine keeps moving,
and the remaining raw state-changing commands are already disabled by their catalog
control inside the outer `<Gate>` fieldset *and* refused by the backend — a third
imperative re-check guards no reachable failure. What mattered was the **asymmetry**:
one command with two policies, where which one applied depended on which button the
operator pressed.

`COMMAND_COOLDOWN_MS` in `lcnc.ts` carries **transport policy only** — cooldown and
queue-safety, never gates. A gate table on the client would re-derive the backend's
`COMMAND_GATES` and drift, which `permissions.ts` forbids; a test asserts the table
contains no `gate:` key. Per-command cooldown is also what let the flag toggles stop
routing around `fire()` — a flat 200 ms latch was the reason they went raw.

`commandPath.test.ts` parses call sites and enforces this, mirroring the gateway's
coverage-contract discipline; `DOM_GATED_ONLY` is a ratchet, so a new raw-only command
fails the suite until someone classifies it.

### Surface-map rotary gate (`surfaceComp`)
**Line:** refuse to **start** surface-map work — probe a new map, or switch
compensation ON — while any configured rotary is off zero. Do **not** refuse to turn
compensation OFF, and do **not** auto-disable it mid-cut.

Turning compensation off while tilted is the safe direction and must never be blocked,
so the requirement cannot live on the toggle's own gate; the ENABLE direction is
guarded handler-side (`require_no_rotary_tilt`) and the UI picks which backend class
applies to which direction. Auto-disabling a live Z shim during a cut would move the
tool, so the "already enabled, now tilted" case gets a **label**, not an action.

Reads the canonical 9-slot position, never joint-ordered `machine_pos` — those index
differently on a non-trivkins machine, i.e. on exactly the machines that have
rotaries. The tolerance (`ROTARY_ZERO_TOL_DEG`) is sized to reject servo dither, not
to tolerate a deliberate tilt, and lives on the backend: `permissions.ts` forbids the
frontend deriving policy.

### `set_probe_vars` writable set
**Line:** a parameter is writable if this machine's **var file declares it** and it
is outside the reserved system ranges (`#1–#30` locals, `#5000+` system).

Not an exact allowlist of the documented `#3100–#3116` block (brittle — it would break
a custom probe macro), and not a numeric band like `#3000–#3999` (a proxy for the
hazard rather than the hazard: it would permit undeclared vars that cannot persist and
reject a legitimate var declared outside the band). The var file is the machine's own
statement of what is configurable, which is the same rule every other bound follows.
The system-range deny is unconditional *because* the var file legitimately declares
G28/G30, G92, WCS and tool parameters — poking those behind the interpreter's back
desynchronises the state that G10 L2, G92 and the tool table manage.

### Collision-sweep clearance bounds: certified per kins family
**Line:** each kins model bounds its OWN per-joint mid-chunk excursion, and a
property test certifies that bound against the model's real inverse. The sweep
knows no family's parameter names. A segment whose declared kins this client
cannot evaluate is reported as `uncertified`, not posed silently as identity.

The old bound read `machine.kins.params` — the trt-only `KinsParams` struct.
`specFromWire` puts trsrn geometry in `spec.trsrn`, a different field, so on the
TWP machine that read returned nothing at all: the rotary pivot collapsed to the
machine origin and the radius to the tool-length offset, against a real A lever
of about 2 m. Not loose — unrelated. Fixing it for trsrn alone would have left
the identical trap armed for the next family, because the break was structural:
a shared component reaching into one family's data by name.

**Residual, stated rather than glossed:** `MIN_ADV = 0.25` floors every
advancement step regardless of the bound, and the sweep's distance parameter
counts 1° as 1 mm. On a metre-scale machine a forced 0.25° step is ~8.7 mm of
surface travel at a 2 m lever — larger than the 2 mm margin. So a correct bound
does not by itself certify a machine of this size against arbitrarily thin
crossings; it removes the systematic blind spot, not the sampling floor. The
guarantee remains "no crossing wider than MIN_ADV of path parameter".

**Also bounded:** the bound is phase-independent — it charges φ²·amplitude
whether or not the chunk sits on a curvature peak — so a B or C sweep centred on
zero reads up to ~50× loose. Harmless in the sweep (for any pair a rotary
swings, the lever term dominates by two orders of magnitude; for a pair it does
not swing, the excursion is a few units against a certificate measured in
hundreds) and pinned in `kinsBulge.test.ts` so a regression is visible. The
A-lever term, which IS the budget for the miss class, stays within 3.5×.

**Reopens if:** a machine needs crossings thinner than MIN_ADV resolved — then
MIN_ADV has to scale with the model's largest lever rather than being a
constant.

### `halcompile` for the TWP kins stays out of `install.sh`
**Line:** documented as a one-time precondition in the sim README and in the
INI header; not automated.

`install.sh` has never built a realtime component. Making it do so would put a
compiler invocation that can fail on the install path of every user, including
everyone who does not want TWP, in exchange for saving one documented command
for those who do.

**Reopens if:** a second config needs a vendored component, making the
one-off a pattern.

### Switchkins transition vertices in the offline track
**FIXED 2026-08-22 (review P1, f689a5d + f568865).** The fix went further than
the "zero-length handling at the flip" sketched below: the flip segment
bundles the frame relabel WITH the real G53.x entry move (remap.py:1029 is a
real `G0 X Y Z B C` — the offline interp never resyncs its position at the
switch, so the segment start is wrong by the relabel jump). A zero-length
break would have swallowed the entry swing — the under-report direction a
collision sweep cannot afford. Instead `insert_flip_relabels` computes the
machine's true post-flip position through the family twins (joint-invariance
across the flip) and inserts it as a zero-length rapid vertex flagged `brk`
on the wire: the relabel connector is never drawn/swept/timed/lerped, and the
entry move sweeps from its true start. Measured on the probe below: both
flips get relabel vertices, and the 0→2 phantom was hiding 157 units of real
entry travel. A flip the twins cannot evaluate keeps the raw segment and
ships as `kins_flips_unresolved` — unhandled is said, never disguised.

**Line (historical):** the live behaviour is settled and the offline consequence is
identified, but the preview side is unverified until the TWP config runs.

Measured from the G53.6 capture (`~/twp-spike/capture-g536.ndjson`): at both
transitions the joints hold still (max |Δjoint| 0.0003 and 0.0041 — servo
dither) while world coordinates jump 645 mm at the 1→2 switch. So switchkins
swaps at a stationary pose and relabels the frame; it is not a move.

The offline stack interpolates within a segment using that segment's model. If
the wire ever carries the pre-switch and post-switch positions as consecutive
vertices, the sweep would interpolate a ~645 mm phantom move across one segment.
That direction is the safe one — it invents motion rather than missing it, so it
would show up as a spurious clash at the G53.x line rather than as a silent miss
— but it is still wrong.

**The check was RUN on 2026-08-21 and found the jump. This is now a
confirmed open defect, not a hypothetical.**

Probe program: identity-mode rapids, then `G68.2` + `G53.3`, plane-frame
rapids, then `G69` and more rapids. The preview wire came back with the
pre- and post-switch positions as CONSECUTIVE vertices:

```
[0] type=0  L6     (  50.000,    0.000,  100.000)
[1] type=2  L1029  ( 309.597, -654.904,  708.901)   flip 0->2, gap 931.16
[3] type=2  L10    ( 279.597, -684.904,  708.901)
[4] type=0  L12    (   0.000,    0.000,  100.000)   flip 2->0, gap 958.14
```

`track.mode[i]` governs the segment from vertex i-1 to vertex i, so the
segment carrying each gap is typed with the NEW mode: the sweep interpolates
~931 units of travel under the plane model across what the machine performs
partly as a frame relabelling at a stationary pose (measured live: joints
hold to servo dither while world coords jump 645 mm).

Consequences, all in the OVER-report direction — it invents motion rather
than missing it, so it cannot hide a crash: spurious collision hits along a
path never taken, phantom travel in the scrub timeline, and a long false
segment in the part-frame preview. Confined to programs that switch kins,
i.e. TWP programs on the newly shipped machine.

Note the flip vertex also carries a REMAP-file line number (L1029), the
line-attribution quirk already recorded in the TWP spike notes.

**Not fixed here** — the fix is a wire/track change (zero-length handling at
the flip, or splitting the frame change out of the motion segment) and wants
its own design pass rather than being bolted onto W8's acceptance run.

---

## Fixed

- **The run line-highlight parked on wrong lines for any program calling a
  sub or remap — and the first fix draft just turned it off.** (Review P1/P3,
  2026-08-22.) `motion_line` is reported per-executing-FILE, so a called
  file's numbering collides with the main program's; unfixable at the source
  (a queued motion carries no file identity, `call_level` tracks read-ahead).
  The detection (`check_line_attribution`) landed hardened — bare G28/G30 are
  motion (the draft's false positive disabled the highlight on clean
  single-file programs with a false "came from a subroutine" banner), G80 is
  a cancel, G10/G92/G52 axis words are settings — and the ACTUATING surfaces
  went positional instead of dark: the run playhead projects the live machine
  pose onto the track (`projectOntoTrack` — windowed, epoch-aware, brk-
  skipping; `motion_line` demoted to a residual-competing hint), and the 3D
  highlight is track-index addressed (`feedSrc` + `lineRunAround`, where
  contiguity disambiguates colliding numbers). Only the TEXT panel keeps the
  honest suppression + banner: a per-point main-file call-site channel is
  provably unavailable from the offline interp surface (`gcode.linecode`
  exposes no call level or filename), and a heuristic that can silently
  mislabel is the defect class being fixed.

- **Four commands were authorized by `armed` alone and were structurally invisible to
  the coverage test** (`set_compensation`, `set_compensation_method`,
  `simulate_probe_trip`, `confirm_tool_change`). A direct websocket client could enable
  machine-Z compensation on an unhomed or running machine. Moved behind the dispatch
  boundary; gates now match the frontend catalog. The *test boundary* was fixed first —
  gating the four without it would have guaranteed a fifth.
- **`confirm_tool_change` had no meaningful precondition.** Machine state cannot express
  "iocontrol is asking for a tool change", so the guard is the request pin itself
  (`require_tool_change_pending`), following the `require_no_eoffset` None/stale
  convention.
- **Payload values laundered through a local escaped the no-bare-cast guard.** Its regex
  matched only the literal names `msg`/`entry`, so `val = msg.get(axis)` followed by
  `float(val)` slipped through and put `G10 L2 P1 Xinf` on the MDI and arbitrary
  `#N=inf` into the parameter file. Three sites fixed; the guard now also catches the
  laundered shape inside the dispatch, with an allowlist that must name any legitimate
  non-payload cast.
- **Override ceilings were enforced only on the client.** The gateway hardcoded 2.0 while
  `MAX_FEED_OVERRIDE` / `MIN|MAX_SPINDLE_OVERRIDE` were parsed from the INI and shipped
  to the UI — so a builder who declared 150% had a backend that accepted 200%. That is
  policy enforced on the client, which `permissions.ts` forbids.
- **The preview subtracted the wrong work offset — for nearly every program, not
  just multi-fixture ones.** The extraction used the END-OF-PARSE offsets, and `M2`
  resets the interpreter to G54. So any program run in another WCS shipped points
  displaced by the whole fixture delta: the path shape was right, the entire thing sat
  at the wrong fixture, and on a rotary machine the error stopped being rigid because
  those coordinates then go through the kinematic chain. The basis is now captured at
  PROGRAM START — after the initcodes force the active WCS, before line 1 — which is
  the only basis for which `live offset + shipped point` is the true machine position.
  "First motion" was rejected on evidence, not taste: with a preamble that selects a
  different WCS it pins the path to the wrong fixture.
- **RETRACTED — "`wcs_table` mixes units in one rendered table".** Planning flagged this
  as an operator-facing lie on the strength of a source comment. The experiment above
  shows both sources are machine units, so the panel was always correct. The comment
  was wrong, not the code; it is corrected in place. Recorded here because a retraction
  that only lives in a chat log is how a phantom bug gets "fixed" twice.
- **A superseded machine-model load published over the newer one.** Nothing cancels an
  in-flight load when a different model arrives, so on a slow link the older load's
  `failedParts` replaced the winner's and its `machineReady` declared a still-loading
  scene ready.
- **The e2e mock's `reset` restored one field.** Specs mutate arbitrary status fields
  via `delta` and rewrite four more via `setAxes`, so anything beyond `work_pos` bled
  into the next spec — a passing test that silently depended on the previous one. It
  now restores a pristine snapshot taken at startup, and clears the recorded hellos.
- **The surface map could vanish and never come back.** Its value survived at most one
  animation frame in `status.value`, and after a reconnect the gateway re-pinged a
  version the client's module-level sentinel already held, so nothing refetched.
  Together that left the map gone for the life of the page.
- **`fire()` could silently swallow an abort.** It opens with `if (busy.value) return`
  — no feedback, no trace — and abort was routed through it from the keyboard and the
  gamepad, so an abort pressed within another action's 200 ms cooldown was discarded.
  Stop commands now bypass the latch entirely (`isNeverDebounced`), abort is on one
  path at all six call sites, and every drop is logged.
- **Two call sites hand-inlined `fire()`'s body** to get two sends under one latch,
  because the batch primitive did not exist. `fireBatch` replaces the copies.
- **Surface-map compensation could be probed and applied on a tilted machine.** The map
  is a machine-Z shim applied after kinematics, valid only with the tool normal to the
  mapped surface and the grid aligned to the work — and TWP support made tilted work a
  first-class thing this machine can do, so the gap became reachable. Gated in three
  places: the `surfaceComp` permission class (UI), `require_no_rotary_tilt` (direct
  websocket clients), and inside `surface_scan.ngc` (hand-typed MDI).
- **Unbounded list and string payloads.** `jog_cont_multi`'s `axes` was iterated with no
  length cap, issuing one `CMD.jog` per entry while holding the command lock; `mdi` text
  was passed at any length to a 256-char buffer that truncates mid-word and executes a
  different move. Both now refuse.
- **The collision sweep's clearance bound could not be computed for the TWP
  machine at all.** It read the trt-family parameter struct, which a trsrn
  declaration does not carry, so the rotary radius silently became the distance
  from the machine origin instead of the ~2 m distance from the faceplate axis.
  The bound now lives behind `KinsModel` and is certified per family by a
  property test that samples each model's real inverse; the adversarial case was
  verified to fail with the bound stubbed to zero. The old `console.warn` that
  admitted the gap is gone, replaced by a `CollisionResult.uncertified` reason
  shown on both the "clear" and the "N clashes" branches — a sweep that found
  hits is no more certified than one that did not.
- **Chunking capped the largest rotary sweep, not the total.** The ×2
  lever-drift inflation is justified by `1/(1 − rotRad) ≤ 1.65` at `rotRad ≤ 0.4`
  rad; with three rotaries turning at once the per-chunk total reached 67.5° and
  `1 − rotRad` went negative. The justification stopped holding on exactly the
  machines that sweep three rotaries.
- **One misspelled kins pin silently zeroed the kinematics.**
  `parse_kins_config` skips pin names it does not recognise and
  `kins_pivot_warning` fired only when *nothing* parsed, so six correct `setp`
  lines plus one typo left the viewer substituting 0 with no warning anywhere.
  On the nutating machine a mistyped `nut-angle` collapses the entire solution.
  The warning now names the missing pins.
- **The sim pose paired a live switchkins mode with a parse-time plane.** The
  TWP frame reached the client only as marker comments, so a machine parked in
  TWP — the state the upstream demo actually leaves it in — entering sim took
  its mode from the machine and its plane from whatever program was loaded.
  The three kins frame pins are now sampled live, all three or none.
- **A segment model wrote fewer joints than the machine has.** `poseAt` filled
  only the joints the segment's model drives (trsrn hardcodes six), leaving any
  tail from a preceding segment's model in place — a stale pose on a machine
  with more than six joints.

---

## W8 live acceptance (2026-08-21, LinuxCNC 2.9.4)

The TWP config was booted and the gateway gate run on it. Three defects only a
live boot could have found, all fixed before this record:

- **The documented `halcompile` precondition could not work.** It pointed at
  `scripts/kins_oracle/xyzacb_trsrn.comp`, which is the fixture ORACLE and
  tracks current LinuxCNC master; 2.9's halcompile cannot parse its
  handle-style pin API. The installable `@493926b56c` revision now ships at
  `examples/sim_config/twp/xyzacb_trsrn.comp`, with `test_kins_oracle_parity`
  comparing the two copies' kinematics statements so they cannot drift.
- **`twp-helper-comp.py` busy-spins.** Upstream's loop is a bare `while 1:`
  with no sleep, polling NML as fast as the CPU allows: 13m29s of CPU in
  13m33s of wall time, one core of four gone permanently. It starved the
  publish scenario outright. Forked to 20 Hz; 99.6% → 0.0%.
  **AMENDED (review P4):** the uniform 20 Hz fork was itself a defect — this
  record's "everything it publishes is display state" claim was wrong.
  `twp-is-defined`/`twp-is-active` are CONTROL-FLOW GUARDS remap.py reads
  (G68.2 aborts if TWP is already defined; G53.x aborts "No TWP defined" if
  not); upstream's spin made them synchronous, and at 20 Hz the
  `g69 / g68.2 / g53.3` sequence became a race the program lost roughly half
  the time — mid-run abort, machine in limbo. The loop is now SPLIT-RATE:
  guard pins at ~1 kHz edge-triggered (steady state = one pin read + compare),
  NML poll + vismach passthrough at 20 Hz. Measured on a live session: ~0.9%
  of one core. The full perf-matrix gate has not re-run since the split (the
  recorded W8 matrix covered the 20 Hz build; a matrix run needs a suite
  restart) — run it at the next restart; the sub-percent CPU and a full live
  TWP acceptance run (twp_parity truth/compare) both ran clean beside it.
- **`OPEN_FILE` pointed outside `PROGRAM_PREFIX`**, so the config booted with
  no program and `load_file` refused the path.

**Gate result.** Full matrix on the clean boot: zero lag windows in all nine
scenarios; `sigstop_trip` `sticky_ok` + `recovered_ok`. `preview_publish`
re-run to a real delivery (`delivered: true`, publish wait 8.5 s, RSS
130.8 → 172.0 MB — both inside the historical 7.4–14.2 s and 169–207 MB
bands). Reader cost with the three new TWP frame pins: pin-read avg 0.05 ms,
max 0.20 ms against a 5 ms threshold, zero `reader.tick_slow`.

**A precondition worth writing down, because it cost two vacuous runs.**
`preview_publish` needs an armed client, and `arm` is refused while a safety
trip is unacknowledged. With no armed client holding heartbeats the HAL chain
trips within seconds — so acknowledging the trip and then *disconnecting*
before starting the matrix re-trips it, and every later `arm` fails with
"Safety trip not acknowledged", surfacing as `reply_error: 'Not armed'`. The
delivery assertion (d0b43d8) caught both runs and refused to report their
numbers, which is exactly its job. The fix is to hold an armed, heartbeating
client for the duration of the run.

**Live behaviour confirmed on the shipped config:** `viewer_init.kins` reports
`xyzacb-trsrn` with all seven pins and no config warning; a preview of the
upstream demo emits `kins_frames = [-1.781761556, 130.245476621,
-40.855497803]`, matching the phase-3 live task run to six decimals, with every
segment typed TOOL/plane, `wcs_used = [6]` and
`violations_world_unchecked: None` — the trsrn twin checked every segment.
**CAVEAT (review P4):** this paragraph was a clean bill for the marker/twin/
limit plumbing only. On the same program, at the time it was written, the
rendered preview sat ~1 m from the machine path (the per-segment-WCS defect
below, then open) and the flip segments carried the phantom jump — an
acceptance record must say which layer it certifies.
- **Every negative jog was silently clamped to zero velocity.** W3's payload
  schema declared jog `vel` as `Num(lo=0, …, clamp=True)` — reading it as an
  unsigned slider. It is signed: the UI sends `vel = v * dir`, and for
  `jog_cont` the sign IS the direction. So `lo=0` turned every negative jog
  into `vel 0`, and because continuous inputs clamp *silently* by that same
  W3 policy, the button moved nothing and said nothing. Both jog modes, every
  axis, every machine. The bound was always meant to cap the SPEED, so it must
  be symmetric (`lo = -max`). **A magnitude cap on a signed field cannot be
  written as `lo=0`** — and the spindle-speed entry immediately above it in
  the schema, where `lo=0` is genuinely correct because a negative there is a
  direction *error*, is very likely what made the wrong shape look natural.
  Operator-reported; reproduced and verified live.

---

## Open — found by operating the TWP machine (2026-08-22)

### The preview does not match the machine on a TWP program
**FIXED 2026-08-22 (review P2, 3003dcf + 24137b5 + 8869513), verified against
the LIVE machine.** Per-segment WCS epochs: the canon snapshots the effective
basis at every motion (`wcs_events` — sampled in the same `_next_seq` call
that stamps the segment, so per-epoch subtraction is per-segment exact by
construction), the extraction subtracts each endpoint's OWN epoch basis, and
`wcs_frames` rows ship what to re-add — the live table row of the epoch's
fixture, or the parse snapshot for program-REWRITTEN epochs (the `rewritten`
flag; a G10 L2-written fixture's live row is not authoritative). Acceptance
(`scripts/twp_parity.py` on the live TWP sim, `simple_example.ngc`, TLO 22):
derived-vs-truth JOINTS max |Δ| 0.2651 mm (tol 0.5); the machine's traced
square passed the independent invariants (sides 99.66–99.96 of 100, planar,
normal exactly the G68.2 plane). The false "outside travel" tint is retired
by recomputing the bounds boxes from the re-based display geometry.

**Status (historical):** root-caused with measurements, NOT fixed.

Operator report: the sim and the real run both disagree with the preview, and
the path draws in the warn-tinted "outside bounds" style.

Measured on `simple_example.ngc`: the parse basis is G54
(`wcs_basis_index: 1`, `g5x = [1300, -200, -1400]`) while `wcs_used = [6]` —
the program's motion happens in **G59**, because that is where `G53.x` writes
the tilted-plane origin (`G10 L2 P6..9`). The wire therefore carries plane
coords offset by `G59 - G54`, and the client adds back the *live* g5x, which
is G54. Numerically: G59 = (1609.597, -854.904, -791.098), G54 = (1300, -200,
-1400), difference (309.597, -654.904, 608.902) — and the first plane-section
vertex on the wire is exactly (309.597, -654.904, 708.901). The plane section
renders about a metre from where the machine goes, which also pushes it
outside the travel box and triggers the overflow tint.

This is the recorded parse-time-WCS limitation, but on a TWP program it is not
a corner case — `G53.x` *always* relocates the origin into G59, so it is the
normal path. Compounding it, this demo also rewrites its own G54 at runtime
(`g10 l2 p0 …` on line 2), the separately-recorded program-rewrites-WCS gap.

**Not fixed here.** The preview basis is one offset for the whole program; the
fix is per-section WCS handling on the wire, which is the item closed earlier
in this file as "Per-segment WCS (Tier 2)" — and its reopen condition ("a
program needs two fixtures visible simultaneously") turns out to understate
it: a TWP program needs two fixtures *sequentially* and is wrong without them.
That closure should be revisited with this evidence.

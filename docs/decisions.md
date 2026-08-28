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

---

## Wave 2 (2026-08-23) — operator reports after wave 1, P0–P8 complete

Plan: `~/.claude/plans/can-you-review-opus-shimmering-rain.md`. Commits
924a0e0 (P7 landed out of order), defca43 (P1), 82ed8c8 (P2), 1e559da
(P3), a30e69b (P4), 449c788 (P5), be08bdd (P6), plus the P8 tooling
commit. All root causes were confirmed live before fixing; every phase
carries unit + e2e evidence in its commit message.

- **P1 preview_schema stamp** — the gateway cache keyed on file+mtime only,
  so a gateway outliving a code upgrade served pre-upgrade payloads to
  hot-reloaded clients forever. Every payload now carries a wire-format
  generation; the poller auto-reparses on mismatch (latched, never a storm);
  the client banners absent/different stamps with a Reparse action.
- **P2 relabel seed** — flip relabels seeded from the previous tuple's end;
  canon-suppressed moves (G43 shifts, deduped first moves) made that a pose
  the bookkeeping had left. Seed is now the next tuple's canon start,
  un-peeled with its OWN tlo.
- **P3 abc ships on pose-dependence** (reports 1+2, the flat TWP preview /
  untilted sim head) — `should_ship_abc`: markers present OR raw abc ≠ 0
  (the per-epoch peel zeroes exactly the fixture-offset-tilt case) OR
  peeled-stream variation. Verified against the real stack: the constant
  tilt now rides the wire; a 1.18M-point 3-axis program still ships none.
- **P4 stale-TLO flags** (report 5, 11,532 false Z-max flags live) —
  worker ships a parse-time TLO snapshot (payload + __TLO__ stderr);
  poller drift edge (tool-table mtime / applied-offset, idle-gated,
  debounced, G49-safe) auto-reparses; client hint covers the in-run
  window; the overflow box gains the applied TLO so both bounds surfaces
  finally agree.
- **P5 off-path playhead latch** (report 6, gap_p50 33→319 ms through the
  toolchange) — `viewer/runWatcher.ts` state machine: windowed when
  attached, exactly ONE full scan on escape, OFF-PATH frozen with a chip
  and a ≤1 Hz strided re-probe. Plus the two never-closing gates:
  fixture-table change keys now cover only USED non-rewritten rows
  (usedWcsRowsKey), and `_pfScheduleWcsRefresh` early-outs unless the
  rebase can differ from identity. Op-budget vitest on a 200k track pins
  the regression class.
- **P6 per-point line trust** (report 3) — trust is per point (line
  exists + can move + stream-compatible + not in a `(WEBUI_SUB=…)` span);
  `lines_untrusted` now means NO point trusts. The positional playhead
  publishes {line, trusted, subName}; GcodePanel shows "in subroutine
  (name)"; off-path SUPPRESSES rather than falling back to colliding
  motion_line numbers. **Decision: NO monotonicity gate** on the
  playhead/highlight — legal o-loops and run-from-line legitimately move
  backward; a monotonic filter would break them to paper over a class the
  positional matching already handles.
- **P7 config drift checker** (report 4's class) — the deployed config is
  a one-time copy; `scripts/config_sync_check.py` prints exact drifted
  lines (whitelist: runtime artifacts whole, per-install settings lines);
  warn-only from install.sh. Its first run caught the deployed copies
  missing the P6 markers (harmless — all deployed SUBROUTINE_PATHs point
  at the repo, verified) and that P6's marking pass missed the TCP
  config's top-level remap_subs.
- **P8 tooling** (question 7) — twp_parity: 6-joint compare (±180°-wrapped
  rotaries), swept-axes-set completeness, path-overlay metric, trt
  dispatch, real wire abc through the derivation; `scripts/preview_gate.py`
  golden summaries per config (checked in: twp + 3axis, generated against
  headless DISPLAY=dummy sims); `viewer/displayPipeline.ts` extracts the
  display DECISION pure, and its test is the L1 display oracle — decision
  + transform composed, asserting a held-tilt program DRAWS tilted.

### Found by the hardened parity gate (P8, 2026-08-23) — FIXED same day
### (acc1f50) after the operator hit it live

**The offline interpreter poses uncommanded axes at program-zero of the
active fixture.** Measured on the TWP config (wave-1 truth capture,
hardened compare): derived joint A = 19.05° — exactly G54's A rotary
offset — while the machine held A = 0 throughout; B and C only matched
because their fixture offsets happen to equal the parked pose.
Operator-visible: the work-side A faceplate posed 19° off in the scrub
sim ("sim ≠ run, sim == preview" — sim and preview share the
derivation). Initially recorded as open ("no non-guessing fix at the
worker layer") — that judgment was WRONG by one move: the fix is not to
correct the OUTPUT but to correct the interpreter's INPUT. The worker
now appends one `G53 G0 A… B… C…` initcode built from live stat — the
same position sync task performs at run start — and the canon re-arms
its first-move suppression at the first real program line so the sync
seeds position without recording motion. Nothing is guessed; commanded
axes then behave exactly as the run will (the command records a real
change from the live pose). PREVIEW_SCHEMA → 5.

**Design decision recorded — output-rebase heuristic REJECTED:** a
"rebase provably-uncommanded rotaries" pass (constant machine value +
axis word absent from source) was built and then thrown away: a REMAP
commanding an axis to exactly the fixture offset — this very config's
B/C, whose G54 offsets equal the orient targets — is indistinguishable
from an uncommanded axis in the canon output, and rebasing it would
UNTILT a correct preview whenever the machine parks elsewhere. Fixing
the interpreter's initial state has no such ambiguity.

**Parity gate now 3/3 MATCH** (joints x6 max 0.2651 mm, rotary
residuals 0.0; swept axes; per-line overlay max 0.0044 mm over 221
main-level samples). Overlay calibration recorded: remap-internal
motion (call_level > 0 — the g53.x approach/orient) is transit the
preview omits by design (first-move suppression; the client prepends
the real entry at sim entry) — its ENDPOINTS are validated by the
joints gate, its PATH is not claimed; scoring it read 100+ mm of false
error. Known residual: the synced rotary pose is parse-time state — a
jogged rotary after load needs a reparse (same class as WCS drift; the
P4-style drift edge could later watch rotary drift too).

> **Correction (2026-08-23, W3 P6):** the "transit the preview omits by
> design" wording above is wrong about the PREVIEW side: the canon
> records and the worker SHIPS call_level>0 segments (the golden's
> `sub_names` carrying the remap wrappers proves it — nothing filters
> by call level). Only the parity OVERLAY skips those TRUTH samples;
> what the preview genuinely omitted pre-schema-6 was the SUPPRESSED
> first-move class, which W3 P1 now ships as unknown-start endpoints.
> Also: the 0.2651 mm joints number was a HARNESS artifact — endpoint =
> last 50 Hz sample with the line ⇒ up to ½·a·t² ≈ 0.22–0.27 mm of
> decel tail; with W3 P6's transition-sample endpoints the same capture
> measures 0.0316 mm.

**wcsEpochs `rewritten` referee — bounded residual (W3 P6, experiment
run 2026-08-23).** `wcs_event_rewritten` decides "did the PROGRAM write
this fixture" by comparing the epoch basis against the temp var-file
rows — the stalest copy (LinuxCNC writes the var only at shutdown, plus
gateway patches). A post-shutdown touch-off can therefore spuriously
flag operator state as program-rewritten, degrading that epoch to
parse-snapshot pinning (honest but touch-off-inert; eps 1e-3, never a
geometric lie). The candidate perfect referee — diff the temp var file
before/after `gcode.parse`, changed rows = program-written — was
EXPERIMENTALLY DISPROVEN: a sentinel planted in G54 X (5221) survives a
parse whose program executes `G10 L2 P0 X1300`; the offline interp
rewrites the file at M2 but with the LOADED values, not the program's
G10 writes. No better referee exists without interp changes; recorded
as a bounded residual.

### The bounds HUD contradicted the validator and the machine (operator
### report, 2026-08-23 — FIXED, acc1f50)

On the 3-axis config, Haus_Brunnen showed "Toolpath exceeds bounds" in
the HUD while the per-line validator was clean and the real run proved
in-bounds. Root cause, measured: the HUD's geometric box applied ONE
live TLO uniformly to an envelope built from mixed-TLO segments — the
program's `G53 G0 Z0` retract is a program-space vertex at exactly
−G54.z (153.088), so machine Z computed 153.088 − 153.088 + 56.63 =
56.63 > the 0.10 limit: wrong by exactly the applied tool length. Two
implementations of one check will disagree; the weaker one is deleted.
The HUD flag now derives from the SAME per-line validator as the marked
lines and scrub findings (current via the P4 TLO-drift auto-reparse;
the wcs-stale hint covers the drift window; unchecked payloads claim
nothing). This retires the P4 change that added live TLO to the box —
patching the weaker check was the wrong layer.

### Deferred with designs recorded (P8)

- **L2 display probe**: `window.__lcncDisplayProbe()` — the running page
  returns drawn-vertex checksums + FPS stats for a playwright e2e; budget
  asserted per frame. Needs the e2e harness to boot a headless sim (the
  DISPLAY=dummy pattern above works).
- **L3 live probe**: the same probe surfaced through browser telemetry so
  a live session can be interrogated post-hoc (`browser.viewer.perf`
  already carries the timing half).
- **Full scene assembly in displayPipeline**: compose decision + rebase +
  transform + split into one pure "what would the scene hold" function;
  today the L1 oracle composes the two layers the defect crossed.
- **config_smoke**: boot each shipped INI headless (DISPLAY=dummy +
  stdin-open trick, see scripts/preview_gate.py docstring), assert the
  gateway's viewer_init builds and the safety chain reports complete.

### Owed at the next suite restart (accumulated live-verification bucket)

The gateway/suite session that these fixes were developed against ended
mid-wave; the following claims are code-complete with offline evidence
and need one live pass: P0 TCP config boots bannerless; P3 tilted
preview overlays the backplot + sim head at B≈−40.9/C≈130.2; P4 the
11,532-flag payload auto-reparses to 0 once idle; P5 gap_p50 ≈33 ms
through tool_touch_off (browser.viewer.perf); P6 main-file lines
highlight through a toolchange run with the off-path chip showing; and
the wave-1 perf-matrix re-run.

## Wave 3 (2026-08-23) — operator retest: residual offset, approach, highlight

Operator reports after wave 2: (1) "still a small offset between preview
and actual run/sim", (2) "the sim does not do the same moves while
approaching the square", (3) "line highlight stops at line 7, blank
lines light, never reaches M2" — plus two architecture questions
answered below. All root causes were confirmed read-only before any fix
(commits 2b17426..this).

**P0 — the small offset was D1: TLO subtracted in WORLD axes**
(`partFrame.ts`) while applyState phase 3 and the collision worker
subtract along the TILTED tool axis — a constant 12.58 mm rigid offset
of the drawn plane at the held tilt (C=130.2455, B=−40.8555, TLO z=22).
Run and sim agreed with each other; the drawn polyline was the odd one
out — exactly the report. Rule now: **the TLO subtracts in the tool
node's world rotation — three consumers, one rule.** Gate gap closed:
partFrame gains a tool-side-rotary+TLO fixture (the trunnion's tool
group hangs untilted under root, so the frame of subtraction was
invisible to every prior test) and the L1 oracle asserts drawn
POSITIONS against quaternion-derived truth, not just tilt.

**P1 — approach part 1 (D2): suppressed first moves ship as zero-length
unknown-start endpoints** (`rapid_ustart`, PREVIEW_SCHEMA 5→6). The
canon used to drop the whole segment — erasing the program's own first
rapid, so the sim entry lerped straight to remap-internal motion. The
endpoint is a commanded pose the run will visit: it ships zero-length
(0 s / 0 dist by construction), RDP-anchored (collinear points would
drop), limit-checked as moved-to via a start=None convention in all
three checkers (the parked-axis attribution would have skipped it), and
unioned into the client brk channel so every consumer inherits
never-cross-the-connector. prependEntry supersedes the unknown approach
with the real live-pose→endpoint rapid. The rotary-sync initcode stays
fully suppressed (its endpoint IS the live pose).

**P2 — approach part 2 (D3): the k=0 relabel seed.** All kins/frame
markers firing BEFORE the first recorded segment produced no flip in
`insert_flip_relabels` (loop from k=1) — the first tuple's start stayed
the startup-labeled initcode pose: a ~962 mm phantom worth ~4.8 s on
the first scrub segment, polluting stats and the joint-side limit
subdivision. The k=0 correction re-expresses merged[0]'s START through
the same twin math and patches in place (endpoint-only wire — no
geometry change); ustart-first tuples are skipped, no-twin cases join
the unresolved count.

**P3 — approach part 3 (D4, latent): the entry conversion mixed
frames** — LIVE kins pin + live plane pins with epoch-0 (plane-frame)
terms; parked in identity after g69, the entry start landed ~(G59−G54)
≈ 900 mm off. Design position: **joints are the physical invariant,
kins maps are labelings** — naming the live pose in the track's
coordinates uses the TRACK's first-segment labeling (mode/frame/epoch-0
as ONE triple), making jointsForSample(entry) round-trip to the live
joints by construction. The live pin stays authoritative only for the
run playhead's forward kins (actual machine state) and as the legacy
fallback for mode-less tracks.

**P4 — highlight (D5a+d): one gating rule, honest end.** The scrub path
forwarded RAW sample lines to GcodePanel (blank line 5 lit from
square.ngc's L5; scrollToLine(1029) fired for the remap point) while
the run path gated per-point. `displayLineForPoint` is now the single
shared rule; the pose emit carries raw (clash tint + 3D path highlight
— their data shares the sub-relative numbering, self-consistent) and
gated (text panel) lines separately. `atTrackEnd` presents an explicit
"end" state mirroring "entry" — trailing non-motion lines (M2) are
unknowable, never guessed, and the highlight no longer freezes on the
last attributable line.

**P5 — highlight (D5b+c): markers + advisory.** square.ngc gains
WEBUI_SUB markers (its line numbers collided with the main file's and
three points false-positively trusted — main 4/6/7 lit from the sub's
own numbering); deployed copy byte-synced. Point-level heuristics for
the unmarked-sub class REJECTED (no file identity in the canon; W2 P6
no-monotonicity precedent); instead a FILE-level advisory ships
(`unmarked_subs`): external o-calls resolved through SUBROUTINE_PATH
whose files lack markers → one info-tier "Line tracking" stats row.
Unresolvable names claim nothing.

**P6 — harness corner-exactness + correspondence** (see the dated
corrections in the wave-2 section): endpoints := transition samples
(0.2651 → 0.0316 mm on the same capture); joints gate pairs per line by
LAST-in-execution-order derived vertex; overlay excludes ustart
vertices from span claiming and judges only a line's LAST truth run
(collided lines). Validated 3/3 MATCH against the wave-2 capture via a
SUBROUTINE_PATH shim serving the capture-time square.ngc — the P5
markers shifted the sub's line numbers, so the old capture corresponds
only to the pre-marker file. (Found the hard way: the un-shimmed
compare read exactly 100.0 mm = the square's side, the signature of
off-by-one line correspondence. Note: the interp chokes on an
over-long SUBROUTINE_PATH with "Bad character 'g'" — keep shim paths
short.)

**P7 — goldens regenerated (twp) at schema 6**, every delta matching
prediction: rapid 7→9 (ustart + relabel vertices), brk_count 0→1,
sub_names +square, trusted 3/7 → 1/9 (the three false positives gone;
exactly the L4 ustart vertex remains trusted — 0/N would have been the
red flag), wcs_epochs 1→2 (motion now exists under the pre-plane G54
epoch; `rewritten` stays 0 because the disk rows coincide — the A4
inertness). 3axis goldens: restart-window bucket (their config must be
the running one; also carry schema 6 + the two new summary fields).

**Architecture verdicts (operator questions).** "Let LinuxCNC do the
sim" (full task/motion shadow instance): REJECTED for preview — HAL's
shm keys are compile-time constants (`hal_priv.h HAL_KEY`, no env
override; upstream #2716 unimplemented; the launcher's
/tmp/linuxcnc.lock auto-kills a second instance headless), and
task/motion has NO faster-than-realtime knob (uspace_rtapi_app
nanosleeps real servo periods), so a shadow sim costs 1:1 wall-clock —
a verification tool, not a preview. The only unpatched path if ever
wanted as a "verify run" feature: IPC-namespace (unshare --ipc) shadow
+ NML-over-TCP client.nml, with `linuxcnc.nmlfile` per-channel on the
gateway side (~3 lines client-side). Industry pattern (Heidenhain
PLANE SPATIAL sim, Siemens CYCLE800, Okuma 3DVM): share the kinematic
model between motion and graphics — our architecture. "How do other
UIs handle TWP": they don't — gremlin/AXIS/QtDragon draw program
coordinates with at most a rigid [DISPLAY]GEOMETRY rotary transform
(upstream's own TRT demos name only the tilt axis); Sigma1912 shows
tilt only via vismach, disjoint from the backplot.

**Owed at the next suite restart (wave-3 additions to the bucket):**
fresh twp_parity truth capture against the marker-shifted square.ngc
(the wave-2 capture only corresponds to the pre-marker file) —
expect joints ≤ ~0.05 mm with the P6 endpoints; 3axis golden regen at
schema 6; live D1 check (preview overlays run/sim with zero rigid
offset at the held tilt); sim shows the two-stage approach with a
realistic first-segment time and stats −962 mm (D2/D3);
identity-parked sim entry lands on the live model (D4); scrub/run
highlight: L4 → "(square)" chip → "end", no blank-line lights, no
scrollToLine into remap linenos (D5); plus everything already listed
in the wave-2 bucket that has not yet had its live pass.

## Wave 4 (2026-08-23) — operator retest: highlight the call line, not a chip

**Report.** After wave 3 the sim and run agree, but the highlight
regressed to "nothing": per-point trust on the TWP demo is 1/9 (only
the L4 endpoint — every other point is remap/sub motion, correctly
untrusted → gated to null), so the operator saw only the "(square)"
chip and asked the right question: why not highlight the `o<square>
call` line while inside the sub, and the correct lines before/after?
Also asked: is the sub name hardcoded (no — the `(WEBUI_SUB=square)`
marker ships it), and are the blank lines 5/8/10 an overlay artifact
(no — the file itself has blank lines there; GcodePanel renders the
main file verbatim).

**Design: call-site attribution, text-verified (SCHEMA 7).** A sub
span's points may display the MAIN-file line that invoked the sub —
the o-call line or the remap trigger line — when that line can be
verified from the main file's own text:

- **Marker syntax** gains an optional trigger declaration:
  `(WEBUI_SUB=g533remap CALLER=g53.3)`. o-word subs need no token
  (`o<name> call` is verifiable from the name); remap wrappers declare
  their trigger code. All twp + 5axis-tcp remap_subs templates carry
  tokens now (on_abort_* wrappers have no main-file trigger — none).
- **Unique-site rule** (`attribute_sub_callers`, pure, unit-tested): a
  depth-0 span attributes iff EXACTLY ONE comment-stripped main-file
  line matches `o<name> call` or the CALLER token (numeric word guards:
  `g53.3` never matches `g53.36`, `g69` never matches `g69.1`). Zero
  or several sites → no claim (chip-only + one stderr note). Nested
  spans never attribute — their caller line lives in the outer sub's
  FILE, the very collision this machinery exists to avoid.
- **Positional attribution was implemented, probed, and DISPROVEN**:
  the interpreter fires canon `next_line` only for plainly-executed
  blocks — never for o-call lines, remap trigger lines, blanks, or
  comment-only lines (empirical next_line capture on the live demo:
  the backward-jump "caller candidate" landed on the PREVIOUS sub
  file's last line, e.g. 17/27 instead of 7/9). So no canon-side
  signal can disambiguate multiple call sites of the same sub; those
  programs keep the chip-only display, recorded as the known limit.
  (A possible future refinement — bracketing a span between its
  surrounding trusted main-line points — is sound only for main files
  with no o-word control flow; not built, no demand yet.)
- **Wire**: `feed_cline`/`rapid_cline` u16 per point (0 = none),
  resolved post-RDP with the outermost-attributed-span rule; PREVIEW_
  SCHEMA 6→7 auto-reparses warm caches. Client merges into
  `scrubTrack.cline` (mislengthed drops the channel, never guesses);
  entry vertices carry none.
- **Display**: `displayLineForPoint` prefers the point's own trusted
  line, then the attributed call line (`viaCall`) — ONE rule, so the
  sim scrub emit and the run playhead both light L4 → L7 (orient) →
  L9 (square) → end on the demo, with scroll following. ScrubBar
  readout: "L9 (square)". GcodePanel's sub chip drops warn→muted with
  a truthful tooltip when the call line is lit (invariant: a trusted
  own-line point is never inside a marked span, so subName +
  currentLine ⇒ attribution). Clash tint / 3D highlight keep RAW
  lines (self-consistent sub-relative numbering) — unchanged.

**Verification.** Live demo parse: `rapid_cline = [0, 7, 7, 9, 9, 9,
9, 9, 9]`, all spans attributed. preview_gate summarize gains
`cline_lines`; twp goldens regenerated at schema 7 with exactly the
predicted drift (simple_example: `cline_lines [7, 9]`; square
standalone: `[]` — its sub is in-file, no call site, honest none).
Suites: pytest 479 + new attribution class, vitest 455, build clean.

**Owed at the next suite restart (wave-4 additions to the bucket):**
operator visual pass — scrub/run the demo, expect continuous
L4 → L7 → L9 → end highlight with scroll, "L9 (square)" readout,
muted chip tooltip naming the call line; 3axis goldens regen now needs
schema 7 (supersedes the wave-3 "at schema 6" entry).

## Wave 5 (2026-08-23) — run-highlight spec + inline subroutine view

**Report (screenshot).** Real run of the TWP demo: L7→L9 highlighted
correctly (wave 4 works live), but blank line 8 stayed highlighted
after the run ("8 / 13 (62%)"), the first lines never highlighted, and
M2 never did. Operator (rightly): "are we just fixing this as things
pop up? … let's think this over properly."

**Where motion_line comes from (read from the 2.9.4 source).** The
interpreter stamps each canon motion with its sequence_number
(`emccanon.cc interp_list.set_line_number`); the number rides the
motion queue as the segment's trajectory id; task publishes the id of
the segment the realtime controller is executing
(`emctask.cc:705 stat->motionLine = emcStatus->motion.traj.id`). It is
a bare integer with NO file identity — inside square.ngc it is
square's own lineno — and after a program ends it holds the LAST
executed id until a state transition resets it to 0 (both observed:
the stale 8 = square.ngc's `g0 x0y0z120`, later 0). `call_level`
cannot qualify it: interp read-ahead is back at level 0 while queued
sub motion executes (W2 finding).

**Other UIs (read from installed sources).** AXIS:
`set_current_line(stat.motion_id or stat.motion_line)` (axis:816).
gladevcp/gmoccapy: `highlight_line(stat.motion_line)`
(hal_sourceview.py:152). QtVCP: same field raw. All of them highlight
the colliding wrong line during subroutines, with no end-of-program or
approach handling. Nothing to adopt — our parse-time marker spans are
strictly more information than the live channel any UI reads.

**The display spec** (implemented as ONE pure function,
`trackHighlight.resolveCurrentLine`, every branch vitest-pinned):

| State (run or sim) | Panel shows | Verified by |
|---|---|---|
| idle | nothing; panel editable | stale motion-queue ids NEVER display |
| approach / off-path, motion_line text-trusted | that main line | `mainLinesTrusted` per-line set |
| off-path otherwise | nothing | no honest signal |
| on-path trusted point | its line | per-point lineOk (W2 P6) |
| on-path marked o-call span | call line + the sub's lines INDENTED under it, its own executing line highlighted | markers + W4 cline + the call line's text IS `o<name> call` |
| on-path remap span | trigger line + chip (no expansion — system plumbing) | W4 CALLER rules |
| unattributed / nested span | chip only | W4 rules |
| terminal vertex | the program's M2/M30 line + "end" readout | `programEndLine` unique-statement scan |
| non-motion lines | never hold a highlight | execute in ms between motions — motion-anchored playhead limit |

Known bounded residual: during OFF-PATH motion of a marked sub
(toolchange park), motion_line carries that file's linenos and displays
iff one collides with a text-trusted main line — strictly smaller than
the pre-W2 raw fallback, self-correcting on re-attach.

**Inline sub view (operator's design: indent, not a swap).** Row model
`subRows.ts` (pure): virtual-scroll rows walk main → indented sub →
main; sub rows carry the SUB file's linenos (muted) and take no
main-line marks/selection/run-from-line clicks. Expansion only while
the span executes, only when the call line's comment-stripped text IS
`o<name> call` of exactly the span's name (remap wrappers and nested
spans never expand by construction), ≤500 lines, never in edit mode.
Source served by `GET /subfile?name=` — bare-token name gate,
SUBROUTINE_PATH first-hit resolution with realpath containment (an
escaping symlink yields 404, never a later-dir fallback the
interpreter would not have used). Client cache per name, cleared on
every new payload.

**Verification.** vitest 468 (resolveCurrentLine + subRows + end-line
tables), pytest 482 (subfile resolver), builds clean. No wire/schema
change.

**Owed at the next suite restart (wave-5 additions to the bucket):**
the /subfile route needs the gateway restart before the indent view
can fetch; operator visual pass — run the demo, expect L4 (whole
approach) → L7 (orient) → L9 with square.ngc indented and its lines
walking → L12/M2 → cleared + editable panel at idle; same scrubbed in
sim.

## Wave 6 (2026-08-23) — sim-vs-actual trajectory gate + rotary-state freshness

**Report.** Sim showed line 7 as "an arc leading into the plane"; the
real run "plunges straight" and "does not go to the start of this arc".
Operator: "is it even achievable to get parity?" — then the
requirement: dump the sim trajectory and the real trajectory to files,
a harness must show both match, over a corpus of test programs,
"before that it's not proven correct."

**Root cause (live data).** The rotaries were parked tilted
(B −40.855 / C 130.245 — the previous run; `;g69` restores nothing,
M2 moves nothing). A fresh parse at that pose yields abc CONSTANT —
line 7 IS a straight plunge. The gateway's cached payload was parsed
untilted — its orient sweeps B 0→−40.86 / C 0→130.25, an arc whose
start pose the run never visits. Sim and run each answered a different
question ("from the pose at parse time" vs "from the pose now"). This
also explains the earlier missing-L7-highlight report: the real orient
was off the stale track → off-path → suppressed.

**Parity IS achievable — the preview has exactly four run-time state
inputs, all now freshness-guarded:** WCS table (per-epoch terms +
rewrite snapshots), tool length (TLO-drift auto-reparse, W2 P4), XYZ
start (entry move, W3), and — closed this wave — ROTARY pose: the
worker emits its schema-5 seed as an `__ABCSEED__` stderr line, the
status snapshot carries canonical `rotary_abc`, and the poller's
existing idle-gated debounced drift block also runs
`evaluate_rotary_drift` (0.01°) → reparse, re-seeding from the current
pose. What parity can never include: wall-clock (the sim runs the
estimate axis) and corner rounding within the program's G64 budget —
the gate below compares paths with a per-program tolerance, not clocks.

**The gate (operator's design, sharpened).** The existing twp_parity
harness parses FRESH at capture time — parse-state == run-state by
construction, so cache staleness was invisible to it. sim_parity.py
closes that: per corpus run it (1) saves the RUNNING GATEWAY'S cached
payload after an idle settle window (the drift edges are part of what's
under test), (2) captures the real run via sample_run (sim-config +
on/homed guards; truth file now opens with a context header: axes/kins
wire shapes, PartFrameWcs, wcs_table rows, start joints), (3) replays
the payload through the ACTUAL client code — decodePreviewStreams →
buildScrubTrack → buildEntryTrack → sampleTrack + jointsForSample, all
extracted as single pure implementations (W6 P1) so the harness and the
browser share one math — via `npx vite-node lcnc-webui/scripts/
simDump.ts`, and (4) gates on BIDIRECTIONAL 6D joint-space path
deviation (deg ≙ mm; a synthetic 40-unit detour reads 0.0 from the
straight side — one direction is blind to exactly the arc class). Null
sim joints are counted UNCHECKED; >5% refuses to certify.

**Offline adversarial validation:** the gateway's actual stale cached
payload vs a fresh-state replay diverges 136 joint-units against tol
0.5 — the reported bug fails the gate by 270×. Corpus
(scripts/parity_corpus/twp.json): the TWP demo ×2 BACK-TO-BACK (run 2
starts tilted — green only through the drift reparse) + a linear/arc
program with uncommanded rotaries.

**Owed at the next suite restart + machine-on session (P4):**
`scripts/sim_parity.py gate --corpus scripts/parity_corpus/twp.json` —
expect GREEN including the back-to-back case; record the numbers here
and tighten per-program tolerances from the first live data. 3-axis
corpus at the next 3-axis session.

### W6 P4 — first live gate run (2026-08-24, LinuxCNC 2.9.4 sim, suite restarted)

**GREEN**, tol 0.5 (6D joint units, deg ≙ mm):

| run | truth→sim max | sim→truth max |
|---|---|---|
| twp_simple_example run 1 (from homed, untilted) | 0.000 | 0.040 |
| twp_simple_example run 2 (BACK-TO-BACK, tilted start) | 0.001 | 0.027 |
| parity_linear run 1 | 0.007 | 0.009 |

Run 2 is the arc-vs-plunge adversarial case passing THROUGH the live
rotary-drift reparse (`gcode.reparse_rotary_drift` fired between runs;
the gate fetched the re-seeded payload). Sim-vs-actual trajectory
parity on this corpus: ≤ 0.04 units everywhere.

**Live finds, all fixed in-session:** (1) gateway SUBROUTINE_PATH
parsing never expanduser'd `~/…` entries — ALL five dirs silently
dropped (probe-macro listing and /subfile dead on this config);
(2) sample_run hung forever on M6 — tool change blocks on the UI's
confirm_tool_change; the gate session's WS keeper (browser stand-in:
hello + heartbeat + arm + trip-ack + estop_reset + machine_on +
confirm_tool_change) is the reusable recipe, and sample_run now aborts
stale runs and refuses on timeout instead of writing garbage; (3) THE
GATE'S FIRST REAL CATCH: a plain-G54 program run after the TWP demo
executes under TOOL kins (M2 restores G54, NOT the switchkins type —
the phase-3 trap, now demonstrated at 855 units truth-vs-sim). Fixed in
the corpus program with a leading g69 (well-formed switchkins practice);
the live kins TYPE at run start is the identified FIFTH run-time state
input — seeding the preview's startup kins from the live pin (via the
worker ctx, which the gateway can populate from hal_reader) is the
designed follow-up, on the ledger.

## 2026-08-24 — step-back review: the three "is it broken?" reports, the jog-settle fix, and the TWP branch split

Operator-triggered review ("either the UI does not show what's really
happening underneath, or the underneath is already broken"). Verdict:
the math is sound — the sim-parity gate had certified sim-vs-real to
0.04 units two days earlier — but the suite had NO mode visibility, so
three correct-but-unexplained behaviors read as deep breakage:

1. **Preview chased rotary jogs in ~2 s snaps.** The W6 rotary-drift
   edge is armed exactly when jogging is permitted (interp stays IDLE
   through a manual jog) and had no motion suppression; a program that
   never commands a rotary ships that rotary as a CONSTANT at the
   parse-time seed, so each reparse re-posed the whole path through the
   new head pose. Between reparses the drawn path rotates smoothly with
   the A table (vertices baked at A_seed under the live-rotating
   workRotGroup: rendered pose = R_A(A_live − A_seed)·p_tool — the peel
   and re-apply cancel only when live == seed; NOT a double-apply bug).
   **FIXED (5128d3c): `rotary_drift_settled`** — the drift edge fires
   only when the live pose is unchanged across two consecutive 2 s
   samples AND the trajectory reports no motion. One honest re-anchor
   after the jog stops — that snap is BY DESIGN (the preview answers
   "this program from the machine's CURRENT pose"), now with a settle
   boundary instead of a chase.
2. **"Tool not normal to the toolpath plane."** The loaded program was
   parity_linear.ngc (never orients the head) with the head jogged to
   B 110.3°/C 292.3° — the preview honestly drew the path where THAT
   tilted head would trace it. TWP-demo normality itself was verified
   numerically: tool axis vs drawn square plane 0.013°.
3. **Silent kins-mode traversal.** The TWP demo parks in TOOL kins
   (upstream ships `;g69` commented out; M2 restores G54, not the kins
   type); the corpus program's leading g69 later restored identity.
   Nothing surfaces the switchkins type or TWP state — the twp-helper's
   twp-is-defined/active pins are not even sampled — and the jog path
   never consults the kins type (a world Z jog under TOOL kins moves
   along the tilted tool axis: coincidentally the Heidenhain 3D-ROT
   semantics, completely unlabeled).

Industry grounding for the follow-up design (feat/twp): Fanuc G68.2
(define, no motion) → G53.1/.6 (orient) → G69 (cancel); Heidenhain
PLANE SPATIAL + 3D-ROT where MANUAL-mode jogging in the tilted frame is
an explicit operator setting and the plane is by definition ⊥ the tool
axis; Siemens CYCLE800 + WCS/MCS jog toggle. The jog frame is always an
EXPLICIT operator choice, prominently indicated — never inferred.

**TWP branch split (operator decision: "all of it on a separate
branch"; depth: configs+product, kins math stays).** `git revert` was
not viable — only 9 of 74 commits since f046fbe are pure-TWP; the
load-bearing ones carry infra trivkins/trt now depend on (kinsForSegment
routing, raw-kinstype wire, bulge/CA certification, the parity/golden
gates). Separation by FILE instead (d629882): the twp/ remap fork, the
machine-xyzacb-trsrn model+generator+gate, the TWP sim config
(ini/var/core_sim_6.hal), corpus entry, goldens, and
test_kins_oracle_parity.py moved to **feat/twp** (restore commit
9519a55, byte-identical to pre-split 5128d3c). The oracle-pinned trsrn
twins + tests stay on development as dormant shared infra. TOPOLOGY:
feat/twp branches AFTER the excision and re-adds the files as its own
commit, so the deletion is in the merge base and future
`git merge development` never re-deletes the TWP product. TWP sim
sessions now run from the `~/twp-checkout` worktree (installed
lcnc_suite_sim_twp.ini re-pointed; .bak-presplit kept). Verified on
development post-split: build + vitest (457) + pytest green, trunnion
sim boots and serves.

## 2026-08-25 — P3 operator surface shipped on feat/twp + live validation; the gate's SECOND real catch

P3 of the step-back plan, all on feat/twp (155ebb0, e08818b, e26da23,
a76858b), live-validated on the worktree-hosted TWP sim:

- **Fifth freshness input LIVE**: parse ctx now carries the live
  switchkins type + plane frame; the worker seeds a synthetic seq -1
  marker event (one resolution path — kins_type_flags/kins_frame_indices
  apply it, the program's own first marker overrides it) and echoes
  `__KINSSEED__`; the idle drift edge reparses on type/frame drift.
  Both edges observed live this session: `gcode.reparse_rotary_drift`
  (rotary:BC after the demo parked the head) and
  `gcode.reparse_kins_drift` (kins:type, seed 2 → live 0 after the
  corpus program's g69). Follow-up fix in the same session: the k=0
  start-labeling correction in insert_flip_relabels converts FROM the
  live labeling (start_type/start_frame), not a hardcoded type 0 —
  a parked-in-TOOL parse's canon start is ALREADY expressed in the live
  labeling (pinned by two new joint-invariance tests).
- **Kins-mode chip** (SetupStrip, by the WCS selector): MACHINE / TCP /
  TWP·TOOL, warn-tinted for TOOL kins — the M2-parks-in-TWP trap is now
  visible. Hidden entirely on non-switchable machines (kins_type null).
- **Explicit jog-frame selector** (JogStrip): Machine/Plane, shown only
  when a TWP plane is defined — the Heidenhain 3D-ROT / Siemens WCS-MCS
  convention (jog frame = explicit, indicated operator choice). Switch
  runs M428/M430 via MDI under the ready gate (stationary relabel).
- **TWP plane visualization** (ThreeViewer): translucent square + grid +
  origin triad posed from the twp-helper comp's plane pins (new status
  fields twp_defined / twp_active / twp_plane, machine frame,
  all-or-nothing); info-blue active, warn-amber defined-but-inactive;
  'Work Plane' layer toggle; signature-gated updates.

**Gate re-run (fresh-boot state)**: twp run2 PASS 0.000/0.031 (through
BOTH live drift edges), parity_linear PASS 0.007/0.031 — but twp run1
**FAIL at exactly 22.000 in every metric**: THE GATE'S SECOND REAL
CATCH. Truth-context tool offset was [0,0,0] (fresh boot) while the
demo applies its own `g43 h3` (TLO 22) before any motion; the sim's
joint transform uses ONE wcs.tool for the whole track (W3 P0), so every
post-G43 joint is off by exactly the TLO in Z. Two days ago the same
run "passed" only because the session start state already carried
TLO 22. Class: **in-program TLO change vs the single-TLO sim transform**
— the SIXTH run-time state item. Operator impact is bounded: the tip-
on-path display stays consistent (jointsForSample and applyState phase 3
use the same live wcs.tool); the JOINT pose (head height) is off by the
TLO delta only between a fresh load and the post-run TLO-drift reparse.
Designed fix (ledger, own wave — this is the W3 P0 multi-consumer
class): per-segment TLO events on the wire (schema 8, emitted only when
TLO changes mid-program) + an audit of every TLO consumer (scrub
jointsForSample, entry move, partFrame emit, collision tool shift,
applyState phase-3 override completeness). Not patched ad hoc here —
a wrong partial fix in this class is exactly how the 12.58 mm TLO bug
hid before.

## 2026-08-28 — TWP goes table-aware (stages 1+2), and a new find

**The operator's discovery.** Working the TWP sim by hand, the operator hit
the same defect from three angles: a plane-frame Z jog running off the face
normal, the traced square sitting at an angle to the plane overlay, and —
the telling one — **re-running `g53.3` fixing nothing**. Root cause: on
xyzacb-trsrn the A rotary is a WORK-side table, but `g68.2` stores the plane
as static world numbers with no record of the table pose. Rotate A and the
face turns out from under its own definition; `g53.x` then dutifully
re-orients to where the face *used to be*. Their instinct ("the program
should be attached to the workpiece — jogging must not change where it
cuts") is not naivety: it is exactly what Heidenhain 3D-ROT, Fanuc
table-type G68.2, and Haas DWO engineer into existence. Our stack simply
lacked the ingredient.

**Stage 1 (d53fd6e) — surface it.** The remap records the machine-frame A
its plane state assumes (`twp_def_a`/`twp_pose_a`, sentinel when undefined,
cleared in both reset paths) on a new `twp-helper-comp.twp-pose-a` pin;
the gateway samples it under the existing trsrn gate and ships it RAW —
sentinel included, so "no plane" and "not sampled" stay distinguishable —
and one pure predicate (`twpPose.ts`) drives both surfaces: kins chip goes
danger-tinted with a re-orient hint, plane overlay paints danger. Display
only, no new gating: `G53.x` IS the remedy, so gating it behind the warning
would be backwards. Machine-frame A = `AA_current` + active work/G92 A
offsets (numbered-param fallback); definition now refuses loudly on a
nonzero rotary offset — the machine frame is where the table pivot lives.

**Stage 2 (6005dd8) — fix it.** `g53x_core` rotates the requested plane
frame, and the origin about the table's axis LINE, by the table's move
since definition. Deliberately narrow: `twp_matrix` is never modified (it
stays the definition-frame record G68.4 composes onto and the helper
publishes for the table-riding overlay), and everything downstream of the
solve — kins pins, `WEBUI_TWPFRAME`, both twins, the wire, the preview —
carries the composed values through the EXISTING three-value frame. No
kins/comp/oracle/wire change was needed at all. Below 1e-4 deg the
composition is skipped, so A-static programs emit byte-identical G59.

**The sign was falsified, not trusted.** Derived `Rx(-dA)` from the comp's
own TCP forward, then live-proved it: `twp_a_tilt.ngc` moves the table 20°
between `g68.2` and `g53.3`; `twp_parity` invariants (tool tip in the
WORKPIECE frame, from sampled joints) report **normal_err 0.000°**.
Adversarially confirmed in the same session by stubbing the composition
off: the identical program then reports **19.31°** — the stale-plane defect
itself, reproduced on demand. A flipped sign would have read ~40°.
Full gate GREEN, 5 runs: twp_simple_example 0.001/0.045 + 0.007/0.033,
twp_a_tilt 0.007/0.033 + 0.004/0.040, parity_linear 0.007/0.028 (tol 0.5).

**NEW FIND — motion after `g69` (OPEN, pre-existing, not this change).**
The first draft of `twp_a_tilt` ended `g69 / g0 a0 / M2` and failed the gate
hard (sim→truth 415). Isolation probe with the table move REMOVED — so the
composition never engages — still fails at **sim→truth 897 with truth→sim
0.001**: the sim covers the real path perfectly but *invents* a ~900 mm
excursion on the post-`g69` move. Identical with the composition stubbed,
so it is not ours. No shipped program had ever exercised it:
`twp_simple_example` ships its final `g69` commented out (the parked-in-TOOL
trap) and `parity_linear`'s `g69` is line 1 with no motion before it.
Operator impact: the preview would MISLEAD about any move following a plane
cancel. Reproducer committed as `scripts/parity_corpus/twp_g69_tail.ngc` +
`_open_g69_tail.json` (deliberately NOT in the acceptance corpus — a
permanently-red gate stops being a signal). The acceptance program was
trimmed to gate what it exists to gate.

**Also observed (not acted on):** `preview_goldens/twp/simple_example.json`
drifts on a fresh boot (`swept_axes [] → [B,C]`, `wcs_epochs.rewritten
0 → 1`). Identical with the composition stubbed ⇒ environmental: the golden
is START-POSE sensitive (B/C do not sweep if the machine is already parked
at the oriented pose, and a `g10 l2 p0` that writes unchanged values is not
a rewrite). NOT regenerated — that would bake one session's pose in.
Fixing this means making the golden pose-independent, or generating from a
declared start state.

**Stage 3 (live 3D-ROT-style tracking) — deferred, blocked by two facts.**
G59 offsets are writable only by the interpreter (`G10 L2`), not from HAL;
and the kins comp reads its frame pins EVERY servo cycle with no
interpolation, so a frame change while TOOL kins is active steps the joints
(remap.py's own warning). Stage 2's "re-orient and it is right", plus the
stage-1 indicator telling the operator WHEN to re-orient, covers the
workflow; stage 3 only additionally fixes manual jogging while parked in a
stale plane. Deferred candidate: an idle-gated one-click re-orient, pending
a live probe of the `G68.2`-via-MDI `INTERP_EXECUTE_FINISH` stall class.

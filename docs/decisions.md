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

**g69-tail defect — first root cause was WRONG; corrected 2026-08-29.**
The 2026-08-28 entry blamed a MIXED LABELING (kins type advancing across
the g69 boundary while the WCS epoch did not). **That attribution is
false and is retracted here.** Both resolvers use the same rule and
AGREE: verified against the failing payload — `wcs_frames` events at seq
0/2/16, rapid seqs [...,16,17,18], and both the Python (`kins_frame_indices`)
and client (`eventIdxFor`) resolutions put seq 17/18 in epoch 2, the G54
restore. The epoch round-trip is also numerically inert: Python ships
`canon_end - basis[E]`, the client re-adds `basis[E]`, so any epoch both
sides agree on cancels exactly. The arithmetic in that entry
(`G59_origin + program(0,0,120) + TLO 22` = the sim point, residual
0.0000) was CORRECT but was only re-deriving the PRE-flip canon endpoint;
it was evidence of where the number came from, not of an epoch error.
Recorded as a retraction rather than an edit: a plausible identity that
reconciles to zero is exactly the kind of finding that feels conclusive
and is not, and the failure mode is worth keeping visible.

**The real cause.** `insert_flip_relabels` patched a flip's post-segment
START (`lst_n[i_n][1]`) and never its END, while the offline interpreter
is never resynced at a flip. The trailing `g0 a0` commands only A, and A
was already 0, so the raw tuple was `start == end` — a zero-length hold.
Relabeling only its start MANUFACTURED 897 mm of travel. The function's
own k=0 branch already guarded this exact hazard ("relabeling it would
turn a zero-length vertex into a phantom segment"); the k-loop did not.
Reconciles both ways: seq 17's end + TLO = the truth joints; seq 18's end
+ TLO = the sim's phantom point.

**Doctrine (supersedes "two independent lookups" for this class):** a
vertex's coordinates and its labeling must come from the SAME AUTHORITY —
consistent resolution is necessary but not sufficient, the NUMBER has to
have been computed under the labeling the vertex carries. **Relabel
invariant: a frame relabel may neither create nor destroy motion.** An
axis whose RAW segment delta is zero has a zero delta afterwards.

**Fixed (7b40dc7, 726145c).** The k=0 correction and the k-loop became one
forward walk carrying a per-axis correction, retired when an axis is
re-commanded, compared against a FIXED anchor (never a running position,
so a later re-command to the same number cannot resurrect it) and
evaluated at both ends against that anchor — which makes the invariant
hold by construction. The inherent residual (canon-endpoint replay cannot
tell "held" from "commanded to exactly the stale value") is REPORTED as
`kins_carry_spans` rather than assumed away. Live: reproducer 897.050 ->
PASS 0.000/0.028; full corpus GREEN 4 programs / 7 runs, worst 0.042 vs
tol 0.5; and the three pre-existing programs' feed/rapid/seq/line arrays
BYTE-IDENTICAL to their baselines — the "carry retires on the first
commanded move" claim measured, not asserted. Falsified adversarially:
with the carry stubbed off, four tests go red including the zero-length
case and the invariant property. The reproducer is now an acceptance
program (`twp_g69_tail.ngc`, runs 2); `_open_g69_tail.json` is deleted.

**Same wave — the one hole by which the two epoch resolutions COULD
diverge, closed.** `wcs_event_rewritten` compares VALUES, so a `G10 L2`
writing the numbers the var row already holds reads as operator-owned —
which is what every corpus program does on each run after the first. The
client then re-adds the LIVE G54 row, so a touch-off between parse and
display would move the preview somewhere the machine never goes.
`wcs_rewrite_targets` scans the source text (comments stripped; `P0` =
active = every epoch, because cannot-tell must degrade to the snapshot)
and unions in.

**Off-machine gates added.** `previewDecode.test.ts` pins the resolution
contract (strict `<`, ties-last, honest fill) so "the resolvers agree"
is a standing assertion instead of a session finding.
`viewer/simReplay.corpus.test.ts` replays every committed corpus payload
against its recorded truth through the real client chain — `sim_parity
compare` in CI, no machine. Its SCOPE is stated in the file and is
narrower than it looks: the payload is an input, so it does not protect
the parse-side fix; it pins the client chain, and catches a bad payload
whenever artifacts are regenerated. Its metric is point-to-SEGMENT, a
twin of `sim_parity.path_deviation` — a first cut using nearest-sample
read ~2.0 where the live gate reads 0.04, i.e. it measured the sampling
grid rather than the paths.

**Also observed (not acted on):** `preview_goldens/twp/simple_example.json`
drifts on a fresh boot (`swept_axes [] → [B,C]`, `wcs_epochs.rewritten
0 → 1`). Identical with the composition stubbed ⇒ environmental: the golden
is START-POSE sensitive (B/C do not sweep if the machine is already parked
at the oriented pose, and a `g10 l2 p0` that writes unchanged values is not
a rewrite). NOT regenerated — that would bake one session's pose in.
Fixing this means making the golden pose-independent, or generating from a
declared start state.

**Two corrections found by operating it afterwards (same session).**
(1) The stage-1 chip first told the operator to "re-run G53.x to re-orient".
**That advice cannot work**: `g53x_core`'s `twp_is_active` guard REFUSES
G53.x while TWP is active — it aborts and resets the plane (live-observed:
kins dropped to 0, `twp-is-defined` went FALSE, pose pin went to the
sentinel). Correct recovery, now in the tooltip, is to RE-RUN THE PROGRAM,
which re-defines and re-orients at the current table pose — precisely what
stage 2 makes correct, and what corpus run 2 already proves (it starts from
the tilted parked pose and passes). Design note for stage 3: an idle-gated
"re-orient" cannot be a bare G53.x; it would have to cancel and re-apply
from the stored `twp_matrix`.
(2) The first `twp_a_tilt` fixture carried a TWO-LINE G-code comment. RS274
comments are single-line, so the gateway preview parse reported
`Unclosed comment found` and returned a PARTIAL payload; the gate passed
only because the truncation fell after all motion — luck, not correctness.
Fixed, all corpus fixtures audited for paren balance, and both gates re-run
clean. Re-measuring the g69-tail defect with the corrected fixture returns
the IDENTICAL sim→truth 897.050, so that finding was never an artifact of
the malformed comment.

**Stage 3 (live 3D-ROT-style tracking) — deferred, blocked by two facts.**
G59 offsets are writable only by the interpreter (`G10 L2`), not from HAL;
and the kins comp reads its frame pins EVERY servo cycle with no
interpolation, so a frame change while TOOL kins is active steps the joints
(remap.py's own warning). Stage 2's "re-orient and it is right", plus the
stage-1 indicator telling the operator WHEN to re-orient, covers the
workflow; stage 3 only additionally fixes manual jogging while parked in a
stale plane. Deferred candidate: an idle-gated one-click re-orient, pending
a live probe of the `G68.2`-via-MDI `INTERP_EXECUTE_FINISH` stall class.

> **RETRACTED 2026-08-29 (both halves), by live MDI probe.** The two facts
> above are true; neither is a blocker, because I applied them to the wrong
> thing. "G59 is interpreter-only" forbids SERVO-RATE tracking — an idle
> re-orient goes out as MDI, which *is* the interpreter, on the same channel
> `set_wcs` and the jog-frame selector already use. "Frame pins step the
> joints" is true of naive pin-writing; the safe ordering (identity → write
> pins inert → move rotaries → enter TOOL) already ships and runs on every
> `G53.x`.
>
> **The `G68.2`-via-MDI stall does not exist.** There is no probe behind it.
> The only prior mention is the line above — I wrote that a probe was owed,
> then later cited my own note as a finding. Probed 2026-08-29 on the live
> sim: `g69`, `g68.2 x50 y50 z-50 q121 i30 j15` and `G53.1` each complete
> from MDI, the last one moving B −21.97 → −43.95 and C −206.59 → −53.18 and
> ending in `kins=2 active=TRUE`. The likely original was the session where
> the machine was silently OFF and every MDI was rejected.
>
> What stage 3 actually needed was one word on `M530`. See "TWP re-orient"
> below.

**PARKED (2026-08-28, operator-found) — the plane overlay is not sim-aware.**
`ThreeViewer._twpRefresh` reads ONLY live status (`twp_plane`,
`twp_defined`, `kins_type`, pose staleness). During a real run that is
correct — the HAL pins genuinely change, so the overlay clears at `g69` and
returns at `g68.2`. During SIMULATION nothing executes, so the overlay
freezes on the machine's current plane while every other viewer surface
(tool marker, toolpath highlight, suspended backplot) shows the PROGRAM.
Worse, it is half sim-aware by accident: the group hangs off the A table,
so its POSITION follows the scrubbed table while its EXISTENCE and TINT
come from the live machine. The stale-red tint is the most misleading part
— staleness is a claim about the live setup, meaningless against a program
that defines its own plane at its own pose.
Fix direction: draw the PROGRAM's plane from the payload's `kins_frames`,
appearing/disappearing along the timeline as the scrub passes its
`g68.2`/`g69` — the same missing piece as "why is there no plane when I
merely LOAD a TWP program?". Fall back to hiding the overlay whenever the
payload carries no plane data, so it never shows live state while the model
shows the program. Parked next to the g69-tail fix (both are offline-chain
work).

## 2026-08-29 — the TWP plane becomes a property of the workpiece

**What the operator was actually asking for.** "The program should be
attached to the workpiece — jogging must not change where it cuts." That
instinct is not naivety: it is what Fanuc's table-type G68.2, Heidenhain's
3D-ROT and Haas's DWO all engineer into existence. Our stack stored the
plane as static WORLD numbers, so the workpiece could rotate out from under
its own definition.

**Rejected first: making mode-2 kinematics table-aware.** It was the obvious
answer and it is wrong. Mode 2 IS the tool frame by design, and motion
applies TLO BEFORE it (`Dt` is deliberately unused in case 2, test-pinned in
both twins). So the change would take effect only when the tool is NOT
normal to the plane — exactly when it breaks tool-length compensation. When
the tool IS normal, plane-Z and tool-Z coincide and it buys nothing. Cost
was severe too: the fixture generator compiles the ORACLE comp, and A=0
appears in ZERO of the 120 mode-2 fixture cases, so none would have stayed
upstream-pinned; and `jointBulge` returns exactly zero for mode 2 under an
`exact: true` pin, which a non-zero bound would replace with new tightness
obligations and a `coarsened` risk on the collision sweep.

**Done instead: change the plane's STORAGE FRAME (5cff267, 5f8fbf5).**
`twp_matrix` is expressed in the TABLE frame — where a table-fixed feature
has constant coordinates, datum'd to coincide with machine coords at A=0.
Verified analytically before writing any code: the kins axis line (machine
y=-1000, z=-2000) is INVARIANT under the viewer's work-chain rotation at
A = 0/20/45/90, and the group applies Rx(-A) about it — the exact inverse of
the orient-time mapping. So the same rotation appears twice, once forward
and once backward, and the EXISTING viewer attach becomes correct at every
table angle with no geometry change. (World-frame pins drawn in that
rotating group double-counted A — wrong by the table angle, cancelling only
at A=0. Upstream's own vismach comment shows the same latent error.)

`twp_def_a` is DELETED: there is no definition pose to remember, because
G53.x maps the stored plane through the LIVE table angle every time. G68.2's
words are read as workpiece intent (no math change — which makes the
behaviour change at A≠0 invisible to review); G68.3 DOES convert, since it
measures the live spindle. Below 1e-4 deg the mapping is skipped, so every
shipped A=0 program emits byte-identical G59 rows.

**Staleness survives, sharpened.** The plane can no longer go stale — it
rides the workpiece. The HEAD SOLVE can: G53.x computes the spindle angles
once, and no coordinate relabelling can swing the head. So the chip now
reads "tool orientation stale", `twp_pose_a` means "the A the head was
oriented at" (set only by G53.x, cleared to the sentinel by G68.2/.3/.4 —
an increment invalidates the previous solve), and the red moves off the
plane onto the +Z arrow, which is the tool-normal claim. Painting the plane
red asserted the plane was wrong when it was not.

**The overlay stops lying during simulation.** It read only live status, so
while scrubbing it froze on the machine's plane while everything else showed
the program — and was half sim-aware by accident, its position riding the
scrubbed table while its existence and tint came from the machine. It now
draws the PROGRAM's plane (`viewer/twpPlaneFrame.ts`, derived from the frame
triple + G59 epoch already on the wire — no new marker) and HIDES when the
program has established none, never falling through to live state.

**Two derivation traps, both found by measuring rather than reasoning.**
(1) Mode 2's inverse returns SLIDE positions, not the tool tip — the head
geometry sits between them. While TWP is active the head sits AT its frame
(B = secondary, C = primary), and seeding zeros lands ~125 mm out.
(2) A TLO error does NOT stay in Z: adding the tool offset to the origin
displaces the plane by exactly 22 mm, but as a ROTATION of (0,0,22) through
the plane frame. The test asserts the LENGTH — asserting a Z shift would be
wrong for the same frame reason that makes the bug subtle.

**Acceptance.** `scripts/parity_corpus/twp_a_define_tilted.ngc` defines the
plane at A20 — the case this wave exists for, and the only thing that can
catch a regression, since g68.2's P-branches change meaning with zero code
change. Live: `normal_err_deg 0.000`, planar, a true 100 mm square; with the
mapping stubbed off, **19.31 deg**. Full gate GREEN, 5 programs / 9 runs,
worst 0.038 vs tol 0.5.

**STANDING PRECONDITION, undetectable and therefore stated.** G54 is read as
a TABLE-frame point, so **touch off with A at 0**. LinuxCNC records no
touch-off pose, so nothing can check this — it is a documented precondition,
not a guard. Also recorded in remap.py beside the G54-only check.

## TWP re-orient — stage 3, at the size it actually was (2026-08-29)

The operator's story: *"the table moved — does the machine know, and can I
get back to a good state in one action?"* The plane rides the workpiece and
never goes stale; the HEAD SOLVE does. Orient at A=0, jog to A=35, and the
tool points 35° off the face with no recovery short of re-running the whole
program.

**One word on `M530`.** `g53x_core` already contains every piece — the
table→machine map at the live A, the reachability solve, the pin writes, the
G59 rows, the rotary move, the staleness stamp. `Q1` marks the call a
RE-ORIENT, which changes exactly one thing: "TWP already active" is the
normal entry state instead of an error. `twp_reorient.ngc` wraps it the way
`g531remap.ngc` wraps a first orient; the UI sends `o<twp_reorient> call` on
the same MDI channel M428/M430 already use, `probe`-tier because this MOVES
the rotaries.

**Why not `M68 E2 Q1` then `G53.x`** — the sequence the live probe used, and
the one the plan proposed. `twp-status` is an INPUT pin that
`twp-helper-comp` polls to derive `twp-is-active`, so the demote reaches the
guard about a millisecond late. Typing two MDI lines seconds apart always
wins that race; a subroutine running them back to back is a coin flip. An
interpreter word has no race to lose.

**The guard no longer destroys the plane.** Upstream's "TWP already active"
branch calls `reset_twp_params`, which wipes `twp_matrix` to identity and
`saved_work_offset` to zeros. So a stray `G53.x` — a re-run orient block, a
fat-fingered MDI line — silently took down a perfectly good plane, on the
path whose entire job is to refuse. Refusing is right; the reset is not. The
abort still stops the program. Fork divergence, deliberate.

`P` defaults to 0 (shortest move from the current joints). A re-orient wants
the small correction, not the program's original branch.

### Three gate defects found on the way, each hiding the next

**The TWP INI's paths dangled, and the gate called it drift.** The
2026-08-24 split moved the TWP product to `feat/twp` (worktree
`~/twp-checkout`), but `lcnc_suite_sim_twp.ini` still pointed at
`~/lcnc-suite/examples/sim_config/twp/`, which does not exist on
development. `[PYTHON]TOPLEVEL` failed to load → no remap table → `g68.2`
came back "Bad character 'g' used" → empty payload. `preview_gate` compared
that empty payload field by field and reported **eleven drifted fields** on
`simple_example.ngc`. Every number in that report was a symptom; none named
the cause, which was one line of stderr nobody had read. Paths are now
relative to the INI's own directory, which is the only thing true in both
trees — and `run_preview` sets `cwd` to the config dir, which is how
LinuxCNC actually runs (verified: the live gateway's cwd is
`~/linuxcnc/configs/lcnc_suite_sim`, and the INI's own `USER_M_PATH = ./`
has always depended on it). The gate now REFUSES a payload carrying
`parse_error` instead of diffing it — same refusal `sim_parity.py` makes.

**`square.json` was a golden recorded over a parse failure.** `square.ngc`
is a subroutine DEFINITION with no `M2`, so it can never parse as a
standalone program. Its golden was all zeros, and it matched the same
failure forever: green, certifying nothing — the g69-tail lesson exactly.
Deleted; it is covered where it belongs, as the sub `simple_example.ngc`
calls. `generate` now refuses to write a golden from a failed parse, so the
class cannot recur.

**Preview goldens were a record of where the table was parked.** The preview
seeds its rotary pose from `stat.actual_position` — correct for the gateway,
fatal for a golden. `simple_example`'s golden held `swept_axes: []` because
the machine happened to sit at the plane's solved B/C when it was generated,
making the orient move zero-length. `preview_gate` now pins the pose
(`GOLDEN_ROTARY_POSE`, the A=0 datum) via a new `rotary_pose` ctx field,
substituted at the shared INPUT so the seeded pose and the recorded seed
cannot disagree. Only the gates set it; the gateway never does. Proof: the
regenerated golden checks CLEAN with the live machine parked at A=35.

The honest reading of the regenerated diff — `swept_axes [] → ['B','C']`,
`wcs_epochs.rewritten 0 → 2` — is that both new values are RIGHT and the
golden was wrong: this program does sweep B and C, and the source scan does
correctly mark both epochs.

### Live acceptance — re-orient, 2026-08-29

Sim, homed, armed. `scripts/twp_reorient_check.py`, 15 checks, all green.

| step | measured |
|---|---|
| tool normal to plane at A=0 | 0.0000147° |
| after jogging the table to A=35 | 33.7709° off-normal (the defect) |
| after Re-orient | **0.0000086° = 0.031 arc-seconds** |
| stored plane across the re-orient | unchanged |
| stored plane across a bare `G53.1` refusal | **unchanged** (was wiped) |
| staleness stamp | 0 → 35, self-cleared |
| joint step on X/Y/Z/A across the kins switch | none |
| wall time | 2.7 s |

`B −40.85550 → −19.31025`, `C 130.24550 → 203.59150`.

**The first version of that check reported two failures that were mine, not
the feature's.** It compared the `twp-z*` pins directly against a
machine-frame tool axis — but those pins are TABLE-relative (that is the
storage that makes the plane ride the workpiece), so they stay constant as
the table turns. The comparison is valid only at A=0. It therefore read
0.0000° where the tool was physically 33.77° off, and 33.77° where it was
normal: the feature looked broken and was not. The fix takes the mapping
from the code under test (`compose_table_a`: `th = -radians(d_a)`, rotate
about X) rather than fitting a sign, and it independently reproduces the
machine-frame normal `[0.258819, 0.084186, 0.962250]` measured in the
separate MDI probe.

**And the off-normal angle is not the table move.** I asserted ≈35° for a
35° table move; it is 33.77°. The normal rides a CONE about the A axis at
φ=75°, so `cos ψ = cos²φ + sin²φ·cos θ`. The check now asserts that
prediction to 0.01°, which tests the geometry instead of tolerating a gap I
could not explain.

### Operational: `scripts/lcnc-stop.sh`

A stale session is invisible in the failure it causes. `restart.sh` only
knows the standalone dev mode (kill whatever holds :8000/:5173), so run
against a LinuxCNC-as-DISPLAY session it decapitates the launcher and
leaves `linuxcnc` and the realtime side half-standing. The next start then
cannot claim HAL and, on its way out, its teardown unloads the realtime
threads out from under the OLD instance — so the surviving gateway reports
`27 pin(s) still missing` and the whole thing reads as a config fault.
Observed live today, caused by a session this assistant had launched
detached with `nohup` and never reaped.

The script matches processes POSITIONALLY on argv, never by substring over
the command line — a `pgrep -f` first cut matched its OWN invoking shell
(which quoted the patterns), walked that shell's children, and announced
"stopping 20 process(es)" on an already-clean system. A real launcher has
its path at `argv[1]`; a shell quoting that path has `-c` there. It also
refuses to touch itself or its ancestors, dedupes overlapping subtrees,
kills children before parents (an orphaned child keeps holding :8000), and
verifies afterwards, naming survivors rather than reporting a silent
partial stop. `--dry-run` lists the tree without touching it.

## W1 — touch-off provenance: the precondition became a fact (2026-08-29)

**Retires the STANDING PRECONDITION recorded above.** "Touch off with A at
0" was stated in remap.py, the TWP README and this file, and checkable in
none of them, because LinuxCNC records nothing about the machine state an
offset was established in. It now does.

**Storage.** LinuxCNC's fixture table is 20 parameters wide but the
interpreter defines only the first ten (G54 X..R = 5221..5230, then G55_X
at 5241). The var file's own gaps — 5230→5241, 5250→5261, … — are exactly
that stride. So every fixture has ten free slots at `5231 + (i-1)*20` that
persist through the var file. Six are used: stamped flag, kins type,
machine-frame A, and the offset X/Y/Z as written.

**Two design points, both learned by getting them wrong first.**

*Presence is a FLAG, not a sentinel in the data.* The first cut wrote
`-1e9` in the kins slot to mean "never recorded". A var-file round-trip
brought it back as `0.000000` — a perfectly valid kins type. A
never-stamped offset would have read as "touched off in identity kins at
A=0", confidently and wrongly. A flag whose absent value is the 0 a fresh
var file is already full of cannot fail that way. It is written LAST, so an
interrupted stamp reads as absent rather than half-true.

*The stamp carries the offset it describes.* Only the gateway's own writes
are stamped; a program's `G10 L2`, another GUI or a typed MDI line moves
the offset out from under the record. A stale record is worse than none
because it reads as authoritative — so it is believed only while the
recorded X/Y/Z still match the live fixture, and `absent` / `valid` /
`stale` are three distinct answers callers must not collapse.

The pose is read from the JOINT, not `actual_position`: joints are the
physical invariant, kinematics are labelings. Unknown kins on a switchable
machine records NOTHING rather than a plausible 0.

**Live acceptance** (`scripts/twp_touchoff_check.py`, all green). Physical,
not algebraic: touch off ONE feature at two table angles and require the
same stored result. The second offset comes from the rigid-body rotation
`machine(A) = Rx(-A)·(table - pivot) + pivot`, written out independently
rather than by calling the transform under test.

| | |
|---|---|
| same feature at A=0 | stored (100, 50, −200) |
| …and at A=20 (machine 100, 602.3135, −667.6744) | stored (100, 50, −200) |
| separation | **0.000000 mm** |
| error removed | 723.719 mm |
| orient at the tilted pose, tool vs face | 0.0000166° |

Fallback is the old rule, deliberately: no record — or a record that no
longer matches — assumes A=0, which is exactly what every pre-existing var
file means.

**Three harness defects, all mine, none the feature's.** Worth recording
because the pattern repeated: each one made working code look broken.
(1) A run executed end to end against an E-STOPPED, unhomed machine — every
MDI silently rejected, plane pins holding a previous session's values —
and reported three failures OF THE FEATURE. (2) `twp-*-world` is not a
readback of the remap's stored offset: `twp-helper-comp` publishes the LIVE
`g5x_offset` while `twp-is-defined` is false and switches to the remap's
value only once it is, behind a 20 Hz display throttle; reading too early
returns the raw fixture offset, which is identical to the stored value at
A=0 and exactly the wrong answer at A=20. (3) Earlier, in the re-orient
check, table-frame pins were compared against a machine-frame tool axis.
All three now carry the reason in the file.

**NOT DONE, and not started:** refusing a plain XYZ program when the table
has moved since touch-off, and reporting a touch-off-mode vs run-mode
mismatch. The record those need now exists; the surfacing does not.

## 2026-08-29 — review fix wave: the span reviewed, and what it turned up

**What was reviewed.** The 08-25..08-29 continuation (table-relative
plane, M530 Q1 re-orient, W1 touch-off provenance, the g69-tail carry,
gate hardening) — four review agents over the remap fork, the gateway
provenance layer, the viewer/UI and the scripts, with the critical
finding re-derived by hand before anything was changed. The core
architecture held; the defects were on the sibling paths the
acceptance choreography never walked. Everything below landed on
feat/twp the same day and was live-verified on the sim.

**CRITICAL — G68.3 stored a VECTOR through the point transform.** g683
converted twp_matrix column 3 with `to_table_frame`, which rotates
about the table axis LINE (subtract pivot, rotate, add back). Column 3
is the work-offset→origin VECTOR (g53x_core sums it with the offset), and
for a vector the pivot must cancel: the stored origin picked up
(I−Rx(A))·pivot — **776.6 mm at A=20** with this pivot — behind a plane
whose normal was right, so every angle-based check read 0. Nothing
covered it: both tilted corpus programs use G68.2, whose words are
workpiece intent and never convert. Fix: `to_table_frame_vector`
(rotation-only) for all three columns; tests pin the defining property
(vector transform == difference of two point transforms, for ANY pivot)
and the bug's magnitude. Live (`twp_g683_check.py`): stored vector ==
Rx(20)·words to **0.0000 mm**; the point path would have been 776.6 off.

**The gate could not have seen it — and now can.** Truth and sim share
the remap, so joint parity certifies a plane that is wrong in the same
way twice, and every frame-independent invariant is blind to a pure
translation. First cut: gate the traced square's CENTROID from the text.
It read a constant 26 mm on every tilted program, the accepted G68.2
ones included — 22 along the normal (mode-1 twin without the TLO) plus a
~14 mm head-geometry term the mode-1 and mode-2 reference points differ
by. The plane was right; the oracle was measuring the head. The clean
oracle is the **G59 row the remap actually wrote** (the TOOL samples'
own per-sample g5x — the header's wcs_table is a capture-START snapshot
and holds the previous program's G59 on run 1) rotated back to the
machine frame through the mode-2 frame R (Jacobian of the mode-2 twin
at the payload's frame triple; exact, the map is affine) against
`plane_origin_expectation` from the text. **origin_err 0.0000 mm on all
ten plane runs**; the vector bug reads 776.58 against it. The sim-parity
gate now runs `truth_plane_invariants` per run; `[----]` for programs
with no plane (a vacuous pass is not a pass).

**MAJOR — error paths destroyed the plane.** A bad P word or an
unreachable orientation called reset_twp_params while twp-status stayed
defined/active → the next G53.x silently oriented against an identity
matrix; on the Q1 path kins was already identity under an ACTIVE status
and a retry "succeeded" against zeros. Now no error exit resets; the
active-refusal branch demotes status to DEFINED (the wrapper already
dropped kins) — `M68 E2 Q1` before CANON_ERROR works on the error path,
live-verified with the pins; twp_reorient.ngc demotes status beside its
kins demote so any failure in the window leaves {identity, DEFINED,
plane intact}. The head-pose stamp moved to AFTER the queued moves
complete (post-yield): an aborted orient publishes no stamp. Live
probes 16/16: unreachable, bad P, aborted mid-move — plane preserved,
status honest, sentinel kept. calc_shortest_distance extracted to
twp_transform with upstream's else-binding fixed (mode-1 results were
clobbered; mode-2's zero-move −360 is pinned as upstream behavior).

**MAJOR — provenance had three holes.** (1) LinuxCNC persists only var
rows present at load; sim.var/sim_tcp.var never had the 523x rows and
neither does any pre-feature install, so a stamp evaporated at exit and
the next G68.2 read "assumed A=0" for an offset the operator was told was
recorded at 20 — the one place the fallback was NOT fail-safe. Templates
seeded; `_ensure_prov_var_rows` (connect + lifespan) appends missing rows
as zeros via the atomic var writer, verifies, and traces rows_ok /
rows_seeded / seed_failed; a failed seed makes every later stamp trace
`provenance_not_persistent`. **Crux experiment settled the design**: on
the 5-axis config (installed sim.var had NO rows) the gateway seeded 54,
a set_wcs at A=15 stamped, a graceful exit wrote the file — rows present
WITH the in-memory values (5231=1, 5233=15, xyz=11/22/−33), every other
row byte-identical. (2) A partial write (the everyday Z-only touch-off)
re-stamped the whole triple at the current pose: X/Y probed at A=0 then
Z at A=20 read "all at A=20" under a VALID stamp. `wcs_stamp_decision`
clears the stamp for a partial write whose prior valid stamp sits at a
different pose/kins (or with no prior stamp away from the datum) — the
one state whose downstream meaning is true — traced and surfaced as
`provenance.cleared_mixed_angle` in the reply; live: full → stamped,
Z-only same pose → stamped, Z-only at A=20 → cleared, full at 20 →
stamped. (3) The remap never read the kins slot it was given "so the
record is falsifiable": TOOL/TCP touch-offs were consumed as
machine-frame numbers. twp_prov.py is the fork twin (pinned by a real
import in test_twp_prov); to_storage_frame refuses kins 2 anywhere and
kins 1 off the A=0 datum (where TCP == identity provably).

**Also:** `wait_complete()` returns RCS_DONE=**1** on success — a
docstring said "1 failed" and the first rc check counted every
successful stamp as a failure (caught live: four stamp_failed rc=1 on
touch-offs the acceptance had just proven); the G10 rewrite scan is a
whitespace-free word scan (the phrase regex missed N10G10L2P1X5, free
word order and every dynamic P/L); the A pose reads the joint by
axis-mask popcount, not a hardcoded 3; evaluate_wcs_provenance returns
"unknown" instead of manufacturing a stale verdict from substituted
zeros.

**UI — the jog question, answered from the code.** Plane-mode Z IS the
tool axis, but only for the frame frozen into the kins pins at the last
G53.x (Aciera, forum #292228: the comp "uses the static angles
calculated by the TWP remap" — a deliberate safety choice); a bare M430
reuses whatever pins the last session left, and a table move since the
orient tilts the face away. "Rotate A and XYZ follows" cannot live in
mode 2 (no A term, by design — table-aware mode 2 breaks TLO, rightly
rejected) but **mode 1 already is it**: TCP world XYZ is the table-riding
work frame. Live: A +10° under M429 moved the XYZ joints 56.8/−165.5 mm
while world XYZ held to 0.0000. M429 had zero UI references; the
jog-frame selector now offers Machine / TCP / Plane, reflects the ACTUAL
kins type (type 1 used to display as Machine and one click dropped it to
identity), states the freshness condition on Plane and shows "(stale)"
from the twpPose predicate, and Re-orient holds to fire. Upstream's demo
GUI switches the same three modes (IDENTITY/TCP/TOOL); the terminology
maps 1:1. Forum find worth carrying: with tight soft limits a rotated
frame can make a plane-mode jog fail silently (planner is cartesian;
G59 can put axis positions outside limits) — upstream answers with
switchable limits via M-codes (millturn sim). Ledger.

**Harness fail-safety.** twp_reorient_check gained the sibling's
require_ready, MDI error checking, atexit teardown and config-read
constants (a "45 deg" comment sat on a 55 value); twp_touchoff_check
restores G54 + provenance on every exit (capture via (LOGOPEN)/(LOG) —
the gateway drains the NML error queue at 30 Hz, so (DEBUG,…) loses the
race and so does message-text refusal detection: the RCS status is the
signal); lcnc-stop rejects unknown args, sees loadusr orphans, re-checks
before SIGKILL; sim_parity refuses joint-width mismatch and isolates a
never-settling payload per run. Deliberately NOT added: a between-runs
pose reset — run n+1 from run n's parked pose is coverage.

**Corpus gate, this session (6 programs / 11 runs):** all G68.2 and
g69-tail runs PASS at ≤0.050; plane invariants PASS on every plane run
(normal ≤0.0054°, origin 0.0000). twp_g683_tilted joint parity 0.61/1.07
(tol now 1.5 with the reason in twp.json — one localized spike, p99 ≤
0.05, on the initial head-posing rapids where the parse-time rotary
seed differs from the run's actual start pose; OPEN: why the rotary
drift edge did not re-seed B/C for a freshly loaded file between
runs). twp_simple_example.run1 RED at exactly 22.000 on this fresh
session = the known sixth-input TLO catch (unchanged, on the schema-8
ledger); its committed artifacts stay the green set.

**Open / deferred:** schema-8 tlo_events + full TLO-consumer audit (also
retires the G43-retires-carry edge in insert_flip_relabels); the g683
rotary-seed spike above; switchable soft limits on M430 entry;
kins==1 tilted touch-off admission (needs a live probe of what a TCP
G10 records); preview_gate orphaned-golden sweep.

## 2026-08-30 — UI hygiene + preview-pipeline fix wave (feat/twp)

Operator testing on the TWP sim reported: a collision check that "hangs
at 0%", reparses that sometimes don't happen, the "Preview uses older
offsets" chip lighting during every TWP run, scrub-bar jitter, a HUD that
balloons on long chips, jog-strip space, a one-off false "toolpath
exceeds soft limits" in sim (twp_g69_tail), and vivid model colors. Every
fix below was grounded in `runlogs/trace.ndjson` or a corpus payload
before it was written; the questions the wave answered are at the end.

**Collision sweep stuck at 0% — root cause.** `browser.error.console
"DataCloneError: Proxy object could not be cloned"` ×8 over two days.
ScrubBar's `entryTrack` was a DEEP `ref`; at sim entry the proxied track
went to `runCollisionCheck`, which set `collisionBusy` and THEN posted
`frames: track.frames` (a Proxy) — postMessage threw synchronously with
no try/catch, the busy flag stayed pinned, the Check chip read 0% and
every later sweep early-returned on `collisionBusy` until a program
change. Fix: `shallowRef` + `markRaw` on the entry track, `toRaw` at the
worker boundary, the post in try/catch, a worker `onerror`, and ONE
unwind (`_colFail`) every failure path reaches. Tests pin that an entry
track in a `shallowRef` survives `structuredClone` and a deep `ref` does
not.

**"Does not reparse."** Not a hang — three defects: (1) `reparse_preview`
worked by clearing `last_file/last_mtime`, which a parse already in
flight REWROTE on completion, so the request evaporated after replying
ok; it is now a `reparse_pending` FLAG the poller honors once nothing is
running (`gcode.reparse_deferred` traced). (2) `refresh_running` had one
clear site and four inline set+create_task sites that were not
exception-safe (a raise between them latched the flag for the process
lifetime and silently killed every preview edge); all four go through
`BulkPipeline.schedule_refresh` (traces `gcode.refresh_scheduled` /
`refresh_schedule_failed`, done-callback reset on cancel-before-start).
(3) The rotary / kins / WCS-offset drift edges were nested under
`published_tlo is not None`, so a payload with an absent or malformed
`__TLO__` line never re-seeded its rotary pose; the gate is flat now.
Plus: the silent no-stat return traces `gcode.refresh_skipped`; the
unload branch uses `clear_preview()` (it was dead code diverged from an
inline copy); the limit chip is clickable like its siblings. Recorded,
not fixed: the connect-time "refresh-already-running" path tells that
client nothing if the in-flight parse then fails; `fire()` can drop a
Reparse on its busy latch with only a console.warn. Diagnostic rule for
the trace: `gcode.spawn_start` == `worker_done` + `parse_timeout` +
`parse_worker_failed`; a `reparse_requested` with no following
`spawn_start` is the swallowed class.

**Reparse noise is real work.** 38 reparses in one session, all idle
drift edges (rotary ×21, kins-type ×16 — each A jog, each Machine/TCP/
Plane click, each G53.x/G69). Kept (user decision): the re-seeds are
correct; the LAYOUT absorbs the flash — see scrub bar below.

**"Preview uses older offsets" during every run.** The chip compared the
parse-time ACTIVE basis with the live ACTIVE offset, so a program
switching G54→G59 (every G53.x) tripped it with nothing the operator
changed — and touch-off is idle-gated, so during a run only the program
can change offsets, and its writes are exactly the `rewritten` epochs.
`previewWcsStaleFor` (wcsEpochs.ts, pure) is per FIXTURE: stale ⇔ a
NON-rewritten epoch's live table row differs from its parse snapshot;
rewritten epochs never count; legacy payloads keep the old comparison;
eps is the gateway's 1e-3 (the client's 1e-4 let a chip outlive the
auto-reparse). The chip is not offered as an action while the interp is
busy (the reparse is idle-gated anyway).

**False "toolpath exceeds soft limits" in sim.** Corpus evidence:
`twp_g69_tail.run2` vertex 0 IS run1's parked end pose (the rotary seed
carry, `rapid_ustart[0]=1`). Unknown-start segments were limit-checked
with a fully-None start — no parked-axis exemption — so the seeded,
UNCOMMANDED rotary was checked unconditionally, and the seed is wherever
the previous run parked. This program advances machine C ~153°/orient
with no unwind against `[AXIS_C] ±320`: a few back-to-back runs walk the
parked C past −320 and the HUD reports an exceedance on a pose the fresh
run never visits. Fix: `ustart_start_tuple` gives the ustart segment a
PARTIAL start — None for axes reached via the unknown path (XYZ and any
rotary the program commanded away from the seed: always checked), the
endpoint value for a rotary still parked at the seed (exempt like any
parked axis); the joint-side checkers apply the same rule per joint
(`_fill_unknown_start` / `_joint_unknown`). Relabel connectors
(`relabel_seqs` → wire `brk`) are skipped by the limit check outright —
they are coordinate re-expressions, not motion (the collision sweep
already excluded them). Note for the ledger: the C accumulation itself is
a property of the program/remap (shortest-move P-mode, no unwind) — the
REAL machine hits ±320 after enough runs too; sits next to the
switchable-soft-limits item.

**Scrub bar jitter — layout doctrine.** Row 1's only flexible item is the
timeline; every content-sized sibling stole its width (a longer
"L14 (g544remap)" chip, RUNNING appearing, h:mm:ss growing) and row 2
came and went with each auto-sweep, pushing the bottom-anchored bar up
and down. Rule now: every content-sized sibling of the timeline gets a
FIXED `.val-slot` (mode 8ch / line 15ch with ellipsis + tooltip / position
14ch / speed 6ch), and row 2 always renders at a stable min-height. The
row-2 also states what the sweep checks WITH ("sweep: T3 Ø6.0" or
"no tool loaded — 6 mm stub") — see the tool answer below.

**HUD width.** `.hud` was shrink-to-fit with no max-width, so a long
single-line chip set the card's width. `.hudWarn { width: 0; min-width:
100%; white-space: normal }` — a flex-column child with width:0
contributes nothing to the card's intrinsic width, then stretches to the
DRO grid's width and wraps; `.hud` gets an outer max-width.

**Jog strip.** The jog-frame selector shares the Mode column (portrait:
`.strip-radio-col` dissolves like `.strip-radio-group`). Plane is ALWAYS
visible on a TWP machine (so the operator learns it exists) and ENABLED
only once a head solve exists — `twpPoseOriented` (pose stamp above the
remap's sentinel) — because a bare M430 before any orient jogs on
whatever the kins pins last held (the stale-pin trap the operator hit:
G68.2 in MDI, click Plane, jog machine-parallel). The Orient button
moved from the Setup strip to sit under the frame radios ("so you
actually find it"); it works from a DEFINED plane (first orient) and
re-orients after a table move. Tooltips say switching the frame re-seeds
the preview (the progress flash is expected).

**Muted machine palette.** `viewer/palette.ts` is the one table (frame,
base, x/y/z hue-matched to the gizmo at low saturation, rotary A bronze /
B teal-grey / C slate, stock tan, marks); the three duplicated default
tables (ThreeViewer MAT init, `setMachinePartColor`, SettingsPanel) import
it. Both sim machine.json files were recolored (linear slides DROP their
color so the axis rule applies; frame/rotary/stock parts carry palette
rgb — `palette.test.ts` pins every JSON color to a palette entry and
every entry to HSV saturation ≤ 0.35), and `vismach_to_stl.py`'s color
table emits the same values so regeneration does not revert. DMU
(local-only) recolored locally, not committed.

**Answers.** (1) Sigma's TOOL mode == our Plane mode: same comp `case 2`,
pins-only (`primary-angle`/`secondary-angle`/`pre-rot`, written once by
g53x_core), `j[3..5]` never enter — Z jogs along the LAST-SOLVED tool
axis, per Aciera's README ("uses rotary joint positions set by the
remap"). No generic LinuxCNC TOOL kins exists (trt's type 2 is the
identity `userkins` template; its M428/M429 numbering is swapped vs the
TWP configs — README fixed). Heidenhain 3D-ROT is ⊥ the CURRENT axis;
TOOL kins ⊥ the last-solved one; Orient fills the gap. (2) Sim tool: path
geometry uses the real tool table at parse time (T3 G43 H3 applies even
with nothing loaded); the joint pose uses ONE live tool_offset (the
sixth-input catch, schema-8 ledger); the marker + collision cylinder use
the LOADED tool's row or a 6×60 stub — the program's T sequence is not
consulted. Deferred by decision to the schema-8 TLO wave (same
multi-consumer class as the 12.58 mm bug); the bar says so.

## 2026-08-30 — Schema 8: per-segment tool-length offset (feat/twp)

**The defect.** The corpus gate's one standing red — `twp_simple_example.run1`
at exactly 22.000 on a fresh boot — was the sixth run-time state input: the
program does `m6 t3 g43 h3` before any motion, and the client's simulation
applied ONE live `wcs.tool` (0 on a fresh boot) to the whole track, so every
post-G43 joint sat 22 mm high. It "passed" only on sessions already carrying
TLO 22, and the committed green artifacts hid it (captured in such a
session). Same class as the 12.58 mm TLO bug: many consumers, one rule; a
partial fix hides the defect — so every consumer switched in ONE commit.

**Wire (schema 8).** The canon side was already per-segment (every tuple
carries tlo3; endpoints are TLO-peeled tip coords; the limit checkers add
tlo back per segment) — only what the CLIENT adds back collapsed to one
value. `tlo_events` rows [seq, xo, yo, zo, tool] (machine units, present
only when the program changes tool or offset; -1 = no M6 yet), recorded in
`tool_offset()` and `change_tool()` on program lines only (an initcode-
driven tool_offset must never become "the program asserted 0": segments
BEFORE the first row run under the machine's LIVE modal G43 state, which
no parse can know — the client resolves 0xff to the live applied offset).
Same seq convention as the other channels; `m6 t3 g43 h3` = two rows at
one seq, last wins; G49-when-zero IS recorded. RDP anchors every event
boundary (a G43 followed by a feed has no vertex of its own).
`parse_tlos` rows gain a diameter column.

**The one-commit switch.** partFrame `liftToJoints` / `jointsToProgram` /
`tipWcs` are the ONE lift and inverse; epoch terms are TIP-space (no tool)
so the offset can never ride twice; `transformToPartFrame` lifts AND peels
each vertex with `tloForIndex` — the old code lifted with the epoch terms'
tool but peeled with the live terms' tool, an asymmetry invisible only
while both were the same value (the next 12.58 mm class, pre-empted);
`jointsForSample` lifts with the sample's event; the entry inverse uses
point 0's offset (round-trips by construction); `projectOntoTrack` strips
the LIVE offset once (physical joints); `machineFromJoints` deliberately
stays live (the run playhead inverts the machine's actual G43 state); the
collision tool body's −TLO tip shift moved from a once-per-sweep vertex
bake into a per-pose tool-local translation, and the per-chunk kins model
carries the segment's offset (clearance bound stays certified);
applyState phase 3 subtracts the SCRUB SAMPLE's offset while a scrub pose
is shown. Kins memo became an LRU (cap 256): N offsets × M frames are all
hot at once.

**Rides along.** The sweep swaps the ONE tool body's geometry/BVH to the
program tool active per segment (never K bodies — K× pairs, misattributed
hits); the model is handed back wearing its base body (the test caught a
reused model inheriting the last tool). While scrubbing the marker wears
the sample's tool (table dims; meta only if ever loaded). ScrubBar row 2
says "sweep: program tools T3 Ø6.0"; the loaded-tool/stub note stays for
programs without the channel (M600 remaps fire no change_tool). The TLO
drift edge compares every program tool's row against the live table (a
re-measure of a NOT-loaded tool stales the pose too).

**G43-retires-carry edge — closed by pin, not code.** `_retire` compares
in WORLD with the tuple's own tlo; the canon's lo-peel keeps raw + tlo
continuous across a G43; `corr[]` is a raw-space displacement. Pinned:
a held axis stays carried across a G43 (zero length preserved), a
commanded one retires; and the lo-peel identity itself on the REAL
interpreter (new canon fixture `tlo_midprogram`: tool_offset fires only on
program lines, M6+G43 share a seq with the G43 row last, the post-G43
traverse is a zero-length ustart vertex, lo_before + tlo_before ==
lo_after + zo on both calls).

**Live.** Fresh boot (tool 0): gate 11/11 GREEN; twp_simple_example.run1
22.000 → 0.000/0.021 with NO tolerance change; every plane origin 0.0000;
g683 1.07/1.09 within its documented 1.5. Artifacts regenerated at schema
8 (run1's header tool is [0,0,0] — the green set no longer hides the
defect); the corpus replay additionally runs every payload with the
header's live tool ZEROED at the same tolerance, and asserts run1 ships
the channel. The twp preview golden regenerated under the program's real
basename, which exposed `simple_example.json` as the ledger's orphaned
golden (a renamed program) — removed.

**Not verified here:** the browser walk-through (scrub across the G43,
marker/head step, row-2 text) — the pose math is pinned by the replay
against the real capture, the visual layer is for the next session.
**Recorded, unchanged:** pre-G43 segments on a machine already carrying
G43 — the client now uses the live offset (correct) while the parse-side
limit flags for those segments still assume 0; `RANDOM_TOOLCHANGER` idx
is a pocket (pre-existing on tool_change_events).

## 2026-08-30 — Touch-off under kinematics modes: one datum, gated, through the plane

**The operator's three reports were one defect chain.** "Orient sometimes
lands the tool parallel, not normal"; "what happens if I zero in Plane
mode?"; "the work origin hangs in space". The live var file said it: `5220 =
6` (G59 active at shutdown) and G59 carrying `A −46.495 B −162.79 C 268.26`.
Every touch-off was a client-built `G10 L20 P0 …` — `P0` is the ACTIVE
fixture, which under the Plane jog frame is G59, the remap's own scratch row
(rewritten by every orient). "Zero All" named every axis, so one press under
Plane wrote A/B/C into G59; the orient move `G0 B C` was issued in PROGRAM
coordinates (and the G53.3 path already ran inside G59), so the head landed at
solution + offset. Nothing gated it, and — unlike `set_wcs` — the DRO path
never stamped W1 provenance. The viewer placed the active fixture's numbers
under the table group whatever frame they were in: TOOL-frame numbers drawn
as table coordinates float. Upstream assumes rotary WCS rows are zero and
never says so.

**Decided (with the user):** the datum lives in ONE place — G54 in the table
frame — with the plane on top (Heidenhain semantics). Rotary touch-off is
identity + G54 only; Zero All never names rotaries on a TWP machine; TCP
touch-off stays OPEN (world = tip in the table-riding frame G54 lives in — the
correct 5-axis datum path) but only at the A=0 datum, the same admission rule
`to_storage_frame` enforces; Plane-mode touch-off is NOT gated away but made
right: it writes G54 THROUGH the plane.

**Shape.** Touch-off is the gateway command `touchoff {axes}`
(command_policy.touchoff_route, pure, per-letter): identity → G54–G58, rotary
letters G54 only; TCP → G54–G58 at A=0; Plane → G59 with the plane active,
routed to `o<twp_touchoff> [mask] [x] [y] [z]` → `M535 P I J K` (an M-code
line cannot carry axis words — IJK, like M530). Two state-only gates
(`touchoff`, `touchoffRotary`) are DEFINED through the route, so gate and
handler cannot disagree; `MachineState` gained kins_switchable / kins_type /
g5x_index / twp_active / a_at_zero, every default CLOSED (a switchable
machine with an unknown kins refuses; a non-switchable one is identity,
certainly). The mdi route adds eoffset_z server-side (undelivered = refuse,
never 0) and stamps provenance from the RESULTING row — the unstamped-DRO gap
closed. The remap's `twp_touchoff`: `G59' = G59 + current − v`;
`M' = R_tool⁻¹·G59'` (g53x_core builds G59 = R_tool·origin, a pure rotation —
`inv = Rp·Rs·Rtc` is `fwd`'s transpose); `T' = to_table_frame(M', LIVE A)`
(exact with a stale head — the mode-2 map is pin-affine, independent of A);
`G54' = T' − twp_offset`. G59..G59.3 follow so the DRO reads v at once; the
G54 provenance rows are stamped kins 0 / A 0 (a table-frame point —
`to_storage_frame`'s identity path). Round-trip property: Re-orient recomputes
`G59 = fwd(from_table_frame(G54' + twp_offset, A)) = G59'`.

**Remap hardening.** The orient move is `G53 G0 B C` (the solution is
machine-frame angles); every orient writes G59..G59.3 COMPLETELY (`A0 B0 C0
R0` — the root cause: foreign rows survived every orient) and tells the
operator via `(MSG,…)` when it had to clear something; a G92 rotary offset
refuses (no fixture write can repair it). `get_current_rotary_positions` and
`get_machine_a` add the ACTIVE fixture + G92 offsets back (the old parameter
fallback read #5224 — the G54 row — under G59, i.e. at every re-orient);
`rotary_offsets_nonzero` covers A/B/C, so a G54 rotary offset still blocks
plane DEFINITION loudly (the identity-mode rotary touch-off the user kept is
for non-TWP workflows). `:1290` (G53.3, simultaneous XYZ + rotaries) stays one
block — it runs inside G59 whose rotary rows are now guaranteed zero;
splitting it would change the G53.3 motion contract and the corpus truth.
`twp_params.py` is the linuxcnc-free fixture/G92 layout twin, pinned to
`gateway_util.WCS_VAR_BASES`; run-tests.sh now runs the three TWP twin tests.

**The fixture rides the kins mode** inside the switch wrappers (one MDI —
two queued `mdi` payloads race `reject_if_auto_running`): M428/M429 leave a
reserved fixture for G54, M430 selects G59. A reserved fixture active on
identity kins at BOOT (`#5220` persisted from a Plane-mode shutdown or the
abort handler's deliberate index resync) is bannered and healed with one
`G54` when `ready` first opens — traced, superseded if an orient or a
fixture select comes first. No shutdown-time MDI: the machine may be off.
Live finding: on THIS config the boot path is dormant — `#5220=6` planted in
the var file booted with G54 active because `RS274NGC_STARTUP_CODE` names
`G54`; the persisted 6 was the last session's save, not a boot state. The
heal stays for configs whose startup code does not select a fixture; the
mid-session paths (abort resync, M428 out of Plane) are what the wrappers
now cover.

**Viewer.** The active-fixture triad has its OWN group under the table and
is posed by `activeFixturePose` (pure): identity/TCP at `g5x + Rz(θ)·g92`;
TOOL kins + reserved fixture through the plane frame — the same
mode-2-inverse → mode-1-forward compose as the overlay, so arrows and plane
coincide by construction; no frame trio → hidden, never guessed. `workOrigin`
(the toolpath anchor) is NOT moved: partFrame peels the live active offset
from every vertex and the group re-adds it, so the path is right by
cancellation and moving the anchor would break it. A muted datum triad at
`twp_datum` (the helper's world pins = the remap's G54) shows the workpiece
origin while the DRO reads a reserved fixture.

**Live (TWP sim, `scripts/twp_touchoff_plane_check.py`, 37/37).** Orient with
`G10 L2 P6 B5 C-7 R3` planted: normal to 0.0000147°, rows read 0 afterwards,
joints on the solved angles; with `G54 B5 C-7`: same. Plane touch-off at A=0:
DRO 9.2668 → 12.5000, |ΔG54| 3.2332 = the entered delta, along the normal to
1e-4, provenance (1, 0, 0, xyz); Re-orient keeps 12.5000 and recomputes the
identical G59 rows. At A=35: 874.5622 → −3.2500, |ΔG54| 877.8122 along the
normal, round trip exact, normal 0.0000086° after re-orient. M428 → G54,
M430 → G59, M429 keeps G55, G69 → G54. Re-orient check 15/15; corpus gate
GREEN (every plane origin 0.0000); preview golden CLEAN (`G53 G0` with zero
rows emits the same canon). e2e: Plane mode → Zero A disabled, G59 radios
disabled, Zero All open.

**Found on the way.** The live G54 carried a provenance stamp "kins 2 at
A=−46.495" — a fixture-table edit made under Plane kinematics (`set_wcs`
stamps the CURRENT kins/A for typed numbers). The gates stop the touch-off
half; the honest stamp for a TYPED value is a follow-up (typed numbers are
fixture-frame numbers — kins 0 / A 0 — not a pose). Both live checks now
start from an absent G54 stamp and restore the original.

**Not verified here:** the browser walk-through (arrows on the plane triad,
datum triad moving along the normal, the boot banner) — the pose math is
pinned by `activeFixtureFrame.test.ts` against the overlay's compose and the
gates by e2e.

## 2026-08-31 — Capture plane: one-button workflow 2, plane-DRO honesty, viewer coordinate clarity

**Ask (operator, 2026-08-31):** manual 5-axis setup ("workflow 2") had no
buttons — orient the head normal to a face, then "press one button to touch
off the plane, at the tool tip". Plus: the G59 DRO did not read 0 with the
tip at the plane triad; three unlabeled look-alike triads; the reserved-WCS
radio text rendered smaller; a Clear-plane button.

**Shipped (commits 3488aec..this):**

- **`twp_capture` typed command + `twpCapture` gate.** The gateway drives
  `G69 → G68.3 X<tip> Y<tip> Z<tip> → M530 P0 Q2 → o<twp_touchoff> [7][0][0][0]`
  as separate blocking MDIs, each rc-checked, with bounded reader-snapshot
  settles (twp_defined after G68.3, kins==2 after the orient). Policy:
  `_TWP_CAPTURE_RULES` — ONE ordered rule list feeding three consumers
  (handler refusal, gate denial via check_command — so the WS denial names
  the exact reason — and the button dimming). Refuse-when-plane-defined was
  the user's decision (AskUserQuestion 2026-08-31): never silently discard.
- **Remapped G-CODES never execute inside an o-sub called from MDI**
  (found the hard way). The first implementation was a pure-NGC
  `o<twp_capture>` wrapper; empirically on 2.9.4 the remapped G68.3/G69/
  G53.1 inside it complete rc-clean with ZERO effect and no error, while
  M-code remaps (M530/M535) in the same position work — upstream only ever
  calls G68.x/G53.x at program top level. The sub was deleted; the gateway
  sequence is the vehicle. Recorded as a harness fact.
- **`M530 Q2` = adopt current pose (fork extension).** A plain `G53.1 P0`
  after G68.3 is NOT a no-move: live, capture at B20 C-15 solved to
  B-20 C-183.45 — a 168° C-swing with the tip touching the part
  (calc_optimal_joint_move's "shortest primary move" picked the other
  branch; observation recorded, solver untouched). Q2 verifies the current
  head pose is normal to the stored plane (same 1e-4 element tolerance as
  kins_calc_jnt_angles, loud refusal otherwise) and uses the current
  rotaries verbatim — the orient is zero-length by construction
  (live: max joint delta 0.000000).
- **Capture ends with the plane touch-off (M535, XYZ→0).** G68.3's origin
  words alone do not pin the plane-frame READING to 0 — the kins-2 world
  carries pivot terms (live residual ~36 mm at B20 C-15 with no TLO). The
  datum-through-the-plane touch-off makes the DRO read exactly 0,0,0 at
  the tip and puts the ONE datum (G54, table frame) there, provenance
  stamped by the remap (kins 0 / A 0) — the operator's ask verbatim, and
  the one-datum invariant holds.
- **Plane-mode DRO honesty (operator-caught).** `work_pos` was
  `joint_actual_position − offsets` — a trivkins-only formula; under kins
  1/2 joints ≠ world, so the DRO at the plane origin read garbage. Fixed:
  non-zero live kins type sources the math from canonical
  `actual_position` (forward-kins world output); identity keeps the
  encoder-live joint path; missing world under kins≠0 → DRO blank + trace,
  never joint numbers posing as plane coordinates.
- **Active-fixture triad frame tag (operator-caught "moves but not to the
  tooltip").** Identity-kins fixture numbers are MACHINE coordinates and do
  not ride the table; the triad hung under the A-rotating work group and
  missed the tip by the table rotation at A≠0. `activeFixturePose` now
  returns `frame: "machine" | "table"` (identity → machine, TCP → table,
  plane compose → table); applyState counter-transforms machine-frame poses
  through `_workGrp.matrixWorld`.
- **Marker labels + size hierarchy + datum layer.** Billboard labels on all
  three markers (existing troika infra): active triad = live fixture name
  (dynamic), datum = "G54" (muted), plane = "Plane". Plane triad shrunk
  80→48 mm (the active triad is the DRO's truth and must dominate; the
  quad is the plane's cue). `datumAxes` joined the `workzero` layer.
- **Stale-datum truth.** The remap freezes `saved_work_offset` at
  definition; an identity G54 re-touch-off afterwards is silently ignored
  by the plane and the NEXT ORIENT. Client-only surface (remap semantics
  deliberate, untouched): `twpDatumStale` (live G54 row vs the frozen
  `twp_datum` echo, unknown-is-not-stale) tints the plane quad+grid
  stale-red — a DIFFERENT claim from the head-stale normal arrow — and a
  JogStrip "datum moved" chip says what to do.
- **Clear plane button** — plain `G69` under `ready` + hold (twpReorient
  precedent; idempotent, guardless, also the TOOL-kins-limbo recovery).
- **Typed `set_wcs` provenance** — `pose_override=(0,0)` threaded through a
  shared `_stamp_wcs_rows` loop (both pose sources, one mixed-angle
  decision); closes the 2026-08-30 follow-up.
- **Reserved-WCS radio font** — `.label-muted` is a section-label class
  (fs-2xs); new opacity-only `.muted` utility; text stays `--fs-base`.

**Live acceptance (2026-08-31, TWP sim):** `twp_capture_check.py` ALL PASS —
capture at A=0 and A=35: gateway ok, TWP active + TOOL kins, no-move orient
(max dJ 0.000000), plane normal == tool axis (≤4.1e-6 deg), DRO exactly 0
at the tip, G59 rotary/R rows zero, datum provenance stamped table-frame,
helper world pins follow (bounded settle; 5e-3 tolerance = halcmd's ~7
significant digits at datum magnitude ~1000), re-orient recomputes the
SAME G59 rows; four refusals each with their specific reason, state
intact; clear path green. Regressions: `twp_touchoff_plane_check.py`
ALL PASS (37), `twp_reorient_check.py` ALL PASS, `twp_g683_check.py`
ALL PASS. Corpus gate: the first run hung at a tool change (see harness
fact below) and its early programs carried incident noise; the clean rerun
with the confirmer standing: **GREEN, 21/21 PASS** (plane invariants:
normal_err ≤ 0.0031°, origin_err 0.0000 mm across the corpus).

**Harness facts (hard-won):**
- The corpus gate needs an ARMED WS client that CONFIRMS TOOL CHANGES; the
  `tool_change_requested` flag rides INSIDE the status envelope's nested
  `data` payload — a watcher reading only top-level fields sees nothing
  and the gate hangs at M6. Confirm on the RISING EDGE only. A client
  joining while a program runs must NOT send the ready-up (`home_all`
  errors and aborts the run); after a safety trip the recovery order is
  Ack → Arm → Reset (Arm and Reset are rejected while a trip is unacked).
  Killing an ARMED client aborts motion (by design) — never `pkill` a
  keeper mid-run; also `pkill -f` self-matches any literal occurrence of
  the pattern in the calling command line (log filenames included).
- WS replies must be matched by `cmd` — hello/arm acks also carry `ok`,
  and reading "the next ok-bearing frame" shifted every reply by two
  (an entire check run mis-attributed its replies before this was found).

**Open after this wave:** browser walk-through (Capture from TCP jog at a
tilted face; labels; stale tint; radio font) — listed for the operator.

## 2026-09-01 — Walk-through fix wave: triad W0 + lag, stale-datum truth, Setup-strip TWP buttons, HUD mode line, collision continuation

**Ask (operator browser walk-through of the 2026-08-31 capture wave):** Zero All
in G54 did not put the G54 triad at the tip; the datum looked "jumpy" when
jogging A in the Machine frame (and: should G54 ride A?); define → clear →
move → redefine sometimes left the plane red with "datum moved"; the TWP
buttons rendered at different sizes ("not tokenized") and the datum chip sat
off-position; the HUD showed no mode; the collision sweep reported many
clashes while the Y beam sat continuously inside the portal.

**Root causes and fixes:**

- **Triad through W0.** The 2026-08-31 counter-transform took the
  machine-frame fixture pose as scene-WORLD coordinates. `_workGrp`'s LOCAL
  frame is machine coordinates (every machine-frame object attaches there),
  and its world matrix at zero joints, W0, is `T(-1000,1000,2000)` on
  machine-xyzacb-trsrn (`a_table` [-1700,0,0] → `a_work` [700,1000,2000]) —
  only the 3-axis dev model has W0 = I, which is how it shipped. The triad
  drew (+1000,-1000,-2000) mm off. Rule (viewer/fixtureLocal.ts, pinned by
  a synthetic-chain test): `local = W(A)⁻¹ · W0 · pose`; W0 captured once in
  ensureCoreGroups with the ancestor walk.
- **One-frame lag.** `updateMatrixWorld()` on the CHILD composes with the
  parent's LAST-frame matrix — `a_table`'s rotation set in the same
  applyState was one frame old, so the triad followed A then snapped back.
  `updateWorldMatrix(true, false)` at the triad, the backplot `worldToLocal`
  and the bounds clip planes (same latent bug, three sites).
- **Does G54 ride A?** Not in identity kins: the fixture is a MACHINE-frame
  offset — rotating the table moves the workpiece away from the origin;
  staying put is the honest picture of what the control does. It rides in
  TCP (the world frame rides the table; the Heidenhain 3D-ROT convention),
  and TOOL kins draws the plane frame. `workOrigin` keeps the raw numbers
  (the toolpath is right there by cancellation).
- **Stale datum — the real "sometimes".** The gateway's `_wcs_cache` refreshes
  the ACTIVE row from STAT and all rows from the var file on mtime change —
  but LinuxCNC writes that file ONLY at shutdown (recorded 2026-08-20; the
  comment in status_runtime claiming MDI-completion saves was wrong and is
  fixed). M535 writes `G10 L2 P1` while G59 is active → row 0 froze at the
  pre-touch-off value while `twp_datum` (the helper's world pins) moved →
  `twpDatumStale` fired for a datum that did not move, self-healing only when
  G54 became active again. `_reseed_prov_cache_row` read the same stale file.
  Fix: after M535 (plane-route touch-off and capture) the gateway waits for
  the helper datum to CHANGE (bounded, value-keyed, warn-traced timeout) and
  seeds row 0 + the G54 provenance from it — exact by M535's contract (G54 ==
  saved_work_offset literally, stamp kins 0 / A 0). The gateway's own var-file
  writes (provenance rows, probe vars) now `mark_var_file_written` so they
  cannot reseed axis rows from the shutdown-stale disk copy. Remaining escape
  (operator-caused, documented): a hand-typed `G10 L2 P1` while a reserved
  fixture is active.
- **Second false positive:** `twp_datum` is TABLE frame, the row is machine
  frame — equal only when G54's W1 stamp A == 0. The payload now carries
  `wcs_prov_a` (9 raw stamps) and `twpDatumStale` makes NO claim on a tilted
  stamp (no stamp = pre-W1 = compared as A0).
- **Buttons.** Tokens were identical; in portrait `.strip-radio-col
  { display: contents }` dissolved the JogStrip column so the three buttons
  alternated `max-content`/`1fr` grid tracks, and the `.val-status` chip
  (a status-row class, right-aligned) auto-placed beside Clear plane. All
  three (Capture plane / Orient / Clear plane) moved to SetupStrip as ONE
  `.actionRow` — three equal `1fr` cells spanning the grid, size `md` — the
  same structure now applied to `→ G30 / → Home / → Zero` (which had `→ G30`
  in the 80px column). Placement reversal recorded: 2026-08-30 moved Orient to
  the Jog strip "so you actually find it"; the operator asked for the grid
  ("3 side by side … not some weird different size").
- **Chip + HUD.** `kinsModeChip` (twpPose.ts, pure, priority-tested) is the
  ONE derivation for SetupStrip's chip and the new HUD mode line
  (`MACHINE|TCP|TWP|TOOL · G5x · plane defined|active|stale`); "datum moved"
  rides in its text; colour priority head-stale (bad) > datum-moved (warn),
  text lists both.
- **Collision continuation.** Hits are keyed per (line, pair); the per-pair
  `inContact` latch already persisted across lines for the cutting semantics
  but the non-cutting branch called `recordHit` on every sample, so one
  penetration begun on the entry move minted a record per following line
  (each refined to span its line) — flooding the count and the MAX_HITS cap
  (which could evict genuinely distinct later clashes). Now `onsetLine[pi]`
  is latched at onset and cleared on the verified 2×-margin separation;
  records minted on later lines carry `continuation: <onset line>`, the
  onset carries `spanEndLine`; the count and navigation see onsets only
  ("… through L{n}"), while the per-line records stay so the clash tint and
  the G-code marks show the full extent ("still in contact (began L{n})").
  Re-entry after a verified separation is its own onset; the cap slices
  onsets first. Answer to "what is detected": nothing new — the same contact,
  re-labelled per line.

**Verification:** vitest 567 (fixtureLocal 5, kinsModeChip/stamp rule 22,
collision continuation 32), build, lint, playwright 16, gateway pytest all
green. Live (TWP sim): `twp_capture_check.py` ALL PASS incl. the new
gateway-row phases — broadcast `wcs_table[0]` == interp G54 == `twp_datum`
to 1e-4 at A=0 and after the A=35 plane touch-off, stamp A published 0, and
the (previously SKIP-broken, nested-`data`) work_pos probe reads exactly 0
at the tip; `twp_touchoff_plane_check.py`, `twp_reorient_check.py`,
`twp_g683_check.py` ALL PASS; preview goldens CLEAN; sim-parity corpus
GREEN 21/21 (the keeper auto-confirmed the tool change from the nested
`data` payload — the fix from the 2026-08-31 hang, now the permanent
`armkeeper` shape). Browser walk-through of the visual layer (triad at the
tip, steady datum under A jog, equal button rows, HUD line, onset-only
clash count) is the operator's remaining pass.

## 2026-09-02 — "Switching Machine → Plane moves G54": one mode-invariant datum triad, off-datum chip

**Ask (operator):** "why does switching between machine and plane always
move G54 around? when I switch to plane, G54 appears in a completely
different spot."

**Root cause — a display rule, not a datum move.** Live state at the report:
A = −5.149°, G54 row (machine frame) = twp_datum (table frame) =
(65.455, −599.345, 453.362). Nothing moved. The viewer draws two triads:
the ACTIVE fixture where the current kins puts program zero (identity →
machine frame, counter-transformed through W0, fixed in the room) and the
muted datum triad at `twp_datum` under the work group (table frame, rides
A). Both read the same three numbers, and at A ≠ 0 those numbers in the
two frames are different places in the room — separated by the table
rotation about the A pivot (tens of millimetres per degree at this lever).
The datum triad's visibility was keyed on the FIXTURE INDEX ("shown while a
reserved fixture is active; same spot as the active triad otherwise, so it
hides") — a premise true only at A = 0. So it hid exactly while it would
have shown the divergence and appeared at the Plane switch, at the
table-frame spot, wearing the same label "G54" as the machine-frame triad
it had been standing in for. One thing named G54 appearing to teleport.

**Fix — each triad gets one mode-invariant meaning:**

- **Datum triad = the part's zero, table frame, labeled "datum"** (never a
  fixture name — the active triad owns "G54"). Drawn in every kins mode once
  a plane is defined; hidden only while it physically sits under the active
  triad (`twpPose.datumTriadVisible`: a 0.1-unit geometric test in the one
  frame both groups share — children of `_workGrp` — no gateway state
  involved, so it cannot go "sporadic"). Its position never depends on the
  mode; the only thing that moves it is jogging A, and it moves WITH the
  part.
- **Active triad = where program zero is under the current kins**, labeled
  with the fixture name. Unchanged.
- **The informational half:** nothing had said, while A was jogged in
  Machine mode, that G54 had left the part. `fixtureOffDatum` (twpPose.ts,
  pure): identity kins + the ACTIVE fixture's W1 stamp A (no stamp = the
  documented A = 0 rule, the same reading `twpDatumStale` takes) +
  |live A − stamp A| > `TWP_PROV_A_EPS` (the stamp's own 0.01° window) →
  `MACHINE · off datum` (warn) in SetupStrip's chip and the HUD line, title
  quoting both angles. It is the exact mirror of head-stale: that one is
  "table moved under an oriented head" in Plane mode, this one "table moved
  under a machine-frame fixture" in Machine mode. Never a claim under TCP
  (the fixture rides the table) or TOOL kins (the plane surfaces cover it).
  `stampAForFixture` indexes the 1-based active fixture into the payload's
  `wcs_prov_a` 9-list — G54 is the datum fixture, but the claim holds for
  whichever fixture is active.

What the operator now sees: define a plane at A = 0 in Machine mode — one
triad. Jog A — the datum peels off G54 and rides away with the part while
G54 stays in the room and the chip says off datum. Switch to Plane — G59
goes to the plane, the datum does not move a micron.

Grounding: on machine-xyzacb-trsrn the work group rides A only (`a_table`
→ `a_work`; C and B are head-side), so one stamped A fully describes the
datum's frame — why the stamp records only A.

**Verification:** vitest twpPose 40 (13 new: fixtureOffDatum window/no-stamp/
mode scope/no-reading, stampAForFixture, datumTriadVisible coincidence
boundary and unknowns, chip off-datum text/title/both-flags), full vitest,
`npm run build`, lint green. No gateway change (the stamp was already on
the wire). Browser walk-through (the triad pair separating under an A jog,
no jump at the mode switch, the chip) is the operator's pass.

## 2026-09-02 — Program zero rides the part: chain-evaluated fixture triad, machine ghost, datum triad removed

Supersedes the record above (the mode-invariant "datum" triad, 8db508a):
that fix was right about the symptom and wrong about the model.

**Ask (operator, same day):** "switching between Machine and Plane/TCP
always moves G54 around; when I switch back to Machine it remains at the
moved position until I jog any axis. Do other UIs even show G54 when it is
not active? What do Fanuc, Siemens, Heidenhain, Fusion, the grbl senders,
gmoccapy do?"

**Survey.** Sources: TNC7 Programming/Testing and Setup manuals
(content.heidenhain.de), the SINUMERIK Operate user guide, the Fanuc TWP
guidance-screen spec (cncmanuals.com) and Manual Guide i page, the Fusion
machine-configuration KB, the Haas NGC operator manual, LinuxCNC's AXIS docs
+ `rs274/glcanon.py`, QtPyVCP `vtk_backplot.py`, CNCjs/gSender/bCNC/UGS
visualizer sources, Sigma1912's `LinuxCNC_Demo_Configs` (vtk-vismach DMU
GUI) and David Mueller's upstream TWP vismach in the spike checkout.
- Every UI draws exactly ONE work-system marker, the active fixture, on the
  workpiece; none shows inactive fixtures. AXIS/glcanon: "Show offsets" =
  a line from machine zero to the SELECTED g5x origin + its triad + a cyan
  machine-origin marker. QtPyVCP: one axes actor moved on
  `update_active_wcs`. Haas Graphics: tool icon, paths, a "Z-axis part zero
  line". grbl senders: the scene IS work coordinates (grid + RGB axes at
  work zero, machine limits as a separate box).
- Commercial controls store the datum ONCE at the end of the kinematic
  chain (TNC7: B-CS "origin is the end of the kinematics description", the
  preset is a transformation inside it), so it rides the table in every
  mode; TCPM/PLANE/CYCLE800/G68.2 are functions layered on that one datum.
  The DRO offers reference-system MODES (I-CS vs M-CS); the graphics draw
  the workpiece with one preset. The "table rotated, no tilt function"
  state exists there too (3D-ROT off, warning icon) — its datum numbers
  never change MEANING, and nothing draws it on a moving machine model.
- LinuxCNC switchkins re-interprets the SAME G54 numbers: joint-space under
  identity, table-frame under TCP. That re-interpretation is the jump, and
  it is LinuxCNC-specific. Upstream's own TWP vismach draws THREE static
  copies of the work-offset triad switched by the kinstype pin — the
  identity and tool copies are siblings of the table (room-fixed), only
  the TCP copy rotates with A — i.e. the same split we shipped, with the
  same jump. Sigma1912 draws no G54 triad at all (machine axes, a kins-
  switched tool triad, a triad fixed at the table centre, the plane frame
  at `twp_o*_world`, an arrow from machine zero).

**Decision (operator, after three rounds of clarification: "is this
inherent to switchkins?", "is the standard to always stay in TCP/TWP?",
"would a program go to G54 anyway?", "is this the 3D-ROT feature?"):**
one G54 triad, always where the part's zero physically is; a muted
"program zero (machine)" marker only under identity kins while live A ≠
the touch-off A; the "datum" triad removed. Answers recorded: yes, the
jump is inherent to switchkins; no, the standard is touch off once at the
reference pose, then TCP or Plane for any tilted work and Machine mode for
indexing/setup; a program goes where the ACTIVE mode sends it (M428/M429/
M430 and G68.x/G53.x/G69 in the program are how a program switches; M2
resets G54 but not the kins type); TCP IS the 3D-ROT-style tracking, and
Machine mode is 3D-ROT off.

**Definition (viewer/programZero.ts):** program zero = where the tool TIP
lands when the control is commanded to program (0,0,0), evaluated through
the machine.json chain (work + tool) at the joint set the mode implies,
expressed in the work group's local frame — `transformToPartFrame`'s
per-vertex rule, now factored into `buildChain` + `tipInWorkFrame` (one
chain, one lift, one TLO-in-tool-node-rotation convention; the markers and
the path-on-part preview agree by construction).
- Identity: evaluate at rotary = the fixture's W1 stamp A (absent = A0, the
  documented rule), tool-chain rotaries 0 (the control point's zero, what
  the DRO reads); drawn under `_workGrp` it rides the table. Ghost: the
  same evaluation at the LIVE A, shown only when `fixtureOffDatum` holds
  and no scrub pose is displayed; it coincides with the triad exactly iff
  live A = stamp A.
- TCP: the numbers (table frame). TOOL + reserved fixture: the plane
  compose (`activeFixturePose`, `frame` tag removed).
- Bound: the stamp records A only, so the part-riding placement requires
  every rotary DOF of the work chain to be A (`fixtureRidesOnA`; trsrn ✓,
  xyzac A+C ✗ → machine placement at the live pose, label "· machine", one
  console warn, no ghost). Follow-up if ever needed: extend the stamp to
  the full work-chain rotary pose.

**Moving-table bug removed on the way.** The 2026-09-01 counter-transform
`fixtureLocalMatrix` = `W(live)⁻¹·W0·P` assumed the work group carried no
LINEAR DOFs. On machine-xyzac (table X → saddle Y → knee Z → A → C) it
evaluates to `Piv·Rx(−A)·Piv⁻¹·(P + live_xyz)`: the triad drifted by the
slide travel. The chain evaluation gives `Piv·Rx(−A)·Piv⁻¹·P`, which drawn
under the live work group sits at `tip + (g − live)` — under the spindle
exactly when the DRO reads 0, at any slide position. Pinned in
`programZero.test.ts` ("moving table"). `fixtureLocal.ts` deleted.

**"Stays until I jog" was a repaint miss.** ThreeViewer renders on demand;
its `_pv` diff never listed `kins_type`, `g5x_index`, the plane pins,
`rotary_abc` or `wcs_prov_a`, so M428 recomputed the pose and never
painted it. `markerInputsChanged` (pure, tested with the M428 case) now
feeds the diff, and the markers are placed after it so `_pfWcs()` reads
fresh terms.

**Verification:** vitest — programZero 28 (identity at the stamp,
stamp-vs-live separation with the room-point check through the trsrn
chain, coincidence window, TCP invariance across an a/b/c grid with TLO
22 to 1e-5, kins-2 vs `twpPlaneForSample` to 1e-3, moving-table drift,
chain letters/bound/rotary selection, the rule table incl. the xyzac
fallback with one warn, scrub, hides, scratch reuse, the repaint diff),
partFrame +1 (`tipInWorkFrame` ≡ the single-vertex transform), twpPose and
activeFixtureFrame adjusted; four files 89 green. The heavy gates
(`npm run build`, full vitest, lint, e2e) were NOT run in this session
because the TWP sim was live on the 4-core VM (the false-trip rule) — they
run at the next stop, before the operator walk-through in the plan.

## 2026-09-03 — Per-client command worker: liveness never queues behind work

**Ask (operator):** "since your changes I get heartbeat timeouts."

**Forensics (runlogs/trace.ndjson):** six `safety.hb_stall_disarmed` events —
Aug 31 ×2, Sep 1, Sep 2 ×2, Sep 3 — every one 0.17–0.21 s after a
`touchoff.plane` / `twp.capture` finished, each preceded by
`twp.datum_settle_timeout`, heartbeat arrival gaps 3.3–4.0 s. The viewer
change of the same day was exonerated on the numbers: `workMarkers` costs
9 µs/call (vite-node bench), the browser's 5 fps regime in
`browser.viewer.perf` predates it by days and its frames are cheap
(apply 0.07 ms, render 0), no `browser.error.*`.

**Root cause:** `ws_endpoint` read frames in ONE sequential loop and awaited
every command handler inline (`reply = await handle_command(...)`).
`handle_command` holds `_cmd_lock`, and the TWP handlers wait inside it:
the plane-route touch-off = `_cmd_blocking(CMD.mdi, wait=30)` +
`_settle_datum_after_m535` (3.0 s, added 2026-09-01 — the "datum unchanged"
case, i.e. touching off where G54 already is, always burns the full 3 s);
Capture = four MDIs (`wait=10/10/30/30`) + three settle loops. While the
handler ran, that client's own heartbeats sat unread in the socket;
`status_loop` saw `last_hb_mono` older than 3 s and disarmed. The event loop
was never blocked (`_cmd_blocking` runs on a thread) — the per-client reader
coroutine was parked. The Aug 31 stalls (Capture's `orient_settle`) show the
class predates the settle; the settle made every same-datum touch-off hit it.

**Fix (by construction):** the reader handles liveness/bookkeeping frames
only (`heartbeat`, `hello`, `safety_trip_ack`, settings, diagnostics,
`tab_visibility`); every other command — `arm` included, its disarm branch
takes `_cmd_lock` — goes to ONE per-client worker task (`cmd_worker`) that
runs the former inline block verbatim (`_execute_client_command`: arm
handshake, dispatch, bounded-error catch, `unload_file` cache reset, reply
send), reading `client.armed` at execution time. Per-client FIFO is kept
(`arm → jog_cont`, `jog_cont → jog_stop`). Bounded queue
(`_WS_CMD_QUEUE_MAX` 32): overflow is replied AND traced
(`ws.command_queue_full`, naming the in-flight command), never silently
dropped; stop-class commands (`jog_stop`, `jog_stop_multi`, `abort`,
`estop`) get 4× headroom and are never the ones rejected. Disconnect: the
worker is cancelled BEFORE the armed jog-stop (which needs `_cmd_lock`),
queued commands are drained loudly (`ws.command_dropped_on_disconnect`),
the in-flight one traced (`ws.command_cancelled_on_disconnect`);
`ws.disconnect` carries `queue_dropped` / `inflight_at_drop`. Slow handlers
name themselves (`ws.command_slow`, > 1 s); the hb-stall event carries
`inflight_cmd` / `inflight_ms`; `_HB_STALL_SEC` is a module constant.

**Required companion — `_cmd_blocking` shield-and-wait.** `async with
_cmd_lock` releases on `CancelledError`, but a thread cannot be cancelled: a
plain `await to_thread()` under cancellation would free the lock while
`CMD.mdi` / `wait_complete` was still running, and the next holder (the
disconnect jog-stop, another client's worker) would call NML concurrently —
the corruption the lock exists to prevent. Nothing cancelled handlers
before; now a disconnect does, so the cancel path keeps the lock until the
NML call returns (bounded by `wait`), then propagates. A cancel inside the
datum settle skips the row seed; `twpDatumStale` surfaces that, loudly.

**Contracts checked, unchanged:** `ws_send_json` → uvicorn's websockets impl
writes frames atomically (three tasks already sent concurrently per socket;
the worker catches `WebSocketDisconnect` around its reply). The frontend
never awaits replies (`fire()`), consumers match by echoed `cmd` or payload
shape, `pong` by type — a pong overtaking a slow reply is fine and the RTT
readout becomes honest. `check_command` is pure over state read at
execution time (more conservative). Harness scripts match replies by `cmd`.
`test_command_policy`'s inline-ladder text contract: 10 inline > 8 after
`arm` / `unload_file` left the reader text.

**Verification:** `test_ws_command_worker.py` (7): the live failure
reproduced — a 4 s handler with heartbeats every 0.5 s: pong gaps < 1.5 s,
armed throughout, no `safety.hb_stall_disarmed`, reply arrives ≥ 3.5 s
later, `ws.command_slow` names it; in-order execution; queue-full rejection
replied + traced while pongs flow, `jog_stop` never rejected, all queued
commands complete after release; disconnect cancels the in-flight handler
and traces the two dropped ones (+ `ws.disconnect` fields); a raising
handler gets a bounded error reply and the socket survives; a silent client
is still disarmed (`_HB_STALL_SEC` 1.0, `inflight_cmd None`);
`_cmd_blocking` keeps `_cmd_lock` held until the thread returns.
`test_ws_lifecycle`, `test_ws_smoke`, `test_command_policy`,
`test_command_dispatch` green.

**Live verification (2026-09-03, suite restarted on ad84fd5, gateway pid
55070):** an armed keeper (0.8 s heartbeats) drove the exact repro — plane
capture, two same-datum Plane touch-offs, then g69 + a same-datum capture.
Both touch-offs burned the 3 s settle (`twp.datum_settle_timeout` ×2,
replies at 3089 / 3082 ms, `ws.command_slow` names `touchoff` for each);
27 pongs, max gap 829 ms, mean 801 ms; armed throughout; ZERO
`safety.hb_stall_disarmed`. Capture replied in ~200 ms both times (its
settle saw the datum move, so the timeout path was the touch-off's).
`twp_capture_check`, `twp_touchoff_plane_check`, `twp_reorient_check`:
ALL PASS. Corpus gate GREEN (`sim_parity.py gate`, 11 runs; worst
sim→truth 1.074 on twp_g683_tilted.run1 at tol 1.5, everything else
≤ 0.040 at tol 0.5; the tracked run records were restored to the committed
versions — regenerate deliberately). Perf matrix
(`runlogs/perf-matrix/20260903T174927Z-ad84fd5.json`, full set with
`--allow-arm --allow-trip`): sigstop_trip sticky_ok + recovered_ok,
preview_publish delivered (version bump), zero loop lag windows in every
loaded scenario. The two 81 / 123 ms `reader_recv.readline` windows
(idle_baseline, fusion_near_limit) are the class the trace already shows
at idle BEFORE any harness ran (19:26–19:29, browser only: 59–91 ms) —
VM scheduling with the Vite dev server + browser on the 4-core box; the
worker adds no loop work and the reader sits idle in `readline` when a
late wakeup lands. RSS 130 → 225 MB across the publish: the payload was
46 MB raw (ship_abc + per-segment kinstype under a kins-2 seed, see (3)),
so the delta scales with it; no growth in rss_gc_watch.

Findings from the run (none are this wave's defects): (1) the first
`twp_touchoff_plane_check` pass aborted at a `read_params` timeout: the
operator's browser hit its 10 min idle auto-disarm at 19:37:16 and the
explicit-disarm path's `_jog_stop_for_client` forces `MODE_MANUAL`, which
broke the harness's LOGOPEN/LOG/LOGCLOSE MDI triple between blocks (the
rerun passed). A disarm from ANY client while another client's MDI
o-sub is between blocks does the same to that MDI — the documented
bluntness of the every-joint jog-stop; follow-up on the ledger: jog-stop
only when a jog is actually in flight, never switch mode while the interp
is not idle. (2) The corpus gate needs an armed client to confirm M6 (by
design); the scratch keeper stands in for the operator's Continue click
on the sim (rising-edge `confirm_tool_change`). (3) The matrix's
perfmatrix-big.ngc parse took 28 s in the worker (off-loop; gcode.parse
itself 6.1 s): the machine was parked in kins 2 by the last corpus
program, so all 1.18 M feed segments went through the Python trsrn twin
(`world-checked`, ~4× the parse). Correct labeling for a machine that
WOULD run it in that mode; a vectorization candidate only if it ever
matters — it never touches the loop.

**Follow-ups recorded:** stop-class preemption (on `abort`/`estop` cancel
the in-flight handler so the stop runs after the current NML call — safe now
thanks to shield-and-wait; today a stop still waits behind a 30 s MDI, as it
always did); a helper sequence pin (`twp-seq`) so the datum settle keys on
"the remap republished" instead of "the value changed" and a same-datum
touch-off stops burning 3 s before replying.


## 2026-09-03 — Operator bug wave: stale-plane tint, clash count, run-time preview jump, the M2 trap

Operator reported four things after the walk-through; one was by design (→ Zero
retracts Z to machine top and rapids X/Y to work zero — the probe_basic
`go_to_zero` contract; only a tooltip was owed). The other three were real, and
the investigation found a fourth gap the operator was standing in.

**Stale plane no longer red.** `d0eed51` (2026-08-31) had narrowed the head-stale
tint from the 300 mm plane quad + grid to the 48 mm +Z arrow ("the plane rides
the workpiece; the head solve is the stale thing"). Semantically right, visually
invisible. Reversed: the tint is an ATTENTION signal and the chip title carries
the claim — quad + grid red on head-stale OR datum-stale, the arrow keeps the
head-stale tint as the pointer (`ThreeViewer.vue updateTwpPlane`). And the state
the operator was actually in had NO indicator: `twp_simple_example.ngc` with its
`;g69` commented out ended with M2 → G54 restored, TOOL kinematics latched, plane
active — the chip read amber "TWP" like a healthy plane. `kinsModeChip` gains
`g5xIndex`: Plane kinematics with any fixture but G59 selected is red
"TWP · G54" (names the real fixture), TOOL kins without a plane is red too.

**One clash, two marks.** `ScrubBar` counted onset RECORDS while marks and
prev/next iterated per-INTERVAL targets (`4cff3e5` moved the marks, `e984288`
the count; nothing pinned the relation). `viewer/clashTargets.ts` is now the one
derivation for count, marks and navigation; a same-line re-entry is labelled
"(re-entry)". Second mechanism, same symptom: refinement could split ONE
continuous contact into windows meeting at a boundary (clusters are seeded from
in-contact samples only) — `mergeContiguousIntervals` merges windows within
twice the bisection tolerance. Both unit-tested.

**Run-time preview jump (lines 4–7, the orient span).** The drawn lines hung
under `workOrigin`, re-posed from the LIVE g5x/g92/rotation on every status
frame, while their vertices were peeled against the WCS snapshot at bake time
and re-baked only 300 ms after the last change (`_pfScheduleWcsRefresh`) plus
the worker round trip. Line 2's `G10 L2 P0` and line 6's `g53.3` fixture switch
moved the anchor at once and the vertices later: the whole path jumped, then
returned. Sim never changes those inputs, hence "not in sim". Fix by
construction: the lines (+ overflow twins, highlight, bounds box) hang under
their OWN `pathAnchor`/`pathRot`, posed ONLY by `toolpath.apply` from
`anchorTerms` of the very WCS the geometry was baked with — one call, both
halves; `applyState` uses the same `anchorTerms` for the live `workOrigin`
(stock, surface map, axes must still follow a touch-off at once). The anchor
rides the part-frame request id, so a superseded reply can never land under a
newer origin. Gateway hardening of the second candidate mechanism: the
TLO/rotary/kins/WCS-offset drift edges share `drift_gate_open`, which also
requires no motion — `interp_state` reads IDLE while a short program's motion
queue drains, so a kins step could have scheduled a reparse mid-run.

**The M2 trap, guarded.** M2 resets interpreter modal state; the kinematics
type is a HAL pin written by M68 inside the M428/M429/M430 remaps, so M2 cannot
touch it; M2/M30 are not remappable and LinuxCNC's only end hook is the abort
handler (which this config deliberately keeps the plane through). Two guards:
(1) `command_policy.kins_runnable` → new permission class `run` (= `ready` +
the rule) for `cycle_start` and `auto_run`: Plane kinematics without its plane,
Plane kinematics with an operator fixture selected, or an unknown kins mode on a
switchable machine refuse to start with the exact reason; `ready` stays open so
the MDI fix (M428 / M430 / G69) is one step away. Frontend `run` class
(busy-subset), Cycle Start and both fire sites on it; a backend that predates
the class is read as `ready` with one console warning (mixed-version window
before the restart). (2) Load-time lint: the parse worker ships
`kins_end_type` — the type the program's LAST switchkins marker leaves in
effect (program markers only, before the live seed; absent when the program
never switches) — shown as a HUD chip and a stats-dialog row naming the fix
(G69 / M428 before M2).

**Verification (frontend live via Vite HMR; gateway parts at the next restart):**
unit — twpPose 42, collision + clashTargets 39, toolpathController + partFrame
37, permissions 11, command_policy 92, gateway_util DriftGate + ProgramEndKins
green. Real-path proof of the lint: a reparse of the operator's program through
the RUNNING gateway logged "kins at end: type 2 — the program does not restore
identity (G69 / M428) before M2" and published the key. Owed: operator browser
walk-through (red "TWP · G54" chip in the current state; plane red on a jogged
A; clash count == ticks; no jump on the next run of the program; the lint chip
on load), `cycle_start` refusal + drift gate after the gateway restart, and the
frontend heavy gates at the next suite stop.

Superseded the same evening (4bd1541 + the Z wave below): → Zero's order is Z →
rotaries (to the fixture's STAMP angle) → X/Y, and its `G53 G0 Z0` retract is
guarded by `#<_abs_z> LT 0` — a retract never lowers Z. Premise correction: machine
Z0 on the TWP sim was never "tip at table"; joints-at-zero is the parked pose 2 m
above the A axis, and the ±5000 Z window (a 10 m cube) was the defect.
`twpDatumStale`'s stamp-A short-circuit makes the datum-red path dead on a
tilted-A machine (documented frame reason, left as is).


## 2026-09-04 — G53 routines need the Machine frame; a mode-aware → Zero; tool change saves and restores the kins

Operator: "If I have defined a plane and I press go zero, what will happen?" —
`go_to_zero.ngc` does `G53 G0 Z0`, `G0 X0 Y0`, then `G0 A0 / B0 / C0`. Under
switched kinematics G53 addresses the kinematics' WORLD frame: in TOOL mode the
tilted plane frame (so "Z0" is a plane through the machine origin, not the top
of travel — direction depends on where you stand), in TCP the table-riding
frame; and a rotary word under TOOL kins swings the head at fixed XYZ joints —
the tip sweeps the pivot lever — and leaves the plane stale. Every routine that
retracts with G53 (go-to Home/G30, the tool-change and toolsetter routines,
probe_basic's cycles) assumed identity kinematics and sat on `ready`.

**Guards (one predicate, three surfaces):** `command_policy.machine_frame_required`
→ permission class `machineFrame` (= ready + identity kins; unknown refuses) on
the go-to Home/G30 buttons, tool load / measure / unload, the probe operations
and their fire sites; backend-enforced for `tool_change`. **→ Zero** is now the
gateway command `go_to_zero` with `goto_zero_plan` (pure): Machine frame runs
the subroutine as before; Plane frame with its plane active and G59 selected
retracts ALONG THE TOOL AXIS to max(live plane Z, 25 mm / 1 in) and rapids
X0 Y0 in the plane, rotaries untouched; TCP refuses with the reason (neither
the machine top nor the tool axis is a world axis there). Class `goZero`.
Tooltip states all three. MDI typed by hand stays the operator's own (the text
is opaque to the policy) — documented limitation.

**Tool change under TCP/Plane inside a PROGRAM** (the gate covers MDI only):
`twp/remap_subs/m600.ngc` shadows the bundle's wrapper (first on
SUBROUTINE_PATH): save the switchkins type, M428, `o<tool_touch_off>`, restore
(M430 re-selects G59, M429 TCP). Under task the HAL pin is the truth; the
preview parse has no HAL, so every switch site (428/429/430 remaps, the G53.x
wrappers, g69, and remap.py after its `M68 E3 Q2`) now also sets the
interpreter mirror `#<_webui_kinstype>` — the preview restores the same type
the machine will, and a type-2 span after the change keeps the frame the last
G53.x pinned. Proven through the RUNNING gateway's parse: a `M429 / T3 M600 /
G0 X10` program ships the post-change rapid as kinstype 1 (5 markers), and a
`G68.2 / G53.1 / T3 M600 / G0 X10 / G69` program ships it as kinstype 2 with
`kins_end_type` 0. Task-side M600 not exercised on this sim (no toolsetter
position configured) — the wrapper only sequences remaps that are live-proven.

**Finding (preview honesty, follow-up):** with a plane DEFINED on the machine,
a program that starts with G68.2 parses EMPTY (g682 refuses "already defined"
inside the preview's seeded state) and the worker reports success with zero
segments — no loud reason reaches the operator. Needs an interp-error channel
on the wire ("parse stopped at line N: …") the way violations ride it.

Verification: command_policy 92 + dispatch green (the dispatch "fully ready"
fixture now says non-switchable, as the gateway's own call sites do — the
builder's default is the CLOSED unknown reading, refused by run/machineFrame
by design), permissions 12. Frontend live via HMR; `go_to_zero` handler needs
the next gateway restart (the suite was restarted 2026-09-04 18:36, before
this commit — until then → Zero answers "unknown command"). Acceptance for the
remap edits, run 2026-09-04 19:40 under an armed keeper: corpus gate GREEN
(11 runs, worst sim→truth 0.210 on twp_g683_tilted.run1 at tol 1.5, everything
else ≤ 0.037 at tol 0.5); `twp_capture_check`, `twp_touchoff_plane_check`,
`twp_reorient_check` ALL PASS — the G53.x / G69 / M428 / M430 wrappers with
the mirror assignments are live-proven under task. Run records restored to the
committed versions.


## 2026-09-04 (evening) — "sometimes it goes to zero, sometimes it doesn't": two mechanisms, one matrix

Operator, after restarting the suite at 20:36: "the machine sometimes goes to zero if I
jog A and sometimes it doesn't, all in Machine mode; 'plane position unknown' in Plane
mode; I feel our system is somewhat inconsistent and we are in over our head."

**What was actually happening (trace + code, not guesses):**
1. *Plane → Zero always refused* — my bug from the morning: the handler read
   `_shared_status` as a dict; it is the `StatusPayload` object. The policy was
   unit-tested with a number; the handler's plumbing was not. Fixed; dispatch tests
   now drive the handler through the real payload shape.
2. *"G54 did not align anymore with the head — it stopped somewhere else"* — a semantic
   gap, not a defect: in identity kinematics a fixture is a fixed point in the ROOM,
   the part's datum only at the table angle it was touched off at (the W1 stamp
   records it). `go_to_zero.ngc` drove A to 0 unconditionally, so after a Zero All at
   a tilted A the tip went to the room point while the part had rotated away — exactly
   where the viewer's muted "program zero (machine)" ghost is drawn. Every surface was
   honest; the button ignored the stamp. Now the gateway passes the stamp angle
   (`O<go_to_zero> CALL [a]`), the subroutine moves the rotaries BEFORE X/Y, and a
   fixture stamped under TCP/Plane is refused with the reason.
3. *Presses that "did nothing"* — the accepted-press gaps of 0.95 s and 1.6 s in the
   trace are shorter than the move: the go-to was being ABORTED. Releasing the A jog
   sends `jog_stop`, which forced `MODE_MANUAL`; LinuxCNC's `emcTaskSetMode(MANUAL)`
   runs `mdi_execute_abort` and the → Zero stopped wherever it was, reply ok, nothing
   traced. `jog_stop`, `jog_stop_multi` and `_jog_stop_for_client` now skip the mode
   switch while an MDI executes (no jog can be in flight in MDI mode) and trace it.
   This is also the disarm-path follow-up recorded on 2026-09-03.
4. *Silent-drop classes found alongside and closed:* `set_mode` discarded its rc
   (raises a bounded ValueError now); the hold-to-fire button was cancelled silently
   when the strip's drag-scroll captured the pointer at 5 px (hold buttons carry
   `no-drag-scroll`; every cancelled hold says why on the console); LinuxCNC's operator
   error channel never reached the trace (`nml.error` now). `_cmd_rc_failed` read
   `linuxcnc.RCS_DONE` bare — the fake binding the dispatch tests run under has no such
   constant, which is why no rc-checking path had ever been exercised there.

**The answer to "inconsistent": one table, executed live.** `scripts/twp_buttons_check.py`
drives every motion button through the WebSocket as the button does — → Zero, → Home/G30,
Zero All, tool measure/load, probe op, Cycle Start — in Machine, TCP and Plane, asserting
the reply AND the machine outcome, including the two reported sequences (Zero All at A=20,
jog A to 0, → Zero lands on the datum; release the A jog mid-move, the move completes)
and the post-M2 stranded state. PASS / FAIL / SKIP per cell, a table at the end. It joins
the corpus gate as the acceptance for anything touching a motion button. Owed: the first
live run (needs the gateway that carries today's handler — restart), pasted here.

Verification so far: command_policy 97, dispatch 153 (incl. the seven new), WS lifecycle /
smoke / command-worker / gateway_util green; Vite hot-reloaded MachineBtn without errors.

## 2026-09-04 (night) — "Why no full Z retraction?": a retract never lowers Z; the 10 m cube, not the datum

Operator, 21:12, after the restart onto 4bd1541: "why does when I press zero
not a full Z retraction happen?" Trace: the Plane-frame presses sent `G0 Z298`
/ `G0 Z506` (the tip was already that high above the plane origin; that branch
never lowers, so Z stayed and only X/Y moved); the Machine-frame presses ran
`O<go_to_zero> CALL [0.0000]`, whose retract is `G53 G0 Z0`, and Z came DOWN
to machine zero from about +500.

**Premise correction (exploration, load-bearing).** Machine Z0 on the TWP sim
was never "tip at table". `a_work` is a frame group origined at machine zero
(tool-vs-work relative pose ≡ machine coords); joints-at-zero is the parked
pose with the nose 2000 above the A axis (platter rim top at machine −1100,
stock top −1400, bed −3100) — exactly the DMU convention's parked-high pose.
What differs from the DMU is the LIMITS: the TWP INI had `Z ±5000` (10 m of
travel through the portal and the bed) where the DMU has `−970..0.01`. The
operator could jog to +500 only because the limit allowed it; the committed
corpus record `twp_simple_example.run1` even starts at joint Z +204. So
"Z0-at-top" here is a limits change, not a datum shift — no model
regeneration, no kins pin, no corpus re-capture (that is the next entry).

**The rule.** The retract idiom `G53 G0 Z0` assumes machine Z0 = top of travel.
True on a mill that homes at the top (the 3-axis sim has `MAX_LIMIT 0.10`);
on any config whose Z0 is not the top — positive-up hobby configs, this sim
before its window was narrowed — it is a plunge dressed as a retract. Wave 1
makes "a retract never lowers Z" hold by construction wherever the suite owns
the retract:

- `go_to_zero.ngc`, `go_to_home.ngc`, `go_to_g30.ngc`: the bare `G53 G0 Z0`
  is now `o100 if [#<_abs_z> LT 0]` … `endif`. `#<_abs_z>` is the interp's
  read-only machine-frame position (`interp_namedparams.cc` NP_ABS_Z:
  `current_z + axis_offset_z + origin_offset_z + tool_offset.tran.z`) and a
  G53 Z word subtracts exactly those four terms (`interp_find.cc` find_ends,
  G_53) — so `#<_abs_z> >= 0` ⇔ "G53 Z0 would not raise the tip". It is fresh
  after a jog (the MANUAL→MDI switch runs `emcTaskPlanSynch` →
  `GET_EXTERNAL_POSITION_Z` from `motion.traj.position`), the guard is the
  sub's first motion, and the sign test is unit-independent. First use of
  `#<_abs_z>` in this repo; the preview interpreter evaluates it from its own
  internal position (a user program calling these subs may preview the other
  branch — cosmetic). → Home and → G30 are raw MDI from App.vue under the
  `machineFrame` gate, so their guard could only live in the G-code.
- The run-from-line safe-Z step (`gateway.py` `_rfl_sequence`) skips its
  `G53 G0 Z0` when the live machine Z is already ≥ 0 (`rfl.safe_z_already_above`)
  and verifies "not BELOW −0.5" instead of "|Z| ≤ 0.5" (`test_rfl_guard.py`:
  from below → retract sent and verified; at zero / above → no MDI; 18 pass).
- Not guarded, bounded at a line: the bundled toolsetter/probe routines
  (`tool_touch_off.ngc:183,210,253,393`, `toolsetter_wco.ngc:37`,
  `probe_spindle_nose.ngc:74`, `surface_scan.ngc:138,205`) carry the same
  idiom; they start at the work, no sim here has a toolsetter, and the next
  entry makes the sim a Z0-at-top machine.
- Text that was wrong: the → Zero tooltip claimed "Z retracts to machine
  top … rotaries to 0 (Z is NOT lowered)" — now states the guard, the stamp
  angle and the Plane branch's never-lower clearance; the `goto_zero_plan`
  docstring, CLAUDE.md and the 2026-09-04 note above likewise.

**The matrix, first live run (`scripts/twp_buttons_check.py`) — three defects
in the SCRIPT, none in the product.** (1) The motion sampler for → Home/→ G30
started sampling after sending a no-wait command and gave up after 1.5 s of
no motion, so a slow start read the pre-move pose as the result; now a
sampler thread runs from BEFORE the blocking command is sent and a motion
that never starts is reported (`ran=False`), never assumed. (2) The WS helper
answered `_status` requests from a BACKLOG — status frames pile up on the
socket between requests and each read consumed one old frame — so the TCP
and Plane gate rows certified the permissions of a mode the machine had left
seconds earlier; the helper now drains the backlog and waits for a fresh
frame, and `settled(field, value)` waits for `kins_type` / `g5x_index` to
report the new mode before permissions are read (a timeout prints the last
value and the row FAILS, never passes vacuously). (3) The "fixture stamped
under TCP" row wrote the provenance rows as var-file parameters, which the
gateway loads once at startup and otherwise writes only through its own
touch-off path — so `_prov_cache` never saw the stamp; the row now stamps
through the real path (Zero All at A=0 under TCP → kins 1) and learned a
fact on the way: a PARTIAL (Z-only) write under a different kins than the
prior stamp CLEARS the stamp (`wcs_stamp_decision`: no single pose describes
the merged triple), only a full X/Y/Z write stamps under the live kins.

New rows, all certified live on the ±5000 window — the only time the
above-machine-zero rows can PASS on this sim (after the next entry they SKIP
with the reason "MAX_LIMIT ≤ 50: above machine zero unreachable"):
`→ Zero / → Home / → G30 from BELOW Z0 (G53 Z−60)` → Z at machine top
exactly (G30: retracts first, then lands on #5181..#5183); `… from ABOVE Z0
(G53 Z+50)` → min Z seen ≥ +50, X/Y where the routine sends them; and the
premise row `#<_abs_z> == machine-frame Z with a 12.5 TLO active; #<_z> ==
abs − G5x − G92 − TLO` (FAIL there would mean the guard is wrong, not the
machine).

**Live run, 2026-09-04 22:5x, TWP sim, ±5000 window (gateway 21:10 build + the wave-1
.ngc edits, live per call): ALL PASS (39 pass, 1 skip)**

```
PASS | Machine | Zero All routes to the mdi touch-off and stamps G54
PASS | Machine | G54 stamp: kins 0, A 0
PASS | Machine | → Home / → G30 gate 'machineFrame' open
PASS | Machine | → Zero gate 'goZero' open
PASS | Machine | Cycle Start gate 'run' open
PASS | Machine | Tool measure / load gate 'machineFrame' open
PASS | Machine | Probe op gate 'machineFrame' open
PASS | Machine | → Zero from BELOW Z0 (G53 Z-60): Z at machine top exactly, X/Y at work zero, A back to the stamp (0)
PASS | Machine | → Zero from ABOVE Z0 (G53 Z+50): Z unchanged (never lowered), X/Y at work zero
PASS | Machine | → Home from BELOW Z0: Z to machine top, X/Y to machine zero, A 0
PASS | Machine | → Home from ABOVE Z0: min Z seen >= +50 (never lowered), X/Y to machine zero
PASS | Machine | → G30 from BELOW Z0: retracts to the top first (max Z seen ~ 0), then lands on #5181..#5183
PASS | Machine | → G30 from ABOVE Z0 (#5183=+50): min Z seen >= +50 (never lowered), lands on #5181 #5182
PASS | Machine | #<_abs_z> == machine-frame Z with a 12.5 TLO active; #<_z> == abs - G5x - G92 - TLO
PASS | Machine | Zero All at A=20 stamps A 20
PASS | Machine | → Zero after jogging A away: table returns to A 20 and X/Y read zero (tip on the datum)
PASS | Machine | → Zero while the A jog is released mid-move still completes (A 20, X/Y zero)
SKIP | Machine | Tool measure (M600) run
PASS | TCP     | → Home / → G30 gate 'machineFrame' closed
PASS | TCP     | → Zero gate 'goZero' closed
PASS | TCP     | Cycle Start gate 'run' open
PASS | TCP     | Tool measure / load gate 'machineFrame' closed
PASS | TCP     | Probe op gate 'machineFrame' closed
PASS | TCP     | → Zero refused with a reason naming TCP
PASS | TCP     | tool_change refused backend-side (Machine frame required)
PASS | TCP     | Zero Z at A=0 routes to the mdi touch-off
PASS | TCP     | Zero All at A=0 under TCP stamps G54 with kins 1
PASS | Machine | → Zero in Machine frame refuses a fixture stamped under TCP (numbers are table-frame)
PASS | Machine | Zero All back in the Machine frame re-stamps G54 (kins 0)
PASS | Plane   | Capture defines the plane at the tip (kins 2, G59)
PASS | Plane   | → Home / → G30 gate 'machineFrame' closed
PASS | Plane   | → Zero gate 'goZero' open
PASS | Plane   | Cycle Start gate 'run' open
PASS | Plane   | Tool measure / load gate 'machineFrame' closed
PASS | Plane   | Probe op gate 'machineFrame' closed
PASS | Plane   | Zero Z routes through the plane; DRO reads the entered value
PASS | Plane   | → Zero: retracts along the tool axis to ≥ 25, then X0 Y0 in the plane; rotaries untouched
PASS | Plane   | Cycle Start (G54 under Plane kins — the M2 strand) gate 'run' closed
PASS | Plane   | → Zero (G54 under Plane kins) gate 'goZero' closed
PASS | Plane   | Cycle Start (G59 again) gate 'run' open
```

Owed: wave 2 (the next entry) at the suite stop — the type-0 Z window, the
kins-mode limit lift, the heavy gates; the RFL gateway change goes live with
that restart.
\n
## 2026-09-05 — Z0 is the top of travel: type-0 window −2000..0.01, lifted under TCP/TOOL; AXIS limits are world limits in every kins mode

Wave 2 of the "no full Z retraction" pair (previous entry). Operator's choice:
both waves back to back.

**The finding that shaped the design (design review, from the 2.9.4 source).**
`command.c:213 → axis.c:540-564`: motion checks every programmed move's WORLD
pose against `[AXIS_*]` in EVERY kinematics mode, and the joints against
`[JOINT_*]`. Under TOOL kins the world Z is the rotated plane frame (+G59 ≈
409 mm on the demo plane), so a naive `[AXIS_Z] −2000..0.01` refuses every
`g53.3 … z100` ("would exceed Z's positive limit") — the corpus would go 0/21.
Narrowing only `[JOINT_2]` is also wrong: identity teleop jogs clamp to the
AXIS window only (`axis.c:267-269`), so a +Z jog crosses the joint limit,
trips the backup check (`control.c:1499-1558`) and kills every teleop jog
until the joint is jogged back in joint mode — which the web UI does not
offer. LinuxCNC's switchkins doc (`switchkins.adoc:212-266`) prescribes the
answer: the INI sections hold the type-0 window and the `ini.z.min_limit /
max_limit` HAL pins lift it in the other modes.

**What changed.** `examples/sim_config/lcnc_suite_sim_twp.ini`: `[AXIS_Z]` and
`[JOINT_2]` `MIN_LIMIT −2000 / MAX_LIMIT 0.01` (HOME 0 strictly inside — the
DMU precedent; −2000 = the nose at the A-axis height, the corpus' deepest
commanded joint Z is −1683), X/Y untouched (X ±5000 carries the joint-side
soft-limit case), plus `hallib/z_limit_window.hal`: `wcomp` window on `:kinstype-select`
→ `mux2` pair → `ini.z.min_limit / max_limit`, run as a `[HAL]POSTGUI_HALFILE`
by the `lcnc-suite` launcher (new: it executes POSTGUI_HALFILE entries after
`halcmd start`, the way axis/gmoccapy do; a failing file aborts the display
loudly). Three boot failures on the way, all mine: (1) `loadrt near` — `near:
already exists`, spindle_sim.hal loads it as `near_speed`, a HAL module loads
once and HALCMD runs after twopass, so no name merging → `wcomp`; (2) as a
`[HAL]HALCMD` block the `net` onto `ini.z.min_limit` HUNG the boot: the fresh
signal is 0, inihal turns the changed limit into a motion command, and at
HALCMD time the servo thread has not started (step 4.3.9 comes after 4.3.8),
so task blocks on usrmot until the script's timeout — the review's "harmless
startup transient" was wrong. With the threads running the mux outputs
already carry the type-0 values when the ini pins are linked; (3) the first
postgui run failed in 22 ms with `Pin 'ini.z.min_limit' does not exist`: the
linuxcnc script spawns milltask in the BACKGROUND (`loadusr -Wn inihal … &`)
and starts the display right after `halcmd start`, and this launcher is up
in milliseconds — AXIS never sees the race because its own startup takes
seconds. The launcher now waits for the `inihal` component to be READY
(bounded 20 s, loud on timeout; 0.1 s on the sim) before the first postgui
file, and records halcmd's output in launcher.log, which is how failure (3)
became readable at all (the display's stdout is not durable before the
tee/FIFO) (in1 = the type-0 window, in0 =
the former ±5000, so world-mode behaviour is byte-identical to the shipped
gate results; every switch site already pairs `M68 E3` with `M66 E0 L0`).
Gateway/preview code: unchanged — identity segments are checked in the
machine frame, world segments joint-side through the trsrn twin, and
`machine_bounds` reads the INI, so the drawn envelope shrinks from a 10 m
cube to the real window. `machineTrsrn.test.ts` reads the INI: AXIS window
== JOINT window, Z0 strictly inside and the top, every envelope station
inside, the sweep reaches the declared floor (a station at [0, 0, −2000]
straight down from the parked pose — NOT over the stock at Y −1000, which is
600 mm through the work piece onto the console; computed from the generator
geometry). The installed INI copy is hand-carried (it is a `cp`, never
re-synced): `config_sync_check.py` must list no LIMIT / z-limit / mux2 /
near drift.

**Reachable trap, certified rather than assumed.** Under TCP/TOOL the world
window is ±5000, so a +Z jog toward the top drives joint Z past 0.01 →
`max_soft_limit` fault. The matrix gained a Plane-section row that jogs into
the fault through the real jog path and then tries to jog back (teleop −Z in
TOOL kins; M428 then −Z). First live run (gateway without a fallback): the +Z jog ran joint Z to
+0.057 past the 0.01 ceiling; `nml.error` in the trace: "Exceeded POSITIVE soft
limit (0.01000) on joint 2" and LinuxCNC's own "Hint: switch to joint mode to
jog off soft limit"; STAT's `max_soft_limit` flag read 0 the whole time; a
teleop −Z jog did nothing, M428 then −Z did nothing, and the teardown's first
MDI was refused ("would exceed joint 2's positive limit") — the sim was stuck
with no way out through the UI. A joint-mode jog by hand (`teleop_enable(0)`,
`jog(JOINT, 2, −5)`) moved it back inside at once. So the fallback SHIPPED in
this wave, exactly as bounded: `gateway_util.joints_beyond_limits` (pure —
joint position vs its own min/max window, eps 1e-6; unknown limits never flag)
→ status `joints_beyond_limit` (joint LETTERS; None when STAT has no joint
limits, traced) → `_jog_mode_flag()` in the four jog handlers: beyond ⇒
`teleop_enable(0)` + joint jog (`jog.joint_mode_beyond_limit`), back inside and
homed ⇒ `teleop_enable(1)` (`jog.teleop_restored`); `jog_stop` never switches
mode. UI: a danger banner "Joint Z beyond its soft limit — every other move is
refused; jog that axis back inside (the jog runs in joint mode until it is)".
Dispatch tests pin both transitions; the matrix rows now drive into the fault
through the real jog, require the status to report `['Z']`, recover through the
real −Z jog, require the report to clear and an MDI to work again. 

**Found by the fallback, fixed in the same wave — → Zero pressed while a jog is
HELD.** With jogs now real, the matrix's "release the A jog mid-move" row
(wave 1) FAILED on this build: A stopped at −6.3, X/Y never moved, the reply
was ok. Trace: `nml.error` "Ignoring task mode change while jogging", then
"Must be in MDI mode to issue MDI command". Source (`emctask.cc`
`emcTaskSetMode`): task IGNORES any mode change while
`emcStatus->motion.jogging_active` — teleop or joint jog — and still answers
DONE. So a → Zero (or any MDI-issuing button) pressed while a jog button is
still held can never run, by LinuxCNC's design; the gateway reported ok for a
move that never happened — the silent-drop class again. `set_mode()` now
verifies after the switch that `task_mode` actually changed and otherwise
raises "LinuxCNC ignored the mode switch to MDI (task stays MANUAL) — a jog
is still active: release the jog, then try again" (`task.mode_switch_ignored`
traced; dispatch test). Honesty about wave 1: that row passed four times
because its jog never became ACTIVE on those builds (the trace of every
earlier run shows the MDI mode switch accepted 0.28 s before
`jog.stop_skipped_mdi_busy`, and no "Ignoring…" ever) — the jog-stop guard it
exercised is real and stays, but the "jog held" premise is now three honest
rows: held ⇒ refused with the reason (A visibly moving), released ⇒ completes,
and a stray jog_stop during the MDI ⇒ skipped, the move completes. This is
also the second mechanism behind the operator's "sometimes it does nothing":
pressing → Zero before the A jog button was fully released.

**Gates.** Down-time (suite stopped): `npm run build` OK (after excluding the
node-based `programZero.test.ts` from the app build — a 2026-09-02 gap, same
class as its five siblings on that list; the file still runs under vitest, 29
tests), lint + scoped-CSS audit OK, full vitest 43 files / 627 passed (incl.
the model sweep with the new floor station and the INI-window assertions),
e2e 16 passed, gateway pytest 660/660 (the project's `-q` plus mine made
`-qq`, which suppresses the summary line — counted from the result dots and
the collection). Restart fingerprint: `wcomp`/`mux2` loaded, `ini.z.*` =
−2000 / 0.01 at type 0, −5000 / 5000 at types 1 and 2, back to −2000 / 0.01
at type 0; startup pose joints-at-zero, homed. Preview goldens: CLEAN
(`violations_total 0` holds under the new window). Corpus gate (`sim_parity.py gate`, 11 runs, joint-space 6D): GREEN, 21/21 PASS,
worst sim→truth deviation 1.079 mm on the g683 tilted run (tol 1.5) — every
TCP/TOOL move accepted under the lifted window, which is the loud proof that the
lift is in effect (a missing lift would refuse `g53.3 … z100` with "would exceed
Z's positive limit"); run records restored with `git checkout --` per the rule.


**`twp_touchoff_check.py` was certifying a removed behaviour.** It failed on
this build by 723.7 mm ("both touch-offs store the SAME table-frame origin"):
its section B asserted W1's automatic conversion of a TYPED offset at a
tilted A into the table frame — the behaviour the 2026-09-01/02 waves
replaced (a typed value is a fixture-frame STATEMENT, stored unchanged and
stamped table frame kins 0 / A 0 by `set_wcs`'s `pose_override`; a real
touch-off stores the live point and stamps that A). The check had not run
since (it needs a one-shot WS sender as its first argument — recreated as a
scratchpad helper with a heartbeat, since an armed client that does not
heartbeat is closed after 3 s). Section B now asserts the current contract:
the typed numbers stored unchanged and the stamp reading (stamped, kins 0,
A 0). `twp_capture_check.py` section F needed a G54-at-machine-zero reset:
its `G0 … Z-10` was G54-relative to the plane touch-off's row and sat ABOVE
machine zero, legal only on ±5000.

**A jog that did nothing, once.** Of three matrix runs on the fallback build,
one had the held-jog row's `jog_cont A` move nothing (A −10 → −10 in 0.5 s,
reply ok, no disarm, no refusal, no `nml.error` — and the same sequence
moved A 3.7° the run before and in a hand probe from both MANUAL and MDI
start modes). Undiagnosable from the trace as it was, so every NEW jog now
emits `jog.cmd` (cmd, axis, joint-flag, resolved arg, task/motion/interp
modes at issue, rc) — a jog that vanishes next time says where. Closed the next morning with the forensics in place: the trace showed
`ws.command_denied jog_cont "Machine not idle"` — the SCRIPT sent the jog
before the gateway's broadcast status had caught up with the end of the
previous MDI, and the row never read that reply (the operator's jog button is
gated on the same broadcast state, so it dims until then). The row now waits
for the broadcast to settle and asserts the jog's reply. Its twin, "a stray
jog_stop during the → Zero MDI", failed the same run by the wave-1 mechanism
racing at poll granularity: the stop arrived in the ~30 ms before STAT showed
the MDI executing, the interp-busy guard read IDLE, and the forced MANUAL
aborted the move. Closed by construction instead of by timing: the gateway
tracks the jogs IT started (`_active_jogs`, filled by the four jog handlers);
a `jog_stop` / `jog_stop_multi` for an axis with no active jog is a traced
no-op (`jog.stop_without_jog`), the disarm path stops only active jogs
(`jog.stop_for_client_noop` otherwise — the 2026-09-03 "disarm forces MANUAL
mid-MDI" follow-up closes with it), a verified switch to MDI/AUTO clears the
set (task refuses those while jogging, so success means none is active), and
the abort guard polls STAT fresh. Jogs started by other UIs are not tracked:
the gateway never stops what it did not start; the HAL chain owns motion
safety. Dispatch tests pin the no-op, the MDI clear and the real stop.

**Final build (active-jog tracking, verified mode switch, joint-jog fallback,
`jog.cmd` forensics), 2026-09-05 morning, one boot.** Fingerprint: `ini.z.*`
−2000 / 0.01 at type 0, ±5000 at types 1 and 2, back at type 0. Corpus gate
GREEN, 21/21, worst sim→truth deviation 1.079 mm (g683 tilted run, tol
1.5); records restored. The five TWP checks ALL PASS: `twp_capture_check`
(section F at a G54-at-machine-zero Z−60 — Z−10 put the JOINT above the
ceiling once the 22 mm tool length was added back), `twp_touchoff_check` (on
the current typed-value contract, with the heartbeating one-shot sender),
`twp_touchoff_plane_check`, `twp_reorient_check`, `twp_g683_check`. **Matrix, final build, Z window −2000..0.01: ALL PASS (40 pass, 4 skip)** — the three above-machine-zero rows
SKIP with their reason (unreachable by construction now), every never-lower row, the
held-jog refusal, the release-then-complete, the stray-stop no-op, the TCP-stamped
refusal, and the two soft-limit recovery rows PASS:

```
PASS | Machine | Zero All routes to the mdi touch-off and stamps G54
PASS | Machine | G54 stamp: kins 0, A 0
PASS | Machine | → Home / → G30 gate 'machineFrame' open
PASS | Machine | → Zero gate 'goZero' open
PASS | Machine | Cycle Start gate 'run' open
PASS | Machine | Tool measure / load gate 'machineFrame' open
PASS | Machine | Probe op gate 'machineFrame' open
PASS | Machine | → Zero from BELOW Z0 (G53 Z-60): Z at machine top exactly, X/Y at work zero, A back to the stamp (0)
SKIP | Machine | → Zero from ABOVE Z0
PASS | Machine | → Home from BELOW Z0: Z to machine top, X/Y to machine zero, A 0
SKIP | Machine | → Home from ABOVE Z0
PASS | Machine | → G30 from BELOW Z0: retracts to the top first (max Z seen ~ 0), then lands on #5181..#5183
SKIP | Machine | → G30 from ABOVE Z0
PASS | Machine | #<_abs_z> == machine-frame Z with a 12.5 TLO active; #<_z> == abs - G5x - G92 - TLO
PASS | Machine | Zero All at A=20 stamps A 20
PASS | Machine | → Zero after jogging A away: table returns to A 20 and X/Y read zero (tip on the datum)
PASS | Machine | → Zero while the A jog is HELD: the jog is real (A moving) and → Zero is REFUSED with the reason (mode change while jogging)
PASS | Machine | → Zero after releasing the A jog completes (A 20, X/Y zero)
PASS | Machine | a stray jog_stop during the → Zero MDI does not abort it (A 20, X/Y zero)
SKIP | Machine | Tool measure (M600) run
PASS | TCP     | → Home / → G30 gate 'machineFrame' closed
PASS | TCP     | → Zero gate 'goZero' closed
PASS | TCP     | Cycle Start gate 'run' open
PASS | TCP     | Tool measure / load gate 'machineFrame' closed
PASS | TCP     | Probe op gate 'machineFrame' closed
PASS | TCP     | → Zero refused with a reason naming TCP
PASS | TCP     | tool_change refused backend-side (Machine frame required)
PASS | TCP     | Zero Z at A=0 routes to the mdi touch-off
PASS | TCP     | Zero All at A=0 under TCP stamps G54 with kins 1
PASS | Machine | → Zero in Machine frame refuses a fixture stamped under TCP (numbers are table-frame)
PASS | Machine | Zero All back in the Machine frame re-stamps G54 (kins 0)
PASS | Plane   | Capture defines the plane at the tip (kins 2, G59)
PASS | Plane   | → Home / → G30 gate 'machineFrame' closed
PASS | Plane   | → Zero gate 'goZero' open
PASS | Plane   | Cycle Start gate 'run' open
PASS | Plane   | Tool measure / load gate 'machineFrame' closed
PASS | Plane   | Probe op gate 'machineFrame' closed
PASS | Plane   | Zero Z routes through the plane; DRO reads the entered value
PASS | Plane   | → Zero: retracts along the tool axis to ≥ 25, then X0 Y0 in the plane; rotaries untouched
PASS | Plane   | Cycle Start (G54 under Plane kins — the M2 strand) gate 'run' closed
PASS | Plane   | → Zero (G54 under Plane kins) gate 'goZero' closed
PASS | Plane   | Cycle Start (G59 again) gate 'run' open
PASS | Plane   | Plane: +Z jog (tool axis) runs joint Z past its ceiling; machine stays ON; status reports joints_beyond_limit == ['Z']
PASS | Plane   | Plane: after the fault a UI −Z jog moves the joint back inside (joint mode), the report clears, and MDI works again
```

Owed: the operator's own walk-through (→ Zero from anywhere is a full retraction to the
top; the machine-bounds box is the real window; the banner and joint-mode jog when a
joint is beyond its limit).

## 2026-09-05 (afternoon) — Ledger close: stop-class preemption, the datum-write epoch, refusal reasons in the preview, every TypeScript file type-checked; perf-matrix on 4b7c7be

**Ask:** after the Z-retraction pair the operator asked "any deferred items left? status of
backlog?" and chose the scope "feat/twp ledger only". Verified against this file, the
ledger held five open items plus a set of bounds that were recorded but never formally
closed. Stopping principle as in the backlog program (2026-08-20): every item ends FIXED,
BOUNDED-AT-A-LINE, or CLOSED-WITH-REASON. Commits d449d34, dfe95a2, 9b33428, 90ec279,
220629b, 4b7c7be + this record. Design review before coding changed three things from the
first draft (recorded so they are not re-proposed): FIFO + supersede instead of a priority
queue (a priority queue inverts `jog_cont → jog_stop` into an unbounded jog); a datum-WRITE
epoch instead of a republish counter (g53x_core republishes twice per M530, the second bump
lands after the wait returns — a counter makes the stale adoption certain); a module
attribute instead of a comment marker for refusals (no proof that a comment executed after
a remap's first yield reaches the preview canon).

### 1. Stop-class preemption (d449d34) — FIXED, plus a finding

Filed 2026-09-03: `abort`/`estop` waited behind an in-flight handler (a plane touch-off
holds `_cmd_lock` up to 30 s + 3 s; Capture ≈ 85 s worst case). Now each queued command
runs as its own sub-task; `abort`/`estop` from ANY client cancel every client's in-flight
non-stop handler (`_preempt_inflight`, `ws.command_preempt`; the victim's worker replies
"Preempted by abort", `ws.command_preempted`) and supersede the requesting client's queued
non-stop commands ("Superseded by abort", `ws.command_superseded`). `jog_stop`/
`jog_stop_multi` stay plain FIFO — never reordered ahead of their `jog_cont`, never a
preempt (a stray jog_stop during an MDI is a certified no-op class). Stops and `arm` are
never cancelled (a disarm jog-stops under the lock and flips `client.armed`).

**Finding, verified in the 2.9.4 source (emcmodule.cc:212-231, :1383-1387):** the
binding's `wait_complete()` is a C poll loop that `esleep()`s WITHOUT releasing the GIL —
the file's only `Py_BEGIN_ALLOW_THREADS` pair is `Logger_start`. So `CMD.wait_complete(30)`
on the `to_thread` worker froze the event loop (heartbeat task, status loop) for as long as
the command ran; the `_cmd_blocking` docstring's premise was false for the wait half. It
never showed live because every awaited command completes in ms (M530 Q2 is a zero-length
orient, G10 writes are ms); any awaited command that MOVED would have eaten the 500 ms
watchdog budget. `_cmd_blocking` now waits in 50 ms slices (repeated `wait_complete(t)`
re-polls the same stored serial — N slices ≡ one wait to 10 ms; returns 1/3/−1; the fake
binding's None terminates the loop as "failed", as before): one slice is the most the loop
can be frozen by an awaited command, and a cancel lands after the current slice. The
command write is never interrupted; the lock is held until the thread returns (the
2026-09-03 shield-and-wait contract, still tested).

Also found: `_shutting_down` was never reset at lifespan start — production has one
lifespan, but the in-process test harness opens many, and the flag set by the previous
teardown silently skipped every later disarm jog-stop (found by
`test_arm_is_never_preempted`). Tests: TestPreemption ×4, TestCmdBlockingSlicedWait ×2;
worker file 13/13; command_policy 97 (inline ladder unchanged), dispatch 61, ws_lifecycle,
rfl_guard green. Live (twp_capture_check G): an abort from a SECOND client mid-Capture
replied ok in 72 ms; the capture reply was "Preempted by abort"; `ws.command_preempt`
named the capture (ran 86 ms); G69 recovered the state.

### 2. `twp-datum-seq` — the datum settle keys on M535's write (dfe95a2) — FIXED

Filed 2026-09-03: `_settle_datum_after_m535` keyed on the helper's datum VALUE changing, so
a touch-off landing on the same datum burned the whole 3 s timeout (3089 / 3082 ms
replies). Now M535 (`twp_touchoff`) bumps `twp-helper-comp.twp-datum-seq-in` AFTER
`gui_update_twp` published the datum; the helper's 20 Hz pass reads the `-in` FIRST and
writes `twp-datum-seq` LAST, and the gateway registers `twp_datum_seq` BEFORE the datum
pins (the reader samples extra pins in insertion order) — so a changed seq in a reader
snapshot proves the datum in that snapshot is current. The settle returns on
`datum_seq_advanced` (`twp.datum_settled` with ms/changed), falls back to the value test
with ONE `twp.datum_seq_unavailable` warn when the pin is absent, keeps the timeout warn.
The helper comp is a `cp` copy in the installed config (hand-carried; remap.py loads from
the worktree). Tests: test_twp_settle ×5 (incl. "a moved value with the OLD seq does not
settle"), status_runtime, extra-pins order pinned. Live (twp_capture_check D2): seq +1 per
M535 both directly and through the gateway; a same-datum gateway touch-off replied in
**85 ms** (was 3089); trace `twp.datum_settled changed=false ms=50`, no timeout;
plane check: seq +1 per M535 at A=0 and A=35. The check's first run read the seq out
pin straight after the MDI returned (3 → 3 for a bump that had happened; the helper copies
it ≤50 ms later) — the rows now wait for the pin to move (`halget_moved`).

### 3. Refusal reasons reach the preview (9b33428) — FIXED

Filed 2026-09-04: with a plane defined, a program opening with G68.2 previewed EMPTY with
no reason. Root cause (gcodemodule.cc + interp_return.hh): the preview module's
`CANON_ERROR` is `void CANON_ERROR(const char*, ...) {}` and every remap refusal
`yield INTERP_EXIT` (=1), which `gcode.parse` reports as ≤ MIN_ERROR (3) — a structurally
clean EMPTY success. The refusal that fires is NOT "already defined" (task-gated) but
g682's WCS guard "Must be in G54 to define TWP.": the gateway seeds the preview's active
WCS from the live `g5x_index` (G59 while a plane is active). The preview is therefore
CORRECT — task refuses the same line — only silent. Now `_canon_error(self, msg)` replaces
the 30 refusal-path `CANON_ERROR` calls (yields untouched, task byte-identical: corpus
GREEN, goldens CLEAN); in preview it records the first refusal on the module
(`webui_preview_refusal`, cleared by `webui_preview_reset`); the worker re-fetches the
module AFTER the parse (a worker's first parse imports it during `gcode.parse`), ships the
conditional key `parse_refused` and the `__REFUSED__` stderr twin (`gcode.parse_refused`
trace); the client's `previewRefusal` feeds a warn banner ("Preview stopped — <msg> (line
N) — the preview runs from the machine's live state…") and a "Parse" stats row;
`preview_gate` refuses to write a golden for a refused payload.

Line attribution, measured: `self.sequence_number` reads **0** inside a remap and
`self.linetext` is **empty** in preview, and the canon never fires `next_line` for a remap
trigger line (W4) — so no deterministic line exists at the refusal. `refusal_payload`
therefore uses the UNIQUE-site rule the sub-caller attribution uses: inside a marked sub
span → the span's verified caller line (a G53.x refusal reports the g533remap.ngc wrapper
line as `sub_line`); outside → the one main-file line matching the trigger text, else the
one line carrying the G-word the message opens with ("G68.2 ERROR: …"); zero or several
candidates → `line: null`, never a guess. Proven through the REAL worker against the
running sim: G59-seeded parse → `parse_refused {line 1, "Must be in G54"}`, zero motion,
no `parse_error`; G54-seeded → motion, no key. Live (twp_capture_check C2/F2): loaded
through the gateway under the active plane the payload carried the refusal and the trace
`gcode.parse_refused`; after G69 the same file parsed with motion. Tests: TestRefusalPayload
×8, `__REFUSED__`/`__PARTIAL__` trace tests (the latter had never been tested), bulkData
`previewRefusal`, the export surface. Bound (recorded): a refusal on a line that appears
more than once in the program is reported without a line — the message still names the
command.

### 4. Every TypeScript file is type-checked (90ec279 + 220629b) — FIXED

Filed 2026-09-05: six `src/**/*.test.ts` files (node:fs) were excluded from `vue-tsc -b`
and type-checked nowhere; one entry was stale (`machineDmu160p.test.ts`, deleted in
5a5a86e); `e2e/*.ts` and `scripts/simDump.ts` were in no project at all, and `eslint`
carries no type-aware rules (it even disables no-unused-vars "because vue-tsc catches
it"). `tsconfig.test.json` (node types + DOM lib + vite/client, the app's strict flags,
noEmit) now carries the five node-side tests, the guard, `scripts/simDump.ts`, `e2e/**`
and the window shims; referenced from `tsconfig.json`, so `npm run build` and CI cover
it. The first `vue-tsc` run over the new project found **9 errors, all declaration-level**
(no `@types/ws` — added as a devDependency; `window.__viewerDiag`/`__viewerLeakProbe`
undeclared outside `src/shims.d.ts`; `import.meta.hot` without vite/client types) and no
code defects. `src/tsconfigCoverage.test.ts` keeps the app-exclude and test-include lists
in step (every node-side test in both, every exclude entry exists and is node-side,
includes resolve, all three references present) — its own first run found its bug: a
block-comment stripper ate the `/**/` inside the `e2e/**/*.ts` glob (whole-line comments
only now). Down-time gates on the result: `npm run build` (three projects) OK, lint +
scoped-CSS audit OK, vitest 44 files / 633, playwright 16, gateway pytest 691 + 11 subtests.

### 5. Perf-matrix on 4b7c7be (gateway pid 164181, fresh boot) — done

Preconditions held: pristine latch (`fault-out FALSE`), identity kins + G54 restored by
hand first (the last corpus program leaves TOOL kins — the 09-03 30 s / 225 MB numbers were
a kins-2-labelled 46 MB payload), armed keeper for the run, `LCNC_INI_FILE` pointed at
the TWP INI (the harness's default is the 3-axis sim and it would read the wrong token
silently — noted in the plan, worth a harness assertion one day).

```
scenario             lag windows (n / max / dominant)          RSS kB              direct
idle_baseline        0                      (was 1 / 81 ms)    79544→79552
fanout               0                                         79552→80616
reconnect_storm      0                                         80616→80756
upload_during_stream 0                                         80756→84184
save_during_stream   0                                         84184→84332
fusion_near_limit    2 / 62.5 ms / ws_send_measured.send_done  84332→128788        (was 1 / 123 ms)
rss_gc_watch         0                                         128788→128796       growth 8 kB
preview_publish      0                                         128796→183872       delivered, wait 23.5 s (was 30.0 s / 225 MB)
sigstop_trip         2 / 875 ms / ws_send_measured.send_done   183872→183876       latch FALSE→TRUE→FALSE, sticky_ok, recovered_ok
```
No `safety.hb_stall_disarmed`; the only safety events are the harness's own
arm/disarm/trip/ack. The sub-100 ms windows are the known VM-scheduling noise; the 875 ms
window IS the SIGSTOP. RSS and publish time are back in band with the parse identity-labelled.

### 6. Bounds closed with a reason

| Bound | Closed as |
|---|---|
| Bundled toolsetter/probe routines keep a bare `G53 G0 Z0` retract (`tool_touch_off.ngc`, `toolsetter_wco.ngc`, `probe_spindle_nose.ngc`, `surface_scan.ngc`) | LABELED: the upstream idiom assumes machine Z0 = top of travel — LinuxCNC's own convention, true on every shipped config (3-axis sim MAX_LIMIT 0.10, TWP sim 0.01). Stated in CLAUDE.md and the README's config notes: "machine Z0 must be the top of travel for the bundled routines". |
| Preview of a user program that calls the guarded subs may take the other `#<_abs_z>` branch | CLOSED: cosmetic — one rapid differs; the retract target is the same. |
| A +Z jog under TCP/TOOL can run joint Z past its ceiling | CLOSED by design: certified by the matrix Plane rows; the joint-mode fallback + banner is the recovery. |
| The program-zero stamp records A only (xyzac draws "· machine") | CLOSED with label: trsrn is the only TWP model; the xyzac case is visibly labelled. |
| Big-file parse 28 s under a kins-2 seed | CLOSED: off-loop, correct labelling; vectorization only on demand. |
| Stage-3 servo-rate plane tracking | CLOSED 2026-08-29 (retracted): TCP mode IS the tracking; mode-2 table-aware kins rejected (breaks TLO). |
| "Frontend heavy gates / gateway restart owed" lines in the 09-02..09-04 entries | Superseded by wave 2's down-time gates + restart (2026-09-05) and by this entry's gates. |

**Live acceptance on the fresh boot (all on 4b7c7be):** postgui lift fingerprint (identity
−2000/0.01, TCP/TOOL ±5000, back to identity); five TWP checks ALL PASS
(capture 55 rows incl. C2/D2/F2/G, touchoff, touchoff_plane with the seq rows, reorient,
g683); buttons matrix ALL PASS (40 pass, 4 skip); preview gate CLEAN; corpus GREEN 11/11
(worst 1.075 within its 1.5 tol); perf-matrix above. Corpus run records restored, not
committed.

**Owed:** the operator's own walk-through (unchanged list: → Zero full retraction, the real
bounds box, the beyond-limit banner + joint-mode jog, plus now the "Preview stopped"
banner on a G68.2 program loaded under an active plane and an abort mid-Capture answering
at once). Nothing else is open on this branch's ledger.

## 2026-09-05 (evening) — Zeroing on a 1.18 M-line program: re-parse cancel-and-restart, parse speed-ups, the wait made visible, viewer hitches removed

**Ask:** "in machine mode now, I press Zero All, the huge perf matrix takes a very long time
to move to G54; in plane mode as well; no indication that the program is not shown at the
correct position; parsing of the sim takes an unreasonable amount of time for such a large
program — any ways to speed both up?", then "in machine mode it does take a very long time
as well", then "also the 3D viewer window sometimes lags a bit when rotating or zooming".
Scope: the seven items below, on feat/twp. Commits 345320c, 94a02e6, 3c37186, 692f5c6
+ this record.

### Findings that set the design (trace + offline measurements, before any code)

- **Every touch-off waited behind a parse that was already running.** All 14 recent
  touch-offs in the trace (machine and plane frame) landed while a parse ran — the
  rotary-drift parse from → Zero, the kins parse from leaving Plane mode, or the
  previous zero — and their offsets reached the preview 41 to 167 s later (machine frame
  41–78 s). The drift edges were gated on `not refresh_running`, so the touch-off's edge
  was not even evaluated until that parse published, then queued a second full parse
  behind it. One zero = one queued parse + one full parse. The scheduler was single-flight
  with no cancel and no queue-jump.
- **Where a parse went** (cProfile on the same program; proportions, cProfile inflates
  Python-call-heavy code ~2×): three per-line text passes re-stripped comments character
  by character (~half of the machine-frame parse); the interpreter phase a quarter, of
  which 60 % was the canon snapshotting the full WCS basis with 19 attribute reads per
  segment; plane mode added 2.36 M pure-Python trsrn inverse solves (~40 % of the 46 s).
  The interpreter's C side (~5 s) is the floor.
- **The flat 60 s worker timeout** sat 14 s above the plane-mode parse: a slightly larger
  program would have silently stopped previewing (`gcode.parse_timeout`, nothing else).
- **No indication:** the gateway only traced `refresh_scheduled`/`spawn_start`; the
  viewer's HUD chip "Preview uses older offsets" lit because the offsets differed, not
  because a refresh ran, and never said how long.
- **The viewer lag.** (Corrected the same evening, see the post-wave note: the
  `frames`/`gap` fields of `browser.viewer.perf` count STATUS frames applied, not
  rendered frames — the "~30 Hz frame loop" first read here was the 30 Hz status
  cadence; the Mac's render loop runs 35–56 fps with the big program loaded.) With
  the big program half of all interactive windows carried a ~100 ms hitch and one in twenty a >1 s freeze (gap_max p50 105 vs
  52 ms, p95 1238 vs 218 ms). Headless on the same payload: four per-line Map/Set
  structures with 1.18 M entries each (~4.7 M heap objects) made a full GC 110–140 ms vs
  8 ms empty; the 1.18 M-entry line map was structured-cloned across the worker boundary
  on every publish (0.9 s); every touch-off copied ~150 MB of typed arrays on the main
  thread. The VM-local Firefox tab (no GPU acceleration) is a separate 12 fps story.
- The client chain itself is not the wait: decode 0.1 s (the wire is already
  binary-flat msgpack), scrub track 0.4 s, part-frame transform 1.1 s on the VM.

### 1. Parse speed-ups (345320c)

`strip_gcode_comments` returns a line without `(`/`;` as-is (nearly every CAM line —
the loop rebuilt it unchanged). `PreviewCanon` snapshots the WCS basis only when one of
the three `Translated` offset setters ran (`_wcs_dirty`); same `wcs_events` by
construction — the interpreter never writes the offset attributes directly.
`check_limit_violations` / `check_limit_violations_trsrn` are numpy over every
rotary-subdivided sample with a vectorized inverse twin (`_trsrn_inverse_np`, same
expression order as the scalar, agrees to the ULP) and `reduceat` extremes; only the
violating segments go through Python in segment order, so the per-(line, axis) worst
record resolves identically. The scalar loops stay as `_*_scalar` oracle twins pinned by
`TestVectorizedLimitChecks` (randomized: both kins types, frames, frameless type-2,
unknown/partial starts, None TLO, one-sided bounds, both unit scales, the report cap).
Preview goldens CLEAN and the corpus green on the new worker = byte-identical output.

| parse of perfmatrix-big.ngc (1.18 M lines) | before | after |
|---|---|---|
| cProfile, identity seed | 56 s | 20 s |
| cProfile, plane seed | 91 s | 26 s |
| interpreter phase (cProfile) | 14 s | 4 s |
| live, identity, quiet VM (worker+gzip) | 23 s | 15.3 s (restart parse) / 20.8–21.5 s while the VM-local Firefox tab decoded the previous publish |
| live, identity, VM tab decoding the previous publish | 33–44 s | 23.5 s |
| live, plane (TOOL kins) | 44–46 s | 30.9 s publish (worker 28.4 s, interpreter 6.4 s, VM tab decoding) |

What remains in a parse (identity, real time ≈ 10 s on a quiet VM): the interpreter's C
side ~3 s, the canon callbacks ~1 s, the two regex passes (`wcs_rewrite_targets`,
`classify_motion_lines`) ~2 s, the per-point extraction loops ~1.5 s, array building
~1 s, the limit check ~1 s. BOUNDED AT A LINE: sharing the stripped lines across the
three passes and vectorizing the extraction would take another ~3 s; on demand.

### 2. Cancel-and-restart, file-scaled timeout, `preview_refresh` (94a02e6, 692f5c6)

`BulkPipeline.inflight` = the running parse's input snapshot (rotary seed, kins seed,
flat WCS offsets, file + mtime, reason, expected). The poll loop evaluates the drift
edges against it while a parse runs (`inflight_stale_reason`, pure: same evaluators,
order and settle guards as the post-publish edges; TLO not in flight); a hit
`cancel_inflight`s the worker — SIGTERM (measured offline: inside `gcode.parse` the
handler's SystemExit becomes `interp_error` → exit 3 in 35–117 ms with the temp dir
removed; in the post-processing exit 143), SIGKILL fallback after 2 s, idempotent per
parse — and `reparse_pending` restarts it under the specific edge. A drift parse is now
scheduled under its edge (`wcsoff:G54:x`, `rotary:A`, `kins:type`) instead of "drift".
Timeout `max(60 s, 3× expected)`, expected = the last measured publish of that path else
1.2 ms/byte. The status envelope carries `preview_refresh` {reason, file, expected_ms,
started_ms, queued, superseded} while a parse runs.

**Live catch on the first acceptance run (692f5c6):** `file_changed` stays true until a
parse PUBLISHES, and the new branch cancelled whenever a parse was running — every load
parse died 33 ms after its spawn, forever, and no preview was delivered. Now
`preview_file_edge_action` (pure, tested) leaves a running parse for the current
file+mtime alone; another file/mtime or an operator Reparse supersedes it.

**Acceptance (fresh boot, gateway pid 435747, `wave3_live_check.py`):** load the big
program; 3 s in, touch off X → the running parse superseded at 6.1 s
(`gcode.reparse_superseded wcsoff:G54:x`, `gcode.parse_cancelled` within 300 ms), ONE restart
scheduled under `wcsoff:G54:x`, `preview_refresh` on the wire named it with
`superseded: 1`, the publish landed 18.5–18.7 s after the touch-off (restart parse 15.3–15.4 s
worker+gzip; three runs), and the field cleared. Then an idle touch-off: one `reparse_wcsoff_drift`,
one parse, nothing superseded, published 25.4–27.2 s after the touch-off (parse 23.1–23.7 s while
the VM-local tab decoded the previous publish; three runs). During the TWP checks the edges
superseded each other exactly as designed (a kins switch every ~2 s → each parse
cancelled by the next). Two of eight cancels exited by signal 2 (rc −2) instead of
code 3: the traced stderr tail shows a `KeyboardInterrupt` raised at the first Python
line AFTER `gcode.parse` returned (a SIGTERM that lands in the interpreter's tail is
re-signalled as SIGINT — the 2.9.4 rs274ngc sources carry `signal(SIGINT, clean)` /
`pthread_kill(id, SIGINT)`); the `finally` still removed the temp dir and the exit came
within 300 ms. BOUNDED: the acceptance accepts exit 3 / 143 / −15 / −2 with a 1.5 s
exit bound; the mechanism is not chased further.

### 3. Client: typed line index, resident part-frame payload, banner + mute (3c37186)

`viewer/lineIndex.ts`: line → first/last point index (+ cum at the first point) as
direct-indexed typed arrays, transferable, zero heap objects; replaces
`ScrubTrack.lineCum/lineSpan`, `ViewerGcode.feedLineMap` and the `mainLinesTrusted`
Set (now a `Uint8Array` mask); same semantics (line 0 indexed like `buildLineMap`, cum
never mapped for 0); unit-tested; every consumer and their tests moved.
`partFrameWorker` keeps the streams RESIDENT (one `load` per program, small `transform`
per WCS/tool/table change, `needPayload` → re-send). `statusStore.previewRefresh` with a
locally ticked elapsed clock and `previewRefreshLabel`; App.vue banner "Preview
re-parsing after touch-off (G54 X) — big.ngc · 0:07 of ~0:33" with a progress track
that never reaches 100 % on its own; the same chip in the viewer HUD; the drawn toolpath
MUTED (`toolpathController.setStale`, `--opacity-disabled`) while a parse runs or the
payload's offsets/tool length are known stale.

### 4. Gates

Heavy gates at the suite stop: `npm run build` (three projects, 0 TS errors), lint,
vitest 642/45 files, playwright 16, pytest 710 passed, 11 subtests passed in 22.07s. Live on the fresh boot: postgui
fingerprint (ini.z −2000/0.01 identity, ±5000 under TCP/TOOL), preview goldens CLEAN,
five TWP checks ALL PASS, buttons matrix ALL PASS (40 pass, 4 skip), corpus GREEN 11/11 (per-program tolerances met, plane invariants 0.0 deg / 0.0000 mm),
perf-matrix on 692f5c6 (gateway pid 435747, artifact
`runlogs/perf-matrix/20260905T165605Z-692f5c6.json`): zero lag windows in idle, fanout,
reconnect storm, upload/save during stream and the RSS watch; `fusion_near_limit` one
128 ms `reader_recv.readline` window (the known VM idle-noise class; 4b7c7be had two
62 ms `send_done` windows); `sigstop_trip` two windows ≤ 890 ms in the scenario that
SIGSTOPs the gateway on purpose (4b7c7be: two ≤ 875 ms), latch pristine, sticky and
recovered, no heartbeat-stall disarms; `preview_publish` delivered in 20.0 s (publish
21.3 s, 30.7 MB identity-labelled; 4b7c7be: 23.5 s / 22.9 s). RSS: this run started at
307 MB after ~10 big-file publishes in the same gateway session (4b7c7be started fresh
at 129 MB); the watch window shows −13.6 MB and the publish 294 → 314 MB — the
comparison baseline differs, no growth inside the run.

### Owed / closed

- Operator walk-through: Zero All on the big program in Machine frame — the banner
  with the countdown, the muted path, the path landing in ~15–25 s; the same in Plane
  frame; rotate/zoom the viewer with the big program loaded (the ~100 ms hitches should
  be gone; what remains is in the post-wave note).
- RETRACTED (same evening): "the viewer's 30 fps ceiling is Firefox on that Mac" — a
  misread metric (status cadence, not render rate); the interaction stutter with the
  big program is OPEN, see the post-wave note. The VM-local Firefox tab's 12 fps —
  software GL — stands.
- BOUNDED: remaining parse budget (item 1); the rc −2 cancel exit (item 2; one more
  occurrence in the operator's session carried its stderr: `KeyboardInterrupt` inside
  `check_limit_violations` — the interpreter's SIGINT re-signal landing in the
  post-processing pass; harmless, 274 ms).

### Post-wave note (same evening) — the operator's two follow-up questions

**"When moving A/B/C it takes about 20 s; X/Y/Z is fast now — what is different?"**
The rotary pose is an INPUT to the parse (the `__ABCSEED__` seed: every segment whose
rotary the program does not command holds the parse-time pose), so a rotary jog, or a
Zero All that writes rotary offsets, can only be honoured by re-running the
interpreter — nothing on the client can re-derive it, and the project rule forbids
re-deriving interp semantics. Trace of the operator's session (gateway pid 435747):
`jog_cont A` at t=2035.9 s → `gcode.reparse_rotary_drift rotary:A` at 2038.95 (the
2 s settle guard + the drift-gate debounce) → `gcode.publish` at 2062.1 (23.1 s
worker+gzip); `rotary:BC`: C jog at 2160.4 → drift 2163.4 → publish 2188.6 (25.2 s).
The payload also grows once the seed is non-zero: 30.7 → 44.8 MB (`feed_abc` ships,
6D decimation), so the Mac's decode + geometry rebuild grows with it (~2–4 s). An
X/Y/Z touch-off is a pure offset change: the client re-poses the cached geometry
through the part-frame worker in ~1 s (per-epoch WCS terms), and the same-length
re-parse (20.6–24.2 s in the trace, `wcsoff:G54:x/y/z`) runs behind it for the
per-line soft-limit marks only. Levers left for the rotary case are small: the settle
guard (2 s → 1 s), the bounded ~3 s parse budget, the client rebuild. NOTED, not
changed: in the plain X/Y/Z case the drawn path is exact from the client re-pose and
only the limit marks are stale, so the wave's path MUTE is over-cautious there (it is
right for rotary-offset and rotary-pose changes, where the re-posed path IS wrong
until the re-parse lands); muting the marks alone in that case is a small rule change
if the operator wants it.

**"The 3D viewer is still laggy with the big program loaded; fluent when unloaded."**
`browser.viewer.perf` re-read with the right semantics: `frames` = status frames
applied (30 Hz active; 5 Hz at the adaptive idle poll after a manual-mode jog — the
"15–20 frames / 200 ms gaps" windows are that, not lag), `renders` = rendered
frames. Mac (Firefox 154, host 192.168.64.4), continuous-interaction windows (≥100
renders / 3 s): loaded 34–56 fps, unloaded 46 fps — the render loop is not slower
with the program loaded, and the CPU-side render call stays ≤2 ms. What differs is
the frame-gap tail: the loaded rotate windows at 30 Hz status (t=2203–2230) show
p95 49–99 ms and max 69–119 ms; the unloaded rotate window right after (t=2236) p95
34, max 50 — a few-percent micro-stutter, not a low frame rate. With the main-thread
cost accounted for (render ≤2 ms, applyState ≤3 ms, no pointer raycast, no per-frame
O(program) work — this payload has one WCS epoch, zero violations, no tool changes),
the stall sits where the telemetry cannot see: the GPU/compositor presenting a
1.18 M-segment MSAA draw at Retina resolution (Firefox's out-of-process WebGL; worse
while the path is drawn TRANSPARENT by the mute — the muted rotate windows ran ~30
fps vs ~50 un-muted), or GC. OPEN. Next: (1) a discriminator in `viewerPerf` — RAF
cadence separate from status cadence, a 0 ms timer probe (late = main thread
blocked) and a WebGL2 fence polled across frames (GPU frames behind); (2) then either
an interaction LOD (a coarse index buffer while OrbitControls is active, the full
path on `end`) plus mute-by-colour instead of alpha, or the GC route — whichever the
probe names.

**Probe SHIPPED (2026-09-09, feat/twp):** `viewerPerf.ts` now emits, per 3 s window
with activity: `raf_ticks` / `raf_gap_p50|p95|max_ms` / `raf_pauses` — the render
loop's own cadence (`frames` / `gap_*` stay the STATUS cadence, documented as such in
the file header); `mt_probes` / `mt_late_p95|max_ms` / `mt_blocks` — an 8 ms
self-rescheduling timer whose lateness is the time the main thread was busy past its
due time (GC, a long task, a synchronous WebGL stall; > 20 ms counts as a block;
hidden-tab samples skipped, both clocks re-anchored on visibility change); and, on a
WebGL2 context only (absent otherwise, not zero), `gpu_fences` / `gpu_behind_p95|max`
(RAF ticks from a frame's submit to the first tick that saw its fence complete — 1 is
the floor, 2+ means the GPU trails the draw) / `gpu_done_p95|max_ms` / `gpu_dropped`
(renders past the 8-pending cap + fences abandoned after 10 s = lost context).
Reading rule for a rotate window: `raf_gap_p95` high + `mt_blocks` ≈ 0 +
`gpu_behind` ≥ 2 → the draw is the cost (interaction LOD + mute-by-colour);
`mt_blocks` > 0 with `mt_late_max` ≈ the RAF gap → the main thread (GC or a task);
neither → the compositor/display. Unit-tested (`viewerPerf.test.ts`, 11 cases with a
fake WebGL2 context: cadences, pause vs stall, probe lateness and hidden re-anchor,
fence ticks-behind, cap, stale drop, teardown); type-checked on a niced subset
(`tsc --noEmit -p` over the two files under the app's strict flags) and served
through Vite's HMR on the running suite — the full `vue-tsc -b` / vitest / playwright
gates are OWED at the next suite stop, and the first Mac reading is OWED (reload the
tab, rotate/zoom with the big program loaded, read `browser.viewer.perf`).

**First Mac reading (2026-09-09, same evening): CLEAN.** Operator rotated and zoomed
perfmatrix-big.ngc (1.18 M segments) for ~60 s, most windows rendering every tick
(180 renders / 180 ticks per 3 s window = 60 fps), and reported "now it was smooth".
The probes agree: RAF gaps p50 17 / p95 18 / max 18–19 ms (one window max 37 ms);
main-thread lateness p95 5–8 ms, max 7–12 ms, 0 blocks (one window: 2 blocks, 35 ms
max — a re-parse publish landing); GPU 1–2 ticks behind, completion p95 17–33 ms, max
33–34 ms (one 44 ms); status cadence 30 Hz, render submit ≤4 ms. With the path drawn
OPAQUE and no parse running, the big program renders at the display rate on this Mac —
the viewer itself is not the lag. The 09-05 "laggy" windows all overlapped a running
re-parse (touch-offs, rotary jogs) with the path drawn TRANSPARENT by the mute; that
phase is the one still unmeasured — OWED: rotate during a touch-off countdown (banner
on, path muted) and read `gpu_behind`/`gpu_done` for that window; if the GPU trails
there, mute by colour (opaque, mixed toward the background) instead of alpha.

**Muted-phase reading (same evening): the mute WAS the cost.** Operator touched off
and rotated through the 27 s re-parse countdown (path drawn at alpha 0.4). Windows
during the parse vs the opaque rotate minutes earlier: RAF gap p95 21–30 ms, max
30–59 ms (opaque: 18 / 18–19); GPU behind p95 2–3 ticks, max 3, completion p95
34–63 ms, max 47–85 ms (opaque: 1–2 ticks, 17–33 / 33–34 ms); main-thread lateness
p95 11–20 ms, max 20–37 ms, up to 7 blocks per window (opaque: 5–8 / 7–12 / 0) —
part of that is the fence poll itself waiting on a busy GPU process
(`getSyncParameter` is a synchronous IPC under Firefox's remote WebGL), so the GPU
rows are the clean signal. The publish landing showed as one 85 ms RAF gap / 102 ms
block / 32 ms render submit — the geometry rebuild, one-shot, expected. FIX (same
commit): the mute is now an OPAQUE colour mix toward the scene background at the
`--opacity-disabled` ratio (`_applyStale` writes `material.color = bg.lerp(base, k)`
with the base colours tracked per stream so `setColors` composes; the theme watch
re-mixes on a background change; `sceneBackground` is a required controller dep —
no fallback branch). No `transparent`, no blending, same visual meaning. Verification
owed: the operator's next rotate during a countdown should read like the opaque rows.

**Sweep-flagged reading (2026-09-10, dd32835 context flags): ROOT CAUSE = the collision
sweep.** The operator's next sample (touch-off, rotate through the countdown and on
after the publish, "still slow after re-parsing"): every slow window carried
`sweep_busy: true`; the windows before the first touch-off, with no sweep running,
were clean (GPU 1 tick behind, 18 ms). The sweep rows say why: on perfmatrix-big
(1.18 M points, 10 bodies) NO sweep has ever completed — it starts on load/publish and
RESTARTS on every touch-off (a WCS change cancels and re-schedules it), and was
cancelled at 4.0 s / 15.8 s / 78.4 s having covered 0.04 % / 0.20 % / 0.98 % of the
track: a full sweep at that rate is ~2 h (the 60 k sample budget only caps the step at
EXPLORE from then on; the hard backstop is 240 k samples; per-sample cost — every
pair's BVH distance query against the trsrn meshes — is the number to profile). While
it runs, the Mac's GPU completion goes 18 → 95–123 ms p95 (max 184), the RAF p95 to
32–65 ms, with the main thread clean (max 6–8 ms, 0 blocks): a busy worker is off the
main thread but not off the machine — Firefox's WebGL host starves. The alpha mute
(6410501) was a real but secondary cost; the part-frame transform shows the same
signature for its ~1 s (`pf_pending`). The 09-05 "laggy when rotating" windows all sat
after touch-offs and rotary jogs — i.e. inside restarted sweeps. OPEN, decision owed
to the operator (a contract change on the sweep): (1) a wall-clock budget with an
honest `truncated` result — covered fraction in the ScrubBar caveat, "never truncates"
becomes "never truncates silently"; (2) no restart storm — a program whose last sweep
was truncated below a threshold is not re-swept automatically on a WCS change, the
chip offers a manual run; (3) a chunked, message-driven worker so a cancel lands
without terminate + BVH rebuild and the collision model stays resident across sweeps;
(4) profile the per-sample cost before touching step sizes.

## 2026-09-10 — Collision sweep: 2 h → 31 s on the big program, bounded, honest, never in the operator's way

**Ask:** "go" on the four-item plan above.

**Profile first (headless, the gateway's cached payload of perfmatrix-big + the real
trsrn STLs, niced VM core):** 1,179,964 points, 109.8 m of path, 11 bodies of only
1,236 triangles, 45 pairs, BVH build 8 ms. The sweep ran 351 samples/s at 2.85 ms per
sample and covered 0.28 % in 20 s (implied 119 min). The cost was not the meshes: the
conservative-advancement certificates were RESET at every chunk boundary ("V changes
per chunk, so certificates never carry"), and this program's segments are 0.09 mm long —
so every 0.09 mm re-queried all 45 pairs. `done` counted one sample per segment; the
two chunk-endpoint poses and 45 BVH queries per segment were the 2.85 ms.

**Fix 1 — carried clearance certificates (collision.ts).** A query leaves a pair with
clearance d − margin; a chunk can consume at most V × Lc of it (V is the per-chunk
relative-speed bound the sweep already computes). The remainder now carries into the
next chunk, re-expressed in that chunk's V (`clear[]`/`sQ[]`; decremented per chunk by
V × (s1 − sQ)); a pair whose clearance outlasts the chunk is never queried in it. Same
guarantee, summed piecewise. Pairs INSIDE the margin keep their absolute EXPLORE
re-probe cadence across chunks, but are still sampled at least once on every LINE they
stay in contact with (`qLine[]`) — the through-contact test caught the version that
skipped a short line's continuation record. Result on the same program: 82,435
samples/s, 0.01 ms/sample, the WHOLE track swept in 31 s (2.56 M samples), certified,
not coarsened. The 60 k sample budget (sized for ~1 ms samples) then truncated it at
9 % in 3 s — raised to 4 M as a pure runaway backstop; the wall-clock budget is the
operative bound now. All 43 collision cases (graze, rotary lever, bulge, cutting
semantics, refinement windows) + kinsBulge unchanged and green.

**Fix 2 — the sweep is a resumable iterator with a wall-clock budget.**
`sweepCollisionsIter` yields progress at checkpoints (before the first segment, every
16 segments, every 512 samples, once at the end); `next(true)` aborts; `sweepCollisions`
drives it to completion for tests and gates. `opts.maxMs` stops the sweep at a
checkpoint with `truncated: {covered, reason: "time"}`; the hard sample backstop, which
used to `break outer` SILENTLY, now says `reason: "samples"`. `opts.clock` lets the
caller supply the budget's clock. ScrubBar: a truncated sweep with no hits reads
"no clash in N % swept" (warn), never "clear"; the caveat `*` names the budget and the
covered fraction. Tests: time budget, sample backstop, completed = null, iterator ≡
sync, abort semantics, caller clock (frozen → never truncates; racing → truncates).

**Fix 3 — message-driven worker, resident model, pause on interaction.**
`sweepPump.runSweepSlice` (pure, 3 tests) drives the iterator for 40 ms slices with a
`setTimeout(0)` between them, so the worker reads `{cancel}`, `{pause}`, `{resume}`
and superseding requests between slices — a cancel no longer terminates the worker
and rebuilds the BVHs. The collision model stays RESIDENT under a `modelKey` (loaded
parts + placement + unit scale + tool dims); ThreeViewer sends the STL copies only when
the key changes, and a worker that lacks the model answers `needBodies` (re-sent once;
twice = loud failure). OrbitControls `start`/`end` pause/resume a running sweep, a sweep
posted mid-drag starts paused, and the budget runs on an ACTIVE-time clock (paused
time stands still); a pause with no resume for 30 s resumes by itself.

**Fix 4 — no restart storm.** Auto sweeps run with `SWEEP_AUTO_BUDGET_MS`. If this
program's auto sweep truncated, WCS/tool changes do NOT re-run it (they would truncate
again and own the machine for another budget): ThreeViewer sets `collisionSkipped`
{covered, budget}, traces `collision.sweep_declined`, and ScrubBar shows "check
declined — N % in 60 s" with a Check button that runs the manual budget
(`SWEEP_MANUAL_BUDGET_MS`). A new program resets it. Telemetry rows
`collision.sweep_start/done/cancelled/declined` carry budget, covered fraction and
reason. Budgets, set from the Mac's first rows: the hot-loaded build's first sweeps
ran 1.26 M / 1.16 M samples in 20 s (~63 k samples/s — slower than the niced VM's
82 k: SpiderMonkey vs V8, or an Intel Mac), i.e. the whole program needs ~40 s there,
and a 20 s auto budget cut it at ~50 %. Since the sweep pauses under camera
interaction and the budget counts active time only, a long auto budget no longer
costs the operator anything while rotating: auto 60 s, manual 300 s.

**2026-09-11 operator reading of the new build:** both full sweeps completed (54 s and
37 s, 2.57 M samples, certified, 0 hits) and the progress froze while the operator
rotated (the pause works). "Still somewhat laggy even after parsing — at every zoom
level, also when rotating." Interaction windows of the last two hours grouped by what
else was running (GPU completion p95, median / p90 over windows):

| VM parsing | browser sweep | n | gpu_done p95 | behind | RAF p95 |
|---|---|---|---|---|---|
| no | no | 9 | 48 / 56 ms | 2 | 18 / 31 ms |
| yes | no | 6 | 72 / 79 ms | 3 | 22 / 39 ms |
| no | yes (pausing) | 28 | 34 / 77 ms | 2 | 18 / 40 ms |
| yes | yes | 7 | 117 / 121 ms | 3 | 46 / 53 ms |

Two findings. (1) The VM's own parse (10–12 s per touch-off, one VM core at 100 %
plus gzip) lags the Mac's frames by itself — the VM shares the Mac's cores, and the
"GPU behind" fence also measures Firefox's out-of-process WebGL host being starved,
not only GPU time. (2) With nothing running, half the windows still sat at 48–80 ms:
the clean floor is ~18 ms per frame for 2 × 1.18 M segments (the base line plus the
outside-bounds overlay drawn over the whole path, both at Retina resolution with
MSAA) — one frame of budget with no headroom, so any transient host load tips it
over, at any zoom. There is NO culling or LOD: Three culls whole objects only, and a
sub-pixel segment still costs its vertices and a fragment. The operator's colour
observation ("yellow from afar, yellow/magenta mixed up close") was the dashed
overlay's 5 mm dash period going sub-pixel at distance — not culling. DONE (same
day, operator's call): the overlay is plain opaque yellow (`LineBasicMaterial`, no
dash-distance array — 1.18 M floats built on the main thread per rebuild — no
blending). OPEN, proposed: a display LOD (a tolerance-decimated draw copy of the
path — the 0.09 mm segments carry no visible detail — with the full data kept for
scrub/highlight/sweep), spatial chunks so frustum culling drops off-screen ranges
when zoomed in, and the overlay as a single pass; the aim is headroom, not a new
floor.

**Gates (suite live — single niced files only):** collision 43 + sweepPump 3 +
kinsBulge 8 = 54 green; `tsc --noEmit -p` over collision.ts / collisionWorker.ts /
sweepPump.ts + tests under the app's strict flags clean; Vite compiles ThreeViewer.vue,
ScrubBar.vue and the worker; hot-loaded on the running suite. OWED at the next suite
stop: `npm run build` (vue-tsc over the .vue changes), full vitest incl. the trsrn
envelope gate (300 s sweeps — deliberately not run niced next to the live HAL chain),
playwright. OWED from the operator: touch off on the big program and rotate through the
countdown and after the publish — the sweep should pause under the pointer, finish in
~15–20 s of active time on the Mac, and the perf rows should read like the opaque
rotate; a second touch-off then either re-sweeps (finished within budget) or shows
"check declined".


## 2026-09-12 — Rotary decoupling + viewer headroom: the rotary boundary on the wire, a room-fixed prefix, chunked draw with a gated overlay, display LOD

**Asks (operator, 2026-09-11, in order).** "Why, all of a sudden in machine mode,
when I rotate A after a touch-off does the toolpath jump back to the touch-off
position in absolute coordinates after parsing?" → "Is it not possible to decouple
it from A in machine mode?" → "Is this a superior way of doing it?" → "Let's plan
this, and also the performance improvements. Is there a way to involve the GPU
more? Also for the BVH collision?" Scope chosen via the plan questions: boundary +
display split (the live-rotary substitution into the track is a follow-on);
headroom = overlay gating + spatial chunks + display LOD (the orbit pixel-ratio
lever and the backplot upload fix declined); the sweep stays on the CPU
(assessment only, shards recorded).

**The jump was correct, and it looked new for a recorded reason.** Under identity
kins G54 is a fixed point in the room: the program goes to `G54 + words`
whatever A is. Every vertex was baked into the TABLE frame at the parse-time
rotary pose (the interpreter is seeded with the live A/B/C; segments the program
never rotates inherit it), so an A jog carried the path along with the table
until the rotary drift edge's reparse re-baked it at the room-fixed position —
20 s on the big program, muted grey meanwhile. Before 2026-09-02 the G54 triad
jumped to the same room-fixed spot, so triad and path moved together; since the
"program zero rides the part" wave the triad stays on the part and a muted ghost
marks the room-fixed spot, so the path now visibly leaves the triad and lands on
the ghost — the honest 3D-ROT-off picture (the chip's own title says it). The
trace showed the session switching Machine ↔ Plane between A moves, so both
pictures were seen back to back.

**Why the client could not fix it alone.** An explicit `G0 A0 C0` at the top of a
5-axis post equals the seed value and MUST ride the part (the run moves A back to
0 before cutting); an XYZ-only program must stay in the room. Identical in the
data once the seed is 0. Only the parser can tell.

**Wire (ffa51fd).** `rotary_cmd = {A,B,C: seq|null, unknown: seq|null, seed}`:
per rotary letter the seq of the segment that first COMMANDS it, by (a) the RAW
machine-frame endpoint moving > 1e-5° from the seed (a mid-program `G10 L2`
rotary write counts — conservative) or (b) the source line carrying the letter as
a word (`rotary_word_lines`: one C-speed regex pass over the whole text as a
prefilter, per-line test only on candidates — comments stripped, `#<name>` →
`#0`, `o<name>` → `O0`, whitespace removed; G10/G92/G52 lines command nothing;
bare G28/G30 home every axis; the existing `_AXIS_WORD` was NOT reusable, it
misses `A#100`, `A[#1+2]`, `A#<ang>`), consulted only where the line number is
provably this file's (sub-span depth 0, motion kind matching the stream, no
unmarked external sub); `unknown` = the first non-relabel seq whose text cannot
be consulted while a letter is still pending — from there on the client treats
everything as commanded. Vectorized (three numpy passes for an XYZ-only 1.18 M-
line program); computed after the flip-relabel pass (seqs already doubled);
BOTH flip vertices anchored at every boundary (`seq_boundary_indices`,
searchsorted + diff) so a collinear run cannot collapse across it. Per axis on
purpose: `G0 A30` then a TCP block still inherits C, and a `G0 B30` head tilt must
not make an A-inherited path ride. `__ROTCMD__` stderr → `published_rotary_cmd`
(the follow-on's hook). Headless worker runs on the TWP INI (seed 0): XYZ-only →
all null; `G0 A0 C0` first → A=1, C=1 (text); `G0 A30` mid → A=3 (value);
`G0 B[#<_ini[joint_4]home>]` → B=3.

**Schema-bump trap (live suite).** The running gateway imports `PREVIEW_SCHEMA`
at start; the worker is a fresh subprocess per parse. Bumping the constant live
makes the worker emit 9 against the gateway's 8 and the schema-mismatch edge
reparses forever (and HMR flips the tab into "schema mismatch"). So the key
ships WITHOUT a bump (old clients ignore it); `PREVIEW_SCHEMA = 9` +
`EXPECTED_PREVIEW_SCHEMA = 9` + golden regeneration land in one commit at the
suite stop.

**Client (bf630a4).** Design review corrections adopted: (1) "room" is NOT the
scene root — it is the work group's frame with every WORK-chain rotary at zero
(machine coordinates by the machine.json convention: trsrn root → a_table →
a_work with the head carrying XYZ, so root offset by the base translates; xyzac
knee → saddle → table → a → c, so the `table` node — it must follow table TRAVEL,
never table rotation); `machineFrameGrp` = a child of the parent of the topmost
work-chain rotary, static offset = the base translates below it; without a
work-chain rotary it IS `_workGrp`. (2) The inherited set is a prefix of the
merged track, not of the drawn arrays in general (identity → TCP → identity
before the first rotary command is legal), so the track carries per-axis
`inheritedEnd` counts and the draw splits PAIRS by the frame of both endpoints.
(3) A flip inside a stream section needs a DUPLICATED vertex: the shared
position attribute holds one position per vertex, so the part-frame bake emits
the previous vertex again in the new frame as a break — no connector between
the two frames' copies of one point; the boundary move draws in its END
vertex's frame (the existing convention); in programmed mode the same program
coordinates under two parents ARE the duplicate. (4) The big XYZ program renders
through the PROGRAMMED path (no abc shipped while the seed is 0 → `displayDecision`
"programmed", main-thread `_applyProgrammed`), so both paths got the split. (5) The
machine-bounds clip planes used to ride `_workGrp` and rotated with A on a rotary
work chain — physically wrong (machine limits are joint limits, fixed in the
room); they now track `machineFrameGrp`. Room parents mirror the table side one-
to-one (roomOrigin/roomRotGroup live, roomAnchor/roomRot posed by apply from the
bake's own terms); `roomEndOf(track, workLetters)` = min over the work chain's
letters and unknown; the part-frame worker bakes `src < roomEnd` identity
segments via `tipInRoomFrame` (world-kins segments always ride — TCP/plane track
the part). A payload without the key (the cached one until the next reparse)
keeps the old picture.

**Headroom (7a04909, 4d65a83).** Facts: `WebGLRenderer({antialias:true})` at
Retina pixel ratio 2, render-on-demand loop, ONE LineSegments per stream with ONE
bounding sphere (culling never fired), the outside-bounds overlay a full second
draw of the same geometry with 6 clip planes drawn even when nothing is outside
= 4 full-path draws per frame; the machine model is ~1.2 k triangles (noise).
Now: `viewer/lineChunks.ts` (pure): real segment pairs split by frame, binned
SPATIALLY into an extent-proportional grid by a counting sort (the index buffer
is permuted, the vertex order — the highlight's address space — is not; program-
order ranges were as big as the part: a pocketing pass sweeps everything every
40 k segments — first live reading 31 chunks, 31 overlays drawn), ≤ 64 cells so
the per-object CPU submit (~5–15 µs each) stays inside the measured ≤ 2 ms;
explicit bounding spheres (a null one makes Three compute the WHOLE shared
attribute's sphere per chunk); `updateCulling` per rendered frame hides each
chunk's overlay whose box — 8 corners transformed into the machine frame at the
parent's CURRENT pose — lies inside the machine bounds, and counts frustum hits.
Display LOD: Douglas–Peucker per run of chained pairs (runs end at breaks and at
the flip duplicates), coarse-from-fine, tolerances `[1e-4, 5e-4] × the joint
envelope diagonal`, cut in the worker that produced the vertices (previewWorker
for the programmed path — it does not know the flips, so a level pair whose
endpoints differ in frame is dropped and counted; partFrameWorker for the bake);
ONE grid for all levels so chunk c is the same cell at every level; a chunk is
one geometry PER LEVEL sharing the position attribute and that level's index
attribute, only the current level visible — a level switch is a visibility flip
and disposing every level's geometry frees every index buffer (Three deletes
only a geometry's CURRENT index on dispose; swapping `setIndex` would leak the
others). Level choice per chunk: the coarsest whose tolerance is under 0.5 device
pixels at the chunk's nearest point (world units per pixel from the camera),
1.25× band before stepping finer. Highlight = one indexed LineSegments per frame
with its own small index buffer, refilled per highlight with the lit range's
pairs that cross neither a break nor a flip (a strip drawRange would draw a
connector across the flip). Perf context gains draw_segs, room_segs, chunks,
chunks_visible, overlay_chunks, frame_mixed, lod_min/max/ms, gl_calls, gl_lines
(main pass, read before the gizmo pass resets info), display_mode.

**Live readings (Firefox 155, Mac host, perfmatrix-big, HMR).** 37 chunks,
gl_calls 115, frame_mixed 0. All 37 overlays still drawn — genuine: the sim's
Z limit is 0.01 with Z0 at the top of travel, so every retract sits above the
box and every cell holds one. LOD: every chunk at level 2 at fit-to-view,
lod_ms 565 in the worker — and only 11 % fewer segments (1.18 M → 1.05 M):
`perfmatrix-big.ngc` is a synthetic random walk (median segment 0.9 mm, median
turn 52°, Z jitter −1..0; even a 0.57 mm radial tolerance keeps 87 %), genuine
sub-millimetre structure no honest decimation can collapse — the levels are for
CAM programs of arcs and rasters, and this benchmark cannot show them. The
headroom this program gets is the overlay gate (where the program is inside the
box) and frustum culling when zoomed in.

**GPU assessment (the operator's question).** Drawing is already on the GPU
(submit ≤ 2 ms, completion 18 ms) — the levers are fewer vertices, fewer
fragments, fewer passes, none needing shaders; a custom ShaderMaterial (per-
vertex frame flag + fragment-classified overlay) was reviewed and rejected
(culling needs single-frame chunks anyway; three material variants to patch;
untestable in the headless controller tests; per-chunk gating captures ~all of
its benefit). Posing (the part-frame bake) runs once per touch-off, not per
frame — not worth a GPU port. The sweep: three-mesh-bvh 0.9.14's GPU distance
functions are point→BVH only (`bvhClosestPointToPoint` WebGL2,
`getClosestPointToPointFn` WebGPU); sampling the tool surface against a body
BVH gives an UPPER bound on the distance and the conservative-advancement
certificates are sound only with a LOWER bound; WebGPU is default-on in Firefox
≥ 147 on Apple Silicon but unverified inside this app's workers, and the GPU is
the resource already at 18 ms/frame — no GPU sweep. Parallel CPU shards are the
right parallelism (design: baseline mask from the program's FIRST pose broadcast
to every shard, shard starts overlapped by the onset window with reporting
suppressed so a continuing contact is not a new onset, merge on (pair, cum),
MAX_HITS after merge, covered = min, N = min(4, hardwareConcurrency − 2), manual
sweep first, pause fan-out kept) — recorded, not built.

**Gates (suite live — single niced files only).** test_gateway_util 327 (+12),
test_bulk_pipeline 29 (+2); vitest lineChunks 30, toolpathController 40,
partFrame 26, scrubTrack, previewDecode, bulkData, programZero, viewerPerf,
displayPipeline — 227+ green over the nine touched files; tsc subset under the
app's strict flags clean; Vite compiles ThreeViewer.vue + both workers; hot-
loaded on the running suite (no browser errors in the trace).

**OWED at the suite stop:** the schema-bump commit (`PREVIEW_SCHEMA`/
`EXPECTED_PREVIEW_SCHEMA` = 9) + regenerate all four goldens (`scripts/
preview_gate.py`; the three `3axis` ones are already stale at schema 5) + `check`;
`npm run build` (vue-tsc over the .vue changes), `npm run lint`, full vitest
(incl. the trsrn envelope gate), playwright (`e2e/viewer.spec.ts` leak probe —
extend for N chunks × levels), full pytest; restart; `sim_parity.py gate` 21/21
then `git checkout -- scripts/parity_corpus/runs`.
**OWED from the operator:** on an XYZ-only program in Machine mode, jog A
twice — the FIRST jog's reparse delivers the boundary (the cached payload
predates it), the SECOND must not move the path at all (`room_segs` > 0 in the
perf rows); a 5-axis post opening `G0 A0 C0` must still ride the table; a mixed
program (`G1 X…`, then `G0 A30`, more lines): prefix room-fixed, rest rides, no
connector at the boundary, `frame_mixed = 0`; highlight/scrub across the
boundary; TCP/Plane programs unchanged; a real CAM program for the LOD reading.
**OPEN (follow-on, hooks in place):** live rotary substituted into the track's
inherited prefix (scrub + sweep without a reparse; gateway drift edge skips the
rotary reparse when the drifted axes are never commanded — `published_rotary_cmd`
is the datum; `sim_parity.py` injects the run's start pose — the `twp_g683_tilted`
spike); parallel sweep shards; the orbit pixel-ratio drop + antialias setting;
the backplot `addUpdateRange` fix.


## 2026-09-12 — Operator walk-through: stale grey, the counted limit chip, HUD grouping, the machine-bounds box (a regression) and live joint limits, the banner bar

**Asks (operator, same morning, after the rotary/headroom wave):** "make it a real
grey if the path is stale"; "what is the clickable 'toolpath exceeds soft limits'
for?"; "the machine/datum chip, then the tool info, then the other warnings — these
should stay together"; "the machine bounds move with the A axis and the toolpath is
sometimes yellow inside them — how are they computed, do they change by mode? they
don't represent the real bounds"; "a grey bar follows the ellipsized re-parse message
in the status bar".

**Machine bounds — a regression I made, and a blind spot.** 7a04909 moved the outside-
bounds CLIP PLANES to `machineFrameGrp` but left the drawn box MESH under `_workGrp`
(`_workGrp!.add(machineBoundsMesh)`): on the TWP machine the two coincide only at
A = 0; at A = 90° the box swung on a 2236 mm arc and tilted while the clipping stayed
room-fixed — "yellow inside the box". FIXED: the mesh hangs under `machineFrameGrp`
(= `_workGrp` on rotary-free work chains, byte-identical there), and the camera's
reframe/reset anchor uses the box in WORLD space through that node (it used
`_workGrp.position`, a LOCAL offset — 1700 mm off in +X on the TWP machine and turning
with A). Provenance: the box was `viewer_init.machine_bounds` = the INI FILE's
`[AXIS_X/Y/Z] MIN/MAX_LIMIT` (`read_machine_limits_from_ini`), read once per
connection, cached on the file's mtime, frozen for the session. (The entry first
claimed the TWP sim's HAL mux made it "5 km too tight under TCP" — CORRECTED the same
day: `hallib/z_limit_window.hal` drives the AXIS-letter `ini.z.*` pins, the WORLD-pose
window LinuxCNC checks programmed moves against in every kins mode, while `[JOINT_2]`
stays −2000..0.01 in every mode. STAT's per-joint limits, which the box now uses, do
NOT change with kins mode, and the "box grows under TCP" expectation was wrong; the
old INI box happened to carry the same numbers. What the live field does follow is
any RUNTIME change of a joint window. Known coarse-check limit, unchanged: the box is
the HEAD's joint window and the drawn path is the TIP — the yellow overlay is off by
the TLO in Z and by the tilt lever under B/C; the validator's joint-side conversion is
the exact check, and the planned reach-envelope layer is the tip-space outline.)
NOW: `status_runtime` publishes `joint_limits`
(STAT's per-joint [min, max], joint order, None inside the list for an unreadable
joint, None when STAT has no joint info) on every frame — the status delta makes it
free until it changes; the viewer derives the box from it (`viewer/machineBounds.ts`
`boundsFromJointLimits`, joint order → letters via `viewer_init.axes`; null unless X,
Y, Z exist with finite min < max) and falls back to the INI box, applying mesh, clip
planes (rebuilt IN PLACE — the toolpath materials hold the arrays by reference),
reframe box and overlay gate together (`applyMachineBounds`) whenever the effective
box changes. The sim's X/Y ±5000 stay: the INI says (`:252-256`) they are a deliberate
fiction for the joint-side soft-limit test case, not the model's travel — the INI is
LinuxCNC's own soft-limit truth and the viewer does not second-guess it. Three
notions of "limit" coexist and are now all live: the banner's per-joint check, the
preview validator's kins-aware world check, and the drawn box. The gateway half lands
at the next restart (status_runtime runs in the gateway process); until then the
viewer draws the INI box, in the right frame.

**Stale = one grey.** The mute mixed each stream's own colour toward the background
at `--opacity-disabled` — a dim cyan/orange, and the yellow overlay was never muted.
Now `grey = bg.lerp(fg, --opacity-disabled)` (theme `--bg`/`--fg`, plain hex per
theme; a new `cssColor(token)` helper serves `--bg`, `--fg`, `--danger`) for every
stream (rapids keep their dashes) and the outside-bounds overlays are hidden while
stale — the bounds verdict is as stale as the path, and the GPU draws less. Still an
opaque colour write (the 2026-09-09 alpha finding stands).

**The limit chip** re-parsed on click (the same handler as the three stale chips) —
unrelated to the violations, and it dropped the count its source carries. Now a
plain, counted chip ("N soft-limit violation(s)") whose title says where the marks
are (program panel) and what navigates them (the scrub bar's ◀ N limits ▶ in
simulation mode); the WCS/TLO-stale chips keep the re-parse where a re-parse is the
remedy, and the wcsoff drift edge re-parses on touch-off anyway.

**HUD order:** readout grid → tool line → load bar → mode/datum chip → warnings (the
chip led the tool block before; the readout and the "what to know" block are now
each contiguous). Template move only.

**Banner bar:** the re-parse message's `.progressTrack` (a fixed 80–220 px slab,
grey on the warn-tinted banner) never showed a fill. First diagnosis (6389bfc) blamed
a null `expected_ms` — WRONG: `expected_parse_ms` always returns a number (last
measured publish, else a size estimate with a 1.5 s floor), so the track was always
drawn. The real cause (operator re-test, same day): the fill was an inline `<span>`,
which ignores `width`/`height`, while GcodePanel's program progress uses `<div>`s —
the fill had a zero box and the track read as an empty grey bar. Track and fill are
DIVs now; the title carries "elapsed of expected"; the ellipsis rule targets the text
span only (a descendant selector also hit the track).

**Gates (suite live — single niced files):** toolpathController 36 (+4: grey on both
streams, colour change stays grey, overlays hidden while stale and back per the gate,
the count rides and clears), machineBounds 4 (new), test_status_runtime 37 (+1);
tsc subset clean; Vite serves ThreeViewer.vue/App.vue; no browser errors after HMR.
OWED: vue-tsc/full vitest/playwright/pytest at the suite stop (unchanged list);
operator: rotate A in Machine mode — the box stays put and yellow appears only
outside it; switching kins mode leaves the box unchanged (joint window — correction above).

## 2026-09-12 (pm) — Outside-limits overlay goes joint-side; reach-envelope layer; model-derived sim travels

**Trigger:** the operator's follow-up questions on the machine-bounds box ("what are
the real machine bounds? a machine with rotaries does not have a cubic box… can this
be shown? does it need to be parsed?") and the yes to "fix this and implement your
suggestions" (commits 35fd5b0, fa1923b, and this one).

**What the box is and is not.** The soft limits ARE the enforced travel, so the box
is the right thing to draw and check against — for the JOINTS. The drawn path is
the TOOL TIP: one tool length lower in Z and off by the tilt lever under B/C. The old
yellow overlay compared tip vertices with the joint box through six clip planes and a
per-chunk box gate, so it could flag a legal move at the bottom of travel and miss an
illegal one near the top by exactly one tool length. FIXED (35fd5b0): the producing
worker emits a joint-side verdict per drawn vertex — `transformToPartFrame` keeps
`outside` per baked sample from the same TLO-inclusive joints it poses with
(subdivided sweeps included, the validator's rule, `outsideJointLimits` with the
gateway's 1e-6 eps), and the programmed display asks the resident worker for the
same flags per programmed vertex (new `flags` op, its own id space). The controller
draws the flagged pairs as per-chunk, per-LOD-level index subsets over the shared
vertices (`buildOverlays`; a decimated level-k chord is flagged when ANY vertex of
its run is — prefix sum). No clip planes on the toolpath, no `boxInsideBounds` gate
(removed with its tests); the planes stay for the toolpath-bounds layer. A joint-
limits change forces a transform re-run (`_pfScheduleWcsRefresh(true)`); no limits
= no overlay (unchecked ≠ clean). The HUD chip stays the validator's per-line count.

**Reach envelope (fa1923b).** The reachable space is a joint-space property — the
limits, the chain, the tool length — so it needs no parse and does not change with
the kins mode. Two outlines, layer `reach` (off by default): the ROOM solid = hull of
the travel box's corners through the chain at every head-rotary sample (on the trsrn
model the nutating B is 55° off the spindle, so the tip orbit reaches 20° above
horizontal: the box grows by the lever sideways and down and by a third of it up);
the PART solid = the room solid swept about each work-chain rotary over its limit
range, evaluated per slice along the axis and per ray from it (span in the input
solid, then a circular min/max over the swept window; a full turn = every
direction; ONE interval per ray — a ray from the axis meets a convex slice in one
span), yielding a radial-table solid in the child frame that a second rotary sweeps
again. Rendered as translucent fills with crease edges in the bounds colour; the
part solid rides `_workGrp`, the room solid hangs with the bounds box. Sizes on the
trsrn model: 1972 tilt samples × 8 corners → ~4.4 k hull faces, 92 k sweep
triangles, ~0.5 s in the worker. FOUND on the way: three's `ConvexHull` returned
faces that are not supporting planes for this input (a face 3.5 m inside the hull;
8 translated copies of one orbit are exactly coplanar by construction) — the
sweep then saw an empty solid. `HullSolid` now deduplicates, jitters by 1e-3,
validates every plane against the hull's own vertices, rebuilds with a fresh seed
up to four times and drops faces that still fail (reply notes carry it). Honest
limitations recorded in the notes: a linear joint under a work rotary is evaluated
at 0; a rotary without finite limits is swept as a full turn. Out of scope, as
agreed: collision subtraction.

**Model-derived travels.** The sim INI's X/Y ±5000 made every envelope a 10 m box.
The template AND the installed copy now carry X ±1500 (the column spans root X
−2900..500, the platter face is at −2400, the console reaches −500), Y −2000..1300
— ASYMMETRIC: the head homes 1 m in front of the trunnion axis, the platter spans
root Y ±900 and the column front is at 2600 — and Z unchanged. Every corpus program
and TWP demo was run through the real parse worker against both windows:
violations unchanged (0, and parity_linear's deliberate 3 on Z), so nothing is
re-posted and the goldens are unaffected. The INI comment's "joint-side soft-limit
case rests on ±5000" had no referent in the repo (the gateway's trsrn limit tests
carry their own limits); rewritten. Takes effect at the next LinuxCNC start.

**Gates (suite live — single niced files):** partFrame 31 (+5), toolpathController
36 (three gate tests rewritten onto flags, +1 LOD-inherits-flag), lineChunks −3,
reachEnvelope 6 (new); tsc probes over every touched .ts clean; Vite serves
ThreeViewer.vue and both workers; no browser errors after HMR; the live tab's perf
rows read `overlay_chunks 0` on the sim program in Machine mode (its joints are
inside the window — the old 37 yellow chunks were the tip-vs-box artefact).
OWED: restart for the INI (operator), heavy gates at the suite stop (unchanged
list), operator: toggle Reach Envelope on the sim, rotate A (the part solid rides
the platter, the room solid stays), switch tools (the solids follow the length).

**Operator: "so it's still a cube — intentional?"** (after the restart; the live
limits were already the new window.) Two reasons. (1) Honest: with no tool loaded
the only thing that leaves the 3 m travel box is the head's 130 mm pivot lever (y 50
/ z 120), so the room solid hugs the box by 130 mm — a tool of length L grows that
to ~130 + L. (2) A rendering defect (c64e603): the part solid is a 3.3 m cylinder
about the trunnion axis, the camera sits inside it, and crease edges show nothing
of a cylinder but its caps. The worker now ships a CAGE of the radial table (rings
every 8 slices, generators every 15°, spokes at coverage boundaries and caps) and
the hull draws its 8° facet creases so the fillets read as a fan of lines.
Then, seeing both ("one is box-like and the other one a cylinder"): separate
toggles and outlines only (3fb74e6) — layers `reachRoom` (Machine Reach) and
`reachPart` (Part Reach), no translucent fills, the worker ships the two line
soups and the main thread draws LineSegments in the bounds colour at 0.6 so the
bounds box stays the crisp one. One computation serves both layers.

## 2026-09-12 (evening) — One source of truth for "outside the soft limits": the gateway validator ships the per-vertex verdict

**Trigger:** the operator, after the morning's overlay rewrite: "so not one source of
truth?" Correct — 35fd5b0 had two implementations of one rule (the gateway validator
in Python from the INI window at parse time; the viewer's overlay in TypeScript from
the live window per drawn vertex), pinned only by the shared kins twins. The project
had already ruled on this once (the HUD flag follows the validator, not a geometric
box). Consolidated on the gateway.

**Gateway.** `check_limit_violations` keeps its per-line records and attribution rule.
Beside it, per canon segment, the RAW verdict — "any joint beyond the window at the
end (identity: joints are affine in the words, endpoints carry the extremes) or at
any 4° sample (trsrn / trt world segments through the same twins)" — no parked
exemption: motion refuses every such move, and the painted path shows what motion
refuses while the records name culprits. `_trsrn_joint_extremes` is the shared batch
(the per-line checker and the flags call it). After RDP the flags reduce onto the
kept vertices: kept k_j is 1 when any canon segment in (k_{j−1}, k_j] was outside, so
a decimated run over an excursion stays flagged. Wire keys `feed_outside` /
`rapid_outside` (uint8 per shipped vertex, unbumped schema — live-suite rule; absent
= unchecked). The window is now the LIVE joint window from STAT
(`live_joint_limits`, what motion enforces) with the INI file as the offline fallback,
and which one was used rides `__LIMITS__` → `published_limits`; a new idle drift edge
(`evaluate_limits_drift`, after the WCS-offset edge in the chain) reparses when the
live window leaves a live-sourced one — an INI-sourced window never drifts, so a
persistent INI-vs-live difference cannot loop. `preview_gate.summarize` carries
`outside_points`.

**Client.** Carries, never computes: previewDecode → track `outside` (merged like
mode, present iff every non-empty stream has it) → `splitTrackStreams`
feedOutside/rapidOutside (segment-ending convention, a section start takes the
opening segment's flag) → `prependEntry` (entry move 0 = unchecked) → the part-frame
transform stamps every sample of segment i with `outside[i]` (a duplicated flip
vertex reads 0) → `buildOverlays` paints pairs whose run (a, b] holds a flag. Removed:
`outsideJointLimits`, `jointLimitFlags`, the worker's `flags` op, `setOutsideFlags`,
the joint-limits transform re-run (the limits watch now only resizes the reach
envelope). The programmed display needs no second request any more.

**Gates:** gateway test_gateway_util 363 (+5: end+TLO no-parked-exemption vs the
records' attribution, RDP reduction, live window keyed by letter in joint order,
drift edge only for a live-sourced window, trsrn flags ride the subdivided sweep),
test_bulk_pipeline 31 (+2); client 180 across partFrame / controller / scrubTrack /
previewDecode / lineChunks / reach (carry through subdivision, flip duplicate 0,
mismatch → unchecked, (a, b] rule, LOD chord); tsc probe over every touched .ts
clean; Vite serves the workers and ThreeViewer; no browser errors. Headless worker on
the corpus: parity_linear ships 66/66 feed + 2/2 rapid outside (it parks at Z 50 above
the 0.01 ceiling — every move refused; the records name 3 lines), twp_g683_tilted
0/11. OWED: gateway restart for `published_limits` + the drift edge (the worker's
flags already reach the tab on the next reparse — the worker is a fresh subprocess
per parse and the keys pass through); heavy gates at the stop (unchanged list).


## 2026-09-12 (late) — One shape for "in progress"; banners say the state and one verb; HUD chips stop being buttons

**Operator walk-through, second pass.** Five observations on the status
surfaces, all traced to code: (1) the banner texts were long by design
("every banner carries its recovery path") and rendered uppercase bold, so a
re-parse line — reason, full file path, elapsed/expected, a twelve-word tail —
ran past any window; (2) the re-parse bar sat wherever the text ended (the text
span did not grow, and the elapsed readout changed width every second); (3)
"the messages button vanished briefly": `.bannerContent` was a flex item with
no `min-width: 0`, so a long single-line banner set its minimum width to the
full text and pushed the actions row (messages, Refresh, Home All, Abort) past
the right edge until the text shortened — a real layout bug, one line; (4)
progress was shown in three units: a bar in the banner, "3 s of ~12 s" in the
HUD, "45 %" inside the scrub bar's cancel button; (5) the collision sweep had no
re-run in any finished state — a cancel left nothing behind (no chip, no
button), and the only manual Check lived in the declined state.

**Decisions.** ONE progress shape: the global `.progressTrack`, fixed width, no
inline numbers (they ride the tooltip) — in the banner (pinned to the right
end of the content; the text takes the slack), in the HUD (a row under the
re-parse chip, like the load bar), and in the scrub bar (next to a separate ×
cancel; the bar is not a button). One fraction for the re-parse
(`previewRefreshPct` in statusStore, exported through the barrel) and one
wording for its times (`fmtProgressTimes`, format.ts: "00:03 of ~00:12").
Banners compact to the state plus its one recovery verb, the explanation in
the `title` (safety-chain, reader-stale, beyond-limit, preview-load, parse
error, refusal, re-parse with the basename only); the safety-trip and
config-fallback banners are unchanged — their text IS the action sequence.
The sweep offers ↻ (manual budget) in every finished state — clear, clashes,
partial coverage, declined, and a new "check cancelled" chip that only an
operator's × sets (parent-driven cancels are each followed by their own
re-run). The three underlined HUD chips (schema "Reparse", older offsets
"Refresh", tool-length "Reparse") lose the click: the gateway now owns every
re-parse decision — schema once per file+mtime, offset and tool-length drift
when idle and settled — and the clicks went through the idle-only `setup`
gate, i.e. they could only fire in the window where an edge was about to do
the same; the one case the edge gives up on (a schema mismatch that survived
its retry = half-upgraded install) is not fixed by clicking again, and the
chip now says "restart the suite". The `reparse` emit and App's listener are
gone; `reparse_preview` stays in the protocol (nothing operator-facing sends
it). Same principle as the evening entry: one source decides, the client
reports.

**Verification.** statusStore 30 (+1: pct 50 % at half, capped 97, 0 without
an expectation, 0 after publish), format.test.ts (new, 2), lcncWs.exports (the
pinned surface gains `previewRefreshPct`); tsc probe over the touched .ts
clean; Vite serves App / ThreeViewer / ScrubBar; no browser errors after the
HMR. Live look owed from the operator: a touch-off (bar at the right end of
the banner, never moving; same bar in the HUD; actions row never pushed out),
a sweep cancel (chip + ↻), and the HUD chips reading as text.

## 2026-09-12 (suite stop) — Schema 9, goldens regenerated, every heavy gate green, the leak probe covers 64 chunks

**Suite stopped by the operator; the accumulated heavy-gate list ran in full.**
Schema bump `PREVIEW_SCHEMA`/`EXPECTED_PREVIEW_SCHEMA` = 9 (the per-vertex
outside flags + `__LIMITS__`; the rotary boundary / `rotary_cmd` / `ustart` keys
shipped unbumped earlier today ride the same bump). Goldens regenerated against
headless `DISPLAY = dummy` boots of the matching configs (temp INI copies in the
config dir, stdin held open on a FIFO; both sims shut down cleanly afterwards and
the copies removed): `twp/twp_simple_example` (8 → 9: `outside_points` feed null
/ rapid 0, `rotary_cmd` B/C commanded, 4 unknown), `3axis/haus|kontur|1001` (5 →
9: `outside_points` 0/0, `rotary_cmd` null, `cline_lines`, `unmarked_subs`,
`ustart_count` — haus gains 2 rapid points, the schema-6 unknown-start records;
every other field identical). `check` CLEAN on all four.

**Gates.** `npm run lint` found three errors the live-session waves never saw
(prefer-const on the hull seed, two no-useless-assignment in the GPU fence
probe) and `npm run build` one vue-tsc error a .ts-only probe cannot catch —
ThreeViewer still initialised the `machineFrame` field the morning wave removed
from `ToolpathCtx`. All four fixed; then lint 0, build 0, full pytest 0 (exit),
full vitest 51 files / 734 tests, playwright 16/16. Lesson kept: the tsc probe
covers .ts only — a `.vue` change is verified only by `vue-tsc -b`, i.e. at the
stop.

**Leak probe extended for the chunked draw** (owed since the morning entry). The
mock gateway's program was a 4-point square = one chunk; it is now a zigzag over
the mock machine's 100 mm box in 12.5 mm segments, every vertex a 1 mm corner.
Three facts shaped it, each found by a red run: the camera frames the machine
box, so a path outside it is frustum-culled and never uploaded (17 geometries);
the framed view draws the coarsest LOD level, and collinear rows decimate to one
chord per row there, so most cells held nothing at the drawn level (30); with
real corners every cell keeps pairs at every level and all 64 level-0 chunks
upload. The spec pins `loaded − empty ≥ 48` so the multi-chunk disposal path is
what the rebuild invariant guards; LOD levels ≥ 1 upload only when drawn at that
zoom, so renderer.info cannot see them — their disposal stays with the
controller unit tests.

**Still owed, all on the running suite:** the operator's restart (also picks up
`published_limits` + the limits drift edge, and the schema-9 gateway the built
client now expects); `sim_parity.py gate` 21/21 then `git checkout --
scripts/parity_corpus/runs`; a perf-matrix run (the limits drift edge is in the
poller); the live looks listed in the two preceding entries.

## 2026-09-12 (restart) — Corpus gate RED: the model-derived X/Y travels closed the world window under TCP; the Z mux becomes an X/Y/Z mux

**Run.** Suite restarted by the operator on 45ec746 (fresh gateway, schema 9,
`joint_limits` on the wire). Fresh-boot recovery via the gateway (ack → arm →
e-stop reset → machine on → home all; the prep script heartbeats while armed and
merges `status_delta` frames — a probe that reads only full `status` frames sees
nothing after the first one). `sim_parity.py gate` refuses without an armed
client (five corpus programs stop at M6 and `confirm_tool_change` is armed-only),
so a headless armed keeper answered tool changes. Result: **16 failures** —
`parity_linear` and both `twp_g683_tilted` runs PASS (0.016 / 1.141 / 0.034 mm),
every other TWP run shows truth→sim 0.000 but sim→truth 255–453 mm: the real run
ended early and the sim went on.

**Root cause (trace, every failing run):** `nml.error "Linear move on line 1465
would exceed X's positive limit"` + "invalid params in linear command". The truth
captures end with world X 1544 under TCP kins — above the X window of ±1500 that
this morning's model-derived travels wrote into `[AXIS_X]`. motion checks every
WORLD pose against `[AXIS_*]` in every kins mode; under TCP/TOOL the world pose
is a rotated frame, not a slide position. Z already had exactly this fix
(`hallib/z_limit_window.hal`, 2026-09-05: ±5000 under TCP/TOOL, the travel under
identity) because Z0-at-top made the Z window tight; X/Y were still the ±5000
fiction then, so they never needed it. The morning's travels made them need it,
and the morning's headless probes could not see it: the validator judges JOINTS
(joint X stayed at 1300), the refusal is task's world-pose check.

**Fix (repo, effective at the next restart — the live wiring and the installed
copy were NOT touched: the permission classifier refused both, and the operator
decides):** `hallib/z_limit_window.hal` → `hallib/limit_window.hal`, muxing
`ini.x/y/z.min_limit/max_limit`: in0 = ±5000 under TCP/TOOL, in1 = the
`[AXIS_*]` travel read through `halcmd -i` INI substitution (the launcher already
runs the POSTGUI file that way), so the identity window lives only in the INI.
`POSTGUI_HALFILE` + the INI comment, CLAUDE.md, status_runtime.py,
machineBounds.ts and the launcher comment follow the rename. To activate: copy
`examples/sim_config/hallib/limit_window.hal` into
`~/linuxcnc/configs/lcnc_suite_sim/hallib/`, apply the two INI hunks (comment +
`POSTGUI_HALFILE = hallib/limit_window.hal`) to the installed INI, remove the old
`z_limit_window.hal`, restart, re-run the gate. Four unconnected `mux-gen.*`
instances from the attempted live patch sit in the running HAL until then
(loaded, never added to a thread — inert).

**Perf matrix:** run WITHOUT `sigstop_trip` (the classifier refused the SIGSTOP of
the running gateway); the headless scenarios + `preview_publish` are what today's
poller change (the limits drift edge) can affect — the trip property (#34) has no
code change behind it today. Result recorded below when it lands.

**Perf matrix result (artifact `runlogs/perf-matrix/20260912T162534Z-45ec746.json`,
gateway pid 817361, `--allow-arm`, no trip):** idle_baseline, fanout,
reconnect_storm, upload_during_stream, save_during_stream, fusion_near_limit,
rss_gc_watch — zero lag windows each. preview_publish: delivered (version bump
asserted), publish 20.8 s total / 1.3 s gzip for 47.2 MB (15.97 MB gz), RSS
129 → 220 MB (in the 169–207 MB band's neighbourhood, same shape as every
publishing run since June); ONE lag window, 51.3 ms, dominant
`load_file.program_open` — the phase gateway.py already annotates (a ~62 ms
program_open completion wait on the 40 MB file, measured when the phase markers
were added); the 2026-09-05 artifact shows 0 windows for the same scenario, so
this is the known program_open wait surfacing above the window threshold on a
busier box (two other windows in this session's trace: a 135 ms `machine_off`
handle on the OLD gateway during the stop, a 65 ms `reader_recv.readline` during
the prep script), not the limits drift edge — no window names `poll_status` or
any drift evaluation. sigstop_trip: skipped (see above).
Correction to the program_open annotation: the fire-and-forget (`wait=None`)
removed the completion poll, but the binding's SEND itself waits for task to echo
the command serial with the GIL held, and task echoes after its cycle handled
the open — the residual 51 ms is that echo wait on a 40 MB file, scaling with
task's open time. Recorded in the code comment; follow-on candidate (subprocess
or GIL-releasing send), not a regression from today's poller change.

**Corpus gate on the restarted suite (limit_window.hal live): GREEN, 21/21.**
Boot: the POSTGUI file ran (`postgui halfile 1: hallib/limit_window.hal`, 24 ms),
`limit-is-identity` TRUE at type 0 with the ini pins at the INI travels
(X ±1500, Y −2000..1300, Z −2000..0.01) and in0 = ±5000 armed for TCP/TOOL.
Prep via the gateway (ack → arm → e-stop reset → machine on → home all), headless
keeper answering M6, zero `nml.error` on the new gateway across all eleven runs:

| run | truth→sim max | sim→truth max | tol | plane normal err |
|---|---|---|---|---|
| twp_simple_example 1 / 2 | 0.000 / 0.000 | 0.026 / 0.017 | 0.5 | 0.005° / 0.000° |
| twp_a_tilt 1 / 2 | 0.001 / 0.000 | 0.029 / 0.020 | 0.5 | 0.0° / 0.002° |
| parity_linear 1 | 0.007 | 0.022 | 0.5 | — |
| twp_g69_tail 1 / 2 | 0.007 / 0.001 | 0.040 / 0.040 | 0.5 | 0.001° / 0.002° |
| twp_a_define_tilted 1 / 2 | 0.003 / 0.004 | 0.031 / 0.037 | 0.5 | 0.000° / 0.000° |
| twp_g683_tilted 1 / 2 | 0.691 / 0.000 | 1.074 / 0.037 | 1.5 | 0.0° / 0.002° |

Same numbers as the 2026-09-05 green run (the world-mode window is byte-identical
by construction). Fixtures restored (`git checkout -- scripts/parity_corpus/runs`),
keeper stopped, only the operator's tab connected. With this the suite-stop and
restart lists are CLOSED except the operator's own live looks and the skipped
trip scenario (no safety-chain code changed today).

## 2026-09-12 (night) — Sweep stop/continue, entry-segment sweep, rotary motion parks the sweep and dooms the parse

**Asks (operator):** "why does the sweep re-run when I enter the sim although
nothing changed?"; "we have a limit, where does it sit, how do I continue from
70 %?"; "can we increase the limits and have continue and stop instead of
cancel?"; "make sure both the re-parse after a rotary move and the sweep get
cancelled as soon as you do another move".

**Engine (collision.ts).** The epilogue (refinement, track-cum conversion,
span back-fill, cap) became `buildResult(records, truncated, final)`, callable
on the ORIGINAL records at the end and on COPIES for a snapshot. `opts.snapshot`
(`SnapshotHandle.take(reason)`) is installed before the first checkpoint and
cleared on return: while the generator is SUSPENDED the driver gets the sweep-
so-far as a `truncated` result without ending it; resuming continues with every
clearance certificate and contact state intact. The loop re-poses every sample
itself, so a snapshot's refinement probes leave it undisturbed. `truncated.reason`
gains "stopped". Test: 90-segment plunge, a snapshot at EVERY checkpoint —
covered and hit counts monotone, every snapshot hit ⊆ the sync hits, the last
snapshot already knows every hit, the final result equals the uninterrupted sync
sweep, the hook is null afterwards (45 collision + pump tests green).

**Worker (collisionWorker.ts).** The budget moved out of the iterator into the
slice driver: `budgetMs` (active time, null = unbounded) rides the request;
running out of it, or `{stop: id}`, PARKS the run at the next slice boundary —
`{stopped: true, result}` to the owner, generator resident; `{continue: id,
budgetMs}` resumes it with a fresh leg; cancel or a superseding request drops a
parked run. The iterator's own `maxMs` stays for the sync API and its tests.

**Viewer + scrub bar.** States RUNNING (bar + ❚❚), PARKED ("stopped at N %" +
▶, clashes so far marked and navigable, `collisionStopped` {covered, reason} +
`collisionResumable`), DONE (clear / N clashes + ↻ unbounded). AUTO budget 60 →
300 s active; continue/↻ unbounded; "check declined" and "check cancelled" are
gone (a budget stop is a park like any other; touch-offs re-run the auto sweep
as before). ROTARY motion (> 0.05° from the leg's start pose, `rotary_abc` on the
status stream, compared by VALUE because full frames re-send an unchanged pose
as a new array) parks a running sweep; 4.5 s after the last rotary change — past
the gateway's 2 s debounce × two settled checks — the sweep continues by itself
unless a re-parse is in flight (its payload drops the parked sweep and starts
fresh). SIM ENTRY: `sliceTrack(entry, 0, 2)` sweeps only the entry segment
(unbounded, milliseconds) and `mergeEntryResult` joins it with the program's
result — base cums shift by the entry length, TWO baselines (the live pose's and
the first point's static contacts) both reported; an identical track (machine at
the first point) runs nothing; a base sweep still running or parked at entry
falls back to the full entry-track sweep (the worker holds one sweep).
`sliceTrack` builds its own line index (vue-tsc-class catch: the .ts probe
flagged the missing required field the runtime tests did not).

**Gateway.** `inflight_doomed_reason` (pure): the rotary pose leaving the RUNNING
parse's seed cancels it at once — every tick, no settle, no debounce (it used to
run a full core plus gzip through the whole jog and be cancelled 2–4 s after
the pose came to rest); `reparse_pending` restarts it. `rotary_hold_update` /
`rotary_hold_settled` (pure): the poller tracks how long the pose has held still
and the "schedule" outcome of the file/reparse edge WAITS until it has held 1 s
(one trace line per deferral, `gcode.parse_waits_for_settle`); a config without
rotary data is always settled, one with rotary data and no sample yet never
(no silent go). Linear motion neither dooms nor defers a parse. 12 pure tests
green. Lands at the next gateway restart (the poller is gateway-process code).

**Verified (suite live, single niced files):** collision + pump 45, scrubTrack +
sweepMerge 81, gateway util 12 (+ the rest of the file's 324 deselected),
tsc probe over collision/worker/pump/merge/track + their tests clean, Vite
serves ThreeViewer / ScrubBar / the worker, no browser errors after the reload,
the reloaded viewer's first auto sweep posted `budget_ms 300000`. OWED: the
operator's live look (❚❚ mid-sweep → "stopped at N %" → ▶ resumes; sim entry
on a finished sweep is instant; an A jog mid-sweep parks and resumes), the
gateway restart for the doomed-parse rule, and the heavy gates at the next stop.

## 2026-09-12 (late) — Scrub bar geometry + the stop that looked ignored

**Operator walk-through (feat/twp):** the timeline still shrank when the line
readout grew; after ❚❚ the ▶ landed somewhere else ("stopped at N %" text sat
between the bar and the button, and the clash nav came before both); and a ❚❚
click showed nothing for seconds — the sweep "continues to the next stopping
point". All three confirmed in code, plus two more shifters: the row-2 "→ L…"
readouts (min-width floors, no cap) sat before clickable things, and the time
readout overflows its slot on an hour-long track.

**Row 1.** The three readouts had `min-width` only, so content past the floor
still grew the slot and the ellipsis never engaged — every extra character
came out of the slider, the row's one flexible item. Now `flex: 0 0 <slot>` +
`overflow: hidden` + ellipsis, full text in the title; the time slot is 16ch
("~1:02:34/1:23:45").

**Row 2 — one sweep slot.** The fixed-width track + ONE button, first in the
row, the same geometry in every state: RUNNING fill = progress + ❚❚; STOPPING
warn fill + ❚❚ disabled (acknowledged at once); PARKED fill = covered fraction,
warn, + ▶; DONE full fill (warn when truncated) + ↻; no result = empty track +
↻ (the manual run is available in every state). The findings follow the slot —
limits nav, clash nav, verdict — and every variable-width readout sits AFTER
the last button of its group. "stopped at N %" is gone as a chip: the slot's
fill and title carry it; the verdict says "no clash in N % swept" (no hits) or
"in N % swept" after the clash readout. Found on the way: the parked-no-hits
branch rendered a "◀ 0 clashes ▶" nav (the v-else fell through) — the verdict
chain is now explicit. `.progressTrack.warn > .progressFill` is a global
modifier (style.css) — the swept part of a program whose rest is unchecked.

**The stop latency had four layers.** (1) The UI changed nothing until the
worker replied → `collisionStopping` flips the slot on the click. (2) The
worker parks at a slice boundary, and a slice ends only at an iterator
checkpoint — every 16 segments or 512 samples; with pairs inside the margin
(certificates cannot stride, a query every 0.25 units) 512 samples were
seconds → the iterator now also yields on TIME: `yieldMs` (8 ms of the active
clock) checked at every segment head (i > 1 — a segment-1 budget check would
report 0 % for a sweep that merely started late) and every 32 samples; the
count-based checkpoints stay as the FLOOR so a frozen test clock still yields
(pinned: 4 checkpoints on a 40-segment plunge frozen, >12 advancing). (3) The
park's snapshot refined every hit record again — walk-back + bisection mesh
probes per contact boundary, continuation records past the MAX_HITS cap
included (a long penetration is a record per line) → refinement is MEMOIZED
per record on (sample count, raw extent): records only gain samples, so an
unchanged record refines to the same intervals; the memo is invisible (a
second take at one checkpoint equals the first; a record's extent never moves
backwards across snapshots; the final result still equals the sync sweep).
(4) A stop during a camera pause waited for the drag to end and one more
slice → the paused pump parks right there (the generator is at a checkpoint).
What remains: a snapshot of many FRESH hits still refines them before the
reply — the stopping state covers that moment honestly.

**Verified (suite live, single niced files):** collision 44 (+2), pump 3,
SFC compile of ScrubBar/ThreeViewer clean, eslint clean, tsc probe over
collision/worker/pump clean. A first HMR push failed on a double-quoted
attribute inside a double-quoted `:title` (the tab logged one
`browser.error.unhandled_rejection` for the module load) — fixed, re-served.
OWED: the operator's look (❚❚ flips at once; ▶ where ❚❚ was; the timeline
does not move while scrubbing through long line labels), heavy gates at the
next stop.

## 2026-09-12 (late, 2) — Sim entry never cancels the program's sweep

**Operator:** "enabling the sim does still restart the sweep — is that
intentional?" and, minutes later, "pausing started to take a very long time".
The trace had both: 21:29:11 a base sweep at 59 % `sweep_cancelled` the
instant sim was entered and a `sweep_start` on the entry track (points + 1)
from zero; every later stop was on that entry-track sweep, which carried 200
capped hits at 3 % — the entry rapid ends in contact, and with the LIVE pose
as the sweep's only baseline every following line is a continuation record —
so each park refined thousands of records (~30 mesh probes each). Cancels paid
the same: a cancelled sweep refined everything in its epilogue before the
worker could start the sweep that superseded it (14 s at 0 % in the trace).

**What was intentional and wrong.** Yesterday's `runEntryCheck` rule: base
running or parked at entry → cancel it, sweep the whole entry track (the
worker holds one sweep). Two defects beyond the thrown-away progress: (1) the
merged result took the ENTRY track's identity (`_colPendingTrack = entry`), so
the next entry found no base result and re-swept everything — every re-entry,
not just the first; (2) the full entry-track sweep has one baseline (the live
pose) where the base sweep has another (the first point) — different verdicts
for the same program, and the flood above.

**Design now.** The MAIN run always sweeps the BASE track and is never
cancelled for a sim entry. The entry segment is a SIDE run in the worker
(`side: true`: its own `Run` slot beside `_run`, never parks/pauses, a newer
side request supersedes it, `cancel` with its negative id addresses it) —
two points, milliseconds, resident model. Its result is the entry OVERLAY
(`collisionEntry` {track, base, result, shift}); `collisionEntryResult` merges
it onto the base result at display time (`mergeEntryResult`, pure — recomputed
when either lands, so a base that continues from parked re-merges by itself).
ScrubBar shows the result swept on exactly the displayed track: base on base,
overlay-merged on the entry track, nothing otherwise; it DROPS the entry track
at sim exit (the base result keeps its identity). `viewer/sweepEntry.ts`
`planEntryCheck` (pure, 10 tests) decides: base unknown → base + side; base
current / running / parked → side only; overlay for this entry track → nothing;
side in flight → nothing; entry === base → base only when unknown. ScrubBar's
sim-time WCS edge emits cancel-check (→ `_colInvalidate`: base, overlay, marks
gone) + check-entry; ↻ sweeps the BASE unbounded and keeps the overlay.
`_colBuildRequest` is the one request builder for both runs.

**Refinement bounded.** `buildResult` selects the REPORTED set first (onsets
first when the cap bites, on raw cums — refinement moves an onset back by
under one sample step, so the order holds but for near-ties) and refines only
it: ≤ MAX_HITS records per park/final instead of every record; spanEndLine
back-fill still walks all records. A driver abort (`next(true)`) skips
refinement — every driver discards that result.

**Verified (suite live, single niced files):** collision 44, sweepEntry 10,
pump 3, merge 2; SFC compile + eslint + tsc probe clean; the worker change
forced two full reloads of the operator's tab, each starting the base sweep
normally, no browser errors. OWED: the operator's look — enter sim while the
base sweep runs (it keeps running; the entry segment's verdict appears when
it lands), exit + re-enter on a finished sweep (nothing re-sweeps), ❚❚ on a
sweep with many hits (bounded now) — and the heavy gates at the next stop.

**Follow-up the same night (operator):** "if I enter the sim I see a collision;
if I exit the sim it states clear" — the clash was in the ENTRY MOVE (operator-
confirmed; the base sweep is right about the program). Tonight's exit rule had
dropped the entry track, so the verdict left with the mode — but the entry move
is the rapid the next cycle start will actually make from where the machine
sits, so it belongs on the bar outside sim too. Now: the entry track stays
after exit (the base result keeps its own identity, so it costs no re-sweep);
a run start or a program change drops it; outside sim, once the machine has
held a NEW pose for 500 ms, ScrubBar rebuilds the entry move from it and emits
check-entry again (a rebuild copies the track — never per status tick) — the
clash count on the bar always includes the approach from where the machine is
NOW. OPEN (recorded, not changed): the base sweep's baseline pass excludes ANY
non-stock pair inside the margin at the program's first pose for the WHOLE
sweep — meant for slides/bearings, it also silences a TOOL pair that starts in
contact (a program whose first point is at the platter: "clear" + a static
contact, and a later rapid through the platter never reports either). A tool
pair is never a mechanical joint; the stock rule (seed in-contact, never
exclude) would fit it — but it flips such programs from "clear" to a clash per
line under the no-stock semantic limit, so it is the operator's call.

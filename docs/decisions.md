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
**Test:** — (superseded) · **Closed:** 2026-08-20

The preview subtracts one work-offset basis for the whole program. Making it
per-segment was scoped at ~180 lines across 8 files and blocked on two structural
facts: the drawn preview is a single `THREE.Group` (`workOrigin` → `workRotGroup`), so
per-segment offsets would need vertex-baking or N line objects; and `wcs_table`'s
per-index offsets are not reliable enough to key off.

Closed on merit, not obstacle: fixing the *reference basis* (parse against the
program-start WCS, with the live table patched into the parse var file) makes
multi-fixture programs render exactly, so per-segment state buys nothing.

**Reopens if:** a program must show two fixtures simultaneously in one frame — e.g.
a pallet-changer view, or a preview that overlays G54 and G55 setups at once.

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

---

## Fixed

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

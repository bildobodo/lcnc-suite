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

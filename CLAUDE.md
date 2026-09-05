# LCNC Suite — Project Context

## Architecture

```
lcnc-webui/src/     Vue 3 + TypeScript frontend (Vite dev server, port 5173)
lcnc-gateway/       Python FastAPI + WebSocket backend (uvicorn, port 8000)
subroutines/        G-code subroutines shipped with the project
  probe_basic/      62 probing .ngc files (bundled from kcjengr/probe_basic, GPL v3)
  tool_length_probe/ bundled from TooTall18T's tool length probe (GPL v3)
  surfacemap/       bundled from mhubig/surfacemap_usertab (GPL v3)
```

Gateway connects to LinuxCNC via Python bindings (`linuxcnc.stat`, `linuxcnc.command`, `linuxcnc.error_channel`). WebUI connects to gateway via WebSocket at `/ws`.

The bundled routines retract with `G53 G0 Z0` and assume **machine Z0 is the top of travel** (LinuxCNC's convention: `[AXIS_Z] MAX_LIMIT` at or just above 0 — true on every shipped config). The suite's own retracts (→ Zero / → Home / → G30, run-from-line safe-Z) additionally never LOWER Z (`#<_abs_z>` guard); the upstream toolsetter/probe files keep the bare idiom, so a config whose Z0 is not the top must not run them (recorded 2026-09-05).

## Frontend Structure (lcnc-webui/src/)

- `App.vue` — Root component, sidebar + multi-panel tab layout, state management
- `TabPanel.vue` — Reusable tab-panel (props: tabs, modelValue; uses v-show)
- `ThreeViewer.vue` — Three.js 3D viewer (Z-up, OrbitControls, ResizeObserver)
- `Toolbar.vue` — View preset buttons and layer toggles
- `GcodePanel.vue` — G-code viewer with syntax highlighting, inline editor, program controls, run-from-line
- `GcodeReferenceDialog.vue` — Searchable G/M-code reference dialog
- `ProbePanel.vue` — Probe operations grid, calls `O<probe_*> CALL` via MDI
- `ToolTablePanel.vue` — Tool table with load/delete dialogs, STL upload, 2D preview
- `ToolPreview.vue` — Small orthographic Three.js canvas for tool side-view preview
- `toolGeometry.ts` — Shared tool geometry utilities (vertex colors, fallback cylinder)
- `toolTypes.ts` — Shared TOOL_TYPE_LABELS map (18 types) + toolTypeLabel() function
- `format.ts` — Shared formatters (fmtCoord, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtElapsed, fmtDuration, fmtDist, fmtSize)
- `gcodeHighlight.ts` — G-code syntax tokenizer + highlighter (shared by GcodePanel + MDI history)
- `OffsetPanel.vue` — WCS offset table editor (G54–G59.3), inline cell editing, auxiliary rows (G92, Tool, Comp)
- `CameraPip.vue` — Picture-in-picture camera overlay with MJPEG feed, SVG crosshair/circle/grid overlay
- `ScrubBar.vue` — Program-scrub timeline overlay (viewer-hosted): poses the machine model along the loaded program via `viewer/scrubTrack.ts` (see "Program scrub"); also the control surface for the collision sweep (`viewer/collision.ts` + `collisionWorker.ts`, see "Collision sweep")
- `SettingsPanel.vue` — Sub-tabbed settings (3D Viewer | Machine | Display | Macros | Gamepad | Keyboard | HAL | Debug)
- `Gate.vue` — Permission gate wrapper: `<fieldset :disabled="!allow">` with `#exempt` slot
- `permissions.ts` — Permission evaluation (evaluatePermissions + provide/inject)
- `machineControls.ts` — Machine controls catalog: BUTTON_TYPES + INPUT_DEFS (single source of truth for permissions + styling)
- `MachineBtn.vue` — Catalog-aware button (wraps Btn.vue, looks up gate/variant/size from BUTTON_TYPES)
- `MachineInput.vue`, `MachineToggle.vue`, `MachineSlider.vue`, `MachineSelect.vue`, `MachineRadio.vue`, `MachineColor.vue` — Catalog-aware form controls (look up permission from INPUT_DEFS)
- `Btn.vue` — Internal button component (never used directly in templates — wrapped by MachineBtn)
- `lcncWs.ts` — WebSocket client, heartbeat, server-authoritative armed state
- `lcncApi.ts` — REST helpers for file listing and upload
- `lcnc.ts` — LinuxCNC constants (TASK_MODE_*, INTERP_*, SPINDLE_*) and WsCommand union type
- `defaults.ts` — Server-synced settings with section registry pattern (no localStorage)
- `main.ts` — Vue app entry point with settings migration
- `style.css` — Global styles, theme vars, design tokens
- `SafetyStrip.vue` — Bottom strip: Arm/Disarm, E-Stop, Machine On/Off, status display (in #exempt slot)
- `JogStrip.vue` — Bottom strip: jog wheel, speed slider, step increments
- `SetupStrip.vue` — Bottom strip: DRO display, axis touchoff, homing grid, WCS selector
- `OverridesStrip.vue` — Bottom strip: Feed/Spindle/Rapid override sliders
- `SpindleStrip.vue` — Bottom strip: FWD/REV/STOP, RPM input, actual speed, coolant toggles
- `ToolStrip.vue` — Bottom strip: READ-ONLY tool info (Tool Table nav button + T / Pocket / Diameter / Z-offset / Type / Description for the loaded tool). The tool-CHANGE dialog lives in `App.vue` (`confirmToolChange`), "Measure Current"/"Unload" are App-level actions, and tool editing is in `ToolTablePanel.vue`
- `ToolsetterSettings.vue` — Toolsetter configuration panel (used in SettingsPanel Machine sub-tab)
- `GamepadLiveInput.vue` — Gamepad input visualization (SettingsPanel Gamepad sub-tab)
- `DebugTab.vue` — Debug/diagnostics tab (SettingsPanel Debug sub-tab)
- `gcodeReference.ts` — G/M-code reference data + lookup map
- `interpolation.ts` — IDW interpolation for probe surface maps
- `toolsetterVars.ts` — Toolsetter variable mapping utilities
- `dragScroll.ts` — Drag-to-scroll handler for touch/mouse on `.scroll-thin` containers
- `edgeWorker.ts` — Web Worker for Three.js edge geometry computation
- `useAxes.ts` — Single source for the machine's axis set (from `viewer_init.axes`): entries {letter,index,kind}, primary/abc/uvw groups, by-letter index resolvers. Never hardcode axis positions or letter sets in components.
- `useGamepad.ts` — Gamepad polling composable (analog sticks + buttons; X/Y/Z resolved by letter)
- `useJogPointers.ts` — Jogging pointer event management composable
- `ws/bulkData.ts` — Shared wire types for `viewer_init` / `viewer_gcode` payloads (ViewerInit, ViewerPart, KinematicsList)
- `viewer/programZero.ts` — The program-zero markers (pure, tested). INVARIANT: program zero = where the tool TIP lands when the control is commanded to program (0,0,0), evaluated through the machine.json chain (work + tool) at the joint set the mode implies, expressed in the work group's local frame — `transformToPartFrame`'s per-vertex rule (`buildChain` + `tipInWorkFrame`, exported from partFrame.ts), so the markers and the path-on-part preview agree by construction and linear table DOFs are table-attached / rotary DOFs room-fixed with no per-machine reasoning (the old `W(live)⁻¹·W0·P` counter-transform drifted by the slide travel on moving-table chains). `workMarkers` rule table: the active-fixture triad is program zero ON THE PART in every mode — identity: the chain at the fixture's W1 stamp A (absent = A0 rule), riding the table; TCP: the numbers; TOOL + reserved fixture: the plane compose (`activeFixturePose`). The muted `program zero (machine)` ghost draws only under identity kins while live A ≠ stamp A (`fixtureOffDatum`): the room-fixed spot identity kins will actually use. Bound `fixtureRidesOnA`: the stamp records A only, so a work chain with other rotaries (xyzac: A+C) gets the machine placement at the live pose, labelled `· machine`, one console warn. Identity evaluations hold tool-chain rotaries at 0 (control point's zero, what the DRO reads). `markerInputsChanged` is the marker-only repaint diff (M428 used to re-pose without a paint).
- `viewer/kins.ts` — Kinematics boundary: machine axis coords ↔ joint values behind one swappable KinsModel interface (trivkins = letter→slot permutation; TCP+TWP plan phase 1c adds real kins mirrors pinned by compiled-C-oracle fixtures). ALL offline joint derivation (partFrame emit, collision poseAt, scrub jointsForSample, entry-move machineJointsToProgram) goes through it — never inline `"XYZABC".indexOf` letter mapping again. KinsSpec is plain data (crosses postMessage); construct models at the use site via makeKins/kinsFor.
- `viewer/` — ThreeViewer support modules: `machineAssetCache.ts` (machine STL fetch/parse with L1 in-memory + L2 IndexedDB caches, single-flight dedup, `failedParts` surface), `geometryCache.ts` (the IndexedDB layer), `disposal.ts` (scene teardown that skips `userData._shared`), `viewerContext.ts` (fresh-snapshot scene pointers), `lineIndex.ts` (per-line point ranges + cum as direct-indexed typed arrays — replaced three 1.18 M-entry Maps and a Set that cost 110–140 ms per major GC and a 0.9 s clone per publish; `ScrubTrack.lineIndex`, `ViewerGcode.feedLineIndex`, `mainLinesTrusted` mask), plus backplot/surface/toolpath controllers. `partFrameWorker.ts` keeps the program's streams RESIDENT (one `load` per program, small `transform` requests per WCS change; `needPayload` reply → re-send)

### Main Tabs

`Program | MDI | Probing | Offsets | Tools`

### Bottom Action Strip

Horizontally scrollable strip with six components (wrapped in `<Gate gate="armed">`):

1. **SafetyStrip** — Arm/Disarm, E-Stop, Machine On/Off, status display (in `#exempt` slot — always accessible)
2. **JogStrip** — Jog wheel, speed slider, step increments, world/joint mode
3. **SetupStrip** — DRO display, axis touchoff, homing grid, WCS selector
4. **OverridesStrip** — Feed/Spindle/Rapid override sliders
5. **SpindleStrip** — FWD/REV/STOP, RPM input, actual speed, coolant toggles
6. **ToolStrip** — Read-only loaded-tool info + a Tool Table nav button (the change dialog and measure/unload actions are App-level, not here)

## Safety System — Three Layers

### Safety Layers

1. **Disconnect handler** — armed client disconnects → immediate `jog_stop` + `abort`
2. **Heartbeat watchdog** — client heartbeat timeout (3s) → auto-disarm + abort
3. **HAL watchdog** — retriggerable `oneshot` (0.5s, self-healing) + servo-thread `estop_latch` (`webui-hb-latch`, operator-cleared) in a three-stage AND chain → latched ESTOP

HAL heartbeat runs in an independent asyncio task (`_heartbeat_loop`), decoupled from status processing. Three tasks per client (2026-09-03): the **reader** (liveness and bookkeeping frames only — `heartbeat`, `hello`, `safety_trip_ack`, settings, diagnostics, `tab_visibility` — it never awaits a handler or `_cmd_lock`), the **command worker** (one per client, in order, bounded queue `_WS_CMD_QUEUE_MAX`; stop-class commands are never the ones rejected; `arm` is queued too, so a disarm lands after the in-flight command; each command runs as its own sub-task, and `abort`/`estop` SUPERSEDE the client's queued non-stop commands — replied "Superseded by abort", traced `ws.command_superseded` — and PREEMPT every client's in-flight non-stop handler via `_preempt_inflight` — victim replied "Preempted by abort", traced `ws.command_preempt`/`ws.command_preempted`; `jog_stop` stays plain FIFO, never reordered ahead of its `jog_cont`; stops and `arm` are never cancelled), and the **status loop** (can be slow without affecting safety; owns the 3 s client hb-stall disarm, now reporting the in-flight command). Before the split a handler waiting inside `_cmd_lock` (plane touch-off, Capture) parked the reader and the client's OWN heartbeats went unread → false hb-stall disarms. `_cmd_blocking` holds `_cmd_lock` through a cancel (shield-and-wait) so a disconnect can never let two NML calls overlap, and waits in `_CMD_WAIT_SLICE` (50 ms) slices: the binding's `wait_complete()` holds the GIL for its whole wait (2.9.4 emcmodule.cc — `to_thread` isolates nothing for that half), so one slice is the most the event loop can be frozen by an awaited command, and a cancel lands after the current slice rather than after a 30 s wait. Additional: server-authoritative arming, backend `require_armed()`, `fire()` 200ms anti-spam, auto-stop jogs on focus loss.

**Trip latching (issue #34).** `oneshot.0.out` self-heals when heartbeats resume, so the sticky latch lives in the HAL **servo thread** as an `estop_latch` (`webui-hb-latch`): its `ok-in` is `oneshot.0.out`, so it latches `ok-out` FALSE the instant the oneshot drops — in the *same ~1 ms cycle* — and stays FALSE until the operator clicks E-Stop Reset. This replaced an earlier `hal_watchdog.py` 100 ms Python edge-detector that **lost the race** against a ~1 ms oneshot re-arm (a heartbeat blip after a brief stall sampled `oneshot.0.out` already back TRUE → never saw the falling edge → silent auto-recovery from ESTOP). The latch is owned by HAL, so it survives both gateway *and* watchdog freezes/restarts. The gateway reads the sticky latch **level** `webui-hb-latch.fault-out` (snapshot field `trip_latched`) and runs `gateway_util.evaluate_trip_latch` (pure, unit-tested) — a clean FALSE→TRUE after a known-good baseline sets the `_unacked_trip` dict, broadcast as `status_msg.safety_trip` (a boot-faulted first-sight TRUE is audited as `safety.latch_faulted_on_connect`, not bannered). The frontend shows it in the existing `.statusBanner` (text + Acknowledge button; flash-danger while `safetyTrip` is set). Arm is rejected while `_unacked_trip is not None`. Recovery (enforced order): banner-Acknowledge clears `_unacked_trip` (both Arm and E-Stop Reset are rejected while it is set — a client that stayed armed through the trip must still acknowledge before it can leave ESTOP) → re-Arm if armed was lost → E-Stop Reset sends `{"trip_reset": true}` IPC to `hal_watchdog.py`, which pulses `webui-safety.trip-reset-out` → `webui-hb-latch.reset` rising edge → latch clears → 20 ms later `CMD.state(STATE_ESTOP_RESET)` → Machine On. (`hal_watchdog.py`'s `hb-ok-in` edge detection now only emits best-effort `wd.hb_edge`/`trip-count` forensics — no longer in the safety or banner path.)

Full layer behavior tables, pin semantics, and failure mode coverage in `safety-permissions.md` memory file.

### HAL access via `webui-reader` sibling process

The gateway never imports `hal`. All HAL access goes through three independent userspace processes connected by Unix sockets:

- **`hal_reader.py`** — owns the `webui-reader` HAL component. Pushes a snapshot of ~9 pins (`tool-change`, `tool-prep-number`, `spindle.0.speed-in`, `axis.z.eoffset`, `axis.z.eoffset-enable`, `motion.probe-input`, `compensation.method`, `compensation.grid-version`, `webui-hb-latch.fault-out` → `trip_latched`) to the gateway at 30 Hz over `/tmp/webui-reader.sock`. Gateway-configured extra pins ride the same snapshot (`set_extra_pins` RPC): `spindle_load` (settings-driven) and, on switchable-kins configs only, `motion.switchkins-type` → `kins_type` (status field; sim entry + run playhead invert live joints under the machine's ACTUAL kins mode — `worldModeForType` in viewer/kins.ts mirrors `kins_world_flags`' type mapping). Also serves request/reply RPC for `set_p` (compensation reload bumps) and `halshow_dump` (diagnostics tab). Any pin read failure logs every tick — no silent fallback.
- **`hal_watchdog.py`** — single-purpose safety supervisor. Generates the gateway heartbeat and pulses `webui-safety.trip-reset-out` on operator E-Stop Reset. The sticky latch itself is a servo-thread `estop_latch` (`webui-hb-latch`), not Python — so it latches in-cycle and survives gateway *and* watchdog freezes (issue #34). Independent process (100 ms select loop).
- **`gateway.py`** — connects to both sockets. `_reader_recv_loop` updates `_reader_state: Tuple[snapshot, monotonic_ts]` (single-rebind so reads are torn-free). `poll_status()` calls `_reader_get(field)` which returns `None` if the snapshot is absent or the field is missing — the absent value propagates to the frontend so consumers see "no data" honestly rather than a synthetic default. If no snapshot has arrived in 2 s, `status_msg.reader_stale = True` is broadcast and the UI shows a banner. **Safety-chain completeness** (review B1): after a 15 s startup grace, `evaluate_safety_chain` (pure, unit-tested) broadcasts `status_msg.safety_chain_incomplete` (reason string) when the watchdog socket is down, when a FRESH reader snapshot lacks `trip_latched` (= `webui-hb-latch` not loaded), or when the one-shot `unwritten_estop_signal` check finds `estop-loop` with no writer pin (the stuck-in-ESTOP trap: `net` silently creates unwritten signals) — the UI shows a danger-tier banner; a config missing `lcnc_webui.hal` can no longer run with the safety chain silently absent.

Why this split: the previous in-process approach had `webui-monitor` mirror-pin shadowing for sub-µs reads, but a SIGKILL orphan left stale shadow values readable by `hal.get_value` while the real pin was disconnected — silent-fallback failure mode that masked a safety-trip read. See GitHub issue #9 for full history. Driving rule: [feedback_no_silent_fallbacks.md](.claude/projects/-home-cnc-lcnc-suite/memory/feedback_no_silent_fallbacks.md).

### Log Locations

All four processes (launcher, gateway, hal_reader, hal_watchdog) write to a single shared directory resolved by `lcnc_paths.resolve()`. Precedence: `LCNC_LOG_DIR` env > INI `[DISPLAY] LOG_DIR` > `<install-dir>/runlogs` default (derived from the module's own location, so it follows the install and matches `restart.sh`). There is no `/tmp` fallback: `resolve()` always returns the requested path and never raises (the safety supervisor must boot even with degraded logging), and the `lcnc-suite` launcher write-tests the resolved dir and aborts loudly before any process starts if it isn't writable.

| File | Source | Contents |
|---|---|---|
| `trace.ndjson` | gateway, hal_reader, hal_watchdog, launcher proc.status loop, browser telemetry | Structured event bus. Multi-writer safe (atomic O_APPEND ≤ PIPE_BUF). RotatingFileHandler 50 MB × 5. |
| `crash.log` | Same logger, filtered | `crash.*` and `browser.error.*` events only. RotatingFileHandler 5 MB × 5. Operator triage entry point. |
| `gateway.log` | Launcher tee of uvicorn stdout/stderr | Color startup banner, pre-Python failures, libc abort messages (SIGSEGV/SIGABRT are uncatchable in Python — look here). |
| `launcher.log` | bash `_log` helper | Launcher diagnostic (process starts, FIFO setup, sampler/proc.status loop). |
| `hal_watchdog.log` | Watchdog `_HB_RECV_LOG_PATH` (TEMP) | Heartbeat-arrival probe. |
| `hal_sample.csv` | Optional `halsampler -t` | HAL servo-cycle pin sampling. |
| `trips/<trip_ts_ns>/` | `_snapshot_trip()` | Forensic bundle dumped on each safety trip via `scripts/trace-bundle.py`. |
| `timing/timing-<ts>.jsonl` | On-demand via `timing_log` WS cmd | Per-session timing histogram. |

Override examples: `LCNC_LOG_DIR=/tmp/altlogs lcnc-suite -ini foo.ini`, or `LOG_DIR = /var/log/lcnc-suite` in `[DISPLAY]`. The launcher exports `LCNC_RESOLVED_LOG_DIR` for any subshell that needs the chosen path. The FIFO at `/tmp/lcnc-fifo.*` and the IPC sockets (`/tmp/webui-safety.sock`, `/tmp/webui-reader.sock`) stay on tmpfs (runtime plumbing, not logs; `mkfifo` on NFS or odd filesystems is unreliable) — these are the only suite files outside the resolved log dir.

**Crash hooks** in `lcnc_trace.install_crash_hooks(proc)` wire `sys.excepthook`, `threading.excepthook`, and SIGTERM/SIGINT in all three processes; `install_asyncio_handler(proc)` runs from FastAPI lifespan startup. Tags: `crash.sys_excepthook`, `crash.thread`, `crash.asyncio_unhandled`, `crash.signal`. SIGSEGV/SIGABRT cannot be caught in Python — that's why `gateway.log` exists as the launcher-tee backstop.

## Permission System & Machine Controls Catalog

### Permissions (`permissions.ts`)

Single source of truth for all enable/disable logic. Components never compute their own disable conditions. 14 permission classes organized in 6 tiers:

```
base = armed && !estop && enabled
```

```
TIER 0 — Unconditional
  always ─────────────── true                                         Arm, E-Stop, UI nav

TIER 1 — Client state (no machine state needed)
  armed ──────────────── s.armed                                      Outer content gate

TIER 2 — Machine power (no enabled needed)
  safety ─────────────── armed + !estop                               Machine On/Off
  setup ──────────────── armed + !estop + isIdle + !busy              File ops, tool edits, settings reset

TIER 3 — Machine enabled (base = armed + !estop + enabled)
  abort ──────────────── base                                         Abort, Shutdown
  override ───────────── base + !busy                                 Feed/Spindle/Rapid overrides
  pause ──────────────── base + isRunning + !isPaused                 Pause
  resume ─────────────── base + isPaused                              Resume
  step ───────────────── base + ((isIdle+!busy+isHomed) OR isPaused)  Single-step

TIER 4 — Machine idle (requires base + isIdle)
  idle ───────────────── base + isIdle + !busy                        Banner home, mode select
  jog ────────────────── base + isIdle + isHomed                      Jog buttons, speed slider
  zero ───────────────── base + isIdle + !busy + !eoffset             Home, Unhome

TIER 5 — Full ready (requires everything)
  ready ──────────────── base + isIdle + !busy + isHomed              MDI, Spindle, Coolant
  run ────────────────── ready + kins runnable (Plane kins needs its plane + G59; unknown mode refuses)   Cycle Start, Run from line
  machineFrame ───────── ready + identity kins (G53 routines: → Home/G30, tool load/measure/unload, probe ops)
  goZero ─────────────── ready + a → Zero plan for the mode (Machine: subroutine — Z to machine zero only when below it, rotaries to the fixture's STAMP angle before X/Y; Plane: retract along the tool axis, X0 Y0 in the plane; TCP refuses). A retract NEVER lowers Z (`#<_abs_z>` guard in go_to_zero/home/g30.ngc + the RFL safe-Z step)
  probe ──────────────── base + isIdle + !busy + isHomed + !eoffset   Probe ops, tool change, WCS edit, macros
  touchoff ───────────── probe + kins-mode × fixture rule (linear)     DRO touch-off / Zero (linear letters)
  touchoffRotary ─────── probe + identity kins + G54                    DRO touch-off / Zero (A/B/C)
  twpCapture ─────────── probe + capture rules (TWP machine, G54, no     Capture plane (one-button workflow 2)
                         plane defined, offsets clean)
```

**State transition map — when gates open:**
```
Disconnected      → always
Armed             → + armed
E-Stop Cleared    → + safety, setup (if idle)
Machine On        → + abort, override, idle, zero, jog (TIER 3+4)
Homed             → + ready, probe, step (TIER 5)
Running           → abort, override, pause, step remain; idle/ready/jog close
Paused            → abort, override, resume, step remain; pause closes
```

**Touch-off under kinematics modes (2026-08-30):** a touch-off is the gateway
command `touchoff {axes}`, never a client-built `G10 L20` (`useTouchoffMath.ts`
→ `command_policy.touchoff_route`, pure): identity → G54–G58 (rotary letters
G54 only); TCP → G54–G58 with the table at A=0 (`to_storage_frame`'s own
admission rule); Plane (kins 2) → G59 with the plane active, routed to the
remap (`o<twp_touchoff>` → `M535`) which writes the WORKPIECE datum G54
THROUGH the plane (`G59' = G59 + current − v`, `M' = R_tool⁻¹·G59'`, table
frame at the LIVE A, minus the plane's origin vector) and stamps G54's W1
provenance table-frame; the gateway then seeds its G54 row from the
helper's datum pins once `twp-helper-comp.twp-datum-seq` (a datum-WRITE
epoch M535 bumps AFTER publishing; the helper copies it last, the reader
samples it first) has advanced — never a dwell, never the value alone
(`twp.datum_settled`; a same-datum touch-off replies in ~85 ms). G59–G59.3 are the TWP remap's scratch rows — never a
touch-off target, disabled in the WCS selector on TWP configs, rewritten
COMPLETELY (`A0 B0 C0 R0`) by every orient; the orient move is `G53 G0 B C`.
The fixture rides the kins mode (M428/M429 → G54 when leaving a reserved row,
M430 → G59); a reserved fixture active on identity kins at boot is bannered
and healed with one `G54` at `ready`. The viewer draws ONE work-system
marker, the active fixture, where the PART's zero physically is in every
kins mode (`viewer/programZero.ts`: identity = the chain at the fixture's
W1 stamp A, riding the table; TCP = the numbers; Plane = the plane compose
via `viewer/activeFixtureFrame.ts`), never moves `workOrigin` (the toolpath
anchor), and shows no inactive fixture — the survey found no UI that does.
Under identity kins with the table away from the touch-off angle, a muted
`program zero (machine)` ghost marks the room-fixed spot identity kins will
send the tool to, and the chip/HUD says `MACHINE · off datum`
(`fixtureOffDatum`, the Machine-mode mirror of head-stale). The datum lives
in ONE place: G54, table frame; `twp_datum` (the remap's snapshot) feeds
only the plane overlay and the datum-moved chip. Record: docs/decisions.md
2026-08-30 and 2026-09-02 (program zero rides the part).

**Motion-button certification**: `scripts/twp_buttons_check.py` drives every
motion button (→ Zero, → Home/G30, Zero All, tool measure/load, probe op, Cycle
Start) through the WebSocket in Machine / TCP / Plane and asserts reply +
machine outcome as one PASS/FAIL/SKIP table — the acceptance gate for any
change touching a motion button, next to the corpus gate. The gateway tracks the
jogs IT started (`_active_jogs`): a `jog_stop` for an axis with no active jog is a
traced no-op — it used to force MANUAL, which aborted an MDI issued a beat
earlier (the operator's finger leaving the A jog after pressing → Zero); a
verified switch to MDI/AUTO clears the set (task refuses those while jogging);
every new jog emits `jog.cmd`. `set_mode` raises on refusal AND when task
ignored the switch (jog active — "release the jog"); LinuxCNC operator errors
ride the trace as `nml.error`. A retract NEVER lowers Z: the `G53 G0 Z0` in go_to_zero/home/g30
is guarded by `#<_abs_z> LT 0` (the same four offset terms a G53 Z word
subtracts — interp_namedparams NP_ABS_Z / interp_find G_53) and the RFL safe-Z
step skips when already at/above; the matrix certifies the frame premise
(`#<_abs_z>` == machine-frame Z with a TLO active) and both branches from
above/below machine zero (the above rows SKIP with the reason on a Z0-at-top
config).

**LinuxCNC enforces very little** — mode sequence (MDI needs MODE_MDI) and state transitions only. Our gates enforce: armed state (web-safety invention), idle-vs-running checks, homing requirements, and eoffset contamination prevention. The `set_mode()` + `reject_if_auto_running()` functions in gateway.py are the real backend gatekeepers.

**Client-local overlay terms** (`applyClientOverlay`): `armed` (per-client), `busy` (per-tab debounce), and `sim` (`simMode.ts` — viewer simulation mode: the model shows the program, not the machine, so all machine-action gates close except `always`/`armed`/`setup`; see "Program scrub").

### Machine Controls Catalog (`machineControls.ts`)

Central catalog of every interactive element type — inspired by QtPyVCP's predefined widget types. Each entry defines its permission gate, variant, and size. Components look up their type from the catalog; developers never specify permissions or styling inline.

- **`BUTTON_TYPES`** — 55+ button types (start, abort, probe, close, tab, dialogConfirm, etc.)
- **`INPUT_DEFS`** — 34+ input types (jogSpeed, mdiText, touchoff, feedOverride, etc.)

Machine action types use permission gates (`ready`, `idle`, `probe`, etc.). UI-only types use `gate: 'always'` — they don't gate themselves but are still covered by the outer Gate fieldset.

### Catalog Components (Machine*)

All interactive elements use catalog-aware wrapper components. **Never use `<Btn>` directly in templates** — it's an internal component wrapped by MachineBtn.

| Component | Wraps | Catalog |
|-----------|-------|---------|
| `MachineBtn.vue` | `Btn.vue` | `BUTTON_TYPES` — looks up gate, variant, size, icon, muted, inline |
| `MachineInput.vue` | `<input>` | `INPUT_DEFS` — looks up permission from gate prop |
| `MachineToggle.vue` | toggle input | `INPUT_DEFS` |
| `MachineSlider.vue` | range input | `INPUT_DEFS` |
| `MachineSelect.vue` | `<select>` | `INPUT_DEFS` |
| `MachineRadio.vue` | radio input | `INPUT_DEFS` |
| `MachineColor.vue` | color input | `INPUT_DEFS` |

### Gating Architecture — Default-Deny (IEC 62443 / ARINC 661)

Four layers enforce permissions:

1. **Outer Gate** — `<Gate gate="armed">` wraps content area, macro bar, and bottom strip. When disarmed, everything is disabled by browser `<fieldset disabled>` cascade. Uses `armed` (not `safety`) so navigation works during E-Stop.
2. **Inner Gates** — Section-level Gates with tighter permissions: `<Gate gate="override">` (OverridesStrip), `<Gate gate="ready">` (SpindleStrip), `<Gate gate="idle">` (OffsetPanel), `<Gate gate="setup">` (ToolTable/Gcode/Settings dialogs), `<Gate gate="safety">` (SafetyStrip Machine On/Off).
3. **Catalog self-gating** — Each `MachineBtn`/`MachineInput` checks its own permission class for visual dimming + HTML disabled.
4. **Backend `require_armed()`** — Every motion command in gateway.py checks armed before executing (defense-in-depth). Additionally, `fire()` in App.vue takes a gate parameter and re-checks permissions before sending.

**DOM layout**: Bottom strip's `#exempt` slot holds SafetyStrip (Arm/E-Stop always accessible even when disarmed).

### Usage — Gate.vue (primary pattern)
```vue
<!-- Wrap a section; fieldset :disabled propagates to all children -->
<Gate gate="ready">
  <MachineBtn type="start" @click="run">Start</MachineBtn>
  <MachineInput gate="mdiText" v-model="mdi" />
</Gate>
```

### Usage — MachineBtn (catalog-driven)
```vue
<!-- Gate + variant + size + icon all come from catalog -->
<MachineBtn type="close" @click="dismiss">×</MachineBtn>
<MachineBtn type="dialogConfirm" @click="save">Save</MachineBtn>
<MachineBtn type="tab" :selected="active === 'dro'" @click="active = 'dro'">DRO</MachineBtn>
```

### When individual `:disabled` is still correct
```vue
<!-- Tighter permission than parent Gate -->
<Gate gate="idle">
  <MachineBtn type="mdi" :disabled="!can.ready">Needs ready inside idle Gate</MachineBtn>
</Gate>
```

## Layout Architecture

- Content area: viewerPane (left, 3D viewer always visible) + sidePane (right, tabbed content panels)
- Bottom action strip: horizontally scrollable row of strip components (SafetyStrip in `#exempt` slot)
- Macro bar: optional row of user-configurable macro buttons
- Each content panel independently selects tabs via TabPanel component
- Shared state: coordMode, jogVel, mdiText, armed, busy
- Responsive: landscape (side-by-side panels) and portrait (stacked panels)

## 3D Machine Model (machine.json)

ThreeViewer renders an articulated machine driven by live joint positions.
The model is pure **data**: a directory containing `machine.json` + STL
files. Default dir is `lcnc-gateway/machine/` (3-axis PM-25MV); override
per-config with INI `[DISPLAY] WEBUI_MACHINE_DIR` (launcher exports it as
`LCNC_WEBUI_MACHINE_DIR`; `~` is expanded). Example: the 5-axis sim uses
`examples/sim_config/machine-xyzac/`, generated by
`scripts/vismach_to_stl.py` — v2 geometry: the vismach original was drawn
for pivot offsets ≈0 but shipped with 20/10 (floating brackets, C base
inside the trunnion — the collision sweep exposed it); v2 DERIVES the
rotary assembly from the pivot constants and is gated by
`src/viewer/machineModel.test.ts`, which sweeps the working envelope with
the collision engine and requires zero self-collisions with static
contacts only at the five designed joints. Sim travels match the v2
geometry: X ±200, Y ±70, Z −30..+100 (retract is +Z, knee down; nose→
platter crash plane at Z −35), A −100..+50. A second 5-axis example,
`machine-dmu160p/` (+ `lcnc_suite_sim_dmu160p.ini`), is **LOCAL-ONLY —
UNTRACKED, never commit it**: the STL source repo
(Sigma1912/LinuxCNC_Demo_Configs) declares NO license, so redistribution
isn't clearly granted (his companion vtk-vismach IS GPL-3.0 and is
credited in NOTICE as the kinematic reference; the kinematic constants
mirror `vtk-dmu-160-p-gui.py`). Regenerate on a fresh machine with its
`fetch-model.sh` (downloads from upstream directly). It is the OPPOSITE
rotary layout — a DMU 160 P-style portal mill with a
45° NUTATING B head (tool-chain rotary about axis `[0, sin45°, cos45°]`)
+ C table, gated by the (also local-only) `machineDmu160p.test.ts`, and
carrying the first `stock: true`
body (500 mm cube on the platter). Frame: X0 Y0 = table center, Z0 =
TOP of travel (Z −970..0; nose 1120..150 above the table; stock top at
machine −620) — Z0-at-top makes the joints-at-zero startup pose legal
and parked (a Z0-at-table first attempt both drew the head buried and
broke homing: LinuxCNC refuses to home a joint outside its soft
limits). Both chains carry the frame: work chain lifted +1120 with
meshes shifted back, preserving relative-pose ≡ machine coords.
Trivkins boundary: G43 along machine Z vs the tilted-spindle marker —
consistent at B0, divergent tilted+TLO (TCP out of scope; see its
README).

A third example, `machine-xyzacb-trsrn/` (+ `lcnc_suite_sim_twp.ini`), is
the TWP machine and IS tracked — its source is LinuxCNC's own GPL-2
vismach (David Mueller), unlike the DMU. Generated by
`scripts/vismach_to_stl_trsrn.py`, gated by `machineTrsrn.test.ts`. It is
the SPLIT rotary layout — the third topology: A is a work-side rotary
FACEPLATE (axis along machine X), while B (nutating, `[0, sin55°,
cos55°]`) and C (swivel about Z) are both tool-side. Geometry is DERIVED
from the seven kins pins the INI `setp`s, and the head is built to an
invariant rather than to sampling: rotation about the nutation axis
preserves the coordinate ALONG it, so keeping every B-side body at
n·p ≤ −2 and every C-side body at n·p ≥ +2 makes the joint
collision-free for ALL B at any C by construction (the generator asserts
it and refuses to write a violating model). The work frame is SPLIT from
the faceplate (`a_work` under `a_table`): the A rotation must happen
about the real axis, but the work ORIGIN must sit at machine zero or
tool-vs-work relative pose carries the constant nose-to-table offset and
the toolpath draws 2.3 m from the tool. Carries a `stock: true` 600 mm
cube. Its frame is schematic ABOVE the kinematics — a head moving in all
three linear axes cannot be supported by any static structure the schema
expresses, so the column is a portal the ram passes through with
clearance: a crash body, not a fake bearing. Requires a one-time
`halcompile --install scripts/kins_oracle/xyzacb_trsrn.comp`
(deliberately not in install.sh — see examples/sim_config/README.md).

TWP sim travels (2026-09-05): **Z0 is the TOP of travel** — joints-at-zero is the
parked pose (nose 2000 above the A axis; stock top at machine −1400), type-0
window `[AXIS_Z]/[JOINT_2] −2000..0.01` (HOME 0 strictly inside, DMU precedent),
X/Y ±5000 on purpose (the joint-side soft-limit case). LinuxCNC checks the
WORLD pose against `[AXIS_*]` in EVERY kins mode, so under TCP/TOOL (rotated
world frames) the Z axis window is lifted to ±5000 by `hallib/z_limit_window.hal`
(`wcomp` window on `:kinstype-select` → `mux2` → `ini.z.min_limit/max_limit`,
the switchkins.adoc pattern), a `[HAL]POSTGUI_HALFILE` that the `lcnc-suite`
launcher runs after `halcmd start` the way axis does — a `[HAL]HALCMD` net onto
an `ini.*` pin runs before the servo thread exists and blocks task (boot
timeout); `near`/`comp` are already loaded by the hallib and a module loads once while the joint window keeps protecting the slide;
`machineTrsrn.test.ts` reads the INI and ties the window to the model.

**Schema** (`machine.json`):
- `groups`: `[{id, parent, translate?}]` — transform tree under implicit
  `root`. `translate` is a static base offset (pivot/home position), in mm.
- `parts`: `[{id, file, group, translate?, rotate?, color?, stock?}]` —
  STL meshes attached to groups. `color` is `[r,g,b]` 0–1 (STL has no
  color channel); per-part user overrides from Settings still win. Parts
  get color pickers in Settings automatically. `stock: true` marks the
  ONE body class the collision sweep may FEED into (cutting semantics);
  `rotate` is Euler radians (prefer baking static rotations into the STL,
  as fetch-model.sh does for the DMU B head).
- `kinematics`: `[{group, joint, type: translate|rotate, direction: x|y|z
  or axis: [x,y,z], sign}]` — each entry drives one group from
  `joint_pos[joint]` (**joint index, not axis letter** — trivkins:
  identical; non-trivial kins: joint space). Rotations are degrees.
- `workGroup` / `toolGroup`: group ids that carry the toolpath/backplot/
  bounds (work) and tool marker + TCP offset (tool). On a moving-table
  machine the work rides the table (e.g. the C platter on a trunnion).

**Transform semantics — transforms COMPOSE** (`applyState` phases): driven
groups reset to their static base each frame, then DOFs accumulate in
`kinematics` list order (translations add along their unit axis, rotations
right-multiply), then the TCP tool offset subtracts from the tool group's
composed position. A group may therefore carry a static pivot translate
plus any number of DOFs (compound slides, trunnions) — never rely on
overwrite behavior. Axis unit vectors are precomputed at normalize time;
the per-frame loop is allocation-free.

**Serving & caching**: gateway mounts the model dir at `/assets/`
(absolute URL to port 8000 — bypasses the Vite proxy; identical dev/prod).
STL URLs carry `?v=<mtime>`. Client caches: L1 in-memory geometry by part
id, L2 IndexedDB parsed geometry by URL, L3 HTTP. `machine.json` itself is
mtime-cached in the gateway and hot-reloads on the next `viewer_init`
build — no restart needed; a missing/broken file raises the operator
config-warning banner (no silent fallback) and clears it on recovery.

**Conventions**: STLs are authored in mm; the viewer scales by
`_unitScale` for inch machines. Z-up. Auto-material mapping colors
LINEAR-axis groups (x/y/z); rotary groups keep the frame material — use
part `color` for rotary assemblies. The `machine` layer toggle shows/hides
the whole model.

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
line; the LIVE applied offset governs segments before the first row, which
the run inherits as modal G43 state) — resolved by ONE function
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
program has active per segment (`parse_tlos` rows carry diameter). Settings → 3D Viewer → "Path on part" (default) vs
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
(line, axis). Attribution
rule: only a line that MOVES an axis while out of bounds is flagged; lines
where the axis merely sits parked past a limit are not re-flagged, so the
culprit line stands alone. Wire: `violations` (per-line records, capped at
200) + `violations_total`; `null` means the INI had no MIN/MAX_LIMIT —
unchecked ≠ clean, and the stats dialog says "Not validated". UI is
centralized in the scrub bar's second row: warn-variant prev/next
navigation ("◀ | N limits → L10 | ▶", anchored to the CURRENT timeline
position — scrubbing re-anchors it; collision hits get the same in
danger-red) and warn timeline marks, plus warn-tinted line numbers in
GcodePanel (`.codeLine.violation`, global — collision hits reuse it) and
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

**Program scrub (offline dry run, stage 2 + unified-timeline phase 1)**: a
timeline bar overlaid on the 3D viewer (`ScrubBar.vue`, hosted in
ThreeViewer's overlay next to CameraPip) poses the articulated machine
model at any point of the loaded program without running it — drag or
play with a continuous log-scale speed slider (×0.1–×100). The timeline
axis is PROGRAM TIME (seconds; ×1 = real time; mm:ss readout): the parse
worker ships per-stream cumulative seconds (`feed_tcum`/`rapid_tcum` —
feeds from F with max(linear, rotary°) governing, rapids from
TRAJ/AXIS MAX_VELOCITY; also `rapid_rate`/`rot_rapid_rate` for the
client-built entry move) and the track merge diffs them per stream.
`timeBased: false` (no INI velocity / legacy payload) falls back to the
distance axis (1° ≙ 1 mm), honest not guessed. Tool-change events ride
the wire as `tool_change_lines` (canon M6 only — preview-skipped M600
remaps contribute none) and render as info-blue timeline marks.
**Phase 2 (run-time display)**: the bar stays visible during a REAL run
as a read-only surface — every control is dead via the existing gating,
a RUNNING chip marks the mode, the playhead follows `motion_line` on the
estimate axis (line granularity via lineCum; subroutine loops move it
backward legitimately), and the findings/tool marks become look-ahead
("next clash → L11", "T3 in 2:41" — the next-tool countdown, shown in
sim too). No motion verb lives on the timeline — cycle
start/pause/abort stay in their constant home (see
unified-timeline-design memory: unify display, not actuation).
Execution order is reconstructed by merging the
feed/rapid streams on per-point `feed_seq`/`rapid_seq` (global counter in
`gcode_canon.py` — line numbers can't order subroutine loops);
`previewWorker` builds the merged `scrubTrack` off-thread
(`viewer/scrubTrack.ts`, pure, unit-tested). The pose is derived per frame:
lerp adjacent program-space samples, program→joint-space via the same
`wcsTerms`/`programToMachine` as the part-frame preview (exported from
`viewer/partFrame.ts`), letters→joints via `viewer_init.axes`, then through
the SAME `applyState` compose path as live motion (null joint entries — UVW
— keep the live value). The transform is **RS274-exact and pinned by golden
tests** (`viewer/rs274.test.ts` — fixtures generated from LinuxCNC's own
`rs274.interpret.Translated.rotate_and_translate` by
`scripts/gen_rs274_wcs_fixtures.py`; Python twin
`TestRs274EffectiveOffset`): effective XY origin is `g5x + Rz(θ)·g92` (g92
applies BEFORE the G10 R rotation — a plain sum deviates when both are
active), and `wcs.tool` (live `stat.tool_offset`) makes the derived joints
TRUE joint-space (G43-inclusive) so `applyState` phase 3's marker shift
lands the tip on the path — pose, part-frame tip peel, and the collision
worker's tool-cylinder shift all subtract the same TLO back. `tool_offset`
is therefore a watched transform input everywhere WCS is (ScrubBar
`_wcsKey`, ThreeViewer preview refresh + sweep re-run). Scrubbing is an explicit **SIMULATION mode**
(`simMode.ts`, client-local like `busy`): the posed model is an
intentionally wrong display, so while active every machine-action gate is
closed (`permissions.ts` SIM_GATES — only `always`/`armed`/`setup` stay
open; `safety` is closed too, so Machine On requires a purposeful Exit
first). Entry requires armed (outer Gate) + machine OFF + interpreter
idle, via the bar's Simulate button (play and clash-jump also enter when
eligible); a warn `.simBanner` overlays the viewer the whole time.
Auto-exits: run start, program change, machine powered on by another
client, real joint motion (0.05-unit backstop — above servo dither).
While simulating: backplot recording is suspended (never fabricate motion
history), the toolpath highlight and GcodePanel follow the scrub line, and
touch-off re-poses immediately (WCS watcher). A stale pre-seq cached
payload yields `scrubTrack: null` — the bar simply doesn't offer itself
(unchecked ≠ broken). Text-panel line: `displayLineForPoint` is the ONE
gating rule for scrub AND run playhead — the point's own line only when
per-point trust allows (motion in called subs/remaps carries THAT file's
colliding linenos, W2 P6), else the sub span's text-verified CALL/trigger
line (W4, schema 7: `(WEBUI_SUB=name CALLER=g53.3)` markers +
unique-site scan in `attribute_sub_callers` — multiple call sites of one
sub keep the chip-only display; no positional signal exists, the interp
never fires next_line for o-call/remap trigger lines), else null + the
"(name)" chip. Above it sits `resolveCurrentLine` (W5, the display
spec in docs/decisions.md wave 5): live `motion_line` — a bare
motion-queue id with NO file identity — may display only when the
track's per-line trust set vouches for it (the off-path approach
rescue) and NEVER at idle (post-run it holds the last executed id: the
stale blank-line-8 class); the track's terminal vertex displays the
text-scanned unique M2/M30 line ("end" readout). While a marked o-call
span executes, GcodePanel renders the called file's lines INDENTED
under the call line (`subRows.ts` row model, `GET /subfile` source,
expansion only when the call line's text IS `o<name> call` — remap
wrappers and nested spans never expand).

**Run-time state freshness + the sim-parity gate (W6)**: the preview
depends on four run-time state inputs, each freshness-guarded — WCS
table (per-epoch terms), tool length (TLO-drift auto-reparse), XYZ
start (entry move), and rotary pose: the worker emits its schema-5
rotary seed as an `__ABCSEED__` stderr line and the gateway's idle
drift edge (`evaluate_rotary_drift`, 0.01°) auto-reparses when the live
pose leaves it (a run parking the table tilted made the cached preview
orient from a pose the next run never visits — the arc-vs-plunge
class). Acceptance standard: `scripts/sim_parity.py gate --corpus
scripts/parity_corpus/<config>.json` — per run it saves the RUNNING
gateway's cached payload, captures the real run (twp_parity
sample_run; truth file opens with a context header), replays the
payload through the ACTUAL client chain (`lcnc-webui/scripts/
simDump.ts` via vite-node — decodePreviewStreams/buildEntryTrack are
single pure implementations shared with the browser), and gates on
bidirectional 6D joint-space path deviation (deg ≙ mm; wall-clock never
compared; per-program tolerance absorbs G64 blending).

**Re-parse cancel-and-restart + visibility (2026-09-05)**: every drift
edge above used to be gated on "no parse running", so an edge raised
DURING a parse (a touch-off while the rotary-drift parse from → Zero
still ran — every zeroing sequence, live) was not evaluated until that
parse published and then queued a second full parse behind it: 41–167 s
to a correct preview on a 1.18 M-line program. Now `BulkPipeline.inflight`
holds the running parse's input snapshot (rotary seed, kins seed, flat
WCS offsets, file + mtime) and the poll loop evaluates the same edges
against it under the same idle gate, settle guards and 2 s debounce
(`inflight_stale_reason`, pure); a hit CANCELS the worker
(`cancel_inflight`: SIGTERM — inside `gcode.parse` the handler's
SystemExit becomes `interp_error` → exit 3 within ~100 ms, temp dir
removed; SIGKILL fallback after 2 s; `gcode.reparse_superseded` /
`gcode.parse_cancelled`) and `reparse_pending` restarts it under the
specific edge (`wcsoff:G54:x`, `rotary:A`, `kins:type`, …) — the
scheduled reason is that edge, never a bare "drift". A running parse for
the CURRENT file+mtime is never superseded by its own file edge
(`preview_file_edge_action` — `file_changed` holds until the publish;
the first acceptance run killed every load parse 33 ms after spawn).
The worker timeout is `max(60 s, 3× expected)` where expected = the last
measured publish of that path, else 1.2 ms/byte (the flat 60 s sat 14 s
above the plane-mode parse). While a parse runs the status envelope
carries `preview_refresh` {reason, file, expected_ms, started_ms,
queued, superseded}: App.vue shows a warn banner with the reason in
operator wording (`previewRefreshLabel`), a locally ticked elapsed clock
and a progress track that never reaches 100 % on its own, the viewer HUD
shows the same chip, and the drawn toolpath is MUTED
(`toolpathController.setStale`, `--opacity-disabled`) while a parse runs
or the payload's offsets / tool length are known stale. Parse speed on
the same program (identity, this VM): ~23 s → ~15 s quiet / ~23 s while
a VM-local tab decodes the previous publish — the comment-strip fast
path, the canon's WCS snapshot only on a setter call, and the vectorized
limit checks (below).

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
approach. The sweep
keeps itself current with NO manual trigger: auto-runs on program load
(base track — marks appear before sim is entered), on sim entry (entry
track, fresh position = fresh baseline), and on WCS/tool changes while
idle (stale results clear + re-run, debounced; in sim ScrubBar re-checks
with the rebuilt entry track). The only button is cancel-with-progress
while a sweep runs.

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
per-joint mid-chunk excursion via `KinsModel.jointBulge`; collision.ts
reads no family's parameter names (it used to read the trt-only
`KinsParams`, which a trsrn spec does not carry, collapsing a 2 m rotary
lever to the distance from the machine origin). Bounds are CERTIFIED per
family by `kinsBulge.test.ts` — randomized chunks, densely resampled,
requiring the sampled excursion never to exceed the declared bound for
any joint; trivkins and trsrn mode 2 are exactly 0 because their inverses
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
docs/decisions.md). Sample budget 60k remains as a
safety net (degrades to fixed explore steps, result says `coarsened`).
A sweep whose guarantee does not hold — a declared kins this client
cannot evaluate falls back to trivkins, whose bound is legitimately 0 —
reports `uncertified` with the reason, surfaced in ScrubBar on BOTH the
"clear" and the "N clashes" branches.
Attribution: worst hit per (line, pair); penetrating hits are REFINED to
first contact (walk back to the last clear parameter + bisect, ~30 pair
probes per hit) so scrub-to-hit poses the model at first touch, never a
sample-step deep. Contact within one line can be INTERMITTENT (rotary
return moves brush parts twice — user-caught): hits carry
`intervals` ([enter, exit][], every boundary bisected; in-contact
samples cluster with gaps > the in-margin stride = verified
separations); the clash tint tests interval membership and the
timeline marks/navigates every interval ONSET, so a re-entry is its own clash
stop. The clash COUNT, the marks and prev/next all read ONE list
(`viewer/clashTargets.ts`; a same-line re-entry is labelled) and contiguous
refined windows are merged (`mergeContiguousIntervals`) — count ≡ ticks ≡ stops. Near-miss hits keep their closest-approach sample.
Hits during RAPID segments are flagged `rapid` — always real. ThreeViewer owns the worker (geometry from machineAssetCache, tool
dims from live status); cancel = worker terminate + lazy recreate (a sync
sweep can't observe a cancel message). Results reflect check-time
WCS/tool and clear on program change; GcodePanel reuses
`.codeLine.violation` markers via `collisionLines`. SEMANTIC LIMIT (no
stock model): a program cutting at the work surface reports tool-vs-
platter contact — cutting and crashing are indistinguishable without
stock; the high-value signals are non-platter pairs and any rapid-flagged
hit. CUTTING SEMANTICS: only a body flagged `stock: true` is cuttable —
machine parts NEVER are (without a stock body the tool may touch nothing:
real programs cut stock sitting above the fixture, so tool contact with
any machine body is a crash by definition; the platter is workholding).
For stock bodies: FEED contact is machining and never reports; contact
whose ONSET falls in a RAPID is the gouge class and reports; a rapid
RETRACT leaving feed-begun contact is benign. Stock pairs are never
baseline-excluded (parked-on-work is normal); they seed the in-contact
state instead. The (local-only) machine-dmu160p example carries the first
stock body
(`work_piece` cube, `stock: true` — flag flows gateway → `viewer_init`
parts → collision bodies); the deferred user-placed stock-box feature
would provide one for arbitrary machines/programs. Pair scope: DERIVED from relative motion
— any two bodies whose
group-tree path crosses a kinematic DOF below their lowest common
ancestor form a pair (tool-vs-work, tool-vs-frame, and same-side pairs
like platter-vs-table across the A tilt); rigid pairs are skipped.
Baseline subtraction keeps it quiet: pairs already inside the margin at
the program's FIRST pose (slides, bearings, trunnion mounts — found
automatically, no annotations) are reported once as `staticContacts` and
excluded from per-line reporting. Test fixture:
`~/linuxcnc/nc_files/5axis_collision_test.ngc` — in-limits program whose
low rapid traverse rams the trunnion (stage 1 quiet, stage 3 flags it).

## Key Patterns

- **No hardcoded visual styles** — never invent custom font-size, padding, border-radius, colors, opacity, or font-family for new elements. Always inherit from the nearest parent class or global base styles in `style.css`. New CSS should only override layout properties (flex, width, text-align). If a visual style doesn't exist, extend the existing class hierarchy or global base — never create one-off overrides. For color semantics: machine active states use `--ok` (green), form controls (toggles, radios, checkboxes) use `--info` (blue), danger/abort uses `--danger`, warnings use `--warn`.
- **Spacing tokens** — use `--gap-micro` (2px, ultra-tight), `--gap-tight` (4px, grouped toggles), `--gap-controls` (8px, button rows/form fields), `--gap-section` (12px, between sections), `--gap-panel` (20px, major divisions) for all layout gaps. Never hardcode gap/margin values for spacing between elements. Padding inside buttons/inputs is visual and stays hardcoded. Minimum gap between any clickable elements: `--gap-tight` (4px).
- **Opacity tokens** — `--opacity-subtle` (0.3, separators), `--opacity-disabled` (0.4), `--opacity-muted` (0.6, secondary text), `--opacity-secondary` (0.8, dialog body, syntax comments). Never hardcode opacity values (exception: animation keyframes).
- **Syntax highlight tokens** — `--syntax-mcode`, `--syntax-coord`, `--syntax-param`, `--syntax-comment` in `:root`. Token classes (`.token-gcode`/`.tok-gcode`, etc.) use these. `.token-gcode` uses `var(--info)`, `.token-text` uses `var(--fg)`.
- **Shared modules** — `format.ts` (9 formatters: fmtCoord, fmtNum, fmtCell, fmtOffset, fmtRpm, fmtElapsed, fmtDuration, fmtDist, fmtSize), `toolTypes.ts` (TOOL_TYPE_LABELS + toolTypeLabel()), `gcodeHighlight.ts` (highlightGcode). Never duplicate formatters or tool type labels in components.
- **Global utility classes** — `.mono` (font-mono), `.emptyState` (centered muted text), `.statusDot` (8px indicator with `.probing`/`.tripped` states), `.sub` (section heading — no margin, parent flex gap handles spacing), `.sep` (horizontal divider). Always use these instead of scoped equivalents. For horizontal dividers, always use `<div class="sep">` — never manual `border-bottom` as section separators.
- `defaults.ts` section registry: `registerSection<T>(name, fallback, migrateFn)` + `loadSection`/`saveSection`. All sections are server-synced. Server is the single source of truth. Gateway sends `settings_init` on every WS connect. `sendBeacon` flushes pending saves on page exit. New sections must be added to `_VALID_SETTINGS_SECTIONS` in `gateway.py` and `SERVER_SECTIONS` in `main.ts`.
- localStorage is used in two intentional places only: (a) `lcncWs.ts` message history — intentionally per-tab so sessions don't cross-talk; (b) `defaults.ts:resetAllDefaults` removes pre-server-sync localStorage keys (migration cleanup — safe to delete ~2027+). Do not introduce additional localStorage usage.
- ViewPreset type is duplicated in ThreeViewer.vue and Toolbar.vue — update both when adding presets
- Camera Z-up: `camera.up.set(0, 0, 1)`, except top view uses `(0, 1, 0)` to avoid gimbal lock
- ThreeViewer uses ResizeObserver (not window resize) to handle v-show tab switching
- **Dialog tiers** — three sizes, two internal structures:
  - `.dialog` (sm, centered confirm): `padding: var(--gap-panel)`, uses `.dialogTitle` + `.dialogBody` + `.dialogActions` directly
  - `.dialog.md` (mid, structured content): `padding: 0`, uses `.dialogHeader` + `.dialogContent` + `.dialogActions`
  - `.dialog.lg` (large panels, 70vw×70vh): `padding: 0`, uses `.dialogHeader` + `.dialogContent` (+ custom footer if needed)
  - `.dialog.lg.dialog-full` = 90% height variant
  - All tiers inherit `font-size: var(--fs-base)` from `.dialog` base — never set font-size on dialog body content
  - Safety dialogs add `.safetyDialog` (z-index 1010) and omit `@click.self` on overlay
- Gateway `tool_change` handler is fire-and-forget (no `CMD.wait_complete()` — blocks heartbeat loop)
- Toolsetter settings live in SettingsPanel (Machine sub-tab); tool ACTIONS live in App.vue (tool-change dialog, Measure/Unload) and ToolTablePanel, not in the read-only ToolStrip
- **Tool geometry**: Per-tool STL files in `machine/tools/`, loaded via `STLLoader`. Fallback: simple cylinder from diameter + length. Vertex colors split cutter (gold) / shaft (silver) by `flute_length` / `shoulder_length` Z thresholds. STL origin convention: tool tip at (0,0,0), extends in +Z.
- **No `:deep()` visual overrides** — scoped CSS may use `:deep()` for layout properties (flex, width, height, padding) but NEVER for visual properties (background, color, border, box-shadow). Visual overrides bypass Btn.vue's state system. If a button state looks wrong, fix it in Btn.vue.
- **Gate.vue** — renders `<fieldset :disabled="!allow">` with `.fs-reset` styling (chrome-only: no border/padding/margin). Browser-enforced default-deny: disabled propagates to all descendants. The outer Gate (`gate="armed"`) wraps the entire main area. `#exempt` slot reserved for safety section only (Arm, E-Stop). All buttons use MachineBtn catalog types; `<Btn>` is never used directly in templates.

## Pre-Flight Checklist — MANDATORY for every CSS/UI edit

Before writing or modifying ANY CSS or interactive element, verify ALL items:

**Spacing** — `gap`/`row-gap`/`column-gap`/`margin` between siblings MUST use tokens: `--gap-micro` (2px), `--gap-tight` (4px), `--gap-controls` (8px), `--gap-section` (12px), `--gap-panel` (20px). Never hardcode. No double-layer spacing (parent flex gap + child margin-bottom on `.sub` headings, etc.). Grid cell gaps use `--gap-controls` or `--gap-tight` — never `--gap-section` for internal grid spacing.

**Layout** — Use `stack-*` / `row-*` utility classes from `style.css` for flex layout. Never write `display: flex; flex-direction: column; gap: var(--gap-*)` directly in component CSS. Component-scoped CSS should only add non-layout properties (height, overflow, position, flex, min-height). Classes: `stack-panel` (20px), `stack-sections` (12px), `stack-controls` (8px), `stack-tight` (4px), `stack-micro` (2px), `row-controls` (8px), `row-tight` (4px).

**Opacity** — Use tokens: `--opacity-subtle` (0.3), `--opacity-disabled` (0.4), `--opacity-muted` (0.6), `--opacity-secondary` (0.8). Never hardcode opacity values except in animation keyframes.

**Typography** — `font-size` → `--fs-*` tokens. `border-radius` → `--radius-*` tokens. `font-family` → `var(--font-mono)` or `var(--font-sans)`. Never hardcode any of these.

**Colors** — Use semantic CSS variables (`--ok`, `--danger`, `--warn`, `--accent`, `--fg`, `--bg`, etc.) with `color-mix()`. Never raw hex. Hover tiers: `--hl-hover` (12%), `--hl-selected` (15%), `--hl-active` (20%) — no other percentages.

**Permission gates** — Use `MachineBtn`/`MachineInput`/etc. catalog components for all interactive elements — they self-gate from the catalog. Wrap sections in `<Gate :allow="can.X">` for fieldset-level gating. Never use `<Btn>` directly in templates. Individual `:disabled="!can.X"` is only correct for elements with tighter permissions than the parent Gate. Never use `:class="{ inactive: !can.X }"` for permission gating.

**Global patterns** — Form elements inherit from `style.css` base (component CSS only adds layout). Tables → `.dataTable`. Dialogs → `.dialogOverlay` + `.dialog` + `.dialog-full`. Close buttons → `<MachineBtn type="close">`. Empty states → `.emptyState`. Status dots → `.statusDot`. Section headings → `.sub`. Horizontal dividers → `<div class="sep">`. Monospace → `.mono`. Scrollable containers → add `.scroll-thin`. Check existing components before creating new CSS.

**New patterns** — If the needed style doesn't exist globally, STOP and tell the user: "This pattern doesn't exist in our global styles. We should add it to style.css first." Never create one-off scoped styles for reusable patterns.

**Enforcement** — A `PreToolUse` hook (`.claude/hooks/style-check.sh`) fires before every Edit/Write to `.vue`/`.css` files, injecting a reminder. This ensures mid-conversation adherence.

## Toolsetter Var-File Mapping (#3100–#3115)

The `tool_touch_off.ngc` subroutine reads parameters from the LinuxCNC var file so the web UI can configure them:

| Var    | Parameter              | Description                           |
|--------|------------------------|---------------------------------------|
| #3100  | tool_touch_x_coords    | Toolsetter X position (G53)           |
| #3101  | tool_touch_y_coords    | Toolsetter Y position (G53)           |
| #3102  | tool_touch_z_coords    | Toolsetter Z approach height (G53)    |
| #3103  | use_tool_table         | 1 = use tool table for positioning    |
| #3104  | tool_min_dis           | Min distance for known tool re-probe  |
| #3105  | brake_after_M600       | 0=none, 1=M00, 2=M01                 |
| #3106  | go_back_to_start_pos   | 1 = return to start after measurement |
| #3107  | spindle_stop_m         | M-code to stop spindle (5 or 500)     |
| #3108  | disable_pre_pos        | Disable G30 pre-change positioning    |
| #3109  | addreps                | Extra retry count on probe fail       |
| #3110  | lasttry                | 1 = last retry without tool table     |
| #3111  | offset_diameter        | Tool diameter threshold for offset    |
| #3112  | offset_value           | Offset percentage of tool diameter    |
| #3113  | finder_touch_x_coords  | Edge-finder X reference (G53)         |
| #3114  | finder_touch_y_coords  | Edge-finder Y reference (G53)         |
| #3115  | finder_diff_z          | Height diff probe vs reference        |
| #3116  | rfl_skip_tool          | One-shot RFL guard: tool just measured via MDI — skip its in-program re-measurement once (set by gateway, self-cleared by routine) |
| #3014  | finder_number          | Probe tool number (shared with probe tab) |

## Build Verification

**ALWAYS run `npm run build` (in `lcnc-webui/`) after any TypeScript/Vue change.** This uses `vue-tsc -b` which is stricter than `vue-tsc --noEmit` — it catches unused imports (TS6133) and declaration emit issues that `--noEmit` misses. Zero TS errors is a hard requirement. Never use `vue-tsc --noEmit` as the sole verification step. `-b` builds THREE projects: `tsconfig.app.json` (DOM, `src/**` minus the node-side tests), `tsconfig.node.json` (the vite/vitest/playwright configs) and `tsconfig.test.json` (the node-side tests, `scripts/simDump.ts`, `e2e/**`) — a test that imports `node:fs` goes in the app exclude AND the test include; `src/tsconfigCoverage.test.ts` enforces both lists and refuses stale entries.

## Lessons Learned

- Normalize camera direction vectors before scaling by distance — non-unit vectors (iso, dimetric) cause distance drift on repeated clicks
- ThreeViewer in hidden v-show tabs: guard `if (w === 0 || h === 0) return` in resize() or canvas gets 0x0
- Don't use CSS grid overlay (visibility:hidden) for tab panes with ThreeViewer — ResizeObserver feedback loops
- `CMD.wait_complete()` in a gateway handler blocks that client's command worker (commands are serialized per client), never the reader — heartbeats keep flowing since 2026-09-03. Keep waits bounded anyway: the worker is FIFO, so a 30 s wait delays that client's next command (incl. abort) by up to 30 s.
- Scoped CSS styles (e.g. `button.primary` in App.vue) don't apply in child components — put shared button styles in global `style.css`
- HAL access is now in a sibling process (`hal_reader.py`) — the gateway never imports `hal`. Benchmarks (`hal.get_value` ~2 µs; `hal.get_info_pins()` ~1 ms typical with ~276 ms tails under load) remain accurate but the gateway no longer pays the cost on its hot path. See GitHub issue #9 and `hal-cost-benchmarks.md` for history. Custom mirror components (direct pointer reads, <1 µs) are theoretically faster but introduce orphan-cleanup complexity and silent-fallback risk; do not re-introduce without measured perf pressure.
- Never use `:deep()` to override visual CSS properties (background, color, border) in scoped styles — it bypasses Btn.vue's design system. Layout overrides (flex, width, padding) are acceptable.
- Always use `with open()` for file I/O in Python — bare `open()` in loops leaks handles until GC
- `.get()` is a dict method — calling it on a list silently raises AttributeError. Use `[index]` for list access.
- Read the actual CSS before speculating about visual bugs — the override might be setting the value to match the background, not just being "too subtle"
- Use direct child selectors (`.grid > label`) not descendant selectors (`.grid label`) when styling grid/container labels — descendant selectors mute nested form controls (radios, checkboxes) inside those containers
- When adding server-synced settings sections, update `_VALID_SETTINGS_SECTIONS` in `gateway.py` — the gateway rejects unknown sections with "Unknown settings section" error
- Don't hack around permission issues in the backend — use the proper frontend permission gate so the UI reflects machine state (dimming). The gate IS the fix, not a workaround.
- Any component that emits MDI commands (e.g. `setProbeVars`) must gate those emissions behind `can.ready` — MDI requires homed. Settings persistence (`saveDefaults`) is separate and always works.
- Fusion 360 tool library geometry params (`TA`, `LCF`, `LB`, `shoulder-length`) are ambiguous per tool type with no official docs — same key means different things for different tool types. STL import eliminates the interpretation guesswork.
- Settings `saveSection()` must block BEFORE cache write when server isn't ready — otherwise fallback zeros poison the cache and eventually overwrite the server
- Every component reading settings at setup time needs a `settingsVersion` watcher to re-read when WS delivers server data — stale snapshots cause settings to appear lost on refresh
- ThreeViewer `buildFromInit` creates scene objects as visible after `onMounted` already applied layer defaults — must re-apply at end of `buildFromInit` using fresh `loadViewerDefaults()`
- Never re-derive RS274/interp semantics from docs or memory — mirror the interpreter's own source and pin it with differential golden tests (`rs274.test.ts` + `TestRs274EffectiveOffset`, oracle = `rs274.interpret.Translated.rotate_and_translate`). Two latent bugs came from re-derivation: combined `g5x+g92` origin (wrong under G92+G10 R together) and TLO missing from the scrub joint transform (sim pose off in Z by exactly the G43 offset while `applyState` phase 3 subtracted it anyway)
- Mode overrides must swap COMPLETE state objects, not single fields: `_scrubJoints` substituting joints inside `applyState` while `tool_offset`/WCS stayed live is how the TLO pose bug hid — every phase of a shared code path must be audited when one input is overridden per-mode
- Surface-map Z compensation (`axis.z.eoffset`) is a **3-axis feature**: a machine-Z shim applied after kinematics, valid only with the tool normal to the mapped surface (A=0) and the map's XY grid aligned to the work (C=0 — the map does not ride the platter). Probing or applying it tilted is directionally wrong; enforcement gate deferred (recorded in dry-run memory)
- A per-line `Map`/`Set` on a million-line program is a million heap objects the browser's collector marks on EVERY major GC (110–140 ms measured) and a ~1 s structured clone per worker hop — the "sometimes lags when rotating" class. Line-indexed typed arrays (`viewer/lineIndex.ts`) are the shape for anything keyed by line number
- A background re-parse that cannot be cancelled QUEUES: an edge raised during it was not even evaluated until it published, then ran a second full parse (41–167 s live). Snapshot the running parse's inputs and supersede it; and an edge that stays true until the publish (`file_changed`) must never be allowed to cancel the parse that will clear it
- Profile before vectorizing: 40 % of the 46 s plane-mode parse was 2.36 M pure-Python inverse-kinematics solves, another ~40 % three passes that re-stripped comments character by character; the interpreter itself was a quarter. cProfile inflates Python-call-heavy code ~2× — use it for proportions, the trace for absolute numbers

## Production DISPLAY Integration

The `lcnc-suite` launcher script lets LinuxCNC start the gateway as its native display:

```
linuxcnc my_machine.ini    # single command — starts everything
```

**Setup:**
```bash
# 1. Build the frontend (once, and after any frontend changes)
cd lcnc-webui && npm run build

# 2. Symlink launcher to PATH so LinuxCNC can find it
#    (LinuxCNC does not expand ~ in DISPLAY paths — must be on PATH)
mkdir -p ~/.local/bin
ln -sf "$(pwd)/../lcnc-suite" ~/.local/bin/lcnc-suite

# 3. Verify
which lcnc-suite    # should print ~/.local/bin/lcnc-suite

# 4. Set DISPLAY in your machine INI [DISPLAY] section:
#    DISPLAY = lcnc-suite
```

**How it works:**
1. LinuxCNC launches `lcnc-suite -ini /path/to.ini` as a subprocess
2. Launcher sources NVM (for correct Node version), activates Python venv
3. Reads `WEBUI_*` config from INI `[DISPLAY]` section via `inivar`
4. Production (`WEBUI_DEV=0`): exports `LCNC_WEBUI_DIST_DIR`, `exec`s uvicorn serving API + built frontend
5. Dev (`WEBUI_DEV=1`): starts Vite on :5173 (hot-reload) + gateway on :8000, cleans up both on exit
   Before either: runs every `[HAL]POSTGUI_HALFILE` with `halcmd -i <ini> -f`, the way axis/gmoccapy
   do — after `halcmd start`, and after WAITING for milltask's `inihal` component to be ready (the
   linuxcnc script spawns milltask in the background and this launcher is up in milliseconds, so
   `ini.*` pins may not exist yet). A failing file aborts the display loudly.
6. LinuxCNC blocks on the display process; SIGTERM triggers clean HAL shutdown

**INI configuration** (`[DISPLAY]` section):

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBUI_HOST` | `0.0.0.0` | `127.0.0.1` for local, `0.0.0.0` for LAN |
| `WEBUI_PORT` | `8000` | HTTP/WebSocket port |
| `WEBUI_BROWSER` | `1` | Auto-open browser on start |
| `WEBUI_DEV` | `0` | `1` = Vite dev server on :5173 (hot-reload) |
| `WEBUI_TOKEN` | *(none)* | Pre-shared auth token (issue #17). **Required** when `WEBUI_HOST` is non-loopback — the launcher aborts loudly if bound to a network interface without one. Required to connect the WS and to use REST mutation routes. Empty = auth disabled (loopback/dev only). |
| `WEBUI_ALLOWED_ORIGINS` | *(same-host)* | Comma/space-separated WS/CORS Origin allow-list. Unset = allow only same-host origins (works for any LAN IP). Browser drive-by from other origins is rejected regardless. |
| `LOG_DIR` | `<install-dir>/runlogs` | Optional suite log dir (all four processes). Unset = next to launcher; unwritable = loud launcher abort, no `/tmp` fallback |
| `CAMERA_SOURCE` | *(disabled)* | USB device index (`0`, `1`) or URL (`rtsp://host/live`, `http://host/mjpeg`) |
| `CAMERA_RESOLUTION` | `1280x720` | Capture resolution `WxH` (USB cameras only) |
| `CAMERA_FPS` | `15` | MJPEG stream frame rate |
| `WEBUI_MACHINE_DIR` | *(gateway default)* | Machine viewer-model dir (`machine.json` + STLs) for the 3D machine model. Unset = `lcnc-gateway/machine/`. See "3D Machine Model". |

Environment variables `LCNC_WEBUI_HOST`, `LCNC_WEBUI_PORT`, `LCNC_WEBUI_BROWSER`, `LCNC_WEBUI_DEV`, `LCNC_WEBUI_TOKEN`, `LCNC_WEBUI_ALLOWED_ORIGINS` override INI values. `LCNC_LOG_DIR` overrides `LOG_DIR`. Camera variables: `LCNC_CAMERA_SOURCE`, `LCNC_CAMERA_RESOLUTION`, `LCNC_CAMERA_FPS`.

**Auth (issue #17):** the gateway is a machine-control surface, so when bound to a network interface it requires `WEBUI_TOKEN`. The token is injected into the served `index.html` (`window.__LCNC_TOKEN__`), so browsers the gateway serves get it automatically; the WS carries it as `?token=` and REST mutations as the `X-Auth-Token` header (`sendBeacon` settings flush uses `?token=`). This blocks cross-origin WS hijack and unauthenticated REST mutation on a trusted LAN; it is **not** a defense against an attacker already running code on that LAN.

**Development mode:** Set `WEBUI_DEV = 1` — launcher starts Vite on :5173 (hot-reload) alongside the gateway on :8000. Browser opens to :5173 where Vite proxies API/WS to the gateway.

For headless/no-UI: `DISPLAY = dummy` (zero overhead, gateway connects separately).

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

The bundled routines retract with `G53 G0 Z0` and assume **machine Z0 is the top of travel** (LinuxCNC's convention: `[AXIS_Z] MAX_LIMIT` at or just above 0 — true on every shipped config; the XYZAC example carried Z 100..500 until 2026-09-27 and was moved to −400..0 with the A/C intersection at machine Z −500, `xyzac-trt-kins.z-rot-point`). The suite's own retracts (→ Zero / → Home / → G30, run-from-line safe-Z) additionally never LOWER Z (`#<_abs_z>` guard); the upstream toolsetter/probe files keep the bare idiom, so a config whose Z0 is not the top must not run them (recorded 2026-09-05).

## Where the details live

This guide holds the architecture and the rules. Since 2026-10-25 the long entries — each rule with its reason, the measurements and the review round that set it — live in `docs/architecture/` (moved verbatim; a "CLAUDE.md section" named in `docs/decisions.md` or a review is there now):

- [frontend-modules.md](docs/architecture/frontend-modules.md) — every frontend module in full
- [ui-patterns.md](docs/architecture/ui-patterns.md) — the Key Patterns in full
- [safety-and-permissions.md](docs/architecture/safety-and-permissions.md) — session binding, touch-off under kinematics modes, motion-button certification
- [machine-model.md](docs/architecture/machine-model.md), [preview.md](docs/architecture/preview.md), [scrub-and-run.md](docs/architecture/scrub-and-run.md), [collision.md](docs/architecture/collision.md) — the 3D model, the preview, the simulation and the collision check

When a change alters a rule, update the short form here AND the full entry there. Decisions and their reasons go in `docs/decisions.md`; test entry points in `docs/testing.md`.

## Frontend Structure (lcnc-webui/src/)

One line per module: what it is and the rule that matters when you touch it. The full entries — every rule with its reason and review round — are in [docs/architecture/frontend-modules.md](docs/architecture/frontend-modules.md); read the module's entry there before changing it.

- `App.vue` — root: sidebar + multi-panel tab layout, state management, the App-level tool actions (tool-change dialog, Measure/Unload), the banner.
- `ChoiceGroup.vue` + `MachineChoice.vue` (+ `choiceGroup.ts`) — the strip's choice groups: `role="radio"` buttons, ONE Tab stop, every navigation key default-prevented (modifiers too — else an arrow sends a machine command or jogs). `activation="manual"` = a machine command: the chosen option is `pending` until the status shows it (5 s → "Not confirmed"), its own refusal ends it; `activation="auto"` = a local setting. Checked = a tint AND a 3 px bar.
- `stickyHead.ts` — `v-sticky-head`: the head's height from its ResizeObserver only (never read at mount), `scroll-padding-top` so a Tab-focused row lands below the head.
- `TabPanel.vue` / `TabNav.vue` — the ONE tab navigation: one Tab stop, manual activation, all six navigation keys default-prevented WITH modifiers. Selection is a shape, focus the ring. Narrow side pane (< `NARROW_PANE_PX` 498 px → `.sidePane.narrow`, the ONE narrow flag): selects instead of the list. A tab switch stops a running jog (`stopJogOnNavigation`).
- `ThreeViewer.vue` — the Three.js viewer (Z-up, OrbitControls, ResizeObserver); owns the preview, the part-frame bake, the collision worker and the contact publisher (see "3D Machine Model, Preview and Simulation").
- `ViewCube.vue` + `viewer/cubeFaces.ts` — the ONE orientation display: faces named by axis (X+ … Z−), tinted; straight views show the in-plane axes as arrows on the border; letters stay whole in the canvas (`keepInCanvas`); presets `setView("z+" | … | "iso" | "dimetric" | "reset")`.
- `GcodePanel.vue` — G-code viewer/editor, program controls, run-from-line. Holds are bound to the published REVISION (`programRevision` / `programTextRevision`); a line selection belongs to its program and text; the followed line GLIDES (`codeGlide.ts`) and never leaves the view; options and management behind More; narrow and portrait-edit forms.
- `GcodeReferenceDialog.vue` + `gcodeRefView.ts` — the searchable G/M-code reference: plain, at a code word (`openGcodeRef({ at })`), or "Active now"; cards below 520 px.
- `MessagesDialog.vue` + `messageView.ts` — the message center (the PROTOCOL): one filter for type and origin, sortable, Copy Shown, the count in the title, cards below 520 px; every message keeps its origin (linuxcnc / webui).
- `ProbePanel.vue` — the probe grid (`O<probe_*> CALL`, `probeViews.ts` 4 × 2).
- `ToolTablePanel.vue` — the tool table, read through `request()` with its own reply (slow note at 8 s, end at 60 s; "Tool table not read." is never "No tools"); ONE discard check for X and Cancel; a running import keeps its dialog.
- `ToolPreview.vue`, `toolGeometry.ts`, `toolTypes.ts` — the tool side view, geometry utilities, the ONE `TOOL_TYPE_LABELS`.
- `format.ts` — the shared formatters and `NO_VALUE` ("—"); words, units and state words per `docs/ui-glossary.md`.
- `wcs.ts` — ONE source for fixture names (`G5X_LABELS`, `g5xLabel`, `RESERVED_WCS`).
- `mathEval.ts` — the keypad's safe expressions and `validateEntry`, the ONE admissibility check (refused, never clamped).
- `useNumberKeypad.ts` + `inputSession.ts` + `TextKeypadStrip.vue` + `textKeyboardPages.ts` — ONE on-screen input helper at a time, owned by one target: opening is a deliberate tap, never focus; leaving hides without confirming and the owner keeps its draft; keys act on click; the focus return after OK/Cancel is GUARDED (`focusReturn.pending` — an unfocused document is where Space is Cycle Start); X keeps the entry, Discard throws it away, the confirm key reads "Apply".
- `btnHint.ts` + `FloatingOverlays.vue` — the ONE transient control hint and the ONE keyboard glyph; placed from the rendered size, closed by the next press, key or scroll. Never a Teleport inside `MachineBtn` / `MachineInput` (a second root drops the parent's scoped CSS).
- `gateExplain.ts` — the ONE explanation path for a dimmed control: AT the control, never the status line or the message log.
- `FormField.vue` + `probeFields.ts` — the ONE labelled field (label above, wired `for`/`id`, the "?" a sibling of the label, unit and error as `aria-describedby`); probe and toolsetter fields as data.
- `DetailsPopover.vue` — a labelled detail card behind one button (Connection details, the Sim tab's Check basis).
- `HelpIcon.vue` + `helpPlacement.ts` — the ONE help pattern: a `span role="button"` with a native popover, text ≤ 120 chars, its own gap, placed from its laid-out size in the frame after `beforetoggle`; works in a disabled Gate.
- `MoreMenu.vue` — the ONE "More" disclosure at the right end of an action row: native popover shown only once placed, arrows default-prevented, a button item moves focus to the trigger in the CLICK CAPTURE phase, the trigger keeps one width.
- `modalRegistry.ts` + `DialogFrame.vue` — every dialog is a `DialogFrame` (Teleport, `role="dialog"`, tiers, kinds with ONE close policy, initial focus, guarded focus return). The registry is the dialog stack and focus scope (machine flows above everything; Tab stays in the top dialog, its helper, the strip and the banner). No native `<dialog>`, no `inert` (Escape is E-Stop). `dialogs.spec` scans every dialog.
- `gcodeHighlight.ts` — the G-code tokenizer/highlighter (code panel and MDI history).
- `OffsetPanel.vue` + `offsetRows.ts` — the WCS offset table: an editable value is a button, locked it is text in the button's place; G52/G92 and G43 read from their canonical slot; Clear is hold-to-fire.
- `CameraPip.vue` — the camera picture-in-picture (`.overlay-card`).
- `ScrubBar.vue` — the program-scrub timeline: ONE row, fixed slots; owns the collision results and the finding navigation and feeds the Sim tab.
- `SimPanel.vue` + `simPanelStore.ts` + `viewer/simRows.ts` + `viewer/simWindow.ts` — the Sim side tab: speed, the check's progress and its Check basis card, ONE always-present summary line (result · coverage · caveat, its form measured), ONE windowed list of the timeline's marks (≤ 400 rows, rendered in portions, follows the position), filter and ‹ ›; the panel owns its focus.
- `SettingsPanel.vue` — sub-tabbed settings; ONE guarded close path; the save status per section; 3D Viewer sections one below the other.
- `MacrosPanel.vue` + `CodeEditor.vue` + `MacroBar.vue` — the Macros tab (a table like Tools; the editor dialog bound to the file's revision; rename in one step), the ONE CodeMirror host, the macro bar (landscape over the strip, portrait under the viewer).
- `Gate.vue`, `permissions.ts`, `machineControls.ts` — the fieldset gate, the permission evaluation (+ owner permissions without the busy latch), the controls catalog (see "Permission System").
- `MachineBtn.vue` (wraps `Btn.vue`), `MachineInput.vue`, `MachineToggle.vue`, `MachineSlider.vue`, `MachineSelect.vue`, `MachineRadio.vue`, `MachineColor.vue` — the catalog components, single-root. A close button carries a contextual `aria-label`; a hold reports every cancelled hold at the control; a radio's `name` is its group (a literal only in one component); `MachineInput` owns both input helpers, has ONE writer of its value and the field contract (`autocomplete="off"` …; no "code" in a text placeholder).
- `lcncWs.ts` (+ `wsWorker.ts`, `ws/wsTransport.ts`) — the WebSocket client in a worker; reconnect only through `GET /ready`; `request()` / `awaitReply()` match the `req_id` and resolve `null` on a timeout (never a guessed success); a command that depends on another's outcome is ONE gateway command.
- `lcncApi.ts` + `browseFailure.ts` — REST helpers; a 400 is permanent (no Retry); listings only inside the program folder.
- `lcnc.ts` — LinuxCNC constants and the `WsCommand` union.
- `defaults.ts` + `settingsSaveStatus.ts` — server-synced settings sections; a save is never silent: a ledger per section and revision, a page-hide beacon unconfirmed until the server's next full blob carries it.
- `useKeyboardShortcuts.ts` — the global shortcut map: Escape is the reserved E-Stop key (a capture listener, not re-bindable; Reset is button-only); behind a dialog nothing but E-Stop passes; a jog keyup is never filtered.
- `main.ts`, `style.css` — the entry with the settings migration; global styles and tokens.
- The strip: `SafetyStrip.vue` (buttons named for the NEXT action; the active codes one button), `JogStrip.vue` (rotary axes half a column in landscape; the step a direct choice; the block owns its focus), `SetupStrip.vue` (axis actions as symbols, named for the action; the WCS selector), `OverridesStrip.vue`, `SpindleStrip.vue`, `ToolStrip.vue` (read-only; says whether the spindle tool's own offset is in effect).
- `ToolsetterSettings.vue` + `g30Form.ts` — the toolsetter form and the G30 draft; a reply applies only to what its request was sent under.
- `useAxes.ts` — the ONE axis set (from `viewer_init.axes`); never hardcode axis letters or positions.
- Others: `GamepadLiveInput.vue`, `DebugTab.vue`, `gcodeReference.ts`, `interpolation.ts`, `toolsetterVars.ts`, `dragScroll.ts`, `edgeWorker.ts`, `touchDetect.ts` (touch flag; no context menu on a long press), `useGamepad.ts`, `useJogPointers.ts`, `ws/bulkData.ts` (wire types).
- `viewer/` — `programZero.ts` (program-zero markers through the machine chain), `kins.ts` (the ONE kinematics boundary — never inline letter mapping), `machineAssetCache.ts` / `geometryCache.ts` (STL caches), `disposal.ts`, `viewerContext.ts`, `labelFont.ts` (every troika label sets the bundled font), `lineIndex.ts` (typed arrays — no per-line Maps), the toolpath / backplot / surface controllers, `partFrameWorker.ts`; the simulation modules are under "3D Machine Model, Preview and Simulation".

### Main Tabs

`Program | MDI | Probing | Offsets | Tools | Macros | Sim` — a `TabNav` (main): seven equal columns while the side pane has ≥ `NARROW_PANE_PX` (498 px, `sidePaneNarrow.ts`, measured by a width scan of the real tab list — first unclipped width 497; the seventh tab is "Sim" like the bar's switch: "Simulation" needed 574 px, past the 522 px pane) of content width; below, one select ("Side panel") and, in Probing, the procedure select beside it. Probing's procedures: a 4 × 2 `TabNav` grid (`probeViews.ts`: Outside · Inside · Angle · Boss/Pocket / Ridge/Valley · Surface · Calibrate · Toolsetter).

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

**Session binding** (`session_bind.py`, 2026-09-13): the gateway binds to ONE LinuxCNC instance (`(linuxcncsvr pid, start ticks)`) on its first NML connect, never re-binds, and exits when that instance ends (PDEATHSIG against the launcher). The helpers admit a gateway only by a `hello` naming that instance (`SO_PEERCRED`, fail closed); a rejected connect never touches pins. `WEBUI_ALLOW_REBIND=1` is for dev harnesses only. HAL lives in sibling processes because an in-process mirror once left stale pin values readable after a SIGKILL (issue #9) — the driving rule is [feedback_no_silent_fallbacks.md](.claude/projects/-home-cnc-lcnc-suite/memory/feedback_no_silent_fallbacks.md). Details: [docs/architecture/safety-and-permissions.md](docs/architecture/safety-and-permissions.md).

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
| `loaded_program.json` | gateway (`status_runtime.program_tick`) | The loaded program per LinuxCNC instance — a restarted gateway's only proof of it (R16 XZ-08). State, not a log; one small JSON, rewritten on change. |

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
  g30Capture ─────────── machineFrame + the machine STANDS (STAT.inpos, |current_vel| ≤ 0.001; unknown refuses)   G30 Use Current Position
  goZero ─────────────── ready + a → Zero plan for the mode (Machine: subroutine — Z to machine zero only when below it, rotaries to the fixture's STAMP angle before X/Y; Plane: retract along the tool axis, X0 Y0 in the plane; TCP refuses). A retract NEVER lowers Z (`#<_abs_z>` guard in go_to_zero/home/g30.ngc + the RFL safe-Z step)
  probe ──────────────── base + isIdle + !busy + isHomed + !eoffset   Probe ops, tool change, WCS edit, macros (run_macro; a `FRAME machine` macro also machineFrame)
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

**Touch-off under kinematics modes:** a touch-off is the gateway command `touchoff {axes}` (`command_policy.touchoff_route`), never a client-built `G10 L20`: identity → G54–G58 (rotary letters G54 only); TCP → G54–G58 with the table at A=0; Plane (kins 2) → G59 with the plane active, written through the plane into G54 by the remap (`M535`), the gateway seeding its G54 row only after the helper's `twp-datum-seq` advanced. G59–G59.3 are the TWP remap's scratch rows, never a touch-off target. The viewer draws ONE work-system marker, the active fixture, where the part's zero physically is (`viewer/programZero.ts`). **Motion buttons:** `scripts/twp_buttons_check.py` is the acceptance gate for any change touching a motion button. A `jog_stop` for an axis the gateway did not start is a traced no-op; `set_mode` verifies the switch and names only what it sees; a retract NEVER lowers Z (`#<_abs_z>` guard). Details: [docs/architecture/safety-and-permissions.md](docs/architecture/safety-and-permissions.md).

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
- Macro bar (`MacroBar.vue`): optional ROW of macro FILE buttons (the `bar` setting), a DENSE area like the strip and tables (`--control-h` = the compact 28 / 36 px; its `macro` buttons are md) — the macros scroll sideways in `.macroScroll` (both edges fade), its own Abort sits at the right end OUTSIDE the scroller and never scrolls away (operator 2026-10-02). App mounts it in ONE of two places by orientation (package 5 stage A, operator 2026-10-02): landscape under the content, over the strip; portrait in the viewer's column (`.viewerColumn` = viewer + bar, ONE flex item with the viewer floor) between the 3D viewer and the side pane — the side pane and the content keep exactly their place with or without macros, the viewer gives the row (it used to be a ~155 px vertical middle column). An orientation change mounts a NEW bar: a hold in progress ends with its button (nothing runs), App puts a focused macro's focus back on the same macro (`data-macro-id`) and re-points an open parameter dialog's opener to the new button (`modalRegistry.repointOpeners`); the scroll fades re-attach. `layout.spec` (portrait 100/150 %: one row under the viewer, full column width, side pane unmoved, every button whole and reachable; the strip-state frame now measures the side pane too) and `run-hold.spec` (mid-hold orientation change) pin it.
- Each content panel independently selects tabs via TabPanel component
- Shared state: coordMode, jogVel, mdiText, armed, busy
- Responsive: landscape (side-by-side panels) and portrait (stacked panels; the page grid is two columns, strip | content). Portrait viewer floor `--viewer-min-h-portrait: min(500px, 45%)` of the content column, held by `.viewerColumn` (viewer + the macro bar) (a fixed 500 px left the side pane 126 px at 150 % on 900 × 1200 — the MDI line fell below the fold); a percentage, not `vh`: Chromium does not scale viewport units under CSS `zoom` (the tests' 150 % emulation)

## 3D Machine Model, Preview and Simulation

The simulation is feature-complete (operator 2026-10-25: feature freeze — nothing new until real use asks for it; the open items and why they wait are in `docs/decisions.md`, 2026-10-25). The full description — every rule with its reason and review round — is in four files; read the part you touch before changing it:

| File | Covers |
|---|---|
| [docs/architecture/machine-model.md](docs/architecture/machine-model.md) | the example catalog, the shipped models (XYZAC v2, TWP gantry, the LOCAL-ONLY DMU), the `machine.json` schema, transform composition, serving and caching, conventions |
| [docs/architecture/preview.md](docs/architecture/preview.md) | the rotary-aware path on the part, per-line soft-limit validation, loud preview refusals, sectioned streams, machine bounds, the reach envelope, chunked draw / LOD / room-fixed prefix |
| [docs/architecture/scrub-and-run.md](docs/architecture/scrub-and-run.md) | program scrub and simulation mode, the run-time display, freshness and the sim-parity gate, the mid-run tool-table re-parse, the check during a run, M600 in the preview, the start tool state, re-parse cancel-and-restart, the start-dependent beginning |
| [docs/architecture/collision.md](docs/architecture/collision.md) | the entry move and the automatic check, the range sweep, the collision sweep, the contact store, the union after a fallback, the view built in steps and its publisher |

**Examples.** The catalog is `examples/sim_config/profiles.json`: 3 Axis XYZ, 5 Axis XYZAC (identity/TCP), 6 Axis TWP XYZABC (45° wall gantry). Install with `scripts/install_examples.py` (`install.sh` builds the TWP component); `examples/sim_config/README.md` and `docs/testing.md` hold the paths and acceptance commands. Old trunnion/55° models are regression fixtures under `scripts/test_fixtures/legacy_sim/`. The DMU 160 P model (`machine-dmu160p/`) is **LOCAL-ONLY — UNTRACKED, never commit it** (its STL source declares no licence). Z0 is the top of travel on every config.

**`machine.json`.** `groups` (a transform tree under `root`), `parts` (STL meshes; `color` from the grey ladder `viewer/palette.ts`; `stock: true` = the one cuttable class; `collision` = a coarser superset proxy; `collide: false` = decor the sweep never sees), `kinematics` (each entry drives a group from `joint_pos[joint]` — a JOINT index, not an axis letter), `workGroup` / `toolGroup`. Transforms COMPOSE in `kinematics` order; the tool offset subtracts in the tool node's world rotation, live = the physical tool (the spindle tool's signed table Z). Served at `/assets/` with `?v=<mtime>`; `machine.json` hot-reloads, a broken one raises the config banner. Models are authored in mm, Z-up.

**Invariants** (each one paid for by a defect; the reasons are in the files above):
- Joint indices ↔ axis letters only through `viewer_init.axes` (on XYZAC, C is joint 4 but canonical axis 5); every offline joint derivation goes through `viewer/kins.ts`.
- RS274 and interpreter semantics MIRROR LinuxCNC's own source and are pinned by golden tests (`rs274.test.ts`, the Python twins) — never re-derived from docs.
- The tool-length offset is PER-SEGMENT state (`tlo_events`; `tloForIndex` + `liftToJoints`), subtracted in the tool node's world rotation; a mode override swaps COMPLETE state objects, never single fields.
- "Outside limits" has ONE source: the gateway's per-vertex flags (`feed_outside` / `rapid_outside`); the client only carries them. No flags = no overlay — unchecked is never clean. Machine bounds are the live JOINT window in the machine frame (`machineFrameGrp`), never under the rotating table.
- Baked geometry hangs under its OWN anchor, posed from the WCS it was baked with; `workOrigin` follows the live offsets.
- Simulation mode (`simMode.ts`, client-local) closes every machine-action gate but `always` / `armed` / `setup`; entering needs the machine OFF; the backplot is suspended.
- Freshness: drift edges (WCS, tool length, rotary seed, start tool state, limit window) re-parse at idle; a parse in flight whose inputs went stale is SUPERSEDED, never queued; the one mid-run edge (the tool table) re-parses PINNED to the published start. Preview refusals are loud. Never bump `PREVIEW_SCHEMA` while the suite is live.
- Unknown is never "Clear": unknown starts after a tool change, a probe the preview cannot predict, the start-dependent beginning, untracked writes — each is named and left unchecked.
- The collision sweep certifies: conservative advancement with carried certificates (no margin crossing wider than `MIN_ADV` 0.25 is missed), a bounded BVH query (a distance past the horizon is no clearance), the corrected `distanceToBox`, shards over K = cores − 2 workers; open-ended, paused by camera interaction and a hidden tab, parked by a rotary jog. Only the cutter × stock cuts (feed contact is machining, a rapid onset a gouge). Pairs inside the margin at the first AND the rest pose are static, never a tool pair.
- What a sweep found is its CONTACT TABLES (`contactStore.ts`), read through ONE contact view (count ≡ ticks ≡ stops ≡ list); after a fallback the earlier generation is kept (`contactUnion.ts`); views are built in COUNTED steps and published with what the bar shows (`contactPublisher.ts`, `steps.ts`) — no long task on the page.
- A check during a run is admitted only for the pinned parse made for exactly that run (range sweep provisional, then full). While the gateway re-parses, the path re-bake and the collision re-check WAIT at one hold (`viewer/bakeHold.ts`) and a running check pauses (worker hold `reparse`).
- Measured: the browser-PC measurement on the operator's Mac with the VM (VP181-01, VP188-02, `~/claude-work/bpc`) is accepted; the acceptance on the machine PC and a live M600 run are owed.

## Key Patterns

The rules in short. The full form of each pattern — measured values, the specs that hold it, the review round that set it — is in [docs/architecture/ui-patterns.md](docs/architecture/ui-patterns.md); read it before changing what a pattern covers.

**Look and tokens**
- **No hardcoded visual styles** — never invent font-size, padding, border-radius, colors, opacity or font-family; inherit from the nearest parent class or `style.css`. New CSS overrides layout only. Machine active states `--ok`, form controls `--info`, danger `--danger`, warnings `--warn` — as FILLS, borders and tints; a TEXT or glyph in that state reads its `-text` role, muted text `--fg-muted`.
- **Text roles** — a text that is not plain `--fg` reads a role (`--fg-muted`, `--ok-text`, `--warn-text`, `--danger-text`, `--info-text`, `--accent-text`, the syntax palette, `--focus-ring`). Muted is a COLOUR, never `opacity`. Every theme block defines every role — the dark one TWICE (`[data-theme="dark"]` and the `prefers-color-scheme` block); `contrast.spec` measures 4.5 : 1 in five passes. A "?" never sits inside a label that can be disabled.
- **Spacing tokens** — `--gap-micro` 2 / `--gap-tight` 4 / `--gap-controls` 8 / `--gap-section` 12 / `--gap-panel` 20 px for every gap; padding inside controls stays hardcoded; at least `--gap-tight` between clickable elements.
- **Opacity tokens** — `--opacity-subtle` 0.3, `--opacity-disabled` 0.4, `--opacity-muted` 0.6, `--opacity-secondary` 0.8; never a literal (keyframes excepted); opacity is for disabled controls and decoration, never for a text someone reads.
- **Control height** — ONE height per density: `--control-h` (32 px desktop, 44 px touch) for fields, tabs and md text buttons; an AREA (`.strip`, `.dataTable`, `.macroBar`, `.denseArea`) redefines it to `--control-h-compact` (28 / 36). A scrolling table keeps its scrollbar's room (`scrollbar-gutter: stable`). Never a per-control padding for height.
- **Focus ring** — ONE ring: `:focus-visible` draws `2px solid var(--focus-ring)` outside (`outline-offset: 4px`), a FIELD draws it inside (`-2px`). Selection never uses the ring.
- **Non-text contrast** — what identifies an active control holds 3 : 1 against its neighbour (switch edge `--control-edge`, checked knob `--control-knob-on`, slider thumbs `--fg`).
- **Motion and forced colours** — a pulse or flash moves a BACKGROUND, never the words; `prefers-reduced-motion` stops them; under `forced-colors` a selection takes `SelectedItem`. Every flash runs on ONE clock (`flashClock.ts`).
- **UI font** — the app SHIPS Inter and JetBrains Mono (`src/assets/fonts/`, first in `--font-sans` / `--font-mono`); every troika `Text` sets `font = LABEL_FONT_URL` (without it troika fetches fonts from a CDN at run time).
- **Timeline marks** — × collision `--mark-clash` `#ff3355`, ▲ limit `--mark-limit` `#ffa000`, ● tool change `--mark-tool` `#3d8bff`: ONE bright set in every theme (≥ 0.2 OKLab apart), used by the timeline, the Sim tab, the code panel, the legend and the HUD.
- **Syntax highlight tokens** — `--syntax-gcode/-mcode/-coord/-param/-comment`, a palette PER THEME; token classes and the CodeMirror style read the same variables; no opacity on comments.
- **z-index scale** — `--z-base` 0 / `--z-raised` 1 / `--z-fade` 2 / `--z-pane-overlay` 5 / `--z-float` 10 / `--z-banner` 11 / `--z-modal` 1000 / `--z-modal-top` 1010. Never a literal.
- **No `:deep()` visual overrides** — `:deep()` for layout only, never background, color, border or box-shadow; fix a button state in `Btn.vue`.
- **Global utility classes** — `.text-muted/-ok/-warn/-danger`, `.mono`, `.emptyState`, `.statusDot`, `.sub` (section heading, no margin), `.sep` (the ONE horizontal divider — never a `border-bottom`), `.w-full`, `.saveStatus`, `.settingDesc`. Never a scoped copy.

**Controls and layout**
- **Catalog components** — every interactive element is a `Machine*` component; never `<Btn>` in a template. `MachineBtn` / `MachineInput` render exactly ONE root (a Teleport or a second root drops the parent's scoped-CSS id). A class on a `MachineBtn` PLACES it (flex, grid, width, margin), never styles its interior — a dimmed button is wrapped in `.btnTip`, which takes the class. Equal-share rows are grid tracks (`minmax(max-content, 1fr)`), not `flex: 1`.
- **Gate.vue** — `<fieldset :disabled="!allow">` with `.fs-reset`; browser-enforced default-deny; the outer Gate (`armed`) wraps the main area; `#exempt` holds only the safety section.
- **Tab pattern** — every side-pane tab's head is `.panelHead`: `.panelObject`, then ONE `.actionGroup`: the machine actions with Abort beside them on the left and, where the tab has management, More (`MoreMenu.vue`) at the RIGHT end. Download (`fileDownload`, gate `always`) saves the file as it is.
- **Starting motion is a hold** — Start, Step, Resume, the Run-from-line action and macros are holds (`holdKey` = path + published revision + displayed-text revision); Pause and Abort are taps; the Space shortcut stays instant. A macro's parameter dialog reads its file live by name.
- **Forms** — a labelled field is a `FormField` in a `.formGrid` (two columns while each keeps `--form-col-min` 160 px); `.formLabel` is the one label class; a unit is never a placeholder; `.sectionColumns` splits a section by the same rule (`--section-col-min` 320 px).
- **Resets and list rows** — a reset sits at the end of its section (`.resetRow`), asks once, keeps the button's gate; a row's actions are pencil / `Trash2` (`listAction`) named for their target. Command names come from ONE list (`INPUT_COMMAND_LABELS`).
- **Number fields** — `MachineInput type="number"` opens the keypad with its contract (`min` / `max`, the explicit `integer` prop — never `step`; `label` / `context`); out of range is refused, never clamped; a press takes no focus and selects nothing.
- **Selects that live through status** — a select whose component re-renders with status or gamepad polls keeps its options untouched (`v-memo` on the options, or on the `v-for` row); Firefox rebuilds an OPEN dropdown on any change. `select-writes.spec` watches every select.
- **Dialog tiers** — `.dialog` (sm confirm: `.dialogTitle` / `.dialogBody` / `.dialogActions`), `.dialog.md` and `.dialog.lg` (`.dialogHeader` / `.dialogContent` / `.dialogActions`), `.wide` = `--dialog-wide-w` 760 px, `.dialog-full` 90 % height; font from `.dialog`. A per-dialog `min-width` is capped by the room. Every dialog is a `DialogFrame`: machine flows `kind="flow"` + `.safetyDialog`, forms ignore the backdrop, Escape never closes a dialog (it is E-Stop). Wording: a confirmation's title is the question with its object ("Delete T5?"), the confirming button repeats the verb, an irreversible action says "This cannot be undone.", a discard ask offers "Keep editing"; a destructive action is `danger` under its own Gate, Cancel outside it.
- **Feedback channels** — ONE channel per trigger: what a touch triggers answers AT THE CONTROL (btnHint); an operation's result shows INLINE where it began (`.statusNote.error/.warn/.ok`); machine and system STATE is the banner (`bannerLine`: error and warn tiers, the state plus one recovery verb); the message center is the PROTOCOL (`pushMessage(kind, text, mode)`: `notify` / `status` / `log`). A REASON is "why — what to do" in ≤ 60 characters, a mode restriction said positively ("Machine frame and Plane only"). Help is a `HelpIcon`, a `title` only a short name (audit `LONG_TITLE` > 90).
- **Axis fallback** — `DEFAULT_AXES` in `useAxes.ts` is the only pre-`viewer_init` axis set; never a local `["X","Y","Z"]`.

**Viewer**
- **Camera** — Z-up (`camera.up.set(0, 0, 1)`; the top view uses `(0, 1, 0)`); the parallel eye stays outside the whole scene's sphere (`orthoEyeDistance`); normalize direction vectors before scaling. ThreeViewer resizes from a ResizeObserver (v-show tabs), never on window resize.
- **Viewer palette** — every colour the viewer draws in a role comes from `viewer/viewerPalette.ts` (`resolveViewerPalette`: the theme's `--viewer-*` roles, the operator's Custom colours over the seven user roles); `refreshPalette` re-resolves on every theme and settings change — never a colour of its own. ONE palette in every theme: path green `#5cff5c`, backplot magenta `#ff00ff`, rapid blue `#3d8bff` dashed, limit orange `#ff7a00`; lines ≥ 0.25 OKLab apart (`palettePairs.ts`). Boxes and reach outlines are TWO-TONE 1 px with geometry-anchored cells (`boxLines.geoDash`); every path line is 2 CSS px (`LineSegments2`, `fatPaths.ts`); draw order path 10 < backplot 11 < limit overlay 12. The current line is NOT drawn in 3D. The path-memory ledger counts every allocation where it happens (`allocMeter.ts`).
- **Viewer overlays** — top-left the DRO card that FITS its pane (`fitHud`: scale down, then fold, never clip), top-right the ViewCube, bottom ONE column (findings card above the scrub bar). A new viewer warning is a `.hudWarn` line in `.hudNotes` and joins `hudWarnCount`, never a chip or a DRO line. A button's glyph content needs an `aria-label`.
- **Viewer overlay chrome** — `.overlay-card` (92 % panel + blur, edge `--control-edge`) and `.overlay-card.warn`: one chrome, components add layout only; `--gap-section` from the frame.
- **On top per layer** — Settings → Layers: lines and markers can be drawn over the machine, one switch each (`ON_TOP_LAYERS`, stored as `viewer.onTop`); `setLayerOnTop` is the ONE mapping; on top = depth test off AND drawn after the machine (`viewer/onTop.ts`).
- **Tool geometry** — per-tool STLs in `machine/tools/` (tip at the origin, +Z), fallback cylinder; cutter and shaft split by `flute_length` / `shoulder_length`.

**Data, files and machine**
- **Settings** — `defaults.ts` section registry (`registerSection`, `loadSection` / `saveSection`); the server is the single source of truth (`settings_init` on every connect, `sendBeacon` on page exit). A new section goes into `_VALID_SETTINGS_SECTIONS` (gateway.py) AND `SERVER_SECTIONS` (main.ts).
- **localStorage** — only three places: the per-tab message history (`ws/statusStore.ts`), the one-time migration in `main.ts`, its cleanup in `resetAllDefaults`. No other use.
- **Shared modules** — `format.ts`, `toolTypes.ts`, `gcodeHighlight.ts`; never duplicate a formatter or a tool type label.
- **Program upload** — `POST /upload` never replaces a program without `overwrite=1` (409 → Cancel / Rename / Replace); the publish is an `os.link`, a filesystem that cannot link REFUSES (no copy fallback).
- **Editor session** — the G-code editor's buffer is bound to the file it was opened on; an external change raises a conflict banner; Save writes only the session's file.
- **Macro files** — a macro is `<name>.ngc` in `[DISPLAY] WEBUI_MACRO_DIR` (on `SUBROUTINE_PATH`, last; apart from PROGRAM_PREFIX); `macro_files.py` is the ONE parser; a macro runs only when the interpreter's own lookup finds its file; `run_macro` is bound to the file's revision and forces `SET_MODE(MDI)`; writers and starts share ONE admission (a start claim released only by a positive status proof).
- **INI lines LinuxCNC reads** — LinuxCNC keeps 255 bytes of an INI line and the first 10 `SUBROUTINE_PATH` entries, silently; `install_examples` refuses such an install, `config_sync_check.py` reports `[TRUNCATED]`.
- **Loaded program** — `active_file` is the program the operator LOADED, not the interpreter's open file; a load or unload is ONE record transaction settled only by the interpreter; a restarted gateway adopts a program only from its own load record.
- **Tool change** — the gateway's `tool_change` handler is fire-and-forget (no `wait_complete`). Toolsetter settings live in Probing › Toolsetter; tool ACTIONS in `App.vue` and `ToolTablePanel.vue`, not the read-only ToolStrip.
- **Toolsetter set up** — its values reach the machine only when SET UP (every required field in the section the SERVER confirmed); every M600 the WebUI starts goes through `toolsetterMdi` / `fireWithVars` as ONE `mdi` with the values in `vars`. Run from line sends ONE `auto_run` bound to the displayed program's version and source fingerprint; the gateway tracks what it SENT for the `#3116` skip flag, and every start from idle passes `_start_guard`.
- **Sim tool setter** — the sim configs trip the probe in a realtime component (`sim_toolsetter.comp`) at a PHYSICAL plate per profile, never the WebUI's setting read back; the 3D view marks the setter, the stored G30 and an off control point with pins (`viewer/toolsetterMarker.ts`, `pointMarker.ts`).

## Pre-Flight Checklist — MANDATORY for every CSS/UI edit

Before writing or modifying ANY CSS or interactive element, verify ALL items:

**Spacing** — `gap`/`row-gap`/`column-gap`/`margin` between siblings MUST use tokens: `--gap-micro` (2px), `--gap-tight` (4px), `--gap-controls` (8px), `--gap-section` (12px), `--gap-panel` (20px). Never hardcode. No double-layer spacing (parent flex gap + child margin-bottom on `.sub` headings, etc.). Grid cell gaps use `--gap-controls` or `--gap-tight` — never `--gap-section` for internal grid spacing.

**Layout** — Use `stack-*` / `row-*` utility classes from `style.css` for flex layout. Never write `display: flex; flex-direction: column; gap: var(--gap-*)` directly in component CSS. Component-scoped CSS should only add non-layout properties (height, overflow, position, flex, min-height). Classes: `stack-panel` (20px), `stack-sections` (12px), `stack-controls` (8px), `stack-tight` (4px), `stack-micro` (2px), `row-controls` (8px), `row-tight` (4px). A conditional rule (`@media`, `@supports`) comes AFTER the base rule it adjusts: same specificity, the later one wins — the Safety section's portrait rules sat before its base rule and never applied for seven weeks (content 8 px further in than every other section, the scroll fade in its landscape geometry); the CSS audit's `MEDIA_SHADOW` fails the gate on that order, in `.vue` style blocks and in `style.css`.

**Opacity** — Use tokens: `--opacity-subtle` (0.3), `--opacity-disabled` (0.4), `--opacity-muted` (0.6), `--opacity-secondary` (0.8). Never hardcode opacity values except in animation keyframes.

**Typography** — `font-size` → `--fs-*` tokens. `letter-spacing` → `var(--tracking-caps)` (uppercase text only). `border-radius` → `--radius-*` tokens. `font-family` → `var(--font-mono)` or `var(--font-sans)`. Never hardcode any of these.

**Colors** — Use semantic CSS variables (`--ok`, `--danger`, `--warn`, `--accent`, `--fg`, `--bg`, etc.) with `color-mix()`. Never raw hex. A TEXT takes `--fg`, `--fg-muted` or a `-text` role — never a fill colour, never an opacity. Hover tiers: `--hl-hover` (12%), `--hl-selected` (15%), `--hl-active` (20%) — no other percentages. A STATE colour mixes at a named strength: `--tint-faint` (10 %), `--tint-note` (15 %), `--tint-active` (20 %), `--tint-fill` (25 %), `--tint-heavy` (40 %), `--tint-edge` (50 %) — never a literal (audit TINT).

**Permission gates** — Use `MachineBtn`/`MachineInput`/etc. catalog components for all interactive elements — they self-gate from the catalog. Wrap sections in `<Gate :allow="can.X">` for fieldset-level gating. Never use `<Btn>` directly in templates. Individual `:disabled="!can.X"` is only correct for elements with tighter permissions than the parent Gate. Never use `:class="{ inactive: !can.X }"` for permission gating.

**Global patterns** — Form elements inherit from `style.css` base (component CSS only adds layout). Tables → `.dataTable`. Dialogs → `<DialogFrame>` (never a hand-built `.dialogOverlay` — the audit's `DIALOG_FRAME`). Close buttons → `<MachineBtn type="close">`. Empty states → `.emptyState`. Status dots → `.statusDot`. Section headings → `.sub`. Horizontal dividers → `<div class="sep">`. Monospace → `.mono`. Nothing in a side tab or a dialog runs out SIDEWAYS (`sidewaysOverflow` in layout-audit: content wider than a box that does not let it show — the side-pane sweep in every tab and state, every dialog in `dialogs.spec`; Codex R70): only a code editor, an ellipsis, a field's own value and a box marked `data-scroll-x` (the Offsets table past its axes, the G-code reference's one-line syntax) scroll or cut sideways on purpose — it found Settings' scroller 6 px past `.tab-content`, whose `overflow: hidden` cut its scrollbar. Scrollable containers → add `.scroll-thin` (a `.dialogContent` and CodeMirror's `.cm-scroller` carry it by themselves — a dialog's content always scrolls in a low window; seven dialogs and both code editors drew the browser's wide black bar, operator 2026-10-03). `measureLayout` flags any scroller without the thin bar (`thick-scrollbar`, judged by its style, scrolling or not — headless Chromium hides every scrollbar, so no screenshot shows one) and `dialogs.spec` checks every dialog, `editor-guards.spec` the program editor (`thickScrollbars`). Check existing components before creating new CSS.

**New patterns** — If the needed style doesn't exist globally, STOP and tell the user: "This pattern doesn't exist in our global styles. We should add it to style.css first." Never create one-off scoped styles for reusable patterns.

**Dead CSS** — a scoped rule that styles nothing (`EMPTY_RULE`) or a class the component never names (`DEAD_CLASS`: template, script literals, `prefix-${…}`, Transition names, a child component's root class) fails the CSS audit; delete it with the markup that used it (design wave D10).

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
| #3116  | rfl_skip_tool          | One-shot RFL guard: tool just measured via MDI — skip its in-program re-measurement once (set by gateway, self-cleared by routine; cleared by every routine the WebUI starts with values, and before any start while the gateway cannot vouch it is 0) |
| #3014  | finder_number          | Probe tool number (shared with probe tab) |

### G30 position (#5181–#5189, operator P4, Codex R21–R24)

The stored tool-change position lives in the INTERPRETER; the parameter file holds it as of the last `Interp::synch()` — task synchs on every switch to MDI/AUTO and on `task_plan_synch` (rs274ngc_pre.cc `synch` → `save_parameters`, verified live 2026-09-28; not only at shutdown). `save_parameters` writes `<file>.new`, links the old file as `.bak` and renames: a NEW INODE proves a fresh file (a failed write leaves the inode, and synch still answers RCS_DONE). `G30.1` stores `STAT.position` (the commanded position in the machine frame) for all nine axes at `#5181 + canonical index` (`gateway_util.g30_param`); a `WRAPPED_ROTARY` axis is stored in [0, 360). Three gateway commands, every step under `_cmd_lock` then `_var_file_lock` (never the reverse; the gateway's own var-file writers take the same lock, `_var_file_thread` waits for a write to end even through repeated cancels):
- `read_g30` (gate idle): the synch must answer RCS_DONE, the inode must change, every configured axis must hold a finite value — else `confirmed: false` with the reason; one fd + `fstat` snapshot (`read_var_snapshot`). The synch is `_synch_interp_params`: LinuxCNC REFUSES `task_plan_synch` with the machine ON in AUTO ("can't do that … in auto mode with the interpreter idle" — where every loaded program leaves the task; measured live 2026-10-09), so there NOTHING is sent and the read is not confirmed ("G30 not confirmed in AUTO — switch to MDI first"; the automatic toolsetter read-back keeps the basis assumed). The switch to AUTO also synchs, but task honours it with the interpreter busy and aborts the program, and a poll that saw it idle proves nothing about the moment task takes the command (Codex R118 VP-I71). In MANUAL, MDI and with the machine off `task_plan_synch`; a start that lands first puts the task in AUTO, where the synch is refused — never an abort. A visible mode switch for the read would be a contract of its own (not agreed).
- `capture_g30` (g30Capture: machineFrame + standstill — a manual jog keeps INTERP_IDLE): the confirmed stored values plus the current position (wrapped rotaries normalised) — a DRAFT, nothing written. After the awaited synch it re-checks the admission on a CURRENT controller read before it takes the position (`_controller_capture_state`, Codex R25–R27 OP-I02; the published snapshot lags a cycle): the STAT poll must SUCCEED (a failed one leaves the last poll's position in the object), the kins frame is the reader pin read NOW — an absent value or a stale reader is unknown and refuses on a switchable machine, never the snapshot's frame; a machine whose declaration cannot switch needs no pin — and the interpreter state and the motion come from that poll; no status at all refuses too ("Machine status not read — capture again"). Stricter than `_controller_touchoff_state`, which keeps a snapshot value the controller does not offer.
- `set_g30 {values, based_on}` (machineFrame): the window check (`g30_window_refusal`: AXIS_ / JOINT_ limits, an open bound is named in `open_axes`), then the confirmed read must still equal `based_on` (1e-6, else "G30 changed meanwhile — reload"), ONE MDI of `#518x=` words, and a second confirmed read must show every value — only then `ok`.
`_read_g30_vars` is the display read (no machine command): a missing row is `None`, never 0.0, with the file's time.

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
- A range input under `v-model` clamps a value to its OLD range: `v-model` writes the element's value in `beforeUpdate`, before the render patches `min`/`max`/`step`, so a value past the old max arriving with a longer range sat at the old end (the scrub bar's first finding jump — the entry move lengthens the timeline — showed its thumb at 20 of 120). `MachineSlider` binds `:value` (Vue patches `value` after every other prop) and writes the model on `input` (found by the R33 limit guard, 2026-09-28)
- A flex item that holds single-line (`nowrap`) text needs `min-width: 0`, or its automatic minimum width is the full text and it pushes its siblings out of the container — the status banner's action buttons (messages, Refresh, Home All, Abort) vanished behind the right edge whenever a long banner showed. Compact banner texts to the state plus one recovery verb; the explanation goes in the `title`
- A `min-width` floor on a readout slot is not a fixed slot: content past the floor still grows it and `text-overflow: ellipsis` never engages. A readout that must not move its siblings gets `flex: 0 0 <w>` + `overflow: hidden` (ScrubBar row 1 ate the timeline). Same family: a control that changes state must keep its geometry — one slot, one button position, variable-width text AFTER the last button of its group
- Every overlay on the 3D viewer keeps `--gap-section` from the frame and floats on the global `.overlay-card` (92 % panel + blur: HUD card, sim bar) — never hard-code the 12px or copy the chrome into a component; the bar sat 8px in on an opaque panel while the HUD sat 12px in on a translucent one
- A `watch` reads its source at once: register it below every `computed` / `ref` that source reads. A binding declared after it is in its temporal dead zone — Vue catches the throw and logs it (`console.error`, no `pageerror`), and the watcher tracks only what it read before the throw. The contact bar's stage watch did this from Form 1 to R162; `viewer.spec` now fails on a ReferenceError in the console at load
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
- Three deletes only a geometry's CURRENT index attribute on dispose: an index attribute swapped out with `setIndex` and never current at dispose time leaks its GL buffer. Give each LOD level its own geometry object (visibility flip) instead of swapping indices.
- Program-order index ranges are not spatially compact (a pocketing pass sweeps the whole part every 40 k segments): bin segments spatially before expecting frustum culling or a bounds gate to fire. Per-object cost (~5–15 µs) bounds the chunk count — ~64, not hundreds.
- A benchmark program can be adversarial to an optimisation by construction: `perfmatrix-big.ngc` is a random walk (median turn 52°), so no honest decimation collapses it; read a perf lever on a real CAM program too.
- Machine bounds are joint limits, fixed in the room: anything expressing them (clip planes, the bounds box) lives in the machine frame (the work chain with its rotaries zeroed), never under the rotating work group.
- Never bump a wire schema constant while the suite is live when the producer is a fresh subprocess and the consumer imported the constant at start — the mismatch edge loops. Ship the new key (ignored by old readers), bump at the stop.
- Surface-map Z compensation (`axis.z.eoffset`) is a **3-axis feature**: a machine-Z shim applied after kinematics, valid only with the tool normal to the mapped surface (A=0) and the map's XY grid aligned to the work (C=0 — the map does not ride the platter). Probing or applying it tilted is directionally wrong; enforcement gate deferred (recorded in dry-run memory)
- A per-line `Map`/`Set` on a million-line program is a million heap objects the browser's collector marks on EVERY major GC (110–140 ms measured) and a ~1 s structured clone per worker hop — the "sometimes lags when rotating" class. Line-indexed typed arrays (`viewer/lineIndex.ts`) are the shape for anything keyed by line number
- A background re-parse that cannot be cancelled QUEUES: an edge raised during it was not even evaluated until it published, then ran a second full parse (41–167 s live). Snapshot the running parse's inputs and supersede it; and an edge that stays true until the publish (`file_changed`) must never be allowed to cancel the parse that will clear it
- `browser.viewer.perf` `frames`/`gap_*` are the STATUS cadence (30 Hz active, 5 Hz at the gateway's idle poll after a manual jog), NOT the frame rate — a whole record once called the Mac's viewer "30 fps capped" from them. `raf_*` is the render loop; `mt_*` (timer lateness) vs `gpu_*` (WebGL2 fences) say whether a stall is the main thread or the GPU — the CPU-side `render_*` never shows a GPU-bound draw (WebGL is out of process in Firefox and Chromium)
- A Web Worker is off the main thread, not off the machine: the collision sweep running for minutes made the GPU trail 3–4 frames on the operator's Mac with a perfectly clean main thread. Profile before designing (the "2 h sweep" was a per-chunk certificate reset meeting 0.09 mm segments — 45 BVH queries per 0.09 mm — not mesh cost); let interaction (camera) and a hidden tab pause every background job, and make it report what it covered whenever it stops early (the wall-clock budget that once bounded the sweep was retired 2026-09-13 once the pauses and the carried certificates made it pointless)
- Lazy conservative advancement must CARRY its certificates across chunk boundaries in clearance terms (d − margin, decremented by each chunk's V × L); resetting them per chunk makes the cost O(segments × pairs) regardless of geometry
- Never probe a server's liveness with a WebSocket and never cancel a CONNECTING socket on a short timer: the browser remembers failed WebSocket connections (Firefox: per IP:port, ×1.5 up to 60 s, surviving reloads) and holds the next attempt, and Firefox admits one connecting WebSocket per IP across ports — blind retries through an outage plus a 3 s timeout kept tabs 35–58 s on "reconnecting" after every restart, and Vite's WebSocket restart ping on :5173 queued the gateway socket on :8000. Ask over HTTP first (`/ready`)
- An invisible hit area is real overflow: a `::before` larger than its element (the "?"'s `--help-hit`) counts as scrollable overflow in any scroll container around it — a scroller whose lines end in a "?" needs end padding for the reach (a negative margin keeps its size), or it shows a scrollbar for 3–6 px and clips the target. `overflow-y: auto` alone turns `overflow-x` to auto too
- A layout read (`offsetHeight`, `scrollHeight`, `scrollWidth`, `getBoundingClientRect`) in the task that changed the DOM forces the layout of EVERY pending change there: the scroll fades' MutationObserver re-read every scroller on each batch, `v-sticky-head` read its head at mount, the Sim tab measured its summary after `nextTick` — 22–25 ms each when 400 rows arrived (plan 3.6). Read layout from a ResizeObserver (after the layout) or in the next `requestAnimationFrame` (before the paint: no frame shows the unfitted state); find the reader in a Chromium trace (`UpdateLayoutTree` / `Layout` events carry the forcing stack)
- An operation count bounds a step only if every expensive call is counted: a binary search costed as 64 operations, a whole-list `TypedArray.from`, a coverage scan outside the counter each made a single 10–20 ms step in the browser while the step count looked healthy — test the work PER STEP (reads between two yields), not the number of steps
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
| `WEBUI_MACRO_DIR` | *(none)* | The macro folder (package 5): `.ngc` macros run by `o<name> call`; must be on `[RS274NGC] SUBROUTINE_PATH` (the examples: last) and apart from PROGRAM_PREFIX. Unset = no macro files. See "Macro files". |
| `WEBUI_MACHINE_DIR` | *(gateway default)* | Machine viewer-model dir (`machine.json` + STLs) for the 3D machine model. Unset = `lcnc-gateway/machine/`. See "3D Machine Model". |

Environment variables `LCNC_WEBUI_HOST`, `LCNC_WEBUI_PORT`, `LCNC_WEBUI_BROWSER`, `LCNC_WEBUI_DEV`, `LCNC_WEBUI_TOKEN`, `LCNC_WEBUI_ALLOWED_ORIGINS` override INI values. `LCNC_LOG_DIR` overrides `LOG_DIR`. Camera variables: `LCNC_CAMERA_SOURCE`, `LCNC_CAMERA_RESOLUTION`, `LCNC_CAMERA_FPS`.

**Auth (issue #17):** the gateway is a machine-control surface, so when bound to a network interface it requires `WEBUI_TOKEN`. The token is injected into the served `index.html` (`window.__LCNC_TOKEN__`), so browsers the gateway serves get it automatically; the WS carries it as `?token=` and REST mutations as the `X-Auth-Token` header (`sendBeacon` settings flush uses `?token=`). This blocks cross-origin WS hijack and unauthenticated REST mutation on a trusted LAN; it is **not** a defense against an attacker already running code on that LAN.

**Development mode:** Set `WEBUI_DEV = 1` — launcher starts Vite on :5173 (hot-reload) alongside the gateway on :8000. Browser opens to :5173 where Vite proxies API/WS to the gateway.

For headless/no-UI: `DISPLAY = dummy` (zero overhead, gateway connects separately). A standalone gateway has no launcher (no PDEATHSIG) but is still session-bound: it binds to the LinuxCNC instance on its first NML connect and exits when that instance ends; set `WEBUI_ALLOW_REBIND=1` only for a harness that restarts LinuxCNC under one gateway.

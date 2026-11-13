# Safety and permission details

> Moved verbatim from `CLAUDE.md` on 2026-10-25 (the guide keeps a short form and points here).
> The entries record each rule with the reason and the review round that set it.

**Session binding (2026-09-13, `session_bind.py`).** A logout once left the previous session's `setsid`'d gateway alive; on the next `linuxcnc` run it re-attached to the NEW session's helpers and fed the watchdog heartbeat with a dead LinuxCNC behind it. Now: a LinuxCNC instance is `(linuxcncsvr pid, /proc start ticks)` (zombies excluded); the gateway binds to it on its first NML connect (`_bound_instance`) and NEVER re-binds — a client-independent `_instance_watch_loop` (1 s; the status poller skips instance checks with zero clients, exactly an orphan's state) detects the instance ending and calls `_request_process_shutdown` (launcher SIGTERM else self-SIGTERM, 5 s `os._exit` deadline). `bind_to_launcher()` arms `PR_SET_PDEATHSIG` against `LCNC_LAUNCHER_PID` so a launcher-managed gateway dies with its launcher on the paths bash cannot trap. Receiver side: the first line on either helper socket must be `{"type":"hello","proto":1,"gateway_pid","instance"}`; `AdmissionGate` checks `SO_PEERCRED` (fail closed), uid, pid, the helper's cache-once `InstanceResolver` identity, and never replaces a connected gateway (kernel EOF is the liveness signal — heartbeats only flow while browsers are connected, so a heartbeat window would let an idle gateway be superseded). Verdict `welcome` / `rejected{reason}`; reasons `no_hello` (pre-binding code), `no_peercred`, `uid_mismatch`, `pid_mismatch`, `bad_hello`, `unbound_gateway`, `no_current_instance`, `instance_ended`, `stale_instance`, `duplicate_gateway`. A rejected connect never touches pins (previously ANY accept forced them LOW — a 30 Hz reconnecting orphan would have tripped the live session); rejection logs are throttled per (reason, pid). Bridge side (`hal_bridge.py`): never dials while unbound, drains the verdict without blocking (zero-timeout `select` — a bare `recv` on the 50 ms-timeout socket costs 50 ms per heartbeat), backs off 5 s after a rejection, classifies a silent helper as legacy (banner), and drains a pending verdict on EPIPE so a rejection racing the helper's close is not lost. `stale_instance` → the gateway shuts down; other reasons ride the safety-chain banner (`helper_status_reason`). Launcher: port pre-flight terminates a stale holder only if its cmdline is our gateway/Vite (loud), aborts on any other holder; `trap _term INT TERM HUP`. `WEBUI_ALLOW_REBIND=1` = legacy reconnect for dev harnesses only (`test_viewer_init.py`). Tests: `test_session_bind.py` (incl. a real PDEATHSIG kill), `test_helpers_admission.py` (both helpers as subprocesses under `fake_hal.py`), `test_session_policy.py`, `test_hal_bridge.py`.

Why this split: the previous in-process approach had `webui-monitor` mirror-pin shadowing for sub-µs reads, but a SIGKILL orphan left stale shadow values readable by `hal.get_value` while the real pin was disconnected — silent-fallback failure mode that masked a safety-trip read. See GitHub issue #9 for full history. Driving rule: [feedback_no_silent_fallbacks.md](.claude/projects/-home-cnc-lcnc-suite/memory/feedback_no_silent_fallbacks.md).

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
ignored the switch — the reply says what was asked and what stayed and names
only the states it SEES (a jog the gateway started → "release it", the
machine off, joints unhomed for MDI/AUTO; `gateway_util.mode_switch_ignored_message`,
Codex R62: it said "a jog is still active" for an unhomed machine too); LinuxCNC operator errors
ride the trace as `nml.error`. A retract NEVER lowers Z: the `G53 G0 Z0` in go_to_zero/home/g30
is guarded by `#<_abs_z> LT 0` (the same four offset terms a G53 Z word
subtracts — interp_namedparams NP_ABS_Z / interp_find G_53) and the RFL safe-Z
step skips when already at/above; the matrix certifies the frame premise
(`#<_abs_z>` == machine-frame Z with a TLO active) and both branches from
above/below machine zero (the above rows SKIP with the reason on a Z0-at-top
config).

**Button gates, package A (2026-10-25, review `docs/reviews/button-gates.review.md`, Codex R202–R204).**
An enabled control means the action is admissible in the last CONFIRMED state;
the server re-checks before the effect. Package A closed what made that false:
- *A started jog owns its stop* (BG-06, reproduced by Codex in R202): keyboard,
  pointer and D-pad record at the press what they started (`jogGesture.ts`:
  axes, continuous or a step) and the release sends that gesture's stop. A
  keyboard gesture is keyed by the PHYSICAL key (`code`, R205): a key map
  saved on another client while the key is held, or Shift turning "q" into
  "Q", no longer loses the stop. They
  used to re-read the step selector (a Cont jog whose step became 1 mm mid-hold
  sent no `jog_stop` — the machine kept moving), the D-pad re-read the Z
  modifier (Z jog, modifier let go first → `jog_stop` for Y), and the pad's
  analog channel stopped a D-pad jog it had not started one frame after the
  press. App's focus-loss stop sends every gesture's own stop and no longer
  waits for the `jog` gate; the gateway's disarm jog-stop stops an unhomed
  machine's jog too (BG-07 part).
- *Step from idle is a start* (BG-09): `step` = paused OR the `run` rule (idle,
  homed, kins runnable). A program start's kinematics are read from the
  CONTROLLER (`_program_start_refusal`: the fixture from a STAT poll, kins and
  plane from the reader now — the broadcast's `reader_fresh` was the freshness
  when it was built, R205), early in `_start_guard(program=True)` and again at
  the write itself (`_cmd_blocking(..., admit=)`, inside the write's own thread
  right before `cmd_fn` — after the mode switch, the run basis, the start claim
  and the executor queue, R206/R207; `_StartRefused`, nothing written), for
  Cycle Start, Step from idle and both run-from-line paths (the sequence's
  AUTO_RUN minutes after its handler). Never for an MDI line, the way out of a
  stranded frame. Plane kins needs G59 KNOWN: an unread fixture refuses
  (R206). Run from line's confirm runs under `run`.
- *Unknown is closed* (BG-12): `interp_state` None is no longer INTERP_IDLE
  (`interp_known`, `STATE_UNKNOWN` before every idle/running/paused rule); the
  reader-derived policy inputs (kins type, plane, head pose, eoffset, the
  tool-change request) count only while the reader is fresh
  (`StatusPayload.reader_fresh`, `policy_state_from_payload`) — the payload
  keeps the last reading for the display, the reader_stale banner says it is
  old. An unread eoffset pin is unknown on a machine with Z and off on one
  without (`eoffset_state`: a declaration, not a guess). Before the first
  status only `STATELESS_GATES` pass the dispatcher (it used to skip the check).
  Handlers read the reader through `_reader_fresh_get`.
- *The M6 confirmation* (BG-17) has its own gate `toolChangeConfirm`: armed and
  a FRESH pending request, closed in simulation (it continues the real
  interpreter). It names the request it answers (R205): `tool_change_seq`, a
  new number per observed rising edge of `iocontrol.0.tool-change` and per
  tool change while raised (`StatusRuntime.track_tool_change`); the gateway
  refuses an earlier number, a tool that changed since, a confirmation without
  one, and a second confirmation of a request. The dialog's Confirm is rebuilt
  per request (`:key`) — a press begun on T7 confirms nothing after T9 replaced
  it. A request is booked as confirmed only when `watchdog_send` reports the
  message DELIVERED (R206: True / False = nothing written / None = unclear; a
  frame cut by a timeout is ended invalid with `#\n` before the next one, so the
  watchdog drops it and never applies it late or joins it to the next — R207;
  one writer owns the stream, `HalBridge._wd_lock` over send, connect and
  disconnect: a send waits at most `_WD_SEND_WAIT` 60 ms for another in flight,
  else returns False, nothing written — R208; every socket operation, connect
  included, is bounded by `_WD_IO_TIMEOUT` 50 ms set BEFORE connect, so the
  lock holder is bounded and Disconnect waits for it without losing its
  effect — R209); a
  refused or unclear confirmation shows in the dialog and a deliberate press
  tries again, bound to the same request. Boundary: two requests for the SAME
  tool whose low phase falls between two polls stay one observed request.
- *Stops need no arm* (BG-08 / BG-18): `abort` has no requirement, `pause` is
  running-and-not-paused (AUTO or MDI), `spindleStop` is on + idle without arm
  or homing and sends the direct NML stop without a MANUAL switch (task takes it
  in MANUAL, MDI and AUTO at idle; a run that started since the snapshot is
  refused — the program owns the spindle). The client overlay never closes a
  stop (`STOP_GATES`), `cycle_pause` / `spindle_stop` are never debounced and
  are stop-class in the gateway queue. Resume, Step and the M6 confirmation are
  no stops. **Deviation until package C:** the Abort and Pause buttons inside the
  outer `armed` fieldset (G-code panel, Probing, Macros, the macro bar) and the
  strip's spindle stop are still disabled by that fieldset while disarmed; the
  banner's Abort, every dialog's Abort, the keyboard and the gamepad reach the
  stops now. The unused `dialogBase` catalog type (the `abort` gate as a
  "machine on" proxy) was removed.

### Package B — writers and settings (button gates BG-14, BG-15, BG-19)

- *A write names its connection* (BG-14, Codex R203/R204): the gateway mints
  `conn_key` (`secrets.token_urlsafe(16)`) per WebSocket CONNECTION
  (`ClientState`), sends it with every hello reply on it (the same key — a
  second hello leaves no second one), and removes it with the registry entry as
  the disconnect cleanup's first step. A protected HTTP write sends it as
  `X-Conn-Key` (the page-hide beacon in its JSON body, beside `data`);
  `_writer_refusal` finds an open, ARMED connection by it
  (`hmac.compare_digest`), else "Connection unknown — reconnect" or "Not armed
  — press Arm". No grace after the close, the resume id never stands in for it
  (Codex R204: a protected save the server can no longer admit stays
  unconfirmed in the page's ledger).
- *Admitted at the commit:* the receive, the decode, the temp file and the
  import preview run outside every lock; the last check —
  `_write_admission_refusal`: the writer's connection registered and armed
  NOW, no open start claim, no run from line starting, no program change, a
  controller status (STAT None is no known idle: "Machine state unknown —
  wait for status", Codex R211 BG-26), the interpreter KNOWN idle on a fresh
  STAT poll, and for the table a fresh reader with no M6 request — runs in
  the write's own thread right before the publish: the program publish inside
  `_atomic_stream_write`'s `_commit()` under `_source_lock` (where starts take
  their claim), the macro writers in `_macro_write_gate` (the same rule, then
  the name / revision / folder rules — BG-25: a load or a run from line
  refuses a macro write as it refuses a program write), the tool table in
  `_write_tool_table_admitted` (the WS edits) and `_persist_imported_tools` /
  `_save_refreshed_metadata` (import, refresh) — refusal = PermissionError →
  403/409 or the WS reply, nothing replaced. A WS command carries its
  connection's key to the commit (`handle_command(msg, armed, conn_key)`,
  BG-23): the arm the dispatcher saw is no commit permission. E-Stop is
  allowed: maintenance.
- *An admitted tool-table persist ends* (BG-22, Codex R211): the table write,
  the reload into LinuxCNC and the metadata are ONE section
  (`_persist_tool_edit` for the WS edits, the import's own) awaited through
  `_thread_to_end` under `_cmd_lock` — a cancel (an abort preempts WS
  handlers), a second one too, waits for the whole section before it
  propagates, so the next writer never runs inside it and an admitted table
  never goes without its reload and metadata. The abort waiting for the lock
  pays one table write, one `load_tool_table` (no wait_complete) and one
  library read and write; the preempted edit's reply still says "Preempted by
  abort" while the table holds the edit (`tool_table_changed` carries it) —
  the contract a sent MDI has under `_cmd_blocking`. The client gates are the
  same rules: `sourceWrite`, `toolTableWrite` (catalog `fileSave`, `sourceOp`,
  `sourceDanger`, `toolOp`, `toolSave`, `toolDanger`, `listActionTool`,
  `listActionSource`, `toolEdit*`, `uploadName`); both stay open in simulation
  (a write moves nothing — what `setup` allowed there). Discard (`fileDiscard`)
  is never gated: it writes nothing, and the Save beside it is now open in
  E-Stop.
- *No permissive fallback* (BG-15): a status that carries permissions but not
  a class closes that class with "Gateway lacks this permission — restart it";
  `run` / `machineFrame` / `goZero` are no longer read from `ready`.
- *Settings* (BG-19, operator Q2): `settings_store.FREE_SECTIONS` (`display`,
  `viewer`, `panels`, `camera`) save for any connected client; every other
  section needs the writer's arm — no idle, power or homing term (the MDI
  history saves during a long MDI). WS `save_settings`, `PUT /settings/<s>`,
  the beacon and `DELETE /settings` (a protected global reset) ask
  `section_needs_arm` through ONE admission (`_settings_admission`), called by
  `SettingsStore.save_section` / `reset` INSIDE the store's lock right before
  the write (BG-24, Codex R211: a check before the lock is stale once a
  preceding writer lets go); a refusal writes and bumps nothing.
- *Draft ≠ active* (BG-19): in the client a protected section acts only once
  the SERVER holds it. `defaults.loadSection` is what acts — the server's
  confirmed blob for a protected section, this tab's latest for a display
  section; `loadSectionDraft` is what a form shows and saves onto. The key map
  (`keyboardConfig` vs `keyboardDraft`), the pad (`gamepadConfig` vs
  `gamepadDraft`), the macro bar (`macroBarNames` vs `macroBarDraft`), the
  tool-change mode, run from line and the auto-disarm time follow the server's
  blob; Settings, Probing's parameters and the run-from-line dialog are forms
  (a probe and a run-from-line start send what their form shows, under their
  own gates). A draft ends when the server holds it (an equal section, or the
  reply for its revision), when it failed and the server's section changed
  since (another writer's state shows; the failure stays in the save status),
  or with the next change; on its way it rides along with other writers'
  changes. Nothing resends it — a later Arm or a reconnect applies nothing. The
  e2e mock answers `save_settings` and sends the blob like the gateway
  (`settingsEcho`; the save-status specs turn it off and answer themselves).

### Package C — navigation, preselections, the file browser, explanations (button gates BG-01, BG-02, BG-05, BG-16)

**The principles** (Codex R202, agreed R204). Enabled means *admissible by the
last confirmed state and meaningful for the concrete action* — no promise of
success: the server checks again right before the effect. Unknown is never
idle, homed or "compensation off".

1. View, draft, commit and motion are different things. Tabs, search, help,
   reading, copying, the viewer and local drafts need no arm. A draft is
   never executed by arming, a reconnect or a focus change.
2. Arm authorizes new machine effects, not navigation. Stops stay reachable;
   resume, the M6 confirmation and the E-Stop reset are no stops.
3. A gate belongs to the action with its target and parameters (MANUAL is
   not AUTO; a step from idle is a start, from a pause a resume).
4. One contract, several callers: the backend decides and explains; screen,
   keyboard and gamepad use the same action map (package D completes it).
5. A begun gesture owns its end: a jog keeps its target, frame, mode and
   speed from its start (BG-06, BG-05).
6. No hidden mode switch to unlock a view; a refused command never looks
   successful.

**The matrix** (`✓` = under the action's own conditions; columns other than
"Observer" assume arm):

| Action | Disconnected | Observer | E-Stop | Off | Unhomed | Idle | Running | Paused |
|---|---|---|---|---|---|---|---|---|
| Navigation, drafts, help, preselections | cached | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reading / download from the gateway | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Display settings (display, viewer, panels, camera) | local | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Protected settings (read: free) | – | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| File / tool-table commit (sourceWrite / toolTableWrite) | – | – | ✓ idle | ✓ idle | ✓ idle | ✓ | – | – |
| Abort, E-Stop, the needed jog stop | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pause (AUTO or MDI) | – | ✓ running | – | – | – | – | ✓ | – |
| Spindle stop (at idle) | – | ✓ | – | – | ✓ | ✓ | – | – |
| Start, step from idle, MDI, macro, WCS, touch-off, world jog | – | – | – | – | – | ✓ | – | – |

Loading, the mode choice, G30, the recovery order and Q1 follow in package D,
joint jog before homing in E.

**What package C changed.**

- *No outer armed fieldset* (BG-01): the content (`.content#content-dialog-area`,
  the dialogs' Teleport target), the strip and the macro bar are plain
  elements. Before, a disarmed client could not change a tab, close a dialog,
  browse the program folder or reach the Abort and Pause inside the content
  (package A's "every dialog's Abort is outside the fieldset" was wrong: every
  dialog teleports into the content — corrected in the C answer). Every
  control a disarmed client can operate is in `controlInventory.ts` — what it
  does and why that needs no arm; `controlScan.ts` finds them in the templates
  (a control is live when its own gate and every `<Gate>` around it in its file
  open without arm: `always` and the stops) and `controlInventory.test.ts`
  fails on an unclassified one or a stale entry. The scan reads an event by
  its name (`@click.self` = `@click`) and a bound gate or entry by every value
  it can take: only literal values that all close count as closed, anything
  dynamic is listed (Codex R213 BG-30). It guards the LIST of controls and
  their gates, not what a handler does. A protected effect is never a
  category: such a control takes an armed gate. The DEV "UNGATED" outline
  (`main.ts`) leaned on the outer fieldset and is gone.
- *Protected settings dimmed* (operator decision 2026-10-26, Q2 "the rest
  armed"): the keyboard and gamepad configuration (`inputConfig`), the probe
  and toolsetter parameters (`probeParam`, `scanParam`, `toolsetterParam`), the
  machine section (`protectedSetting(Num)`), the macro bar's membership and
  order, a key binding's removal and capture (the capture cell refuses and
  says why), a gamepad profile (`profileRemove`, `dialogSettingConfirm` /
  `dialogSettingDanger`), the MDI history's Clear (`settingInlineMd`) — `armed`,
  dimmed with "Not armed — press Arm". Not the plan's "drafts free": a
  disarmed draft could never be saved (the gateway refuses it, arming resends
  nothing), and the probe form would carry it into the next probe. Resets:
  `resetDisplay` (free) / `resetProtected` (armed); the confirm's Gate follows
  `isProtectedSection(target)`.
- *Preselections* (BG-05): the jog step, the jog speed and its reset, the RPM
  and the MDI line are free in every state. The RPM field is the preselection
  for the next Fwd / Rev — running and turning too (R213 BG-27): it mirrors the
  commanded speed while the spindle turns unless it holds a value not yet sent
  (`rpmPending`, ended only by the commanded speed reaching it — sent is not
  taken; the commanded speed entered again is no draft); a late INI default
  fills only a preselection nobody has written (`iniDefaultOnce`, R214 — the
  RPM and both jog speeds);
  the head shows the commanded speed while turning. A number keypad ends with
  its OWNER's gate, never with the arm as such (R213 BG-28): a free field keeps
  its entry through a disarm, a protected one closes and applies nothing. The MDI line's send stays `ready`
  (`useMdiHistory` `canSend`): a refused Enter keeps the text, writes no
  history and says why at the line; its keyboard opens for every client. The
  analog stick keeps the speed it started with (`gestureMaxVel`, taken when
  the axis leaves the dead zone, held through a reversal, dropped in the dead
  zone or on a stop). The jog pad's centre Stop is a stop (`jogStop`, always)
  by pointer and by Enter / Space (keydown, repeats ignored; R213 BG-29).
- *The file browser* (BG-02): no `setup` Gate around it; folders, `..` and
  Retry are reading; a FILE row carries the parent's `fileGate` (Program
  `setup` — loading moves to `programLoad` in D; Tools: the library preview, a
  read). A closed file row is disabled with its reason (title + a tap). The
  library Upload and Preview again are `fileBrowse` (always): the preview
  reads, applying is `toolTableWrite`. **Package F (operator 2026-10-28):**
  the Program tab's Files toggle takes the load's class (`fileOp` =
  `programLoad`, like Reload / Unload) — the browser there exists to load,
  and disarmed it showed nothing but closed rows; it closes when that class
  closes (a disarm, a program start), since its closed toggle could not.
  Download stays free (the one real read); the Tools tab's Files is
  unchanged.
- *Explanations* (BG-16): `gateExplain` offers the reason to every client,
  the disarmed one too; a control a closed inner `<Gate>` disables explains
  with that Gate's reason (Gate.vue provides `GATE_SCOPE_KEY`, the outermost
  closed one). `MachineChoice` takes `title` as a prop — as a fallthrough
  attribute an undefined title overrode the reason (every dimmed mode / WCS
  option was mute). Catalog controls carry `data-control="<entry>"`.
- *Backend:* `shutdown` is `armed` (policy + `require_armed`): the client's
  catalog gate was its only check. `simTrip` is `armed` (dev builds).
  `timing_log` stays free: a diagnostic file, no machine, file or settings
  effect.
- *Guards:* `controlInventory.test.ts`, `e2e/disarmed.spec.ts` (disarmed at
  idle / unhomed / E-Stop / running: every tab and sub-tab, every visible
  catalog control gated → closed WITH its reason, nothing forbidden sent; the
  preselections; Pause, Abort, the jog Stop and the spindle stop act; the
  browser browses; a dialog opened armed closes after the disarm),
  `useGamepad.test.ts` (the stick's speed), `test_button_gates_c.py`
  (shutdown).

### Package D — loading, the task mode, one action map, the recovery, G30, the spindle before homing (button gates BG-03, BG-04, BG-10, BG-11, BG-13, Q1)

- *Loading* (BG-03): `programLoad` = armed + the interpreter KNOWN idle — no
  E-Stop, power or homing term. The load no longer switches to AUTO first:
  PLAN_OPEN needs no mode (LinuxCNC takes it in E-Stop, off and MANUAL,
  emctaskmain.cc v2.9.4), and the switch failed off / unhomed, refusing a load
  the gate had allowed. A start switches to AUTO itself; that switch closes the
  plan (emcTaskAbort → emcTaskPlanClose) and PLAN_RUN re-opens `task.file`
  (emctaskmain.cc:2302), from line 1 — STAT.file and the load record stay. The
  load and the unload are admitted at the commit like a write
  (`_write_admission_refusal`: this connection armed now, no start claim, no
  run from line, no program change, the interpreter idle by a current poll).
  A load changes the program, which ends a viewer simulation (ScrubBar).
- *The task mode per target* (BG-04): `modeManual` = armed + idle + the
  machine stands (`motion_still`) + no joint homing (`homing_active`); no
  power term — MANUAL in E-Stop and unhomed. `modeCoord` adds "COORD
  reachable": every joint homed, or motion's kinType is KINEMATICS_IDENTITY
  (`STAT.kinematics_type`, never the switchkins frame) AND `[TRAJ]
  NO_FORCE_HOMING = 1` (`_coord_without_homing`; EMCMOT_COORD refuses an
  unhomed switch on any other kins type, command.c v2.9.4:581). The command
  gate is `modeManual`; the handler judges the TARGET's class (`modeManual` /
  `modeCoord`) again on a current controller read before the switch (see
  "At the write" below). The checked option sends nothing
  (ChoiceGroup).
- *One action map* (BG-10): `actionAdmission.ts` — the button, the shortcut
  and the gamepad admit Start (`run` + program context), Home All (`zero`)
  and the coolant (`override`) by the same rule. The shortcut and the pad
  stay silent on a refusal (they have no control to explain at) — a named
  boundary.
- *The recovery order* (BG-11): the trip is a policy input (`trip_unacked`,
  the gateway's `_unacked_trip`). `armEnable` (to ARM; judged by the backend
  alone — a disarmed client arms) and `estopReset` (armed + acknowledged)
  replace the client's own booleans; `estop_reset` is no longer `always`, so
  it is refused before the first status like every non-stop command (BG-12).
  Both stay open in viewer simulation (the Reset had no sim term before).
- *G30* (BG-13): `parameterRead` = armed + idle + not (machine ON in AUTO) —
  the confirming synch is refused there (`_synch_interp_params`, R118
  unchanged); off, E-Stop and unhomed read. `g30Capture` and the new
  `g30Write` (Save) carry the same condition; the capture's take-over re-check
  reads the task mode from its current poll.
- *The spindle before homing* (operator Q1): `[DISPLAY]
  WEBUI_SPINDLE_BEFORE_HOMING = 1` — exactly "1" (anything else is off, an
  invalid value traced). `spindleManual` = base + idle + (homed OR the switch
  in MANUAL); Fwd / Rev / ± use it. Off by default: nothing changes on a
  machine that does not set it. The exception FINDS MANUAL, never makes it:
  the handlers' own switch to MANUAL is admitted at its write.
- *At the write* (Codex R216 / R217, BG-04 rest / BG-31 / BG-32): the
  dispatcher judges a command on the PUBLISHED snapshot, up to a poll old,
  and a write then waits in the executor queue. The handlers that switch the
  task mode themselves — the mode choice, the manual spindle (Fwd / Rev /
  ±), and, the same class found beside BG-31, Home / Unhome and Cycle Start
  / Step from idle — judge their class on a CURRENT controller read before
  the queue (the early reason) AND inside EVERY write's own thread, after
  every wait of their own (`_cmd_blocking`'s `admit`, a STAT poll in the
  thread): the switch and each command after it, for Unhome its teleop step
  and the unhome (`set_mode(…, admit=)`, `_manual_command`, `_gate_admit`).
  A start's admit is the kinematics (BG-09) AND the start's class
  (`_start_admit`), at the switch to AUTO and at the start itself. A switch
  to MANUAL from an MDI that started since the snapshot would abort it
  (emcTaskSetMode → emcTaskAbort), and a homing or a move since then must
  meet no switch. The start guard's skip-flag clear is part of the start
  (BG-32): a running interpreter by a current read refuses before its switch
  to MDI, and its switch and its `#3116=0` MDI line are admitted at their
  writes (`_interp_idle_refusal`, also on `_apply_probe_vars`' MDI half); a
  refusal leaves the flag unknown. One gap named: the var-file half of the
  clear precedes the switch — a start inside that wait leaves the file
  written and the flag unknown (the file is read only at LinuxCNC's start).
  The resume from a real pause is no start from idle and takes none of this.
  **Boundary at D's agreement (R218), closed in package E:** the other
  handlers with their own switch refused a running AUTO / MDI only on a
  fresh poll before the queue; since E every `set_mode` write is admitted in
  its thread only onto an interpreter KNOWN idle, and the jog stops send no
  switch at all (see package E). The display may
  still lag a poll (a moment too strict or too open); the commands above
  never act on it. A write refused at its admit raises `_WriteRefused` (a
  PermissionError: the dispatcher's reply says why). Three controller reads,
  three strictnesses:

  | Helper | Used by | A field the poll lacks | Why |
  |---|---|---|---|
  | `_controller_gate_refusal` | `set_mode`, the manual spindle, Home / Unhome, Cycle Start / Step from idle — before the queue and at each write | unknown → the gate refuses; never the snapshot's | the gateway's own switch must not act on an old favourable value (R216 / R217) |
  | `_controller_capture_state` | G30 Capture's take-over | interp: the snapshot's; frame and motion: unknown | agreed R25–R27 (OP-I02): the frame and the standstill decide what the numbers mean |
  | `_controller_touchoff_state` | touch-off target | the snapshot's value | refreshes the fixture and frame where the controller offers them (R-02); a non-switchable machine has no frame pin |

  Power is the stricter of the poll and the snapshot (which carries the HAL
  safety chain); a failed poll refuses ("Machine status not read — try
  again"). The interpreter, homed and homing derivations are ONE pure rule
  for the snapshot and the current read (`status_runtime.interp_terms`,
  `homed_of`, `homing_active_of`).

### Package E — jogging before homing, the jog-stop contract, every mode write onto an idle interpreter (button gates BG-07; Codex R218; operator E1–E3)

- *The stop contract* (Codex R218): `jog_stop`, `jog_stop_multi` and the
  disarm stop (`_jog_stop_for_client`) send `JOG_STOP` in whatever mode task
  is in — no switch to MANUAL. Task 2.9.4 issues a jog stop in MANUAL, in
  MDI whatever the interpreter does, and in AUTO idle (emctaskmain.cc,
  `allow_while_idle_type`); in joint mode it stops only that joint's free
  planner, never a coordinated move (motion command.c `EMCMOT_JOG_ABORT`; it
  does cancel that joint's homing, as before). The old switch could abort a
  fresh MDI, and refused it would have suppressed the stop. AUTO running:
  nothing sent (task refuses a jog stop there; no jog can run). Each jog is
  booked with the (joint flag, CMD.jog index) it was STARTED with
  (`_active_jogs`), the stop addresses exactly that (`_send_jog_stop`), and
  the jog counts as stopped only once its stop was written — a failed write
  keeps it booked and the reply says so; the disarm stop still stops the
  others.
- *Every mode write onto an idle interpreter* (closes D's boundary):
  `set_mode` admits each switch in its write thread after the caller's own
  admit (whose reason is the more specific one) only onto an interpreter
  KNOWN idle (`_interp_idle_refusal`) — a switch aborts a running MDI or
  program, and every caller switches from idle. A refusal raises
  `_WriteRefused`; the background fixture heal and the RFL sequence catch it
  as a failure, the handlers reply with the reason.
- *Jogging before homing* (BG-07; operator E1/E2, 2026-10-28):
  `[DISPLAY] WEBUI_JOINT_JOG_BEFORE_HOMING = 1` (exactly "1", default off,
  an invalid value traced) opens `jog` before homing:
  `jog = base + idle + (homed OR joint_jog_before_homing)`. Which joint an
  axis moves comes from a DECLARED joint order — `[DISPLAY]
  WEBUI_JOINT_AXES` (each joint's letter in joint order), else trivkins'
  `coordinates=`; never the axis-list index guessed as a joint number
  (`gateway_util.joint_jog_map`, pure). A letter two joints carry (a gantry)
  is closed, as is an axis without a joint or a `[JOINT_n] MAX_VELOCITY`; a
  count or letter mismatch closes the whole map. Unhomed jog limits are
  `pos ± full travel` (motion `refresh_jog_limits`): only the limit switches
  protect — so the speed is capped at `WEBUI_JOINT_JOG_MAX_FRACTION`
  (default 0.1; 0 < f ≤ 1, an invalid value switches the jog OFF) × the
  joint's MAX_VELOCITY, sign kept, traced `jog.capped`. Partially homed is
  before homing (joint mode; the cap on every joint — over-strict for the
  homed ones, which their soft limits protect). The four jog commands share
  `_start_jogs`: the `jog` class on a current read before the queue and
  inside every write's thread (the switch and each jog); a closed axis
  refuses the whole command, nothing sent. Each write also holds the homing
  state the command was PREPARED under — its target, gantry closure and cap
  belong to it (Codex R219 BG-33): homed or not changed since (an unread
  state counts as not homed), the write refuses "Homing state changed — jog
  again", for every axis of a multi-jog too. A jog is booked in the write's
  own thread right after `CMD.jog` returned (`_cmd_blocking`'s `written`),
  so a cancel during the write — a disconnect — never loses it and the
  disconnect stop reaches it (BG-34); a refused or failed write books
  nothing. `_cmd_blocking` waits for its write's END through every cancel,
  a second one too (the abort preemption, then the disconnect — Codex
  R220): the command lock, and with it the disconnect stop, comes only after
  the write and its booking (`_thread_to_end(on_cancel=)`). No NEW jog while homing runs: `jog` requires the homing state
  known and no joint homing (BG-35; motion rejects a jog then, command.c
  v2.9.4:785/853, and a booked jog's stop would cancel the homing); the
  stops stay open. `_jog_axis_arg` uses the
  declared order for any joint jog (also the homed beyond-limit one);
  without a declaration index = joint stays — true on every shipped
  profile.
- *The client* (operator E3 as revised 2026-10-28): `jointJog.ts` reads
  `viewer_init.ini_config.joint_jog`; the strip dims a closed axis and every
  diagonal that moves it with the gateway's reason, and its head says
  "Joint jog — no soft limits · max 10 %" in its own line (cut with an
  ellipsis in the narrow portrait strip, the whole in the title). The
  buttons keep their axis letters — the operator dropped joint names on the
  buttons ("J2·Z+" widened the Z and rotary buttons; no other UI names them
  there). The keyboard and the gamepad refuse a closed axis by the same
  rule (`jogAxisRefusal`); a stop is never refused. **Package F (operator
  2026-10-28):** each jog button marks the joint it moves in its corner
  ("J0", the global `.cornerLabel`, `jogAxisJoint`; aria-hidden — the name
  stays the axis, the button's description says "Joint 0" for assistive
  technology, Codex R222 BG-37), never changing its size; AXIS and gmoccapy name the
  joints by number before homing too. Before homing every direction button
  jogs in amber (the `warn` variant; red stays the stops'), and the
  diagonals are closed: a multi-jog starts two joints at once — no single
  joint, like a coordinated move — so the gateway refuses it there
  ("Diagonal jog after Home All", after each axis' own closure) and the
  strip dims the four diagonals with that reason (`jogDiagonalRefusal`).
  Two keys or a slanted stick still start two separate jogs, each capped —
  as in AXIS and gmoccapy (neither has diagonals in joint mode, neither
  blocks simultaneous jogs; Probe Basic sends axis jogs only).
- *Named limits*: no gantry sim config exists — the gantry closure is
  proven by the pure map's tests only.

### Switchable suite functions (settings split package 3, plan R335–R337)

A machine section `features` (`lcnc-gateway/features.py`, the client's
`features.ts`): probing, toolsetter, surfaceMap, camera, macros, gamepad —
each ON unless the server holds it OFF. Off is the suite's OPERATING
function (operator OP2): its controls leave the UI, and the gateway refuses
what it would start. Free MDI, programs, the remaps and other LinuxCNC
clients are general NC paths, never searched for an M600 or an O-call — the
named exception, an older page's `mdi` with `vars` included (R336).

- **What a switch refuses** (`_command_feature_refusal`, at the dispatch,
  under `_cmd_lock`): the recognisable jobs (`features.COMMAND_FEATURES` —
  `probe_run`, `surface_scan_run`, `set_compensation_method`, `tool_measure`,
  `tool_unload_measure`, `run_macro`), a parameter write by its purposes
  (`set_params {sets: {purpose: vars}}`: probe / surface / toolsetter — each
  set its purpose's own, a number two sets share one value, every purpose's
  switch on — else refused whole before the first write; several purposes are
  ONE command, so an abort preempts all of it — Codex R344 SS-I10), the compensation
  switched ON (OFF is always admitted), run from line's pre-measurement
  (`auto_run` with `pre_tool`), and every command the gamepad sends
  (`via: "gamepad"` — the key is not R336's `source`: `auto_run.source` is the
  program text's fingerprint) but its stops (`_WS_STOP_CMDS`). The routes
  (`features.ROUTE_FEATURES`): the macro writes at their commit
  (`_macro_write_gate`), the camera's stream and status — every open stream
  ends when the switch goes off, with a next frame or without one: the
  broker's epoch ends after the features commit (`_camera_switched_off` →
  `CameraBroker.end_epoch`: waiting streams wake and end, producer and device
  go at once; the route reads the epoch BEFORE the switch, so a subscription
  in between is refused — Codex R343 SS-I11; a stream's leave is bound to
  its epoch, so an old one ending late never counts out a newer viewer, and a
  save cancelled after its commit still runs the hook — R344). A program start's toolsetter sync is skipped with
  the toolsetter off (its note says `off`).
- **Checked at the write too**: a job's `admit` (each vars chunk, the mode
  switch, the line) re-reads its switch, its toolsetter basis and the idle
  interpreter — a switch that went off between the dispatch and the write
  stops the line (`test_feature_switches.TestTheJobs`).
- **The jobs**: `probe_run {routine, vars}` — the routine one of the
  subroutine path's `probe_*` files; a routine that reads no panel values
  (`PARAMLESS_PROBE_ROUTINES`: `probe_cal_reset`) takes exactly an empty set
  (R343 SS-I08); `surface_scan_run {vars}`;
  `tool_measure {tool}` / `tool_unload_measure` — the values the SERVER's
  confirmed toolsetter section (`_toolsetter_basis`, P2), never the page's;
  not set up, nothing starts. Each carries the `#3116` clear like every
  routine the WebUI starts. The normal tool change (`tool_change`, M6 G43)
  is tool handling and stays with the toolsetter off.
- **A change of the switches** (`_machine_state_admission`, the store's
  `admit_state(before, after)` inside its lock, the save under `_source_lock`
  — never in the WS reader, a program upload may hold that lock): the whole
  `sourceWrite` rule (an armed writer, no start claim, no run from line, no
  load, a KNOWN idle interpreter), no command holding `_cmd_lock` (a command
  reads its switch under it — one taking the lock after this read waits for
  the store and reads the new value), no jog booked, the machine standing
  (`motion_still_of`; unknown refuses); switching the surface map OFF needs
  the compensation known off on a fresh reader. The one cross-section rule
  (`features.conflict`, every machine save): the toolsetter off with tool
  change M600 is no state — a `features` save names "choose another tool
  change mode first", a `machine` save "turn the toolsetter on first".
  Nothing here sends a machine command; switching ON switches nothing on.
- **Named limits**: a command from a page older than the `via` key is not
  recognisable as the gamepad's; free MDI can start every routine a switch
  hides. The inventory's `feature` dimension holds the tables: every claim
  of a switched function has a role (switched / variant / readable / stays /
  helper), a command or route marked switched is the gateway's under that
  switch, and every one the gateway switches is claimed so
  (`functions.feature_problems`).

### The connection: one Link (package 2b, plan vor-maschine R352/R353 VM352-02)

- **What it replaced.** The gateway held its connection in three nullable
  globals `STAT` / `CMD` / `ERR` plus a separate `lcnc_connected` flag. They
  drifted apart (an ended instance cleared only the flag; the WS endpoint
  "restored" the flag by polling channels the poller had given up), and a
  write read them at each step: Codex R352's probe saw a replacement between
  the queue and the thread make the admission poll the NEW status, the write
  go to the OLD channel and the start claim book the NEW channel's serial.
- **The Link.** `Link(stat, cmd, err, pid, seq)`, frozen, identity is the
  object. `try_connect_lcnc` prepares the channel set in locals, polls,
  identifies the instance, decides the binding and only then publishes it
  (`_publish_link`) — one step; a failure on the way publishes nothing and
  revokes the old Link. Every loss (5 failed status cycles, the instance check,
  the instance end, a refused rebind) is ONE `_revoke_link(reason)`, traced
  (`lcnc.link_published` / `lcnc.link_revoked`). "Connected" = a Link is
  published; `lcnc_connected` is gone.
- **A write belongs to its Link.** `_cmd_blocking(conn, op(...), wait=,
  claim=, admit=, written=)`: in the write's own thread the Link must be the
  published one BEFORE the admission and AFTER it (a Link is published once,
  so an admission that read the controller through the published Link read
  THIS one); the write, the serial the start claim books and every wait slice
  go to `conn`. A write whose Link changed is refused with `LINK_CHANGED`
  ("Connection to LinuxCNC changed — try again") before it reaches either
  channel — the claim and the run basis `unsent`, also when the admission
  itself raises — and is never redirected. A wait already running stays on
  its Link: the new channel never answers for the old write.
- **One Link per command** (Fable, R359). `handle_command` pins the
  published Link for the command's whole run (`_command_link`, a ContextVar —
  the tasks a command starts, the run-from-line sequence among them, inherit
  it): `link()` inside answers that Link, or `NotConnected(LINK_CHANGED)`
  once it is no longer the published one; `current_link()` / `_stat_now()`
  answer None then. A command never continues on a new Link with what it read
  from the old one.
- **A stop on a changed Link** is refused like any write (it used to go out on
  the stale channel through the bound method); the next press goes out on
  the new Link. The HAL chain stays the safety stop.
- **A start claim keeps its Link** (`link_seq`): its serial is that
  channel's. A claim of an earlier Link is never compared with this Link's
  echo — the controller QUIET (idle, done or error, nothing queued, the exec
  done), held for the error proof's window, releases it (`proof=relinked`);
  a new Link exists only seconds after the old one failed, long after task
  took the write. How libnml numbers a fresh channel's serials is outside the
  binding and is not relied on.
- **One connect at a time.** `try_connect_lcnc` runs under `_connect_lock`
  (the WS endpoint and the poller may both connect, each in a thread); a
  failing attempt revokes only the Link it found when it began.
- **The connect's ends** (Codex R359 VM-I07): a failed NML pre-check revokes
  the Link the attempt found (LinuxCNC is not reachable); the bound
  instance's end and every publish decide under `_link_lock` — `_on_instance_ended`
  sets `_instance_ended` and revokes in one step, `_publish_link` refuses
  (`lcnc.link_publish_refused`) once it is set: a connect that began before
  the end never publishes after it.
- **The mode switch reads its own Link** (VM-I05): `set_mode` polls and reads
  `task_mode` (and the diagnosis) on the Link it writes to; before the early
  return ("already there", which clears the jog booking) and before it
  confirms a switch, a Link replaced meanwhile is `LINK_CHANGED` — a new
  Link's status never confirms the old Link's switch.
- **Multi-step commands** (VM-I06): the pin per command (above) makes every
  later step of a command — the MDI after its mode switch, `G43` after `M6` —
  `LINK_CHANGED` once the Link changed; what went out stays booked. The
  dispatch answers `NotConnected` in its own words.
- **`op()`.** `op(linuxcnc.command.jog, linuxcnc.JOG_STOP, jf, axis)` — the
  binding CLASS's method (its run-time `__name__` is the command; the
  Protocol's overloads have none) and its positional arguments; a name
  outside `lcnc_iface.COMMAND_METHODS` or a keyword is refused. The type check
  holds each call to the binding's overloads (ParamSpec): the call forms of
  package 2a reach every gateway call site. `_start_kind(name, args)` reads
  the op — the start claim, the run basis and the toolsetter booking hang on
  it (Codex R353 build note 1).
- **`_link_lock`.** A `threading.Lock` held only for a reference compare or
  swap — never across a poll, an NML call or an await, so neither the event
  loop nor a write thread waits on it for longer than an assignment (a test
  asserts it is free during the write and the wait). Order: `_cmd_lock`
  (asyncio, a whole command) → `_link_lock` (a moment). Codex R353 build
  note 2.
- **Reads.** `link()` (raises `NotConnected`) where the connection is needed;
  `current_link()` / `_stat_now()` / `_cmd_now()` / `_err_now()` where none is
  tolerated (a status read answers "unknown") — the old globals' exact
  semantics, chosen per site by the type check (an Optional member access was
  an AttributeError without a connection).
- **`NotConnected` per entry path** (not a RuntimeError — the WS reader takes
  those as a client disconnect): a WS command answers "LinuxCNC not
  connected" (dispatched without a Link, or the Link revoked while it ran —
  `ws.command_not_connected`); an HTTP route answers 503
  (`rest.not_connected`, registered with `app.add_exception_handler`); the
  disconnect and hb-stall jog stops trace it by name
  (`safety.*_jog_stop_failed exc=NotConnected`); the poller reconnects.
- **Tests.** One seam, `lcnc-gateway/link_fixture.py`: `connect_fake`,
  `use` / `using`, `disconnect` / `without_connection`, `swap_connection`,
  `restore_after`, `current()`, `is_connected()` — every test restores the
  whole connection state; `conftest.py` FAILS a test that leaves the
  published Link changed, and in the test session the host's `/proc` never
  yields a LinuxCNC instance and the host's NML never answers
  (`_nml_connectable`, a subprocess with the real binding) — a live sim on
  the dev box made the gateway connect at import: eight tests passed on it
  there and failed on CI. A test that needs a connection installs its own
  (`armed_writer` refuses without one). `test_link_ownership.py` holds the R352 probe as
  acceptance (a replacement before the thread refuses the write; during the
  wait every slice stays on the old Link) and the contracts above.

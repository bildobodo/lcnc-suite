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
  taken; the commanded speed entered again is no draft);
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
  Files toggles, the library Upload and Preview again are `fileBrowse`
  (always): the preview reads, applying is `toolTableWrite`.
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

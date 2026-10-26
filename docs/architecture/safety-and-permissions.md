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
  else returns False, nothing written — R208); a
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

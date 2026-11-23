"""The lifetime of a calculation (P2b-3, plan v4 — Codex R439–R442).

Pure bookkeeping, no LinuxCNC and no asyncio: the gateway drives it.

Two separate things decide whether an idle parse may publish and when the
next one may start:

- the GENERATION (`Generation`): the program generation (every load and
  unload is a new one) and the input generation (every input write's BEGIN,
  right before its first possible effect — in the write's own thread, after
  its last admission and Link check). A parse takes its snapshot before it
  reads its first input; it publishes only when the snapshot is still the
  current generation, checked and applied under ONE `threading.Lock` in one
  step (no await, no I/O inside). Either the publication lies wholly before a
  write's begin (it is then valid for the inputs before it; the write's effect
  raises its drift afterwards) or it is discarded.
- the ACTION (`ActionLedger`): an admitted input action waiting in a client's
  queue or running in its handler HOLDS a new idle parse (queue ownership)
  without invalidating anything; its writes' observers own it past the
  handler's return (a CALL written with wait=None answers `ok` long before the
  routine ends) until each ends through the ONE completion decision
  (`gateway_util.controller_done`) or a named unknown outcome. The idle parse
  restarts only when no action is held and no observer lives, and the
  debounce counts from the OBSERVED end.

Outcomes of an action: refused_before_write (nothing written: the preview
stays valid, only the hold ends), done, error, partial (the handler ended
without finishing after a write), aborted, link_lost, unknown. A restart after
partial / aborted / link_lost / unknown reads the basis again or names it
unknown (the caller's)."""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

#: the action outcomes, in the order a combined outcome prefers them
OUTCOMES = ("aborted", "link_lost", "unknown", "partial", "error", "done", "refused_before_write")

#: how long an observer may wait for its proof before its outcome is
#: `unknown` (named per class; a routine generously — a probing move may run
#: for minutes)
OBSERVER_LIMIT_S = {"routine": 900.0, "mdi": 300.0, "mode": 30.0, "synch": 30.0, "tool_table": 30.0,
                    "file": 300.0}

#: an MDI line that runs a routine: an O-word call, M600, M6
_ROUTINE_LINE = re.compile(r"(?i)\bcall\b|\bm0*600\b|\bm0*6\b")

# the controller's task modes (linuxcnc.MODE_*) — the caller passes its own
MODE_MANUAL, MODE_AUTO, MODE_MDI = 1, 2, 3


def input_write_class(name: str, args: Tuple[Any, ...], modes: Optional[Dict[str, int]] = None) -> Optional[str]:
    """The observer class of a controller write that changes a parse input,
    or None (P2b-3 "Klassifikation nach Wirkung", Codex R440 Rest B): every
    MDI line; a mode switch whose TARGET is MDI or AUTO (task synchs the
    interpreter's parameters into the file on that switch — MANUAL does not);
    the parameter synch itself; a tool table reload. Pure.

    A program START (`auto` RUN/STEP/RESUME) is no input write here: the
    running program's own writes are the pinned parse's (the AUTO exception);
    its preceding switch to AUTO is classified as a mode switch."""
    m = modes or {}
    if name == "mdi":
        # a routine (an O-word CALL, the toolsetter's M600, a tool change):
        # its proof may take minutes — the generous class (plan v4)
        text = str(args[0]) if args else ""
        return "routine" if _ROUTINE_LINE.search(text) else "mdi"
    if name == "mode":
        target = args[0] if args else None
        return "mode" if target in (m.get("MODE_MDI", MODE_MDI), m.get("MODE_AUTO", MODE_AUTO)) else None
    if name == "task_plan_synch":
        return "synch"
    if name == "load_tool_table":
        return "tool_table"
    return None


class Generation:
    """The parse inputs' generation (program, inputs) under ONE threading.Lock.

    `began()` is called in the WRITE's thread right before the effect; the
    publication runs `publish_if()` on the event loop. The lock is held only
    for the counter and the publication's field assignments — never across an
    admission, a write, an await or I/O."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._program = 0
        self._inputs = 0
        self._last_why: Optional[str] = None

    def snapshot(self) -> Tuple[int, int]:
        with self._lock:
            return (self._program, self._inputs)

    def began(self, why: str) -> Tuple[int, int]:
        """An input write begins: every parse snapshotted before loses its
        right to publish. Returns the new generation."""
        with self._lock:
            self._inputs += 1
            self._last_why = why
            return (self._program, self._inputs)

    def new_program(self, why: str) -> Tuple[int, int]:
        """A load or an unload: a new program generation (A→B→A and the same
        path loaded again are new generations too)."""
        with self._lock:
            self._program += 1
            self._last_why = why
            return (self._program, self._inputs)

    def last_why(self) -> Optional[str]:
        """The last begin's or program change's reason."""
        with self._lock:
            return self._last_why

    def publish_if(self, snap: Tuple[int, int], apply: Callable[[], None]) -> Tuple[bool, Tuple[int, int], Optional[str]]:
        """Apply the publication when `snap` is still the current generation —
        checked and applied in ONE step under the lock. (applied, now, the
        last begin's reason). `apply` assigns fields only: no await, no I/O."""
        with self._lock:
            now = (self._program, self._inputs)
            if now != snap:
                return False, now, self._last_why
            apply()
            return True, now, None


def inflight_outdated(inflight_gen: Optional[Tuple[int, int]], now: Tuple[int, int]) -> bool:
    """Is a RUNNING parse of an older generation (P2b-3)? Its publication is
    banned already (publish_if); its process is ended too — its load on the
    machine is the point (a parse without a recorded generation: no)."""
    return inflight_gen is not None and tuple(inflight_gen) != tuple(now)


class Observer:
    """One controller write of an input action: pending from the begin hook
    (before the write — its serial is NOT the buffer's serial before the
    write), sent once the write returned with the serial the NML buffer
    actually gave it, ended with an outcome."""
    __slots__ = ("klass", "what", "state", "serial", "sent_t", "link_seq", "err_since", "err_proof",
                 "t", "limit_s", "mode_target", "outcome", "action", "write_failed")

    def __init__(self, klass: str, what: str, t: float, limit_s: float, mode_target: Optional[int],
                 action: Optional["Action"]) -> None:
        self.klass = klass
        self.what = what
        self.state = "pending"
        self.serial: Optional[int] = None
        self.sent_t: Optional[float] = None
        self.link_seq: Optional[int] = None
        self.err_since: Optional[float] = None
        self.err_proof: Optional[tuple] = None
        self.t = t
        self.limit_s = limit_s
        self.mode_target = mode_target
        self.outcome: Optional[str] = None
        self.action = action
        self.write_failed = False

    def as_obs(self) -> Dict[str, Any]:
        return {"state": self.state, "serial": self.serial, "sent_t": self.sent_t, "link_seq": self.link_seq,
                "err_since": self.err_since, "err_proof": self.err_proof}


class Action:
    """One input action: held from admission (queued or in its handler) to
    its handler's end, owned by its observers past that."""
    __slots__ = ("token", "what", "client", "t", "held", "handler", "observers", "outcome", "end_t")

    def __init__(self, token: int, what: str, client: Optional[str], t: float, held: bool) -> None:
        self.token = token
        self.what = what
        self.client = client
        self.t = t
        self.held = held                     # queue ownership: holds a new idle parse
        self.handler: Optional[str] = None   # how the handler ended: ok / refused / error / cancelled
        self.observers: List[Observer] = []
        self.outcome: Optional[str] = None
        self.end_t: Optional[float] = None


def combined_outcome(handler: Optional[str], observers: List[Observer]) -> str:
    """The action's outcome from its handler's end and its observers'. No
    write → refused_before_write (nothing was invalidated); a named unknown
    outcome of any write wins; a handler that did not finish after a write →
    partial; else the writes' own (error over done)."""
    written = [o for o in observers if o.state != "refused"]
    if not written:
        return "refused_before_write"
    outs = {o.outcome for o in written}
    for name in ("aborted", "link_lost", "unknown"):
        if name in outs:
            return name
    if handler not in (None, "ok"):
        return "partial"
    if "error" in outs:
        return "error"
    return "done"


class ActionLedger:
    """Queue ownership and the actions' observers (P2b-3). Thread-safe: the
    begin hook and the sent mark run in write threads, the rest on the loop."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._lock = threading.Lock()
        self._clock = clock
        self._seq = 0
        self._actions: Dict[int, Action] = {}
        self.last_end: Optional[float] = None    # the last OBSERVED end of an action that wrote
        self._ended: List[Action] = []           # ended since the last take_ended()

    # ── queue ownership ──
    def hold(self, what: str, client: Optional[str] = None) -> Action:
        """An admitted input action entered a queue: it holds a new idle parse."""
        with self._lock:
            self._seq += 1
            a = Action(self._seq, what, client, self._clock(), held=True)
            self._actions[a.token] = a
            return a

    def internal(self, what: str) -> Action:
        """An action of the gateway's own (a read-back, a start's sync, a
        heal): no queue, its observers alone own it — ended by release()."""
        with self._lock:
            self._seq += 1
            a = Action(self._seq, what, None, self._clock(), held=True)
            self._actions[a.token] = a
            return a

    def release(self, action: Action, handler: str) -> None:
        """The action's handler ended (ok / refused / error / cancelled) or its
        queued job was dropped (superseded, preempted, disconnect): the queue
        ownership ends; its observers own it on. Idempotent."""
        with self._lock:
            if not action.held:
                return
            action.held = False
            if action.handler is None:
                action.handler = handler
            self._settle(action)

    def stopped_short(self, action: Optional[Action]) -> None:
        """The handler stops before its action is complete (a refusal after
        a write, chunks not all taken): ended so, its outcome is `partial`
        once it wrote — whatever its observers prove."""
        if action is None:
            return
        with self._lock:
            if action.handler is None:
                action.handler = "stopped"

    # ── the writes ──
    def begin(self, action: Optional[Action], klass: str, what: str, mode_target: Optional[int] = None) -> Observer:
        """The begin hook's observer — PENDING, created before the write.
        Without an action (a write outside every booked action) one of its
        own is opened and settled with the observer."""
        with self._lock:
            if action is None:
                self._seq += 1
                action = Action(self._seq, what, None, self._clock(), held=False)
                self._actions[action.token] = action
            o = Observer(klass, what, self._clock(), OBSERVER_LIMIT_S.get(klass, 300.0), mode_target, action)
            action.observers.append(o)
            return o

    def sent(self, o: Observer, serial: Optional[int], link_seq: Optional[int]) -> None:
        """The write returned: the serial the NML buffer gave it, the Link."""
        with self._lock:
            if o.outcome is not None:
                return
            o.serial, o.link_seq, o.sent_t, o.state = serial, link_seq, self._clock(), "sent"

    def refused(self, o: Observer) -> None:
        """The write never happened (admission or Link refused before it):
        the observer is dropped — nothing written, nothing to observe."""
        with self._lock:
            if o.outcome is not None:
                return
            o.state, o.outcome = "refused", "refused_before_write"
            if o.action is not None:
                self._settle(o.action)

    def wrote_file(self, action: Optional[Action], what: str) -> None:
        """A FILE writer's effect (the tool table, the parameter file, a
        program or macro file) — complete when its call returned: booked as a
        write that ended `done`, so the action counts as one that wrote (its
        end starts the debounce). Without an action the end is now."""
        with self._lock:
            o = Observer("file", what, self._clock(), 0.0, None, action)
            o.state, o.outcome = "file", "done"
            if action is None:
                self.last_end = self._clock()
                return
            action.observers.append(o)
            self._settle(action)

    def begin_file(self, action: Optional[Action], what: str) -> Observer:
        """A FILE writer's effect begins (Codex R446 MT-I25): a PENDING
        observer — of the running action, else of an action of its own (an
        HTTP writer has no queue hold) — ended only at the writer's ACTUAL
        end (end_file). Past its limit it is named once (`action.file_overdue`)
        and keeps holding until that end (Codex R447/R448); a controller
        abort (end_all) never ends it. The 2 s quiet and the next drift
        decision start at that end, never at the begin."""
        with self._lock:
            if action is None:
                self._seq += 1
                action = Action(self._seq, what, None, self._clock(), held=False)
                self._actions[action.token] = action
            o = Observer("file", what, self._clock(), OBSERVER_LIMIT_S["file"], None, action)
            o.state = "file"
            action.observers.append(o)
            return o

    def end_file(self, o: Observer, outcome: str) -> None:
        """The file writer's actual end: `done` when it returned, `unknown`
        when it raised or was cut (its effect not known)."""
        with self._lock:
            if o.outcome is not None:
                return
            o.outcome = outcome
            if o.action is not None:
                self._settle(o.action)

    def failed(self, o: Observer) -> None:
        """The write call itself raised: its effect is UNKNOWN — the observer
        stays pending until its limit names it `unknown` (never "not written")."""
        with self._lock:
            o.write_failed = True

    # ── the ends ──
    def decide(self, fields: Dict[str, Any], polled_at: float, owner_seq: int, proof_window_s: float,
               done: Callable[..., Tuple[Optional[str], Tuple[Optional[float], Optional[tuple]]]],
               consts: Optional[dict] = None, now: Optional[float] = None) -> List[tuple]:
        """What ONE poll of the Link `owner_seq` proves for every live
        observer — computed, not applied: [(observer, outcome | None, mark)].
        `done` is gateway_util.controller_done. A mode switch's `done` also
        needs the task in its target mode (`fields["task_mode"]`), else it is
        `unknown`; `relinked` is `link_lost`; past its limit `unknown`."""
        t = self._clock() if now is None else now
        with self._lock:
            live = [o for a in self._actions.values() for o in a.observers if o.outcome is None]
        out = []
        for o in live:
            if o.state == "file":
                # a file writer still running (Codex R447 MT-I25 A): only its
                # ACTUAL end ends it — never a limit (overdue_files names
                # one past it), never a controller proof
                out.append((o, None, (o.err_since, o.err_proof)))
                continue
            if o.state == "pending":
                # a write not returned yet: no controller proof ends it — its
                # limit names it unknown
                out.append((o, "unknown" if t - o.t >= o.limit_s else None, (o.err_since, o.err_proof)))
                continue
            if o.mode_target is not None and o.link_seq == owner_seq:
                # a mode switch (plan v4 "set_mode"): task handled it — its
                # echo reached the switch's serial on a poll begun after the
                # write — and the task is in the target mode; handled but in
                # another mode is unknown. No idle needed: a program the
                # switch preceded may run long past it.
                echo, tm = fields.get("echo"), fields.get("task_mode")
                seen = (o.sent_t is not None and o.sent_t < polled_at and o.serial is not None
                        and echo is not None and echo >= o.serial)
                how = (("done" if tm == o.mode_target else "unknown") if seen and tm is not None else None)
                mark = (o.err_since, o.err_proof)
            else:
                how, mark = done(fields, o.as_obs(), polled_at, owner_seq, proof_window_s, consts)
            if how == "relinked":
                how = "link_lost"
            if how is None and t - o.t >= o.limit_s:
                how = "unknown"
            out.append((o, how, mark))
        return out

    def apply(self, decisions: List[tuple]) -> None:
        """Apply what decide() proved — the caller only while the polled Link
        is still the published one."""
        with self._lock:
            for o, how, (since, proof) in decisions:
                if o.outcome is not None:
                    continue
                if how is None:
                    o.err_since, o.err_proof = since, proof
                    continue
                o.outcome = how
                if o.action is not None:
                    self._settle(o.action)

    def end_all(self, outcome: str) -> int:
        """Abort / E-Stop: every live CONTROLLER observer ends `aborted`
        (task flushed its queues — no proof follows). A file writer is no
        controller work: it runs on to its own end (Codex R447 MT-I25 A).
        The number ended."""
        n = 0
        with self._lock:
            for a in list(self._actions.values()):
                for o in a.observers:
                    if o.outcome is None and o.state != "file":
                        o.outcome = outcome
                        n += 1
                self._settle(a)
        return n

    def overdue_files(self, now: Optional[float] = None) -> List[Observer]:
        """File writers past their limit, each returned ONCE — to be named;
        they stay live (their owner still writes) until their actual end."""
        t = self._clock() if now is None else now
        out = []
        with self._lock:
            for a in self._actions.values():
                for o in a.observers:
                    if o.state == "file" and o.outcome is None and t - o.t >= o.limit_s and not o.write_failed:
                        o.write_failed = True   # (the flag reused: said once)
                        out.append(o)
        return out

    def _settle(self, a: Action) -> None:
        # under self._lock
        if a.outcome is not None or a.held or any(o.outcome is None for o in a.observers):
            return
        a.outcome = combined_outcome(a.handler, a.observers)
        a.end_t = self._clock()
        if a.outcome != "refused_before_write":
            self.last_end = a.end_t
        self._actions.pop(a.token, None)
        self._ended.append(a)

    # ── the parse's view ──
    def busy(self) -> Optional[str]:
        """Why a new idle parse waits for an action (None: none): a held
        action or a live observer, all clients."""
        with self._lock:
            for a in self._actions.values():
                if a.held:
                    return f"held:{a.what}"
                if any(o.outcome is None for o in a.observers):
                    return f"observed:{a.what}"
        return None

    def quiet_s(self, now: Optional[float] = None) -> Optional[float]:
        """Seconds since the last observed end of an action that wrote (None:
        an action is still open; inf: none ever ended)."""
        if self.busy() is not None:
            return None
        t = self._clock() if now is None else now
        return float("inf") if self.last_end is None else t - self.last_end

    def take_ended(self) -> List[Action]:
        with self._lock:
            out, self._ended = self._ended, []
        return out

    def live_count(self) -> int:
        with self._lock:
            return len(self._actions)

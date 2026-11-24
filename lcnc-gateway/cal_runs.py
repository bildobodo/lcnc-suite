"""The probe calibration's runs, their candidate and the run token
(P5-1, plan v6 — Codex R439–R444). Pure but for the counter file: no
LinuxCNC, no asyncio; the gateway drives it.

A calibration run is named by a TOKEN the gateway reserves before the call:
`O<probe_cal_…> CALL [token]` carries it into the bundled routine (`#1014 =
#1`), and the routine's ONE result line brings it back —

    (DEBUG, LCNC_CAL_CANDIDATE run=#1014 value=#1013 axis=#3036)

A value without its token, or with another run's, is never a candidate: a
bare number cannot tell run A's late message from run B's result. The token
is a durable counter in the folder of the INI this LinuxCNC instance runs
with — reserved (written through to the disk) before anything goes to the
controller, never used twice, refused by name at its end.

What makes a run's value a CANDIDATE, all of it for the SAME token on the
SAME Link: the call was admitted and written; its start is proven (a poll
after the write with the echo at its serial and a busy interpreter, or the
result line itself); the result arrived, finite and ≥ 0; and the run ended
CLEANLY — the controller through with it (gateway_util.controller_done) and
the error channel then read until it was EMPTY, with no error in the run's
window and no abort, E-Stop or power off booked for it. Any other end offers
nothing, whatever value was reported before it. The active offset
(`probeCalibration`, settings_store) is never touched by a run."""
from __future__ import annotations

import json
import math
import os
import re
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Tuple, Union

from gateway_util import controller_done

#: the last token; `next` = MAX_RUN + 1 says "used up" and is never sent
MAX_RUN = 9_999_999
COUNTER_FILE = "lcnc-suite-cal-runs.json"

CAL_ROUTINES: FrozenSet[str] = frozenset({
    "probe_cal_round_pocket", "probe_cal_round_boss", "probe_cal_square_pocket", "probe_cal_square_boss"})

#: the routines' upstream form: a bare value, no token — never a candidate
OLD_RESULT = "calibration_offset_3032"
OLD_ROUTINE_WARNING = "Calibration routine is not the suite's — no result offered"
OLD_WARNING_KIND = 12    # OPERATOR_TEXT: a message, no machine error
NOT_SETTLED = "Earlier run not settled — wait and calibrate again"


class CounterError(Exception):
    """The run counter cannot give a token — the reason, named."""


# ---- the counter file ------------------------------------------------------

def _no_duplicates(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for k, v in pairs:
        if k in out:
            raise ValueError(f"{k} twice")
        out[k] = v
    return out


def _no_constant(name: str) -> Any:
    raise ValueError(f"{name} is no number")


def counter_next(text: Optional[str], ini: str, name: str = COUNTER_FILE) -> Optional[int]:
    """The next unused token of `ini` from the counter file's text — None
    without a file or without an entry of this INI (its initialisation: the
    caller has proven the error channel empty). Strict: one JSON object, the
    INI's entry an object with an INTEGER `next` in 1 … MAX_RUN+1 (no
    fraction, no string, no sign) — anything else is refused by name, never
    rounded and never read as 0. One entry per INI name: the shipped example
    keeps several profiles in ONE folder, and no run of one INI's instance
    can reach another's (a new LinuxCNC, a new error channel)."""
    if text is None:
        return None
    try:
        data = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
    except ValueError as e:
        raise CounterError(f"Calibration run counter unreadable — {name}: {e}") from e
    if not isinstance(data, dict):
        raise CounterError(f"Calibration run counter unreadable — {name}: not an object")
    if ini not in data:
        return None
    entry = data[ini]
    if not isinstance(entry, dict) or "next" not in entry:
        raise CounterError(f"Calibration run counter unreadable — {name}: {ini} has no next")
    nxt = entry["next"]
    if isinstance(nxt, bool) or not isinstance(nxt, int) or not 1 <= nxt <= MAX_RUN + 1:
        raise CounterError(f"Calibration run counter unreadable — {name}: next of {ini} is not 1 … {MAX_RUN + 1}")
    return nxt


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as e:
        raise CounterError(f"Calibration run counter unreadable — {os.path.basename(path)}: {type(e).__name__}") from e


def _write_through(path: str, data: Dict[str, Any]) -> None:
    """Atomic and on the disk: a file beside it, fsync, rename, fsync of the
    folder — a reserved token is never given out again by a power cut."""
    folder = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=f".{COUNTER_FILE}.", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(data, indent=1, sort_keys=True) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    dfd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


def reserve_run(path: str, ini: str, last_reserved: int, now: Optional[str] = None) -> Tuple[int, bool]:
    """(the token N, the INI's entry was made now). N = max(next, the last
    one this process reserved + 1); `next = N + 1` is on the disk BEFORE N
    is returned — a token reserved and never sent stays used. CounterError:
    unreadable, used up (before any write), or not written."""
    text = _read_text(path)
    nxt = counter_next(text, ini, os.path.basename(path))
    n = max(nxt if nxt is not None else 1, last_reserved + 1)
    if n > MAX_RUN:
        raise CounterError("Calibration run ids used up")
    data = json.loads(text) if text is not None else {}
    data[ini] = {"next": n + 1, "updated": now or datetime.now().isoformat(timespec="seconds")}
    try:
        _write_through(path, data)
    except OSError as e:
        raise CounterError(f"Calibration run id not reserved — {os.path.basename(path)}: {e.strerror or type(e).__name__}") from e
    return n, nxt is None


# ---- the result line -------------------------------------------------------

@dataclass(frozen=True)
class CandidateMsg:
    run: int
    value: float
    axis: int


_CANDIDATE_RE = re.compile(r"^\s*LCNC_CAL_CANDIDATE\b(.*)$", re.S)
_FIELDS_RE = re.compile(r"^\s+run=(\S+)\s+value=(\S+)\s+axis=(\S+)\s*$")
_INTEGER_RE = re.compile(r"^(\d{1,7})(?:\.0*)?$")


def _exact_int(text: str) -> Optional[int]:
    """The printed number as an exact integer (the interpreter prints a
    parameter `%lf`: 1234567.000000) — None for any other decimals."""
    m = _INTEGER_RE.match(text)
    return int(m.group(1)) if m else None


def parse_candidate(text: object) -> Union[CandidateMsg, str, None]:
    """A result line, why it is not one that counts (a string), or None for
    any other message. Never rounded: the token an exact integer in its
    range, the value finite and ≥ 0 (the routine prints an ABS), the axis
    0 (average), 1 (X) or 2 (Y)."""
    m = _CANDIDATE_RE.match(str(text))
    if m is None:
        return None
    f = _FIELDS_RE.match(m.group(1))
    if f is None:
        return "not run, value and axis"
    run, axis = _exact_int(f.group(1)), _exact_int(f.group(3))
    if run is None or not 1 <= run <= MAX_RUN:
        return f"run {f.group(1)[:24]} is no token"
    if axis not in (0, 1, 2):
        return f"axis {f.group(3)[:24]} is not 0, 1 or 2"
    try:
        value = float(f.group(2))
    except ValueError:
        return f"value {f.group(2)[:24]} is no number"
    if not math.isfinite(value) or value < 0:
        return f"value {f.group(2)[:24]} is no offset"
    return CandidateMsg(run, value, axis)


# ---- a run and its candidate -----------------------------------------------

#: why a run offers nothing (each reads after "Result not offered — ")
WHY_ABORT = "the run was aborted"
WHY_ESTOP = "E-Stop during the run"
WHY_OFF = "machine off during the run"
WHY_ERROR = "the run ended with an error"
WHY_LINK = "the LinuxCNC connection changed"
WHY_NOT_STARTED = "the run did not start"
WHY_NO_RESULT = "no result was reported"
WHY_BASE = "the active offset changed"
WHY_ROUTINE = "the routine is not the suite's"
WHY_UNKNOWN_SEND = "the start was not confirmed"

#: the controller's operator message kinds that are no error (LinuxCNC:
#: OPERATOR_TEXT 12, OPERATOR_DISPLAY 13, NML_TEXT 2, NML_DISPLAY 3)
NOT_ERRORS = frozenset({2, 3, 12, 13})


@dataclass
class CalRun:
    run: int
    routine: str
    starter: Optional[str]              # the starting connection's key
    link_seq: int
    basis: Dict[str, float]             # the canonical values as sent
    unit: str
    axis: int
    size: Dict[str, float]
    base_rev: int                       # the active record's revision at the start
    was: Optional[float]
    state: str = "pending"              # the call's write began → sent (returned)
    serial: Optional[int] = None
    sent_t: Optional[float] = None
    opened_t: float = 0.0
    started: bool = False
    result: Optional[float] = None
    fault: Optional[str] = None         # why this run offers nothing
    err_since: Optional[float] = None
    err_proof: Optional[tuple] = None

    def obs(self) -> Dict[str, Any]:
        return {"state": self.state, "serial": self.serial, "sent_t": self.sent_t, "link_seq": self.link_seq,
                "err_since": self.err_since, "err_proof": self.err_proof}


@dataclass
class Candidate:
    run: int
    value: Optional[float]      # None: the run reported none (it is stale)
    routine: str
    axis: int
    size: Dict[str, float]
    unit: str
    basis: Dict[str, float]
    was: Optional[float]
    base_rev: int
    link_seq: int
    starter: Optional[str]
    at: str
    state: str = "pending"      # pending / deciding / applied / discarded / stale / superseded
    why: Optional[str] = None

    def wire(self) -> Optional[Dict[str, Any]]:
        """What every client sees; a superseded one is gone."""
        if self.state == "superseded":
            return None
        return {"run": self.run, "value": self.value, "was": self.was, "routine": self.routine,
                "size": self.size or None, "axis": self.axis, "unit": self.unit, "at": self.at,
                "state": "pending" if self.state == "deciding" else self.state, "why": self.why}


def size_of(routine: str, basis: Dict[str, float]) -> Dict[str, float]:
    """The calibration's size basis as sent: the ring's diameter (#3033), or
    the block's X and Y (#3034, #3035)."""
    if "round" in routine:
        return {"d": basis["3033"]} if "3033" in basis else {}
    return {"x": basis["3034"], "y": basis["3035"]} if "3034" in basis and "3035" in basis else {}


@dataclass(frozen=True)
class Cycle:
    """One status cycle's facts, all of ONE Link: its STAT fields (the
    cycle's own poll, begun at `polled_at`), and what reading the error
    channel AFTER that poll proved: `drained` None = read until it was empty,
    else why not."""
    polled_at: float
    link_seq: Optional[int]
    fields: Dict[str, Any]
    estop: Optional[bool]
    enabled: Optional[bool]
    messages: Tuple[Tuple[int, str], ...] = ()
    drained: Optional[str] = None


def at_rest(fields: Dict[str, Any], consts: Optional[dict] = None) -> bool:
    """Nothing old left to run: RCS DONE, the interpreter idle, no queued
    MDI, the execution done — every field read (idle alone is not enough:
    after a gateway restart a queued MDI may still be in the controller)."""
    c = consts or {}
    return (fields.get("state") == c.get("RCS_DONE", 1) and fields.get("interp_state") == c.get("INTERP_IDLE", 1)
            and fields.get("queued") == 0 and fields.get("exec_state") == c.get("EXEC_DONE", 2))


class CalState:
    """The open run and the candidate (one machine, one of each). Every step
    is synchronous under one lock: the write threads' hooks (a call's begin,
    its return, an abort's begin), the status cycle, and the decisions —
    which hold the gateway's `_cal_lock` around their awaits."""

    def __init__(self, clock: Callable[[], float] = time.monotonic,
                 emit: Callable[..., None] = lambda *_a, **_k: None,
                 proof_window_s: float = 0.5, consts: Optional[dict] = None,
                 now: Callable[[], str] = lambda: datetime.now().isoformat(timespec="seconds"),
                 on_old_routine: Callable[[], None] = lambda: None) -> None:
        self._on_old_routine = on_old_routine
        self._lock = threading.RLock()
        self._clock = clock
        self._emit = emit
        self._window = proof_window_s
        self._consts = consts or {}
        self._now = now
        self.run: Optional[CalRun] = None
        self.candidate: Optional[Candidate] = None
        self.last_run = 0           # the last token a call was begun with
        self.version = 0

    def _changed(self) -> None:
        self.version += 1

    # ── the call's write (its thread) ──
    def call_began(self, run: CalRun) -> None:
        """The call's effect is next: from here the run may be running, so
        an open candidate is superseded and this run is the one whose token
        counts."""
        with self._lock:
            run.opened_t = self._clock()
            self._supersede(f"run {run.run}")
            self.run = run
            self.last_run = max(self.last_run, run.run)
            self._changed()
        self._emit("cal.run_opened", run=run.run, routine=run.routine, link=run.link_seq,
                   basis=run.basis, unit=run.unit, axis=run.axis, base_rev=run.base_rev, was=run.was)

    def call_sent(self, run: CalRun, serial: Optional[int]) -> None:
        with self._lock:
            run.serial, run.sent_t, run.state = serial, self._clock(), "sent"

    def call_failed(self, run: CalRun) -> None:
        """The call's write began and raised: whether the routine runs is not
        known — nothing is offered."""
        with self._lock:
            if self.run is run:
                self._end(run, WHY_UNKNOWN_SEND)

    def note_end_of_machine(self, why: str) -> None:
        """An abort, E-Stop or power off of the gateway's own, right before
        its write: the open run ended by it — whatever it reported."""
        with self._lock:
            if self.run is not None and self.run.fault is None:
                self.run.fault = why

    # ── the status cycle ──
    def wants_drain(self, fields: Dict[str, Any], link_seq: Optional[int]) -> bool:
        """Must the cycle read the error channel until it is empty (the open
        run may be through by this poll)?"""
        with self._lock:
            r = self.run
            return r is not None and link_seq is not None and at_rest(fields, self._consts)

    def cycle(self, c: Cycle, base_rev: Optional[int]) -> List[Tuple[int, str]]:
        """One status cycle: the messages (the result lines consumed), the
        open run's proofs and its end, the candidate's own conditions. The
        messages to forward come back."""
        with self._lock:
            out = self._messages(c)
            self._run_step(c, base_rev)
            self._candidate_step(c, base_rev)
            return out

    def _messages(self, c: Cycle) -> List[Tuple[int, str]]:
        out: List[Tuple[int, str]] = []
        for kind, text in c.messages:
            m = parse_candidate(text)
            if isinstance(m, str):
                self._emit("cal.message_invalid", level="warn", why=m, text=str(text)[:120])
                continue
            if m is not None:
                self._result(m, c.link_seq)
                continue
            if OLD_RESULT in str(text):
                # the routine's upstream form: a bare value, never a candidate
                self._emit("cal.old_routine", level="warn", text=str(text)[:120])
                self._on_old_routine()
                if self.run is not None and self.run.fault is None:
                    self.run.fault = WHY_ROUTINE
                if (OLD_WARNING_KIND, OLD_ROUTINE_WARNING) not in out:
                    out.append((OLD_WARNING_KIND, OLD_ROUTINE_WARNING))
                continue
            r = self.run
            if r is not None and kind not in NOT_ERRORS and r.fault is None:
                r.fault = WHY_ERROR
                self._emit("cal.run_error", run=r.run, kind=kind, text=str(text)[:160])
            out.append((kind, text))
        return out

    def _result(self, m: CandidateMsg, link_seq: Optional[int]) -> None:
        r = self.run
        if r is None or m.run != r.run:
            # another run's, or this one's after its decision: never a new
            # candidate, never in place of one
            self._emit("cal.message_stale", level="warn", run=m.run, open=r.run if r else None,
                       last=self.last_run, value=m.value)
            return
        if link_seq is None or link_seq != r.link_seq:
            self._emit("cal.message_other_link", level="warn", run=m.run, link=link_seq)
            return
        if r.result is not None:
            self._emit("cal.message_twice", level="warn", run=m.run, value=m.value)
            return
        r.result = m.value
        r.started = True
        if m.axis != r.axis and r.fault is None:
            r.fault = WHY_ROUTINE       # it measured another axis than it was asked for
        self._emit("cal.result", run=r.run, value=m.value, axis=m.axis)

    def _run_step(self, c: Cycle, base_rev: Optional[int]) -> None:
        r = self.run
        if r is None:
            return
        if c.link_seq is None:
            return                      # a poll of no Link proves nothing
        if c.link_seq != r.link_seq:
            self._end(r, WHY_LINK)
            return
        if r.fault is None and c.estop:
            r.fault = WHY_ESTOP
        if r.fault is None and c.enabled is False:
            r.fault = WHY_OFF
        if r.state != "sent":
            return                      # the write has not returned
        f = c.fields
        echo, idle = f.get("echo"), f.get("interp_state") == self._consts.get("INTERP_IDLE", 1)
        if (not r.started and r.sent_t is not None and r.sent_t < c.polled_at and echo is not None
                and r.serial is not None and echo >= r.serial and f.get("interp_state") is not None and not idle):
            r.started = True
        how, (since, proof) = controller_done(f, r.obs(), c.polled_at, c.link_seq, self._window, self._consts)
        r.err_since, r.err_proof = since, proof
        if how == "relinked":
            self._end(r, WHY_LINK)
        elif how == "error":
            self._end(r, r.fault or WHY_ERROR)
        elif how == "done" and at_rest(f, self._consts):
            if c.drained is not None:
                return                  # the end is not proven: a message may still be in the channel
            self._end(r, r.fault or (WHY_NOT_STARTED if not r.started else
                                     WHY_NO_RESULT if r.result is None else
                                     WHY_BASE if base_rev != r.base_rev else None))

    def _end(self, r: CalRun, why: Optional[str]) -> None:
        """The run's end: its candidate (`why` None), or why it offers none."""
        self.run = None
        value = r.result
        ok = why is None and value is not None
        self.candidate = Candidate(
            run=r.run, value=value, routine=r.routine, axis=r.axis, size=r.size,
            unit=r.unit, basis=r.basis, was=r.was, base_rev=r.base_rev, link_seq=r.link_seq, starter=r.starter,
            at=self._now(), state="pending" if ok else "stale", why=None if ok else (why or WHY_NO_RESULT))
        self._changed()
        self._emit("cal.run_ended", run=r.run, offered=ok, why=self.candidate.why, value=value, started=r.started)

    def _candidate_step(self, c: Cycle, base_rev: Optional[int]) -> None:
        cand = self.candidate
        if cand is None or cand.state != "pending":
            return
        if c.link_seq is not None and c.link_seq != cand.link_seq:
            self._stale(cand, WHY_LINK)
        elif base_rev is not None and base_rev != cand.base_rev:
            self._stale(cand, WHY_BASE)

    def _stale(self, cand: Candidate, why: str) -> None:
        cand.state, cand.why = "stale", why
        self._changed()
        self._emit("cal.candidate_stale", run=cand.run, why=why)

    def _supersede(self, by: str) -> None:
        cand = self.candidate
        if cand is not None and cand.state != "superseded":
            was = cand.state
            cand.state = "superseded"
            self._changed()
            self._emit("cal.candidate_superseded", run=cand.run, was=was, by=by)

    # ── the decisions (the caller holds _cal_lock) ──
    def refusal(self, run: int, base_rev: Optional[int], link_seq: Optional[int]) -> Optional[str]:
        """Why the candidate `run` cannot be decided now — None: it can."""
        with self._lock:
            cand = self.candidate
            if cand is None or cand.run != run:
                return "No such calibration result — reload the page" if cand is not None else "No calibration result"
            if cand.state == "applied":
                return "Already applied"
            if cand.state == "discarded":
                return "Discarded meanwhile"
            if cand.state == "stale":
                return f"Not offered — {cand.why}"
            if cand.state == "superseded":
                return "A newer calibration replaced it"
            if link_seq is None or link_seq != cand.link_seq:
                return f"Not offered — {WHY_LINK}"
            if base_rev is None or base_rev != cand.base_rev:
                return "The active offset changed since this run — calibrate again"
            return None

    def deciding(self, run: int) -> None:
        """Reserved by the commit: the status cycle leaves it alone until
        `decided` or `undecided`."""
        with self._lock:
            if self.candidate is not None and self.candidate.run == run and self.candidate.state == "pending":
                self.candidate.state = "deciding"

    def undecided(self, run: int) -> None:
        with self._lock:
            if self.candidate is not None and self.candidate.run == run and self.candidate.state == "deciding":
                self.candidate.state = "pending"

    def decided(self, run: int, state: str) -> None:
        """`applied` (the record is stored) or `discarded`."""
        with self._lock:
            if self.candidate is not None and self.candidate.run == run:
                self.candidate.state, self.candidate.why = state, None
                self._changed()
        self._emit("cal.candidate_decided", run=run, state=state)

    def supersede(self, by: str) -> None:
        """Reset: an open candidate is gone with the offset it stood on."""
        with self._lock:
            self._supersede(by)

    def wire(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self.candidate.wire() if self.candidate is not None else None


# ---- the drain proof (a calibration start's) -------------------------------

@dataclass
class DrainRequest:
    """A calibration start's question to the ONE reader of the error channel,
    the status poller: only a cycle that BEGAN after it answers. `answer`:
    None = proven — the controller at rest by that cycle's poll, then its
    channel read until it was empty, the same Link throughout — else why."""
    cycle: int                  # the poller's cycle number at the request
    link_seq: int
    done: Callable[[Optional[str]], None]
    deadline: float = 0.0
    answered: bool = field(default=False)

    def serve(self, number: int, c: Cycle, now: float, consts: Optional[dict] = None) -> bool:
        """Answer from cycle `number`; False while it stays open."""
        if self.answered:
            return True
        if number <= self.cycle:
            return False                # a cycle already running: it began before the question
        why: Optional[str]
        if c.link_seq != self.link_seq:
            why = "connection changed"
        elif not at_rest(c.fields, consts):
            if now < self.deadline:
                return False            # still running: the next cycle
            why = "not at rest"
        else:
            why = c.drained
        self.answered = True
        self.done(why)
        return True

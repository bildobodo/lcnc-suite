"""The native stage's M6 helper (plan Codex R282–R284 FI282-02): the client
never confirms on its own account (`auto_confirm=False`); a sequence declares
the tool changes it allows, in their order, and this helper confirms exactly
those — each a NEW request (`tool_change_seq` not null and not the one last
accepted) for a declared tool, named by its sequence number. An undeclared
change, a wrong or unknown tool, a request replaced before its completion, a
lost connection: nothing is confirmed and the sequence ends with
ToolChangeError (the run tears its instance down).

The hold (F-TOOLCHANGE.S2): the confirmation waits `hold_s`, and every
sample of that interval must show the request still open (the same
sequence), the interpreter not idle and the spindle tool unchanged; the
sampling itself must not leave a gap (20 Hz → at most HOLD_GAP_S).

Pure over status snapshots (`step`), so every rule runs offline; `serve`
drives it against a live client."""
from __future__ import annotations

import time

HOLD_GAP_S = 0.1          # 20 Hz sampling, one late tick tolerated
INTERP_IDLE = 1


class ToolChangeError(RuntimeError):
    """The sequence's tool changes did not go as declared — nothing more is confirmed."""


def _tool(st):
    t = st.get("tool_change_tool")
    return t if isinstance(t, int) and not isinstance(t, bool) else None


class ToolChanges:
    def __init__(self, declared: list[int], hold_s: float = 0.0):
        self.declared = list(declared)
        self.remaining = list(declared)
        self.hold_s = hold_s
        self.last_seq = None          # the request last accepted on this connection
        self.state = "wait"           # wait | hold | confirmed
        self.current: dict | None = None
        self.confirmed: list = []     # the sequence numbers this helper confirmed
        self.served: list[dict] = []  # changes confirmed AND completed
        self.holds: list[dict] = []

    def precheck(self, st) -> str | None:
        """Before the sequence triggers anything: no request open. An unread
        request is no clean start either."""
        req, seq = st.get("tool_change_requested"), st.get("tool_change_seq")
        if req is None:
            return "the tool change request is unknown (no reader snapshot) — no clean start"
        if req or seq is not None:
            return f"a tool change request is open before the sequence (seq {seq}, T{st.get('tool_change_tool')})"
        return None

    def idle(self) -> bool:
        return self.state == "wait"

    def step(self, t: float, st: dict):
        """One status snapshot at `t` (s). Returns ("confirm", seq) when the
        caller must confirm that request now, else None."""
        req, seq = st.get("tool_change_requested"), st.get("tool_change_seq")
        if self.state == "confirmed":
            cur = self.current
            if seq is not None and seq != cur["seq"]:
                raise ToolChangeError(f"a new request (seq {seq}) before T{cur['tool']}'s change (seq {cur['seq']}) "
                                      f"completed — not confirmed")
            if req is False and seq is None and st.get("tool_number") == cur["tool"]:
                self.served.append(dict(cur))
                self.state, self.current = "wait", None
            return None
        if self.state == "hold":
            return self._hold(t, st, req, seq)
        if req is True and seq is not None and seq != self.last_seq:
            tool = _tool(st)
            if tool is None:
                raise ToolChangeError(f"request seq {seq}: the requested tool is unknown — not confirmed")
            if tool not in self.remaining:
                if not self.remaining:
                    raise ToolChangeError(f"an undeclared tool change: T{tool} (every declared change "
                                          f"{self.declared} served) — not confirmed")
                raise ToolChangeError(f"T{tool} requested, the declared changes left are {self.remaining} — "
                                      f"not confirmed")
            self.remaining = self.remaining[self.remaining.index(tool) + 1:]
            self.last_seq = seq
            self.current = {"tool": tool, "seq": seq}
            if self.hold_s > 0:
                self.state = "hold"
                self.holds.append({"tool": tool, "seq": seq, "t0": t, "last_t": t, "samples": 0, "max_gap_s": 0.0,
                                   "tool_before": st.get("tool_number")})
                return self._hold(t, st, req, seq)
            return self._confirm(seq)
        return None

    def _confirm(self, seq):
        self.state = "confirmed"
        self.confirmed.append(seq)
        return ("confirm", seq)

    def _hold(self, t, st, req, seq):
        h, cur = self.holds[-1], self.current
        gap = t - h["last_t"]
        h["max_gap_s"] = max(h["max_gap_s"], gap)
        if gap > HOLD_GAP_S:
            raise ToolChangeError(f"a gap of {gap:.3f} s in the hold's sampling — no hold, not confirmed")
        if req is not True or seq != cur["seq"]:
            raise ToolChangeError(f"the request ended or changed during the hold (requested {req}, seq {seq}) — "
                                  f"not confirmed")
        interp = st.get("interp_state")
        if interp is None:
            raise ToolChangeError("the interpreter state unknown during the hold — not confirmed")
        if interp == INTERP_IDLE:
            raise ToolChangeError("the interpreter went idle during the hold — M6 did not wait")
        if st.get("tool_number") != h["tool_before"]:
            raise ToolChangeError(f"the spindle tool changed during the hold (T{h['tool_before']} → "
                                  f"T{st.get('tool_number')}) — not confirmed")
        h["samples"] += 1
        h["last_t"] = t
        if t - h["t0"] >= self.hold_s:
            return self._confirm(seq)
        return None


class RoutineEnd:
    """The end of what an `mdi` started — its reply means SENT, not done:
    the interpreter seen busy and then idle with the machine in position.
    `require_busy` False (a block too short to show in a status frame)
    accepts idle after `grace` s instead, as the gateway's own rule does."""

    def __init__(self, require_busy: bool = True, grace: float = 2.0):
        self.require_busy, self.grace = require_busy, grace
        self.t0 = None
        self.seen_busy = False

    def __call__(self, t: float, st: dict) -> bool:
        if self.t0 is None:
            self.t0 = t
        interp = st.get("interp_state")
        if interp is not None and interp != INTERP_IDLE:
            self.seen_busy = True
            return False
        if interp != INTERP_IDLE or not st.get("inpos"):
            return False
        return self.seen_busy or (not self.require_busy and t - self.t0 >= self.grace)


def serve(client, changes: ToolChanges, done, deadline_s: float, tick: float = 0.05) -> list[dict]:
    """Drive `changes` against the live client at 20 Hz until `done(t, st)`
    with no change pending. A lost connection, a refused confirmation or the
    deadline end the sequence with ToolChangeError."""
    end = time.monotonic() + deadline_s
    while True:
        if client.error:
            raise ToolChangeError(f"the connection ended while waiting — nothing confirmed ({client.error})")
        t, st = time.monotonic(), dict(client.status)
        act = changes.step(t, st)
        if act:
            try:
                client.request("confirm_tool_change", request=act[1])
            except RuntimeError as e:
                raise ToolChangeError(f"the confirmation of request {act[1]} was refused: {e}") from None
        if changes.idle() and done(t, st):
            return changes.served
        if t > end:
            raise ToolChangeError(f"not done within {deadline_s} s" + ("" if changes.idle() else
                                                                        f" — T{changes.current['tool']} pending"))
        time.sleep(tick)

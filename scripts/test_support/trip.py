"""The processes a native run stops and the trips it may acknowledge
(native stage step 3, plan Codex R283, R313–R316).

- A process is stopped only after its identity — pid and start ticks — is
  read and recorded in state.json (`stopped`); it is continued only after
  the identity is read again equal. Every recorded stop gets its SIGCONT from
  the step, from the run's cleanup and from restore_lan (ExecStopPost) before
  the test instance ends (`restore_lan.continue_stopped`, one code).
- A trip is the run's own only when the latch was clear before (no
  unacknowledged trip), the own falling edge lies in the own section and the
  LinuxCNC instance is the same before and after. Any other trip is never
  acknowledged — the run ends with its evidence."""
from __future__ import annotations

import os
import signal
from pathlib import Path

from test_support.restore_lan import continue_stopped  # noqa: F401 — the one SIGCONT path


def start_ticks(pid: int):
    """A process's start ticks (/proc/<pid>/stat field 22), None when gone."""
    try:
        return int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19])
    except (OSError, IndexError, ValueError):
        return None


def stop(state: dict, save, pid: int, what: str, kill=os.kill, ticks=start_ticks) -> dict:
    """SIGSTOP `pid` after its identity is on disk; the record."""
    start = ticks(pid)
    if start is None:
        raise RuntimeError(f"{what} (pid {pid}) not found — nothing stopped")
    rec = {"pid": pid, "start": start, "what": what}
    state.setdefault("stopped", []).append(rec)
    save(state)
    kill(pid, signal.SIGSTOP)
    return rec


def cont(state: dict, save, rec: dict, kill=os.kill, ticks=start_ticks) -> str:
    """SIGCONT the recorded process only if it is still the same one."""
    same = ticks(rec["pid"]) == rec["start"]
    if same:
        kill(rec["pid"], signal.SIGCONT)
    state["stopped"] = [r for r in state.get("stopped", []) if r != rec]
    outcome = "continued" if same else "gone or another process — no signal"
    state.setdefault("continued", []).append({**rec, "outcome": outcome})
    save(state)
    return outcome


def own_trip(before_trip, edge_index, instance_before, instance_after) -> str | None:
    """None when the trip may be acknowledged as the run's own, else why not."""
    if before_trip:
        return f"a trip was waiting before the case ({before_trip})"
    if edge_index is None:
        return "no own falling edge of oneshot.0.out in the own section"
    if not instance_before or instance_before != instance_after:
        return f"the LinuxCNC instance changed ({instance_before} → {instance_after})"
    return None

"""ONE lock for the heavy sections (plan Codex R268/R269 "Sperre und
Abschluss"): the round and merge gates from their first heavy check to their
end, perf_matrix, the load repro (`flock` on the same file in
repro-load.sh) and the native stage. They load the same machine — and the
native stage takes the VM's one LinuxCNC — so they never overlap; a look at
the process list is no lock (a gate could start right after it).

The lock file names its holder, so a waiter can say whom it waits for.
`LCNC_HEAVY_LOCK` moves it (a test's own file).

A run that STOPPED the LAN instance owes its return (Codex R331 FI-I60 A):
`owe(run)` writes a marker beside the lock before the stop, `settle(run)`
removes it once the return is done. While it stands, the lock is that run's
restore's alone: any other taker that gets the flock lets it go at once and
waits on (a run killed before its `finally` loses the flock, and a gate
waiting already would otherwise take it before the run's ExecStopPost
restore). A marker no restore settles stops every heavy job — named in the
wait, never silent."""
from __future__ import annotations

import fcntl
import json
import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

LOCK = Path(os.environ.get("LCNC_HEAVY_LOCK", str(Path.home() / "claude-work/live-tier/heavy.lock")))


def _owed_path(path: Path) -> Path:
    return path.with_name(path.name + ".owed")


def owed(path: Optional[Path] = None) -> Optional[dict]:
    """The return a run owes (its marker), or None."""
    path = LOCK if path is None else path
    try:
        return json.loads(_owed_path(path).read_text())
    except (OSError, ValueError):
        return None


def owe(run: str, path: Optional[Path] = None) -> None:
    """Before a run stops the LAN instance: its return is owed (atomic)."""
    path = LOCK if path is None else path
    target = _owed_path(path)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps({"run": run, "pid": os.getpid(), "since": datetime.now().isoformat(timespec="seconds")}))
    tmp.replace(target)


def settle(run: str, path: Optional[Path] = None) -> None:
    """The run's return is done: its marker goes (another run's stays)."""
    path = LOCK if path is None else path
    m = owed(path)
    if m and m.get("run") == run:
        _owed_path(path).unlink(missing_ok=True)


def holder_of(path: Optional[Path] = None) -> str:
    """Who holds (or last held) the lock — the line its holder wrote."""
    path = LOCK if path is None else path
    try:
        return path.read_text().strip() or "unknown"
    except OSError:
        return "unknown"


@contextmanager
def heavy_lock(who: str, wait: Optional[float] = None, path: Optional[Path] = None,
               owed_by: Optional[str] = None) -> Iterator[None]:
    """Hold the heavy lock for the block. `wait` None waits as long as it
    takes (a gate waits for the other gate); a number of seconds gives up with
    TimeoutError naming the holder. `path` None: the module's LOCK, read at
    the call (a test sets its own — inside a gate, the gate holds the real one).
    `owed_by`: the run whose owed return this taker IS (its restore) — only
    that one may take the lock while the run's marker stands."""
    path = LOCK if path is None else path
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        started, said = time.monotonic(), False
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                m = owed(path)
                if m is None or m.get("run") == owed_by:
                    break
                # a return is owed: the lock is that run's restore's alone
                fcntl.flock(fd, fcntl.LOCK_UN)
                why = f"a LAN return is owed for {m.get('run')} (since {m.get('since')}) — only its restore may run"
            except BlockingIOError:
                why = holder_of(path)
            if wait is not None and time.monotonic() - started >= wait:
                raise TimeoutError(f"the heavy lock is held: {why}") from None
            if not said:
                print(f"{who}: waiting for the heavy lock — {why}", flush=True)
                said = True
            time.sleep(0.2)
        os.ftruncate(fd, 0)
        os.write(fd, f"{who} (pid {os.getpid()}, since {datetime.now().isoformat(timespec='seconds')})\n".encode())
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

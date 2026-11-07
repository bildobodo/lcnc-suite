"""ONE lock for the heavy sections (plan Codex R268/R269 "Sperre und
Abschluss"): the round and merge gates from their first heavy check to their
end, perf_matrix, the load repro (repro-load.sh, through this module's
command line) and the native stage. They load the same machine — and the
native stage takes the VM's one LinuxCNC — so they never overlap; a look at
the process list is no lock (a gate could start right after it).

The lock file names its holder, so a waiter can say whom it waits for.
`LCNC_HEAVY_LOCK` moves it (a test's own file).

A run that STOPPED the LAN instance owes its return (Codex R331 FI-I60 A):
`owe(run)` writes a marker beside the lock before the stop; the run's
FINAL restore — its unit's ExecStopPost, the record the merge gate demands —
settles it (R332 A1: settled in the run's own `finally`, a waiting gate
came in before that restore). While it stands, the lock is that run's
restore's alone: any other taker that gets the flock lets it go at once and
waits on. Only a marker CONFIRMED absent frees the lock; one that cannot be
read or is no marker keeps every taker out, the restore included, and says
so (R332 A3). A marker no restore settles stops every heavy job — named in
the wait, never silent.

Every taker goes through this module: Python by `heavy_lock()`, a shell
script by its command line (R332 A2 — repro-load.sh took the file with a
bare `flock`, blind to the marker):

  python3 -I scripts/test_support/heavy_lock.py --who <name> [--wait S] -- <command> [args…]

It takes the lock as `heavy_lock()` does and EXECS the command, which
inherits the lock's descriptor and holds the lock until it exits."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

LOCK = Path(os.environ.get("LCNC_HEAVY_LOCK", str(Path.home() / "claude-work/live-tier/heavy.lock")))


class OwedUnreadable(RuntimeError):
    """The owed-return marker exists and cannot be read as one."""


def _owed_path(path: Path) -> Path:
    return path.with_name(path.name + ".owed")


def owed(path: Optional[Path] = None) -> Optional[dict]:
    """The return a run owes (its marker), None when the marker is CONFIRMED
    absent; OwedUnreadable when it exists and cannot be read or is no marker."""
    path = LOCK if path is None else path
    try:
        text = _owed_path(path).read_text()
    except FileNotFoundError:
        return None
    except OSError as e:
        raise OwedUnreadable(f"{type(e).__name__}: {e}") from e
    try:
        m = json.loads(text)
    except ValueError as e:
        raise OwedUnreadable(f"not JSON: {e}") from e
    if not isinstance(m, dict) or not isinstance(m.get("run"), str) or not m["run"]:
        raise OwedUnreadable(f"no marker (no run named): {text[:120]!r}")
    return m


def owe(run: str, path: Optional[Path] = None) -> None:
    """Before a run stops the LAN instance: its return is owed (atomic)."""
    path = LOCK if path is None else path
    target = _owed_path(path)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(json.dumps({"run": run, "pid": os.getpid(), "since": datetime.now().isoformat(timespec="seconds")}))
    tmp.replace(target)


def settle(run: str, path: Optional[Path] = None) -> str:
    """The run's final return is done: its marker goes. Only a marker read as
    THIS run's is removed — "settled"; else "absent", "another run's" or
    "unreadable: …" (left as it is)."""
    path = LOCK if path is None else path
    try:
        m = owed(path)
    except OwedUnreadable as e:
        return f"unreadable: {e}"
    if m is None:
        return "absent"
    if m.get("run") != run:
        return "another run's"
    _owed_path(path).unlink(missing_ok=True)
    return "settled"


def holder_of(path: Optional[Path] = None) -> str:
    """Who holds (or last held) the lock — the line its holder wrote."""
    path = LOCK if path is None else path
    try:
        return path.read_text().strip() or "unknown"
    except OSError:
        return "unknown"


def _acquire(who: str, wait: Optional[float], path: Path, owed_by: Optional[str]) -> int:
    """The lock's descriptor, held — or TimeoutError naming why not."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        started, said = time.monotonic(), False
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                try:
                    m = owed(path)
                except OwedUnreadable as e:
                    fcntl.flock(fd, fcntl.LOCK_UN)
                    why = f"the owed-return marker cannot be read ({e}) — no heavy run until it is resolved by hand"
                else:
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
        return fd
    except BaseException:
        os.close(fd)
        raise


@contextmanager
def heavy_lock(who: str, wait: Optional[float] = None, path: Optional[Path] = None,
               owed_by: Optional[str] = None) -> Iterator[None]:
    """Hold the heavy lock for the block. `wait` None waits as long as it
    takes (a gate waits for the other gate); a number of seconds gives up with
    TimeoutError naming the holder. `path` None: the module's LOCK, read at
    the call (a test sets its own — inside a gate, the gate holds the real one).
    `owed_by`: the run whose owed return this taker IS (its restore) — only
    that one may take the lock while the run's marker stands."""
    fd = _acquire(who, wait, LOCK if path is None else path, owed_by)
    try:
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Run a command under the heavy lock (the owed-return marker honoured).")
    ap.add_argument("--who", required=True)
    ap.add_argument("--wait", type=float, default=None, help="give up after this many seconds (exit 4)")
    ap.add_argument("command", nargs=argparse.REMAINDER, help="-- <command> [args…]")
    a = ap.parse_args(argv)
    cmd = a.command[1:] if a.command[:1] == ["--"] else a.command
    if not cmd:
        ap.error("no command after --")
    try:
        fd = _acquire(a.who, a.wait, LOCK, None)
    except TimeoutError as e:
        print(f"{a.who}: {e}", file=sys.stderr)
        return 4
    os.set_inheritable(fd, True)        # the command holds the lock until it exits
    os.execvp(cmd[0], cmd)


if __name__ == "__main__":
    raise SystemExit(main())

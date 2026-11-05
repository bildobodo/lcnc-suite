"""ONE lock for the heavy sections (plan Codex R268/R269 "Sperre und
Abschluss"): the round and merge gates from their first heavy check to their
end, perf_matrix, the load repro (`flock` on the same file in
repro-load.sh) and the native stage. They load the same machine — and the
native stage takes the VM's one LinuxCNC — so they never overlap; a look at
the process list is no lock (a gate could start right after it).

The lock file names its holder, so a waiter can say whom it waits for.
`LCNC_HEAVY_LOCK` moves it (a test's own file)."""
from __future__ import annotations

import fcntl
import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

LOCK = Path(os.environ.get("LCNC_HEAVY_LOCK", str(Path.home() / "claude-work/live-tier/heavy.lock")))


def holder_of(path: Optional[Path] = None) -> str:
    """Who holds (or last held) the lock — the line its holder wrote."""
    path = LOCK if path is None else path
    try:
        return path.read_text().strip() or "unknown"
    except OSError:
        return "unknown"


@contextmanager
def heavy_lock(who: str, wait: Optional[float] = None, path: Optional[Path] = None) -> Iterator[None]:
    """Hold the heavy lock for the block. `wait` None waits as long as it
    takes (a gate waits for the other gate); a number of seconds gives up with
    TimeoutError naming the holder. `path` None: the module's LOCK, read at
    the call (a test sets its own — inside a gate, the gate holds the real one)."""
    path = LOCK if path is None else path
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        started, said = time.monotonic(), False
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if wait is not None and time.monotonic() - started >= wait:
                    raise TimeoutError(f"the heavy lock is held: {holder_of(path)}") from None
                if not said:
                    print(f"{who}: waiting for the heavy lock — {holder_of(path)}", flush=True)
                    said = True
                time.sleep(0.2)
        os.ftruncate(fd, 0)
        os.write(fd, f"{who} (pid {os.getpid()}, since {datetime.now().isoformat(timespec='seconds')})\n".encode())
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

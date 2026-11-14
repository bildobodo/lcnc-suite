"""R371: unavailable timer thread plus blocked diagnostic, own children only."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
from test_console_guard import ABlockedDiagnosticCannotOutliveTheDeadline

OUT = []


@pytest.mark.parametrize("entry", ["request", "instance"])
def test_timer_start_failure_still_ends_the_gateway(tmp_path, entry):
    # Reuse the repository's own real blocking case. Only the timer resource
    # is now unavailable. LinuxCNC is fake; signals leaving the child are stubbed.
    code = ABlockedDiagnosticCannotOutliveTheDeadline.CHILD.replace(
        "gateway.SHUTDOWN_DEADLINE_S = 0.3",
        """gateway.SHUTDOWN_DEADLINE_S = 0.3
class NoThread:
    def __init__(self, *args): pass
    def start(self):
        (out / 'timer-failed').write_text('RuntimeError: cannot start new thread')
        raise RuntimeError('cannot start new thread')
gateway.threading.Timer = NoThread""")
    rc = None
    timed_out = False
    try:
        result = subprocess.run([sys.executable, "-c", code, str(tmp_path), entry],
                                cwd=Path(__file__).parent, timeout=2, capture_output=True,
                                env={**os.environ, "LCNC_LOG_DIR": str(tmp_path / "logs")})
        rc = result.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
    row = {"entry": entry, "entered": (tmp_path / "entered").exists(),
           "timer_failed": (tmp_path / "timer-failed").exists(),
           "returned": (tmp_path / "returned").exists(),
           "timed_out": timed_out, "returncode": rc}
    OUT.append(row)
    Path("/tmp/r371-deadline-failure.json").write_text(json.dumps(OUT, indent=2))
    assert row["entered"] and row["timer_failed"], row
    assert not timed_out, row
    assert rc == 1, row

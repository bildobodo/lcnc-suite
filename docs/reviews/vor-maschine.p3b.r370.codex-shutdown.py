"""R370: real emit/logging failure path, fake controller and no signals."""
import io
import json
import logging
import os
import subprocess
import sys
import textwrap
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc
fake_linuxcnc.install()
import gateway
import lcnc_trace as trace

OUT = []


class DiskFull:
    def write(self, text):
        raise OSError(28, "No space left on device")
    def flush(self):
        pass


def exercise(name, action, *, trace_fails=True, guarded_stderr=False):
    logger = logging.Logger("codex-r370", level=logging.INFO)
    logger.addHandler(logging.StreamHandler(DiskFull() if trace_fails else io.StringIO()))
    closed = io.StringIO()
    closed.close()
    calls = []
    class Timer:
        def __init__(self, *a):
            pass
        def start(self):
            calls.append("deadline")
    with patch.object(trace, "_initialized", True), patch.object(trace, "_logger", logger), \
            patch.object(trace, "_logger_failed", False), \
            patch.object(gateway, "_shutdown_requested", False), \
            patch.object(gateway, "_launcher_bind", {"mode": "standalone"}), \
            patch.object(gateway.linuxcnc, "__lcnc_fake__", False), \
            patch.object(gateway.threading, "Timer", Timer), \
            patch.object(gateway.os, "kill", lambda *a: calls.append("kill")), \
            patch.object(gateway.signal, "raise_signal", lambda *a: calls.append("signal")), \
            patch.object(trace.sys, "stderr", trace.ConsoleGuard(closed, "stderr") if guarded_stderr else closed), \
            patch.object(trace.sys, "stdout", closed):
        error = None
        try:
            action()
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
        row = {"case": name, "error": error, "calls": calls,
               "shutdown_requested": gateway._shutdown_requested}
    OUT.append(row)
    Path("/tmp/r370-shutdown.json").write_text(json.dumps(OUT, indent=2))
    return row


def test_console_does_not_rethrow_when_its_loss_report_fails():
    row = exercise("console_and_trace_sinks_lost", lambda: trace.console("line"))
    assert row["error"] is None, row


def test_shutdown_reaches_deadline_when_trace_and_stderr_fail():
    row = exercise("shutdown_trace_fails", lambda: gateway._request_process_shutdown("test"))
    assert "deadline" in row["calls"], row
    assert row["error"] is None, row


def test_comparison_closed_raw_streams_with_healthy_trace():
    row = exercise("comparison_healthy_trace", lambda: gateway._request_process_shutdown("test"),
                   trace_fails=False)
    assert row["error"] is None, row
    assert row["calls"] == ["deadline", "signal"], row


def test_comparison_failed_trace_with_stderr_guard_intact():
    row = exercise("comparison_guarded_stderr", lambda: gateway._request_process_shutdown("test"),
                   guarded_stderr=True)
    assert row["error"] is None, row
    assert row["calls"] == ["deadline", "signal"], row


def test_deadline_precedes_trace_fallback_to_a_full_guarded_pipe(tmp_path):
    # Only this disposable child is timed out/killed; no real timer, signal,
    # controller connection or live process. The stderr guard stays installed.
    code = textwrap.dedent('''
        import io, logging, os, sys
        from pathlib import Path
        import fake_linuxcnc
        fake_linuxcnc.install()
        import gateway
        import lcnc_trace as trace
        out = Path(sys.argv[1])
        class DiskFull:
            def write(self, s): raise OSError(28, 'No space left on device')
            def flush(self): pass
        logger = logging.Logger('r370-full-pipe', level=logging.INFO)
        logger.addHandler(logging.StreamHandler(DiskFull()))
        trace._initialized, trace._logger, trace._logger_failed = True, logger, False
        read_fd, write_fd = os.pipe()
        os.set_blocking(write_fd, False)
        try:
            while True: os.write(write_fd, b'x' * 4096)
        except BlockingIOError:
            pass
        os.set_blocking(write_fd, True)
        pipe = io.TextIOWrapper(os.fdopen(write_fd, 'wb', buffering=0), write_through=True)
        sys.stderr = trace.ConsoleGuard(pipe, 'stderr')
        sys.stdout = io.StringIO()
        class Timer:
            def __init__(self, *a): pass
            def start(self): (out / 'deadline').write_text('armed')
        gateway.threading.Timer = Timer
        gateway.linuxcnc.__lcnc_fake__ = False
        gateway._shutdown_requested = False
        gateway._launcher_bind = {'mode': 'standalone'}
        gateway.os.kill = lambda *a: None
        gateway.signal.raise_signal = lambda *a: None
        (out / 'entered').write_text('yes')
        gateway._request_process_shutdown('test')
        (out / 'returned').write_text('yes')
        os._exit(0)
    ''')
    timed_out = False
    try:
        subprocess.run([sys.executable, '-c', code, str(tmp_path)],
                       cwd=Path(__file__).parent, timeout=3, capture_output=True,
                       env={**os.environ, 'LCNC_LOG_DIR': str(tmp_path / 'logs')})
    except subprocess.TimeoutExpired:
        timed_out = True
    row = {'case': 'full_pipe_with_guard', 'entered': (tmp_path / 'entered').exists(),
           'deadline': (tmp_path / 'deadline').exists(),
           'returned': (tmp_path / 'returned').exists(), 'timed_out': timed_out}
    OUT.append(row)
    Path('/tmp/r370-shutdown.json').write_text(json.dumps(OUT, indent=2))
    assert row['entered'], row
    assert row['deadline'], row

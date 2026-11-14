"""A console write never stops a chain (package 3b, the 3a merge gate's find).

The install probe of the 3a merge gate traced `crash.asyncio_unhandled`
BrokenPipeError out of `_on_instance_ended`: its print ran after the latch
and before the trace, the HAL disconnect and the shutdown request, the
launcher's tee was gone, the print raised, the watch task died — and only an
outside SIGTERM ended the gateway. These tests hold:

- the shutdown chain runs to its end under a stdout that raises — on the RAW
  stream too (the chain does not lean on the process guard);
- `_request_process_shutdown` and `_on_instance_ended` arm the hard deadline
  BEFORE any trace or console line and reach their signal with a stdout that
  raises — and through the REAL emit with its sink failing and the console
  raw and closed (it raised), or the console a full pipe (it blocked: only the
  deadline ends that child) — Codex R370 VM-I14;
- a deadline that cannot be armed (no thread left) ends the process at once,
  os._exit(1) with no output, at every decided end — in process and in the
  blocked child (Codex R371 VM-I14);
- `lcnc_trace.ConsoleGuard` / `console()` never raise and trace the loss;
- a process that installed the crash hooks survives prints into a pipe whose
  reader is gone (a real child process, a real EPIPE);
- each of the three processes installs the hooks before its first print.
"""
import ast
import errno
import io
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest import mock

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`

import gateway  # noqa: E402
import lcnc_trace  # noqa: E402
from link_fixture import connect_fake, restore_after, swap_connection  # noqa: E402
import session_bind  # noqa: E402

HERE = Path(__file__).resolve().parent


class _Raising:
    """A console whose reader is gone: every write and flush raises."""

    def __init__(self, exc_factory=lambda: BrokenPipeError(errno.EPIPE, "Broken pipe")):
        self.exc_factory = exc_factory
        self.attempts = 0

    def write(self, s):
        self.attempts += 1
        raise self.exc_factory()

    def flush(self):
        self.attempts += 1
        raise self.exc_factory()


class _Recording(unittest.TestCase):
    def setUp(self):
        self.events = []
        real_emit = lcnc_trace.emit
        self.addCleanup(setattr, lcnc_trace, "emit", real_emit)
        lcnc_trace.emit = lambda tag, **kw: self.events.append((tag, kw))

    def tags(self):
        return [t for t, _ in self.events]


class TheShutdownChainRunsToItsEnd(_Recording):
    def setUp(self):
        super().setUp()
        restore_after(self)
        for name in ("_instance_ended", "_bound_instance", "_hal_disconnect", "_shutdown_requested"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        connect_fake(self)
        gateway._instance_ended = False
        gateway._shutdown_requested = False
        gateway._bound_instance = (424242, 1)
        self.disconnects = []
        gateway._hal_disconnect = lambda: self.disconnects.append(True)

    def _end_with_stdout(self, stream):
        with mock.patch.object(sys, "stdout", stream):
            gateway._on_instance_ended("test: the launcher's pipe is gone")

    def test_a_raw_raising_stdout_stops_nothing(self):
        # The raw stream, not the process guard: the chain holds by itself.
        stdout = _Raising()
        self._end_with_stdout(stdout)          # nothing propagates to the caller
        self.assertTrue(gateway._instance_ended)
        self.assertIsNone(gateway._link)
        self.assertEqual(self.disconnects, [True])
        self.assertTrue(gateway._shutdown_requested)
        tags = self.tags()
        self.assertIn("session.instance_ended", tags)
        self.assertIn("session.shutdown_requested", tags)
        self.assertIn("console.lost", tags)
        self.assertGreater(stdout.attempts, 0)   # the line was tried, and its loss traced
        # The record comes before any console line.
        self.assertLess(tags.index("session.instance_ended"), tags.index("console.lost"))

    def test_a_closed_stdout_stops_nothing(self):
        closed = io.StringIO()
        closed.close()                         # writes raise ValueError
        self._end_with_stdout(closed)
        self.assertEqual(self.disconnects, [True])
        self.assertTrue(gateway._shutdown_requested)
        lost = [kw for t, kw in self.events if t == "console.lost"]
        self.assertTrue(lost and lost[0]["exc_type"] == "ValueError", self.events)

    def test_a_failing_hal_disconnect_still_requests_the_shutdown(self):
        def _boom():
            raise OSError(errno.EBADF, "bad socket")
        gateway._hal_disconnect = _boom
        self._end_with_stdout(io.StringIO())
        self.assertTrue(gateway._shutdown_requested)
        self.assertIn("session.hal_disconnect_failed", self.tags())

    def test_a_second_end_returns_at_once(self):
        self._end_with_stdout(io.StringIO())
        n = len(self.events)
        self._end_with_stdout(_Raising())
        self.assertEqual(len(self.events), n)
        self.assertEqual(self.disconnects, [True])


class TheShutdownRequestArmsItsDeadlineFirst(_Recording):
    """The real path (not the fake's early return), every effect stubbed:
    no timer, no signal and no kill reach this test process."""

    def setUp(self):
        super().setUp()
        self.addCleanup(setattr, gateway, "_shutdown_requested", gateway._shutdown_requested)
        gateway._shutdown_requested = False
        p = mock.patch.object(gateway, "_shutdown_deadline", None, create=True)   # create: red by behaviour on an older head
        p.start()
        self.addCleanup(p.stop)
        self.order = []
        order = self.order

        class _Timer:
            def __init__(self, interval, fn, args=None):
                self.interval, self.fn, self.daemon = interval, fn, False

            def start(self):
                order.append(("deadline", self.interval, self.fn))

        real_emit = lcnc_trace.emit

        def _emit(tag, **kw):
            order.append(("emit", tag))
            real_emit(tag, **kw)
        lcnc_trace.emit = _emit
        for p in (mock.patch.object(gateway.linuxcnc, "__lcnc_fake__", False),
                  mock.patch.object(gateway.threading, "Timer", _Timer),
                  mock.patch.object(gateway.os, "kill", lambda pid, sig: order.append(("kill", pid, sig))),
                  mock.patch.object(gateway.signal, "raise_signal", lambda sig: order.append(("raise", sig)))):
            p.start()
            self.addCleanup(p.stop)

    def _request(self, launcher):
        bind = {"mode": "launcher", "launcher_pid": os.getppid()} if launcher else {"mode": "standalone"}
        with mock.patch.object(gateway, "_launcher_bind", bind), \
                mock.patch.object(sys, "stdout", _Raising()):
            gateway._request_process_shutdown("test: instance ended")

    def test_the_launcher_is_signalled_with_a_raising_stdout(self):
        self._request(launcher=True)
        kinds = [e[0] if e[0] != "emit" else e[1] for e in self.order]
        self.assertEqual(kinds[0], "deadline")           # before the record and any console line (VM-I14)
        self.assertEqual(kinds[1], "session.shutdown_requested")
        self.assertIn("console.lost", kinds)
        self.assertEqual(self.order[-1][0], "kill")
        self.assertEqual(self.order[0][1:], (5.0, os._exit))

    def test_a_standalone_gateway_signals_itself_with_a_raising_stdout(self):
        self._request(launcher=False)
        kinds = [e[0] if e[0] != "emit" else e[1] for e in self.order]
        self.assertEqual(kinds[:2], ["deadline", "session.shutdown_requested"])
        self.assertEqual(self.order[-1][0], "raise")

    def test_a_second_request_arms_no_second_deadline(self):
        self._request(launcher=False)
        gateway._shutdown_requested = False      # a later end path asking again
        self._request(launcher=False)
        self.assertEqual([e[0] for e in self.order].count("deadline"), 1)


class _DiskFull:
    """The trace file's sink with the disk full: every write raises ENOSPC."""

    def write(self, s):
        raise OSError(errno.ENOSPC, "No space left on device")

    def flush(self):
        pass


def _failing_trace(test):
    """The REAL emit over a real logging.Logger whose sink fails (Codex R370
    VM-I14: a guard that books emit into a list never sees this path) — the
    StreamHandler's error report then goes to sys.stderr."""
    import logging
    logger = logging.Logger("r370-failing-trace", level=logging.INFO)
    logger.addHandler(logging.StreamHandler(_DiskFull()))
    for p in (mock.patch.object(lcnc_trace, "_initialized", True), mock.patch.object(lcnc_trace, "_logger", logger),
              mock.patch.object(lcnc_trace, "_logger_failed", False)):
        p.start()
        test.addCleanup(p.stop)


def _without_gc_print(test):
    """The gateway's GC diagnostics out of the way while a test closes the
    consoles: `_gc_callback` prints bare from inside a collection — part of
    no chain, and Python reports its raise there as unraisable, which only
    clutters the run (seen in Codex R371's console run)."""
    import gc
    if gateway._gc_callback in gc.callbacks:
        gc.callbacks.remove(gateway._gc_callback)
        test.addCleanup(gc.callbacks.append, gateway._gc_callback)


class TheDeadlineComesBeforeAnyDiagnostic(unittest.TestCase):
    """Codex R370 VM-I14, the in-process half: the trace sink fails AND both
    console streams are raw and closed — logging's error report raised on
    stderr, emit's own report raised again, and the request stood with its
    flag set, no deadline and no signal. Both entry paths, the real emit."""

    def setUp(self):
        restore_after(self)
        for name in ("_instance_ended", "_bound_instance", "_hal_disconnect", "_shutdown_requested"):
            self.addCleanup(setattr, gateway, name, getattr(gateway, name))
        p = mock.patch.object(gateway, "_shutdown_deadline", None, create=True)   # create: red by behaviour on an older head
        p.start()
        self.addCleanup(p.stop)
        connect_fake(self)
        _without_gc_print(self)
        gateway._instance_ended = False
        gateway._shutdown_requested = False
        gateway._bound_instance = (424242, 1)
        self.order = []
        order = self.order
        gateway._hal_disconnect = lambda: order.append("hal_disconnect")

        class _Timer:
            def __init__(self, interval, fn, args=None):
                self.daemon = False

            def start(self):
                order.append("deadline")
        _failing_trace(self)
        closed_out, closed_err = io.StringIO(), io.StringIO()
        closed_out.close()
        closed_err.close()
        for p in (mock.patch.object(gateway.linuxcnc, "__lcnc_fake__", False),
                  mock.patch.object(gateway.threading, "Timer", _Timer),
                  mock.patch.object(gateway, "_launcher_bind", {"mode": "standalone"}),
                  mock.patch.object(gateway.os, "kill", lambda pid, sig: order.append("kill")),
                  mock.patch.object(gateway.signal, "raise_signal", lambda sig: order.append("signal")),
                  mock.patch.object(sys, "stdout", closed_out), mock.patch.object(sys, "stderr", closed_err)):
            p.start()
            self.addCleanup(p.stop)

    def test_the_shutdown_request_reaches_deadline_and_signal(self):
        gateway._request_process_shutdown("test: diagnostics lost")
        self.assertEqual(self.order, ["deadline", "signal"])

    def test_the_instance_end_reaches_deadline_disconnect_and_signal(self):
        gateway._on_instance_ended("test: diagnostics lost")
        self.assertEqual(self.order, ["deadline", "hal_disconnect", "signal"])
        self.assertTrue(gateway._shutdown_requested)

    def test_a_failure_report_whose_exception_cannot_be_printed_skips_nothing(self):
        class _Unprintable(Exception):
            def __str__(self):
                raise RuntimeError("no text")

        def _boom():
            raise _Unprintable()
        gateway._hal_disconnect = _boom
        gateway._on_instance_ended("test: an unprintable failure")
        self.assertEqual(self.order, ["deadline", "signal"])

    def test_console_never_raises_with_both_sinks_lost(self):
        lcnc_trace.console("a line nobody reads")     # raises nothing


class EveryEndArmsTheDeadlineBeforeItsFirstRecord(unittest.TestCase):
    """The siblings (R371, the hunt over every call of the two entries): each
    place that DECIDES an end arms the deadline before its first trace or
    console line — the HAL helper's stale rejection, the reconnect that sees
    another instance, the NML self-restart (its console line used to come
    first, and its caller's bare print before that). The real emit and
    console over a failing sink and closed consoles; each call booked in
    order on its way through."""

    def setUp(self):
        restore_after(self)
        saved = {k: getattr(gateway, k) for k in (
            "_bound_instance", "_instance_ended", "_shutdown_requested", "_lcnc_pid", "_get_lcnc_pid",
            "_nml_connectable", "_hal_disconnect")}
        self.addCleanup(lambda: [setattr(gateway, k, v) for k, v in saved.items()])
        self.addCleanup(setattr, session_bind, "instance_for_pid", session_bind.instance_for_pid)
        p = mock.patch.object(gateway, "_shutdown_deadline", None, create=True)
        p.start()
        self.addCleanup(p.stop)
        gateway._bound_instance = None
        gateway._instance_ended = False
        gateway._shutdown_requested = False
        gateway._nml_connectable = lambda: True
        gateway._get_lcnc_pid = lambda: os.getpid()        # a real, live /proc entry
        swap_connection(None)
        _without_gc_print(self)
        self.order = []
        order = self.order
        gateway._hal_disconnect = lambda: order.append("hal_disconnect")

        class _Timer:
            def __init__(self, interval, fn, args=None):
                self.daemon = False

            def start(self):
                order.append("deadline")
        _failing_trace(self)
        real_emit, real_console = lcnc_trace.emit, lcnc_trace.console

        def _emit(tag, **kw):
            order.append(f"emit:{tag}")
            real_emit(tag, **kw)

        def _console(text):
            order.append("console")
            real_console(text)
        closed_out, closed_err = io.StringIO(), io.StringIO()
        closed_out.close()
        closed_err.close()
        for p in (mock.patch.object(lcnc_trace, "emit", _emit), mock.patch.object(lcnc_trace, "console", _console),
                  mock.patch.object(gateway.linuxcnc, "__lcnc_fake__", False),   # bind-once on, the deadline armed
                  mock.patch.object(gateway.threading, "Timer", _Timer),
                  mock.patch.object(gateway, "_launcher_bind", {"mode": "standalone"}),
                  mock.patch.object(gateway.os, "kill", lambda pid, sig: order.append("kill")),
                  mock.patch.object(gateway.signal, "raise_signal", lambda sig: order.append("signal")),
                  mock.patch.object(gateway.os, "execv", lambda *a: order.append("execv")),
                  mock.patch.object(sys, "stdout", closed_out), mock.patch.object(sys, "stderr", closed_err)):
            p.start()
            self.addCleanup(p.stop)

    def _first_record_after_deadline(self, decided):
        """The deadline stands before the first record of the end."""
        self.assertIn("deadline", self.order, self.order)
        first = min(i for i, e in enumerate(self.order) if e in decided or e == "console")
        self.assertLess(self.order.index("deadline"), first, self.order)

    def test_the_helper_s_stale_rejection(self):
        gateway._on_helper_rejected("watchdog", "stale_instance")
        self._first_record_after_deadline({"emit:session.helper_rejected", "emit:session.shutdown_requested"})
        self.assertEqual(self.order[-1], "signal")

    def test_the_reconnect_that_sees_another_instance(self):
        with mock.patch.object(sys, "stdout", io.StringIO()), mock.patch.object(sys, "stderr", io.StringIO()):
            self.assertTrue(gateway.try_connect_lcnc())     # the first connect binds (its [VINIT] lines print)
        del self.order[:]
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": (pid, 999)   # another start
        self.assertFalse(gateway.try_connect_lcnc())
        self._first_record_after_deadline({"emit:lcnc.link_revoked", "emit:session.instance_changed",
                                           "emit:session.instance_ended"})
        self.assertIn("signal", self.order)

    def test_the_nml_self_restart(self):
        gateway._self_restart("test: poisoned")
        self.assertEqual(self.order[:2], ["deadline", "console"])
        self.assertEqual(self.order[-1], "execv")

    def test_the_self_restart_s_caller_prints_nothing_itself(self):
        tree = ast.parse((HERE / "gateway.py").read_text(), "gateway.py")
        for node in ast.walk(tree):
            if isinstance(node, ast.If) and any(isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_self_restart"
                                                for c in ast.walk(node)):
                prints = [c.lineno for c in ast.walk(node) if isinstance(c, ast.Call)
                          and getattr(c.func, "id", "") == "print"]
                self.assertEqual(prints, [], "a bare print beside _self_restart")


class _Exited(BaseException):
    """os._exit, stubbed: nothing after it may run."""


class ADeadlineThatCannotBeArmedEndsAtOnce(unittest.TestCase):
    """Codex R371 VM-I14 rest: the timer cannot start (no thread left). The
    flag stood, the record said `deadline_s: None`, and the diagnostic after
    it could block for good. Now the arm itself ends the process — os._exit(1)
    and NO output: at every decided end nothing runs between the failed start
    and the exit — no trace, no console, no HAL disconnect, no signal, no
    execv. The real emit and console over a failing sink, closed consoles."""

    def setUp(self):
        restore_after(self)
        saved = {k: getattr(gateway, k) for k in (
            "_bound_instance", "_instance_ended", "_shutdown_requested", "_lcnc_pid", "_get_lcnc_pid",
            "_nml_connectable", "_hal_disconnect")}
        self.addCleanup(lambda: [setattr(gateway, k, v) for k, v in saved.items()])
        self.addCleanup(setattr, session_bind, "instance_for_pid", session_bind.instance_for_pid)
        p = mock.patch.object(gateway, "_shutdown_deadline", None, create=True)
        p.start()
        self.addCleanup(p.stop)
        gateway._bound_instance = None
        gateway._instance_ended = False
        gateway._shutdown_requested = False
        gateway._nml_connectable = lambda: True
        gateway._get_lcnc_pid = lambda: os.getpid()        # a real, live /proc entry
        swap_connection(None)
        _without_gc_print(self)
        self.order = []
        order = self.order
        gateway._hal_disconnect = lambda: order.append("hal_disconnect")

        class _NoThread:
            def __init__(self, interval, fn, args=None):
                self.daemon = False

            def start(self):
                order.append("timer-failed")
                raise RuntimeError("can't start new thread")

        def _exit(code):
            order.append(f"exit({code})")
            raise _Exited()
        _failing_trace(self)
        real_emit, real_console = lcnc_trace.emit, lcnc_trace.console

        def _emit(tag, **kw):
            order.append(f"emit:{tag}")
            real_emit(tag, **kw)

        def _console(text):
            order.append("console")
            real_console(text)
        closed_out, closed_err = io.StringIO(), io.StringIO()
        closed_out.close()
        closed_err.close()
        for p in (mock.patch.object(lcnc_trace, "emit", _emit), mock.patch.object(lcnc_trace, "console", _console),
                  mock.patch.object(gateway.linuxcnc, "__lcnc_fake__", False),
                  mock.patch.object(gateway.threading, "Timer", _NoThread),
                  mock.patch.object(gateway, "_launcher_bind", {"mode": "standalone"}),
                  mock.patch.object(gateway.os, "kill", lambda pid, sig: order.append("kill")),
                  mock.patch.object(gateway.signal, "raise_signal", lambda sig: order.append("signal")),
                  mock.patch.object(gateway.os, "execv", lambda *a: order.append("execv")),
                  mock.patch.object(gateway.os, "_exit", _exit),
                  mock.patch.object(sys, "stdout", closed_out), mock.patch.object(sys, "stderr", closed_err)):
            p.start()
            self.addCleanup(p.stop)

    def _ends_at_once(self, end):
        with self.assertRaises(_Exited):
            end()
        self.assertEqual(self.order, ["timer-failed", "exit(1)"])
        self.assertIsNone(gateway._shutdown_deadline)

    def test_the_shutdown_request(self):
        self._ends_at_once(lambda: gateway._request_process_shutdown("test: no thread"))
        self.assertTrue(gateway._shutdown_requested)

    def test_the_instance_end(self):
        gateway._bound_instance = (424242, 1)
        self._ends_at_once(lambda: gateway._on_instance_ended("test: no thread"))
        self.assertTrue(gateway._instance_ended)

    def test_the_helper_s_stale_rejection(self):
        self._ends_at_once(lambda: gateway._on_helper_rejected("watchdog", "stale_instance"))

    def test_the_reconnect_that_sees_another_instance(self):
        with mock.patch.object(sys, "stdout", io.StringIO()), mock.patch.object(sys, "stderr", io.StringIO()):
            self.assertTrue(gateway.try_connect_lcnc())     # the first connect binds: no end, no arm
        del self.order[:]
        session_bind.instance_for_pid = lambda pid, proc_root="/proc": (pid, 999)   # another start
        self._ends_at_once(gateway.try_connect_lcnc)

    def test_the_nml_self_restart(self):
        self._ends_at_once(lambda: gateway._self_restart("test: poisoned, no thread"))

    def test_an_armed_deadline_is_not_armed_again(self):
        gateway._shutdown_deadline = object()      # armed earlier: no second start, no exit
        self.assertTrue(gateway._arm_shutdown_deadline())
        self.assertEqual(self.order, [])


class ABlockedDiagnosticCannotOutliveTheDeadline(unittest.TestCase):
    """Codex R370 VM-I14, the blocking half, in a child process: the trace
    sink fails, stderr is the process guard over a FULL pipe nobody reads —
    logging's error report blocks inside the first emit. No guard against
    exceptions can end a blocked write; the deadline armed BEFORE it does:
    the child ends by itself with os._exit(1), the real timer, a short
    deadline. Both entry paths; no signal and no kill leave the child."""

    CHILD = textwrap.dedent("""
        import errno, io, logging, os, sys
        from pathlib import Path
        import fake_linuxcnc
        fake_linuxcnc.install()
        import gateway, lcnc_trace
        from link_fixture import connect_fake
        out, entry = Path(sys.argv[1]), sys.argv[2]
        class DiskFull:
            def write(self, s): raise OSError(errno.ENOSPC, "No space left on device")
            def flush(self): pass
        logger = logging.Logger("r370-blocked", level=logging.INFO)
        logger.addHandler(logging.StreamHandler(DiskFull()))
        lcnc_trace._initialized, lcnc_trace._logger, lcnc_trace._logger_failed = True, logger, False
        r, w = os.pipe()                       # the reader end stays open and unread
        os.set_blocking(w, False)
        try:
            while True:
                os.write(w, b"x" * 4096)
        except BlockingIOError:
            pass
        os.set_blocking(w, True)
        sys.stderr = lcnc_trace.ConsoleGuard(io.TextIOWrapper(os.fdopen(w, "wb", buffering=0), write_through=True), "stderr")
        sys.stdout = io.StringIO()
        gateway.SHUTDOWN_DEADLINE_S = 0.3
        if sys.argv[3:] == ["no-thread"]:      # Codex R371 VM-I14: the timer cannot start
            class _NoThread:
                def __init__(self, *a, **k): self.daemon = False
                def start(self):
                    (out / "timer-failed").write_text("RuntimeError: can't start new thread")
                    raise RuntimeError("can't start new thread")
            gateway.threading.Timer = _NoThread
        gateway.linuxcnc.__lcnc_fake__ = False
        gateway._launcher_bind = {"mode": "standalone"}
        gateway.os.kill = lambda *a: None
        gateway.signal.raise_signal = lambda *a: None
        (out / "entered").write_text(entry)
        if entry == "request":
            gateway._request_process_shutdown("test: blocked diagnostics")
        else:
            class _T:
                def addCleanup(self, *a, **k): pass
            connect_fake(_T())
            gateway._bound_instance = (424242, 1)
            gateway._on_instance_ended("test: blocked diagnostics")
        (out / "returned").write_text("the chain returned: nothing blocked")
        os._exit(0)
    """)

    def _run(self, entry, timer="real"):
        with tempfile.TemporaryDirectory() as d:
            try:
                r = subprocess.run([sys.executable, "-c", self.CHILD, d, entry, timer], cwd=HERE, timeout=20,
                                   capture_output=True, env={**os.environ, "LCNC_LOG_DIR": d})
            except subprocess.TimeoutExpired:
                self.fail(f"{entry}, {timer} timer: the child outlived its deadline")
            entered = (Path(d) / "entered").exists()
            returned = (Path(d) / "returned").exists()
            failed = (Path(d) / "timer-failed").exists()
        self.assertTrue(entered, r.stderr.decode(errors="replace")[-600:])
        self.assertEqual(failed, timer == "no-thread")
        self.assertFalse(returned, f"{entry}: the chain returned — the case proves nothing")
        self.assertEqual(r.returncode, 1, r.stderr.decode(errors="replace")[-600:])

    def test_the_shutdown_request(self):
        self._run("request")

    def test_the_instance_end(self):
        self._run("instance")

    def test_the_shutdown_request_without_a_thread(self):
        self._run("request", "no-thread")

    def test_the_instance_end_without_a_thread(self):
        self._run("instance", "no-thread")


class TheConsoleGuard(_Recording):
    def test_a_broken_pipe_is_dropped_and_traced_once(self):
        g = lcnc_trace.ConsoleGuard(_Raising(), "stdout")
        print("one", file=g, flush=True)
        print("two", file=g, flush=True)
        lost = [kw for t, kw in self.events if t == "console.lost"]
        self.assertEqual(len(lost), 1, self.events)
        self.assertEqual((lost[0]["stream"], lost[0]["exc_type"], lost[0]["errno"]),
                         ("stdout", "BrokenPipeError", errno.EPIPE))

    def test_a_new_failure_kind_is_traced_and_a_flush_that_gets_through_recovers(self):
        inner = _Raising()
        g = lcnc_trace.ConsoleGuard(inner, "stderr")
        g.write("x")
        inner.exc_factory = lambda: OSError(errno.EIO, "I/O error")
        g.flush()
        self.assertEqual([kw["exc_type"] for t, kw in self.events if t == "console.lost"],
                         ["BrokenPipeError", "OSError"])
        g._stream = io.StringIO()      # the reader is back
        g.write("y")
        g.flush()
        rec = [kw for t, kw in self.events if t == "console.recovered"]
        self.assertEqual(rec, [{"stream": "stderr", "dropped": 2}])

    def test_an_unbuffered_stream_s_empty_flush_is_no_recovery(self):
        # Unbuffered (PYTHONUNBUFFERED, the backend gate): the WRITE raises and
        # the flush of an empty buffer succeeds — that proves nothing left.
        class _WriteRaises:
            def write(self, s):
                raise BrokenPipeError(errno.EPIPE, "Broken pipe")

            def flush(self):
                pass
        g = lcnc_trace.ConsoleGuard(_WriteRaises(), "stdout")
        for _ in range(5):
            print("x", file=g, flush=True)
        self.assertEqual(self.tags(), ["console.lost"])

    def test_a_closed_stream_raises_nothing(self):
        s = io.StringIO()
        s.close()
        g = lcnc_trace.ConsoleGuard(s, "stdout")
        print("x", file=g, flush=True)
        self.assertIn("console.lost", self.tags())

    def test_the_stream_s_other_attributes_pass_through(self):
        s = io.StringIO()
        g = lcnc_trace.ConsoleGuard(s, "stdout")
        self.assertFalse(g.isatty())
        self.assertIs(g.wrapped, s)
        print("ok", file=g, flush=True)
        self.assertEqual(s.getvalue(), "ok\n")

    def test_guard_console_wraps_each_stream_once(self):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, "stdout", out), mock.patch.object(sys, "stderr", err):
            lcnc_trace.guard_console()
            first = sys.stdout
            lcnc_trace.guard_console()
            self.assertIs(sys.stdout, first)
            self.assertIs(sys.stdout.wrapped, out)
            self.assertIs(sys.stderr.wrapped, err)

    def test_console_never_raises(self):
        with mock.patch.object(sys, "stdout", _Raising()):
            lcnc_trace.console("a line nobody reads")
        self.assertIn("console.lost", self.tags())

    def test_an_emit_whose_stderr_report_fails_does_not_recurse(self):
        # emit's own failure report prints to stderr; through the guard that
        # failure traces again — the guard must not loop.
        g = lcnc_trace.ConsoleGuard(_Raising(), "stderr")
        calls = []

        def _emit(tag, **kw):
            calls.append(tag)
            print("emit's own report", file=g, flush=True)
        lcnc_trace.emit = _emit
        g.write("x")
        self.assertEqual(calls, ["console.lost"])


class AProcessSurvivesItsReaderGoing(unittest.TestCase):
    """A real child, a real pipe, a real EPIPE: the process that installed
    the crash hooks prints on and ends with its own exit code — buffered and
    unbuffered (the backend gate runs with PYTHONUNBUFFERED=1, where the write
    itself raises; the first version traced every line there)."""

    def test_prints_into_a_closed_pipe(self):
        for unbuffered in (False, True):
            with self.subTest(unbuffered=unbuffered):
                self._child(unbuffered)

    def _child(self, unbuffered):
        with tempfile.TemporaryDirectory() as logdir:
            child = textwrap.dedent("""
                import lcnc_trace
                lcnc_trace.init("console_probe")
                lcnc_trace.install_crash_hooks("console_probe")
                for i in range(64):
                    print("x" * 4096, flush=True)   # well past any pipe buffer
                print("after", flush=True)
                raise SystemExit(7)
            """)
            r, w = os.pipe()
            os.close(r)                              # the reader is gone before the first write
            env = dict(os.environ, LCNC_LOG_DIR=logdir, PYTHONPATH=str(HERE))
            env.pop("PYTHONUNBUFFERED", None)
            if unbuffered:
                env["PYTHONUNBUFFERED"] = "1"
            try:
                proc = subprocess.run([sys.executable, "-c", child], stdout=w,
                                      stderr=subprocess.PIPE, env=env, cwd=str(HERE), timeout=60)
            finally:
                os.close(w)
            self.assertEqual(proc.returncode, 7, proc.stderr.decode(errors="replace")[-2000:])
            events = [json.loads(line) for line in Path(logdir, "trace.ndjson").read_text().splitlines()]
            lost = [e for e in events if e["tag"] == "console.lost"]
            self.assertEqual(len(lost), 1, lost)
            self.assertEqual((lost[0]["stream"], lost[0]["errno"]), ("stdout", errno.EPIPE))
            self.assertFalse([e for e in events if e["tag"].startswith("crash.")], events)


class EachProcessGuardsBeforeItsFirstPrint(unittest.TestCase):
    """gateway, hal_reader and hal_watchdog: install_crash_hooks (which
    guards the console) is called before the first print in the file."""

    def test_install_precedes_every_print(self):
        for name in ("gateway.py", "hal_reader.py", "hal_watchdog.py"):
            tree = ast.parse((HERE / name).read_text(), name)
            installs, prints = [], []
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    f = node.func
                    if isinstance(f, ast.Attribute) and f.attr == "install_crash_hooks":
                        installs.append(node.lineno)
                    elif isinstance(f, ast.Name) and f.id == "print":
                        prints.append(node.lineno)
            # The install is a module-level statement, so it runs at import.
            top = [n.lineno for n in tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                   and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == "install_crash_hooks"]
            self.assertEqual(len(top), 1, name)
            self.assertTrue(prints, name)
            self.assertLess(top[0], min(prints), name)

    def test_the_shutdown_chain_prints_only_through_console(self):
        tree = ast.parse((HERE / "gateway.py").read_text(), "gateway.py")
        chain = {"_on_instance_ended", "_request_process_shutdown", "_self_restart", "_on_helper_rejected"}
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in chain:
                chain.discard(node.name)
                bare = [c.lineno for c in ast.walk(node) if isinstance(c, ast.Call)
                        and isinstance(c.func, ast.Name) and c.func.id == "print"]
                self.assertEqual(bare, [], node.name)
        self.assertEqual(chain, set())


if __name__ == "__main__":
    unittest.main()

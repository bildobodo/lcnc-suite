"""A console write never stops a chain (package 3b, the 3a merge gate's find).

The install probe of the 3a merge gate traced `crash.asyncio_unhandled`
BrokenPipeError out of `_on_instance_ended`: its print ran after the latch
and before the trace, the HAL disconnect and the shutdown request, the
launcher's tee was gone, the print raised, the watch task died — and only an
outside SIGTERM ended the gateway. These tests hold:

- the shutdown chain runs to its end under a stdout that raises — on the RAW
  stream too (the chain does not lean on the process guard);
- `_request_process_shutdown` arms its hard deadline before any console line
  and signals with a stdout that raises;
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
from link_fixture import connect_fake, restore_after  # noqa: E402

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
        self.assertEqual(kinds[0], "session.shutdown_requested")
        self.assertEqual(kinds[1], "deadline")           # before any console line
        self.assertIn("console.lost", kinds)
        self.assertLess(kinds.index("deadline"), kinds.index("console.lost"))
        self.assertEqual(self.order[-1][0], "kill")
        self.assertEqual(self.order[1][1:], (5.0, os._exit))

    def test_a_standalone_gateway_signals_itself_with_a_raising_stdout(self):
        self._request(launcher=False)
        kinds = [e[0] if e[0] != "emit" else e[1] for e in self.order]
        self.assertEqual(kinds[:2], ["session.shutdown_requested", "deadline"])
        self.assertEqual(self.order[-1][0], "raise")


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
    the crash hooks prints on and ends with its own exit code."""

    def test_prints_into_a_closed_pipe(self):
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
        chain = {"_on_instance_ended", "_request_process_shutdown"}
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in chain:
                chain.discard(node.name)
                bare = [c.lineno for c in ast.walk(node) if isinstance(c, ast.Call)
                        and isinstance(c.func, ast.Name) and c.func.id == "print"]
                self.assertEqual(bare, [], node.name)
        self.assertEqual(chain, set())


if __name__ == "__main__":
    unittest.main()

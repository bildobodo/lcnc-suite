"""The toolsetter basis (M600 in the preview, plan section 2, Codex R102–R104).

What the bundled tool_touch_off.ngc would read are the INTERPRETER's values,
not the parameter file's: a value saved there is not one the interpreter took
over (VP102-01). The gateway books per key the value and where it is known
from — applied (a chunk of _apply_probe_vars ended RCS_DONE), read (a
confirmed read: synch RCS_DONE + a new inode), assumed (the file, unconfirmed:
at start, after an MDI line, a macro or a program that may write it), unknown
(a chunk failed, timed out or was cut short) — the parse ctx carries it, a
change re-parses a program that runs the routine, and an unconfirmed basis is
read back once while such a program is loaded.

The task double (test_g30._Task) stands in for LinuxCNC's interpreter: an MDI
that assigns `#N=v` words, a synch that saves like save_parameters — or not.
"""
import asyncio
import re
import threading
import unittest

from test_g30 import _G30Case, _run
import gateway  # noqa: E402  (test_g30 installed the fake binding first)
from gateway_util import TOOLSETTER_BASIS_KEYS, RemapEnv, toolsetter_basis_view  # noqa: E402

FILE = {k: float(i) for i, k in enumerate(TOOLSETTER_BASIS_KEYS)}


class _BasisCase(_G30Case):
    def setUp(self):
        super().setUp()
        # every toolsetter key in the interpreter and in the file
        self.task.params.update(FILE)
        self.task.save()
        saved = (dict(gateway._ts_basis), gateway._ts_basis_version, gateway._ts_readback_task,
                 gateway._ts_readback_tried, gateway._ts_reparse_for)
        self.addCleanup(lambda: [setattr(gateway, n, v) for n, v in zip(
            ("_ts_basis", "_ts_basis_version", "_ts_readback_task", "_ts_readback_tried", "_ts_reparse_for"), saved)])
        gateway._ts_basis = {}
        gateway._ts_basis_version = 0
        gateway._ts_readback_task = gateway._ts_readback_tried = gateway._ts_reparse_for = None
        gateway.STAT.enabled = True
        # a configuration without remaps (the double has no INI: unknown —
        # every line may write anything; TestRemapBodies covers both)
        remap_env = gateway._remap_env
        self._real_remap_env = remap_env
        self.addCleanup(lambda: setattr(gateway, "_remap_env", remap_env))
        gateway._remap_env = lambda: RemapEnv([], [])
        # an MDI line of any text: the interpreter assigns its `#N = v` words
        task = self.task

        def mdi(text):
            task.calls.append(("mdi", text))
            task._maybe_block("mdi")
            if task.mdi_takes:
                for n, v in re.findall(r"#(\d+)\s*=\s*([-\d.]+)", re.sub(r"\([^)]*\)", "", text)):
                    task.params[int(n)] = float(v)
            task._last = task.mdi_rc
        task.mdi = mdi

    def origin(self, k):
        return gateway._ts_basis[k]["origin"]

    def value(self, k):
        return gateway._ts_basis[k]["value"]


class TestBooking(_BasisCase):

    def test_at_start_every_key_is_assumed_from_the_file(self):
        ctx = gateway._toolsetter_parse_ctx()
        self.assertEqual(ctx["view"]["state"], "assumed")
        self.assertEqual({self.origin(k) for k in TOOLSETTER_BASIS_KEYS}, {"assumed"})
        self.assertEqual(self.value(3009), FILE[3009])
        self.assertEqual(ctx["patches"], {"3116": "0.000000"}, "an assumed key keeps the file's value")
        self.assertIsNone(ctx["unpredictable"])

    def test_a_file_without_the_keys_is_never_stored(self):
        for k in TOOLSETTER_BASIS_KEYS:
            del self.task.params[k]
        self.task.save()
        self.assertEqual(gateway._toolsetter_parse_ctx()["unpredictable"], "toolsetter_not_set_up")

    def test_each_chunk_that_ended_rcs_done_is_applied_one_that_failed_unknown(self):
        # 24 keys do not fit one 250-character MDI line: two chunks — the
        # second one refused (Codex R103: the take-over is no transaction)
        vals = {str(k): 1000.0 + k for k in TOOLSETTER_BASIS_KEYS}
        calls = []
        mdi = self.task.mdi

        def failing_second(text):
            calls.append(text)
            mdi(text)
            if len(calls) == 2:
                self.task._last = 3      # RCS_ERROR
        failing_second.__name__ = "mdi"     # the binding's name: _cmd_blocking books before the send
        self.task.mdi = failing_second
        _file_ok, mdi_ok = _run(gateway._apply_probe_vars(vals, True))
        self.assertFalse(mdi_ok)
        self.assertEqual(len(calls), 2)
        first = [int(w[1:].split("=")[0]) for w in calls[0].split()]
        second = [int(w[1:].split("=")[0]) for w in calls[1].split()]
        for k in first:
            self.assertEqual((self.origin(k), self.value(k)), ("applied", 1000.0 + k), k)
        for k in second:
            self.assertEqual(self.origin(k), "unknown", k)
        ctx = gateway._toolsetter_parse_ctx()
        self.assertEqual(ctx["unpredictable"], "toolsetter_unknown")
        self.assertEqual(ctx["view"]["unknown"], sorted(second))

    def test_a_cancel_in_a_chunk_makes_it_unknown_and_leaves_the_unsent_ones(self):
        # an abort while the second chunk runs (the third never goes): the
        # first is applied, the second unknown, the third as it was
        vals = {str(k): 2000.0 for k in range(3000, 3004)}      # more words first: three chunks
        vals.update({str(k): 2000.0 + k for k in TOOLSETTER_BASIS_KEYS})
        gateway._ts_ensure()
        entered, release = threading.Event(), threading.Event()
        calls = []
        mdi = self.task.mdi

        def blocking_second(text):
            calls.append(text)
            if len(calls) == 2:
                entered.set()
                release.wait(5)
            mdi(text)
        blocking_second.__name__ = "mdi"     # the binding's name: _cmd_blocking books before the send
        self.task.mdi = blocking_second

        async def go():
            t = asyncio.create_task(gateway._apply_probe_vars(vals, True))
            while not entered.is_set():
                await asyncio.sleep(0.01)
            t.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await t
        _run(go())
        keys = lambda text: [int(w[1:].split("=")[0]) for w in text.split()]   # noqa: E731
        self.assertEqual(len(calls), 2)
        for k in keys(calls[0]):
            if k in TOOLSETTER_BASIS_KEYS:
                self.assertEqual(self.origin(k), "applied", k)
        for k in keys(calls[1]):
            if k in TOOLSETTER_BASIS_KEYS:
                self.assertEqual(self.origin(k), "unknown", k)
        sent = set(keys(calls[0])) | set(keys(calls[1]))
        unsent = [k for k in TOOLSETTER_BASIS_KEYS if k not in sent]
        self.assertTrue(unsent, "the third chunk carried toolsetter keys")
        for k in unsent:
            self.assertEqual((self.origin(k), self.value(k)), ("assumed", FILE[k]), k)

    def test_an_mdi_line_that_writes_a_key_makes_it_assumed(self):
        _run(gateway._apply_probe_vars({"3009": 7.0}, True))
        self.assertEqual(self.origin(3009), "applied")
        r = self.send({"cmd": "mdi", "text": "#3009 = 4 (the operator's own)"})
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.origin(3009), "assumed")
        self.assertEqual(self.origin(3010), "assumed")   # never confirmed in this process
        # a line that writes none of them changes nothing
        v = gateway._ts_basis_version
        self.send({"cmd": "mdi", "text": "G0 X1"})
        self.assertEqual(gateway._ts_basis_version, v)

    def test_an_mdi_call_into_another_file_makes_every_key_assumed(self):
        _run(gateway._apply_probe_vars({str(k): 5.0 for k in TOOLSETTER_BASIS_KEYS}, True))
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "confirmed")
        self.send({"cmd": "mdi", "text": "o<probe_x> call"})
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "assumed")


class TestReadBack(_BasisCase):

    def test_a_confirmed_read_books_the_interpreters_values(self):
        # the file holds 3009 = 3 (a gateway write the interpreter never took);
        # the interpreter holds 9 — the synch publishes ITS values
        gateway._ts_ensure()
        self.task.params[3009] = 9.0
        _run(gateway._ts_read_back("/p.ngc"))
        self.assertEqual((self.origin(3009), self.value(3009)), ("read", 9.0))
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "confirmed")
        self.assertEqual(self.task.names(), ["synch"], "nothing written to the machine")

    def test_a_synch_that_publishes_no_new_file_proves_nothing(self):
        gateway._ts_ensure()
        v = gateway._ts_basis_version
        self.task.synch_saves = False
        _run(gateway._ts_read_back("/p.ngc"))
        self.assertEqual(gateway._ts_basis_version, v)
        self.assertEqual(self.origin(3009), "assumed")

    def test_a_refused_synch_proves_nothing(self):
        gateway._ts_ensure()
        self.task.synch_rc = 3
        _run(gateway._ts_read_back("/p.ngc"))
        self.assertEqual(self.origin(3009), "assumed")

    def test_an_abort_cancels_the_read_back(self):
        gateway._ts_ensure()
        entered, release = threading.Event(), threading.Event()
        self.task.block = ("synch", entered, release)

        async def go():
            gateway._ts_readback_task = asyncio.create_task(gateway._ts_read_back("/p.ngc"))
            while not entered.is_set():
                await asyncio.sleep(0.01)
            gateway._preempt_inflight("abort", 0)
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await gateway._ts_readback_task
        _run(go())
        self.assertEqual(self.origin(3009), "assumed")


class _St:
    active_file = "/p.ngc"
    current_vel = 0.0


class TestEdges(_BasisCase):

    def setUp(self):
        super().setUp()
        saved = (gateway._bulk.published_toolsetter, gateway._bulk.published_ctx, gateway._bulk.last_file)
        self.addCleanup(lambda: [setattr(gateway._bulk, n, v) for n, v in zip(
            ("published_toolsetter", "published_ctx", "last_file"), saved)])
        gateway._ts_ensure()
        gateway._bulk.published_toolsetter = {"routine": True, "writes": []}
        gateway._bulk.published_ctx = {"toolsetter": {"version": gateway._ts_basis_version}}
        gateway._bulk.last_file = "/p.ngc"

    def test_a_changed_basis_re_parses_a_program_that_runs_the_routine_once(self):
        self.assertIsNone(gateway._ts_drift_reason())
        _run(gateway._apply_probe_vars({"3009": 8.0}, True))
        self.assertEqual(gateway._ts_drift_reason(), "toolsetter")
        gateway._ts_reparse_asked()
        self.assertIsNone(gateway._ts_drift_reason(), "once per version")
        gateway._bulk.published_toolsetter = {"routine": False, "writes": []}
        _run(gateway._apply_probe_vars({"3009": 9.0}, True))
        self.assertIsNone(gateway._ts_drift_reason(), "a program without the routine")

    def test_an_unconfirmed_basis_is_read_back_once_while_the_program_is_loaded(self):
        self.assertTrue(gateway._ts_read_back_due(_St))
        gateway._ts_readback_tried = (gateway._ts_basis_version, "/p.ngc")
        self.assertFalse(gateway._ts_read_back_due(_St), "once per version and program")
        gateway._ts_readback_tried = None
        moving = type("M", (_St,), {"current_vel": 3.0})
        self.assertFalse(gateway._ts_read_back_due(moving))
        gateway._bulk.published_toolsetter = {"routine": False, "writes": []}
        self.assertFalse(gateway._ts_read_back_due(_St), "a program without the routine")
        gateway._bulk.published_toolsetter = {"routine": True, "writes": []}
        _run(gateway._ts_read_back("/p.ngc"))
        self.assertFalse(gateway._ts_read_back_due(_St), "confirmed")

    def test_a_program_start_makes_the_keys_its_text_writes_assumed(self):
        _run(gateway._apply_probe_vars({str(k): 5.0 for k in TOOLSETTER_BASIS_KEYS}, True))
        loaded = gateway._status_runtime.program
        saved = loaded.loaded
        self.addCleanup(lambda: setattr(loaded, "loaded", saved))
        loaded.loaded = "/p.ngc"
        gateway._bulk.published_toolsetter = {"routine": True, "writes": [3009]}
        gateway._ts_mark_assumed(gateway._ts_program_writes())
        self.assertEqual(self.origin(3009), "assumed")
        self.assertEqual(self.origin(3010), "applied")
        # a program the scan does not vouch for (another file, no scan): any
        gateway._bulk.last_file = "/other.ngc"
        self.assertIsNone(gateway._ts_program_writes())


if __name__ == "__main__":
    unittest.main()


class TestStartWrites(_BasisCase):

    def test_a_cancel_after_the_line_went_out_still_books_it(self):
        # Codex R105 VP-I60: the interpreter took `#3009=4`, then an abort
        # cancelled the handler while the command thread ran — _cmd_blocking
        # waits for the thread and propagates the cancel; the booking after
        # the await was skipped and #3009 stayed `read` 3 over an interpreter
        # holding 4. Booked before the send, it is `assumed`.
        from test_command_dispatch import _payload
        gateway._ts_book({**FILE, 3009: 3.0}, "read")
        self.task.params[3009] = 3.0
        gateway._skip_flag_unknown = False
        gateway._shared_status = _payload(inpos=True, current_vel=0.0)
        entered, release = threading.Event(), threading.Event()
        mdi = self.task.mdi

        def blocked(text):
            mdi(text)
            entered.set()
            release.wait(3)
        blocked.__name__ = "mdi"      # the binding's method name: _start_kind reads it
        self.task.mdi = blocked

        async def go():
            t = asyncio.ensure_future(gateway.handle_command({"cmd": "mdi", "text": "#3009=4"}, True))
            while not entered.is_set():
                await asyncio.sleep(0.01)
            t.cancel()
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await t
        _run(go())
        self.assertEqual(self.task.params[3009], 4.0, "the interpreter took it")
        self.assertEqual(self.origin(3009), "assumed")
        self.assertEqual(self.origin(3010), "read", "a key the line does not write keeps its basis")


class TestRemapBodies(_BasisCase):
    """Codex R106 (VP-I59 rest): a remapped code runs a body the line does
    not show — `M200` whose body writes #3009 left a confirmed basis over an
    interpreter holding 4."""

    def _env(self, body):
        import os
        import tempfile
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        with open(os.path.join(d, "setter_write.ngc"), "w") as f:
            f.write(body)
        return RemapEnv(["M200 modalgroup=10 ngc=setter_write"], [d])

    def _mdi(self, text):
        from test_command_dispatch import _payload
        gateway._skip_flag_unknown = False
        gateway._shared_status = _payload(inpos=True, current_vel=0.0)
        return _run(gateway.handle_command({"cmd": "mdi", "text": text}, True))

    def test_a_remapped_code_books_what_its_body_writes(self):
        gateway._remap_env = lambda: self._env("o<setter_write> sub\n#3009=4\no<setter_write> endsub\n")
        gateway._ts_book({**FILE}, "read")
        self.assertTrue(self._mdi("M200")["ok"])
        self.assertEqual(self.origin(3009), "assumed")
        self.assertEqual(self.origin(3010), "read", "a key the body does not write keeps its basis")
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "assumed")

    def test_a_body_that_writes_nothing_keeps_the_basis(self):
        gateway._remap_env = lambda: self._env("o<setter_write> sub\n#<_x>=4\nG0 X1\no<setter_write> endsub\n")
        gateway._ts_book({**FILE}, "read")
        self.assertTrue(self._mdi("M200")["ok"])
        self.assertEqual({self.origin(k) for k in TOOLSETTER_BASIS_KEYS}, {"read"})

    def test_the_gateway_reads_the_remaps_of_the_ini_it_runs_with(self):
        import os
        import tempfile
        import unittest.mock
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d, True)
        with open(os.path.join(d, "setter_write.ngc"), "w") as f:
            f.write("o<setter_write> sub\n#3009=4\no<setter_write> endsub\n")
        ini_path = os.path.join(d, "machine.ini")

        class _Ini:
            def __init__(self, path):
                if path != ini_path:
                    raise OSError(path)

            def find(self, section, key):
                return {("RS274NGC", "SUBROUTINE_PATH"): "."}.get((section, key))

            def findall(self, section, key):
                return ["M200 modalgroup=10 ngc=setter_write"] if (section, key) == ("RS274NGC", "REMAP") else []
        stat = gateway.STAT
        with unittest.mock.patch.object(gateway.linuxcnc, "ini", _Ini):
            # the INI LinuxCNC runs with: its remaps, its folder on the path
            with unittest.mock.patch.object(stat, "ini_filename", ini_path, create=True):
                env = self._real_remap_env()
                self.assertTrue(env.known)
                self.assertEqual(env.effect(("M", 200))[0], frozenset({3009}))
            # no INI, or one that cannot be read: unknown — every line may write
            with unittest.mock.patch.object(stat, "ini_filename", None, create=True):
                self.assertFalse(self._real_remap_env().known)
            with unittest.mock.patch.object(stat, "ini_filename", ini_path + ".gone", create=True):
                self.assertFalse(self._real_remap_env().known)

    def test_remaps_not_read_make_every_line_a_writer(self):
        # the gateway could not read the INI: any word may be a remapped code
        gateway._remap_env = RemapEnv.unknown
        gateway._ts_book({**FILE}, "read")
        self.assertTrue(self._mdi("G0 X1")["ok"])
        self.assertEqual({self.origin(k) for k in TOOLSETTER_BASIS_KEYS}, {"assumed"})


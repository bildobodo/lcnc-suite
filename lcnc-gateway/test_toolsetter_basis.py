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
from link_fixture import FakeConnection, current, swap_connection  # noqa: E402
from gateway_util import (TOOLSETTER_BASIS_KEYS, RemapEnv, toolsetter_basis_view,  # noqa: E402
                          toolsetter_ctx, toolsetter_inputs_equal)
from unittest import mock  # noqa: E402

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
        current().stat.enabled = True
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

    def test_values_done_on_a_replaced_link_are_unknown_not_applied(self):
        """Codex R360 VM-I06, the class inside commands: an MDI chunk whose
        Link a reconnect replaced during its wait went out — its effect on
        the new Link is not confirmed: booked unknown (the next start writes
        it again), and a #3116=0 there vouches nothing."""
        saved = gateway._skip_flag_unknown
        self.addCleanup(setattr, gateway, "_skip_flag_unknown", saved)
        gateway._skip_flag_unknown = True
        mdi = self.task.mdi

        def replaced_after_the_write(text):
            mdi(text)
            swap_connection(FakeConnection(stat=current().stat))
        replaced_after_the_write.__name__ = "mdi"
        self.task.mdi = replaced_after_the_write

        async def pinned():
            with gateway._pinned_link():
                return await gateway._apply_probe_vars_detail({"3009": 7.0, "3116": 0}, True)
        r = _run(pinned())
        self.assertFalse(r["mdi_set"])
        self.assertEqual(self.origin(3009), "unknown")
        self.assertTrue(gateway._skip_flag_unknown, "a #3116=0 done on a replaced Link vouched the flag")

    def test_values_done_on_their_own_link_are_applied(self):
        saved = gateway._skip_flag_unknown
        self.addCleanup(setattr, gateway, "_skip_flag_unknown", saved)
        gateway._skip_flag_unknown = True

        async def pinned():
            with gateway._pinned_link():
                return await gateway._apply_probe_vars_detail({"3009": 7.0, "3116": 0}, True)
        r = _run(pinned())
        self.assertTrue(r["mdi_set"], r)
        self.assertEqual(self.origin(3009), "applied")
        self.assertFalse(gateway._skip_flag_unknown)

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

    def test_a_read_back_in_auto_sends_nothing_and_confirms_nothing(self):
        # a loaded program leaves the task in AUTO, where LinuxCNC refuses
        # task_plan_synch and the switch to AUTO could abort a start that
        # lands meanwhile (Codex R118 VP-I71): the basis stays assumed
        from test_g30 import linuxcnc
        gateway._ts_ensure()
        self.task.params[3009] = 9.0
        current().stat.task_state, current().stat.task_mode = linuxcnc.STATE_ON, linuxcnc.MODE_AUTO
        _run(gateway._ts_read_back("/p.ngc"))
        self.assertEqual(self.origin(3009), "assumed")
        self.assertEqual(self.task.calls, [], "nothing sent")

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
        # machine on in AUTO (where a load leaves the task): not due, not
        # tried — LinuxCNC takes no synch there (Codex R118 VP-I71); due
        # once the task leaves AUTO
        from test_g30 import linuxcnc
        in_auto = type("InAuto", (_St,), {"state": linuxcnc.STATE_ON, "task_mode": linuxcnc.MODE_AUTO})
        self.assertFalse(gateway._ts_read_back_due(in_auto))
        in_mdi = type("InMdi", (_St,), {"state": linuxcnc.STATE_ON, "task_mode": linuxcnc.MODE_MDI})
        self.assertTrue(gateway._ts_read_back_due(in_mdi))
        self.assertTrue(gateway._ts_read_back_due(_St))
        gateway._ts_readback_tried = gateway._ts_attempt_key()
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


def _basis(origin="read", **over):
    """A basis of every key from FILE with `origin`; `over`: key → (value, origin)."""
    b = {k: {"value": v, "origin": origin, "t": 1.0} for k, v in FILE.items()}
    for k, (v, o) in over.items():
        b[int(k)] = {"value": v, "origin": o, "t": 2.0}
    return b


class TestConfirmedEquality(unittest.TestCase):
    """P2a-1 (Codex R427 MT427-02, the six MT418-02 cases): two toolsetter
    inputs are equal only when both are fully CONFIRMED with equal patches."""

    def eq(self, a, b):
        return toolsetter_inputs_equal(toolsetter_ctx(a, 1), toolsetter_ctx(b, 2))

    def test_the_same_confirmed_values_applied_or_read_are_one_input(self):
        self.assertTrue(self.eq(_basis("read"), _basis("applied")))
        self.assertTrue(self.eq(_basis("read"), _basis("read")))

    def test_the_same_value_of_unknown_origin_is_not(self):
        self.assertFalse(self.eq(_basis("read", **{"3009": (None, "unknown")}), _basis("read")))

    def test_an_assumed_value_is_equal_to_nothing(self):
        same = _basis("read", **{"3009": (FILE[3009], "assumed")})
        self.assertFalse(self.eq(same, _basis("read")), "assumed → read")
        self.assertFalse(self.eq(same, same), "assumed ↔ assumed with the same booking")

    def test_a_missing_or_changed_value_is_not(self):
        missing = _basis("read")
        del missing[3009]
        self.assertFalse(self.eq(missing, _basis("read")))
        self.assertFalse(self.eq(_basis("read", **{"3009": (99.0, "read")}), _basis("read")))

    def test_a_failed_read_back_leaves_it_unequal(self):
        """A failed read-back books nothing: the basis stays assumed."""
        assumed = _basis("assumed")
        self.assertFalse(self.eq(assumed, _basis("read")))

    def test_nothing_set_up_is_equal_to_nothing(self):
        empty = {k: {"value": None, "origin": "assumed", "t": 1.0} for k in TOOLSETTER_BASIS_KEYS}
        self.assertFalse(self.eq(empty, empty))
        self.assertFalse(toolsetter_inputs_equal(None, toolsetter_ctx(_basis("read"), 1)))

    def test_the_file_replaced_between_booking_and_copy_proves_nothing(self):
        """Codex R427's probe: assumed 10 booked, the worker's copy holds 20 —
        the assumed key is no patch, the worker reads 20; equality with a
        confirmed 10 (or 20) is never claimed."""
        import os
        import tempfile
        from gcode_canon import apply_var_patches
        from gateway_util import read_var_snapshot
        booked = _basis("read", **{"3014": (10.0, "assumed")})
        ctx = toolsetter_ctx(booked, 1)
        self.assertNotIn("3014", ctx["patches"])
        with tempfile.TemporaryDirectory() as td:
            copy = os.path.join(td, "linuxcnc.var")     # the worker's copy, written after the booking
            with open(copy, "w") as f:
                f.write("".join(f"{k}\t{(20.0 if k == 3014 else v):.6f}\n" for k, v in FILE.items()))
            apply_var_patches(copy, ctx["patches"])
            _ino, vals = read_var_snapshot(copy, ["3014"])
        self.assertEqual(vals["3014"], 20.0, "the worker reads the copy's 20")
        # the published parse read 20 from its copy under "assumed 10"; the
        # book still says "assumed 10" a revision later — the booking proves
        # nothing about what the worker read: never equal
        self.assertFalse(toolsetter_inputs_equal(ctx, toolsetter_ctx(booked, 2)))
        for confirmed in (10.0, 20.0):
            self.assertFalse(toolsetter_inputs_equal(ctx, toolsetter_ctx(_basis("read", **{"3014": (confirmed, "read")}), 2)))

    def test_equality_names_no_connection(self):
        """The basis is the process's (session binding): a connection change
        changes nothing the comparison reads."""
        a, b = toolsetter_ctx(_basis("read"), 1), toolsetter_ctx(_basis("applied"), 7)
        self.assertEqual(set(a) | set(b), {"version", "patches", "unpredictable", "view"})


class _HoldBase(_BasisCase):
    """A confirmed basis published for a program that runs the routine; the
    trace recorded; the poll and the measured probe operation as helpers."""

    def setUp(self):
        super().setUp()
        names = ("_ts_readback_outcome", "_ts_hold_anchor", "_ts_hold_said", "_ts_readback_outcomes",
                 "_ts_readback_current")
        saved = [getattr(gateway, n) for n in names]
        self.addCleanup(lambda: [setattr(gateway, n, v) for n, v in zip(names, saved)])
        gateway._ts_readback_outcome = gateway._ts_hold_anchor = gateway._ts_readback_current = None
        gateway._ts_readback_outcomes = __import__("collections").OrderedDict()
        gateway._ts_hold_said = (None, frozenset())
        bulk = ("published_toolsetter", "published_ctx", "last_file", "published_source")
        saved_b = [getattr(gateway._bulk, n) for n in bulk]
        self.addCleanup(lambda: [setattr(gateway._bulk, n, v) for n, v in zip(bulk, saved_b)])
        gateway._bulk.published_toolsetter = {"routine": True, "writes": []}
        gateway._bulk.last_file = "/p.ngc"
        gateway._bulk.published_source = "src-1"
        self.events = []
        real = gateway._trace.emit

        def rec(tag, level="info", msg="", **fields):
            self.events.append((tag, fields))
            return real(tag, level, msg, **fields)
        p = mock.patch.object(gateway._trace, "emit", side_effect=rec)
        p.start()
        self.addCleanup(p.stop)
        # a confirmed basis, published
        gateway._ts_ensure()
        _run(gateway._ts_read_back("/p.ngc"))
        self.publish()

    def publish(self):
        """The current input became the published parse's."""
        gateway._bulk.published_ctx = {"toolsetter": gateway._toolsetter_parse_ctx()}

    def tags(self, tag):
        return [f for t, f in self.events if t == tag]

    def poll(self, st=_St):
        """One idle drift tick's toolsetter step; the read-back it may start
        is awaited to its end."""
        async def go():
            r = gateway._ts_poll(st)
            task = gateway._ts_readback_task
            if task is not None and not task.done():
                await task
            return r
        return _run(go())

    def probe_op(self, value=None):
        """The measured probe operation (machine day 13:48): the MDI line
        #3014=v (assumed, then applied), the routine call (every key
        assumed)."""
        v = FILE[3014] if value is None else value
        _run(gateway._apply_probe_vars({"3014": v}, True))
        gateway._ts_mark_assumed(None)



class TestHoldAndAttempt(_HoldBase):
    """P2a-1/-2 at the handler level (Codex R427/R428): the attempt per
    (revision, program), the edge held for the one read-back, its booked
    outcome, the 30 s bound, the masked reason."""

    def test_the_measured_probe_sequence_parses_nothing(self):
        self.probe_op()
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "assumed")
        self.assertIsNone(self.poll(), "the tick that starts the read-back reports no drift")
        self.assertEqual(toolsetter_basis_view(gateway._ts_basis)["state"], "confirmed")
        self.assertIsNone(gateway._ts_drift_reason(), "read back the same: equal, no parse")
        self.assertIsNone(gateway._ts_open_drift(), "a start is verified on the toolsetter side")
        self.assertEqual([f["why"] for f in self.tags("gcode.reparse_toolsetter_held")], ["read_back"])

    def test_a_changed_value_parses_once(self):
        self.probe_op(value=FILE[3014] + 1)
        self.assertIsNone(self.poll(), "held for the read-back")
        self.assertEqual(self.poll(), "toolsetter", "confirmed and different: one parse")
        gateway._ts_reparse_asked()
        self.assertIsNone(self.poll(), "once")

    def test_a_tick_the_read_back_is_not_due_in_is_held(self):
        self.probe_op()
        moving = type("Moving", (_St,), {"current_vel": 3.0})
        self.assertIsNone(self.poll(moving))
        self.assertIsNone(gateway._ts_readback_tried, "nothing started while it moves")
        self.assertEqual(self.tags("gcode.reparse_toolsetter_held")[-1]["why"], "read_back")

    def test_a_failed_read_back_ends_the_hold_with_one_parse(self):
        self.probe_op()
        self.task.synch_rc = 3
        self.assertIsNone(self.poll(), "held while it runs")
        self.assertEqual(gateway._ts_readback_outcome[1], "failed")
        self.assertEqual(self.poll(), "toolsetter")
        gateway._ts_reparse_asked()
        self.assertIsNone(self.poll(), "no repeat of the same attempt")
        self.assertEqual([f["why"] for f in self.tags("gcode.reparse_toolsetter_hold_ended")], ["failed"])

    def test_an_aborted_read_back_ends_the_hold(self):
        self.probe_op()
        gateway._ts_readback_ended(gateway._ts_attempt_key(), "aborted")
        gateway._ts_readback_tried = gateway._ts_attempt_key()
        self.assertEqual(self.poll(), "toolsetter")
        self.assertEqual(self.tags("gcode.reparse_toolsetter_hold_ended")[-1]["why"], "aborted")

    def test_an_abort_books_the_aborted_outcome(self):
        self.probe_op()
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
        self.assertEqual(gateway._ts_readback_outcome, (gateway._ts_attempt_key(), "aborted"))

    def test_a_read_back_not_admitted_retries_until_the_bound(self):
        self.probe_op()
        gateway._ts_readback_ended(gateway._ts_attempt_key(), "not_admitted")
        gateway._ts_readback_tried = gateway._ts_attempt_key()
        self.assertEqual(gateway._ts_hold_reason(_St), "not_admitted")
        v, t0 = gateway._ts_hold_anchor
        self.assertEqual(v, gateway._ts_basis_version)
        gateway._ts_hold_anchor = (v, t0 - gateway.TS_HOLD_MAX_S)     # 30 s since the booking
        self.assertIsNone(gateway._ts_hold_reason(_St))
        self.assertEqual(self.tags("gcode.reparse_toolsetter_hold_ended")[-1]["why"], "cap")

    def test_polls_never_move_the_anchor(self):
        self.probe_op()
        anchor = gateway._ts_hold_anchor
        moving = type("Moving", (_St,), {"current_vel": 3.0})
        for _ in range(3):
            self.poll(moving)
        self.assertEqual(gateway._ts_hold_anchor, anchor)

    def test_in_auto_on_and_when_unknown_nothing_is_held(self):
        from test_g30 import linuxcnc
        self.probe_op(value=FILE[3014] + 1)
        in_auto = type("InAuto", (_St,), {"state": linuxcnc.STATE_ON, "task_mode": linuxcnc.MODE_AUTO})
        self.assertIsNone(gateway._ts_hold_reason(in_auto))
        self.assertEqual(self.poll(in_auto), "toolsetter", "no synch in AUTO: one parse, not held")
        gateway._ts_book({3009: None}, "unknown")
        self.assertIsNone(gateway._ts_hold_reason(_St), "unknown: nothing a read-back confirms")

    def test_a_preview_of_the_current_revision_needs_nothing_and_stays_assumed(self):
        """Codex R428: the same-revision exception avoids a repeat — it never
        relabels an assumed basis as confirmed."""
        gateway._ts_mark_assumed(None)
        self.publish()                       # a load with the basis assumed
        self.assertIsNone(gateway._ts_drift_reason())
        self.assertIsNone(gateway._ts_open_drift())
        self.assertEqual(gateway._bulk.published_ctx["toolsetter"]["view"]["state"], "assumed")

    def test_a_recurring_input_after_a_failed_attempt_is_a_new_attempt(self):
        """MT427-01: A → B (its parse failed) → A → B: the second B is a new
        revision, a new attempt."""
        _run(gateway._apply_probe_vars({"3009": 50.0}, True))      # B
        self.assertEqual(gateway._ts_drift_reason(), "toolsetter")
        gateway._ts_reparse_asked()                                 # its parse fails: nothing published
        self.assertIsNone(gateway._ts_drift_reason(), "the same attempt never repeats")
        _run(gateway._apply_probe_vars({"3009": FILE[3009]}, True))  # A again
        self.assertIsNone(gateway._ts_drift_reason(), "equal to the published A")
        _run(gateway._apply_probe_vars({"3009": 50.0}, True))      # B again
        self.assertEqual(gateway._ts_drift_reason(), "toolsetter", "a new attempt")

    def test_another_program_is_another_attempt(self):
        _run(gateway._apply_probe_vars({"3009": 50.0}, True))
        gateway._ts_reparse_asked()
        self.assertIsNone(gateway._ts_drift_reason())
        gateway._bulk.published_source = "src-2"                   # a new version of the file
        self.assertEqual(gateway._ts_drift_reason(), "toolsetter")

    def test_a_masked_toolsetter_reason_is_said_and_booked(self):
        _run(gateway._apply_probe_vars({"3009": 50.0}, True))
        with mock.patch.object(gateway._bulk, "schedule_refresh", return_value=True):
            self.assertTrue(gateway._schedule_drift_refresh("/p.ngc", "wcsoff:G54:z", "toolsetter"))
        self.assertEqual([f["by"] for f in self.tags("gcode.reparse_toolsetter_masked")], ["wcsoff:G54:z"])
        self.assertIsNone(gateway._ts_drift_reason(), "the other edge's parse reads it: booked")
        with mock.patch.object(gateway._bulk, "schedule_refresh", return_value=False):
            self.assertFalse(gateway._schedule_drift_refresh("/p.ngc", "rotary:A", "toolsetter"))
        self.assertEqual(len(self.tags("gcode.reparse_toolsetter_masked")), 1, "nothing scheduled: nothing said")


class TestReadbackEnds(_HoldBase):
    """Codex R430 MT-I15/MT-I16 (its probes, the attempt key in the full
    identity form MT-I16 asks for): every end of the read-back task gives
    exactly its attempt a terminal outcome; the read-back, its outcome and
    the hold use the parse attempt's program identity."""

    def test_r430_a_cancel_before_the_tasks_first_step_ends_the_hold(self):
        self.probe_op()
        key = gateway._ts_attempt_key()

        async def go():
            # a stop already ready in the loop, before the task this tick creates
            asyncio.get_running_loop().call_soon(gateway._preempt_inflight, "abort", 0)
            self.assertIsNone(gateway._ts_poll(_St))
            with self.assertRaises(asyncio.CancelledError):
                await gateway._ts_readback_task
        _run(go())
        self.assertEqual((gateway._ts_readback_outcome, gateway._ts_hold_reason(_St), self.poll()),
                         ((key, "aborted"), None, "toolsetter"))

    def test_r430_a_binding_error_ends_the_hold_as_failed(self):
        from test_g30 import linuxcnc
        self.probe_op()
        key = gateway._ts_attempt_key()

        def broken():
            raise linuxcnc.error("synch send failed")
        broken.__name__ = "task_plan_synch"
        self.task.task_plan_synch = broken

        async def go():
            self.assertIsNone(gateway._ts_poll(_St))
            try:
                await gateway._ts_readback_task
            except linuxcnc.error:
                pass
        _run(go())
        self.assertEqual((gateway._ts_readback_outcome, gateway._ts_hold_reason(_St), self.poll()),
                         ((key, "failed"), None, "toolsetter"))
        self.assertEqual(self.tags("toolsetter.read_back_failed")[-1]["why"], "error", "said")

    def test_r430_a_new_source_at_the_same_path_gets_its_read_back_attempt(self):
        self.probe_op()
        self.task.synch_rc = 3
        self.assertIsNone(self.poll())
        self.assertEqual(gateway._ts_readback_outcome[1], "failed")
        old_version, anchor = gateway._ts_basis_version, gateway._ts_hold_anchor
        gateway._bulk.published_source = "src-2"      # a new version of the file, the book still assumed
        self.publish()
        self.task.synch_rc = 1
        self.assertEqual(gateway._ts_basis_version, old_version)
        self.assertTrue(gateway._ts_read_back_due(_St), "the old source's failed attempt is not the new one's")
        self.assertEqual(gateway._ts_hold_anchor, anchor, "a program change never restarts the 30 s")

    def test_a_late_completion_never_books_a_newer_attempt(self):
        self.probe_op()
        old = gateway._ts_attempt_key()
        gateway._ts_readback_current = old
        gateway._ts_book({3009: 77.0}, "assumed")              # a newer revision, a newer attempt
        new = gateway._ts_attempt_key()
        self.assertNotEqual(old, new)
        gateway._ts_readback_current = new
        gateway._ts_readback_ended(new, "not_admitted")
        gateway._ts_readback_ended(old, "failed")              # the old task ends late
        self.assertEqual(gateway._ts_readback_outcomes[new], "not_admitted")
        self.assertEqual(gateway._ts_readback_outcome, (new, "not_admitted"))
        gateway._ts_readback_ended(new, "confirmed")           # its retry ends: not_admitted gives way
        gateway._ts_readback_ended(new, "failed")              # nothing overwrites a terminal outcome
        self.assertEqual(gateway._ts_readback_outcomes[new], "confirmed")

    def test_every_terminal_outcome_is_traced_with_its_attempt(self):
        self.probe_op()
        self.task.synch_rc = 3
        self.poll()
        out = self.tags("toolsetter.read_back_outcome")[-1]
        self.assertEqual((out["attempt_version"], out["outcome"]), (gateway._ts_basis_version, "failed"))


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
        stat = current().stat
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



class TestTakeOverThenFile(_BasisCase):
    """P2 (Codex R308–R309 FI308-03): the interpreter first, then the file
    with exactly the keys it took and their SENT numbers. The file used to
    be written first — the mode switch's synch then saved the interpreter's
    OLDER value over it (live run 5, 2026-11-05: -180 read back after -179
    was set)."""

    def file_value(self, k):
        with open(self.path) as f:
            for line in f:
                parts = line.split()
                if parts and parts[0] == str(k):
                    return float(parts[1])
        return None

    def test_a_set_survives_the_synch_of_its_own_mode_switch(self):
        current().stat.task_mode = gateway.linuxcnc.MODE_MANUAL
        persisted, mdi_ok = _run(gateway._apply_probe_vars({"3102": -179.0}, True))
        self.assertTrue(mdi_ok and persisted)
        self.assertIn(("mode", gateway.linuxcnc.MODE_MDI), self.task.calls, "the switch synched")
        self.assertEqual(self.task.params[3102], -179.0)
        self.assertEqual(self.file_value(3102), -179.0, "the file holds the value the interpreter took")

    def test_only_the_chunks_taken_reach_the_file(self):
        vals = {str(k): 1000.0 + k for k in TOOLSETTER_BASIS_KEYS}
        calls, mdi = [], self.task.mdi

        def failing_second(text):
            calls.append(text)
            mdi(text)
            if len(calls) == 2:
                self.task._last = 3      # RCS_ERROR
        failing_second.__name__ = "mdi"
        self.task.mdi = failing_second
        r = _run(gateway._apply_probe_vars_detail(vals, True))
        first = [int(w[1:].split("=")[0]) for w in calls[0].split()]
        second = [int(w[1:].split("=")[0]) for w in calls[1].split()]
        self.assertFalse(r["mdi_set"])
        self.assertTrue(r["persisted"])
        self.assertEqual(sorted(r["applied_keys"]), sorted(str(k) for k in first))
        for k in first:
            self.assertEqual(self.file_value(k), 1000.0 + k, k)
        for k in second:
            self.assertEqual(self.file_value(k), FILE[k], f"{k}: not taken, the file keeps its value")

    def test_nothing_taken_writes_nothing(self):
        self.task.mdi_rc = 3                  # every chunk RCS_ERROR
        before = self.file_value(3102)
        r = _run(gateway._apply_probe_vars_detail({"3102": -170.0}, True))
        self.assertEqual((r["mdi_set"], r["persisted"], r["applied_keys"]), (False, False, []))
        self.assertEqual(self.file_value(3102), before)

    def test_the_sent_number_is_the_booking_and_the_file(self):
        r = _run(gateway._apply_probe_vars_detail({"3102": -180.1234567}, True))
        self.assertTrue(r["mdi_set"] and r["persisted"])
        self.assertEqual(self.value(3102), -180.123457)
        self.assertEqual(self.file_value(3102), -180.123457)
        self.assertEqual(self.task.params[3102], -180.123457)

    def test_a_file_failure_after_the_take_over_keeps_the_take_over(self):
        def broken(*a, **k):
            raise OSError(28, "No space left on device")
        with unittest.mock.patch.object(gateway, "_write_var_file_updates", broken):
            r = _run(gateway._apply_probe_vars_detail({"3102": -170.0}, True))
        self.assertTrue(r["mdi_set"])
        self.assertFalse(r["persisted"])
        self.assertIn("No space left", r["file_error"])
        self.assertEqual((self.origin(3102), self.value(3102)), ("applied", -170.0))

    def test_the_reply_names_the_take_over_and_the_persistence(self):
        r = self.send({"cmd": "set_params", "sets": {"toolsetter": {"3102": -175.0}}})
        self.assertTrue(r["ok"], r)
        self.assertEqual((r["mdi_set"], r["applied_keys"], r["persisted"]), (True, ["3102"], True))
        self.assertNotIn("file_saved", r)


class TestBookingOnTheWire(_BasisCase):
    """P2 (Codex R308–R309 FI308-04): the form's state comes from the
    gateway's booking, published per connection — on its first frame and on
    every booking change, never on every frame."""

    def test_a_connection_gets_the_booking_first_and_then_only_on_a_change(self):
        client = gateway.ClientState(ip="t", ws=None, armed=True)
        first = gateway._ts_booking_for(client)
        self.assertIsNotNone(first, "a new connection's first frame carries it")
        self.assertEqual(set(first["keys"]), {str(k) for k in TOOLSETTER_BASIS_KEYS})
        self.assertEqual(first["keys"]["3102"], {"value": FILE[3102], "origin": "assumed"})
        self.assertIsNone(gateway._ts_booking_for(client), "unchanged: not again")
        _run(gateway._apply_probe_vars({"3102": -170.0}, True))
        again = gateway._ts_booking_for(client)
        self.assertEqual(again["keys"]["3102"], {"value": -170.0, "origin": "applied"})
        self.assertGreater(again["version"], first["version"])
        other = gateway.ClientState(ip="u", ws=None, armed=False)
        self.assertEqual(gateway._ts_booking_for(other), again, "another connection gets the current one")

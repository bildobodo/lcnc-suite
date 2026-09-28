"""G30's stored tool-change position (operator point P4, Codex R21–R24).

A read or a write is CONFIRMED only by a fresh parameter file: task_plan_synch
answered RCS_DONE AND the file's inode changed (save_parameters writes .new,
links the old file as .bak and renames — a failed open or rename keeps the
inode, and synch still answers RCS_DONE) AND every value is there. The
gateway's own writers of that file are serialised with the whole sequence
(_var_file_lock), a cancelled writer holds the lock to its end, and the
display route shows a missing row as None, never 0.0.

The task double below stands in for LinuxCNC's interpreter and task: an MDI
that assigns `#N=v` words, and a synch that saves like save_parameters — or
does not. Real handlers, real _cmd_blocking, real files in a tempdir.
"""
import asyncio
import os
import tempfile
import threading
import unittest
import unittest.mock

import fake_linuxcnc
linuxcnc = fake_linuxcnc.install()   # MUST precede `import gateway`
import gateway  # noqa: E402
from gateway_util import read_var_snapshot, g30_window_refusal  # noqa: E402

XYZAC = 0b101111          # X Y Z A C (canonical bits 0 1 2 3 5)
PARAMS = {5181: 100.0, 5182: 0.0, 5183: -26.275, 5184: 0.0, 5185: 0.0, 5186: 0.0,
          5187: 0.0, 5188: 0.0, 5189: 0.0, 3100: 150.0}


def _run(coro):
    return asyncio.run(coro)


class _Task:
    """LinuxCNC's task + interpreter for these tests (the CMD object)."""

    def __init__(self, path, params):
        self.path, self.params = path, dict(params)
        self.calls = []
        self.synch_saves = True      # save_parameters publishes a new file
        self.synch_rc = 1            # RCS_DONE
        self.mdi_rc = 1
        self.mdi_takes = True        # the interpreter assigns the words
        self.block = None            # (event_entered, event_release) inside a call
        self._last = 1

    def save(self):
        """save_parameters: <file>.new, unlink .bak, link file → .bak, rename."""
        new, bak = self.path + ".new", self.path + ".bak"
        with open(new, "w") as f:
            for k in sorted(self.params):
                f.write(f"{k}\t{self.params[k]:f}\n")
        if os.path.exists(bak):
            os.unlink(bak)
        os.link(self.path, bak)
        os.rename(new, self.path)

    def _maybe_block(self, name):
        if self.block and self.block[0] == name:
            self.block[1].set()
            self.block[2].wait(5)

    def mode(self, m):
        self.calls.append(("mode", m))
        gateway.STAT.task_mode = m
        self._last = 1
        return 0

    def mdi(self, text):
        self.calls.append(("mdi", text))
        self._maybe_block("mdi")
        if self.mdi_takes:
            for word in text.split():
                n, v = word[1:].split("=")
                self.params[int(n)] = float(v)
        self._last = self.mdi_rc

    def task_plan_synch(self):
        self.calls.append(("synch",))
        self._maybe_block("synch")
        if self.synch_saves:
            self.save()
        self._last = self.synch_rc

    def wait_complete(self, *_a):
        return self._last

    def names(self):
        return [c[0] for c in self.calls]


class _G30Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "sim.var")
        self.task = _Task(self.path, PARAMS)
        with open(self.path, "w") as f:           # the file as of the last synch
            for k in sorted(PARAMS):
                f.write(f"{k}\t{PARAMS[k]:f}\n")
        self.task.save()                          # a .bak exists, like after any synch
        saved = (gateway.STAT, gateway.CMD, gateway.lcnc_connected, gateway._cmd_lock, gateway._var_file_lock)
        self.addCleanup(lambda: (setattr(gateway, "STAT", saved[0]), setattr(gateway, "CMD", saved[1]),
                                 setattr(gateway, "lcnc_connected", saved[2]), setattr(gateway, "_cmd_lock", None),
                                 setattr(gateway, "_var_file_lock", None)))
        gateway.lcnc_connected = True
        gateway._cmd_lock = gateway._var_file_lock = None
        gateway.STAT = linuxcnc.stat()
        gateway.STAT.axis_mask = XYZAC
        gateway.STAT.task_mode = linuxcnc.MODE_MDI
        gateway.STAT.interp_state = linuxcnc.INTERP_IDLE
        gateway.STAT.position = (10.0, 20.0, -5.0, 725.0, 0.0, -370.0, 0.0, 0.0, 0.0)
        gateway.STAT.inpos, gateway.STAT.current_vel = True, 0.0     # the machine stands
        gateway.CMD = self.task
        for name, value in (("_resolve_var_file_path", lambda: self.path),
                            ("_g30_limits", lambda: {"X": (-250.0, 250.0), "Y": (-70.0, 70.0),
                                                     "Z": (-400.0, 0.0), "A": (-100.0, 50.0)}),
                            ("_g30_wrapped", lambda: {"C"})):
            p = unittest.mock.patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)

    def send(self, msg, **status):
        from test_command_dispatch import _payload
        gateway._shared_status = _payload(**{"inpos": True, "current_vel": 0.0, **status})
        return _run(gateway.handle_command(msg, True))

    def stored(self):
        return {"X": 100.0, "Y": 0.0, "Z": -26.275, "A": 0.0, "C": 0.0}

    def file(self, n):
        return read_var_snapshot(self.path, [str(n)])[1][str(n)]


class TestG30Write(_G30Case):
    def test_a_confirmed_write_synchs_writes_synchs_and_reads_back(self):
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0, "z": -30.0}, "based_on": self.stored()})
        self.assertEqual(r["ok"], True, r)
        self.assertEqual(r["confirmed"], True)
        self.assertEqual((r["values"]["X"], r["values"]["Z"]), (120.0, -30.0))
        self.assertEqual(self.task.names(), ["synch", "mdi", "synch"])
        self.assertEqual(self.task.calls[1], ("mdi", "#5181=120.000000 #5183=-30.000000"))
        self.assertEqual((self.file(5181), self.file(5183)), (120.0, -30.0))
        self.assertNotIn("open_axes", r)

    def test_a_synch_that_publishes_no_new_file_proves_nothing(self):
        # Codex R22 OP22-01: synch answers RCS_DONE even when save_parameters
        # failed; the old file is still readable — its 100 is no proof.
        self.task.synch_saves = False
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0}, "based_on": self.stored()})
        self.assertEqual(r, {"ok": False, "confirmed": False, "error": "G30 not confirmed — parameters not saved"})
        self.assertNotIn("mdi", self.task.names(), "nothing written on an unproven basis")

    def test_a_value_the_interpreter_changed_meanwhile_is_a_conflict(self):
        # Codex R22's 10/20/30: the draft is based on 100 (the old file), the
        # interpreter holds 90 — the fresh file says so, nothing is written.
        self.task.params[5181] = 90.0
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0}, "based_on": self.stored()})
        self.assertEqual(r["error"], "G30 changed meanwhile — reload")
        self.assertEqual((r["confirmed"], r["values"]["X"]), (True, 90.0))
        self.assertEqual(self.task.names(), ["synch"])

    def test_the_second_synch_must_publish_too(self):
        def synch_once():
            self.task.calls.append(("synch",))
            if sum(1 for c in self.task.calls if c[0] == "synch") == 1:
                self.task.save()
            self.task._last = 1
        self.task.task_plan_synch = synch_once
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0}, "based_on": self.stored()})
        self.assertEqual(r, {"ok": False, "confirmed": False, "error": "G30 not confirmed — parameters not saved"})
        self.assertIn("mdi", self.task.names())

    def test_a_refused_mdi_or_synch_is_not_confirmed(self):
        for attr, value, error in (("mdi_rc", 3, "LinuxCNC did not take the G30 values"),
                                   ("synch_rc", 3, "G30 not confirmed — LinuxCNC did not synch"),
                                   ("synch_rc", -1, "G30 not confirmed — LinuxCNC did not synch")):
            with self.subTest(attr=attr, rc=value):
                self.task = _Task(self.path, self.task.params)
                gateway.CMD = self.task
                setattr(self.task, attr, value)
                r = self.send({"cmd": "set_g30", "values": {"x": 121.0}, "based_on":
                               {**self.stored(), "X": self.file(5181)}})
                self.assertEqual((r["ok"], r["confirmed"], r["error"]), (False, False, error))

    def test_a_value_read_back_differently_is_not_confirmed(self):
        self.task.mdi_takes = False
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0}, "based_on": self.stored()})
        self.assertEqual((r["ok"], r["confirmed"], r["error"]), (False, False, "G30 not confirmed — X read back differently"))

    def test_out_of_the_window_is_refused_before_anything_moves(self):
        for values, error in (({"z": 5.0}, "G30 Z 5 outside -400…0 — not saved"),
                              ({"b": 1.0}, "B is not an axis of this machine")):
            with self.subTest(values=values):
                r = self.send({"cmd": "set_g30", "values": values, "based_on": {"Z": -26.275, "B": 0.0}})
                self.assertEqual(r, {"ok": False, "error": error})
        self.assertEqual(self.task.calls, [], "no synch, no MDI")
        self.assertEqual(g30_window_refusal({"C": 1e6}, "XYZAC", {}), None, "an open axis: finiteness only")

    def test_an_open_axis_is_named_in_the_reply(self):
        r = self.send({"cmd": "set_g30", "values": {"c": 30.0}, "based_on": self.stored()})
        self.assertEqual((r["ok"], r.get("open_axes")), (True, ["C"]), r)

    def test_a_write_without_its_basis_is_refused(self):
        r = self.send({"cmd": "set_g30", "values": {"x": 120.0, "z": -30.0}, "based_on": {"X": 100.0}})
        self.assertEqual(r, {"ok": False, "error": "G30 draft has no basis — reload"})
        self.assertEqual(self.task.calls, [])


class TestG30Read(_G30Case):
    def test_a_confirmed_read(self):
        self.task.params[5183] = -20.0
        r = self.send({"cmd": "read_g30"})
        self.assertEqual(r, {"ok": True, "confirmed": True, "values": {**self.stored(), "Z": -20.0}})

    def test_a_read_that_publishes_nothing_is_not_confirmed(self):
        self.task.synch_saves = False
        r = self.send({"cmd": "read_g30"})
        self.assertEqual(r, {"ok": False, "confirmed": False, "error": "G30 not confirmed — parameters not saved"})

    def test_capture_takes_the_commanded_position_with_g30_1s_wrap(self):
        # C is WRAPPED_ROTARY: −370 → 350 as G30.1 stores it; A is not: 725 stays.
        r = self.send({"cmd": "capture_g30"})
        self.assertEqual(r["ok"], True, r)
        self.assertEqual(r["current"], {"X": 10.0, "Y": 20.0, "Z": -5.0, "A": 725.0, "C": 350.0})
        self.assertEqual(r["values"], self.stored())

    def test_capture_refuses_a_moving_machine_before_anything_runs(self):
        # Codex R25 OP-I02: a manual jog keeps INTERP_IDLE — idle is no
        # standstill. The status says moving → the gate denies at admission.
        for status, error in (({"inpos": False, "current_vel": 12.0}, "Machine moving — capture once it stands"),
                              ({"inpos": True, "current_vel": 0.5}, "Machine moving — capture once it stands"),
                              ({"current_vel": None}, "Motion state unknown — wait for status")):
            with self.subTest(status=status):
                r = self.send({"cmd": "capture_g30"}, **status)
                self.assertEqual(r, {"ok": False, "error": error})
        self.assertEqual(self.task.calls, [], "no synch for a refused capture")

    def test_capture_rechecks_standstill_and_admission_at_the_take_over(self):
        # The synch is awaited; what held at the request must still hold when
        # the position is taken: a fresh STAT that moves, or a status that
        # lost the admission meanwhile, refuses — nothing is taken over.
        for change, error in (
                (lambda: setattr(gateway.STAT, "current_vel", 12.0), "Machine moving — capture once it stands"),
                (lambda: setattr(gateway.STAT, "inpos", False), "Machine moving — capture once it stands"),
                (lambda: setattr(gateway.STAT, "current_vel", None), "Motion state unknown — wait for status"),
                (lambda: setattr(gateway, "_shared_status", __import__("test_command_dispatch")._payload(
                    inpos=True, current_vel=0.0, homed=False)), "Not homed — press Home All")):
            with self.subTest(error=error):
                gateway.STAT.inpos, gateway.STAT.current_vel = True, 0.0
                self.task.calls.clear()
                synch = self.task.task_plan_synch

                def moving_synch(synch=synch, change=change):
                    synch()
                    change()
                self.task.task_plan_synch = moving_synch
                try:
                    r = self.send({"cmd": "capture_g30"})
                finally:
                    self.task.task_plan_synch = synch
                self.assertEqual((r["ok"], r["error"]), (False, error), r)
                self.assertNotIn("current", r, "nothing taken over")
                self.assertEqual(r["values"], self.stored(), "the confirmed stored values stay reported")

    def test_the_display_route_names_a_missing_row_as_none_never_zero(self):
        with open(self.path, "w") as f:
            f.write("5181\t100.000000\n5182\t0.000000\n")      # Z, A, C rows missing
        r = gateway._read_g30_vars()
        self.assertEqual(r["values"], {"X": 100.0, "Y": 0.0, "Z": None, "A": None, "C": None})
        self.assertIn("mtime_ms", r)


class TestG30Exclusive(_G30Case):
    """The gateway's own writers never fake the inode proof (Codex R23)."""

    def test_the_provenance_seed_waits_for_the_whole_g30_sequence(self):
        entered, release = threading.Event(), threading.Event()
        self.task.block = ("synch", entered, release)
        gateway.STAT.axis_mask = XYZAC      # A present: the seed runs
        gateway._prov_rows_ensured.discard(self.path)

        async def scenario():
            from test_command_dispatch import _payload
            gateway._shared_status = _payload()
            g30 = asyncio.ensure_future(gateway.handle_command(
                {"cmd": "set_g30", "values": {"x": 120.0}, "based_on": self.stored()}, True))
            while not entered.is_set():
                await asyncio.sleep(0.005)
            seed = asyncio.ensure_future(gateway._ensure_prov_var_rows())
            await asyncio.sleep(0.2)
            self.assertFalse(seed.done(), "the seed waits for the var-file lock")
            self.task.block = None
            release.set()
            r = await g30
            await seed
            return r
        r = _run(scenario())
        self.assertEqual(r["ok"], True, r)

    def test_a_cancelled_probe_vars_write_holds_the_lock_to_its_end(self):
        started, release, written = threading.Event(), threading.Event(), threading.Event()
        real = gateway._write_var_file_updates

        def slow_write(path, values):
            started.set()
            release.wait(5)
            real(path, values)
            written.set()

        async def scenario():
            async def probe_vars():
                async with gateway._get_var_file_lock():
                    await gateway._var_file_thread(slow_write, self.path, {"3100": 151.0})
            job = asyncio.ensure_future(probe_vars())
            while not started.is_set():
                await asyncio.sleep(0.005)
            job.cancel()
            await asyncio.sleep(0)
            job.cancel()                      # a second cancel while it waits
            await asyncio.sleep(0.05)
            self.assertTrue(gateway._get_var_file_lock().locked(), "the lock outlives the cancel")
            release.set()
            with self.assertRaises(asyncio.CancelledError):
                await job
            self.assertTrue(written.is_set(), "released only after the write ended")
            self.assertFalse(gateway._get_var_file_lock().locked())
        _run(scenario())

    def test_a_cancelled_handlers_file_write_ends_before_the_next_g30_begins(self):
        # Codex R23: _apply_probe_vars awaited its writer with a plain
        # to_thread — a cancel (abort/estop preemption) released _cmd_lock
        # while the write still ran, and the next command's synch could take
        # that write's new inode for its own.
        started, release = threading.Event(), threading.Event()
        order = []
        real_write, real_snap = gateway._write_var_file_updates, gateway.read_var_snapshot

        def slow_write(path, values):
            started.set()
            release.wait(5)
            real_write(path, values)
            order.append("write ended")

        def snap(path, keys):
            order.append("g30 read")
            return real_snap(path, keys)

        gateway.STAT.ini_filename = os.path.join(self.tmp.name, "sim.ini")
        with open(gateway.STAT.ini_filename, "w") as f:
            f.write("[RS274NGC]\nPARAMETER_FILE = sim.var\n")

        class _Ini:
            def __init__(self, path):
                pass

            def find(self, section, var):
                return "sim.var" if (section, var) == ("RS274NGC", "PARAMETER_FILE") else None

        async def scenario():
            from test_command_dispatch import _payload
            gateway._shared_status = _payload()
            with unittest.mock.patch.object(gateway, "_write_var_file_updates", slow_write), \
                    unittest.mock.patch.object(gateway, "read_var_snapshot", snap), \
                    unittest.mock.patch.object(gateway.linuxcnc, "ini", _Ini):
                first = asyncio.ensure_future(gateway.handle_command(
                    {"cmd": "mdi", "text": "T5 M600", "vars": {"3100": 151}}, True))
                while not started.is_set():
                    await asyncio.sleep(0.005)
                first.cancel()
                g30 = asyncio.ensure_future(gateway.handle_command({"cmd": "read_g30"}, True))
                await asyncio.sleep(0.2)
                release.set()
                with self.assertRaises(asyncio.CancelledError):
                    await first
                return await g30
        r = _run(scenario())
        self.assertEqual(r["ok"], True, r)
        self.assertEqual(order[0], "write ended", order)


if __name__ == "__main__":
    unittest.main()

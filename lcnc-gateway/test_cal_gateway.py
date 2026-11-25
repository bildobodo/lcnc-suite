"""The probe calibration in the gateway (P5-1, plan v6 — Codex R439–R444;
operator 2026-11-23/24): the run's call with its durable token, the drain
proof by the status poller, the candidate's Apply / Discard / Reset in their
two steps with the machine's outcome, #3032's one writer, the units, and the
probing parameters' booking.

Real gateway module under the fake linuxcnc (pytest only). The status poller
is driven by its own step functions (`_cal_wants_drain`, read_errors,
`_cal_status_cycle`) — no copy of them here."""
import asyncio
import copy
import json
import os
import tempfile
import threading
import unittest
import unittest.mock
from pathlib import Path

import test_command_dispatch as td   # the fake binding first, then gateway
import gateway  # noqa: E402
import linuxcnc  # noqa: E402
import features  # noqa: E402
from cal_runs import COUNTER_FILE, NOT_SETTLED, CalState  # noqa: E402
from link_fixture import current, swap_connection, FakeConnection  # noqa: E402
from probe_book import ProbeBook  # noqa: E402
from settings_store import SettingsStore  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DECLARED = gateway._declared_linear_unit      # (the fixture replaces it)
CAL = {"3014": 99, "3015": 20, "3033": 20, "3036": 0}
ROUTINE = "probe_cal_round_pocket"


class _Cmd:
    """The command channel: a serial per write, the status' echo behind it."""

    def __init__(self):
        self.calls, self.serial, self.rc = [], 0, linuxcnc.RCS_DONE
        self.on_mdi = None          # called with the line before it is booked as sent
        self.block = None           # an Event the next mdi waits on
        self.entered = threading.Event()

    def _sent(self, *call):
        self.serial += 1
        self.calls.append(call)
        current().stat.echo_serial_number = self.serial
        # a new command clears an error left standing (emctaskmain.cc)
        current().stat.state = linuxcnc.RCS_DONE

    def mdi(self, text):
        self.entered.set()
        if self.on_mdi is not None:
            self.on_mdi(text)
        if self.block is not None:
            self.block.wait(5)
        self._sent("mdi", text)

    def mode(self, m):
        self._sent("mode", m)
        current().stat.task_mode = m

    def abort(self):
        self._sent("abort")

    def state(self, s):
        self._sent("state", s)

    def reset_interpreter(self):
        self._sent("reset_interpreter")

    def wait_complete(self, *_a):
        return self.rc

    def mdis(self):
        return [c[1] for c in self.calls if c[0] == "mdi"]


class _Err:
    """The error channel, with its failures."""

    def __init__(self):
        self.queue, self.fail = [], False

    def poll(self):
        if self.fail:
            raise linuxcnc.error("no buffer")
        return self.queue.pop(0) if self.queue else None


class _Base(unittest.TestCase):
    def setUp(self):
        td.TestHandlerExecution.setUp(self)
        self.cmd, self.err = _Cmd(), _Err()
        stat = current().stat
        swap_connection(FakeConnection(stat=stat, cmd=self.cmd, err=self.err))
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.dir = Path(d.name)
        self.ini = self.dir / "mill.ini"
        self.ini.write_text("")
        stat.ini_filename = str(self.ini)
        stat.task_mode = linuxcnc.MODE_MDI
        stat.interp_state = linuxcnc.INTERP_IDLE
        stat.state, stat.exec_state, stat.queued_mdi_commands = linuxcnc.RCS_DONE, 2, 0
        stat.echo_serial_number = 0
        stat.enabled, stat.estop = True, False
        stat.program_units = 2
        self.stat = stat
        self.unit = "mm"
        self.var = self.dir / "mill.var"
        self.var.write_text("".join(f"{k}\t0.200000\n" for k in (3014, 3015, 3032, 3033, 3036)))
        self.store = SettingsStore(self.dir / "settings.json", lambda: str(self.ini))
        self.macros = [ROUTINE, "probe_cal_square_boss", "probe_round_boss", "probe_z_minus_wco"]
        for name, value in (("_settings_store", self.store), ("_declared_linear_unit", lambda *_a: self.unit),
                            ("get_probe_macros", lambda: list(self.macros)),
                            ("_resolve_var_file_path", lambda: str(self.var)),
                            ("_remap_env", lambda: gateway.RemapEnv([], [], keys=gateway._REMAP_KEYS)),
                            ("_probe_book", ProbeBook()), ("_cal", CalState(
                                emit=lambda *a, **k: self.traces.append((a[0], k)), proof_window_s=0.02,
                                consts=gateway._CONTROLLER_CONSTS,
                                on_old_routine=lambda: gateway._probe_book.invalidate([3032], "old"))),
                            ("_cal_last_reserved", 0), ("_cal_writing", False), ("_cal_drains", []),
                            ("_cal_migrated", {}), ("_cal_record_read", (None, None)), ("_cal_lock", None),
                            ("_poll_cycle", 0), ("_machine_limits", None), ("CAL_SETTLE_S", 0.4)):
            p = unittest.mock.patch.object(gateway, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.traces = []
        self.facts = {ROUTINE: (frozenset(), True), "probe_cal_square_boss": (frozenset(), True),
                      "probe_round_boss": (frozenset(), True), "probe_z_minus_wco": (frozenset(), False),
                      "surface_scan": (frozenset(), False)}
        p = unittest.mock.patch.object(gateway, "_routine_facts", lambda n: self.facts.get(n, (None, True)))
        p.start()
        self.addCleanup(p.stop)
        self.record(0.2)

    # ── the record and the book ──
    def record(self, value, unit="mm", state="active"):
        self.store.write_calibration({"value": value, "unit": unit, "state": state}, lambda *_a: None, ini=str(self.ini))

    def rec(self):
        return self.store.calibration()

    def wire(self):
        c = gateway.ClientState(ip="x", ws=None)
        return gateway._probe_state_for(c)

    def machine(self):
        return self.wire()["probe_calibration"]["machine"]["outcome"]

    def booked(self, key=3032):
        e = gateway._probe_book.entry(key, gateway.current_link().seq)
        return None if e is None else (e["outcome"], e["value"])

    # ── the status poller's step, by its own functions ──
    def cycle(self, *messages, **stat):
        for k, v in stat.items():
            setattr(self.stat, k, v)
        self.err.queue.extend(messages)
        gateway._poll_cycle += 1
        t0 = gateway.time.monotonic()
        polled = gateway.current_link()
        gateway._release_after_poll(t0, polled)
        f = gateway._cal_fields(polled)
        msgs, why = gateway._status_runtime.read_errors(polled.err if polled else None,
                                                        drain=gateway._cal_wants_drain(f, polled))
        return gateway._cal_status_cycle(t0, polled, f, self.stat.estop, self.stat.enabled, msgs, why)

    def run_async(self, coro):
        """`coro` beside a status poller cycling every few ms."""
        async def both():
            gateway._cmd_lock = gateway._source_lock = gateway._var_file_lock = gateway._cal_lock = None
            gateway._shared_status = td._payload()

            async def poller():
                while True:
                    await asyncio.sleep(0.005)
                    self.cycle()
            p = asyncio.ensure_future(poller())
            try:
                return await coro
            finally:
                p.cancel()
        return asyncio.run(both())

    def send(self, msg, key=None):
        return self.run_async(gateway.handle_command(msg, True, key or self.key))

    def start(self, vars_=None, routine=ROUTINE):
        return self.send({"cmd": "probe_run", "routine": routine, "vars": vars_ or CAL})

    def result(self, run, value=0.0712, axis=0):
        return (13, f" LCNC_CAL_CANDIDATE run={run}.000000 value={value:.6f} axis={axis}.000000")

    def offered(self, value=0.0712):
        # the interpreter reads from the call's write on: no cycle of the
        # poller finds it at rest before the start returned ("did not start")
        def reads(text):
            if text.startswith("O<"):
                self.stat.interp_state = linuxcnc.INTERP_READING
        self.cmd.on_mdi = reads
        r = self.start()
        self.cmd.on_mdi = None
        self.assertTrue(r["ok"], r)
        self.cycle(interp_state=linuxcnc.INTERP_READING, state=linuxcnc.RCS_EXEC, exec_state=3)
        self.cycle(self.result(r["run"], value))
        self.cycle(interp_state=linuxcnc.INTERP_IDLE, state=linuxcnc.RCS_DONE, exec_state=2)
        self.assertEqual(gateway._cal.candidate.state, "pending", gateway._cal.candidate)
        return r["run"]

    def counter(self):
        return json.loads((self.dir / COUNTER_FILE).read_text())["mill.ini"]["next"]


class TestTheCall(_Base):
    def test_the_values_then_the_call_with_its_token_and_never_3032(self):
        r = self.start()
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.mdis(), ["#3014=99.000000 #3015=20.000000 #3033=20.000000 #3036=0.000000 #3116=0.000000",
                                           f"O<{ROUTINE}> CALL [1]"])
        self.assertNotIn("3032", " ".join(self.cmd.mdis()))
        self.assertEqual(self.counter(), 2)
        run = gateway._cal.run
        self.assertEqual((run.run, run.state, run.serial, run.unit, run.base_rev, run.was), (1, "sent", self.cmd.serial, "mm", 1, 0.2))
        self.assertEqual(run.basis, {"3014": 99.0, "3015": 20.0, "3033": 20.0, "3036": 0.0})

    def test_the_next_run_takes_the_next_token(self):
        for n in (1, 2, 3):
            self.assertEqual(self.start()["run"], n)
            gateway._cal.run = None
        self.assertEqual(self.counter(), 4)

    def test_a_restart_never_gives_a_token_again(self):
        self.start()
        gateway._cal.run = None
        gateway._cal_last_reserved = 0          # a new process
        with unittest.mock.patch.dict(os.environ, {"LCNC_LOG_DIR": str(self.dir / "other-logs")}):
            self.assertEqual(self.start()["run"], 2, "the counter lies in the INI's folder, whatever the log folder")

    def test_the_counter_s_refusals_come_before_any_write(self):
        for text, why in (('{"mill.ini": {"next": 1.5}}', "Calibration run counter unreadable"),
                          ("{", "Calibration run counter unreadable"),
                          ('{"mill.ini": {"next": 10000000}}', "Calibration run ids used up")):
            (self.dir / COUNTER_FILE).write_text(text)
            r = self.start()
            self.assertIn(why, r["error"])
            self.assertEqual(self.cmd.mdis(), [], text)
        (self.dir / COUNTER_FILE).unlink()
        with unittest.mock.patch.object(gateway, "reserve_run", side_effect=gateway.CounterError(
                "Calibration run id not reserved — x")):
            self.assertIn("not reserved", self.start()["error"])
        self.assertEqual(self.cmd.mdis(), [])

    def test_an_old_result_in_the_channel_is_read_as_stale_first(self):
        # position 51: read in the second packet, processed, then the start
        self.err.queue = [(12, f"m{i}") for i in range(50)] + [self.result(1)]
        r = self.start()
        self.assertTrue(r["ok"], r)
        self.assertIsNone(gateway._cal.run.result)
        self.assertIn("cal.message_stale", [t for t, _ in self.traces])

    def test_no_proof_no_start(self):
        def refused(what):
            r = self.start()
            self.assertEqual(r, {"ok": False, "error": NOT_SETTLED}, what)
            self.assertEqual(self.cmd.mdis(), [], what)
            self.assertFalse((self.dir / COUNTER_FILE).exists(), what)
        self.stat.queued_mdi_commands = 1          # idle with a queued MDI (a gateway restart)
        refused("queued")
        self.stat.queued_mdi_commands = None
        refused("unread")
        self.stat.queued_mdi_commands = 0
        self.err.fail = True
        refused("a failed read")
        self.err.fail = False

        class Flood:
            def poll(self):
                return (12, "flood")
        swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=Flood()))
        refused("the bound without an empty poll")
        swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
        with unittest.mock.patch.object(gateway, "_source_claims", [object()]):
            refused("a start not through")

    def test_an_error_left_standing_is_cleared_by_the_job_s_own_switch(self):
        # a probe abort leaves RCS_ERROR until the next command: no dead end
        self.stat.state = linuxcnc.RCS_ERROR
        r = self.start()
        self.assertTrue(r["ok"], r)
        self.assertEqual(self.cmd.calls[0], ("mode", linuxcnc.MODE_MDI))

    def test_the_cycle_already_running_does_not_answer(self):
        async def go():
            gateway._cal_drains.clear()
            conn = gateway.link()
            q = asyncio.ensure_future(gateway._cal_drain_proof(conn))
            await asyncio.sleep(0)
            # the running cycle finishes: it began before the question
            f = gateway._cal_fields(conn)
            gateway._cal_status_cycle(0.0, conn, f, False, True, [], None)
            await asyncio.sleep(0)
            self.assertFalse(q.done())
            gateway._poll_cycle += 1
            gateway._cal_status_cycle(0.0, conn, f, False, True, [], None)
            return await q
        self.assertIsNone(asyncio.run(go()))

    def test_a_link_change_during_the_question_is_no_proof(self):
        async def go():
            q = asyncio.ensure_future(gateway._cal_drain_proof(gateway.link()))
            await asyncio.sleep(0)
            swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
            self.cycle()
            return await q
        self.assertEqual(asyncio.run(go()), "connection changed")

    def test_disarmed_while_it_waits_nothing_goes_out(self):
        orig = gateway._cal_drain_proof

        async def disarm(conn):
            why = await orig(conn)
            gateway._clients[911].armed = False
            return why
        with unittest.mock.patch.object(gateway, "_cal_drain_proof", disarm):
            r = self.start()
        self.assertFalse(r["ok"])
        self.assertIn("Not armed", r["error"])
        self.assertEqual(self.cmd.mdis(), [])

    def test_what_falls_during_the_admissions_own_poll_starts_nothing(self):
        real = gateway._interp_idle_refusal
        for how, why in (("disarm", "Not armed"), ("gone", "Connection unknown")):
            at = 0
            while True:
                at += 1
                calls, sent, writer = [], [], gateway._clients[911]

                def idle(how=how, at=at, calls=calls, sent=sent):
                    r = real()
                    calls.append(1)
                    if len(calls) == at:
                        sent.append(len(self.cmd.mdis()))
                        if how == "disarm":
                            gateway._clients[911].armed = False
                        else:
                            gateway._clients.pop(911)
                    return r
                with unittest.mock.patch.object(gateway, "_interp_idle_refusal", idle):
                    r = self.start()
                gateway._clients[911] = writer
                writer.armed = True
                gateway._cal.run = gateway._cal.candidate = None
                if len(calls) < at:
                    break
                with self.subTest(how, call=at):
                    self.assertFalse(r["ok"], r)
                    self.assertIn(why, r["error"])
                    self.assertEqual(len(self.cmd.mdis()), sent[0], "nothing more went out")
            self.assertGreater(at, 2)

    def test_a_refused_chunk_opens_no_run_and_keeps_the_candidate(self):
        run = self.offered()
        self.cmd.rc = 3
        r = self.start()
        self.assertFalse(r["ok"])
        self.assertIsNone(gateway._cal.run)
        self.assertEqual(gateway._cal.candidate.run, run)
        self.assertEqual(gateway._cal.candidate.state, "pending")

    def test_a_call_that_raises_offers_nothing(self):
        def boom(text):
            if text.startswith("O<"):
                raise linuxcnc.error("write failed")
        self.cmd.on_mdi = boom
        r = self.start()
        self.assertFalse(r["ok"])
        c = gateway._cal.candidate
        self.assertEqual((c.state, c.why), ("stale", "the start was not confirmed"))

    def test_the_calibration_s_own_set_only(self):
        r = self.start({**CAL, "3032": 0.05})
        self.assertEqual(r["error"], "The calibration offset is set by Apply or Reset")
        self.assertEqual(self.cmd.mdis(), [])

    def test_without_a_migrated_record_nothing_starts(self):
        self.store = SettingsStore(self.dir / "empty.json", lambda: str(self.ini))
        with unittest.mock.patch.object(gateway, "_settings_store", self.store):
            self.assertEqual(self.start()["error"], "Calibration offset not read — try again")
        self.assertEqual(self.cmd.mdis(), [])


class TestTheRunInTheGateway(_Base):
    def test_abort_in_the_retract_gives_no_candidate(self):
        # operator O-3; the abort is booked right before its write
        r = self.start()
        self.cycle(self.result(r["run"]), interp_state=linuxcnc.INTERP_READING, state=linuxcnc.RCS_EXEC)
        self.send({"cmd": "abort"})
        self.cycle(interp_state=linuxcnc.INTERP_IDLE, state=linuxcnc.RCS_DONE)
        c = gateway._cal.candidate
        self.assertEqual((c.state, c.why), ("stale", "the run was aborted"))
        self.assertEqual(self.rec()["value"], 0.2)
        self.assertEqual(self.send({"cmd": "cal_apply", "run": r["run"], "value": 0.0712})["error"],
                         "Not offered — the run was aborted")

    def test_estop_and_machine_off_are_booked(self):
        for msg, why in (({"cmd": "estop"}, "E-Stop during the run"), ({"cmd": "machine_off"}, "machine off during the run")):
            r = self.start()
            self.cycle(self.result(r["run"]), interp_state=linuxcnc.INTERP_READING, state=linuxcnc.RCS_EXEC)
            self.assertTrue(self.send(msg)["ok"], msg)
            self.cycle(interp_state=linuxcnc.INTERP_IDLE, state=linuxcnc.RCS_DONE)
            self.assertEqual(gateway._cal.candidate.why, why)

    def test_the_old_routine_s_warning_and_the_booking(self):
        gateway._probe_book.book({3032: 0.2}, "applied", gateway.current_link().seq, "probe")
        out = self.cycle((13, ' EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{0.0}]'))
        self.assertEqual(out, [(12, "Calibration routine is not the suite's — no result offered")])
        self.assertEqual(self.booked(), ("unknown", None))
        self.assertEqual(self.machine(), "saved_write_unknown")

    def test_a_fault_of_the_step_never_stops_the_status_loop(self):
        with unittest.mock.patch.object(gateway._cal, "cycle", side_effect=RuntimeError("boom")), \
                unittest.mock.patch.object(gateway._trace, "emit_exc") as said:
            self.assertEqual(self.cycle((12, "a message")), [(12, "a message")], "its messages go on")
        self.assertEqual(said.call_args[0][0], "cal.cycle_failed")

    def test_calibrate_then_abort_leaves_controller_and_record(self):
        # Codex' case: stored 0.20, controller 0.20, the local draft 0.05 —
        # the calibration sends no 3032 and changes nothing
        gateway._probe_book.book({3032: 0.2}, "applied", gateway.current_link().seq, "probe")
        self.start()
        self.send({"cmd": "abort"})
        self.cycle()
        self.assertNotIn("#3032", " ".join(self.cmd.mdis()))
        self.assertEqual((self.rec()["value"], self.booked()), (0.2, ("applied", 0.2)))


class TestApply(_Base):
    def apply(self, run, value=0.0712, key=None):
        return self.send({"cmd": "cal_apply", "run": run, "value": value}, key)

    def test_apply_stores_then_writes(self):
        run = self.offered()
        self.assertEqual(self.rec()["value"], 0.2, "nothing before Apply")
        n = len(self.cmd.mdis())
        r = self.apply(run)
        self.assertTrue(r["ok"], r)
        rec = self.rec()
        self.assertEqual((rec["value"], rec["unit"], rec["rev"], rec["source"]["run"]), (0.0712, "mm", 2, run))
        self.assertEqual(self.cmd.mdis()[n:], ["#3032=0.071200"])
        self.assertEqual((r["machine"]["outcome"], self.machine()), ("taken", "taken"))
        self.assertIn("3032\t0.071200", self.var.read_text())
        w = self.wire()
        self.assertEqual((w["cal_candidate"]["state"], w["probe_calibration"]["value"]), ("applied", 0.0712))

    def test_a_repeat_answers_already_applied_without_a_second_write(self):
        run = self.offered()
        self.apply(run)
        n = len(self.cmd.calls)
        self.assertEqual(self.apply(run), {"ok": False, "error": "Already applied"})
        self.assertEqual((len(self.cmd.calls), self.rec()["rev"]), (n, 2))

    def test_the_store_s_refusal_keeps_the_result_open(self):
        run = self.offered()
        with unittest.mock.patch.object(self.store, "_save_all", side_effect=OSError("disk full")):
            r = self.apply(run)
        self.assertEqual(r, {"ok": False, "error": "settings file not written"})
        self.assertEqual((gateway._cal.candidate.state, self.rec()["value"]), ("pending", 0.2))
        self.assertTrue(self.apply(run)["ok"])

    def test_stored_then_not_ready_is_saved_not_written(self):
        run = self.offered()
        gateway._probe_book.book({3032: 0.2}, "applied", gateway.current_link().seq, "probe")
        n = len(self.cmd.mdis())
        with unittest.mock.patch.object(gateway, "_controller_gate_refusal", lambda g, a: "Machine off"):
            r = self.apply(run)
        self.assertTrue(r["ok"])
        self.assertEqual((r["machine"]["outcome"], self.machine()), ("saved_not_written", "saved_not_written"))
        self.assertEqual((len(self.cmd.mdis()), self.booked(), self.rec()["value"]), (n, ("applied", 0.2), 0.0712))

    def test_stored_then_the_write_times_out_is_unknown(self):
        run = self.offered()
        self.cmd.rc = -1
        r = self.apply(run)
        self.assertTrue(r["ok"])
        self.assertEqual((r["machine"]["outcome"], self.booked()), ("saved_write_unknown", ("unknown", None)))
        self.assertEqual(gateway._cal.candidate.state, "applied")

    def test_taken_but_the_file_not(self):
        run = self.offered()
        with unittest.mock.patch.object(gateway, "_write_var_file_updates", side_effect=OSError("read-only")):
            r = self.apply(run)
        self.assertEqual(r["machine"]["outcome"], "taken_persist_unconfirmed")
        self.assertEqual(self.machine(), "taken_persist_unconfirmed")

    def test_disarmed_or_switched_off_between_the_store_and_the_write(self):
        for how in ("disarm", "switch"):
            run = self.offered()
            orig = gateway._cal_store

            async def then(record, admit, origin, how=how):
                out = await orig(record, admit, origin)
                if how == "disarm":
                    gateway._clients[911].armed = False
                else:
                    self.store.save_section("features", {**{f: True for f in features.FEATURES}, "probing": False},
                                            base_rev=self.store.view_for(None)["revs"].get("features", 0), writer="o")
                return out
            n = len(self.cmd.mdis())
            with unittest.mock.patch.object(gateway, "_cal_store", then):
                r = self.apply(run)
            self.assertTrue(r["ok"])
            self.assertEqual(r["machine"]["outcome"], "saved_not_written", how)
            self.assertEqual(len(self.cmd.mdis()), n, how)
            gateway._clients[911].armed = True
            self.record(0.2)

    def test_what_falls_during_the_admissions_own_poll_writes_nothing(self):
        # the machine step's admission polls the controller in the write's
        # thread: a disarm, a lost connection, another Link during that poll
        # — at each of its calls — sends no parameter (Codex R471 MT-I35)
        real = gateway._controller_gate_refusal
        for how in ("disarm", "gone", "link"):
            at = 0
            while True:
                at += 1
                run, writer, calls = self.offered(), gateway._clients[911], []
                # what the machine holds: another value (an earlier pass took 0.0712)
                gateway._probe_book.book({3032: 0.2}, "applied", gateway.current_link().seq, "probe")

                def gate(g, a, how=how, at=at, calls=calls):
                    why = real(g, a)
                    calls.append(1)
                    if len(calls) == at:
                        if how == "disarm":
                            gateway._clients[911].armed = False
                        elif how == "gone":
                            gateway._clients.pop(911)
                        else:
                            swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
                    return why
                n = len(self.cmd.mdis())
                with unittest.mock.patch.object(gateway, "_controller_gate_refusal", gate):
                    r = self.apply(run)
                gateway._clients[911] = writer
                writer.armed = True
                self.record(0.2)
                if len(calls) < at:
                    break               # every call of the admission was met
                with self.subTest(how, call=at):
                    self.assertTrue(r["ok"], r)
                    self.assertNotIn(r["machine"]["outcome"], ("taken", "taken_persist_unconfirmed"))
                    self.assertEqual(len(self.cmd.mdis()), n, "no parameter went out")
            self.assertGreater(at, 2, "the early admission and the write's")

    def test_a_machine_step_that_raises_is_its_outcome_not_apply_s_error(self):
        for exc in (linuxcnc.error("NML gone"), RuntimeError("boom")):
            run = self.offered()
            with unittest.mock.patch.object(gateway, "_apply_probe_vars_detail", side_effect=exc):
                r = self.apply(run)
            self.assertTrue(r["ok"], r)
            self.assertEqual((r["machine"]["outcome"], r["machine"]["why"]), ("saved_not_written", str(exc)))
            self.assertEqual((self.rec()["value"], gateway._cal.candidate.state, gateway._cal_writing),
                             (0.0712, "applied", False))
            self.record(0.2)

    def test_the_commit_admits_arm_switch_revision_and_link_at_the_write(self):
        # what changes after the handler's own first check is seen by the
        # admission inside the store's lock, right before the write
        for how, why in (("disarm", "Not armed"), ("gone", "Connection unknown"), ("switch", "Probing is off"),
                         ("rev", "The active offset changed since this run"), ("link", "connection changed")):
            run = self.offered()
            writer, real = gateway._clients[911], self.store.write_calibration
            before = []

            def meddle(record, admit, how=how, real=real, before=before, **kw):
                if how == "disarm":
                    gateway._clients[911].armed = False
                elif how == "gone":
                    gateway._clients.pop(911)
                elif how == "link":
                    swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
                elif how == "switch":
                    self.store.save_section("features", {**{f: True for f in features.FEATURES}, "probing": False},
                                            base_rev=self.store.view_for(None)["revs"]["features"], writer="other")
                else:
                    real({"value": 0.3, "unit": "mm", "state": "active"}, lambda *_a: None, **kw)
                before.append((self.rec(), self.store.version))
                return real(record, admit, **kw)
            n = len(self.cmd.mdis())
            with unittest.mock.patch.object(self.store, "write_calibration", meddle):
                r = self.apply(run)
            self.assertFalse(r["ok"], how)
            self.assertIn(why, r["error"], how)
            self.assertEqual((self.rec(), self.store.version), before[0], f"{how}: a refusal writes and bumps nothing")
            self.assertEqual(len(self.cmd.mdis()), n, how)
            gateway._clients[911] = writer
            writer.armed = True
            self.store.save_section("features", {f: True for f in features.FEATURES},
                                    base_rev=self.store.view_for(None)["revs"]["features"], writer="other")
            gateway._cal.run = gateway._cal.candidate = None

    def test_another_value_than_the_result_is_refused(self):
        run = self.offered()
        self.assertEqual(self.apply(run, 0.0713)["error"], "Another value than the result — reload the page")
        self.assertEqual(self.rec()["value"], 0.2)

    def test_a_cancel_waits_for_the_write_and_claims_nothing(self):
        run = self.offered()
        self.cmd.block = threading.Event()
        seen = {}

        async def go():
            task = asyncio.ensure_future(gateway.handle_command({"cmd": "cal_apply", "run": run, "value": 0.0712}, True, self.key))
            while not self.cmd.entered.is_set():
                await asyncio.sleep(0.005)
            seen["during"] = self.machine()
            task.cancel()
            await asyncio.sleep(0.02)
            seen["still_locked"] = gateway._get_cmd_lock().locked()
            self.cmd.block.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.cmd.entered.clear()
        self.run_async(go())
        self.assertEqual(seen, {"during": "write_pending", "still_locked": True})
        self.assertEqual(gateway._cal.candidate.state, "applied")
        self.assertEqual((self.rec()["value"], self.machine()), (0.0712, "saved_write_unknown"))

    def test_a_cancel_before_the_write_began_is_saved_not_written(self):
        # the abort lands while the record is being stored: the store's write
        # runs to its end, the candidate is applied, the machine never tried
        run = self.offered()
        entered, go_on = threading.Event(), threading.Event()
        real = self.store._save_all

        def slow(data):
            entered.set()
            go_on.wait(5)
            real(data)

        async def go():
            task = asyncio.ensure_future(gateway.handle_command(
                {"cmd": "cal_apply", "run": run, "value": 0.0712}, True, self.key))
            while not entered.is_set():
                await asyncio.sleep(0.005)
            task.cancel()
            await asyncio.sleep(0.02)
            self.assertFalse(task.done(), "the store's write is waited for")
            go_on.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        n = len(self.cmd.mdis())
        with unittest.mock.patch.object(self.store, "_save_all", slow):
            self.run_async(go())
        self.assertEqual((gateway._cal.candidate.state, self.rec()["value"], len(self.cmd.mdis())), ("applied", 0.0712, n))
        self.assertEqual(self.machine(), "saved_not_written")

    def test_two_clients_exactly_one_decision(self):
        second = gateway.ClientState(ip="u", ws=None, armed=True)
        gateway._clients[912] = second
        for first, then, why in (("cal_apply", "cal_apply", "Already applied"), ("cal_apply", "cal_discard", "Already applied"),
                                 ("cal_discard", "cal_apply", "Discarded meanwhile"),
                                 ("cal_discard", "cal_discard", "Discarded meanwhile")):
            run = self.offered()
            msg = {"cal_apply": {"cmd": "cal_apply", "run": run, "value": 0.0712}, "cal_discard": {"cmd": "cal_discard", "run": run}}

            async def both(first=first, then=then, msg=msg):
                return await asyncio.gather(gateway.handle_command(msg[first], True, self.key),
                                            gateway.handle_command(msg[then], True, second.conn_key))
            a, b = self.run_async(both())
            self.assertTrue(a["ok"], (first, a))
            self.assertEqual(b, {"ok": False, "error": why}, (first, then))
            self.record(0.2)
            gateway._cal_record_read = (None, None)

    def test_reset_supersedes_and_a_late_apply_meets_it(self):
        run = self.offered()
        self.assertTrue(self.send({"cmd": "cal_reset"})["ok"])
        self.assertEqual(self.apply(run)["error"], "A newer calibration replaced it")
        self.assertIsNone(self.wire()["cal_candidate"])

    def test_discard_changes_no_offset(self):
        run = self.offered()
        n = len(self.cmd.calls)
        self.assertTrue(self.send({"cmd": "cal_discard", "run": run})["ok"])
        self.assertEqual((self.rec()["value"], len(self.cmd.calls), self.wire()["cal_candidate"]["state"]), (0.2, n, "discarded"))
        gateway._clients[911].armed = False
        self.assertIn("Not armed", self.send({"cmd": "cal_discard", "run": run})["error"])

    def test_no_candidate_is_said(self):
        self.assertEqual(self.apply(5)["error"], "No calibration result")
        self.assertEqual(self.send({"cmd": "cal_discard", "run": 5})["error"], "No calibration result")

    def test_a_reply_lost_after_the_store_the_status_shows_it(self):
        run = self.offered()
        self.apply(run)
        # a client that connects afterwards sees the whole state
        w = self.wire()
        self.assertEqual((w["cal_candidate"]["run"], w["cal_candidate"]["state"]), (run, "applied"))
        self.assertEqual(w["probe_calibration"]["machine"]["outcome"], "taken")


class TestReset(_Base):
    def test_zero_in_the_machine_s_unit_stored_then_written(self):
        self.unit = "in"
        self.stat.program_units = 1
        r = self.send({"cmd": "cal_reset"})
        self.assertTrue(r["ok"], r)
        self.assertEqual((self.rec()["value"], self.rec()["unit"]), (0.0, "in"))
        self.assertEqual(self.cmd.mdis(), ["#3032=0.000000"])
        self.assertEqual(self.machine(), "taken")

    def test_no_machine_unit_no_reset(self):
        self.unit = None
        self.assertIn("Machine unit not read", self.send({"cmd": "cal_reset"})["error"])
        self.assertEqual((self.rec()["value"], self.cmd.mdis()), (0.2, []))

    def test_the_record_s_write_is_admitted_at_the_commit(self):
        gateway._clients[911].armed = False
        self.assertIn("Not armed", self.send({"cmd": "cal_reset"})["error"])
        self.assertEqual(self.rec()["value"], 0.2)


class TestTheOneWriterOf3032(_Base):
    PROBE = {"3014": 99, "3015": 20}

    def probe(self, routine="probe_round_boss", vars_=None):
        return self.send({"cmd": "probe_run", "routine": routine, "vars": vars_ or self.PROBE})

    def test_a_probing_job_gets_the_active_value_from_the_gateway(self):
        self.record(0.0712)
        self.assertTrue(self.probe()["ok"])
        self.assertIn("#3032=0.071200", self.cmd.mdis()[0])
        self.assertEqual(self.machine(), "taken")

    def test_a_routine_that_does_not_read_it_needs_none(self):
        self.record(None, state="none")
        self.assertTrue(self.probe("probe_z_minus_wco")["ok"])
        self.assertNotIn("#3032", " ".join(self.cmd.mdis()))

    def test_no_offset_is_refused_by_name(self):
        for value, unit, state, why in ((None, None, "none", "No calibration offset — calibrate or Reset"),
                                        (0.2, None, "active", "Calibration offset without a unit — calibrate or Reset"),
                                        (0.2, "in", "active", "Calibration offset in another unit — calibrate or Reset")):
            self.record(value, unit, state)
            self.assertEqual(self.probe()["error"], why)
        self.assertEqual(self.cmd.mdis(), [])
        # the record's state on the wire says the same, no machine claim
        self.assertEqual((self.wire()["probe_calibration"]["state"], self.wire()["probe_calibration"]["machine"]),
                         ("unit_other", None))

    def test_another_client_s_form_never_brings_an_old_offset_back(self):
        # A applies; B edits the feed only, saves and probes: the offset is A's
        run = self.offered()
        self.send({"cmd": "cal_apply", "run": run, "value": 0.0712})
        rev = self.store.view_for(None)["revs"].get("probe", 0)
        self.store.save_section("probe", {"slowFr": 60, "calOffset": 0.2}, base_rev=rev, writer="B")
        self.assertNotIn("calOffset", self.store.load()["probe"])
        self.cmd.calls.clear()
        self.assertTrue(self.probe()["ok"])
        self.assertIn("#3032=0.071200", self.cmd.mdis()[0])


class TestTheUnits(_Base):
    """MT440-01: the form's values are in the machine's unit — the program
    unit must be that one, at every write; never converted."""

    def test_g20_under_a_metric_form_is_refused_before_any_write(self):
        self.stat.program_units = 1
        want = "Probing values are in mm — the interpreter is in inch (G20): switch to G21"
        for msg in ({"cmd": "probe_run", "routine": ROUTINE, "vars": CAL},
                    {"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": {"3014": 99}},
                    {"cmd": "surface_scan_run", "vars": {"3050": 0}},
                    {"cmd": "set_params", "sets": {"probe": {"3014": 99}}},
                    {"cmd": "set_params", "sets": {"surface": {"3050": 1}}}):
            self.assertEqual(self.send(msg), {"ok": False, "error": want}, msg)
        self.assertEqual(self.cmd.calls, [])
        # the toolsetter's values are no probing form
        self.assertTrue(self.send({"cmd": "set_params", "sets": {"toolsetter": {"3102": -1}}})["ok"])

    def test_no_unit_read_is_refused(self):
        for units in (None, 0, 3):
            self.stat.program_units = units
            self.assertFalse(self.start()["ok"], units)
        self.stat.program_units = 2
        self.unit = None
        self.assertIn("Machine unit not read", self.start()["error"])
        self.assertEqual(self.cmd.calls, [])

    def test_a_switch_to_g20_between_the_admission_and_the_call_is_seen(self):
        def flip(text):
            if text.startswith("#3014"):
                self.stat.program_units = 1        # another client's G20
        self.cmd.on_mdi = flip
        r = self.start()
        self.assertFalse(r["ok"])
        self.assertIn("switch to G21", r["error"])
        self.assertFalse(any(m.startswith("O<") for m in self.cmd.mdis()))
        self.assertIsNone(gateway._cal.run)

    def test_a_declared_unit_is_never_a_default(self):
        for raw, want in (("mm", "mm"), ("metric", "mm"), ("inch", "in"), ("IN ", "in"), ("imperial", "in"),
                          (None, None), ("", None), ("furlong", None)):
            class Ini:
                def __init__(self, _path):
                    pass

                def find(self, section, option, raw=raw):
                    return raw if (section, option) == ("TRAJ", "LINEAR_UNITS") else None
            with unittest.mock.patch.object(linuxcnc, "ini", Ini):
                self.assertEqual(DECLARED(), want, raw)
        self.stat.ini_filename = ""
        self.assertIsNone(DECLARED())

    def test_an_inch_machine_asks_for_g20(self):
        self.unit = "in"
        self.assertIn("switch to G20", self.start()["error"])


class TestTheChunkStates(_Base):
    """_apply_probe_vars_detail's evidence, at the real helper (Codex' cases)."""

    def apply(self, admit=None, vars_=None):
        progress = []
        out = {}

        async def go():
            gateway._cmd_lock = None
            async with gateway._get_cmd_lock():
                with gateway._pinned_link():
                    out["r"] = await gateway._apply_probe_vars_detail(vars_ or {"3032": 0.2}, True, admit=admit, job="t",
                                                                      progress=progress)
        asyncio.run(go())
        self.assertEqual(out["r"]["chunks"], progress)
        return [c["state"] for c in progress], out["r"]

    def mdi_count(self):
        return len(self.cmd.mdis())

    def test_refused_at_the_mode_switch(self):
        self.stat.task_mode = linuxcnc.MODE_MANUAL
        states, r = self.apply(admit=lambda: "refused here")
        self.assertEqual((states, self.mdi_count(), r["mdi_set"], r["refused"]), (["not_written"], 0, False, None))
        self.assertIsNone(self.booked() if gateway._probe_book.entry(3032, 1) is None else None)
        self.assertEqual(gateway._probe_book.entry(3032, gateway.current_link().seq)["refused"]["why"], "refused here")

    def test_refused_right_before_the_write(self):
        states, _r = self.apply(admit=lambda: "refused here")       # already in MDI: no switch
        self.assertEqual((states, self.mdi_count()), (["not_written"], 0))

    def test_sent_then_timed_out(self):
        self.cmd.rc = -1
        states, _r = self.apply()
        self.assertEqual((states, self.mdi_count(), self.booked()), (["written_unknown"], 1, ("unknown", None)))

    def test_the_call_raised_after_its_begin(self):
        def boom(_text):
            raise linuxcnc.error("NML write failed")
        self.cmd.on_mdi = boom
        states, _r = self.apply()
        self.assertEqual((states, self.mdi_count(), self.booked()), (["written_unknown"], 0, ("unknown", None)))

    def test_taken(self):
        states, r = self.apply()
        self.assertEqual((states, self.booked(), r["persisted"]), (["taken"], ("applied", 0.2), True))

    def test_a_mode_switch_books_no_chunk(self):
        self.stat.task_mode = linuxcnc.MODE_MANUAL
        states, _r = self.apply()
        self.assertEqual((states, self.cmd.calls[0]), (["taken"], ("mode", linuxcnc.MODE_MDI)))

    def test_not_ready_is_not_written(self):
        self.stat.enabled = False
        states, r = self.apply()
        self.assertEqual((states, r["mdi_set"], self.cmd.calls), (["not_written"], False, []))
        self.assertEqual(gateway._probe_book.entry(3032, 1)["refused"], {"value": 0.2, "why": "machine not ready"})

    def test_a_link_change_after_the_write_is_unknown(self):
        orig = self.cmd.wait_complete

        def relink(*a):
            swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
            return orig(*a)
        self.cmd.wait_complete = relink
        states, _r = self.apply()
        self.assertEqual((states, self.booked()), (["written_unknown"], ("unknown", None)))

    def test_several_chunks_each_its_own(self):
        n = [0]

        def second_fails(_text):
            n[0] += 1
            if n[0] == 2:
                self.cmd.rc = -1
        self.cmd.on_mdi = second_fails
        vars_ = {str(k): 1.0 for k in range(3014, 3032)} | {str(k): 1.0 for k in range(3050, 3060)}
        states, r = self.apply(vars_=vars_)
        self.assertEqual(states[:2], ["taken", "written_unknown"])
        self.assertEqual(self.booked(3014), ("applied", 1.0))
        self.assertFalse(r["mdi_set"])


class TestTheBookingInTheGateway(_Base):
    def book(self, *keys):
        gateway._probe_book.book({k: 25.0 for k in keys}, "applied", gateway.current_link().seq, "probe")

    def test_an_mdi_line_s_direct_setting(self):
        self.book(3015, 3016)
        self.assertTrue(self.send({"cmd": "mdi", "text": "#3015=30"})["ok"])
        self.assertEqual((self.booked(3015), self.booked(3016)), (("unknown", None), ("applied", 25.0)))

    def test_what_the_text_does_not_settle_is_all(self):
        for text in ("#[3000+15]=30", "o<shop_probe> call", "#1=3015\n"):
            self.book(3015, 3016)
            self.send({"cmd": "mdi", "text": text.strip()})
            both = (self.booked(3015), self.booked(3016))
            self.assertEqual(both, (("unknown", None),) * 2 if text != "#1=3015\n" else (("applied", 25.0),) * 2, text)

    def test_it_is_unknown_before_the_possible_effect(self):
        self.book(3015)
        seen = []
        self.cmd.on_mdi = lambda _t: seen.append(self.booked(3015))
        self.send({"cmd": "mdi", "text": "o<shop_probe> call"})
        self.assertEqual(seen, [("unknown", None)])

    def test_a_refused_line_changes_nothing(self):
        self.book(3015)
        with unittest.mock.patch.object(gateway, "_interp_idle_refusal", lambda: "busy"):
            self.stat.interp_state = linuxcnc.INTERP_READING
            self.send({"cmd": "mdi", "text": "#3015=30"})
        self.assertEqual(self.booked(3015), ("applied", 25.0))

    def test_a_reinitialised_interpreter_is_all(self):
        self.book(3015)

        async def go():
            async with gateway._get_cmd_lock():
                await gateway._cmd_blocking(gateway.link(), gateway.op(linuxcnc.command.reset_interpreter))
        gateway._cmd_lock = None
        asyncio.run(go())
        self.assertEqual(self.booked(3015), ("unknown", None))

    def test_the_own_job_books_exactly_its_chunks(self):
        self.assertTrue(self.send({"cmd": "probe_run", "routine": "probe_z_minus_wco",
                                   "vars": {"3014": 99, "3015": 20}})["ok"])
        self.assertEqual((self.booked(3014), self.booked(3015), self.booked(3036)), (("applied", 99.0), ("applied", 20.0), None))
        self.start()
        self.assertEqual(self.booked(3036), ("applied", 0.0))

    def test_the_same_routine_from_another_file_is_all(self):
        self.facts["probe_z_minus_wco"] = (None, True)
        self.assertTrue(self.send({"cmd": "probe_run", "routine": "probe_z_minus_wco",
                                   "vars": {"3014": 99, "3015": 20}})["ok"])
        self.assertEqual((self.booked(3014), self.booked(3015)), (("unknown", None),) * 2)

    def test_a_routine_s_proven_effect_wins_over_its_chunk(self):
        self.facts["probe_z_minus_wco"] = (frozenset({3015}), False)
        self.send({"cmd": "probe_run", "routine": "probe_z_minus_wco", "vars": {"3014": 99, "3015": 20}})
        self.assertEqual((self.booked(3014), self.booked(3015)), (("applied", 99.0), ("unknown", None)))

    def test_the_frame_carries_it_once_per_change(self):
        c = gateway.ClientState(ip="x", ws=None)
        first = gateway._probe_state_for(c)
        self.assertEqual(set(first), {"probe_calibration", "cal_candidate", "probe_booking"})
        self.assertIsNone(gateway._probe_state_for(c))
        self.book(3015)
        self.assertEqual(gateway._probe_state_for(c)["probe_booking"]["keys"]["3015"]["outcome"], "applied")
        swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))
        self.assertEqual(gateway._probe_state_for(c)["probe_booking"]["keys"]["3015"]["outcome"], "unknown")


class TestTheMigration(_Base):
    def fresh_store(self, probe):
        path = self.dir / "m.json"
        path.write_text(json.dumps({str(self.ini): {"probe": probe}} if probe is not None else {}))
        s = SettingsStore(path, lambda: str(self.ini))
        p = unittest.mock.patch.object(gateway, "_settings_store", s)
        p.start()
        self.addCleanup(p.stop)
        gateway._cal_migrated.clear()
        gateway._cal_record_read = (None, None)
        return s

    def migrate(self):
        asyncio.run(gateway._cal_migrate_once())

    def test_the_declared_legacy_unit_never_the_program_s(self):
        s = self.fresh_store({"calOffset": 0.2, "slowFr": 50})
        self.stat.program_units = 1
        self.migrate()
        rec = s.calibration()
        self.assertEqual((rec["value"], rec["unit"], rec["unit_basis"], rec["state"]), (0.2, "mm", "declared_legacy", "active"))
        self.assertEqual(s.load()["probe"], {"slowFr": 50})
        # once: a later value in the probe section migrates nothing
        s.save_section("probe", {"calOffset": 0.9}, base_rev=s.view_for(None)["revs"]["probe"], writer="old page")
        gateway._cal_migrated.clear()
        self.migrate()
        self.assertEqual(s.calibration(), rec)

    def test_linear_units_unread_leaves_the_unit_unknown(self):
        s = self.fresh_store({"calOffset": 0.2})
        self.unit = None
        self.migrate()
        self.assertEqual((s.calibration()["value"], s.calibration()["unit"], s.calibration()["unit_basis"]), (0.2, None, "unknown"))
        self.assertEqual(gateway._cal_wire(1)["state"], "unit_unknown")
        self.assertIsNone(gateway._cal_wire(1)["machine"])
        self.assertEqual(gateway._active_offset()[0], None)

    def test_a_missing_or_invalid_old_value_is_none(self):
        for probe in (None, {}, {"calOffset": None}, {"calOffset": "0.2"}, {"calOffset": True}):
            s = self.fresh_store(probe)
            self.migrate()
            self.assertEqual((s.calibration()["value"], s.calibration()["state"]), (None, "none"), probe)

    def test_a_failed_write_is_tried_again_and_claims_nothing(self):
        s = self.fresh_store({"calOffset": 0.2})
        with unittest.mock.patch.object(s, "_save_all", side_effect=OSError("disk full")):
            self.migrate()
        self.assertEqual(gateway._cal_wire(1)["state"], "unread")
        self.migrate()
        self.assertIsNone(s.calibration(), "not again at once")
        gateway._cal_migrated[str(self.ini)] = gateway.time.monotonic() - 6
        self.migrate()
        self.assertEqual(s.calibration()["value"], 0.2)

    def test_no_ini_no_migration(self):
        s = self.fresh_store({"calOffset": 0.2})
        self.stat.ini_filename = ""
        self.migrate()
        self.assertIsNone(s.calibration())


class _TwoInis(_Base):
    """The storage jobs with the gateway's REAL INI readers: the store's key is
    read from the Link (never the fixture's constant), the unit from that INI's
    own [TRAJ] LINEAR_UNITS (Codex R470 MT-I38 / MT-I39)."""

    def setUp(self):
        super().setUp()
        self.other = self.dir / "other.ini"
        self.other.write_text("")
        units = self.units = {str(self.ini): "mm", str(self.other): "inch"}

        class Ini:
            def __init__(self, path):
                self.path = path

            def find(self, section, option):
                return units.get(self.path) if (section, option) == ("TRAJ", "LINEAR_UNITS") else None
        for target, name, value in ((gateway, "_declared_linear_unit", DECLARED), (linuxcnc, "ini", Ini)):
            p = unittest.mock.patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.path = self.dir / "dynamic.json"

    REC = {"value": 0.2, "unit": "mm", "state": "active", "rev": 4}

    def file(self, mill, other=None):
        """settings.json with these entries, read by a fresh store."""
        self.path.write_text(json.dumps({str(self.ini): mill, **({str(self.other): other} if other is not None else {})}))
        self.store = SettingsStore(self.path, gateway._current_ini_path)
        p = unittest.mock.patch.object(gateway, "_settings_store", self.store)
        p.start()
        self.addCleanup(p.stop)
        gateway._cal_record_read = (None, None)
        gateway._cal_migrated.clear()
        return self.store

    def stored(self, ini=None):
        return json.loads(self.path.read_text()).get(str(ini or self.ini), {})

    def link_to(self, ini):
        """The connection to another LinuxCNC (its own stat); None: lost."""
        if ini is None:
            return swap_connection(None)
        stat = copy.copy(self.stat)
        stat.ini_filename = str(ini)
        swap_connection(FakeConnection(stat=stat, cmd=self.cmd, err=self.err))

    def relink(self):
        """The machine of the test again: its own stat, naming mill.ini."""
        self.stat.ini_filename = str(self.ini)
        swap_connection(FakeConnection(stat=self.stat, cmd=self.cmd, err=self.err))

    def at_the_commit(self, name, how):
        """`how()` right before the store's own `name` — after the job read
        where it belongs."""
        real = getattr(self.store, name)

        def then(*a, **kw):
            how()
            return real(*a, **kw)
        return unittest.mock.patch.object(self.store, name, then)

    def migrate(self):
        asyncio.run(gateway._cal_migrate_once())


class TestAStorageJobBelongsToItsIni(_TwoInis):
    """MT-I38: the Link, its INI and the unit that INI declares belong to the
    job; the store writes exactly that key, admitted on that Link."""

    def reset(self):
        return self.send({"cmd": "cal_reset"})

    def test_reset_writes_the_linked_ini_s_record(self):
        self.file({"probeCalibration": self.REC})
        self.assertTrue(self.reset()["ok"])
        self.assertEqual({k: self.stored()["probeCalibration"][k] for k in ("value", "unit", "rev")},
                         {"value": 0.0, "unit": "mm", "rev": 1})
        self.assertEqual(list(json.loads(self.path.read_text())), [str(self.ini)])

    def test_reset_whose_link_went_before_the_commit_stores_nothing(self):
        for what, how, why in (
                ("lost", lambda: self.link_to(None), "Connection to LinuxCNC changed"),
                ("replaced by another INI's", lambda: self.link_to(self.other), "Connection to LinuxCNC changed"),
                ("replaced, the same INI", lambda: self.link_to(self.ini), "Connection to LinuxCNC changed"),
                ("the same, its INI no longer read", lambda: setattr(self.stat, "ini_filename", ""),
                 "Connection to LinuxCNC changed")):
            with self.subTest(what):
                self.file({"probeCalibration": self.REC}, {"probeCalibration": {**self.REC, "value": 0.7, "unit": "in"}})
                before, n = self.path.read_bytes(), len(self.cmd.mdis())
                with self.at_the_commit("write_calibration", how):
                    r = self.reset()
                self.assertEqual(self.path.read_bytes(), before, f"{what}: no INI's record is written")
                self.assertFalse(r["ok"], what)
                self.assertIn(why, r["error"], what)
                self.assertEqual(len(self.cmd.mdis()), n, what)
            self.relink()           # (outside: a failed case leaves the next one its machine)

    def test_reset_without_an_ini_is_refused_by_name(self):
        self.file({"probeCalibration": self.REC})
        before = self.path.read_bytes()
        for ini in ("", "default", "mill.ini"):         # unread, the stand-in, no absolute path
            self.stat.ini_filename = ini
            r = self.reset()
            self.assertEqual((r["ok"], self.path.read_bytes()), (False, before), ini)
            self.assertEqual(r["error"], "Machine INI not read — try again", ini)

    def test_apply_keeps_its_link_check_and_its_key(self):
        for what, how, why in (
                ("replaced by another INI's", lambda: self.link_to(self.other), "connection changed"),
                ("lost", lambda: self.link_to(None), "connection changed"),
                # the run's own Link, and it names another INI: the run's check passes, the job's does not
                ("the same, another INI", lambda: setattr(self.stat, "ini_filename", str(self.other)),
                 "Connection to LinuxCNC changed")):
            with self.subTest(what):
                self.file({"probeCalibration": self.REC}, {"probeCalibration": {**self.REC, "value": 0.7, "unit": "in"}})
                run = self.offered()
                before = self.path.read_bytes()
                with self.at_the_commit("write_calibration", how):
                    r = self.send({"cmd": "cal_apply", "run": run, "value": 0.0712})
                self.assertEqual((r["ok"], self.path.read_bytes()), (False, before), what)
                self.assertIn(why, r["error"], what)
            self.relink()
            gateway._cal.run = gateway._cal.candidate = None
        # (the positive control)
        run = self.offered()
        self.assertTrue(self.send({"cmd": "cal_apply", "run": run, "value": 0.0712})["ok"])
        self.assertEqual(self.stored()["probeCalibration"]["value"], 0.0712)
        self.assertEqual(self.stored(self.other)["probeCalibration"]["value"], 0.7)

    def test_migration_of_the_linked_ini(self):
        self.file({"probe": {"calOffset": 0.2, "slowFr": 50}}, {"probe": {"calOffset": 0.7}})
        self.migrate()
        rec = self.stored()["probeCalibration"]
        self.assertEqual((rec["value"], rec["unit"], self.stored()["probe"]), (0.2, "mm", {"slowFr": 50}))
        self.assertEqual(self.stored(self.other), {"probe": {"calOffset": 0.7}})

    def test_a_migration_whose_link_went_migrates_no_ini_and_is_tried_again(self):
        for what, how in (("lost", lambda: self.link_to(None)), ("replaced", lambda: self.link_to(self.other)),
                          ("its INI no longer read", lambda: setattr(self.stat, "ini_filename", ""))):
            with self.subTest(what):
                self.relink()
                self.file({"probe": {"calOffset": 0.2}}, {"probe": {"calOffset": 0.7}})
                before = self.path.read_bytes()
                with self.at_the_commit("migrate_calibration", how):
                    self.migrate()
                self.assertEqual(self.path.read_bytes(), before, f"{what}: nothing is stored, under no key")
                self.assertNotIn(str(self.ini), gateway._cal_migrated, f"{what}: not done, and no waiting time")
                # the next status cycle that has the machine again migrates it
                self.relink()
                self.migrate()
                rec = self.stored()["probeCalibration"]
                self.assertEqual((rec["value"], rec["unit"]), (0.2, "mm"), what)

    def test_a_link_change_skips_no_unmigrated_ini(self):
        self.file({"probe": {"calOffset": 0.2}}, {"probe": {"calOffset": 0.7}})
        with self.at_the_commit("migrate_calibration", lambda: self.link_to(self.other)):
            self.migrate()
        self.migrate()                                  # the machine linked now: its own value and unit
        rec = self.stored(self.other)["probeCalibration"]
        self.assertEqual((rec["value"], rec["unit"]), (0.7, "in"))
        self.assertNotIn("probeCalibration", self.stored())
        self.link_to(self.ini)
        self.migrate()
        rec = self.stored()["probeCalibration"]
        self.assertEqual((rec["value"], rec["unit"]), (0.2, "mm"))
        self.assertEqual(gateway._cal_migrated, {str(self.ini): 0, str(self.other): 0})

    def test_one_ini_s_failed_write_holds_no_other_ini(self):
        self.file({"probe": {"calOffset": 0.2}}, {"probe": {"calOffset": 0.7}})
        with unittest.mock.patch.object(self.store, "_save_all", side_effect=OSError("disk full")):
            self.migrate()
        self.link_to(self.other)
        self.migrate()
        self.assertEqual(self.stored(self.other)["probeCalibration"]["value"], 0.7)
        self.link_to(self.ini)
        self.migrate()
        self.assertNotIn("probeCalibration", self.stored(), "not again at once")
        gateway._cal_migrated[str(self.ini)] -= 6
        self.migrate()
        self.assertEqual(self.stored()["probeCalibration"]["value"], 0.2)

    def test_the_record_is_read_under_the_ini_it_is_kept_for(self):
        # the Link goes to another machine between the cache's key and the read
        self.file({"probeCalibration": self.REC}, {"probeCalibration": {**self.REC, "value": 0.7, "unit": "in"}})
        with self.at_the_commit("calibration", lambda: self.link_to(self.other)):
            gateway._cal_record()
        self.link_to(self.ini)
        self.assertEqual(gateway._cal_record()["value"], 0.2, "never another INI's under this one's key")

    def test_one_status_frame_speaks_of_one_machine(self):
        self.file({"probeCalibration": self.REC}, {"probeCalibration": {**self.REC, "value": 0.7, "unit": "in"}})
        with self.at_the_commit("calibration", lambda: self.link_to(self.other)):
            w = self.wire()["probe_calibration"]
        self.assertEqual((w["value"], w["unit"], w["state"]), (0.2, "mm", "active"),
                         "its record is judged by its own INI's unit")
        self.relink()
        gateway._cal_record_read = (None, None)
        with self.at_the_commit("calibration", lambda: self.link_to(self.other)):
            self.assertEqual(gateway._active_offset(), (0.2, None), "a job's offset too")

    def test_the_machine_write_belongs_to_the_record_s_ini(self):
        # between the record and its write the Link names another INI, whose
        # record has the same revision and the same unit
        self.units[str(self.other)] = "mm"
        self.file({"probeCalibration": self.REC}, {"probeCalibration": {**self.REC, "value": 0.7, "rev": 1}})
        real = gateway._cal_store

        async def then(*a):
            out = await real(*a)
            self.stat.ini_filename = str(self.other)
            return out
        n = len(self.cmd.mdis())
        with unittest.mock.patch.object(gateway, "_cal_store", then):
            r = self.reset()
        self.assertEqual((r["ok"], r["machine"]["outcome"], len(self.cmd.mdis())), (True, "saved_not_written", n))
        self.assertIn("Connection to LinuxCNC changed", r["machine"]["why"])
        self.assertEqual((self.stored()["probeCalibration"]["value"], self.stored(self.other)["probeCalibration"]["value"]), (0.0, 0.7))

    def test_no_connection_is_no_record(self):
        self.file({"probeCalibration": self.REC})
        raw = json.loads(self.path.read_text())
        raw["default"] = {"probeCalibration": {**self.REC, "value": 0.9}}      # (an earlier build's)
        self.path.write_text(json.dumps(raw))
        self.store = SettingsStore(self.path, gateway._current_ini_path)
        self.link_to(None)
        with unittest.mock.patch.object(gateway, "_settings_store", self.store):
            gateway._cal_record_read = (None, None)
            self.assertEqual(self.wire()["probe_calibration"]["state"], "unread")


class _Body:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


class TestASaveBeforeTheMigration(_TwoInis):
    """MT-I39: the PERSISTED offset of the probe form survives every save until
    the migration took it — on the WS, the HTTP and the beacon's way."""

    def legacy(self, rev=0):
        self.file({"probe": {"calOffset": 0.2, "slowFr": 50},
                   "_v2": {"schema": 2, "template": {}, "devices": {}, "revs": {"probe": rev}}})

    def ws(self, data, base):
        return asyncio.run(gateway._ws_save_settings(gateway._clients[911], {
            "cmd": "save_settings", "section": "probe", "data": data, "base_rev": base}))

    def http(self, data, base):
        return asyncio.run(gateway.put_settings_section("probe", _Body({"data": data, "base_rev": base}),
                                                        x_conn_key=self.key, x_device_token=None))

    def beacon(self, data, base):
        return asyncio.run(gateway.put_settings_section(
            "probe", _Body({"data": data, "base_rev": base, "conn_key": self.key}), x_conn_key=None, x_device_token=None))

    def test_the_stored_value_survives_the_save_on_every_way(self):
        for way in (self.ws, self.http, self.beacon):
            for what, data in (("an old page's form", {"calOffset": 0.2, "slowFr": 60}), ("a new form", {"slowFr": 60}),
                               ("an old page with another value", {"calOffset": 0.99, "slowFr": 60})):
                with self.subTest(way=way.__name__, form=what):
                    self.legacy()
                    r = way(data, 0)
                    self.assertTrue(r["ok"], r)
                    self.assertIsNone(self.store.calibration(), "a save migrates nothing")
                    self.migrate()
                    rec = self.store.calibration()
                    self.assertEqual((rec["value"], rec["unit"], rec["state"]), (0.2, "mm", "active"), what)
                    self.assertEqual(self.stored()["probe"], {"slowFr": 60}, "then the section loses the key")

    def test_a_failed_migration_s_waiting_time_is_open_to_saves(self):
        self.legacy(rev=3)
        with unittest.mock.patch.object(self.store, "_save_all", side_effect=OSError("disk full")):
            self.migrate()
        for n, data in enumerate(({"slowFr": 60}, {"calOffset": 0.99, "slowFr": 61}, {"slowFr": 62})):
            self.assertTrue(self.ws(data, 3 + n)["ok"])
        gateway._cal_migrated[str(self.ini)] -= 6
        self.migrate()
        rec = self.store.calibration()
        self.assertEqual((rec["value"], rec["migrated"]["from_rev"]), (0.2, 6), "from the section's revision that held it")
        self.assertEqual(self.stored()["probe"], {"slowFr": 62})

    def test_the_migration_first_then_every_save_drops_it(self):
        for way in (self.ws, self.http, self.beacon):
            self.legacy()
            self.migrate()
            r = way({"calOffset": 0.99, "slowFr": 60}, 1)
            self.assertTrue(r["ok"], r)
            self.assertEqual(self.store.calibration()["value"], 0.2)
            self.assertEqual(self.stored()["probe"], {"slowFr": 60})


class TestTheRealRoutineFacts(unittest.TestCase):
    """_routine_facts on the files the interpreter resolves."""

    def facts(self, name, *dirs):
        with unittest.mock.patch.object(gateway, "_oword_search", lambda: (None, "", [str(d) for d in dirs])), \
                unittest.mock.patch.object(gateway, "_remap_env", lambda: gateway.RemapEnv(
                    [], [str(d) for d in dirs], keys=gateway._REMAP_KEYS)):
            return gateway._routine_facts(name)

    def test_the_bundled_one_is_proven(self):
        bundle = ROOT / "subroutines/probe_basic"
        self.assertEqual(self.facts("probe_round_boss", bundle), (frozenset(), True))
        self.assertEqual(self.facts("probe_z_minus_wco", bundle), (frozenset(), False))
        self.assertEqual(self.facts("probe_cal_round_pocket", bundle)[0], frozenset())

    def test_another_file_earlier_on_the_path_is_not(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "probe_z_minus_wco.ngc").write_text("o<probe_z_minus_wco> sub\no<probe_z_minus_wco> endsub\n")
            self.assertEqual(self.facts("probe_z_minus_wco", d, ROOT / "subroutines/probe_basic"), (None, True))

    def test_nothing_resolved_is_not_proven(self):
        with unittest.mock.patch.object(gateway, "_oword_search", lambda: None), \
                unittest.mock.patch.object(gateway, "_remap_env", lambda: gateway.RemapEnv.unknown()):
            self.assertEqual(gateway._routine_facts("probe_round_boss"), (None, True))


if __name__ == "__main__":
    unittest.main()

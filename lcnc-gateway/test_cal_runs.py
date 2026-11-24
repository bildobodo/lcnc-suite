"""The calibration runs and their candidate (cal_runs — P5-1 b/d, plan v6,
Codex R439–R444): the durable run counter, the result line, and the open
run's proofs with the reviewers' counter-cases. Pure: no gateway import."""
import json
import os
import tempfile
import unittest
from pathlib import Path

import cal_runs
from cal_runs import (CalRun, CalState, CandidateMsg, CounterError, Cycle, DrainRequest, MAX_RUN, WHY_ABORT, WHY_BASE,
                      WHY_ERROR, WHY_ESTOP, WHY_LINK, WHY_NO_RESULT, WHY_NOT_STARTED, WHY_OFF, WHY_ROUTINE,
                      WHY_UNKNOWN_SEND, at_rest, counter_next, parse_candidate, reserve_run, size_of)

INI = "mill.ini"


class TestTheCounter(unittest.TestCase):
    def setUp(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        self.path = str(Path(d.name, cal_runs.COUNTER_FILE))

    def put(self, data):
        Path(self.path).write_text(data if isinstance(data, str) else json.dumps(data))

    def next_of(self, ini=INI):
        return json.loads(Path(self.path).read_text())[ini]["next"]

    def test_the_first_and_the_following_reservations_have_no_gap(self):
        self.assertEqual(reserve_run(self.path, INI, 0), (1, True))
        self.assertEqual(reserve_run(self.path, INI, 1), (2, False))
        self.assertEqual(reserve_run(self.path, INI, 2), (3, False))
        self.assertEqual(self.next_of(), 4)

    def test_the_next_token_is_on_the_disk_before_the_token_is_given(self):
        # a restart after the reservation and before the call: the token
        # reserved and never sent stays used
        reserve_run(self.path, INI, 0)
        self.assertEqual(self.next_of(), 2)
        self.assertEqual(reserve_run(self.path, INI, 0)[0], 2)   # a new process: last_reserved 0 again

    def test_a_locally_higher_reservation_wins(self):
        self.put({INI: {"next": 3}})
        self.assertEqual(reserve_run(self.path, INI, 9)[0], 10)
        self.assertEqual(self.next_of(), 11)

    def test_the_last_token_then_used_up_by_name_also_after_a_restart(self):
        self.put({INI: {"next": MAX_RUN}})
        self.assertEqual(reserve_run(self.path, INI, 0)[0], MAX_RUN)
        self.assertEqual(self.next_of(), MAX_RUN + 1)
        for last in (MAX_RUN, 0):
            before = Path(self.path).read_text()
            with self.assertRaisesRegex(CounterError, "^Calibration run ids used up$"):
                reserve_run(self.path, INI, last)
            self.assertEqual(Path(self.path).read_text(), before, "refused before any write")
        # `next` = 1 again is only ever a removed file — never the counter's own doing

    def test_a_value_that_is_no_token_is_refused_never_rounded(self):
        for bad in (1.0, 1.5, -1, 0, MAX_RUN + 2, "7", True, None, [1], float("inf")):
            self.put('{"%s": {"next": %s}}' % (INI, json.dumps(bad)))
            before = Path(self.path).read_text()
            with self.assertRaisesRegex(CounterError, "^Calibration run counter unreadable — ", msg=bad):
                reserve_run(self.path, INI, 0)
            self.assertEqual(Path(self.path).read_text(), before, bad)

    def test_an_unreadable_file_is_refused(self):
        for bad in ("", "{", "[]", "3", '{"%s": 3}' % INI, '{"%s": {}}' % INI,
                    '{"%s": {"next": 1}, "%s": {"next": 5}}' % (INI, INI), '{"%s": {"next": NaN}}' % INI):
            self.put(bad)
            with self.assertRaisesRegex(CounterError, "unreadable", msg=bad):
                reserve_run(self.path, INI, 0)
        Path(self.path).unlink()
        os.mkdir(self.path)
        with self.assertRaisesRegex(CounterError, "unreadable"):
            reserve_run(self.path, INI, 0)

    def test_a_file_that_cannot_be_written_gives_no_token(self):
        self.put({INI: {"next": 5}})
        os.chmod(os.path.dirname(self.path), 0o555)
        self.addCleanup(os.chmod, os.path.dirname(self.path), 0o755)
        if os.access(os.path.dirname(self.path), os.W_OK):
            self.skipTest("the folder cannot be made read-only here")
        with self.assertRaisesRegex(CounterError, "^Calibration run id not reserved — "):
            reserve_run(self.path, INI, 0)
        self.assertEqual(self.next_of(), 5)

    def test_two_inis_of_one_folder_count_for_themselves(self):
        # the shipped example keeps three profiles in one folder: no INI
        # refuses the other's calibration, none advances the other's counter
        self.assertEqual(reserve_run(self.path, "a.ini", 0), (1, True))
        self.assertEqual(reserve_run(self.path, "b.ini", 0), (1, True))
        self.assertEqual(reserve_run(self.path, "a.ini", 1), (2, False))
        self.assertEqual((self.next_of("a.ini"), self.next_of("b.ini")), (3, 2))

    def test_the_counter_s_reader_alone(self):
        self.assertIsNone(counter_next(None, INI))
        self.assertIsNone(counter_next("{}", INI))
        self.assertEqual(counter_next('{"mill.ini": {"next": 12, "updated": "x"}}', INI), 12)


class TestTheResultLine(unittest.TestCase):
    def test_the_interpreter_s_print_reads_exactly(self):
        # Interp::convert_param_comment prints %lf; the DEBUG text keeps its leading blank
        for run in (1, 4_194_304, MAX_RUN):
            got = parse_candidate(f" LCNC_CAL_CANDIDATE run={run}.000000 value=0.071200 axis=0.000000")
            self.assertEqual(got, CandidateMsg(run, 0.0712, 0))
        self.assertEqual(parse_candidate("LCNC_CAL_CANDIDATE run=7 value=0 axis=2"), CandidateMsg(7, 0.0, 2))

    def test_anything_else_is_invalid_or_no_result_line(self):
        for bad in ("run=7.5 value=0.1 axis=0", "run=-7 value=0.1 axis=0", "run=0.000000 value=0.1 axis=0",
                    "run=10000000.000000 value=0.1 axis=0", "run=7 value=nan axis=0", "run=7 value=inf axis=0",
                    "run=7 value=-0.1 axis=0", "run=7 value=0.1 axis=3", "run=7 value=0.1 axis=0.5",
                    "run=7 value=0.1", "run=7 value=x axis=0", "value=0.1 run=7 axis=0", "run=1e3 value=0.1 axis=0"):
            self.assertIsInstance(parse_candidate("LCNC_CAL_CANDIDATE " + bad), str, bad)
        for other in ("", "LCNC_SURFACE_SCAN_DONE", "x LCNC_CAL_CANDIDATE run=7 value=0.1 axis=0",
                      'EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{0.1}]'):
            self.assertIsNone(parse_candidate(other), other)


DONE, EXEC, RCS_ERR = 1, 2, 3
IDLE, READING = 1, 2


def fields(**over):
    f = {"echo": 50, "state": DONE, "interp_state": IDLE, "queued": 0, "exec_state": 2}
    f.update(over)
    return f


BUSY = dict(state=EXEC, interp_state=READING, queued=0, exec_state=3)


class Rig:
    """A CalState on its own clock: the write's hooks, then status cycles."""

    def __init__(self):
        self.t = 100.0
        self.traces = []
        self.old = 0
        self.s = CalState(clock=lambda: self.t, emit=lambda tag, **k: self.traces.append((tag, k)),
                          proof_window_s=0.02, now=lambda: "2026-11-24T05:12:00",
                          on_old_routine=lambda: setattr(self, "old", self.old + 1))

    def start(self, run=12, link=1, rev=4, axis=0, routine="probe_cal_round_pocket", serial=40):
        r = CalRun(run=run, routine=routine, starter="k", link_seq=link, basis={"3033": 20.0, "3036": float(axis)},
                   unit="mm", axis=axis, size=size_of(routine, {"3033": 20.0}), base_rev=rev, was=0.0677)
        self.s.call_began(r)
        self.t += 0.001
        self.s.call_sent(r, serial)
        return r

    def cycle(self, *messages, link=1, rev=4, estop=False, enabled=True, drained=None, **f):
        self.t += 0.05
        return self.s.cycle(Cycle(polled_at=self.t, link_seq=link, fields=fields(**f), estop=estop, enabled=enabled,
                                  messages=tuple(messages), drained=drained), rev)

    def result(self, run=12, value=0.0712, axis=0):
        return (13, f" LCNC_CAL_CANDIDATE run={run}.000000 value={value:.6f} axis={axis}.000000")

    @property
    def cand(self):
        return self.s.candidate

    def tags(self):
        return [t for t, _ in self.traces]


class TestARun(unittest.TestCase):
    def test_a_complete_run_offers_its_value(self):
        g = Rig()
        g.start()
        g.cycle(**BUSY)
        self.assertIsNone(g.cand)
        self.assertEqual(g.cycle(g.result(), (12, "a message"), **BUSY), [(12, "a message")], "the result line is consumed")
        self.assertIsNone(g.cand, "nothing is offered before the clean end")
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.value, g.cand.run, g.cand.axis), ("pending", 0.0712, 12, 0))
        self.assertEqual(g.s.wire(), {"run": 12, "value": 0.0712, "was": 0.0677, "routine": "probe_cal_round_pocket",
                                      "size": {"d": 20.0}, "axis": 0, "unit": "mm", "at": "2026-11-24T05:12:00",
                                      "state": "pending", "why": None})

    def test_the_end_needs_the_channel_read_empty_after_the_rest(self):
        g = Rig()
        g.start()
        g.cycle(g.result(), **BUSY)
        for why in ("more messages than one read takes", "no error channel", "error channel not read (error)",
                    "the connection changed"):
            g.cycle(drained=why)
            self.assertIsNone(g.cand, why)
        g.cycle((11, "Probe move finished without making contact"), drained="more messages than one read takes")
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_ERROR))

    def test_the_rest_is_more_than_idle(self):
        g = Rig()
        g.start()
        g.cycle(g.result(), **BUSY)
        for f in ({"queued": 1}, {"queued": None}, {"exec_state": 5}, {"exec_state": None}, {"state": EXEC},
                  {"state": None}, {"interp_state": None}, {"echo": 39}, {"echo": None}):
            g.cycle(**f)
            self.assertIsNone(g.cand, f)
        self.assertFalse(at_rest(fields(queued=1)))
        g.cycle()
        self.assertEqual(g.cand.state, "pending")

    def test_a_poll_begun_before_the_write_ends_nothing(self):
        g = Rig()
        r = g.start()
        g.s.cycle(Cycle(polled_at=r.sent_t - 0.5, link_seq=1, fields=fields(), estop=False, enabled=True), 4)
        self.assertIs(g.s.run, r)

    def test_a_result_before_the_retract_then_abort_is_not_offered(self):
        g = Rig()
        g.start()
        g.cycle(g.result(), **BUSY)
        g.s.note_end_of_machine(WHY_ABORT)
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_ABORT))
        self.assertEqual(g.s.refusal(12, 4, 1), f"Not offered — {WHY_ABORT}")

    def test_an_error_estop_or_power_off_in_the_window_is_not_offered(self):
        for how, why in (("error", WHY_ERROR), ("estop", WHY_ESTOP), ("off", WHY_OFF)):
            g = Rig()
            g.start()
            g.cycle(g.result(), **BUSY)
            if how == "error":
                g.cycle((11, "probe tripped during a jog"), **BUSY)
            else:
                g.cycle(estop=how == "estop", enabled=how != "off", **BUSY)
            g.cycle()
            self.assertEqual((g.cand.state, g.cand.why), ("stale", why), how)

    def test_the_interpreter_s_own_error_ends_it(self):
        g = Rig()
        g.start()
        g.cycle(**BUSY)
        for _ in range(3):
            g.cycle(state=RCS_ERR, echo=40)
        self.assertEqual((g.cand.state, g.cand.why, g.cand.value), ("stale", WHY_ERROR, None))

    def test_an_interpreter_that_only_stays_idle_did_not_start(self):
        g = Rig()
        g.start()
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_NOT_STARTED))

    def test_a_run_without_a_result_line_is_named(self):
        # #5599 = 0 switches the DEBUG lines off: never silence
        g = Rig()
        g.start()
        g.cycle(**BUSY)
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_NO_RESULT))

    def test_a_link_change_in_the_run_is_not_offered(self):
        g = Rig()
        g.start()
        g.cycle(**BUSY)
        g.cycle(g.result(), link=2, **BUSY)
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_LINK))
        self.assertIn("cal.message_other_link", g.tags())

    def test_run_a_s_late_message_never_becomes_run_b_s(self):
        # Codex' case: A aborted, B started, A's message with the SAME value
        # on the same Link
        g = Rig()
        g.start(run=12)
        g.cycle(**BUSY)
        g.s.note_end_of_machine(WHY_ABORT)
        g.cycle()
        g.start(run=13, serial=60)
        g.cycle(g.result(run=12), echo=60, **BUSY)
        self.assertIsNone(g.s.run.result)
        self.assertIn("cal.message_stale", g.tags())
        g.cycle(echo=61)
        self.assertEqual((g.cand.run, g.cand.state, g.cand.why), (13, "stale", WHY_NO_RESULT))

    def test_a_late_message_never_replaces_the_candidate(self):
        g = Rig()
        g.start(run=13)
        g.cycle(g.result(run=13), **BUSY)
        g.cycle()
        for late in (g.result(run=12, value=0.9), g.result(run=13, value=0.9)):
            g.cycle(late)
            self.assertEqual((g.cand.run, g.cand.value, g.cand.state), (13, 0.0712, "pending"))
        g.s.decided(13, "applied")
        g.cycle(g.result(run=13, value=0.9))
        self.assertEqual((g.cand.value, g.cand.state), (0.0712, "applied"))

    def test_a_second_message_of_the_run_is_ignored(self):
        g = Rig()
        g.start()
        g.cycle(g.result(value=0.0712), g.result(value=0.5), **BUSY)
        g.cycle()
        self.assertEqual(g.cand.value, 0.0712)
        self.assertIn("cal.message_twice", g.tags())

    def test_an_old_routine_is_a_warning_never_a_candidate(self):
        g = Rig()
        g.start()
        old = (13, ' EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{0.071200}]')
        self.assertEqual(g.cycle(old, old, **BUSY), [(12, "Calibration routine is not the suite's — no result offered")])
        self.assertEqual(g.old, 2)
        g.cycle(g.result(), **BUSY)
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_ROUTINE))

    def test_an_old_routine_outside_a_run_is_warned_too(self):
        g = Rig()
        out = g.cycle((13, ' EVAL[vcp.getWidget{"calibration_offset_3032"}.setValue{0.000000}]'))
        self.assertEqual(out, [(12, "Calibration routine is not the suite's — no result offered")])
        self.assertEqual((g.old, g.cand), (1, None))

    def test_another_axis_than_asked_is_not_offered(self):
        g = Rig()
        g.start(axis=2)
        g.cycle(g.result(axis=1), **BUSY)
        g.cycle()
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_ROUTINE))

    def test_an_invalid_line_is_traced_and_never_forwarded(self):
        g = Rig()
        g.start()
        self.assertEqual(g.cycle((13, " LCNC_CAL_CANDIDATE run=12.5 value=0.1 axis=0"), **BUSY), [])
        self.assertIn("cal.message_invalid", g.tags())
        g.cycle()
        self.assertEqual(g.cand.why, WHY_NO_RESULT)

    def test_a_call_that_raised_offers_nothing(self):
        g = Rig()
        r = CalRun(run=12, routine="probe_cal_round_pocket", starter="k", link_seq=1, basis={}, unit="mm", axis=0,
                   size={}, base_rev=4, was=None)
        g.s.call_began(r)
        g.s.call_failed(r)
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_UNKNOWN_SEND))

    def test_the_active_offset_changed_since_the_start(self):
        g = Rig()
        g.start(rev=4)
        g.cycle(g.result(), **BUSY)
        g.cycle(rev=5)
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_BASE))
        # …and after it was offered (a Reset, another client's Apply)
        g = Rig()
        g.start(rev=4)
        g.cycle(g.result(), **BUSY)
        g.cycle(rev=4)
        self.assertEqual(g.s.refusal(12, 5, 1), "The active offset changed since this run — calibrate again")
        g.cycle(rev=5)
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_BASE))

    def test_a_new_call_supersedes_the_open_candidate_only_once_it_begins(self):
        g = Rig()
        g.start(run=12)
        g.cycle(g.result(), **BUSY)
        g.cycle()
        self.assertEqual(g.cand.state, "pending")
        g.start(run=13)
        self.assertIsNone(g.s.wire())
        self.assertEqual(g.s.refusal(12, 4, 1), "A newer calibration replaced it")


class TestADecision(unittest.TestCase):
    def offered(self):
        g = Rig()
        g.start()
        g.cycle(g.result(), **BUSY)
        g.cycle()
        return g

    def test_each_state_answers_a_second_client(self):
        for state, why in (("applied", "Already applied"), ("discarded", "Discarded meanwhile")):
            g = self.offered()
            self.assertIsNone(g.s.refusal(12, 4, 1))
            g.s.decided(12, state)
            self.assertEqual(g.s.refusal(12, 4, 1), why)
        g = self.offered()
        self.assertEqual(g.s.refusal(11, 4, 1), "No such calibration result — reload the page")
        self.assertEqual(g.s.refusal(12, 4, 2), f"Not offered — {WHY_LINK}")
        self.assertEqual(g.s.refusal(12, None, 1), "The active offset changed since this run — calibrate again")
        self.assertEqual(Rig().s.refusal(12, 4, 1), "No calibration result")

    def test_a_reserved_candidate_is_left_alone_by_the_status_cycle(self):
        g = self.offered()
        g.s.deciding(12)
        self.assertEqual(g.s.wire()["state"], "pending", "every client still sees it open")
        g.cycle(link=2, rev=9)
        g.s.decided(12, "applied")
        self.assertEqual(g.s.wire()["state"], "applied")
        g = self.offered()
        g.s.deciding(12)
        g.s.undecided(12)
        g.cycle(link=2)
        self.assertEqual((g.cand.state, g.cand.why), ("stale", WHY_LINK))

    def test_reset_supersedes_it(self):
        g = self.offered()
        v = g.s.version
        g.s.supersede("reset")
        self.assertIsNone(g.s.wire())
        self.assertGreater(g.s.version, v)


class TestTheDrainRequest(unittest.TestCase):
    def ask(self, cycle=7, deadline=10.0):
        self.got = []
        return DrainRequest(cycle=cycle, link_seq=1, done=self.got.append, deadline=deadline)

    def c(self, drained=None, link=1, **f):
        return Cycle(polled_at=1.0, link_seq=link, fields=fields(**f), estop=False, enabled=True, drained=drained)

    def test_a_cycle_already_running_does_not_serve_it(self):
        r = self.ask()
        self.assertFalse(r.serve(7, self.c(), 1.0))
        self.assertEqual(self.got, [])
        self.assertTrue(r.serve(8, self.c(), 1.0))
        self.assertEqual(self.got, [None])
        r.serve(9, self.c(drained="x"), 1.0)
        self.assertEqual(self.got, [None], "answered once")

    def test_no_proof_is_an_answer(self):
        for c, why in ((self.c(drained="more messages than one read takes"), "more messages than one read takes"),
                       (self.c(drained="no error channel"), "no error channel"),
                       (self.c(link=2), "connection changed")):
            r = self.ask()
            r.serve(8, c, 1.0)
            self.assertEqual(self.got, [why])

    def test_work_still_running_is_waited_for_then_refused(self):
        r = self.ask(deadline=5.0)
        self.assertFalse(r.serve(8, self.c(queued=1), 1.0))
        self.assertTrue(r.serve(9, self.c(queued=1), 6.0))
        self.assertEqual(self.got, ["not at rest"])


class TestTheSize(unittest.TestCase):
    def test_the_size_basis_as_sent(self):
        b = {"3033": 20.0, "3034": 40.0, "3035": 50.0}
        self.assertEqual(size_of("probe_cal_round_boss", b), {"d": 20.0})
        self.assertEqual(size_of("probe_cal_square_pocket", b), {"x": 40.0, "y": 50.0})


if __name__ == "__main__":
    unittest.main()

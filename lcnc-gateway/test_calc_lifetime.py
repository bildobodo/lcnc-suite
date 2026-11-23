"""The lifetime of a calculation (calc_lifetime — P2b-3, plan v4, Codex
R439–R442): the generation's publication order against a write's begin, the
action's queue ownership, its observers past the handler's return and their
named outcomes. Pure: no gateway import."""
import threading
import unittest

from calc_lifetime import (ActionLedger, Generation, MODE_AUTO, MODE_MANUAL, MODE_MDI, OBSERVER_LIMIT_S,
                           combined_outcome, input_write_class)
from gateway_util import controller_done

DONE, EXEC, ERROR = 1, 2, 3
IDLE, READING = 1, 2
EXEC_DONE = 2
W = 0.02


class Clock:
    def __init__(self, t=100.0):
        self.t = t

    def __call__(self):
        return self.t


def st(**over):
    f = {"echo": 7, "state": DONE, "interp_state": IDLE, "queued": 0, "exec_state": EXEC_DONE, "task_mode": MODE_MDI}
    f.update(over)
    return f


def poll(ledger, clock, fields, seq=1):
    """One status poll begun now on Link `seq`: decided, then applied."""
    ledger.apply(ledger.decide(fields, clock.t, seq, W, controller_done))


class TestGeneration(unittest.TestCase):
    def test_a_publication_after_a_begin_is_discarded(self):
        """Plan guard 1: the worker ends after `began` but before the write
        returned → discarded."""
        g = Generation()
        snap = g.snapshot()
        published = []
        began = threading.Event()

        def write_thread():
            g.began("mdi")        # right before the effect, in the write's thread
            began.set()
        t = threading.Thread(target=write_thread)
        t.start()
        began.wait(5)
        ok, now, why = g.publish_if(snap, lambda: published.append(1))
        t.join()
        self.assertEqual((ok, published, why), (False, [], "mdi"))
        self.assertNotEqual(now, snap)

    def test_a_publication_wholly_before_the_begin_stands(self):
        g = Generation()
        snap = g.snapshot()
        ok, _now, _ = g.publish_if(snap, lambda: None)
        self.assertTrue(ok)
        g.began("mdi")
        self.assertFalse(g.publish_if(snap, lambda: None)[0], "the next one from the same snapshot is not")

    def test_every_load_is_a_new_program_generation(self):
        """Plan guard 9: A→B→A with a late A₁ end → discarded."""
        g = Generation()
        a1 = g.snapshot()
        g.new_program("load B")
        g.new_program("load A")
        self.assertFalse(g.publish_if(a1, lambda: None)[0])

    def test_the_check_and_the_fields_are_one_step(self):
        """A begin racing the publication lands wholly before or wholly after
        its fields: never between the check and the assignment."""
        g = Generation()
        for _ in range(200):
            snap = g.snapshot()
            seen = []

            def apply():
                seen.append(g._inputs)   # the lock is held: no begin in between
            t = threading.Thread(target=lambda: g.began("mdi"))
            t.start()
            ok, now, _ = g.publish_if(snap, apply)
            t.join()
            if ok:
                self.assertEqual(seen, [snap[1]])
            else:
                self.assertEqual(seen, [])


class TestInflightOutdated(unittest.TestCase):
    def test_a_running_parse_of_an_older_generation(self):
        from calc_lifetime import inflight_outdated
        self.assertTrue(inflight_outdated((1, 4), (1, 5)))
        self.assertTrue(inflight_outdated((1, 4), (2, 4)))
        self.assertFalse(inflight_outdated((1, 4), (1, 4)))
        self.assertFalse(inflight_outdated(None, (1, 4)), "no recorded generation: not judged")


class TestInputWriteClass(unittest.TestCase):
    def test_by_effect(self):
        """Plan guards 16/17 (Rest B): a switch to MDI or AUTO is an input
        write (task synchs), to MANUAL is not; mdi, the synch and the table
        reload are; a program start is the AUTO exception."""
        self.assertEqual(input_write_class("mode", (MODE_MDI,)), "mode")
        self.assertEqual(input_write_class("mode", (MODE_AUTO,)), "mode")
        self.assertIsNone(input_write_class("mode", (MODE_MANUAL,)))
        self.assertEqual(input_write_class("mdi", ("G10 L2 P1 X0",)), "mdi")
        for line in ("o<probe_z_minus_wco> call", "O<face> CALL [1]", "T1 M600", "T5 M6", "t2 m06 g43"):
            self.assertEqual(input_write_class("mdi", (line,)), "routine", line)
        self.assertEqual(input_write_class("mdi", ("G0 X1 (M60 recall)",)), "mdi", "no word boundary match")
        self.assertEqual(input_write_class("task_plan_synch", ()), "synch")
        self.assertEqual(input_write_class("load_tool_table", ()), "tool_table")
        for name in ("auto", "abort", "jog", "home", "spindle", "state", "feedrate", "unhome", "mist", "flood"):
            self.assertIsNone(input_write_class(name, (0,)), name)
        self.assertEqual(input_write_class("mode", (7,), {"MODE_MDI": 7, "MODE_AUTO": 8}), "mode")


class TestActionOwnership(unittest.TestCase):
    def setUp(self):
        self.c = Clock()
        self.L = ActionLedger(self.c)

    def call_written(self, serial=7, klass="routine"):
        a = self.L.hold("probe_run")
        o = self.L.begin(a, klass, "mdi")
        self.assertIsNotNone(self.L.busy())
        self.L.sent(o, serial, 1)
        self.L.release(a, "ok")      # the handler answered ok (wait=None)
        return a, o

    def test_a_queued_action_holds_and_a_refusal_ends_only_the_hold(self):
        """Plan guard 6: refused before the first write → the hold ends, no
        end is booked (the preview stays, no debounce from it)."""
        a = self.L.hold("touchoff")
        self.assertEqual(self.L.busy(), "held:touchoff")
        o = self.L.begin(a, "mdi", "mdi")
        self.L.refused(o)
        self.L.release(a, "refused")
        self.assertIsNone(self.L.busy())
        self.assertEqual(self.L.take_ended()[0].outcome, "refused_before_write")
        self.assertIsNone(self.L.last_end)

    def test_the_handler_return_is_no_end(self):
        """Plan guard 10 (Rest A): CALL written, handler back ok, no proof yet,
        an old idle status for longer than 2 s → still owned."""
        _a, _o = self.call_written()
        for dt in (1.0, 2.5, 30.0):
            self.c.t = 100.0 + dt
            poll(self.L, self.c, st(echo=6))          # an older echo: proves nothing
            self.assertEqual(self.L.busy(), "observed:probe_run")
        self.assertIsNone(self.L.quiet_s())

    def test_the_proof_ends_it_and_the_debounce_counts_from_there(self):
        """Plan guard 11: the completion proof later → the ownership ends
        then; quiet counts from the observed end."""
        a, _o = self.call_written()
        self.c.t = 140.0
        poll(self.L, self.c, st(echo=7))
        self.assertIsNone(self.L.busy())
        self.assertEqual((a.outcome, self.L.last_end), ("done", 140.0))
        self.c.t = 141.5
        self.assertEqual(self.L.quiet_s(), 1.5)

    def test_abort_after_the_return_is_named(self):
        """Plan guard 12: abort after the handler's return → aborted."""
        a, _o = self.call_written()
        self.assertEqual(self.L.end_all("aborted"), 1)
        self.assertEqual(a.outcome, "aborted")

    def test_a_lost_link_is_named(self):
        """Plan guard 12: the Link lost → link_lost (the relinked proof on the
        new Link), never done."""
        a, _o = self.call_written()
        self.c.t = 101.0
        poll(self.L, self.c, st(echo=3), seq=2)          # the new Link, quiet
        self.c.t = 101.03
        poll(self.L, self.c, st(echo=3), seq=2)
        self.assertEqual(a.outcome, "link_lost")

    def test_no_proof_within_the_limit_is_unknown(self):
        a, _o = self.call_written(klass="mdi")
        self.c.t = 100.0 + OBSERVER_LIMIT_S["mdi"]
        poll(self.L, self.c, st(echo=8, state=EXEC, interp_state=READING))
        self.assertEqual(a.outcome, "unknown")

    def test_another_queued_action_holds_while_the_first_observer_lives(self):
        """Plan guards 4/7/13: a second client's action already queued → no
        parse between the actions."""
        a, _o = self.call_written()
        b = self.L.hold("probe_run", "client-b")
        self.c.t = 110.0
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(a.outcome, "done")
        self.assertEqual(self.L.busy(), "held:probe_run")
        self.L.release(b, "refused")
        self.assertIsNone(self.L.busy())

    def test_a_handler_error_after_a_write_keeps_the_observer(self):
        """Plan guard 14 (Rest A): the handler throws after its write → the
        observer and the booking stay; the action ends partial at its proof."""
        a = self.L.hold("probe_run")
        o = self.L.begin(a, "routine", "mdi")
        self.L.sent(o, 7, 1)
        self.L.release(a, "error")
        self.assertEqual(self.L.busy(), "observed:probe_run")
        self.c.t = 103.0
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(a.outcome, "partial")

    def test_a_cancel_after_the_first_chunk_is_partial(self):
        """Plan guard 3: cancelled after the first parameter chunk → partial."""
        a = self.L.hold("probe_run")
        o1 = self.L.begin(a, "mdi", "mdi")
        self.L.sent(o1, 7, 1)
        self.L.release(a, "cancelled")
        self.c.t = 101.0
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(a.outcome, "partial")

    def test_a_handler_that_stops_short_after_a_write_is_partial(self):
        """Chunk 1 taken, the next refused — the handler returns its refusal
        normally: partial, whatever the taken chunk's proof says."""
        a = self.L.hold("probe_run")
        o = self.L.begin(a, "mdi", "mdi")
        self.L.sent(o, 7, 1)
        self.L.stopped_short(a)
        self.L.release(a, "ok")
        self.c.t = 101.0
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(a.outcome, "partial")

    def test_the_last_observer_ends_the_action(self):
        """Chunks → mode switch → CALL: a short idle between two writes ends
        nothing; the action ends with its LAST observer."""
        a = self.L.hold("probe_run")
        chunk = self.L.begin(a, "mdi", "mdi")
        self.L.sent(chunk, 7, 1)
        self.c.t = 100.5
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(self.L.busy(), "held:probe_run", "the handler still runs")
        call = self.L.begin(a, "routine", "mdi")
        self.L.sent(call, 8, 1)
        self.L.release(a, "ok")
        self.c.t = 101.0
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(self.L.busy(), "observed:probe_run")
        self.c.t = 160.0
        poll(self.L, self.c, st(echo=8))
        self.assertEqual(a.outcome, "done")

    def test_a_write_that_raised_is_unknown_never_unwritten(self):
        a = self.L.hold("mdi")
        o = self.L.begin(a, "mdi", "mdi")
        self.L.failed(o)
        self.L.release(a, "error")
        self.assertEqual(self.L.busy(), "observed:mdi")
        self.c.t = 100.0 + OBSERVER_LIMIT_S["mdi"]
        poll(self.L, self.c, st())
        self.assertEqual(a.outcome, "unknown")

    def test_pending_before_the_write_proves_nothing(self):
        """Plan guard 25: a pending observer has no serial — the buffer's
        serial before the write ends nothing; a poll begun before the write
        does not count."""
        a = self.L.hold("mdi")
        o = self.L.begin(a, "mdi", "mdi")
        poll(self.L, self.c, st(echo=6))
        self.assertIsNone(o.outcome)
        self.c.t = 100.2
        self.L.sent(o, 7, 1)
        self.L.release(a, "ok")
        self.L.apply(self.L.decide(st(echo=7), 100.1, 1, W, controller_done))   # begun before the write
        self.assertIsNone(o.outcome)
        self.c.t = 100.3
        poll(self.L, self.c, st(echo=7))
        self.assertEqual(o.outcome, "done")

    def test_a_mode_switch_needs_its_target(self):
        """The switch's observer: echo ≥ serial AND the task in the target
        mode, else unknown."""
        o = self.L.begin(None, "mode", "mode", mode_target=MODE_MDI)
        self.L.sent(o, 7, 1)
        self.c.t = 100.1
        poll(self.L, self.c, st(echo=7, task_mode=MODE_MDI))
        self.assertEqual(o.outcome, "done")
        o2 = self.L.begin(None, "mode", "mode", mode_target=MODE_AUTO)
        self.L.sent(o2, 8, 1)
        self.c.t = 100.2
        poll(self.L, self.c, st(echo=8, task_mode=MODE_MANUAL))
        self.assertEqual(o2.outcome, "unknown")
        # the switch before a program: handled while the program runs — no idle needed
        o3 = self.L.begin(None, "mode", "mode", mode_target=MODE_AUTO)
        self.L.sent(o3, 9, 1)
        self.c.t = 100.3
        poll(self.L, self.c, st(echo=8, state=EXEC, interp_state=READING, task_mode=MODE_AUTO))
        self.assertIsNone(o3.outcome, "not handled yet")
        self.c.t = 100.4
        poll(self.L, self.c, st(echo=10, state=EXEC, interp_state=READING, task_mode=MODE_AUTO))
        self.assertEqual(o3.outcome, "done")

    def test_the_codex_r441_table_ends_no_observer(self):
        """Plan guards 18–24 through the observer (serial 7, two polls apart
        each): a later echo still reading, a later error with an MDI queued,
        the own error with an MDI queued, before execution is done; unread
        fields."""
        for fields in (st(echo=8, state=EXEC, interp_state=READING), st(echo=8, state=ERROR, queued=1),
                       st(echo=7, state=ERROR, queued=1), st(echo=7, state=ERROR, exec_state=3),
                       st(echo=None), st(state=None), st(interp_state=None)):
            L, c = ActionLedger(Clock()), None
            c = L._clock
            o = L.begin(None, "mdi", "mdi")
            L.sent(o, 7, 1)
            c.t = 101.0
            poll(L, c, fields)
            c.t = 101.03
            poll(L, c, fields)
            self.assertIsNone(o.outcome, fields)

    def test_the_own_error_after_two_polls(self):
        o = self.L.begin(None, "mdi", "mdi")
        self.L.sent(o, 7, 1)
        self.c.t = 101.0
        poll(self.L, self.c, st(state=ERROR))
        self.assertIsNone(o.outcome, "one poll is no proof")
        self.c.t = 101.03
        poll(self.L, self.c, st(state=ERROR))
        self.assertEqual(o.outcome, "error")


class TestFileWriters(unittest.TestCase):
    def test_a_file_write_counts_as_written(self):
        """The tool table replaced inside a held action: the action wrote —
        its end starts the debounce (refused_before_write would not)."""
        c = Clock()
        L = ActionLedger(c)
        a = L.hold("save_tool")
        L.wrote_file(a, "tool_table")
        self.assertEqual(L.busy(), "held:save_tool", "the reload still follows")
        c.t = 105.0
        L.release(a, "ok")
        self.assertEqual((a.outcome, L.last_end), ("done", 105.0))

    def test_a_file_write_outside_an_action_ends_now(self):
        c = Clock(50.0)
        L = ActionLedger(c)
        L.wrote_file(None, "var_file")
        self.assertEqual((L.busy(), L.last_end), (None, 50.0))


class TestCombinedOutcome(unittest.TestCase):
    def test_order(self):
        L = ActionLedger(Clock())
        mk = []
        for out in ("done", "error", "unknown"):
            o = L.begin(None, "mdi", "mdi")
            L.sent(o, 1, 1)
            o.outcome = out
            mk.append(o)
        self.assertEqual(combined_outcome("ok", mk), "unknown")
        self.assertEqual(combined_outcome("ok", mk[:2]), "error")
        self.assertEqual(combined_outcome("cancelled", mk[:1]), "partial")
        self.assertEqual(combined_outcome("ok", []), "refused_before_write")


if __name__ == "__main__":
    unittest.main()

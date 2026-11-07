"""F-SIMTRIP.S2, the gateway's part (Codex R321–R322 FI321-01): Sim-Trip
pulses probe-in in ONE sequence in ONE thread — the reset follows every
attempted set (also a timeout after the effect), at most two tries, the
outcome named apart (the failure; "reset delivered" or "probe-in may still
be TRUE"); a cancel, a second one too, waits for the thread's end, so no
late "1" follows the final "0", and the outcome goes to the trace. halcmd is
replaced (a pin in a dict); the real HAL pulse is the native part (S2b)."""
import asyncio
import subprocess
import threading
import unittest
from unittest.mock import patch

import test_command_dispatch as td   # the fake binding first, then gateway
import gateway  # noqa: E402


class Halcmd:
    """halcmd on a dict: `sets probe-in v` writes the pin; scripted failures
    and barriers per call (by its position among the `sets` calls)."""

    def __init__(self, fail=None, hold=None):
        self.pin, self.writes, self.calls = 0, [], []
        self.fail = fail or {}            # sets-call index → ("after" | "before", exception)
        self.hold = hold or {}            # sets-call index → (entered Event, release Event)
        self.n = 0

    def __call__(self, argv, **kw):
        self.calls.append(argv[1:])
        if argv[1] == "unlinkp":
            return subprocess.CompletedProcess(argv, 1, "", "Pin 'qtpyvcp.probe-in.out' does not exist")
        i, self.n = self.n, self.n + 1
        if i in self.hold:
            entered, release = self.hold[i]
            entered.set()
            release.wait(5)
        when, exc = self.fail.get(i, (None, None))
        if when == "before":
            raise exc
        self.pin = int(argv[3])
        self.writes.append(self.pin)
        if when == "after":
            raise exc
        return subprocess.CompletedProcess(argv, 0, "", "")


TIMEOUT = subprocess.TimeoutExpired(["halcmd"], 2)
FAILED = subprocess.CalledProcessError(1, ["halcmd"], stderr="HAL: ERROR")


class TestTheSequence(unittest.TestCase):

    def run_seq(self, h):
        out = gateway._sim_trip_sequence(run=h)
        return out, gateway._sim_trip_reply(out)

    def test_a_pulse_sets_then_resets(self):
        h = Halcmd()
        out, reply = self.run_seq(h)
        self.assertEqual([c[0] for c in h.calls], ["unlinkp", "sets", "sets"])
        self.assertEqual((h.writes, h.pin, reply), ([1, 0], 0, {"ok": True}))

    def test_a_timeout_after_the_effect_is_still_reset(self):
        h = Halcmd(fail={0: ("after", TIMEOUT)})       # the pin went to 1, then the call timed out
        out, reply = self.run_seq(h)
        self.assertEqual((h.writes, h.pin), ([1, 0], 0))
        self.assertFalse(reply["ok"])
        self.assertIn("set: TimeoutExpired", reply["error"])
        self.assertIn("reset delivered", reply["error"])

    def test_a_failed_set_is_reset_anyway(self):
        h = Halcmd(fail={0: ("before", FAILED)})
        out, reply = self.run_seq(h)
        self.assertEqual((h.writes, h.pin), ([0], 0))
        self.assertIn("reset delivered", reply["error"])

    def test_a_first_reset_that_fails_and_a_second_that_takes(self):
        h = Halcmd(fail={1: ("before", FAILED)})       # R322's note: no clean pulse, no "may still be TRUE"
        out, reply = self.run_seq(h)
        self.assertEqual((h.writes, h.pin, out["resets"][-1]), ([1, 0], 0, "ok"))
        self.assertFalse(reply["ok"])
        self.assertIn("reset: CalledProcessError", reply["error"])
        self.assertIn("reset delivered", reply["error"])
        self.assertNotIn("may still be TRUE", reply["error"])

    def test_two_failed_resets_say_the_pin_may_still_be_true(self):
        h = Halcmd(fail={1: ("before", FAILED), 2: ("before", TIMEOUT)})
        out, reply = self.run_seq(h)
        self.assertEqual((h.pin, len(out["resets"])), (1, gateway._SIM_TRIP_RESETS))
        self.assertIn("probe-in may still be TRUE", reply["error"])
        self.assertEqual(h.n, 3, "bounded: one set, two resets")


class TestTheHandlerOwnsItToTheEnd(unittest.TestCase):
    setUp_handler = td.TestHandlerExecution.setUp

    def setUp(self):
        self.setUp_handler()
        gateway._shared_status = td._payload()      # a status read: the gate has its inputs
        self.events = []
        p = patch.object(gateway._trace, "emit", lambda ev, **kw: self.events.append((ev, kw)))
        p.start()
        self.addCleanup(p.stop)

    def cancel_twice_while_held(self, h, hold_at):
        entered, release = threading.Event(), threading.Event()
        h.hold[hold_at] = (entered, release)

        async def scenario():
            with patch.object(gateway.subprocess, "run", h):
                task = asyncio.ensure_future(gateway.handle_command({"cmd": "simulate_probe_trip"}, True))
                await asyncio.to_thread(entered.wait, 5)
                task.cancel()
                await asyncio.sleep(0.05)
                task.cancel()
                await asyncio.sleep(0.05)
                held = gateway._get_cmd_lock().locked() and not task.done()
                release.set()
                try:
                    await task
                except asyncio.CancelledError:
                    return held, "cancelled"
                return held, "returned"
        gateway._cmd_lock = None
        return asyncio.run(scenario())

    def test_a_cancel_while_the_set_runs_waits_for_the_reset(self):
        h = Halcmd()
        held, ended = self.cancel_twice_while_held(h, 0)
        self.assertTrue(held, "the lock stays with the sequence through two cancels")
        self.assertEqual((ended, h.writes, h.pin), ("cancelled", [1, 0], 0), "no late 1 after the final 0")
        outcome = [kw for ev, kw in self.events if ev == "sim_trip.outcome"]
        self.assertEqual(outcome[0]["cancelled"], True)
        self.assertEqual(outcome[0]["resets"], ["ok"])

    def test_a_cancel_while_the_reset_runs_lets_it_end(self):
        h = Halcmd()
        held, ended = self.cancel_twice_while_held(h, 1)
        self.assertTrue(held)
        self.assertEqual((ended, h.writes, h.pin), ("cancelled", [1, 0], 0))
        self.assertTrue(any(ev == "sim_trip.outcome" for ev, _ in self.events))

    def test_the_handler_answers_the_outcome(self):
        with patch.object(gateway.subprocess, "run", Halcmd(fail={0: ("after", TIMEOUT)})):
            r = td._run(gateway.handle_command({"cmd": "simulate_probe_trip"}, True))
        self.assertFalse(r["ok"])
        self.assertIn("reset delivered", r["error"])


if __name__ == "__main__":
    unittest.main()

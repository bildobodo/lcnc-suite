"""P2b-F1-3 (Codex R449 MT449-03, R451): the wait for the active program's
own preview, named on the wire.

- EVERY reason that holds the parse is named — `running` apart from `moving`,
  every open action (`held:` / `observed:` / `overdue:`), the quiet window,
  the rotary settle, an unload — never a deadline.
- The record lives while the active program has no publication of its own
  and no parse of it is scheduled or running: every frame, replaced by a new
  load, ended by its job's schedule (then `preview_refresh` names that job,
  from the schedule on) or by an unload; a job ended unpublished is named.
- The record decides nothing (`_restart_wait` keeps the decision)."""
import asyncio
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()
import gateway  # noqa: E402
from bulk_pipeline import BulkPipeline  # noqa: E402
from calc_lifetime import OBSERVER_LIMIT_S, ActionLedger, Generation  # noqa: E402
from gateway_util import preview_hold_reasons  # noqa: E402
from ws_fanout import build_status_envelope  # noqa: E402


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _reasons(**kw):
    base = dict(unloading=False, skip_quiet=False, busy=[], quiet=True, interp_idle=True, current_vel=0.0,
                rotary_settled=True)
    base.update(kw)
    return preview_hold_reasons(**base)


class EveryReasonIsNamed(unittest.TestCase):

    def test_each_reason_alone(self):
        self.assertEqual(_reasons(), [])
        self.assertEqual(_reasons(interp_idle=False), ["running"])
        self.assertEqual(_reasons(current_vel=3.0), ["moving"], "idle, not still: moving, not running")
        self.assertEqual(_reasons(quiet=False), ["debounce"])
        self.assertEqual(_reasons(busy=["observed:mdi"], quiet=False), ["observed:mdi"])
        self.assertEqual(_reasons(rotary_settled=False), ["settle:rotary"])
        self.assertEqual(_reasons(unloading=True), ["unloading"])

    def test_combined_and_the_own_load(self):
        self.assertEqual(_reasons(interp_idle=False, busy=["observed:program_file", "overdue:program_file"],
                                  quiet=False),
                         ["observed:program_file", "overdue:program_file", "running"])
        # an own load's first parse skips the quiet window, never the run or a move
        self.assertEqual(_reasons(skip_quiet=True, busy=["held:probe_run"], quiet=False, interp_idle=False),
                         ["running"])
        self.assertEqual(_reasons(skip_quiet=True, current_vel=1.0), ["moving"])


class EveryOpenActionIsNamed(unittest.TestCase):

    def test_an_open_action_after_its_handler_and_an_overdue_writer(self):
        clock = Clock()
        led = ActionLedger(clock)
        a = led.hold("probe_run")
        self.assertEqual(led.busy_all(), ["held:probe_run"])
        led.begin(a, "routine", "mdi", None)
        led.release(a, "ok")
        self.assertEqual(led.busy_all(), ["observed:probe_run"], "the handler's return is no end")
        o = led.begin_file(None, "program_file")
        clock.t += OBSERVER_LIMIT_S["file"] + 1
        self.assertIn("observed:program_file", led.busy_all())
        self.assertIn("overdue:program_file", led.busy_all(), "past its limit it still holds — named")
        led.end_all("aborted")   # a controller abort (a run's end) never ends a file writer
        self.assertIn("overdue:program_file", led.busy_all())
        led.end_file(o, "done")
        self.assertNotIn("overdue:program_file", led.busy_all())


def _st(pid="E.2", interp=None, vel=0.0, active="/c.ngc"):
    return types.SimpleNamespace(program_id=pid, active_file=active, current_vel=vel,
                                 interp_state=linuxcnc.INTERP_IDLE if interp is None else interp,
                                 rotary_abc=None)


class TheRecordLivesWithItsProgram(unittest.TestCase):

    def setUp(self):
        self.clock = Clock()
        self.ledger = ActionLedger(self.clock)
        self.b = BulkPipeline(get_stat=lambda: None, get_machine_units=lambda: "mm",
                              build_wcs_rotation_patches=lambda: {})
        self.b.epoch = "E"
        self.b.published_program = "E.1"          # program A2's publication
        for target, name, value in ((gateway, "_actions", self.ledger), (gateway, "_bulk", self.b),
                                    (gateway, "_preview_wait", None),
                                    (gateway, "_own_load_unparsed", lambda: False)):
            p = patch.object(target, name, value)
            p.start()
            self.addCleanup(p.stop)

    def tick(self, st, changed=True):
        gateway._preview_wait_tick(st, changed, self.clock.t)
        return gateway._preview_wait_status()

    def test_a_run_started_before_its_preview_is_named_running_every_tick(self):
        w = self.tick(_st(interp=linuxcnc.INTERP_READING, vel=1.0))
        self.assertEqual((w["program_id"], w["file"], w["reasons"]), ("E.2", "c.ngc", ["running"]))
        since = w["since_ms"]
        self.clock.t += 60          # long past the debounce: still the run, no promise
        w = self.tick(_st(interp=linuxcnc.INTERP_READING, vel=1.0))
        self.assertEqual((w["reasons"], w["since_ms"]), (["running"], since))
        env = build_status_envelope(status_data={}, errors=[], clients_list=[], armed=True,
                                    preview_wait=gateway._preview_wait_status())
        self.assertEqual(env["preview_wait"]["reasons"], ["running"], "on the wire")

    def test_an_open_writer_at_idle_is_named(self):
        self.ledger.begin_file(None, "program_file")
        self.clock.t += OBSERVER_LIMIT_S["file"] + 1
        w = self.tick(_st())
        self.assertEqual(w["reasons"], ["observed:program_file", "overdue:program_file"])

    def test_a_new_load_replaces_it_its_schedule_and_its_publication_end_it(self):
        w = self.tick(_st(pid="E.2", interp=linuxcnc.INTERP_READING))
        w3 = self.tick(_st(pid="E.3"))
        self.assertEqual(w3["program_id"], "E.3")
        self.assertGreaterEqual(w3["since_ms"], w["since_ms"])
        # its job scheduled: preview_refresh names it from now on
        self.b.refresh_running = True
        self.b.scheduled = {"job": 9, "file": "/c.ngc", "reason": "file", "program_id": "E.3"}
        self.assertIsNone(self.tick(_st(pid="E.3")))
        r = self.b.preview_refresh_status()
        self.assertEqual((r["phase"], r["job"], r["program_id"], r["first"]), ("starting", 9, "E.3", True))
        # a scheduled parse of ANOTHER identity does not end it
        self.b.scheduled["program_id"] = "E.2"
        self.assertIsNotNone(self.tick(_st(pid="E.3")))
        # its own publication ends it; no program ends it
        self.b.refresh_running, self.b.scheduled = False, None
        self.b.published_program = "E.3"
        self.assertIsNone(self.tick(_st(pid="E.3")))
        self.assertIsNone(self.tick(_st(pid=None)))

    def test_a_job_ended_unpublished_is_named_for_its_program_only(self):
        self.b.last_unpublished_end = {"program_id": "E.2", "job": 4, "why": "refused:running"}
        w = self.tick(_st(pid="E.2", interp=linuxcnc.INTERP_READING))
        self.assertEqual(w["last_end"], {"job": 4, "why": "refused:running"})
        self.assertNotIn("last_end", self.tick(_st(pid="E.3")))


class TheRefreshIsNamedFromItsSchedule(unittest.TestCase):

    def test_starting_then_running_and_a_refused_begin_named(self):
        with tempfile.TemporaryDirectory() as tmp:
            ini = os.path.join(tmp, "m.ini")
            Path(ini).write_text("[EMC]\n")
            ngc = os.path.join(tmp, "p.ngc")
            Path(ngc).write_text("G0 X1\nM2\n")
            b = BulkPipeline(get_stat=lambda: types.SimpleNamespace(ini_filename=ini),
                             get_machine_units=lambda: "mm", build_wcs_rotation_patches=lambda: {})
            b.generation, b.epoch = Generation(), "E"
            b.generation.new_program("load")
            coros = []
            self.assertTrue(b.schedule_refresh(ngc, "file", lambda c: coros.append(c)))
            r = b.preview_refresh_status()
            self.assertIsNotNone(r, "named from the schedule on — no gap before the job's first step")
            self.assertEqual((r["phase"], r["program_id"], r["first"], r["job"]), ("starting", "E.1", True, b.job_seq))
            b.admit_begin = lambda: "running"
            asyncio.run(coros[0])
            self.assertIsNone(b.preview_refresh_status())
            self.assertEqual(b.last_unpublished_end, {"program_id": "E.1", "job": b.job_seq, "why": "refused:running"})
            self.assertIsNone(b.scheduled)


class TheRecordDecidesNothing(unittest.TestCase):

    def test_the_restart_decision_is_not_the_record(self):
        src = open(gateway.__file__).read()
        self.assertEqual(src.count("_preview_wait_tick(st, file_changed, _now)"), 1)
        body = src[src.index("def _preview_wait_tick("):src.index("def _preview_wait_status(")]
        for forbidden in ("schedule_refresh", "reparse_pending =", "cancel_inflight"):
            self.assertNotIn(forbidden, body)


if __name__ == "__main__":
    unittest.main()

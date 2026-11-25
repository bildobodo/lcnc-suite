"""R473 extra origin checks; run with pytest -p conftest, fake controller only."""
import json
from unittest.mock import patch

import test_cal_gateway as fixture

gateway = fixture.gateway


class TestR473Origin(fixture._TwoInis):
    def test_a_late_old_poll_never_borrows_the_new_machines_revision(self):
        self.file({"probeCalibration": self.REC}, {
            "probeCalibration": {**self.REC, "value": 0.7, "rev": 19, "unit": "in"}})
        old = gateway.current_link()
        fields = gateway._cal_fields(old)
        self.link_to(self.other)
        # The cal state must receive the identity, revision AND failed drain
        # of the completed old poll, despite another machine being current.
        with patch.object(gateway._cal, "cycle", return_value=[]) as consume:
            gateway._cal_status_cycle(gateway.time.monotonic(), old, fields, False, True, [], None)
        cycle, rev = consume.call_args.args
        self.assertEqual((cycle.link_seq, rev, cycle.drained),
                         (old.seq, 4, "the connection changed"))
        self.assertEqual(gateway._cal_base_rev(gateway.current_link()), 19)
        print("R473_OLD_POLL", json.dumps({"old_revision": rev, "new_revision": 19,
                                          "drained": cycle.drained}))

    def test_machine_write_rechecks_origin_after_the_record_read(self):
        self.file({"probeCalibration": self.REC}, {
            "probeCalibration": {**self.REC, "value": 0.7}})
        origin = gateway._cal_origin()
        before = self.path.read_bytes()
        original = self.store.calibration

        def read_then_rebind(ini=None):
            record = original(ini)
            self.link_to(self.other)
            return record

        with patch.object(self.store, "calibration", read_then_rebind):
            result = self.run_async(gateway._cal_write_machine(self.REC, self.key, "cal_reset", origin))
        self.assertEqual(result["outcome"], "saved_not_written")
        self.assertIn("Connection to LinuxCNC changed", result["why"])
        self.assertEqual(self.cmd.calls, [], "no mode or parameter reaches either controller")
        self.assertEqual(self.path.read_bytes(), before)
        print("R473_AFTER_RECORD_READ", json.dumps(result))

    def test_machine_write_rechecks_writer_after_the_record_read(self):
        self.file({"probeCalibration": self.REC})
        origin = gateway._cal_origin()
        original = self.store.calibration

        def read_then_disarm(ini=None):
            record = original(ini)
            gateway._clients[911].armed = False
            return record

        with patch.object(self.store, "calibration", read_then_disarm):
            result = self.run_async(gateway._cal_write_machine(self.REC, self.key, "cal_reset", origin))
        self.assertEqual(result["outcome"], "saved_not_written")
        self.assertEqual(result["why"], gateway.NOT_ARMED)
        self.assertEqual(self.cmd.calls, [])
        print("R473_AFTER_RECORD_READ_DISARM", json.dumps(result))

    def test_reset_without_interference_stores_and_writes_its_own_machine(self):
        self.file({"probeCalibration": self.REC}, {
            "probeCalibration": {**self.REC, "value": 0.7, "unit": "in", "rev": 19}})
        result = self.send({"cmd": "cal_reset"})
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["machine"]["outcome"], "taken")
        self.assertEqual(self.stored()["probeCalibration"]["value"], 0)
        self.assertEqual(self.stored(self.other)["probeCalibration"]["value"], 0.7)
        self.assertTrue(any("#3032=0" in line for line in self.cmd.mdis()), self.cmd.mdis())
        print("R473_CONTROL", json.dumps(result))

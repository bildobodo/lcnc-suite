"""R491 independent probes, on the real dispatcher and a fake controller only.

Run from this isolated gateway directory with pytest -p conftest.
The final admission's own poll publishes a changed controller reading;
no gateway callback, writer, file, owner, or admission is skipped.
"""
import json
import threading
from unittest.mock import patch

from test_tool_load_gateway import _Load, gateway
from tool_io_fixture import entry


class TestR491LastControllerRead(_Load):
    def attempt(self, phase, change):
        self.hand_edit("T2 P2 Z20 D2 ; two\nT8 P8 Z80 D8 ; eight\n")
        msg = self.message()
        phase_now = threading.local()
        real_admit = gateway._write_admission_refusal
        real_poll = self.conn.stat.poll
        done = []
        at_change = []

        def admit(*args, **kwargs):
            phase_now.name = "last" if kwargs.get("load") is not None else "first"
            try:
                return real_admit(*args, **kwargs)
            finally:
                phase_now.name = None

        def poll():
            result = real_poll()
            if not done and getattr(phase_now, "name", None) == phase:
                change()
                done.append(True)
                at_change.append({"phase": phase, "spindle": self.conn.stat.tool_in_spindle,
                                  "table": [e.id for e in self.conn.stat.tool_table],
                                  "loads_so_far": self.io.loads})
            return result

        with patch.object(gateway, "_write_admission_refusal", admit), \
                patch.object(self.conn.stat, "poll", poll):
            reply = self.send(msg)
        assert done
        snapshot = {"phase": phase, "reply": reply, "loads": self.io.loads,
                    "confirmed_removed": msg["removed"], "at_change": at_change,
                    "spindle": self.conn.stat.tool_in_spindle,
                    "table": [e.id for e in self.conn.stat.tool_table]}
        print("R491", json.dumps(snapshot, ensure_ascii=False))
        return reply

    def test_missing_spindle_tool_at_last_poll_must_refuse(self):
        reply = self.attempt("last", lambda: setattr(self.conn.stat, "tool_in_spindle", 5))
        self.assertFalse(reply["ok"], "T5 is now in the spindle, but is absent from the load file")
        self.assertEqual(self.io.loads, 0)

    def test_missing_spindle_tool_at_first_poll_refuses(self):
        reply = self.attempt("first", lambda: setattr(self.conn.stat, "tool_in_spindle", 5))
        self.assertFalse(reply["ok"])
        self.assertEqual(self.io.loads, 0)

    def add_unapproved_tool(self):
        self.conn.stat.tool_table = (*self.conn.stat.tool_table, entry(9, Z=90, D=9))

    def test_extra_removal_at_last_poll_must_refuse(self):
        reply = self.attempt("last", self.add_unapproved_tool)
        self.assertFalse(reply["ok"], "T9 is removed too, but only T5 was approved")
        self.assertEqual(self.io.loads, 0)

    def test_extra_removal_at_first_poll_refuses(self):
        reply = self.attempt("first", self.add_unapproved_tool)
        self.assertFalse(reply["ok"])
        self.assertEqual(self.io.loads, 0)

    def test_unchanged_last_poll_loads_exactly_once(self):
        reply = self.attempt("last", lambda: None)
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["load"], "requested")
        self.assertEqual(self.io.loads, 1)

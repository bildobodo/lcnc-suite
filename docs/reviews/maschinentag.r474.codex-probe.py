"""R474: a new process identity is no ordering proof for an in-flight write.
Fake controller and temporary files only; pytest -p conftest required.
"""
import json
from unittest.mock import patch

from test_tool_commit_gateway import _Commit, gateway, parse_tool_table
from test_tool_proof_gateway import INI, FakeConnection, _Io, swap_connection
from tool_io_fixture import load_into


class TestRestartOrder(_Commit):
    def scenario(self, restart_before_commit):
        old_read = self.read()
        real_write = gateway.write_tool_table
        loaded = []
        new = FakeConnection()
        new.stat.ini_filename = INI
        new.stat.interp_state = gateway.linuxcnc.INTERP_IDLE
        new.stat.tool_in_spindle = 0
        new.cmd = _Io(new.stat, self.table)

        def restarted():
            # A fresh io reads this file exactly NOW. Capture the pocket too:
            # the real STAT table / rule R do not carry the pocket.
            loaded.append(self.table.read_text())
            load_into(new.stat, self.table)

        def write(path, tools):
            if restart_before_commit:
                restarted()
            data = real_write(path, tools)
            if not restart_before_commit:
                restarted()
            return data

        # The old gateway stays bound to OLD throughout its admitted write.
        # Its old NML channel fails; the reply arrives before that socket
        # closes. No dev-only rebind while a command runs is required.
        with patch.object(gateway, "write_tool_table", write), patch.object(
                self.io, "load_tool_table", side_effect=gateway.linuxcnc.error("old instance ended")) as reload:
            reply = self.send({"cmd": "save_tool", "tool_number": 1, "pocket": 8,
                               "expected": self.expect(1)})
        self.assertEqual(gateway._bound_instance, (111, 111))
        self.assertEqual(reload.call_count, 1)
        # What the NEXT gateway/connection reads; the old write already
        # answered. Switching this fixture's owner models that fresh read.
        gateway._bound_instance = (222, 222)
        swap_connection(new)
        new_read = self.read()
        committed_p = next(t["P"] for t in parse_tool_table(str(self.table)) if t["T"] == 1)
        self.assertEqual((reply["ok"], reply["reload"]), (True, "reload failed"), reply)
        self.assertEqual(new_read["proof"]["state"], "complete")
        self.assertEqual((old_read["table"]["instance"], new_read["table"]["instance"]),
                         ("111:111", "222:222"))
        self.assertEqual(old_read["table"]["path"], new_read["table"]["path"])
        self.assertEqual(committed_p, 8)
        self.assertEqual((self.io.loads, new.cmd.loads), (0, 0))
        from tool_table import parse_tool_table_bytes
        loaded_p = next(t["P"] for t in parse_tool_table_bytes(loaded[0].encode()) if t["T"] == 1)
        self.assertEqual(loaded_p, 1 if restart_before_commit else 8)
        print("R474_ORDER " + json.dumps({"restart_before_commit": restart_before_commit,
              "reply": reply, "old_table": old_read["table"], "new_table": new_read["table"],
              "read": new_read["proof"]["state"], "loaded_pocket": loaded_p,
              "file_pocket": committed_p, "completed_reloads": [self.io.loads, new.cmd.loads],
              "old_reload_attempts": reload.call_count}))

    def test_new_instance_loaded_old_file_before_commit(self):
        self.scenario(True)

    def test_control_new_instance_loaded_new_file_after_commit(self):
        self.scenario(False)

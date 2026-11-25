"""R474: a new process identity is no ordering proof for an in-flight write.
Fake controller and temporary files only; pytest -p conftest required.
"""
import json
from unittest.mock import patch

from test_tool_commit_gateway import _Commit, gateway, parse_tool_table


class TestRestartOrder(_Commit):
    def scenario(self, restart_before_commit):
        old_read = self.read()
        real_write = gateway.write_tool_table
        loaded = []

        def restarted():
            # A fresh io reads this file exactly NOW. Capture the pocket too:
            # the real STAT table / rule R do not carry the pocket.
            loaded.append(self.table.read_text())
            gateway._bound_instance = (222, 222)
            self.another()

        def write(path, tools):
            if restart_before_commit:
                restarted()
            data = real_write(path, tools)
            if not restart_before_commit:
                restarted()
            return data

        with patch.object(gateway, "write_tool_table", write):
            reply = self.send({"cmd": "save_tool", "tool_number": 1, "pocket": 8,
                               "expected": self.expect(1)})
        new_read = self.read()
        committed_p = next(t["P"] for t in parse_tool_table(str(self.table)) if t["T"] == 1)
        self.assertEqual((reply["ok"], reply["reload"]), (True, "reload not sent"), reply)
        self.assertEqual(new_read["proof"]["state"], "complete")
        self.assertEqual((old_read["table"]["instance"], new_read["table"]["instance"]),
                         ("111:111", "222:222"))
        self.assertEqual(old_read["table"]["path"], new_read["table"]["path"])
        self.assertEqual(committed_p, 8)
        self.assertEqual((self.io.loads, self.others[-1].loads), (0, 0))
        from tool_table import parse_tool_table_bytes
        loaded_p = next(t["P"] for t in parse_tool_table_bytes(loaded[0].encode()) if t["T"] == 1)
        self.assertEqual(loaded_p, 1 if restart_before_commit else 8)
        print("R474_ORDER " + json.dumps({"restart_before_commit": restart_before_commit,
              "reply": reply, "old_table": old_read["table"], "new_table": new_read["table"],
              "read": new_read["proof"]["state"], "loaded_pocket": loaded_p,
              "file_pocket": committed_p, "reloads": [self.io.loads, self.others[-1].loads]}))

    def test_new_instance_loaded_old_file_before_commit(self):
        self.scenario(True)

    def test_control_new_instance_loaded_new_file_after_commit(self):
        self.scenario(False)

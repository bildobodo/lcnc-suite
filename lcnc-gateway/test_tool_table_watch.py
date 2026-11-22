"""The tool table file watched (P4-2, machine day F15, Codex MT433-01):
LinuxCNC writes tool.tbl itself (a G10 L1 of an M600) and nothing told the
clients. Once a second, off the loop, the file's signature on its canonical
path and the bound instance; a change bumps the version the status loop
pings the clients with. An unreadable file claims no new state; the
gateway's own write is the new baseline, not a second change."""
import asyncio
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import fake_linuxcnc

linuxcnc = fake_linuxcnc.install()

import gateway  # noqa: E402


class TestTheWatch(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.table = Path(tmp.name) / "tool.tbl"
        self.table.write_text("T1 P1 Z50 D6 ;\n")
        saved = dict(gateway._tool_table_watch)
        self.addCleanup(lambda: gateway._tool_table_watch.update(saved))
        gateway._tool_table_watch.update(sig=None, failed=False)
        self.events = []
        real = gateway._trace.emit

        def rec(tag, *a, **k):
            self.events.append(tag)
            return real(tag, *a, **k)
        p = patch.object(gateway._trace, "emit", rec)
        p.start()
        self.addCleanup(p.stop)

    def step(self):
        v0 = gateway._tool_table_version
        changed = gateway._tool_table_watch_step(gateway._tool_table_file_sig(str(self.table)))
        return changed, gateway._tool_table_version - v0

    def rewrite(self, text):
        # LinuxCNC's own save: a new file in place (another size and time)
        tmp = self.table.with_suffix(".new")
        tmp.write_text(text)
        os.replace(tmp, self.table)

    def test_a_write_by_linuxcnc_bumps_once(self):
        self.assertEqual(self.step(), (False, 0), "the first reading is the baseline")
        self.assertEqual(self.step(), (False, 0), "nothing changed")
        self.rewrite("T1 P1 Z55.5 D6 ;\n")
        self.assertEqual(self.step(), (True, 1))
        self.assertIn("tools.table_file_changed", self.events)
        self.assertEqual(self.step(), (False, 0), "said once")

    def test_an_unreadable_file_claims_no_new_state(self):
        self.step()
        base = gateway._tool_table_watch["sig"]
        hidden = self.table.with_suffix(".hidden")
        os.replace(self.table, hidden)
        self.assertEqual(self.step(), (False, 0))
        self.assertEqual(self.step(), (False, 0))
        self.assertEqual(self.events.count("tools.table_file_unread"), 1, "said once")
        self.assertEqual(gateway._tool_table_watch["sig"], base, "the baseline stays")
        os.replace(hidden, self.table)
        self.assertEqual(self.step(), (False, 0), "the same file back is no change")

    def test_another_instance_is_another_table(self):
        self.step()
        with patch.object(gateway, "_bound_instance", (4242, 77)):
            self.assertEqual(self.step(), (True, 1))

    def test_the_gateways_own_write_is_the_new_baseline(self):
        self.step()
        self.rewrite("T1 P1 Z49 D6 ;\n")              # our persist wrote the file …
        with patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)), \
                patch.object(gateway, "_cmd_now", lambda: False):
            v0 = gateway._tool_table_version
            asyncio.run(gateway._reload_tool_table_and_bump())   # … and bumped once
        self.assertEqual(gateway._tool_table_version - v0, 1)
        self.assertEqual(self.step(), (False, 0), "the watch does not count it again")

    def test_the_loop_reads_the_file_off_the_event_loop(self):
        seen = {}

        def sig(path):
            seen["thread"] = threading.get_ident()
            return None

        async def main():
            seen["loop"] = threading.get_ident()
            task = asyncio.ensure_future(gateway._tool_table_watch_loop())
            t0 = time.monotonic()
            while "thread" not in seen and time.monotonic() - t0 < 3:
                await asyncio.sleep(0.02)
            task.cancel()
        with patch.object(gateway, "TOOL_TABLE_WATCH_S", 0.01), \
                patch.object(gateway, "get_tool_tbl_path", lambda: str(self.table)), \
                patch.object(gateway, "_tool_table_file_sig", sig):
            asyncio.run(main())
        self.assertIn("thread", seen, "the loop never read the file")
        self.assertNotEqual(seen["thread"], seen["loop"])


if __name__ == "__main__":
    unittest.main()

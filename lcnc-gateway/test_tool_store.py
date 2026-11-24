"""Unit tests for tool_store.ToolLibraryStore (issue #33). Pure — a temp file +
an injected INI-key callable; no linuxcnc/gateway import."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from tool_store import ToolLibraryStore


class TestToolLibraryStore(unittest.TestCase):
    def setUp(self):
        fd, p = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(p)  # start with no file
        self.path = Path(p)
        self.store = ToolLibraryStore(self.path, lambda: "/ini-A")

    def tearDown(self):
        if self.path.exists():
            self.path.unlink()

    def test_save_then_load(self):
        self.store.save({"1": {"type": "endmill"}})
        self.assertEqual(self.store.load(), {"1": {"type": "endmill"}})

    def test_writes_preserve_other_inis(self):
        self.store.save({"1": {"type": "drill"}})                       # /ini-A
        ToolLibraryStore(self.path, lambda: "/ini-B").save({"2": {"type": "tap"}})
        self.assertEqual(ToolLibraryStore(self.path, lambda: "/ini-A").load(), {"1": {"type": "drill"}})
        self.assertEqual(ToolLibraryStore(self.path, lambda: "/ini-B").load(), {"2": {"type": "tap"}})

    def test_migration_wraps_old_flat_format(self):
        # Old format: top-level keys are tool numbers (no leading "/").
        self.path.write_text(json.dumps({"1": {"type": "endmill"}, "2": {"type": "drill"}}))
        self.assertEqual(self.store.load(),
                         {"1": {"type": "endmill"}, "2": {"type": "drill"}})
        self.assertIn("/ini-A", json.loads(self.path.read_text()))  # rewritten wrapped

    def test_save_refuses_non_dict_top_level(self):
        self.path.write_text("[1, 2, 3]")
        with self.assertRaises(RuntimeError):
            self.store.save({"1": {}})

    def test_mtime_cache_populated(self):
        self.store.save({"1": {"type": "x"}})
        first = self.store.load()
        self.assertEqual(self.store.load(), first)
        self.assertIsNotNone(self.store._cache)

    def test_a_write_in_the_same_mtime_is_no_cache_hit(self):
        # P6 tool files read: an mtime alone repeats within the filesystem's
        # timestamp tick — the cache is keyed by (inode, mtime_ns, size)
        self.store.save({"1": {"type": "x"}})
        self.assertEqual(self.store.load(), {"1": {"type": "x"}})
        st = self.path.stat()
        with open(self.path, "w") as f:      # in place: the same inode
            f.write(json.dumps({"/ini-A": {"1": {"type": "endmill"}}}))
        os.utime(self.path, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assertEqual(self.path.stat().st_mtime_ns, st.st_mtime_ns)
        self.assertEqual(self.store.load(), {"1": {"type": "endmill"}})

    def test_a_strict_load_raises_never_the_cache(self):
        from tool_store import ToolLibraryUnreadable
        self.store.save({"1": {"type": "x"}})
        self.assertEqual(self.store.load(True), {"1": {"type": "x"}})
        st = self.path.stat()
        self.path.write_text("{ bad json")
        os.utime(self.path, ns=(st.st_atime_ns, st.st_mtime_ns))
        with self.assertRaises(ToolLibraryUnreadable):
            self.store.load(True)
        self.assertEqual(self.store.load(), {"1": {"type": "x"}}, "the lenient read keeps its old behaviour")
        self.path.write_text(json.dumps({"/ini-A": [1, 2]}))
        with self.assertRaises(ToolLibraryUnreadable):
            self.store.load(True)

    def test_corrupt_file_degrades_and_reports(self):
        self.path.write_text("{ bad json")
        events = []
        store = ToolLibraryStore(self.path, lambda: "/ini-A",
                                 on_error=lambda ev, lvl, e: events.append((ev, lvl)))
        self.assertEqual(store.load(), {})            # degrades to empty
        self.assertEqual(events[0], ("tool_lib.corrupt", "error"))

    def test_first_run_geometry_does_not_override_saved_or_empty_libraries(self):
        with tempfile.TemporaryDirectory() as directory:
            seed = Path(directory) / 'tool.seed.json'
            seed.write_text(json.dumps({'1001': {'type': 'endmill'}}))
            ini = ['/ini-A']
            store = ToolLibraryStore(self.path, lambda: ini[0], seed_path=lambda: seed)
            self.assertEqual(store.load(), {'1001': {'type': 'endmill'}})
            self.assertFalse(self.path.exists())  # Read-only boot path.
            store.save({'1001': {'type': 'drill'}})
            self.assertEqual(store.load(), {'1001': {'type': 'drill'}})
            store.save({})
            self.assertEqual(store.load(), {})
            ini[0] = '/ini-B'
            self.assertEqual(store.load(), {'1001': {'type': 'endmill'}})
            seed.unlink()
            self.assertEqual(store.load(), {})


if __name__ == "__main__":
    unittest.main()

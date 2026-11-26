"""Unit tests for tool_store.ToolLibraryStore (issue #33). Pure — a temp file +
an injected INI-key callable; no linuxcnc/gateway import."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tool_store
from tool_proof import library_rev
from tool_store import ToolLibraryStore, ToolLibraryUnreadable


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

    def strict_cold_and_warm(self, text):
        """The strict answer (the data, or its refusal) read first, and after
        the status path's tolerant load() of the same file (Codex R468
        MT-I36) — the file rewritten in between, so each starts from disk."""
        from tool_store import ToolLibraryUnreadable

        def strict(store):
            try:
                return store.load(True)
            except ToolLibraryUnreadable as e:
                return f"refused: {e}"
        self.path.write_text(text)
        cold = strict(ToolLibraryStore(self.path, lambda: "/ini-A"))
        self.path.write_text(text)
        warm_store = ToolLibraryStore(self.path, lambda: "/ini-A")
        try:
            warm_store.load()                       # the status reader caches what it read
        except (TypeError, AttributeError):
            pass                                    # a form it cannot take at all (its own policy)
        self.assertIsNotNone(warm_store._cache, "the tolerant read filled the cache")
        return cold, strict(warm_store), warm_store

    def test_a_warm_cache_is_no_proof_of_the_form(self):
        # MT-I36: the strict answer never depends on what the tolerant reader
        # cached — warm and cold the same, the top level named
        for text, kind in (("[]", "list"), ("[1, 2]", "list"), ('["1"]', "list"), ('"1"', "str"),
                           ("5", "int"), ("null", "NoneType")):
            with self.subTest(text):
                cold, warm, _store = self.strict_cold_and_warm(text)
                self.assertEqual(cold, f"refused: top level is {kind}, not an object")
                self.assertEqual(warm, cold)

    def test_a_warm_section_that_is_no_object_is_refused_too(self):
        cold, warm, _store = self.strict_cold_and_warm(json.dumps({"/ini-A": [1], "/ini-B": {}}))
        self.assertEqual(cold, "refused: section is list, not an object")
        self.assertEqual(warm, cold)

    def test_a_valid_library_reads_the_same_warm_and_cold(self):
        for text, want in (("{}", {}), (json.dumps({"/ini-A": {}}), {}),
                           (json.dumps({"/ini-A": {"1": {"type": "x"}}, "/ini-B": [9]}), {"1": {"type": "x"}})):
            with self.subTest(text):
                cold, warm, store = self.strict_cold_and_warm(text)
                self.assertEqual((cold, warm), (want, want))
                self.assertEqual(store.load(), want, "and the tolerant reader's answer is unchanged")

    def test_the_tolerant_reader_keeps_its_answer_and_never_rewrites_a_list(self):
        for text in ("[]", '["1"]', '["1", "2"]'):
            with self.subTest(text):
                self.path.write_text(text)
                store = ToolLibraryStore(self.path, lambda: "/ini-A")
                got = store.load()
                self.assertEqual(self.path.read_text(), text, "the flat-format migration takes an object only")
                self.assertEqual(got, {}, "no library, as before")

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


class TestOneRevisionPerFileState(unittest.TestCase):
    """P6-c plan v8 step 0: rev_of computes a section's revision once per file
    state and INI — every get_tool_table hashed the whole library on the event
    loop (the GIL holds a thread's the same)."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "tool_library.json"
        self.ini = "/ini-A"
        self.store = ToolLibraryStore(self.path, lambda: self.ini)
        self.n = 0
        real = tool_store.library_rev

        def counted(section):
            self.n += 1
            return real(section)
        p = patch.object(tool_store, "library_rev", counted)
        p.start()
        self.addCleanup(p.stop)

    def read(self, store=None, **k):
        store = store or self.store
        lib = store.load(**k)
        return lib, store.rev_of(lib)

    def test_many_reads_of_one_state_compute_it_once(self):
        self.store.save({"1": {"type": "endmill"}})
        got = [self.read(strict=True) for _ in range(5)]
        self.assertEqual(self.n, 1)
        self.assertEqual({r for _lib, r in got}, {library_rev({"1": {"type": "endmill"}})})
        self.assertEqual(got[0][0], {"1": {"type": "endmill"}})

    def test_a_same_size_rewrite_is_a_new_state(self):
        self.store.save({"1": {"type": "ball"}})
        a = self.read(strict=True)[1]
        st = self.path.stat()
        text = self.path.read_text().replace("ball", "flat")
        with open(self.path, "w") as f:                # in place: the same inode and size
            f.write(text)
        os.utime(self.path, ns=(st.st_atime_ns, st.st_mtime_ns + 1))
        b = self.read(strict=True)
        self.assertEqual((self.n, b[0]), (2, {"1": {"type": "flat"}}))
        self.assertNotEqual(a, b[1])

    def test_another_ini_is_another_section(self):
        self.store.save({"1": {"type": "ball"}})
        self.store.save({"2": {"type": "tap"}}, ini_key="/ini-B")
        a = self.read(ini_key="/ini-A")[1]
        b = self.read(ini_key="/ini-B")[1]
        self.assertNotEqual(a, b)
        self.assertEqual(b, library_rev({"2": {"type": "tap"}}))

    def test_a_save_is_a_new_state_a_failed_one_is_not(self):
        self.store.save({"1": {"type": "ball"}})
        a = self.read()[1]
        lib = copy.deepcopy(self.store.load())         # what a writer does: it changes a COPY
        lib["1"]["type"] = "flat"
        with patch.object(tool_store, "atomic_write_bytes", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.store.save(lib)
        self.assertEqual(self.read(), ({"1": {"type": "ball"}}, a))
        self.store.save(lib)
        self.assertEqual(self.read(), (lib, library_rev(lib)))

    def test_seed_empty_and_migrated(self):
        seed = self.path.parent / "seed.json"
        seed.write_text(json.dumps({"7": {"type": "drill"}}))
        store = ToolLibraryStore(self.path, lambda: self.ini, seed_path=lambda: seed)
        for _ in range(3):
            self.assertEqual(self.read(store, strict=True)[1], library_rev({"7": {"type": "drill"}}))
        self.assertEqual(self.n, 1)
        self.assertEqual(self.read()[1], library_rev({}))     # no file, no seed
        self.path.write_text(json.dumps({"1": {"type": "endmill"}}))         # the flat form: migrated
        self.assertEqual(self.read()[1], library_rev({"1": {"type": "endmill"}}))
        self.assertEqual(self.read(), ({"1": {"type": "endmill"}}, library_rev({"1": {"type": "endmill"}})))

    def test_strict_still_refuses(self):
        self.path.write_text("[]")
        self.store.load()                              # the tolerant reader cached its form
        with self.assertRaises(ToolLibraryUnreadable):
            self.read(strict=True)


if __name__ == "__main__":
    unittest.main()

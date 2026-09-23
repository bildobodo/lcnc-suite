"""Unit tests for settings_store (issue #33). Pure — a temp file + an injected
INI-key callable; no linuxcnc/gateway import."""
import errno
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from settings_store import SettingsStore, VALID_SECTIONS


class TestSettingsStore(unittest.TestCase):
    def setUp(self):
        fd, p = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(p)  # start with no file on disk
        self.path = Path(p)
        self.store = SettingsStore(self.path, lambda: "ini-A")

    def tearDown(self):
        if self.path.exists():
            self.path.unlink()

    def test_save_then_load_section(self):
        self.store.save_section("macros", {"x": 1})
        self.assertEqual(self.store.load(), {"macros": {"x": 1}})

    def test_version_bumps_on_save_and_reset(self):
        v0 = self.store.version
        self.store.save_section("viewer", {})
        self.assertEqual(self.store.version, v0 + 1)
        self.store.reset()
        self.assertEqual(self.store.version, v0 + 2)

    def test_writes_preserve_other_inis(self):
        # The per-INI merge: writing under one INI key must not clobber another's.
        self.store.save_section("macros", {"a": 1})                    # ini-A
        SettingsStore(self.path, lambda: "ini-B").save_section("macros", {"b": 2})
        self.assertEqual(SettingsStore(self.path, lambda: "ini-A").load(), {"macros": {"a": 1}})
        self.assertEqual(SettingsStore(self.path, lambda: "ini-B").load(), {"macros": {"b": 2}})

    def test_reset_clears_only_current_ini(self):
        self.store.save_section("macros", {"a": 1})
        self.store.reset()
        self.assertEqual(self.store.load(), {})

    def test_refuses_to_clobber_unparseable_file(self):
        self.path.write_text("{ not valid json")
        errors = []
        store = SettingsStore(self.path, lambda: "ini-A", on_load_error=errors.append)
        with self.assertRaises(RuntimeError):
            store.save_section("macros", {"x": 1})
        self.assertEqual(len(errors), 1)  # on_load_error fired once

    # Review round 7, UI-I12 rest A: the cache — the state every settings
    # blob to the WebUI is built from — only ever holds a WRITTEN state.
    def test_failed_write_leaves_cache_file_and_version_at_the_stored_state(self):
        self.store.save_section("keyboard", {"abort": "F8"})
        v = self.store.version
        full = OSError(errno.ENOSPC, "No space left on device")
        with patch("settings_store.atomic_write_bytes", side_effect=full):
            with self.assertRaises(OSError):
                self.store.save_section("keyboard", {"abort": "F9"})
        self.assertEqual(self.store.load(), {"keyboard": {"abort": "F8"}})
        self.assertEqual(self.store.version, v)
        self.assertEqual(json.loads(self.path.read_text())["ini-A"], {"keyboard": {"abort": "F8"}})
        self.assertEqual(SettingsStore(self.path, lambda: "ini-A").load(), {"keyboard": {"abort": "F8"}})

    def test_failed_first_write_leaves_the_section_absent(self):
        with patch("settings_store.atomic_write_bytes", side_effect=OSError(errno.ENOSPC, "full")):
            with self.assertRaises(OSError):
                self.store.save_section("keyboard", {"abort": "F9"})
        self.assertEqual(self.store.load(), {})
        self.assertEqual(self.store.version, 0)

    def test_refused_write_on_an_unparseable_file_never_reaches_the_cache(self):
        self.path.write_text("{ not valid json")
        store = SettingsStore(self.path, lambda: "ini-A", on_load_error=lambda e: None)
        with self.assertRaises(RuntimeError):
            store.save_section("keyboard", {"abort": "F9"})
        self.assertEqual(store.load(), {})
        self.assertEqual(store.version, 0)
        self.assertEqual(self.path.read_text(), "{ not valid json")

    def test_failed_reset_keeps_the_settings(self):
        self.store.save_section("macros", {"a": 1})
        v = self.store.version
        with patch("settings_store.atomic_write_bytes", side_effect=OSError(errno.EIO, "io")):
            with self.assertRaises(OSError):
                self.store.reset()
        self.assertEqual(self.store.load(), {"macros": {"a": 1}})
        self.assertEqual(self.store.version, v)

    def test_valid_sections(self):
        self.assertIn("macros", VALID_SECTIONS)
        self.assertIn("machine", VALID_SECTIONS)


if __name__ == "__main__":
    unittest.main()

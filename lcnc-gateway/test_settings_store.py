"""Unit tests for settings_store (issue #33; device profiles, settings split
R334–R337). Pure — a temp file + an injected INI-key callable; no
linuxcnc/gateway import."""
import errno
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from settings_store import (CONFIRMED_DEVICE_SECTIONS, DEVICE_SECTIONS, FREE_SECTIONS,
                            MACHINE_SECTIONS, VALID_SECTIONS, SettingsStore, Stale,
                            UnknownDevice, section_needs_arm, token_hash)

TOK_A = "a" * 32
TOK_B = "b" * 32


class _Base(unittest.TestCase):
    def setUp(self):
        fd, p = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(p)  # start with no file on disk
        self.path = Path(p)
        self.store = SettingsStore(self.path, lambda: "ini-A")

    def tearDown(self):
        if self.path.exists():
            self.path.unlink()

    def save(self, section, data, device=None, writer="w1", store=None):
        """A save on the section's current revision."""
        store = store or self.store
        rev = store.view_for(device)["revs"][section]
        return store.save_section(section, data, device=device, base_rev=rev, writer=writer)

    def file_entry(self, ini="ini-A"):
        return json.loads(self.path.read_text())[ini]


class TestMachineSections(_Base):
    def test_save_then_load_section(self):
        self.save("keyboard", {"x": 1})
        self.assertEqual(self.store.load(), {"keyboard": {"x": 1}})
        self.assertEqual(self.store.load_section("keyboard"), {"x": 1})

    def test_machine_sections_stay_where_schema_1_had_them(self):
        # an older gateway still reads them (downgrade)
        self.save("toolsetter", {"x": 1})
        self.assertEqual(self.file_entry()["toolsetter"], {"x": 1})

    def test_version_bumps_on_save_and_reset(self):
        pid, _ = self.store.bind(TOK_A, None)
        v0 = self.store.version
        self.save("keyboard", {})
        self.assertEqual(self.store.version, v0 + 1)
        self.store.reset_device(pid)
        self.assertEqual(self.store.version, v0 + 2)

    def test_writes_preserve_other_inis(self):
        self.save("keyboard", {"a": 1})
        b = SettingsStore(self.path, lambda: "ini-B")
        self.save("keyboard", {"b": 2}, store=b)
        self.assertEqual(SettingsStore(self.path, lambda: "ini-A").load(), {"keyboard": {"a": 1}})
        self.assertEqual(SettingsStore(self.path, lambda: "ini-B").load(), {"keyboard": {"b": 2}})

    def test_a_section_must_be_saved_in_its_own_class(self):
        pid, _ = self.store.bind(TOK_A, None)
        with self.assertRaises(ValueError):
            self.store.save_section("display", {}, base_rev=0)
        with self.assertRaises(ValueError):
            self.store.save_section("keyboard", {}, device=pid, base_rev=0)

    def test_a_save_without_its_base_revision_is_refused(self):
        for bad in (None, "0", -1, True, 1.0):
            with self.assertRaises(ValueError):
                self.store.save_section("keyboard", {}, base_rev=bad)
        self.assertFalse(self.path.exists())

    def test_refuses_to_clobber_unparseable_file(self):
        self.path.write_text("{ not valid json")
        errors = []
        store = SettingsStore(self.path, lambda: "ini-A", on_load_error=errors.append)
        with self.assertRaises(RuntimeError):
            store.save_section("keyboard", {"x": 1}, base_rev=0)
        self.assertEqual(len(errors), 1)  # on_load_error fired once
        self.assertEqual(self.path.read_text(), "{ not valid json")
        self.assertEqual(store.version, 0)

    # Review round 7, UI-I12 rest A: the cache — the state every settings
    # blob to the WebUI is built from — only ever holds a WRITTEN state.
    def test_failed_write_leaves_cache_file_and_version_at_the_stored_state(self):
        self.save("keyboard", {"abort": "F8"})
        v = self.store.version
        full = OSError(errno.ENOSPC, "No space left on device")
        with patch("settings_store.atomic_write_bytes", side_effect=full):
            with self.assertRaises(OSError):
                self.save("keyboard", {"abort": "F9"})
        self.assertEqual(self.store.load(), {"keyboard": {"abort": "F8"}})
        self.assertEqual(self.store.version, v)
        self.assertEqual(self.file_entry()["keyboard"], {"abort": "F8"})
        self.assertEqual(SettingsStore(self.path, lambda: "ini-A").load(), {"keyboard": {"abort": "F8"}})
        self.assertEqual(self.store.view_for(None)["revs"]["keyboard"], 1)

    def test_failed_first_write_leaves_the_section_absent(self):
        with patch("settings_store.atomic_write_bytes", side_effect=OSError(errno.ENOSPC, "full")):
            with self.assertRaises(OSError):
                self.save("keyboard", {"abort": "F9"})
        self.assertEqual(self.store.load(), {})
        self.assertEqual(self.store.version, 0)

    def test_failed_reset_keeps_the_settings(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.save("display", {"a": 1}, device=pid)
        v = self.store.version
        with patch("settings_store.atomic_write_bytes", side_effect=OSError(errno.EIO, "io")):
            with self.assertRaises(OSError):
                self.store.reset_device(pid)
        self.assertEqual(self.store.view_for(pid)["settings"]["display"], {"a": 1})
        self.assertEqual(self.store.version, v)

    def test_a_refusing_admission_writes_and_bumps_nothing(self):
        def refuse():
            raise PermissionError("Not armed — press Arm")
        with self.assertRaises(PermissionError):
            self.store.save_section("keyboard", {"a": 1}, base_rev=0, writer="w", admit=refuse)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.store.version, 0)
        self.assertEqual(self.store.view_for(None)["revs"]["keyboard"], 0)


class TestClassification(unittest.TestCase):
    def test_the_sections(self):
        self.assertEqual(MACHINE_SECTIONS & DEVICE_SECTIONS, frozenset())
        self.assertEqual(VALID_SECTIONS, MACHINE_SECTIONS | DEVICE_SECTIONS)
        self.assertEqual(FREE_SECTIONS, DEVICE_SECTIONS)
        self.assertTrue(CONFIRMED_DEVICE_SECTIONS <= DEVICE_SECTIONS)
        self.assertIn("simulation", CONFIRMED_DEVICE_SECTIONS)
        self.assertIn("macroBar", DEVICE_SECTIONS)
        self.assertIn("macros", MACHINE_SECTIONS)
        for s in MACHINE_SECTIONS:
            self.assertTrue(section_needs_arm(s))
        for s in DEVICE_SECTIONS:
            self.assertFalse(section_needs_arm(s))
        self.assertTrue(section_needs_arm("nonsense"))


class TestMigration(_Base):
    def schema1(self):
        self.path.write_text(json.dumps({"ini-A": {
            "display": {"theme": "dark"}, "viewer": {"projection": "perspective"},
            "panels": {"tabs": ["viewer"]}, "camera": {"showGrid": True},
            "macros": {"macros": [{"old": 1}], "bar": ["probe_z", "park"]},
            "keyboard": {"abort": "F8"},
        }, "ini-B": {"keyboard": {"abort": "F2"}}}))
        self.store = SettingsStore(self.path, lambda: "ini-A")

    def test_the_template_is_made_from_the_schema_1_display_sections_and_the_bar(self):
        self.schema1()
        v = self.store.view_for(None)
        s = v["settings"]
        self.assertEqual(s["display"], {"theme": "dark"})
        self.assertEqual(s["viewer"], {"projection": "perspective"})
        self.assertEqual(s["panels"], {"tabs": ["viewer"]})
        self.assertEqual(s["camera"], {"showGrid": True})
        self.assertEqual(s["macroBar"], {"bar": ["probe_z", "park"]})
        self.assertEqual(s["simulation"], {"enabled": False})
        self.assertEqual(s["keyboard"], {"abort": "F8"})
        # the earlier macros pass through; the bar is the device's now
        self.assertEqual(s["macros"], {"macros": [{"old": 1}]})
        self.assertEqual(v["device"], {"id": None, "name": ""})

    def test_a_read_never_writes(self):
        self.schema1()
        before = self.path.read_text()
        self.store.view_for(None)
        self.store.list_devices()
        self.store.find_device(TOK_A)
        self.assertEqual(self.path.read_text(), before)

    def test_the_first_write_stores_schema_2_and_keeps_every_schema_1_section(self):
        self.schema1()
        self.store.bind(TOK_A, None)
        e = self.file_entry()
        self.assertEqual(e["_v2"]["schema"], 2)
        # schema 1 left as it was: an older gateway still reads its sections
        self.assertEqual(e["display"], {"theme": "dark"})
        self.assertEqual(e["macros"], {"macros": [{"old": 1}], "bar": ["probe_z", "park"]})
        self.assertEqual(self.file_entry("ini-B"), {"keyboard": {"abort": "F2"}})

    def test_the_migration_is_made_once(self):
        self.schema1()
        self.store.bind(TOK_A, None)
        # a later schema-1 write (an older gateway) does not remake the template
        raw = json.loads(self.path.read_text())
        raw["ini-A"]["display"] = {"theme": "light"}
        self.path.write_text(json.dumps(raw))
        store = SettingsStore(self.path, lambda: "ini-A")
        self.assertEqual(store.view_for(None)["settings"]["display"], {"theme": "dark"})

    def test_an_empty_file_gives_an_empty_template_with_simulation_off(self):
        s = self.store.view_for(None)["settings"]
        self.assertEqual(s, {"simulation": {"enabled": False}})


class TestDevices(_Base):
    def test_an_unknown_token_makes_a_new_profile_from_the_template_simulation_off(self):
        self.path.write_text(json.dumps({"ini-A": {"display": {"theme": "dark"},
                                                   "_v2": {"schema": 2, "devices": {}, "revs": {},
                                                           "template": {"display": {"theme": "dark"},
                                                                        "simulation": {"enabled": True}}}}}))
        store = SettingsStore(self.path, lambda: "ini-A")
        pid, created = store.bind(TOK_A, "10.0.0.2")
        self.assertTrue(created)
        v = store.view_for(pid)
        self.assertEqual(v["settings"]["display"], {"theme": "dark"})
        self.assertEqual(v["settings"]["simulation"], {"enabled": False})   # OP1
        self.assertEqual(v["device"], {"id": pid, "name": ""})

    def test_the_same_token_binds_the_same_profile(self):
        pid, created = self.store.bind(TOK_A, "a")
        pid2, created2 = self.store.bind(TOK_A, "b")
        self.assertEqual((pid2, created2), (pid, False))
        self.assertEqual(self.store.find_device(TOK_A), pid)
        self.assertIsNone(self.store.find_device(TOK_B))
        [d] = self.store.list_devices()
        self.assertEqual(d["last_address"], "b")

    def test_only_the_tokens_hash_is_stored_and_the_list_never_shows_it(self):
        pid, _ = self.store.bind(TOK_A, None)
        text = self.path.read_text()
        self.assertNotIn(TOK_A, text)
        self.assertIn(token_hash(TOK_A), text)
        self.assertNotIn(pid, TOK_A)
        for d in self.store.list_devices():
            self.assertNotIn("token_sha256", d)
            self.assertNotIn(token_hash(TOK_A), json.dumps(d))
        self.assertNotIn("token_sha256", json.dumps(self.store.view_for(pid)))

    def test_a_malformed_token_is_refused_and_never_found(self):
        for bad in (None, "", "A" * 32, "a" * 31, "g" * 32, 123):
            with self.assertRaises(ValueError):
                self.store.bind(bad, None)
            self.assertIsNone(self.store.find_device(bad))
        self.assertFalse(self.path.exists())

    def test_device_sections_belong_to_their_device(self):
        a, _ = self.store.bind(TOK_A, None)
        b, _ = self.store.bind(TOK_B, None)
        self.save("simulation", {"enabled": True}, device=a)
        self.save("display", {"theme": "dark"}, device=a)
        self.assertEqual(self.store.view_for(a)["settings"]["simulation"], {"enabled": True})
        self.assertEqual(self.store.view_for(b)["settings"]["simulation"], {"enabled": False})
        self.assertNotIn("display", self.store.view_for(b)["settings"])
        self.assertNotIn("simulation", self.store.load())

    def test_machine_sections_are_the_same_for_every_device(self):
        a, _ = self.store.bind(TOK_A, None)
        b, _ = self.store.bind(TOK_B, None)
        self.save("keyboard", {"abort": "F8"})
        self.assertEqual(self.store.view_for(a)["settings"]["keyboard"], {"abort": "F8"})
        self.assertEqual(self.store.view_for(b)["settings"]["keyboard"], {"abort": "F8"})

    def test_a_save_for_an_unknown_device_is_refused(self):
        with self.assertRaises(UnknownDevice):
            self.store.save_section("display", {}, device="nope", base_rev=0, writer="w")

    # R336/R337 (Codex): a short first visit keeps its confirmed settings.
    def test_a_short_visit_keeps_its_profile_and_values(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.save("simulation", {"enabled": True}, device=pid)
        self.store.rename_device(pid, "Panel")
        store = SettingsStore(self.path, lambda: "ini-A")   # later: a restarted gateway
        pid2, created = store.bind(TOK_A, None)
        self.assertEqual((pid2, created), (pid, False))
        v = store.view_for(pid)
        self.assertEqual(v["settings"]["simulation"], {"enabled": True})
        self.assertEqual(v["device"]["name"], "Panel")

    def test_a_profile_never_changed_is_listed_as_such(self):
        pid, _ = self.store.bind(TOK_A, None)
        [d] = self.store.list_devices()
        self.assertFalse(d["changed"])
        self.save("display", {"theme": "dark"}, device=pid)
        [d] = self.store.list_devices()
        self.assertTrue(d["changed"])

    def test_a_rename_is_a_change_too(self):
        # R337's "never changed" = no write accepted for it (Codex R338)
        pid, _ = self.store.bind(TOK_A, None)
        self.store.rename_device(pid, "Panel")
        [d] = self.store.list_devices()
        self.assertTrue(d["changed"])

    def test_the_binding_is_claimed_under_the_stores_lock(self):
        # R338 SS-I04: the connection holds the profile before a delete can ask
        held = []
        pid, _ = self.store.bind(TOK_A, None, claim=lambda p: held.append((p, self.store._lock.locked())))
        self.assertEqual(held, [(pid, True)])

    def test_a_delete_before_the_bind_gives_a_new_profile_named_new(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.store.delete_device(pid)
        claimed = []
        pid2, created = self.store.bind(TOK_A, None, claim=claimed.append)
        self.assertTrue(created)
        self.assertEqual(claimed, [pid2])
        self.assertEqual(self.store.find_device(TOK_A), pid2)

    def test_reset_device_returns_the_template_with_simulation_off_and_keeps_the_name(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.store.rename_device(pid, "Laptop")
        self.save("simulation", {"enabled": True}, device=pid)
        self.save("display", {"theme": "dark"}, device=pid)
        self.store.reset_device(pid)
        v = self.store.view_for(pid)
        self.assertEqual(v["settings"]["simulation"], {"enabled": False})
        self.assertNotIn("display", v["settings"])
        self.assertEqual(v["device"]["name"], "Laptop")

    def test_rename_trims_and_bounds_the_name(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.store.rename_device(pid, "  Panel  ")
        self.assertEqual(self.store.view_for(pid)["device"]["name"], "Panel")
        with self.assertRaises(ValueError):
            self.store.rename_device(pid, "x" * 41)
        with self.assertRaises(UnknownDevice):
            self.store.rename_device("nope", "x")

    def test_delete_is_the_only_way_a_profile_leaves(self):
        pid, _ = self.store.bind(TOK_A, None)
        self.store.delete_device(pid)
        self.assertEqual(self.store.list_devices(), [])
        self.assertIsNone(self.store.find_device(TOK_A))
        # the same browser comes back: a new profile, a new public id
        pid2, created = self.store.bind(TOK_A, None)
        self.assertTrue(created)
        self.assertNotEqual(pid2, pid)

    def test_a_refused_delete_keeps_the_profile(self):
        pid, _ = self.store.bind(TOK_A, None)

        def connected():
            raise PermissionError("Device connected — close it first")
        with self.assertRaises(PermissionError):
            self.store.delete_device(pid, admit=connected)
        self.assertEqual([d["id"] for d in self.store.list_devices()], [pid])

    def test_nothing_in_the_store_removes_a_profile_but_delete(self):
        # R337: no timer, no clean-up — the source has ONE place that drops a profile
        src = Path(__file__).with_name("settings_store.py").read_text()
        self.assertEqual(src.count('del v2["devices"]'), 1)
        self.assertNotIn("Timer(", src)
        self.assertNotIn("time.monotonic", src)


class TestRevisions(_Base):
    """A save names the revision it was made on (SS334-06): a section another
    writer changed since is refused with its current state."""

    def test_a_save_on_an_older_revision_by_another_writer_is_stale(self):
        pid, _ = self.store.bind(TOK_A, None)
        base = self.store.view_for(pid)["revs"]["simulation"]
        # the laptop (armed) switches the panel off …
        self.store.save_section("simulation", {"enabled": False}, device=pid, base_rev=base, writer="laptop")
        # … an old panel tab saves its earlier state later
        with self.assertRaises(Stale) as cm:
            self.store.save_section("simulation", {"enabled": True}, device=pid, base_rev=base, writer="panel")
        self.assertEqual(cm.exception.data, {"enabled": False})
        self.assertEqual(cm.exception.rev, base + 1)
        self.assertEqual(self.store.view_for(pid)["settings"]["simulation"], {"enabled": False})

    def test_a_writers_second_save_after_its_own_first_passes(self):
        # the tab's next change goes out before the reply to its first
        base = self.store.view_for(None)["revs"]["keyboard"]
        self.store.save_section("keyboard", {"a": 1}, base_rev=base, writer="tab")
        rev = self.store.save_section("keyboard", {"a": 2}, base_rev=base, writer="tab")
        self.assertEqual(rev, base + 2)
        self.assertEqual(self.store.load()["keyboard"], {"a": 2})

    def test_once_another_writer_came_between_the_chain_is_stale(self):
        base = self.store.view_for(None)["revs"]["keyboard"]
        self.store.save_section("keyboard", {"a": 1}, base_rev=base, writer="tab")
        self.store.save_section("keyboard", {"b": 1}, base_rev=base + 1, writer="other")
        with self.assertRaises(Stale):
            self.store.save_section("keyboard", {"a": 2}, base_rev=base, writer="tab")

    def test_an_anonymous_writer_never_passes_a_newer_revision(self):
        base = self.store.view_for(None)["revs"]["keyboard"]
        self.store.save_section("keyboard", {"a": 1}, base_rev=base, writer=None)
        with self.assertRaises(Stale):
            self.store.save_section("keyboard", {"a": 2}, base_rev=base, writer=None)

    def test_after_a_restart_only_the_current_revision_passes(self):
        self.save("keyboard", {"a": 1})
        store = SettingsStore(self.path, lambda: "ini-A")
        self.assertEqual(store.view_for(None)["revs"]["keyboard"], 1)
        with self.assertRaises(Stale):
            store.save_section("keyboard", {"a": 2}, base_rev=0, writer="w1")
        self.assertEqual(store.save_section("keyboard", {"a": 2}, base_rev=1, writer="w1"), 2)

    def test_a_revision_from_the_future_is_stale(self):
        with self.assertRaises(Stale):
            self.store.save_section("keyboard", {"a": 1}, base_rev=5, writer="w")

    def test_a_reset_makes_every_earlier_save_stale(self):
        pid, _ = self.store.bind(TOK_A, None)
        base = self.store.view_for(pid)["revs"]["display"]
        self.store.reset_device(pid)
        with self.assertRaises(Stale):
            self.store.save_section("display", {"theme": "dark"}, device=pid, base_rev=base, writer="w")
        # the file holds the new revisions: after a restart too
        store = SettingsStore(self.path, lambda: "ini-A")
        self.assertEqual(store.view_for(pid)["revs"]["display"], base + 1)
        with self.assertRaises(Stale):
            store.save_section("display", {"theme": "dark"}, device=pid, base_rev=base, writer="w")

    def test_revisions_are_per_device(self):
        a, _ = self.store.bind(TOK_A, None)
        b, _ = self.store.bind(TOK_B, None)
        self.save("display", {"theme": "dark"}, device=a)
        self.assertEqual(self.store.view_for(a)["revs"]["display"], 1)
        self.assertEqual(self.store.view_for(b)["revs"]["display"], 0)
        self.save("display", {"theme": "light"}, device=b, writer="other")


if __name__ == "__main__":
    unittest.main()

"""Behaviour defects the type check found (package 2a, plan vor-maschine
R352/R353: a real defect gets its own commit and test, never a cast)."""
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

import status_runtime
from status_runtime import StatusRuntime

HERE = os.path.dirname(os.path.abspath(__file__))
COMPENSATION = os.path.join(HERE, "..", "subroutines", "surfacemap", "compensation.py")


class _Stat:
    def __init__(self, **attrs):
        self.__dict__.update(attrs)

    def poll(self):
        pass


def _runtime(stat, snapshot=None, tbl_path=None):
    snap = snapshot if snapshot is not None else {}
    return StatusRuntime(get_stat=lambda: stat, get_err=lambda: None, reader_get=snap.get,
                         get_tool_tbl_path=lambda: tbl_path, load_tool_library=lambda: {},
                         get_fb_scale=lambda: 60, get_reader_fresh=lambda: snapshot is not None)


class SpindleOverrideEnabled(unittest.TestCase):
    """2.9.4 has no `stat.spindle_override_enabled` (only the spindle row's
    `override_enabled`): the old read got its default True on every machine —
    M51 P0 never showed, and the UI's "missing data → disabled" was defeated."""

    def payload(self, **stat):
        return _runtime(_Stat(**stat)).poll_status()

    def test_the_spindle_rows_switch_is_reported(self):
        # a full 2.9.4 spindle row (lcnc_iface.SpindleStatus: the binding always has all nine keys)
        row = {"brake": 0, "direction": 0, "enabled": 0, "override_enabled": False, "speed": 0.0,
               "override": 1.0, "homed": False, "orient_state": 0, "orient_fault": 0}
        self.assertIs(self.payload(spindle=(row,)).spindle_override_enabled, False)
        self.assertIs(self.payload(spindle=({**row, "override_enabled": True},)).spindle_override_enabled, True)

    def test_unread_is_unknown_never_enabled(self):
        self.assertIsNone(self.payload().spindle_override_enabled)
        self.assertIsNone(self.payload(spindle=()).spindle_override_enabled)


class ToolChangeInfoWithoutTable(unittest.TestCase):
    """No tool table path known: the lookup names that case — before, it fed
    None to parse_tool_table and reported a TypeError."""

    def test_the_lookup_says_no_table_path(self):
        rt = _runtime(_Stat(), snapshot={"tool_change": True, "tool_prep_number": 3}, tbl_path=None)
        with mock.patch.object(status_runtime._trace, "emit") as emit:
            payload = rt.poll_status()
        self.assertIsNone(payload.tool_change_info)
        calls = [c for c in emit.call_args_list if c.args and c.args[0] == "toolchange.info_lookup_failed"]
        self.assertEqual(len(calls), 1, emit.call_args_list)
        self.assertEqual(calls[0].kwargs.get("exc"), "ValueError")
        self.assertIn("no tool table path", calls[0].kwargs.get("msg", ""))


class CompensationGridWriteFailure(unittest.TestCase):
    """compensation.py's grid write: a mkstemp that fails (folder not
    writable) must end in its own message — the cleanup reached for a
    `tmp_path` never bound and raised NameError instead. Run in a child: the
    module installs SIGINT/SIGTERM handlers on import."""

    def test_a_failed_mkstemp_is_reported_not_a_name_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            probe = os.path.join(tmp, "probe-results.txt")
            with open(probe, "w") as f:
                for x in (0, 10, 20):
                    for y in (0, 10, 20):
                        f.write(f"{x} {y} {0.01 * (x + y)}\n")
            script = textwrap.dedent(f"""
                import sys, types
                sys.modules["linuxcnc"] = types.ModuleType("linuxcnc")
                src = open({COMPENSATION!r}).read()
                entry = "comp = Compensation()\\ncomp.run()\\n"
                assert src.endswith(entry), "the module's entry lines moved"
                mod = types.ModuleType("compensation")
                mod.__file__ = {COMPENSATION!r}
                exec(compile(src[:-len(entry)], {COMPENSATION!r}, "exec"), mod.__dict__)
                def refuse(*a, **k):
                    raise PermissionError("folder not writable")
                mod.tempfile.mkstemp = refuse
                c = object.__new__(mod.Compensation)
                c.filename = {probe!r}
                c.h = {{"method": 1, "resolution": 5.0}}
                c.loadMap()
                print("LOADMAP RETURNED")
            """)
            r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertIn("Grid write failed", r.stdout)
        self.assertIn("LOADMAP RETURNED", r.stdout)
        self.assertNotIn("NameError", r.stderr)
        _ = json   # the grid file is never written here


if __name__ == "__main__":
    unittest.main()


class _Settings(unittest.TestCase):
    def setUp(self):
        from settings_store import SettingsStore
        fd, p = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        os.unlink(p)
        self.path = p
        self.errors = []
        self.store = SettingsStore(__import__("pathlib").Path(p), lambda: "ini-A",
                                   on_load_error=self.errors.append)
        self.addCleanup(lambda: os.path.exists(p) and os.unlink(p))

    def write(self, doc):
        with open(self.path, "w") as f:
            json.dump(doc, f)


class SimulationNotAnObject(_Settings):
    """Strict typing of settings_store (R354 VM-I03): a device saves its own
    sections without arm and the save takes ANY JSON value — `null` for its
    simulation section failed the whole device list with AttributeError
    (`.get` on None). A simulation that is not an object reads as OFF."""

    def test_a_null_simulation_lists_the_device_with_simulation_off(self):
        # as a file holds it from a save before 2a (a save refuses it now)
        pid, _ = self.store.bind("a" * 32, "10.0.0.2")
        doc = json.load(open(self.path))
        doc["ini-A"]["_v2"]["devices"][pid]["sections"]["simulation"] = None
        self.write(doc)
        self.store._cache = None
        devices = self.store.list_devices()
        self.assertEqual([(d["id"], d["simulation"]) for d in devices], [(pid, False)])

    def test_an_enabled_simulation_still_reads_on(self):
        pid, _ = self.store.bind("b" * 32, None)
        rev = self.store.view_for(pid)["revs"]["simulation"]
        self.store.save_section("simulation", {"enabled": True}, device=pid, base_rev=rev, writer="w")
        self.assertTrue(self.store.list_devices()[0]["simulation"])


class SectionsAreObjects(_Settings):
    """The save took ANY JSON value as a section (only `features` was
    checked): `machine: null` from an armed client stopped the status loop of
    every client that connected after it (`settings["machine"].get` in its
    start, unguarded), a device's `simulation: null` the device list. Every
    section the WebUI saves is an object: anything else is refused, and a
    non-object a file already holds is no machine section for load()."""

    def test_a_non_object_section_is_refused_and_nothing_is_written(self):
        for data in (None, [], "x", 5):
            with self.assertRaises(ValueError):
                self.store.save_section("machine", data, base_rev=0, writer="w")
        self.assertFalse(os.path.exists(self.path))
        pid, _ = self.store.bind("d" * 32, None)
        rev = self.store.view_for(pid)["revs"]["simulation"]
        with self.assertRaises(ValueError):
            self.store.save_section("simulation", None, device=pid, base_rev=rev, writer="w")

    def test_load_leaves_out_a_machine_section_that_is_no_object(self):
        self.write({"ini-A": {"machine": None, "keyboard": {"x": 1}, "probe": [1]}})
        self.assertEqual(self.store.load(), {"keyboard": {"x": 1}})


class SettingsDocumentShape(_Settings):
    """A settings.json that parses but has the wrong shape (R354 VM-I03):
    before 2a the file was cached and each read failed with whatever
    AttributeError / TypeError its access hit."""

    def test_a_document_that_is_not_an_object_is_a_load_failure(self):
        from settings_store import CorruptSettings
        self.write(["not", "an", "object"])
        self.assertEqual(self.store.load(), {})                 # reads degrade, as for a parse failure
        self.assertEqual(len(self.errors), 1)
        self.assertIsInstance(self.errors[0], CorruptSettings)
        with self.assertRaises(RuntimeError):                   # … and writes refuse to clobber it
            self.store.save_section("keyboard", {"x": 1}, base_rev=0, writer="w")

    def test_a_device_part_of_the_wrong_shape_is_named(self):
        from settings_store import CorruptSettings
        self.write({"ini-A": {"_v2": {"schema": 2, "template": {}, "devices": [], "revs": {}}}})
        with self.assertRaises(CorruptSettings) as cm:
            self.store.list_devices()
        self.assertIn("device profiles", str(cm.exception))
        self.assertIsInstance(cm.exception, RuntimeError)       # a server-side failure, never a 400

    def test_an_ini_entry_that_is_not_an_object_is_named(self):
        from settings_store import CorruptSettings
        self.write({"ini-A": 5})
        with self.assertRaises(CorruptSettings):
            self.store.load_section("toolsetter")

    def test_a_token_hash_that_is_no_string_is_named(self):
        from settings_store import CorruptSettings
        self.write({"ini-A": {"_v2": {"schema": 2, "template": {}, "revs": {},
                                      "devices": {"p1": {"token_sha256": 7, "sections": {}}}}}})
        with self.assertRaises(CorruptSettings):
            self.store.find_device("c" * 32)


class JsonConversions(unittest.TestCase):
    """json_types.to_float / to_int (R354 VM-I03): the typed float() / int()
    of a payload or status value — the builtins' outcome for every JSON value
    (and numpy scalars), so a caller's except (TypeError, ValueError) keeps
    its meaning."""

    def test_same_outcome_as_the_builtins(self):
        from json_types import to_float, to_int
        values = [0, 1, -3, 1.5, True, False, "2.5", "7", "x", "", None, [1], {"a": 1}, b"3"]
        try:
            import numpy as np
            values += [np.int64(4), np.float32(1.25)]
        except ImportError:
            pass
        for helper, builtin in ((to_float, float), (to_int, int)):
            for v in values:
                try:
                    want = ("ok", builtin(v))
                except (TypeError, ValueError) as e:
                    want = (type(e).__name__, None)
                try:
                    got = ("ok", helper(v))
                except (TypeError, ValueError) as e:
                    got = (type(e).__name__, None)
                self.assertEqual(got, want, f"{helper.__name__}({v!r})")


class ChoiceRefusesNonWords(unittest.TestCase):
    """A Choice field (`via`) took an unhashable value (a list, an object)
    into frozenset membership: TypeError, outside the bounds refusal
    (validate_payload's callers catch ValueError) — the worker's backstop
    answered "TypeError: unhashable type" instead of the field's refusal."""

    def test_a_list_or_object_is_the_fields_refusal(self):
        import command_policy as cp
        # a gamepad command without other fields (package 3a: a required
        # field missing would be the refusal first)
        cmd = next(c for c, s in cp.COMMAND_SCHEMA.items()
                   if isinstance(s.get("via"), cp.Choice) and len(s) == 1 and c not in cp.STOP_COMMANDS)
        for raw in ([1], {"a": 1}, 5, "keyboard"):
            with self.assertRaises(ValueError) as cm:
                cp.validate_payload(cmd, {"via": raw}, cp.MachineLimits(n_axes=3))
            self.assertIn("via", str(cm.exception))
        self.assertEqual(cp.validate_payload(cmd, {"via": "gamepad"}, cp.MachineLimits(n_axes=3)), {})

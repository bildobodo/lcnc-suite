"""Fresh installs and upgrades must offer the same three runnable examples."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("install_examples", ROOT / "scripts/install_examples.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
SOURCE = ROOT / "examples/sim_config"
CATALOG = json.loads((SOURCE / "profiles.json").read_text())


class ExampleInstallTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        self.dest = self.base / "configs/examples"
        self.backups = self.base / "backups"
        guard = patch.object(installer, "assert_stopped")
        guard.start()
        self.addCleanup(guard.stop)

    def install(self):
        return installer.install(ROOT, self.dest, self.backups)

    def test_fresh_install_has_exact_catalog_and_resolved_dependencies(self):
        self.install()
        self.assertEqual({p.name for p in self.dest.glob("*.ini")},
                         {p["ini"] for p in CATALOG["profiles"]})
        self.assertEqual(len(CATALOG["profiles"]), 3)
        self.assertFalse((self.dest / "machine-dmu160p").exists())
        state_files = set()
        for profile in CATALOG["profiles"]:
            config = installer.values((self.dest / profile["ini"]).read_text())
            self.assertEqual(config["EMC", "MACHINE"], profile["name"])
            self.assertEqual(config["DISPLAY", "WEBUI_HOST"], "127.0.0.1")
            self.assertTrue(Path(config["DISPLAY", "DISPLAY"]).is_file())
            for key in [("RS274NGC", "PARAMETER_FILE"), ("EMCIO", "TOOL_TABLE"),
                        ("TRAJ", "POSITION_FILE")]:
                if key not in config:
                    continue
                path = self.dest / config[key]
                self.assertTrue(path.is_file())
                self.assertFalse(path.is_symlink())
                self.assertNotIn(path, state_files)
                state_files.add(path)
            for path in config["RS274NGC", "SUBROUTINE_PATH"].split(":"):
                self.assertTrue(Path(path).is_dir(), path)
            for key in [("DISPLAY", "WEBUI_MACHINE_DIR"), ("PYTHON", "TOPLEVEL"),
                        ("DISPLAY", "OPEN_FILE")]:
                if config.get(key):
                    self.assertTrue((self.dest / config[key]).exists(), key)
        self.assertIsNone(self.install())  # Rerun causes no writes or backup churn.

    def test_upgrade_migrates_state_settings_and_archives_retired_profiles(self):
        self.dest.mkdir(parents=True)
        profile = CATALOG["profiles"][0]
        old = (SOURCE / profile["ini"]).read_text().replace("xyz3/sim.var", "sim.var").replace(
            "xyz3/tool.tbl", "tool.tbl").replace("WEBUI_HOST = 127.0.0.1", "WEBUI_HOST = 0.0.0.0\nWEBUI_TOKEN = private-test-token").replace(
            "MAX_LIMIT = 685", "MAX_LIMIT = 680")
        (self.dest / profile["previous_ini"]).write_text(old)
        (self.dest / "sim.var").write_text("5221 123.45\n")
        (self.dest / "tool.tbl").write_text("T7 P7 Z99 D8\n")
        (self.dest / "lcnc_suite_sim_dmu160p.ini").write_text("private config")
        (self.dest / "hallib").mkdir()
        (self.dest / "hallib/custom.hal").write_text("operator modification")
        backup = self.install()
        self.assertFalse(backup.is_relative_to(self.dest.parent))
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual((backup / "config" / profile["previous_ini"]).read_text(), old)
        self.assertEqual((backup / "config/hallib/custom.hal").read_text(), "operator modification")
        self.assertEqual((self.dest / "xyz3/sim.var").read_text(), "5221 123.45\n")
        self.assertEqual((self.dest / "xyz3/tool.tbl").read_text(), "T7 P7 Z99 D8\n")
        ini = (self.dest / profile["ini"]).read_text()
        self.assertIn("WEBUI_TOKEN = private-test-token", ini)
        self.assertIn("MAX_LIMIT = 680", ini)
        self.assertFalse((self.dest / "lcnc_suite_sim_dmu160p.ini").exists())
        # Neither upgrading nor re-running may transplant old 5-axis tool geometry.
        self.assertEqual((self.dest / "xyzac5/tool.tbl").read_bytes(), (SOURCE / "xyzac5/tool.tbl").read_bytes())
        (self.dest / "xyzac5/sim.var").write_text("local offsets")
        self.assertIsNone(self.install())
        self.assertEqual((self.dest / "xyzac5/sim.var").read_text(), "local offsets")

    def test_upgrade_adds_start_position_without_resetting_local_state(self):
        self.install()
        ini = self.dest / "lcnc_suite_sim_5axis_xyzac.ini"
        position = self.dest / "xyzac5/position.txt"
        # Reproduce the original installation: no POSITION_FILE in its INI.
        ini.write_text(ini.read_text().replace(
            "POSITION_FILE = xyzac5/position.txt\n", "").replace(
            "WEBUI_DEV = 0", "WEBUI_DEV = 1"))
        position.unlink()
        offsets = self.dest / "xyzac5/sim.var"
        offsets.write_text("5221 42\n")
        backup = self.install()
        self.assertNotIn("POSITION_FILE =", (backup / "config" / ini.name).read_text())
        config = installer.values(ini.read_text())
        self.assertEqual(config["TRAJ", "POSITION_FILE"], "xyzac5/position.txt")
        self.assertEqual(config["DISPLAY", "WEBUI_DEV"], "1")
        self.assertEqual(offsets.read_text(), "5221 42\n")
        self.assertEqual(position.read_bytes(), (SOURCE / "xyzac5/position.txt").read_bytes())
        # Once the controller has saved a different pose, updates preserve it.
        saved = "\n".join(map(str, [10, 20, 350, 15, 45] + [0] * 11)) + "\n"
        position.write_text(saved)
        self.assertIsNone(self.install())
        self.assertEqual(position.read_text(), saved)

    def test_upgrade_migrates_existing_position_file(self):
        self.dest.mkdir(parents=True)
        name = "lcnc_suite_sim_5axis_xyzac.ini"
        (self.dest / name).write_text((SOURCE / name).read_text().replace(
            "xyzac5/position.txt", "old-position.txt"))
        saved = "\n".join(map(str, [10, 20, 350, 15, 45] + [0] * 11)) + "\n"
        (self.dest / "old-position.txt").write_text(saved)
        self.install()
        self.assertEqual((self.dest / "xyzac5/position.txt").read_text(), saved)
        self.assertEqual(installer.values((self.dest / name).read_text())[
            "TRAJ", "POSITION_FILE"], "xyzac5/position.txt")

    def test_refuses_live_install_and_backup_inside_chooser_before_writing(self):
        with patch.object(installer, "assert_stopped", side_effect=RuntimeError("Stop LinuxCNC")):
            with self.assertRaisesRegex(RuntimeError, "Stop LinuxCNC"):
                self.install()
        self.assertFalse(self.dest.exists())
        with self.assertRaisesRegex(ValueError, "outside"):
            installer.install(ROOT, self.dest, self.dest / "backup")
        self.assertFalse(self.dest.exists())

"""Fresh installs and upgrades must offer the same three runnable examples."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from tool_table import parse_tool_table, _merge_tool_data
from tool_store import ToolLibraryStore
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
        self.user_home = self.base / "home"
        self.library = self.user_home / "linuxcnc/nc_files/fusion-freecad.json"
        home = patch.object(installer.Path, "home", return_value=self.user_home)
        home.start()
        self.addCleanup(home.stop)
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
            self.assertEqual(config["DISPLAY", "PROGRAM_PREFIX"], "~/linuxcnc/nc_files")
            self.assertEqual(config['DISPLAY', 'TOOL_LIBRARY_DIR'], config['DISPLAY', 'PROGRAM_PREFIX'])
            self.assertEqual(self.library.read_bytes(), (SOURCE / 'tool-libraries/fusion-freecad.json').read_bytes())
            self.assertFalse((self.dest / 'tool-libraries').exists())
            table_path = self.dest / config['EMCIO', 'TOOL_TABLE']
            store = ToolLibraryStore(self.base / 'metadata.json', lambda: str(self.dest / profile['ini']),
                                     seed_path=lambda: table_path.with_suffix('.seed.json'))
            table = _merge_tool_data(parse_tool_table(str(table_path)), store.load())
            examples = [t for t in table if t.get('is_example')]
            self.assertEqual(len(examples), 36)
            self.assertTrue(all(0 < t['Z'] < t['oal'] for t in examples))
            self.assertTrue(any(t.get('native_mesh') for t in examples))
            self.assertEqual(next(t['Z'] for t in table if t['T'] == 1),
                             {'xyz3': 50, 'xyzac5': 100, 'xyzabc6': 200}[profile['state_dir']])
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
            "MAX_LIMIT = 685", "MAX_LIMIT = 680").replace('TOOL_LIBRARY_DIR = ~/linuxcnc/nc_files\n', '')
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
        self.assertFalse((self.dest / 'xyz3/tool.seed.json').exists())
        ini = (self.dest / profile["ini"]).read_text()
        self.assertIn("WEBUI_TOKEN = private-test-token", ini)
        self.assertIn("MAX_LIMIT = 680", ini)
        self.assertIn('TOOL_LIBRARY_DIR = ~/linuxcnc/nc_files', ini)
        self.assertFalse((self.dest / "lcnc_suite_sim_dmu160p.ini").exists())
        # Neither upgrading nor re-running may transplant old 5-axis tool geometry.
        self.assertEqual((self.dest / "xyzac5/tool.tbl").read_bytes(), (SOURCE / "xyzac5/tool.tbl").read_bytes())
        (self.dest / "xyzac5/sim.var").write_text("local offsets")
        self.assertIsNone(self.install())
        self.assertEqual((self.dest / "xyzac5/sim.var").read_text(), "local offsets")

    def test_upgrade_keeps_existing_table_without_seeding_and_preserves_custom_import_folder(self):
        self.install()
        table = self.dest / 'xyzac5/tool.tbl'
        seed = table.with_suffix('.seed.json')
        seed.unlink()  # Existing installation from before example tools shipped.
        table.write_text('T9 P3 Z-42 D8 ; measured\n')
        ini = self.dest / 'lcnc_suite_sim_5axis_xyzac.ini'
        ini.write_text(ini.read_text().replace('TOOL_LIBRARY_DIR = ~/linuxcnc/nc_files', 'TOOL_LIBRARY_DIR = custom/tools'))
        library = self.dest / 'custom/tools/fusion-freecad.json'
        library.parent.mkdir(parents=True)
        library.write_text('user-owned library')
        self.assertIsNone(self.install())
        self.assertEqual(table.read_text(), 'T9 P3 Z-42 D8 ; measured\n')
        self.assertFalse(seed.exists())
        self.assertIn('TOOL_LIBRARY_DIR = custom/tools', ini.read_text())
        self.assertEqual(library.read_text(), 'user-owned library')

    def test_upgrade_moves_old_library_default_into_nc_files_without_overwriting(self):
        self.install()
        self.library.unlink()
        old_library = self.dest / 'tool-libraries/fusion-freecad.json'
        old_library.parent.mkdir()
        old_library.write_text('operator-edited example library')
        for profile in CATALOG['profiles']:
            ini = self.dest / profile['ini']
            ini.write_text(ini.read_text().replace('TOOL_LIBRARY_DIR = ~/linuxcnc/nc_files',
                                                   'TOOL_LIBRARY_DIR = tool-libraries'))
        self.install()
        self.assertEqual(self.library.read_text(), old_library.read_text())
        self.library.write_text('newer nc_files library')
        self.assertIsNone(self.install())
        self.assertEqual(self.library.read_text(), 'newer nc_files library')
        for profile in CATALOG['profiles']:
            config = installer.values((self.dest / profile['ini']).read_text())
            self.assertEqual(config['DISPLAY', 'TOOL_LIBRARY_DIR'], '~/linuxcnc/nc_files')

    def test_missing_library_folder_uses_custom_program_folder(self):
        self.install()
        ini = self.dest / 'lcnc_suite_sim_5axis_xyzac.ini'
        ini.write_text(ini.read_text().replace('TOOL_LIBRARY_DIR = ~/linuxcnc/nc_files\n', '')
                       .replace('PROGRAM_PREFIX = ~/linuxcnc/nc_files', 'PROGRAM_PREFIX = programs'))
        self.install()
        self.assertEqual(installer.values(ini.read_text())['DISPLAY', 'TOOL_LIBRARY_DIR'], 'programs')
        self.assertEqual((self.dest / 'programs/fusion-freecad.json').read_bytes(), self.library.read_bytes())

    def test_generated_tables_and_geometry_are_reproducible(self):
        spec = importlib.util.spec_from_file_location('tool_seeds', ROOT / 'scripts/build_example_tool_library.py')
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        for rel, content in generator.seeds().items():
            self.assertEqual((SOURCE / rel).read_text(), content, rel)

    def test_upgrade_restores_shared_program_folder_but_keeps_custom_folders(self):
        self.install()
        ini = self.dest / "lcnc_suite_sim_5axis_xyzac.ini"
        correct = ini.read_text()
        for old_prefix in ["xyzac5", "./xyzac5"]:
            with self.subTest(prefix=old_prefix):
                ini.write_text(correct.replace("PROGRAM_PREFIX = ~/linuxcnc/nc_files",
                                               f"PROGRAM_PREFIX = {old_prefix}"))
                self.install()
                self.assertEqual(installer.values(ini.read_text())["DISPLAY", "PROGRAM_PREFIX"],
                                 "~/linuxcnc/nc_files")
        ini.write_text(correct.replace("PROGRAM_PREFIX = ~/linuxcnc/nc_files",
                                       "PROGRAM_PREFIX = ~/my-programs"))
        self.assertIsNone(self.install())
        self.assertEqual(installer.values(ini.read_text())["DISPLAY", "PROGRAM_PREFIX"], "~/my-programs")

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


# 2026-09-27: the XYZAC example moved its Z datum (Z0 = the top of travel, the
# A/C intersection at machine Z -500) and gained M600/M601. An installed INI
# keeps its local limits by design, so an install from before the move is
# MIGRATED once: the Z window, home and kins pin, the RS274NGC entries, and
# the machine-absolute state (G5x Z, G28/G30 Z, the saved joint Z) shift by
# -500 — program zero stays where the operator touched it off.
OLD_XYZAC = (ROOT / "scripts/test_fixtures/xyzac_before_datum_shift.ini").read_text() \
    if (ROOT / "scripts/test_fixtures/xyzac_before_datum_shift.ini").exists() else None


class XyzacDatumMigrationTest(unittest.TestCase):
    NAME = "lcnc_suite_sim_5axis_xyzac.ini"

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.base = Path(tmp.name)
        self.dest = self.base / "configs/examples"
        self.backups = self.base / "backups"
        home = patch.object(installer.Path, "home", return_value=self.base / "home")
        home.start()
        self.addCleanup(home.stop)
        guard = patch.object(installer, "assert_stopped")
        guard.start()
        self.addCleanup(guard.stop)

    def install(self):
        return installer.install(ROOT, self.dest, self.backups)

    def old_install(self):
        """An installation from before the datum move, with an operator's state."""
        self.assertIsNotNone(OLD_XYZAC, "the pre-move XYZAC INI fixture")
        self.install()
        ini = self.dest / self.NAME
        ini.write_text(OLD_XYZAC.replace("MAX_VELOCITY = 100\nMAX_ACCELERATION = 500\nOFFSET_AV_RATIO",
                                         "MAX_VELOCITY = 90\nMAX_ACCELERATION = 500\nOFFSET_AV_RATIO", 1))
        var = self.dest / "xyzac5/sim.var"
        rows = {5161: 1, 5162: 2, 5163: 450, 5181: 3, 5182: 4, 5183: 480, 5211: 0, 5212: 0, 5213: 7,
                5221: 11, 5222: 12, 5223: 280, 5241: 21, 5242: 22, 5243: 300, 5383: 250,
                3100: 10, 3101: 10, 3102: -180, 3010: 180}
        var.write_text("".join(f"{k}\t{v:.6f}\n" for k, v in sorted(rows.items())))
        (self.dest / "xyzac5/position.txt").write_text("\n".join(map(str, [5, 6, 350, 15, 45] + [0] * 11)) + "\n")
        return ini, var

    def params(self, var):
        return {int(k): float(v) for k, v in (line.split() for line in var.read_text().splitlines() if line.strip())}

    def test_an_install_from_before_the_move_is_migrated_once(self):
        ini, var = self.old_install()
        backup = self.install()
        self.assertIsNotNone(backup, "the migration writes, behind a backup")
        config = installer.values(ini.read_text())
        text = ini.read_text()
        self.assertEqual((config["AXIS_Z", "MIN_LIMIT"], config["AXIS_Z", "MAX_LIMIT"]), ("-400", "0"))
        self.assertEqual((config["JOINT_2", "MIN_LIMIT"], config["JOINT_2", "MAX_LIMIT"],
                          config["JOINT_2", "HOME"], config["JOINT_2", "HOME_OFFSET"]), ("-400", "0", "0", "0"))
        self.assertEqual(config["TRAJ", "HOME"], "0 0 0 0 0")
        self.assertIn("setp xyzac-trt-kins.z-rot-point -500", text)
        self.assertNotIn("setp xyzac-trt-kins.z-rot-point 0\n", text)
        for line in ("REMAP = M600 modalgroup=6 ngc=m600", "REMAP = M601 modalgroup=6 ngc=m601",
                     "OWORD_NARGS = 1", "NO_DOWNCASE_OWORD = 1", "ON_ABORT_COMMAND = O<on_abort> call"):
            self.assertIn(line, text)
        self.assertIn("MAX_VELOCITY = 90", text, "a local setting stays")
        p = self.params(var)
        self.assertEqual([p[k] for k in (5223, 5243, 5383, 5163, 5183)], [-220, -200, -250, -50, -20],
                         "machine-absolute Z (G5x, G28, G30) shifts by -500")
        self.assertEqual([p[k] for k in (5221, 5222, 5213)], [11, 12, 7], "X/Y and the relative G92 stay")
        self.assertEqual([p[k] for k in (3100, 3101, 3102)], [150, 0, -300], "the shipped toolsetter default is replaced")
        self.assertEqual(p[3116], 0, "the new run-from-line flag")
        self.assertEqual((self.dest / "xyzac5/position.txt").read_text().split()[:5], ["5", "6", "-150", "15", "45"])
        # Once: a second run changes nothing, nothing shifts twice.
        self.assertIsNone(self.install())
        self.assertEqual(self.params(var)[5223], -220)

    def test_an_operator_toolsetter_position_survives_the_migration(self):
        ini, var = self.old_install()
        var.write_text(var.read_text().replace("3102\t-180.000000", "3102\t-120.000000"))
        self.install()
        self.assertEqual(self.params(var)[3102], -620, "an operator's absolute G53 Z moves with the datum")

    def test_a_current_install_is_left_alone(self):
        self.install()
        var = self.dest / "xyzac5/sim.var"
        before = var.read_text()
        self.assertIsNone(self.install())
        self.assertEqual(var.read_text(), before)

    def test_missing_remaps_and_rs274ngc_entries_are_added_to_any_profile(self):
        self.install()
        ini = self.dest / "lcnc_suite_sim_3axis_xyz.ini"
        ini.write_text(ini.read_text().replace("REMAP=M601 modalgroup=6 ngc=m601\n", "").replace(
            "OWORD_NARGS = 1\n", "OWORD_NARGS = 0\n"))
        self.install()
        text = ini.read_text()
        self.assertRegex(text, r"REMAP\s*=\s*M601 modalgroup=6 ngc=m601", "the template's line, verbatim")
        self.assertEqual(text.count("M600"), 1, "a remap is added once, by its code")
        self.assertIn("OWORD_NARGS = 0", text, "a local value is kept")

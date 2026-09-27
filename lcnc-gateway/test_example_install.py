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


def subprocess_show(rel):
    """A file of the old XYZAC example (git 3e501ed)."""
    import subprocess
    return subprocess.check_output(["git", "show", f"3e501ed:examples/sim_config/{rel}"], cwd=ROOT)


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
        for name in ("assert_stopped", "gateway_running"):
            guard = patch.object(installer, name, return_value=False)
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
        # Inside the old nose window, and below it: the plate is where the TIP
        # touches, so a long tool reaches a plate under the nose's travel.
        for before, after in ((300, -200), (30, -470)):
            with self.subTest(before=before):
                ini, var = self.old_install()
                var.write_text(var.read_text().replace("3102\t-180.000000", f"3102\t{before:.6f}"))
                self.install()
                p = self.params(var)
                self.assertEqual(p[3102], after, "an operator's absolute G53 Z moves with the datum")
                self.assertEqual((p[3100], p[3101]), (10, 10), "and its X/Y stay")

    def test_zeros_without_a_webui_section_are_kept_at_their_point(self):
        # Codex R16, XZ-03 rest: 0/0/0 with no toolsetter section in the
        # WebUI is AMBIGUOUS — the WebUI's old fallback push, or a position
        # set in the var file or the interpreter directly (M600 reads it
        # either way). The installer cannot tell them apart, so it keeps the
        # physical point (Z moves with the datum) and says what to check —
        # never a silent move to the template's 150/0/-300.
        ini, var = self.old_install()
        text = var.read_text()
        for row in ("3100\t10.000000", "3101\t10.000000", "3102\t-180.000000"):
            text = text.replace(row, row.split("\t")[0] + "\t0.000000")
        var.write_text(text.replace("5183\t480.000000", "5183\t473.725000"))
        report = []
        installer.install(ROOT, self.dest, self.backups, report=report)
        p = self.params(var)
        self.assertEqual([p[k] for k in (3100, 3101, 3102)], [0, 0, -500], "the same physical point")
        self.assertTrue(any("#3100" in line and "Probing › Toolsetter" in line for line in report), report)
        self.assertAlmostEqual(p[5183], -26.275, places=6)
        self.assertEqual(p[5223], -220)
        self.assertIsNone(self.install(), "once")

    def test_the_old_examples_unchanged_toolsetter_is_replaced_and_said(self):
        # 10/10/-180 is the old example's shipped triple (git 3e501ed), below
        # the old Z travel — never a position anyone set up. Replaced by the
        # template's, not silently.
        ini, var = self.old_install()
        self.assertEqual([self.params(var)[n] for n in (3100, 3101, 3102)], [10, 10, -180])
        report = []
        installer.install(ROOT, self.dest, self.backups, report=report)
        self.assertEqual([self.params(var)[n] for n in (3100, 3101, 3102)], [150, 0, -300])
        self.assertTrue(any("#3100" in line and "150/0/-300" in line for line in report), report)

    def test_xz09_fresh_state_files_start_inside_the_kept_local_z_window(self):
        # Codex R16, XZ-09: a consistent old INI with a lowered top (480)
        # keeps its window (-400..-20 after the shift, XZ-04), but sim.var
        # and position.txt are missing — the template's seeds say "home" and
        # "top of travel" as 0, outside that window. A fresh file starts at
        # the LOCAL home and top instead; nothing else of the seed changes.
        def lowered(text):
            text = text.replace("MAX_LIMIT = 500", "MAX_LIMIT = 480")
            text = text.replace("HOME = 500", "HOME = 480").replace("HOME_OFFSET = 500", "HOME_OFFSET = 480")
            return text.replace("HOME = 0 0 500 0 0", "HOME = 0 0 480 0 0")
        cases = {"migrated": lambda: self.old_install()[0],
                 "current datum": lambda: self.install() or self.dest / self.NAME}
        for case, prepare in cases.items():
            with self.subTest(case=case):
                ini = prepare()
                if case == "migrated":
                    ini.write_text(lowered(ini.read_text()))
                else:
                    text = ini.read_text().replace("MAX_LIMIT = 0\n", "MAX_LIMIT = -20\n")
                    text = text.replace("\nHOME = 0\nHOME_OFFSET = 0\nHOME_SEARCH_VEL = 0\nHOME_LATCH_VEL = 0\nHOME_SEQUENCE = 0",
                                        "\nHOME = -20\nHOME_OFFSET = -20\nHOME_SEARCH_VEL = 0\nHOME_LATCH_VEL = 0\nHOME_SEQUENCE = 0")
                    ini.write_text(text.replace("HOME = 0 0 0 0 0", "HOME = 0 0 -20 0 0"))
                for name in ("sim.var", "position.txt"):
                    (self.dest / "xyzac5" / name).unlink()
                report = []
                installer.install(ROOT, self.dest, self.backups, report=report)
                config = installer.values(ini.read_text())
                self.assertEqual((config["JOINT_2", "MAX_LIMIT"], config["JOINT_2", "HOME"]), ("-20", "-20"))
                p = self.params(self.dest / "xyzac5/sim.var")
                self.assertEqual((p[5163], p[5183]), (-20, -20), "G28/G30 Z at the local top of travel")
                self.assertEqual((p[5223], p[3102], p[5161], p[5181]), (-500, -300, 0, 0),
                                 "G54 and the setter stay the template's; X/Y stay")
                z = float((self.dest / "xyzac5/position.txt").read_text().split()[2])
                self.assertEqual(z, -20, "the joint starts at the local home")
                self.assertTrue(any("position.txt" in line for line in report)
                                and any("G28/G30" in line for line in report), report)
                self.assertIsNone(self.install(), "and a second run changes nothing")

    def test_the_template_seeds_are_home_and_top_of_travel(self):
        # XZ-09 maps the seeds by meaning: this pins what they mean.
        ini = installer.values((SOURCE / self.NAME).read_text())
        var = {int(k): float(v) for k, v in (l.split() for l in (SOURCE / "xyzac5/sim.var").read_text().splitlines() if l.strip())}
        position = (SOURCE / "xyzac5/position.txt").read_text().split()
        self.assertEqual(float(position[2]), float(ini["JOINT_2", "HOME"]))
        self.assertEqual((var[5163], var[5183]), (float(ini["AXIS_Z", "MAX_LIMIT"]),) * 2)

    # ---- Codex review R15 (XZ-01..05): each red on the first migration ----
    OLD_DEMO_SHA = "0e65cc15c6d767ff7e00c3eabc2e136636f880aea997a6c971beb61943174581"

    def old_template_state(self):
        """The old example's own files, unchanged (git 3e501ed) — the operator's
        real starting point, where Codex's probe found XZ-01/05."""
        import subprocess
        show = lambda rel: subprocess.check_output(
            ["git", "show", f"3e501ed:examples/sim_config/{rel}"], cwd=ROOT, text=True)
        self.install()
        (self.dest / self.NAME).write_text(OLD_XYZAC)
        for rel in ("xyzac5/sim.var", "xyzac5/position.txt", "xyzac5/demo.ngc"):
            (self.dest / rel).write_text(show(rel))

    def settings(self, sections):
        path = self.base / "settings.json"
        path.write_text(json.dumps(sections) + "\n")
        return path

    def test_xz01_an_unreachable_g28_g30_becomes_the_top_of_travel(self):
        # G28/G30 are positions of the controlled point without the tool
        # offset (live: G43 H1003 = 46.953 active, G30 still lands on joint Z
        # -26.275). A stored Z outside the old [AXIS_Z] window was never a
        # reachable target; shifted it stays one (the old default 0 -> -500).
        self.old_template_state()
        self.install()
        p = self.params(self.dest / "xyzac5/sim.var")
        self.assertEqual((p[5163], p[5183]), (0, 0), "the top of travel, the new window's MAX_LIMIT")
        self.assertEqual((p[5161], p[5162], p[5181], p[5182]), (0, 0, 0, 0), "X/Y stay")
        # A custom window: the top of travel is that window's top.
        ini, var = self.old_install()
        ini.write_text(ini.read_text().replace("MAX_LIMIT = 500", "MAX_LIMIT = 480"))
        var.write_text(var.read_text().replace("5163\t450.000000", "5163\t0.000000"))
        self.install()
        p = self.params(var)
        self.assertEqual((p[5163], p[5183]), (-20, -20), "unreachable -> top (-20); 480 -> -20 by the shift")

    def test_xz02_a_state_file_seeded_from_the_new_template_is_not_shifted_again(self):
        for missing in (("sim.var",), ("position.txt",), ("sim.var", "position.txt")):
            with self.subTest(missing=missing):
                self.old_template_state()
                for name in missing:
                    (self.dest / "xyzac5" / name).unlink()
                self.install()
                p = self.params(self.dest / "xyzac5/sim.var")
                self.assertEqual((p[5223], p[3102]), (-500, -300), "G54 at the A/C intersection, the template's setter")
                z = float((self.dest / "xyzac5/position.txt").read_text().split()[2])
                self.assertEqual(z, 0, "the saved joint Z inside -400..0")
                self.assertIsNone(self.install(), "and a second run changes nothing")

    def test_xz03_the_saved_webui_toolsetter_moves_with_the_var_file(self):
        ini, var = self.old_install()
        var.write_text(var.read_text().replace("3102\t-180.000000", "3102\t300.000000"))
        other = str(self.dest / "lcnc_suite_sim_3axis_xyz.ini")
        section = {"touchX": 10, "touchY": 10, "touchZ": 300, "spindleZeroHeight": 180, "fastFeed": 200}
        path = self.settings({str(ini): {"toolsetter": dict(section), "viewer": {"paletteMode": "auto"}},
                              other: {"toolsetter": dict(section)}})
        backup = installer.install(ROOT, self.dest, self.backups, settings_path=path)
        saved = json.loads(path.read_text())
        self.assertEqual(saved[str(ini)]["toolsetter"]["touchZ"], -200, "the WebUI's copy moves with #3102")
        self.assertEqual(self.params(var)[3102], -200)
        self.assertEqual(saved[str(ini)]["toolsetter"]["spindleZeroHeight"], 180, "a distance stays")
        self.assertEqual(saved[str(ini)]["viewer"], {"paletteMode": "auto"}, "other sections stay")
        self.assertEqual(saved[other]["toolsetter"]["touchZ"], 300, "another INI stays")
        self.assertEqual(json.loads((backup / "settings.json").read_text())[str(ini)]["toolsetter"]["touchZ"], 300,
                         "the settings are in the backup")
        self.assertIsNone(installer.install(ROOT, self.dest, self.backups, settings_path=path))
        self.assertEqual(json.loads(path.read_text())[str(ini)]["toolsetter"]["touchZ"], -200, "once")

    def test_xz03_a_saved_setter_is_the_operators_even_at_the_fallback_numbers(self):
        # Provenance, not numbers: a section that saved touchZ made the var
        # file's triple — 0/0/0 there is the operator's, and moves.
        ini, var = self.old_install()
        text = var.read_text()
        for row in ("3100\t10.000000", "3101\t10.000000", "3102\t-180.000000"):
            text = text.replace(row, row.split("\t")[0] + "\t0.000000")
        var.write_text(text)
        path = self.settings({str(ini): {"toolsetter": {"touchX": 0, "touchY": 0, "touchZ": 0}}})
        installer.install(ROOT, self.dest, self.backups, settings_path=path)
        self.assertEqual([self.params(var)[n] for n in (3100, 3101, 3102)], [0, 0, -500])
        self.assertEqual(json.loads(path.read_text())[str(ini)]["toolsetter"]["touchZ"], -500)

    def test_xz03_a_running_gateway_refuses_the_settings_write(self):
        # It caches settings.json and would write its old copy back.
        ini, var = self.old_install()
        path = self.settings({str(ini): {"toolsetter": {"touchZ": 300}}})
        before = path.read_bytes(), var.read_bytes()
        with patch.object(installer, "gateway_running", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "gateway"):
                installer.install(ROOT, self.dest, self.backups, settings_path=path)
        self.assertEqual((path.read_bytes(), var.read_bytes()), before, "nothing written")

    def test_xz04_the_datum_is_the_kins_rotation_point_not_the_machine_name(self):
        ini, var = self.old_install()
        ini.write_text(ini.read_text().replace("MACHINE = 5 Axis XYZAC", "MACHINE = Operator XYZAC"))
        self.install()
        self.assertEqual(self.params(var)[5223], -220, "migrated on the FIRST run")
        self.assertIn("setp xyzac-trt-kins.z-rot-point -500", ini.read_text())
        self.assertIsNone(self.install(), "once")

    def test_xz04_local_absolute_z_values_shift_instead_of_taking_the_template(self):
        ini, var = self.old_install()
        text = ini.read_text()
        text = text.replace("MIN_LIMIT = 100", "MIN_LIMIT = 150").replace("MAX_LIMIT = 500", "MAX_LIMIT = 480")
        text = text.replace("HOME = 500", "HOME = 480").replace("HOME_OFFSET = 500", "HOME_OFFSET = 480")
        text = text.replace("HOME = 0 0 500 0 0", "HOME = 0 0 480 0 0")
        text = text.replace("setp xyzac-trt-kins.z-rot-point 0", "setp xyzac-trt-kins.z-rot-point 0.0")
        ini.write_text(text)
        self.install()
        config = installer.values(ini.read_text())
        for section in ("AXIS_Z", "JOINT_2"):
            self.assertEqual((config[section, "MIN_LIMIT"], config[section, "MAX_LIMIT"]), ("-350", "-20"),
                             "a restricted window stays restricted — never widened to the template's")
        self.assertEqual((config["JOINT_2", "HOME"], config["JOINT_2", "HOME_OFFSET"]), ("-20", "-20"))
        self.assertEqual(config["TRAJ", "HOME"], "0 0 -20 0 0")
        self.assertIn("setp xyzac-trt-kins.z-rot-point -500", ini.read_text())
        self.assertIsNone(self.install(), "once")

    def test_xz04_an_unknown_rotation_point_is_refused_before_anything_is_written(self):
        ini, var = self.old_install()
        ini.write_text(ini.read_text().replace("setp xyzac-trt-kins.z-rot-point 0", "setp xyzac-trt-kins.z-rot-point -250"))
        before = {p: p.read_bytes() for p in self.dest.rglob("*") if p.is_file() and not p.is_symlink()}
        with self.assertRaisesRegex(ValueError, "z-rot-point"):
            self.install()
        after = {p: p.read_bytes() for p in self.dest.rglob("*") if p.is_file() and not p.is_symlink()}
        self.assertEqual(after, before, "nothing written")
        self.assertFalse(self.backups.exists() and any(self.backups.iterdir()), "no backup either")

    def test_xz05_the_unchanged_old_demo_is_updated_an_edited_one_kept_beside_the_new(self):
        import hashlib
        self.old_template_state()
        demo = self.dest / "xyzac5/demo.ngc"
        self.assertEqual(hashlib.sha256(demo.read_bytes()).hexdigest(), self.OLD_DEMO_SHA)
        self.install()
        self.assertEqual(demo.read_bytes(), (SOURCE / "xyzac5/demo.ngc").read_bytes(), "the unchanged shipped demo")
        self.assertNotIn("G53 G0 Z500", demo.read_text())
        # Edited locally: kept, the current one beside it, the operator told.
        self.old_template_state()
        demo.write_text(demo.read_text() + "(my edit)\n")
        report = []
        installer.install(ROOT, self.dest, self.backups, report=report)
        self.assertTrue(demo.read_text().endswith("(my edit)\n"), "an edited program stays")
        self.assertEqual((self.dest / "xyzac5/demo.new.ngc").read_bytes(), (SOURCE / "xyzac5/demo.ngc").read_bytes())
        self.assertTrue(any("demo.new.ngc" in line for line in report), report)
        # An already migrated install still carrying the old demo (the
        # operator's, 2026-09-27) gets the current one too.
        self.install()
        demo.write_bytes(subprocess_show("xyzac5/demo.ngc"))
        self.install()
        self.assertEqual(demo.read_bytes(), (SOURCE / "xyzac5/demo.ngc").read_bytes())

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

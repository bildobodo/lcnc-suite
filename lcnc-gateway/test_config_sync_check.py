"""config_sync_check's drift: a line that only moved inside its INI section
is no drift (the installer adds a missing suite key at the section's start,
the template has it further down — the operator's first check after an
install read "3 files drifted" for identical lines); a key LinuxCNC reads in
order, a change of section, a real difference and a .hal file still are."""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
csc = importlib.import_module("config_sync_check")

REPO = """[DISPLAY]
DISPLAY = lcnc-suite
PROGRAM_PREFIX = ~/linuxcnc/nc_files
WEBUI_MACRO_DIR = ~/linuxcnc/macros

[HAL]
HALFILE = a.hal
HALFILE = b.hal

[RS274NGC]
REMAP = M600 modalgroup=6 ngc=m600
"""


class TestDrift(unittest.TestCase):
    def drift(self, deployed, repo=REPO, ini=True):
        missing, local = csc.drifted_lines(repo, deployed, ini=ini)
        return [ln for _, ln in missing], [ln for _, ln in local]

    def test_a_key_moved_inside_its_section_is_no_drift(self):
        deployed = REPO.replace("DISPLAY = lcnc-suite\nPROGRAM_PREFIX = ~/linuxcnc/nc_files\nWEBUI_MACRO_DIR = ~/linuxcnc/macros",
                                "WEBUI_MACRO_DIR = ~/linuxcnc/macros\nDISPLAY = lcnc-suite\nPROGRAM_PREFIX = ~/linuxcnc/nc_files")
        self.assertNotEqual(deployed, REPO)
        self.assertEqual(self.drift(deployed), ([], []))

    def test_a_moved_halfile_still_is_drift(self):
        deployed = REPO.replace("HALFILE = a.hal\nHALFILE = b.hal", "HALFILE = b.hal\nHALFILE = a.hal")
        missing, local = self.drift(deployed)
        self.assertTrue(missing and local, "HAL files load in order")

    def test_a_key_in_another_section_is_drift(self):
        deployed = REPO.replace("WEBUI_MACRO_DIR = ~/linuxcnc/macros\n", "").replace(
            "[RS274NGC]\n", "[RS274NGC]\nWEBUI_MACRO_DIR = ~/linuxcnc/macros\n")
        self.assertEqual(self.drift(deployed), (["WEBUI_MACRO_DIR = ~/linuxcnc/macros"], ["WEBUI_MACRO_DIR = ~/linuxcnc/macros"]))

    def test_a_missing_line_and_a_changed_value_stay_drift(self):
        deployed = REPO.replace("REMAP = M600 modalgroup=6 ngc=m600\n", "").replace(
            "PROGRAM_PREFIX = ~/linuxcnc/nc_files", "PROGRAM_PREFIX = ~/elsewhere")
        missing, local = self.drift(deployed)
        self.assertIn("REMAP = M600 modalgroup=6 ngc=m600", missing)
        self.assertIn("PROGRAM_PREFIX = ~/linuxcnc/nc_files", missing)
        self.assertEqual(local, ["PROGRAM_PREFIX = ~/elsewhere"])

    def test_a_repeated_key_is_read_in_order(self):
        # Codex R70 VP-I34, with linuxcnc.ini: the FIRST occurrence wins —
        # these two read 10 and 20
        repo = "[JOINT_0]\nMAX_VELOCITY = 10\nMAX_VELOCITY = 20\n"
        deployed = "[JOINT_0]\nMAX_VELOCITY = 20\nMAX_VELOCITY = 10\n"
        missing, local = self.drift(deployed, repo=repo)
        self.assertTrue(missing and local)

    def test_a_key_moved_between_two_blocks_of_one_section_is_drift(self):
        # only the FIRST block of a repeated [SECTION] is read (measured: a
        # key in the second [A] block reads None)
        repo = "[A]\nX = 1\nW = 5\n[B]\nY = 2\n[A]\nZ = 3\n"
        deployed = "[A]\nX = 1\n[B]\nY = 2\n[A]\nZ = 3\nW = 5\n"
        missing, local = self.drift(deployed, repo=repo)
        self.assertTrue(missing and local)
        # a key that occurs ONCE in a section that occurs once still moves freely
        repo = "[A]\nX = 1\nW = 5\nV = 7\n[B]\nY = 2\n"
        self.assertEqual(self.drift("[A]\nV = 7\nX = 1\nW = 5\n[B]\nY = 2\n", repo=repo), ([], []))

    def test_repeated_keys_move_when_linuxcnc_reads_the_same(self):
        # a repeated key moves freely while its values keep their order
        repo = "[DISPLAY]\nA = 1\nUSER = x\nUSER = y\n"
        self.assertEqual(self.drift("[DISPLAY]\nUSER = x\nUSER = y\nA = 1\n", repo=repo), ([], []))
        missing, local = self.drift("[DISPLAY]\nUSER = y\nUSER = x\nA = 1\n", repo=repo)
        self.assertTrue(missing and local, "their order changed: compared in order")
        # REMAP lines are a table keyed by their code — the installer put the
        # suite's at the section's start (the installed XYZAC INI): no drift
        repo = "[RS274NGC]\nREMAP = M428 ngc=428remap\nREMAP = M429 ngc=429remap\nREMAP = M600 ngc=m600\n"
        deployed = "[RS274NGC]\nREMAP = M600 ngc=m600\nREMAP = M428 ngc=428remap\nREMAP = M429 ngc=429remap\n"
        self.assertEqual(self.drift(deployed, repo=repo), ([], []))
        # one code twice: the first line wins, the second is an error — in order
        repo2 = repo + "REMAP = M600 ngc=other\n"
        deployed2 = "[RS274NGC]\nREMAP = M600 ngc=other\n" + repo.split("\n", 1)[1]
        missing, local = self.drift(deployed2, repo=repo2)
        self.assertTrue(missing and local)

    def test_a_hal_file_is_compared_in_order(self):
        repo = "loadrt a\nloadrt b\naddf a servo-thread\n"
        deployed = "loadrt b\nloadrt a\naddf a servo-thread\n"
        missing, local = self.drift(deployed, repo=repo, ini=False)
        self.assertTrue(missing and local)


if __name__ == "__main__":
    unittest.main()

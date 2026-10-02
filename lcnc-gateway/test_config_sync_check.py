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

    def test_a_hal_file_is_compared_in_order(self):
        repo = "loadrt a\nloadrt b\naddf a servo-thread\n"
        deployed = "loadrt b\nloadrt a\naddf a servo-thread\n"
        missing, local = self.drift(deployed, repo=repo, ini=False)
        self.assertTrue(missing and local)


if __name__ == "__main__":
    unittest.main()

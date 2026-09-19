"""Program browsing must use the configured NC folder, not machine state."""
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import fake_linuxcnc
fake_linuxcnc.install()
import gateway


class ProgramFilesTest(unittest.TestCase):
    def test_browse_configured_relative_absolute_and_home_folders(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            config = base / "config"
            config.mkdir()
            # Include the misleading old 5-axis state files in a different
            # folder so a wrong root cannot pass merely by returning files.
            (config / "position.txt").write_text("0\n")
            (config / "demo.ngc").write_text("M2\n")
            for prefix, folder in [("programs", config / "programs"),
                                   (str(base / "absolute"), base / "absolute"),
                                   ("~/custom-programs", base / "custom-programs"),
                                   (None, base / "linuxcnc/nc_files")]:
                with self.subTest(prefix=prefix):
                    folder.mkdir(parents=True)
                    (folder / "perfmatrix-big.ngc").write_text("M2\n")
                    (folder / "twp-demo.ngc").write_text("M2\n")
                    (folder / "nested").mkdir()
                    ini = SimpleNamespace(find=lambda *_: prefix)
                    with patch.dict(os.environ, {"HOME": str(base), "LCNC_INI_FILE": str(config / "machine.ini")}), \
                            patch.object(gateway.linuxcnc, "ini", return_value=ini), \
                            patch.object(gateway, "_nc_files_dir", None), \
                            patch.object(gateway, "_nc_files_ini", None):
                        listing = gateway.list_files()
                        self.assertEqual(listing["nc_dir"], str(folder))
                        self.assertEqual([entry["name"] for entry in listing["entries"]],
                                         ["nested", "perfmatrix-big.ngc", "twp-demo.ngc"])
                        self.assertTrue(all(Path(entry["path"]).is_file()
                                            for entry in listing["entries"] if entry["type"] == "file"))

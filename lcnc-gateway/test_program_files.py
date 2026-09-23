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

    def test_listing_offers_only_what_opening_allows(self):
        # UI-K15: links whose target lies outside the program folder are not
        # listed (they could only be refused on the way in); real subfolders
        # and links that stay inside are listed and open.
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            nc = base / "nc_files"
            outside = base / "outside"
            (nc / "real").mkdir(parents=True)
            (nc / "real" / "inner.ngc").write_text("M2\n")
            outside.mkdir()
            (outside / "lib").mkdir()
            (outside / "lib" / "far.ngc").write_text("M2\n")
            (outside / "far.ngc").write_text("M2\n")
            (nc / "examples").symlink_to(outside / "lib", target_is_directory=True)
            (nc / "far-link.ngc").symlink_to(outside / "far.ngc")
            (nc / "inside-link").symlink_to(nc / "real", target_is_directory=True)
            (nc / "top.ngc").write_text("M2\n")
            with patch.object(gateway, "get_nc_files_dir", return_value=str(nc)):
                listing = gateway.list_files()
                self.assertEqual([(e["name"], e["type"]) for e in listing["entries"]],
                                 [("inside-link", "directory"), ("real", "directory"), ("top.ngc", "file")])
                for entry in listing["entries"]:
                    if entry["type"] == "directory":
                        opened = gateway.list_files(entry["path"])
                        self.assertEqual([e["name"] for e in opened["entries"]], ["inner.ngc"])
                for refused in ["examples", "../outside", str(outside)]:
                    with self.subTest(subdir=refused):
                        with self.assertRaises(gateway.HTTPException) as ctx:
                            gateway.list_files(refused)
                        self.assertEqual(ctx.exception.status_code, 400)


"""venv_check.py: numpy in the gateway venv must be the system's (#12, #42).

The predicate is tested with injected paths; the command line against a
throwaway venv (no pip, no network) whose shadowing numpy and the package
that "pulled" it are fakes written into its site-packages.
"""
import os
import subprocess
import sys
import tempfile
import unittest

import venv_check


class NumpyProblemTest(unittest.TestCase):
    VENV = "/opt/suite/lcnc-gateway/.venv"

    def test_system_numpy_in_a_venv_is_fine(self):
        self.assertIsNone(venv_check.numpy_problem(
            "/usr/lib/python3/dist-packages/numpy/__init__.py", self.VENV, "/usr"))

    def test_numpy_inside_the_venv_shadows(self):
        problem = venv_check.numpy_problem(
            self.VENV + "/lib/python3.11/site-packages/numpy/__init__.py",
            self.VENV, "/usr")
        self.assertIn("IN the venv", problem)

    def test_a_sibling_directory_is_not_the_venv(self):
        self.assertIsNone(venv_check.numpy_problem(
            self.VENV + "2/lib/python3.11/site-packages/numpy/__init__.py",
            self.VENV, "/usr"))

    def test_numpy_not_importable(self):
        self.assertIn("not importable",
                      venv_check.numpy_problem(None, self.VENV, "/usr"))

    def test_not_a_venv_never_passes(self):
        self.assertIn("not a venv", venv_check.numpy_problem(
            "/usr/lib/python3/dist-packages/numpy/__init__.py", "/usr", "/usr"))

    def test_a_venv_reached_through_a_link_still_shadows(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = os.path.join(tmp, "real-venv")
            os.makedirs(os.path.join(real, "lib", "numpy"))
            link = os.path.join(tmp, "venv")
            os.symlink(real, link)
            problem = venv_check.numpy_problem(
                os.path.join(real, "lib", "numpy", "__init__.py"), link, "/usr")
            self.assertIn("IN the venv", problem)


class RequiresNumpyTest(unittest.TestCase):
    def test_requirement_lines_naming_numpy(self):
        for line in ("numpy", "numpy>=2", 'numpy>=2; python_version >= "3.9"',
                     "numpy (>=1.13)", "NumPy<2.3.0,>=2", "numpy [extra]",
                     "numpy @ https://example.org/numpy.whl"):
            self.assertTrue(venv_check.requires_numpy([line]), line)

    def test_other_packages_do_not_count(self):
        self.assertFalse(venv_check.requires_numpy(
            ["numpydoc>=1", "numpy-financial", "scipy>=1.10"]))
        self.assertFalse(venv_check.requires_numpy(None))


class CommandLineTest(unittest.TestCase):
    """The script run by the throwaway venv's python, as install.sh runs it."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.venv = os.path.join(cls.tmp.name, "venv")
        subprocess.run([sys.executable, "-m", "venv", "--system-site-packages",
                        "--without-pip", cls.venv], check=True)
        cls.python = os.path.join(cls.venv, "bin", "python3")
        cls.site = subprocess.run(
            [cls.python, "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"],
            check=True, capture_output=True, text=True).stdout.strip()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def run_check(self):
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "venv_check.py")
        return subprocess.run([self.python, script], capture_output=True, text=True)

    def write(self, rel, text):
        path = os.path.join(self.site, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)

    def test_system_numpy_passes_then_a_venv_copy_fails_naming_its_users(self):
        base_has_numpy = subprocess.run(
            [self.python, "-c", "import numpy"], capture_output=True).returncode == 0
        if base_has_numpy:
            ok = self.run_check()
            self.assertEqual(ok.returncode, 0, ok.stderr)
            self.assertIn("OK: numpy", ok.stdout)
        self.write("numpy/__init__.py", '__version__ = "9.9.9"\n')
        self.write("opencv_python_headless-4.13.0.92.dist-info/METADATA",
                   "Metadata-Version: 2.1\nName: opencv-python-headless\n"
                   "Version: 4.13.0.92\n"
                   'Requires-Dist: numpy>=2; python_version >= "3.9"\n')
        bad = self.run_check()
        self.assertEqual(bad.returncode, 1, bad.stdout)
        self.assertIn("IN the venv", bad.stderr)
        self.assertIn("venv packages requiring numpy: opencv-python-headless 4.13.0.92",
                      bad.stderr)
        self.assertIn("pip uninstall -y numpy", bad.stderr)


if __name__ == "__main__":
    unittest.main()

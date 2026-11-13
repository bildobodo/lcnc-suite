"""F1 / P2.1: the var-file path resolution is memoized by INI filename so the INI
is not re-parsed (linuxcnc.ini) on every 30 Hz poll. These tests pin that the parse
happens once per INI, re-resolves when the filename changes, and is not poisoned by
a transient resolve failure."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import fake_linuxcnc  # noqa: E402

linuxcnc = fake_linuxcnc.install()  # MUST precede `import gateway`
import gateway  # noqa: E402
from link_fixture import use  # noqa: E402


class _Stat:
    def __init__(self, ini_filename):
        self.ini_filename = ini_filename


class TestVarFilePathCache(unittest.TestCase):
    def setUp(self):
        gateway._var_file_path_cache_key = None
        gateway._var_file_path_cache_val = None
        self._orig_ini = gateway.linuxcnc.ini
        self.calls = {"n": 0}
        test = self

        class _CountingIni:
            def __init__(self, path):
                test.calls["n"] += 1

            def find(self, section, key):
                if section == "RS274NGC" and key == "PARAMETER_FILE":
                    return "sim.var"
                return None

        self._counting_ini = _CountingIni
        gateway.linuxcnc.ini = _CountingIni

    def tearDown(self):
        gateway.linuxcnc.ini = self._orig_ini
        gateway._var_file_path_cache_key = None
        gateway._var_file_path_cache_val = None

    def test_parses_ini_once_for_same_filename(self):
        use(self, stat=_Stat("/cfg/machine.ini"))
        p1 = gateway._resolve_var_file_path()
        p2 = gateway._resolve_var_file_path()
        p3 = gateway._resolve_var_file_path()
        self.assertEqual(p1, os.path.join("/cfg", "sim.var"))  # relative → joined to INI dir
        self.assertEqual(p1, p2)
        self.assertEqual(p2, p3)
        self.assertEqual(self.calls["n"], 1)  # parsed ONCE despite 3 resolves

    def test_reresolves_when_ini_filename_changes(self):
        use(self, stat=_Stat("/cfg/a.ini"))
        gateway._resolve_var_file_path()
        use(self, stat=_Stat("/cfg/b.ini"))
        r = gateway._resolve_var_file_path()
        self.assertEqual(r, os.path.join("/cfg", "sim.var"))
        self.assertEqual(self.calls["n"], 2)  # cache miss on filename change

    def test_transient_failure_is_not_cached(self):
        use(self, stat=_Stat("/cfg/m.ini"))

        def _raise(_path):
            raise RuntimeError("NML hiccup")

        gateway.linuxcnc.ini = _raise
        self.assertIsNone(gateway._resolve_var_file_path())
        self.assertIsNone(gateway._var_file_path_cache_key)  # not poisoned

        gateway.linuxcnc.ini = self._counting_ini  # recovers
        self.assertEqual(gateway._resolve_var_file_path(), os.path.join("/cfg", "sim.var"))
        self.assertEqual(self.calls["n"], 1)  # retried after the transient failure


if __name__ == "__main__":
    unittest.main()

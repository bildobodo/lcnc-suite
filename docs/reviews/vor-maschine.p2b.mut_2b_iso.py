"""Package 2b after the CI finding (999a8ca9: eight backend tests red on CI,
green on the dev box): counter-cases for the test-session guards. Each
mutation edits a COPY of the tree, runs the named test files with pytest
(LCNC_NO_BINDING=1, as CI) and expects red or green; every file restored.

  1. conftest without the host /proc isolation -> the standing test is red,
     and without the host NML stub -> red (only while a LinuxCNC runs on
     this host: checked first);
  2. a WS endpoint test that connects (pid and NML patched) without its
     restore -> the leak guard errors;
  3. the same with the leak guard's raise removed -> green (the control:
     the guard is what turns it red);
  4. a writer test without its own connection -> red (armed_writer);
  5. the toolsetter test without its own connection -> red.

usage: <venv python> mut_2b_iso.py <tree>"""
import os
import subprocess
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
GW = TREE / "lcnc-gateway"
results = []


def pytest(files):
    env = dict(os.environ, LCNC_NO_BINDING="1")
    return subprocess.run([sys.executable, "-m", "pytest", "-p", "no:cacheprovider", "-o", "addopts=", "-q", *files],
                          cwd=GW, capture_output=True, text=True, timeout=600, env=env)


def mutate(edits, files, name, want_red=True):
    origs = {p: p.read_text() for p, _, _ in edits}
    try:
        for p, old, new in edits:
            s = p.read_text()
            assert s.count(old) == 1, (name, p.name, old[:60])
            p.write_text(s.replace(old, new))
        r = pytest(files)
        red = r.returncode != 0
        good = red == want_red
        tail = [ln for ln in r.stdout.splitlines() if ln and not ln.startswith("[GC]")][-1:]
        print(f"{'RED  ' if red else 'GREEN'}{'' if good else '  <-- UNEXPECTED'} {name}  [{' '.join(tail)}]", flush=True)
        results.append(good)
    finally:
        for p, s in origs.items():
            p.write_text(s)


ALL = ["test_link_ownership.py", "test_ws_smoke.py", "test_tool_refresh.py", "test_toolsetter_sync.py"]
base = pytest(ALL)
print("baseline", "green" if base.returncode == 0 else "RED\n" + base.stdout[-3000:], flush=True)
host = subprocess.run(["pgrep", "-x", "linuxcncsvr"], capture_output=True, text=True).stdout.split()
print("host linuxcncsvr:", host or "none (mutation 1 cannot be red here)", flush=True)

C = GW / "conftest.py"
mutate([(C, "session_bind.discover_instance = _no_host_instance\n", "")],
       ["test_link_ownership.py"], "conftest: the host's /proc discovered again", want_red=bool(host))
mutate([(C, "        gw._nml_connectable = _host_nml_unreachable\n", "")],
       ["test_link_ownership.py"], "conftest: the host's NML asked again", want_red=bool(host))
R = "        link_fixture.restore_after(self)   # the endpoint connects (pid and NML patched): the Link restored after the test\n"
mutate([(GW / "test_ws_smoke.py", R, "")],
       ["test_ws_smoke.py"], "a WS endpoint test leaves its Link (the leak guard)")
mutate([(GW / "test_ws_smoke.py", R, ""),
        (C, "        raise AssertionError(f\"the test left the gateway's connection changed", "        pass  # (f\"the test left the gateway's connection changed")],
       ["test_ws_smoke.py"], "control: the same leak without the guard's raise", want_red=False)
mutate([(GW / "test_tool_refresh.py", "        connect_fake(self)\n        self.conn_key = armed_writer(self)\n",
         "        self.conn_key = armed_writer(self)\n")],
       ["test_tool_refresh.py"], "a writer test without its own connection")
mutate([(GW / "test_toolsetter_sync.py", "        import os\n        connect_fake(self)\n", "        import os\n")],
       ["test_toolsetter_sync.py"], "the toolsetter test without its own connection")

print(f"{sum(results)}/{len(results)} as expected", "— ALL AS EXPECTED" if all(results) else "— SOME UNEXPECTED", flush=True)
sys.exit(0 if all(results) else 1)

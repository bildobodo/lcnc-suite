"""Package 2a counter-cases (Codex R350/R352: a counter-case before each
module is adopted): for every module the type check covers, one injected type
error must turn the REAL gate step (scripts/run_pyright.py) red AT that file;
plus the conformance mutations (fake / stub / interface). Each file restored
after its run. usage: <venv python> mut_modules.py <tree>"""
import json
import subprocess
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
cfg = json.loads((TREE / "pyrightconfig.json").read_text())
excluded = {"gateway.py", "conftest.py", "writer_fixture.py", "suite_py_bind_probe.py"}
mods = sorted(p for p in (TREE / "lcnc-gateway").glob("*.py")
              if not p.name.startswith("test_") and p.name not in excluded and not p.name.startswith("native_"))
mods.append(TREE / "subroutines/surfacemap/compensation.py")


def run():
    return subprocess.run([sys.executable, str(TREE / "scripts/run_pyright.py")], cwd=TREE,
                          capture_output=True, text=True, timeout=600)


def mutate(path, old, new, name):
    orig = path.read_text()
    assert old in orig if old else True, (name, old)
    try:
        path.write_text(orig.replace(old, new, 1) if old else orig + new)
        r = run()
        red = r.returncode != 0 and str(path) in r.stdout
        print(f"{'RED ' if red else 'GREEN!'} {name}", flush=True)
        return red
    finally:
        path.write_text(orig)


base = run()
print("baseline", "clean" if base.returncode == 0 else "NOT CLEAN", flush=True)
ok = True
for m in mods:
    probe = "\n_tc_probe: int = 'not an int'  # mutation\n"
    ok &= mutate(m, "", probe, f"module {m.relative_to(TREE)}")
F = TREE / "lcnc-gateway/fake_linuxcnc.py"
I = TREE / "lcnc-gateway/lcnc_iface.py"
S = TREE / "typings/linuxcnc.pyi"
ok &= mutate(F, "    def mdi(self, command: str, /) -> None: self._sent()\n", "", "fake: mdi missing")
ok &= mutate(F, "    def home(self, joint: int, /) -> None: self._sent()\n",
             "    def home(self, joint: str, /) -> None: self._sent()\n", "fake: home takes a str")
ok &= mutate(F, "    def wait_complete(self, timeout: float = 5.0, /) -> int:\n        return self.wait_result\n",
             "    def wait_complete(self, timeout: float = 5.0, /) -> None:\n        return None\n", "fake: wait_complete returns None")
ok &= mutate(F, "    tool_in_spindle: int\n", "    tool_in_spindle: str\n", "fake: tool_in_spindle a str")
ok &= mutate(S, "    def mdi(self, command: str, /) -> None: ...\n", "", "stub: mdi missing")
ok &= mutate(S, "    def estop(self) -> int: ...\n", "    def estop(self) -> str: ...\n", "stub: estop a str")
ok &= mutate(I, "    def unhome(self, joint: int, /) -> None: ...\n",
             "    def unhome(self, joint: int, /) -> None: ...\n    def brand_new_call(self) -> None: ...\n",
             "interface: a call neither stub nor fake has")
print("ALL RED" if ok else "SOME GREEN", flush=True)

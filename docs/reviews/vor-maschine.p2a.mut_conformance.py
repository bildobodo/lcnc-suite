"""Package 2a conformance mutations, criterion corrected (the first run read
the error at the MUTATED file; a fake / stub / interface drift is reported at
the conformance check that holds it — typings/conformance/check_*.py).
usage: <venv python> mut_conformance.py <tree>"""
import subprocess
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
F = TREE / "lcnc-gateway/fake_linuxcnc.py"
I = TREE / "lcnc-gateway/lcnc_iface.py"
S = TREE / "typings/linuxcnc.pyi"
CF, CS = "typings/conformance/check_fake.py", "typings/conformance/check_stub.py"


def mutate(path, old, new, name, at):
    orig = path.read_text()
    assert old in orig, name
    try:
        path.write_text(orig.replace(old, new, 1))
        r = subprocess.run([sys.executable, str(TREE / "scripts/run_pyright.py")], cwd=TREE,
                           capture_output=True, text=True, timeout=600)
        hit = [ln.strip() for ln in r.stdout.splitlines() if "error:" in ln]
        red = r.returncode != 0 and all(a in r.stdout for a in at)
        print(f"{'RED ' if red else 'GREEN!'} {name}  ← {'; '.join(h.replace(str(TREE) + '/', '')[:120] for h in hit[:2])}", flush=True)
        return red
    finally:
        path.write_text(orig)


ok = True
ok &= mutate(F, "    def mdi(self, command: str, /) -> None: self._sent()\n", "", "fake: mdi missing", [CF])
ok &= mutate(F, "    def home(self, joint: int, /) -> None: self._sent()\n",
             "    def home(self, joint: str, /) -> None: self._sent()\n", "fake: home takes a str", [CF])
ok &= mutate(F, "    def wait_complete(self, timeout: float = 5.0, /) -> int:\n        return self.wait_result\n",
             "    def wait_complete(self, timeout: float = 5.0, /) -> None:\n        return None\n",
             "fake: wait_complete returns None", [CF])
ok &= mutate(F, "    tool_in_spindle: int\n", "    tool_in_spindle: str\n", "fake: tool_in_spindle a str", [CF])
ok &= mutate(S, "    def mdi(self, command: str, /) -> None: ...\n", "", "stub: mdi missing", [CS])
ok &= mutate(S, "    def estop(self) -> int: ...\n", "    def estop(self) -> str: ...\n", "stub: estop a str", [CS])
ok &= mutate(I, "    def unhome(self, joint: int, /) -> None: ...\n",
             "    def unhome(self, joint: int, /) -> None: ...\n    def brand_new_call(self) -> None: ...\n",
             "interface: a call neither stub nor fake has", [CF, CS])
print("ALL RED" if ok else "SOME GREEN", flush=True)

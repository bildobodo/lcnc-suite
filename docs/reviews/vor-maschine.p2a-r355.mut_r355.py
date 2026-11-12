"""Package 2a counter-cases after R354 (VM-I01..I03): every injected defect
must turn the REAL gate step (scripts/run_pyright.py) red AT the mutated file;
every file restored after its run. Run in a COPY of the tree (the mutations
edit files).

  1. every module the type check covers (now with writer_fixture, json_types)
     — a wrong assignment;
  2. strict: an UNANNOTATED function in each strict module is red, the same
     probe in a standard module is green (the selection is per file);
  3. Codex R354's own probes: an untyped function in command_policy, a
     wrong return type in writer_fixture;
  4. the call forms (VM-I01): an overload widened back to int in the
     interface, the stub and the fake, a selector set grown;
  5. the conformance mutations of R354 (fake / stub / interface).

usage: <venv python> mut_r355.py <tree>"""
import json
import subprocess
import sys
from pathlib import Path

TREE = Path(sys.argv[1])
cfg = json.loads((TREE / "pyrightconfig.json").read_text())
STRICT = [TREE / s for s in cfg["strict"]]
excluded = {"gateway.py", "conftest.py", "suite_py_bind_probe.py"}
mods = sorted(p for p in (TREE / "lcnc-gateway").glob("*.py")
              if not p.name.startswith("test_") and p.name not in excluded and not p.name.startswith("native_"))
mods.append(TREE / "subroutines/surfacemap/compensation.py")


def run():
    return subprocess.run([sys.executable, str(TREE / "scripts/run_pyright.py")], cwd=TREE,
                          capture_output=True, text=True, timeout=600)


results = []


def mutate(path, old, new, name, want_red=True):
    orig = path.read_text()
    assert (old in orig) if old else True, (name, old)
    try:
        path.write_text(orig.replace(old, new, 1) if old else orig + new)
        r = run()
        red = r.returncode != 0 and str(path) in r.stdout
        good = red == want_red
        label = ("RED  " if red else "GREEN") + ("" if good else "  <-- UNEXPECTED")
        print(f"{label} {name}", flush=True)
        results.append(good)
    finally:
        path.write_text(orig)


base = run()
print("baseline", "clean" if base.returncode == 0 else "NOT CLEAN\n" + base.stdout[-2000:], flush=True)

# 1. every checked module
for m in mods:
    mutate(m, "", "\n_tc_probe: int = 'not an int'  # mutation\n", f"module {m.relative_to(TREE)}")

# 2. strict per file: an unannotated function
untyped = "\n\ndef _tc_untyped(x):  # mutation\n    return x\n"
for m in STRICT:
    mutate(m, "", untyped, f"strict {m.relative_to(TREE)}: unannotated function")
mutate(TREE / "lcnc-gateway/status_runtime.py", "", untyped,
       "standard lcnc-gateway/status_runtime.py: unannotated function (expected GREEN)", want_red=False)

# 3. Codex R354's probes
mutate(TREE / "lcnc-gateway/writer_fixture.py", "",
       "\n\ndef _tc_wrong_return(x: int) -> str:  # mutation\n    return x\n",
       "writer_fixture: wrong return type")
mutate(TREE / "lcnc-gateway/command_policy.py", "",
       "\n\ndef _tc_new(payload, limits):  # mutation\n    return payload.get(limits)\n",
       "command_policy: new untyped function")

# 4. call forms
I = TREE / "lcnc-gateway/lcnc_iface.py"
S = TREE / "typings/linuxcnc.pyi"
F = TREE / "lcnc-gateway/fake_linuxcnc.py"
FORMS = TREE / "typings/conformance/check_forms.py"


def forms(path, old, new, name):
    """A widened form shows as an unnecessary ignore in check_forms.py."""
    orig = path.read_text()
    assert old in orig, (name, old)
    try:
        path.write_text(orig.replace(old, new, 1))
        r = run()
        red = r.returncode != 0 and str(FORMS) in r.stdout
        print(f"{'RED  ' if red else 'GREEN  <-- UNEXPECTED'} {name}", flush=True)
        results.append(red)
    finally:
        path.write_text(orig)


forms(I, "    def jog(self, fn: Literal[1], jjogmode", "    def jog(self, fn: int, jjogmode",
      "interface: JOG_CONTINUOUS overload widened to int")
forms(I, "    def auto(self, fn: Literal[1, 2, 3, 4, 5], /) -> None: ...",
      "    def auto(self, fn: int, /) -> None: ...", "interface: auto without line widened to int")
forms(S, "    def jog(self, fn: Literal[0], jjogmode", "    def jog(self, fn: int, jjogmode",
      "stub: JOG_STOP overload widened to int")
forms(S, "    def auto(self, fn: Literal[0], line: int, /) -> None: ...",
      "    def auto(self, fn: int, line: int, /) -> None: ...", "stub: auto with line widened to int")
forms(F, "    def jog(self, fn: Literal[2], jjogmode", "    def jog(self, fn: int, jjogmode",
      "fake: JOG_INCREMENT overload widened to int")
forms(I, "    def mode(self, mode: Literal[1, 2, 3], /) -> None: ...",
      "    def mode(self, mode: Literal[0, 1, 2, 3], /) -> None: ...", "interface: mode set grown by 0")

# 5. conformance (R354): the error shows where the fake / stub is HELD
#    against the interface — typings/conformance/check_fake.py / check_stub.py
CONF = TREE / "typings/conformance"


def conformance(path, old, new, name):
    orig = path.read_text()
    assert old in orig, (name, old)
    try:
        path.write_text(orig.replace(old, new, 1))
        r = run()
        red = r.returncode != 0 and (str(path) in r.stdout or str(CONF) in r.stdout)
        print(f"{'RED  ' if red else 'GREEN  <-- UNEXPECTED'} {name}", flush=True)
        results.append(red)
    finally:
        path.write_text(orig)


mutate = conformance  # noqa: F811 — the five below use the conformance criterion
mutate(F, "    def mdi(self, command: str, /) -> None: self._sent()\n", "", "fake: mdi missing")
mutate(F, "    def home(self, joint: int, /) -> None: self._sent()\n",
       "    def home(self, joint: str, /) -> None: self._sent()\n", "fake: home takes a str")
mutate(F, "    def wait_complete(self, timeout: float = 5.0, /) -> int:\n        return self.wait_result\n",
       "    def wait_complete(self, timeout: float = 5.0, /) -> None:\n        return None\n",
       "fake: wait_complete returns None")
mutate(F, "    tool_in_spindle: int\n", "    tool_in_spindle: str\n", "fake: tool_in_spindle a str")
mutate(S, "    def mdi(self, command: str, /) -> None: ...\n", "", "stub: mdi missing")
mutate(S, "    def estop(self) -> int: ...\n", "    def estop(self) -> str: ...\n", "stub: estop a str")
mutate(I, "    def unhome(self, joint: int, /) -> None: ...\n",
       "    def unhome(self, joint: int, /) -> None: ...\n    def brand_new_call(self) -> None: ...\n",
       "interface: a call neither stub nor fake has")

print(f"{sum(results)}/{len(results)} as expected", "— ALL AS EXPECTED" if all(results) else "— SOME UNEXPECTED",
      flush=True)
sys.exit(0 if all(results) else 1)

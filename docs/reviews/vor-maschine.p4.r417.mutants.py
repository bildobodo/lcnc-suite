"""Red first for the R384 run-end guard: each mutant applied alone to
scripts/native_run.py in the worktree, the guard run, the file restored."""
import subprocess, sys
from pathlib import Path
WT = Path(sys.argv[1]); PY = sys.argv[2]
F = WT / "scripts/native_run.py"
orig = F.read_text()
MUTANTS = {
  "M1 a failed step does not end the run (the loop goes on)": (
    "            rows = fn(ctx) or []\n            report[\"rows\"] += rows\n",
    "            try:\n                rows = fn(ctx) or []\n            except Exception as e:  # noqa: BLE001\n                report[\"error\"] = f\"{type(e).__name__}: {e}\"\n                rows = getattr(e, \"rows\", None) or ctx.get(\"rows\", [])\n            report[\"rows\"] += rows\n"),
  "M2 the admission is not judged at the send": (
    "        why = _lost(c)\n        if why:\n            raise NotAdmitted(f\"{why} — {cmd} not sent\")\n",
    "        why = None\n"),
  "M3 the cleanup is skipped (the client's socket stays open)": (
    "        cleanup = ctx.get(\"cleanup\")\n",
    "        cleanup = None\n"),
  "M4 the rows observed before the failure are dropped": (
    "        report[\"rows\"] += rows if rows is not None else ctx.get(\"rows\", [])\n",
    "        pass\n"),
}
try:
    for name, (old, new) in MUTANTS.items():
        assert orig.count(old) == 1, name
        F.write_text(orig.replace(old, new))
        r = subprocess.run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_native_stage.py",
                            "-k", "loses_its_admission"], cwd=WT / "scripts", capture_output=True, text=True, timeout=300)
        last = (r.stdout.strip().splitlines() or ["?"])[-1]
        print(f"{'RED ' if r.returncode else 'GREEN'} {name}: {last}")
finally:
    F.write_text(orig)
r = subprocess.run([PY, "-m", "pytest", "-q", "-p", "no:cacheprovider", "test_native_stage.py", "-k", "loses_its_admission"],
                   cwd=WT / "scripts", capture_output=True, text=True, timeout=300)
print("restored:", (r.stdout.strip().splitlines() or ["?"])[-1])

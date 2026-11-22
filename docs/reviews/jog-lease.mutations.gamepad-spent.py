"""Client mutation (P1b red proof): a spent stick owner starts again while still
deflected (the 'spent until rest' guard removed) — the gamepad tests must turn red.

  python3 -I mut_gamepad_spent.py <tree>
"""
import pathlib, subprocess, sys
tree = pathlib.Path(sys.argv[1]).resolve()
f = tree / "lcnc-webui/src/useGamepad.ts"
src = f.read_bytes(); s = src.decode()
old = "    if (owner.spent) return;"
assert s.count(old) == 1
try:
    f.write_text(s.replace(old, "    // MUTATION: a spent owner starts again"))
    p = subprocess.run(["npx", "vitest", "run", "src/useGamepad.test.ts"], cwd=tree / "lcnc-webui",
                       capture_output=True, text=True, timeout=600)
finally:
    f.write_bytes(src)
out = p.stdout + p.stderr
for ln in out.splitlines():
    if "×" in ln or "FAIL" in ln or "Tests " in ln:
        print(ln.strip()[:200])
print("RED" if p.returncode != 0 else "GREEN")

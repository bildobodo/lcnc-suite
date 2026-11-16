"""Offline mutants for probe live (plan R380–R381): each applied alone, the
probe-live tests of test_native_stage.py run, the tree restored. Usage:
python3 mutants_pl.py <tree>"""
import subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
T = Path(sys.argv[1]).resolve()
PY = str(T / "lcnc-gateway/.venv/bin/python3")
NC = "scripts/test_support/native_cases.py"
NR = "scripts/native_run.py"
MUTANTS = {
 "P17 probe_run: the baseline after the plant's read-back": (NR, '            _over_plate(c, plate, over)\n            _override_free(c)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            s = _snapshot(c, numbers)\n', '            _over_plate(c, plate, over)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            s = _snapshot(c, numbers)\n            _override_free(c)\n'),
 "P18 probe_run: the baseline between plant and read-back": (NR, '            _over_plate(c, plate, over)\n            _override_free(c)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n', '            _over_plate(c, plate, over)\n            _short(c, f"G10 L2 P1 Z{g54_plant:.6f}")\n            _short(c, "#5070=0")\n            _plant(c, plant)\n            _override_free(c)\n'),
 "P19 the scan: the baseline after the plant": (NR, '            _override_free(c)\n            _plant(c, SCAN_PLANT)\n', '            _plant(c, SCAN_PLANT)\n            _override_free(c)\n'),
 "P20 the scan: the baseline after the read-back": (NR, '            _override_free(c)\n            _plant(c, SCAN_PLANT)\n            s0 = _snapshot(c, sorted(values))\n', '            _plant(c, SCAN_PLANT)\n            s0 = _snapshot(c, sorted(values))\n            _override_free(c)\n'),
}
K = ("window or probe_start or refusal_changes or refused_job or trace_files or probe_run_case or probe_job_is_sent "
     "or surface_step or surface_job or planted_5070 or job_window or plant_never_names")
out = []
for name, (rel, old, new) in MUTANTS.items():
    p = T / rel
    src = p.read_text()
    assert src.count(old) == 1, (name, src.count(old))
    p.write_text(src.replace(old, new))
    try:
        xml = T.parent / "claude-work/p3b-probe/mut-sib.xml"
        subprocess.run([PY, "-m", "pytest", "-p", "no:cacheprovider", f"--junitxml={xml}", "scripts/test_native_stage.py",
                        "-k", K], cwd=T, capture_output=True, timeout=900)
        red = []
        for c in ET.parse(xml).getroot().iter("testcase"):
            f = c.find("failure") if c.find("failure") is not None else c.find("error")
            if f is not None:
                red.append(f"{c.get('name')}: {((f.get('message') or '').splitlines() or [''])[0][:140]}")
        out.append(f"{name}: {len(red)} red" + "".join(f"\n    {r}" for r in red[:6]) + (f"\n    … {len(red)-6} more" if len(red) > 6 else ""))
    finally:
        p.write_text(src)
print("\n".join(out))

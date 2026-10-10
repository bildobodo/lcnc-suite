"""R122: native offline payload/zero-length evidence. Run from lcnc-gateway.
Uses private synthetic STAT/INI/tool mmap from native_start_probe.py; no controller commands.
"""
import sys
from pathlib import Path
p=Path.cwd()/"native_start_probe.py"
s=p.read_text()
cases={
 "r122_feed_mixed_a": ("G21 G90\nG53 G0 Z0\nG1 X0 F100\nG1 Y0 F200\nM2\n", "mm", 0., (490,), {}),
 "r122_feed_mixed_b": ("G21 G90\nG53 G0 Z0\nG1 X0 F200\nG1 Y0 F100\nM2\n", "mm", 0., (490,), {}),
 "r122_feed_f100": ("G21 G90\nG53 G0 Z0\nG1 X0 F100\nG1 Y0 F100\nM2\n", "mm", 0., (490,), {}),
 "r122_feed_f200": ("G21 G90\nG53 G0 Z0\nG1 X0 F200\nG1 Y0 F200\nM2\n", "mm", 0., (490,), {}),
 "r122_rapid_corner": ("G21 G90\nG53 G0 Z0\nG0 X0\nG0 Y0\nG0 X10\nM2\n", "mm", 0., (490,), {}),
}
marker="program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]"
assert marker in s
s=s.replace(marker, "CASES.update("+repr(cases)+")\n"+marker)
exec(compile(s,str(p),"exec"),{"__name__":"__main__","__file__":str(p)})

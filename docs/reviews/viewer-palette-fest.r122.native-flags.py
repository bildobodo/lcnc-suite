"""Offline: which axis words / frame / leg does a canon callback see?
Runs the repo's native_start_probe.py harness (synthetic STAT, temp INI/var,
linuxcnc.command raises) with extra cases and a recorder on the canon."""
import sys, json
from pathlib import Path
p = Path.cwd() / "native_start_probe.py"
s = p.read_text()
G30 = {"var": {5161: 1, 5162: 2, 5163: 3, 5181: 100, 5182: 200, 5183: 300}}
cases = {
 "e_g53_prefix": ("G21 G90\nG53 G0 Z0\nG0 X0\nG91 G0 Y5\nG90 G1 X0 Y0 Z-10 F100\nM2\n", "mm", 0., (490,), {}),
 "e_g30_forms": ("G21 G90\nG0 X11 Y22 Z33\nG30\nG0 X11 Y22 Z33\nG91 G30 Z0\nG90\nG0 X11 Y22 Z33\nG30 Z400\nM2\n", "mm", 0., (490,), G30),
 "e_g28_g91": ("G21 G90\nG0 X11 Y22 Z33\nG28 G91 Z0\nG90\nG28\nM2\n", "mm", 0., (490,), G30),
 "e_sub": ("G21 G90\nG0 X1 Y2 Z3\no<efsub> call\nM2\n", "mm", 0., (490,),
           {"subs": {"efsub.ngc": "o<efsub> sub\nG0 Y7\nG53 G0 Z0\no<efsub> endsub\n"}}),
}
marker = "program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]"
assert marker in s
s = s.replace(marker, "CASES.update(" + repr(cases) + ")\n" + marker)
hook = "import gcode_parse_worker as worker  # noqa: E402"
assert hook in s
rec = r'''
import gcode_canon as _gc
_LOG = []
def _rec(kind):
    orig = getattr(_gc.PreviewCanon, kind)
    def f(self, *a):
        it = _gc.interp_this()
        row = {"kind": kind, "line": self.lineno, "args": [round(float(v), 4) for v in a[:3]]}
        try:
            b = it.blocks[0]
            for k in ("x_flag", "y_flag", "z_flag", "a_flag", "c_flag", "motion_to_be", "line_number"):
                row[k] = getattr(b, k, "MISSING")
            gm = getattr(b, "g_modes", None)
            row["g_modes"] = [gm[i] for i in range(16)] if gm is not None else "MISSING"
            row["distance_mode"] = str(getattr(it, "distance_mode", "MISSING"))
            row["call_level"] = getattr(it, "call_level", "MISSING")
        except Exception as e:
            row["err"] = repr(e)
        _LOG.append(row)
        return orig(self, *a)
    setattr(_gc.PreviewCanon, kind, f)
for _k in ("straight_traverse", "straight_feed"):
    _rec(_k)
import atexit as _ax
_ax.register(lambda: print("__FLAGS__ " + json.dumps(_LOG, default=str)))
'''
s = s.replace(hook, rec + hook)
exec(compile(s, str(p), "exec"), {"__name__": "__main__", "__file__": str(p)})

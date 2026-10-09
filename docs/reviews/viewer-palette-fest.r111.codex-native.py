"""R109 native offline counterexamples. Run with archive lcnc-gateway as cwd.
Uses its unchanged native_start_probe setup, injects ONLY extra cases in memory.
No real linuxcnc.command; all parameters, INI and mmap in harness private tempdir.
"""
from pathlib import Path
import json, sys, subprocess
here = Path.cwd(); ev = Path(__file__).resolve().parent
if len(sys.argv) > 1:
    src = (here/'native_start_probe.py').read_text()
    cases = json.loads((ev/'native-cases.json').read_text())
    case = cases[sys.argv[1]]
    if 'tuple' in case and 'var' in case['tuple'][4]:
        case['tuple'][4]['var']={int(k):v for k,v in case['tuple'][4]['var'].items()}
    patch = '\nCASES[sys.argv[1]] = ' + ("_m600(**" + repr(case['m600']) + ")" if 'm600' in case else repr(tuple(case['tuple']))) + '\n'
    src = src.replace('program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]',patch+'program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]')
    src = src.replace('inch = units ==', "extra['rs274ngc'] = extra.get('rs274ngc', '').replace('{work}', str(work))\ninch = units ==")
    exec(compile(src, str(here/'native_start_probe.py'), 'exec'), {'__name__':'__main__', '__file__':str(here/'native_start_probe.py')})
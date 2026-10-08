"""R105 native offline counterexamples. Run with archive lcnc-gateway as cwd.
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
    exec(compile(src, str(here/'native_start_probe.py'), 'exec'), {'__name__':'__main__', '__file__':str(here/'native_start_probe.py')})
else:
    foreign={'rs274ngc':'REMAP=M600 modalgroup=6 ngc=othertc', 'subs':{'othertc.ngc':'o<othertc> sub\nG53 G0 Z0\no<othertc> endsub\n'}}
    cases={}
    for name, assignment in [('literal','#3009 = 4'),('double_hash','#1=3009\n##1=4'),('spaced','#3 0 0 9=4'),('signed','#+3009=4'),('decimal','#3009.0=4')]:
        cases['assign_'+name]={'tuple':['G21 G90\n'+assignment+'\nG0 X#3009 Y0 Z0\nM2\n','mm',0.0,[490],{'var':{'3009':3}}]}
    for name,call in [('control','T2 M600'),('compact','T2M600'),('signed','T2 M+600'),('expression','T2 M[600]')]:
        cases['foreign_'+name]={'tuple':['G21 G90\nG0 X50 Y50 Z-100\nG1 X55 F100\n'+call+'\nG0 X60 Y60\nM2\n','mm',0.0,[490],foreign]}
    f2=json.loads(json.dumps(foreign));f2['subs']['child.ngc']='o<child> sub\nT2 M600\no<child> endsub\n'
    cases['foreign_called']={'tuple':['G21 G90\nG0 X50 Y50 Z-100\no<child> call\nG0 X60 Y60\nM2\n','mm',0.0,[490],f2]}
    cases['unknown_first']={'m600':{'prog':'G21 G90\nT2 M600\nG0 X60 Y60 Z-100\nG0 X70\nM2\n','ctx':{'toolsetter_unpredictable':'toolsetter_unknown'}}}
    cases['repeat_same_tool']={'m600':{'prog':'G21 G90\nG0 X50 Y50 Z-100\nT2 M600\nG0 X60\n#3007=1\nT2 M600\nG0 X70\nM2\n'}}
    (ev/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    results={}
    for name in cases:
        p=subprocess.run([sys.executable,str(Path(__file__).resolve()),name,str(ev/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
        ls=[ln for ln in p.stdout.splitlines() if ln.startswith('{')]
        results[name]={'returncode':p.returncode, 'data':json.loads(ls[-1]) if ls else None,'stdout':p.stdout,'stderr':p.stderr}
        print(name,p.returncode,flush=True)
    (ev/'native.json').write_text(json.dumps(results,indent=2)+'\n')

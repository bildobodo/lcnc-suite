"""Extra R107 native scanner boundaries; no live binding or product changes."""
from pathlib import Path
import json,subprocess,sys
import gateway_util as u
E=Path(__file__).resolve().parent
cases=json.loads((E/'native-cases.json').read_text())
write={'var':{'3009':3},'rs274ngc':'REMAP=M200 modalgroup=10 ngc=setter_write','subs':{'setter_write.ngc':'o<setter_write> sub\n#3009=4\no<setter_write> endsub\n'}}
more={
 'comment_split_remap':{'tuple':['G21 G90\nG0 X0 Y0 Z0\nM2(x)00\nG0 X#3009\nM2\n','mm',0.,[490],write]},
 'negative_g92_expr':{'tuple':['G21 G90\nG0 X5 Y0 Z0\nG-[-92] X10\nG0 X11\nM2\n','mm',0.,[490],{}]},
 'negative_g92_var':{'tuple':['G21 G90\nG0 X5 Y0 Z0\n#1=-92\nG-#1 X10\nG0 X11\nM2\n','mm',0.,[490],{}]},
 'negative_g10_expr':{'tuple':['G21 G90\nG0 X5 Y0 Z0\nG-[-10] L2 P1 X5\nG0 X11\nM2\n','mm',0.,[490],{}]},
 'negative_g10_function':{'tuple':['G21 G90\nG0 X5 Y0 Z0\nG-ABS[-10] L2 P1 X5\nG0 X11\nM2\n','mm',0.,[490],{}]},
}
for name,word in [('stale_g92_control','G92'),('stale_g92_negative','G-[-92]'),('stale_g10_control','G10 L20 P1'),('stale_g10_negative','G-[-10] L20 P1')]:
 more[name]={'tuple':['G21 G90\nG0 X5 Y0 Z0\nT2 M6\n'+word+' X10\nG0 X11 Y0 Z0\nG0 X12\nM2\n','mm',0.,[490],{'emcio':'TOOL_CHANGE_POSITION = 100 100 -100'}]}
for name,word in [('inactive_control','G10'),('inactive_negative','G-[-10]')]:
 more[name]={'tuple':['G21 G90\nG0 X0 Y0 Z40\nM6\n'+word+' L20 P2 Z10\nG0 X10 Y5 Z15\nG55\nG0 X20 Z25\nG0 X30\nM2\n','mm',0.,[490],{'emcio':'TOOL_CHANGE_POSITION = 0 20 30'}]}
for name,word in [('store_control','G28.1'),('store_negative','G-[-28.1]')]:
 more[name]={'tuple':['G21 G90\nG0 X0 Y0 Z40\nM6\n'+word+'\nG0 X10 Y5 Z15\nG28\nG0 X20\nM2\n','mm',0.,[490],{'emcio':'TOOL_CHANGE_POSITION = 0 20 30'}]}
cases.update(more);(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
result={}
for name,c in more.items():
 p=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 lines=[l for l in p.stdout.splitlines() if l.startswith('{')];d=json.loads(lines[-1]) if lines else None
 result[name]={'returncode':p.returncode,'data':d,'stdout':p.stdout,'stderr':p.stderr,'position_writes':u.position_write_lines(c['tuple'][0]),'wcs_targets':[sorted(u.wcs_rewrite_targets(c['tuple'][0])[0]),u.wcs_rewrite_targets(c['tuple'][0])[1]]}
 print(name, None if d is None else {'error':d['parse_error'],'end':d['rapid'][-1:]},result[name]['position_writes'],flush=True)
(E/'boundary.json').write_text(json.dumps(result,indent=2)+'\n')

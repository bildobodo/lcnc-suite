"""R106 additional native cases, unchanged worker/routine; use native.py from R105.
Run in archive/lcnc-gateway after native.py's twelve original cases.
"""
from pathlib import Path
import json,subprocess,sys
import gateway_util as u
E=Path(__file__).resolve().parent
p=E/'native-cases.json';cases=json.loads(p.read_text())
more={
 'near_call_pair':{'m600':{'prog':'G21 G90\nG0 X50 Y50 Z-100\nT2 M599.99999\nG0 X60\nT1 M600\nG0 X70\nM2\n'}},
 'near_call_single':{'m600':{'prog':'G21 G90\nG0 X50 Y50 Z-100\nT2 M599.99999\nG0 X60\nM2\n'}},
 'remap_write':{'tuple':['G21 G90\nG0 X0 Y0 Z0\nM200\nG0 X#3009\nM2\n','mm',0.,[490],{'var':{'3009':3},'rs274ngc':'REMAP=M200 modalgroup=10 ngc=setter_write','subs':{'setter_write.ngc':'o<setter_write> sub\n#3009=4\no<setter_write> endsub\n'}}]},
 'foreign_remap_nested':{'tuple':['G21 G90\nG0 X50 Y50 Z-100\nM200\nG0 X60 Y60\nM2\n','mm',0.,[490],{'rs274ngc':'REMAP=M600 modalgroup=6 ngc=othertc\nREMAP=M200 modalgroup=10 ngc=wrapper','subs':{'othertc.ngc':'o<othertc> sub\nG53 G0 Z0\no<othertc> endsub\n','wrapper.ngc':'o<wrapper> sub\nT2 M600\no<wrapper> endsub\n'}}]},
 'inline_if_assignment':{'tuple':['G21 G90\no100 if [1] #3009=4\no100 endif\nG0 X#3009 Y0 Z0\nM2\n','mm',0.,[490],{'var':{'3009':3}}]},
 'inline_endif_assignment':{'tuple':['G21 G90\no100 if [1]\no100 endif #3009=4\nG0 X#3009 Y0 Z0\nM2\n','mm',0.,[490],{'var':{'3009':3}}]},
}
cases.update(more);p.write_text(json.dumps(cases,indent=2)+'\n')
results={}
for name,case in more.items():
 prog=case['m600']['prog'] if 'm600' in case else case['tuple'][0]
 r=subprocess.run([sys.executable,str(E/'native.py'),name,str(E/(name+'.msgpack'))],capture_output=True,text=True,timeout=120)
 ls=[ln for ln in r.stdout.splitlines() if ln.startswith('{')]
 data=json.loads(ls[-1]) if ls else None
 results[name]={'returncode':r.returncode,'data':data,'stdout':r.stdout,'stderr':r.stderr,'assigned_keys':(data.get('toolsetter_meta') or {}).get('writes') if data else None,'flow_mode':u.position_write_lines(prog)[1]}
 print(name, r.returncode, flush=True)
(E/'extra-native.json').write_text(json.dumps(results,indent=2)+'\n')

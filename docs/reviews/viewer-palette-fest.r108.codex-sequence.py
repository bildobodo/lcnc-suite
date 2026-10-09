"""The proposed reachability precondition vs a named call of the bundled body."""
from pathlib import Path
import tempfile,shutil,subprocess,json,sys
import gateway_util as u
E=Path(__file__).resolve().parent; root=Path.cwd().parent
case={'m600':{'prog':'G21 G90\nG0 X50 Y50 Z-100\nT2 M200\nG0 X60\nM2\nT2 M600\n', 'rs274ngc':'REMAP=M600 modalgroup=6 ngc=m600\nREMAP=M200 modalgroup=10 ngc=wrapper', 'subs':{'wrapper.ngc':'o<wrapper> sub\no<m600> call\no<wrapper> endsub\n'}}}
cases=json.loads((E/'native-cases.json').read_text());cases['sequence_named_body']=case;(E/'native-cases.json').write_text(json.dumps(cases,indent=2)+'\n')
r=subprocess.run([sys.executable,str(E/'native.py'),'sequence_named_body',str(E/'sequence_named_body.msgpack')],capture_output=True,text=True,timeout=120)
lines=[l for l in r.stdout.splitlines() if l.startswith('{')];data=json.loads(lines[-1]) if lines else None
with tempfile.TemporaryDirectory() as td:
 d=Path(td)
 for n,t in case['m600']['subs'].items():(d/n).write_text(t)
 for n in ['m600.ngc','tool_touch_off.ngc']:shutil.copy(root/'subroutines/tool_length_probe'/n,d/n)
 env=u.RemapEnv([ln.split('=',1)[1] for ln in case['m600']['rs274ngc'].splitlines()],[td]);writes,reaches=env.effect(('M',200))
 out={'returncode':r.returncode,'data':data,'stdout':r.stdout,'stderr':r.stderr,'main_mode':u.position_write_lines(case['m600']['prog'])[1],'candidate_lines':sorted(u.m_code_lines(case['m600']['prog'],['m600','m601'])),'other_remap_effect':{'writes':None if writes is None else sorted(writes),'reaches':None if reaches is None else sorted(reaches)},'other_remap_reaches_m600':reaches is None or ('M',600) in reaches}
(E/'sequence.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps({k:v for k,v in out.items() if k not in ['data','stdout','stderr']}));print('error',data['parse_error'] if data else None,'events',data.get('toollen_table') if data else None)

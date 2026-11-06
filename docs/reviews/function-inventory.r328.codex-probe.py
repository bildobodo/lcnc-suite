#!/usr/bin/env python3
"""R328 offline review: original R327 fault injections, new boundaries, stored run.
Usage: python-with-pytest-numpy-scipy probe.py ARCHIVE R327_PROBE R328_EVIDENCE
Never connects to a controller or runs a machine/hal command.
"""
import ast,json,math,hashlib,sys,tempfile
from pathlib import Path
import pytest
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts'))
import test_native_stage as ts
nr,nc=ts.nr,ts.nc
Base=ts.SurfaceSim
# Preserve the three original fault classes byte-for-byte semantically.
old=ast.parse(Path(sys.argv[2]).read_text())
classes=[n for n in old.body if isinstance(n,ast.ClassDef) and n.name in ('LateEnable','MissingVersion','WrongArrival')]
assert len(classes)==3
exec(compile(ast.Module(body=classes,type_ignores=[]),'R327-original-counter-classes','exec'))
class NoDrain(Base):
 def request(self,cmd,**kw):
  if cmd=='set_compensation' and kw.get('enable') is False and not getattr(self,'ignored_off',False):
   self.ignored_off=True;self.sent.append((cmd,kw));self.tick();return {'ok':True}
  return super().request(cmd,**kw)
class NoMapReload(Base):
 def request(self,cmd,**kw):
  if cmd=='set_compensation_method':
   self.sent.append((cmd,kw));self.method=kw['method'];self.tick();return {'ok':True}
  return super().request(cmd,**kw)

out={'source':'d28b0843','flows':{},'override':{},'native':{}}
for name,cls in [('baseline',Base),('late_enable',LateEnable),('missing_version',MissingVersion),('wrong_arrival',WrongArrival),('no_drain',NoDrain),('no_method_reload',NoMapReload)]:
 with tempfile.TemporaryDirectory(prefix='codex-r328-probe-') as td,pytest.MonkeyPatch.context() as mp:
  mp.setattr(ts,'SurfaceSim',cls);mp.setattr(nr,'METHOD_CONFIRM_S',.15)
  by,ctx,sim,error=ts._surface_step(mp,Path(td))
  assert error is None,(name,error)
  result={'rows':{k:r['status'] for k,r in by.items()},'moves':sim.moves,'commands':sim.sent,
          'cleanup_error':ctx['report']['surface_cleanup'].get('error')}
  assert not result['cleanup_error']
  if name=='baseline':assert len(by)==15 and all(r['status']=='PASS' for r in by.values())
  elif name=='late_enable':
   assert by['comp-after-xy']['status']=='incomplete'
   assert sim.on_at_move is None and not any(m.startswith('G1 ') for m in sim.moves)
   assert all(by[k]['status']=='PASS' for k in ('comp-nearest','comp-linear','comp-cubic','comp-on-off'))
  elif name=='missing_version':assert all(by['comp-'+m]['status']=='incomplete' for m in nc.METHODS)
  elif name=='wrong_arrival':assert by['comp-after-xy']['status']=='FAIL'
  elif name=='no_drain':
   assert by['comp-nearest']['status']=='PASS'
   assert all(by[k]['status']=='incomplete' for k in ('comp-linear','comp-cubic','comp-on-off','comp-after-xy'))
   assert not any(cmd=='set_compensation_method' and kw['method']==1 for cmd,kw in sim.sent)
  else:
   assert all(by[k]['status']=='incomplete' for k in ('comp-nearest','comp-linear','comp-cubic','comp-on-off','comp-after-xy'))
   assert not any(cmd=='set_compensation' and kw['enable'] for cmd,kw in sim.sent)
  out['flows'][name]=result

# Test real cleanup and its real override helper, including an old True but
# no post-write frame (must not be accepted) and an ordinary successful write.
class Stream:
 def __init__(self,value,stream):
  self.data={'eoffset_enabled':False,'eoffset_z':0.,'comp_method':2,'g5x_index':1,
             'g5x_offset':[0.,0.,0.],'feed_override_enabled':value}
  self.f=[(0.,dict(self.data))];self.stream=stream;self.error=None
 @property
 def status(self):return dict(self.data)
 @property
 def frames(self):
  if self.stream:self.f.append((self.f[-1][0]+.033,dict(self.data)))
  return self.f
for value,stream in [(False,True),(None,True),(True,True),(True,False)]:
 with pytest.MonkeyPatch.context() as mp:
  c=Stream(value,stream);mp.setattr(nr,'OVERRIDE_CONFIRM_S',.15)
  mp.setattr(nr,'_comp_off',lambda ctx,c:{'settled':True,'enabled':False,'eoffset':0.})
  mp.setattr(nr,'_short',lambda c,text:None)
  r=nr._surface_cleanup({},c,'cubic')
  assert bool(r.get('error')) is (value is not True or not stream)
  out['override'][f'value={value};new_frames={stream}']=r

# Independent arithmetic of the recorded native case and each accepted window.
import numpy as np
from scipy.interpolate import griddata
r=json.loads(Path(sys.argv[3]).read_text())['runs'][0]
points=np.loadtxt(r['probe_results'].splitlines())
axis=[518.,534.,550.,566.,582.]
assert points.shape==(25,3)
assert np.max(np.abs(points[:,:2]-np.array([(x,y) for i,y in enumerate(axis) for x in (axis if i%2==0 else axis[::-1])])))<=1e-6
x,y=points[:,0]-550,points[:,1]-550
residual=float(max(abs(points[:,2]-(6+.05*x-.03*y-.0024*(x*x+y*y)))))
assert residual<=.005
refs={m:float(griddata(np.round(points[:,:2],1),points[:,2],[(538.,550.)],method=m)[0]) for m in ('nearest','linear','cubic')}
z={(x,y):zz for x,y,zz in points}
assert abs(refs['nearest']-z[(534.,550.)])<1e-9
lin=.75*z[(534.,550.)]+.25*z[(550.,550.)]
assert abs(refs['linear']-lin)<1e-9 and abs(refs['cubic']-lin)>.05
assert abs(refs['cubic']-5.0544)<abs(lin-5.0544)
window_checks=[]
def check_window(label,rd,at):
 w=rd['window'];data=[dict(zip(w['fields'],a)) for a in w['frames']]
 assert len(data)>1
 times=[d['t'] for d in data];gaps=np.diff(times)
 # Timestamps in evidence rounded to 0.1 ms, duration to 1 ms.
 span=times[-1]-times[0]
 assert span>=.5-.0001 and 0<min(gaps) and max(gaps)<=.2001
 assert abs(span-rd['window_s'])<=.0006
 for key,target in [('eoffset_z',rd['eoffset']),('x',rd['x']),('y',rd['y']),('z',rd['joint_z'])]:
  vals=[d[key] for d in data]
  assert all(math.isfinite(v) for v in vals)
  assert max(abs(v-target) for v in vals)<=.0005
  assert vals[-1]==target
 assert all(math.isfinite(d['version']) and d['version']==rd['version'] for d in data)
 assert all(d['enabled'] is rd['enabled'] and d['method']==rd['method'] for d in data)
 assert max(abs(rd['x']-at[0]),abs(rd['y']-at[1]))<=.001
 assert rd['limited'] is False and abs(rd['joint_z']-rd['eoffset']+113.)<=.002
 window_checks.append({'case':label,'frames':len(data),'span_s':span,'max_gap_s':float(max(gaps)),
                       'position':[rd['x'],rd['y']],'version':rd['version'],'enabled':rd['enabled']})
by={a['case']:a for a in r['rows']}
for method in ('nearest','linear','cubic'):
 row=by['comp-'+method];rd=row['reading']
 check_window(row['case'],rd,(538.,550.));assert abs(rd['eoffset']-refs[method])<=.002
 assert rd['method']==('nearest','linear','cubic').index(method)
for case in ('comp-on-off','comp-after-xy'):
 for i,part in enumerate(by[case]['readings']):
  rd=part['reading'];check_window(case+f'/{i}',rd,part['at'])
  xx,yy=rd['x']-550,rd['y']-550
  gap=rd['joint_z']-50-(-169+.05*xx-.03*yy-.0024*(xx*xx+yy*yy))
  assert abs(gap-part['gap_expected'])<=.01
  if rd['enabled']:assert abs(rd['eoffset']-z[tuple(part['at'])])<=.002
  else:assert abs(rd['eoffset'])<.001
assert len(by['comp-after-xy']['readings'])==3
cleanup=r['surface_cleanup'];check_window('cleanup/off',cleanup['off'],(518.,582.))
assert cleanup['after']['feed_override_enabled'] is True and not cleanup.get('error')
fix=r['surface_fixture'];assert nr.surface_fixture_problems(fix['signals'],fix['thread'],fix['values'],50.)==[]
digest=hashlib.sha256(r['probe_results'].encode()).hexdigest();assert digest==r['surface_scan']['sha256']
assert r['restore']=={'outcome':'complete','isolation':[]} and r['verdict']=='PASS'
out['native']={'run':r['run'],'commit':r['commit'],'reported_verdict':r['verdict'],'duration_s':r['duration_s'],
               'scan_sha256':digest,'max_scan_residual_mm':residual,'references':refs,'windows':window_checks,
               'method_switches':r['comp_method_switches'],'restore':r['restore'],
               'limitation':'Re-evaluation of saved frames/numbers, not an independent machine run or a servo-rate trajectory claim.'}
print(json.dumps(out,indent=2))

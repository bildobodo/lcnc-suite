#!/usr/bin/env python3
"""R327: pure counterexamples; no controller, HAL, HTTP or WS calls.
Usage: <python-with-pytest-numpy-scipy> probe.py /path/to/archive [evidence.json]
"""
import sys,json,tempfile,hashlib,math
from pathlib import Path
from types import SimpleNamespace
import pytest
root=Path(sys.argv[1]).resolve()
sys.path.insert(0,str(root/'scripts'))
import test_native_stage as ts
nr,nc=ts.nr,ts.nc
out={'source':'7c4a3d5c','counterexamples':{},'recomputed_runs':[]}

# Cleanup has already drained the offset, restored the method and G54;
# the M50 command returns normally but its effect is absent (or unknown).
for value in (False,None):
 with pytest.MonkeyPatch.context() as mp:
  c=SimpleNamespace(status={'eoffset_enabled':False,'eoffset_z':0.,'comp_method':2,
                            'g5x_index':1,'g5x_offset':[0.,0.,0.],'feed_override_enabled':value})
  mp.setattr(nr,'_comp_off',lambda ctx,c:{'settled':True,'enabled':False,'eoffset':0.})
  mp.setattr(nr,'_short',lambda c,text:None)
  result=nr._surface_cleanup({},c,'cubic')
  assert not result.get('error')
  out['counterexamples']['cleanup_override_'+str(value)]=result

Base=ts.SurfaceSim
class LateEnable(Base):
 def __init__(self,*a,**kw):
  self.enable_count=0;self.on_at_move=None
  super().__init__(*a,**kw)
 def request(self,cmd,**kw):
  if cmd=='set_compensation' and kw.get('enable') is True:
   self.enable_count+=1
   if self.enable_count==5: # pre-B enable after the first on/off at A
    self.sent.append((cmd,kw));self.tick();return {'ok':True}
  return super().request(cmd,**kw)
 def routine(self,text):
  if text.startswith('G1 '):
   self.on_at_move=self.on
   r=super().routine(text) # travel with compensation OFF
   self.on=True;self.e=self._e();self.tick() # only at the end enabled
   return r
  return super().routine(text)

class MissingVersion(Base):
 def tick(self,n=20,**over):
  if self.on:over['comp_grid_version']=None
  super().tick(n,**over)

class WrongArrival(Base):
 def routine(self,text):
  r=super().routine(text)
  if text.startswith('G1 '):
   # Actual arrival 0.4 mm beyond requested Y; the 1-mm map lookup is
   # unchanged, but the literal physical surface at that position is not.
   self.xy=(self.xy[0],self.xy[1]+0.4);self.e=self._e();self.tick()
  return r

for name,cls in [('baseline',Base),('late_enable',LateEnable),('missing_version',MissingVersion),('wrong_arrival',WrongArrival)]:
 with tempfile.TemporaryDirectory(prefix='codex-r327-probe-') as td,pytest.MonkeyPatch.context() as mp:
  mp.setattr(ts,'SurfaceSim',cls)
  by,ctx,sim,error=ts._surface_step(mp,Path(td))
  assert error is None,(name,error)
  assert all(r['status']=='PASS' for r in by.values()),(name,by)
  result={'error':error,'row_statuses':{k:v['status'] for k,v in by.items()}}
  if name=='baseline':
   result['control']='The unchanged repository SurfaceSim and real surface step pass.'
  elif name=='late_enable':
   assert sim.on_at_move is False
   result['compensation_at_G1_start']=sim.on_at_move
  elif name=='missing_version':
   result['method_readings']={m:by['comp-'+m]['reading'] for m in nc.METHODS}
   assert all(r['version'] is None for r in result['method_readings'].values())
  else:
   rd=by['comp-after-xy']['readings'][0]
   result.update(actual_xy=list(sim.xy),reported_xy=rd['at'],reported_gap=rd['gap_mm'],
                 actual_gap=rd['joint_z']-50.0-nc.surface_z(*sim.xy))
   assert abs(result['actual_gap']-12)>nc.GAP_TOL
  out['counterexamples'][name]=result

if len(sys.argv)>2:
 from scipy.interpolate import griddata
 import numpy as np
 data=json.loads(Path(sys.argv[2]).read_text())
 for run in data['runs']:
  points=np.loadtxt(run['probe_results'].splitlines())
  # Literal arithmetic and explicit snake; does not call surface_z or comp_reference.
  axis=[518.,534.,550.,566.,582.]
  xy=[(x,y) for i,y in enumerate(axis) for x in (axis if i%2==0 else axis[::-1])]
  assert points.shape==(25,3) and np.allclose(points[:,:2],xy,atol=1e-6,rtol=0)
  dx,dy=points[:,0]-550,points[:,1]-550
  expected=6+.05*dx-.03*dy-.0024*(dx*dx+dy*dy)
  residual=float(max(abs(points[:,2]-expected)))
  assert residual<=.005
  refs={m:float(griddata(np.round(points[:,:2],1),points[:,2],[(538.,550.)],method=m)[0]) for m in ('nearest','linear','cubic')}
  recorded={(x,y):z for x,y,z in points}
  linear=.75*recorded[(534.,550.)]+.25*recorded[(550.,550.)]
  assert abs(refs['nearest']-recorded[(534.,550.)])<1e-9
  assert abs(refs['linear']-linear)<1e-9
  assert min(abs(refs[a]-refs[b]) for a,b in [('nearest','linear'),('linear','cubic'),('nearest','cubic')])>.05
  assert abs(refs['cubic']-5.0544)<abs(linear-5.0544)
  by={r['case']:r for r in run['rows']}
  rechecked=[]
  for method in ('nearest','linear','cubic'):
   r=by['comp-'+method];rd=r['reading']
   assert abs(rd['eoffset']-refs[method])<=.002
   assert abs(rd['joint_z']-rd['eoffset']+113.)<=.002
   rechecked.append(r['case'])
  for case in ('comp-on-off','comp-after-xy'):
   if case not in by:continue
   for r in by[case]['readings']:
    x,y=r['at'];dx=x-550;dy=y-550
    height=-169+.05*dx-.03*dy-.0024*(dx*dx+dy*dy)
    gap=r['joint_z']-50-height
    assert abs(gap-r['gap_expected'])<=.01
    if r['enabled']:assert abs(r['eoffset']-recorded[(x,y)])<=.002
    else:assert abs(r['eoffset'])<.001
   rechecked.append(case)
  fixture=run['surface_fixture']
  assert nr.surface_fixture_problems(fixture['signals'],fixture['thread'],fixture['values'],50.)==[]
  digest=hashlib.sha256(run['probe_results'].encode()).hexdigest()
  assert digest==run['surface_scan']['sha256']
  out['recomputed_runs'].append({'run':run['run'],'commit':run['commit'],'declared_verdict':run['verdict'],
       'scan_sha256':digest,'worst_abs_residual_mm':residual,'references':refs,'rechecked_cases':rechecked,
       'fixture_problems':[],'limitation':'No saved raw status window: settlement, timestamp freshness and XY arrival cannot be re-evaluated from this artifact.'})
print(json.dumps(out,indent=2))

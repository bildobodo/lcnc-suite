import contextlib,json,pathlib,sys,tempfile
from unittest import mock
sys.path.insert(0,str(pathlib.Path(__file__).parent/'scripts'))
import test_native_stage as nt
import native_run as nr
from test_support import system_host
import test_perf_matrix as pt
out={}
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d)
 for missing in ['instance','launcher']:
  host=nt.FakeHost()
  if missing=='instance':host.instance=()
  else:host.gateway_ini=lambda:None
  host.stop=lambda *_:(_ for _ in ()).throw(AssertionError('no stop is permitted'))
  host.lan_trip=lambda:(_ for _ in ()).throw(AssertionError('must not read trip without instance'))
  with mock.patch.object(nr,'in_restore_unit',lambda:True),mock.patch.object(nr,'heavy_lock',lambda *a,**k:contextlib.nullcontext()),mock.patch.object(system_host,'SystemHost',lambda:host):
   rc=nr.main(['--run-dir',str(p/missing)])
  out[missing]={'rc':rc,'report':json.loads((p/missing/'report.json').read_text()),'pre_exists':(p/missing/'pre.json').exists()}
 path=p/'trace.ndjson';old=p/'trace.ndjson.1'
 def line(wall,**kw):return json.dumps({'t_wall_ns':wall,'pid':4242,**kw})+'\n'
 start=line(10,tag='browser.perfmatrix_mark',run='r399',scenario='probe',at='start')
 lag=line(15,tag='lag.window',drift_ms=88.0)
 end=line(20,tag='browser.perfmatrix_mark',run='r399',scenario='probe',at='end')
 old.write_text(start+lag);path.write_text(end)
 real=pt.pm._lines
 def rotating(name):
  yield from real(name)
  if name==str(path):
   old.rename(p/'trace.ndjson.2')
   path.rename(old)
   path.write_text(line(30,tag='outside'))
 # Include .2 in the discovered paths before our deliberate rotation.
 (p/'trace.ndjson.2').write_text('')
 with mock.patch.object(pt.pm,'TRACE',str(path)),mock.patch.object(pt.pm,'_lines',rotating):
  out['rotation_after_current_read']=pt.pm.trace_window(0,25,('r399','probe'))
print('R399-TOOL '+json.dumps(out))

"""R104 plan premise: copy probe results at the trip point, before retract.
Run only in an archive under /tmp; this expands the proposed operations,
not an implemented M600. Native harness prohibits commands, uses fake STAT.
"""
from pathlib import Path
import json,subprocess,difflib
root=Path(__file__).resolve().parents[1];assert root.is_relative_to('/tmp') and not (root/'.git').exists()
gw=root/'lcnc-gateway';ev=root/'evidence';pre='viewer-palette-fest.r104.codex-'
copy='\n'.join(f'#{5061+i}=#{5420+i}' for i in range(9))+'\n#5070=1\n'
def program(setup='',prior=False,second=False,rotary=False):
 p='G21 G90 G49 G94\nG92.1\n'
 if prior:p+='G0 Z0\nG38.3 Z-15 F100\n'
 p+='G53 G0 X0 Y0 Z0\n'+setup
 if rotary:p+='G0 A25\n'
 p+='G53 G0 X20 Y30 Z-85\nG53 G1 Z-90 F100\n'+copy+'G53 G1 Z-87 F100\n'
 if second:p+='#5063=123\n#5070=0\nG53 G1 Z-90 F100\n'+copy+'G53 G1 Z-87 F100\n'
 p+='G53 G0 Z0\nG43\nG10 L2 P1 X0 Y0 Z0 R0\nG54\nG92.1\nG49\nG0 X#5061 Y#5062 Z#5063\nG0 X[1+#5064] Y[1+#5065] Z#5066\nG0 X[2+#5067] Y[2+#5068] Z#5069\nG0 X#5070 Y0 Z0\nM2\n'
 return p
variants={
 'single_touch':('',False,False,False,[20,30,-90]),
 'old_probe_overwritten':('',True,False,False,[20,30,-90]),
 'g54':('G10 L2 P1 X5 Y7 Z10\nG54\n',False,False,False,[15,23,-100]),
 'g54_g92':('G10 L2 P1 X5 Y7 Z10\nG54\nG92 X-6 Y-9 Z-13\n',False,False,False,[14,21,-103]),
 'g54_rotation':('G10 L2 P1 X5 Y7 Z10 R90\nG54\n',False,False,False,[23,-15,-100]),
 'slow_overwrites':('',False,True,False,[20,30,-90]),
 'rotary_a':('',False,False,True,[20,30,-90]),
}
cases={n:(program(*v[:4]),'mm',0.0,(490,),{'rotary':v[3]}) for n,v in variants.items()}
(ev/(pre+'native-cases.json')).write_text(json.dumps(cases,indent=2)+'\n')
base=(gw/'native_start_probe.py').read_text();needle='program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]';assert base.count(needle)==1
new=base.replace(needle,'CASES.update('+repr(cases)+')\n\n'+needle);path=gw/'r104.native.py';assert not path.exists();path.write_text(new)
(ev/(pre+'native.patch')).write_text(''.join(difflib.unified_diff(base.splitlines(True),new.splitlines(True),fromfile='native_start_probe.py',tofile='r104.native.py')))
outs={};checks={}
try:
 for name,args in cases.items():
  r=subprocess.run(['nice','-n','19','/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python',path.name,name],cwd=gw,capture_output=True,text=True,timeout=30)
  assert r.returncode==0,(name,r.stderr,r.stdout)
  o=json.loads(r.stdout);assert not o['parse_error'],(name,o)
  plines=args[0].splitlines()
  def point(code):
   line=plines.index(code)+1
   found=[pt for l,pt in zip(o['rapid_lines'],o['rapid']) if l==line]
   # A modal frame relabel may add an anchor on the following motion line.
   # The last point is that line's actual endpoint; this harness has no loops.
   assert found,(name,line,found)
   return found[-1]
  coords=point('G0 X#5061 Y#5062 Z#5063');abc=point('G0 X[1+#5064] Y[1+#5065] Z#5066');uvw=point('G0 X[2+#5067] Y[2+#5068] Z#5069');success=point('G0 X#5070 Y0 Z0')
  abc=[abc[0]-1,abc[1]-1,abc[2]];uvw=[uvw[0]-2,uvw[1]-2,uvw[2]]
  expected=variants[name][4]
  checks[name]={'expected_xyz':expected,'xyz':coords,'abc':abc,'uvw':uvw,'success':success}
  outs[name]={'stderr':r.stderr,'out':o}
  assert all(abs(a-b)<1e-5 for a,b in zip(coords,expected)),(name,coords,expected)
  assert abc==([25,0,0] if variants[name][3] else [0,0,0]),(name,abc)
  assert uvw==[0,0,0] and success==[1,0,0],(name,uvw,success)
finally:
 path.unlink()
 (ev/(pre+'native.json')).write_text(json.dumps(outs,indent=2)+'\n')
 (ev/(pre+'native-checks.json')).write_text(json.dumps(checks,indent=2)+'\n')
print(json.dumps({'passed':len(checks),'cases':checks},indent=2))

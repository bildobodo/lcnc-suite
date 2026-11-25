"""R478 offline: unchanged upstream load/save and real gateway Rule R.
The absent TF-2 job/owner predicate is an explicitly identified plan model.
No gateway import, no LinuxCNC binding, no NML, no machine connection.
"""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import os
import subprocess
import sys

ROOT=Path('/tmp/r478')
sys.path.insert(0,str(ROOT/'tree/lcnc-gateway'))
from tool_proof import prove, STAT_FIELDS

old=b'T5 P5 Z10 D6 ; old remark\n'
target=b'T5 P9 Z11 D6 ; new remark\n'
old_path=ROOT/'old.tbl';old_path.write_bytes(old)
def sig(path):
    s=path.stat()
    return (s.st_dev,s.st_ino,s.st_mtime_ns,s.st_size,hashlib.sha256(path.read_bytes()).hexdigest())
def status(z):
    fields={attr:0.0 for _,attr in STAT_FIELDS}
    return [SimpleNamespace(id=-1,**fields),SimpleNamespace(id=5,**(fields|{'zoffset':z,'diameter':6}))]

out=[]
for name,mode,permissions in [('real load','load',0o444),
        ('foreign value update; save refused','offset',0o444),
        ('foreign value update; save succeeds','offset',0o644),
        ('foreign value update; permission removed after baseline','offset',0o644)]:
    path=ROOT/(name.split(';')[0].replace(' ','_')+'.tbl')
    if path.exists():path.chmod(0o644)
    path.write_bytes(target);path.chmod(permissions)
    before=sig(path)
    initial=prove(target,status(10),None)[2]
    if 'permission removed after baseline' in name:
        path.chmod(0o444)
    cp=subprocess.run([str(ROOT/'oracle/state'),str(old_path),str(path),mode],check=True,text=True,capture_output=True)
    row=next(s for s in cp.stdout.splitlines() if s.startswith('ROW '))
    data,_,comment=row.partition('|');w=data.split()
    values={attr:float(w[i+4]) for i,(_,attr) in enumerate(STAT_FIELDS)}
    memory=[status(10)[0],SimpleNamespace(id=int(w[2]),**values)]
    proof=prove(target,memory,None)[2]
    after=sig(path)
    plan_positive=initial['state']=='partial' and proof['state']=='complete' and before==after
    out.append({'case':name,'oracle':cp.stdout.strip(),'basis':initial,
                'V':proof,'S_unchanged':before==after,'actual_pocket':int(w[3]),
                'actual_remark':comment.strip(),'file_pocket':9,'file_remark':'new remark',
                'plan_confirmed_assuming_same_owner_newest_job':plan_positive})
    path.chmod(0o644)
assert out[0]['plan_confirmed_assuming_same_owner_newest_job']
assert out[1]['plan_confirmed_assuming_same_owner_newest_job']
assert out[1]['actual_pocket']==5
assert not out[2]['plan_confirmed_assuming_same_owner_newest_job']
assert out[3]['plan_confirmed_assuming_same_owner_newest_job']
assert out[3]['actual_pocket']==5
print(json.dumps({'kind':'upstream load/save + real Rule R; job and owner are plan assumptions',
                  'uid':os.getuid(),'cases':out},indent=2))

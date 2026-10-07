import json, math, struct
from pathlib import Path
root=Path(__file__).resolve().parents[1]
rows=[]
for directory in ('lcnc-gateway/machine','examples/sim_config/machine-5axis-xyzac','examples/sim_config/machine-xyzacb-gantry'):
    d=root/directory
    model=json.loads((d/'machine.json').read_text())
    for p in model['parts']:
        if p.get('collide') is False: continue
        data=(d/(p.get('collision') or p['file'])).read_bytes()
        n=struct.unpack_from('<I',data,80)[0]
        zeros=collinear=nonfinite=0
        for i in range(n):
            vals=struct.unpack_from('<9f',data,84+50*i+12)
            if not all(math.isfinite(v) for v in vals): nonfinite+=1;continue
            a,b,c=vals[:3],vals[3:6],vals[6:9]
            u=[b[j]-a[j] for j in range(3)];v=[c[j]-a[j] for j in range(3)]
            cr=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            if cr==[0,0,0]:
                zeros+=1
                if a!=b and b!=c and a!=c: collinear+=1
        rows.append(dict(model=directory,body=p['id'],triangles=n,zeroArea=zeros,threeDistinctCollinear=collinear,nonfinite=nonfinite))
print(json.dumps(rows,indent=2))

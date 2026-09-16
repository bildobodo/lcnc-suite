# SPDX-License-Identifier: GPL-2.0-or-later
"""Optional exact-solid acceptance after freecad_compact5.py.

Run COMPACT5_CAD_DIR=/tmp/compact5 freecadcmd scripts/freecad_check_compact5.py.
Checks 72 discrete poses, not continuous swept volumes. Bearing/mounting
contacts are permitted; different-group solids must not interpenetrate.
Does not save changes to the input FCStd or certify arbitrary programs.
"""
import FreeCAD as App, Part
import os, json, math
from pathlib import Path
out=Path(os.environ.get('COMPACT5_CAD_DIR', '/tmp/compact5'))
doc=App.openDocument(str(out/'Compact_500_XYZAC.FCStd'))
parts=[o for o in doc.Objects if 'SimulationGroup' in o.PropertiesList]
# All different-group pairs: mounting/bearing interfaces may touch but must not penetrate.
poses=[]
for x in (-250,0,250):
 for y in (-200,0,200):
  for a in (-110,-65,0,65,110):poses.append([x,y,500,a,35])
poses += [[0,0,z,0,c] for z in (100,200,350) for c in (0,45,90)]
poses += [[x,y,300,a,45] for x in (-80,0,80) for y in (-80,0,80) for a in (-25,25)]
collisions=[];checks=0
for index,q in enumerate(poses):
 for i,v in enumerate(q):doc.Motion.set('B'+str(i+2),'='+str(v)+(' mm' if i<3 else ' deg'))
 doc.recompute()
 shapes=[]
 for o in parts:
  s=o.Shape.copy();s.Placement=o.getGlobalPlacement();shapes.append(s)
 for i,a in enumerate(parts):
  for j,b in enumerate(parts[i+1:],i+1):
   if a.SimulationGroup==b.SimulationGroup:continue
   sa,sb=shapes[i],shapes[j];ba,bb=sa.BoundBox,sb.BoundBox
   if any(min(getattr(ba,k+'Max'),getattr(bb,k+'Max'))-max(getattr(ba,k+'Min'),getattr(bb,k+'Min'))<0.001 for k in 'XYZ'):continue
   checks+=1
   common=sa.common(sb)
   if common.Volume>0.1:collisions.append(dict(pose=q,a=a.Label,b=b.Label,volume=common.Volume))
 print('POSE',index+1,'/',len(poses),'collisions',len(collisions),flush=True)
with (out/'clearance-validation.json').open('w') as f:json.dump(dict(poses=len(poses),completed=index+1,boolean_checks=checks,collisions=collisions),f,indent=2)
print('RESULT',checks,len(collisions),flush=True)
assert not collisions, 'Unexpected interpenetration: see clearance-validation.json'

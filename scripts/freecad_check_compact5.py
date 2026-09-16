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
by_label = {o.Label.replace(' ', '_'): o for o in parts}


def world_shape(obj):
    shape = obj.Shape.copy()
    shape.Placement = obj.getGlobalPlacement()
    return shape


# These pairs share a rigid group, so a motion-only collision test misses
# overlapping accents/feet. Require real mating interfaces with no volume
# overlap and no coincident outward-facing planar surfaces (z-fighting).
interfaces = []
for first, second in [('rear_column', 'column_foot'),
                      ('a_bearing_pedestals', 'a_bearing_rings'),
                      ('spindle_head', 'z_slide')]:
    a, b = world_shape(by_label[first]), world_shape(by_label[second])
    volume = a.common(b).Volume
    assert volume < 0.1, f'{first}/{second}: overlapping solids'
    gap = a.distToShape(b)[0]
    assert gap < 1e-6, f'{first}/{second}: floating interface ({gap} mm)'
    outward_overlap = 0.0
    for fa in a.Faces:
        if type(fa.Surface).__name__ != 'Plane':
            continue
        for fb in b.Faces:
            if type(fb.Surface).__name__ != 'Plane':
                continue
            if fa.normalAt(0, 0).dot(fb.normalAt(0, 0)) < 0.999:
                continue
            outward_overlap += fa.common(fb).Area
    assert outward_overlap < 0.01, f'{first}/{second}: duplicate outward faces'
    interfaces.append(dict(parts=[first, second], overlap_mm3=volume,
                           mating_gap_mm=gap, outward_overlap_mm2=outward_overlap))

assert abs(by_label['z_slide'].Shape.BoundBox.YLength -
           by_label['x_saddle'].Shape.BoundBox.YLength) < 1e-6
assert abs(by_label['spindle_head'].Shape.BoundBox.YMax -
           by_label['z_slide'].Shape.BoundBox.YMin) < 1e-6
# The rear buttresses are part of the casting and land above a supported foot.
assert len(by_label['rear_column'].Shape.Solids) == 1
assert by_label['column_foot'].Shape.BoundBox.YMax >= by_label['rear_column'].Shape.BoundBox.YMax + 20 - 1e-6
assert by_label['machine_bed'].Shape.BoundBox.YMax >= by_label['column_foot'].Shape.BoundBox.YMax + 20 - 1e-6
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
with (out/'clearance-validation.json').open('w') as f:json.dump(dict(poses=len(poses),completed=index+1,boolean_checks=checks,collisions=collisions,interfaces=interfaces),f,indent=2)
print('RESULT',checks,len(collisions),flush=True)
assert not collisions, 'Unexpected interpenetration: see clearance-validation.json'

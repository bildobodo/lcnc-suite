# SPDX-License-Identifier: GPL-2.0-or-later
"""TWP wall-gantry example. Run with FreeCAD's Python interpreter/freecadcmd.

Independent design, using the kinematic contract of lcnc-suite feat/twp.
Units mm / degrees. Geometry parameters live here; the FCStd Motion sheet
drives all six joints. STL exports are in group-local coordinates.
"""
import FreeCAD as App
import Part, MeshPart
import json, math, os, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
STLDIR = ROOT / 'examples/sim_config/machine-xyzacb-gantry'
STLDIR.mkdir(parents=True, exist_ok=True)
# Optional editable assembly and STEP export; never required to run the sim.
CAD_DIR = os.environ.get('TWP_GANTRY_CAD_DIR')
OUT = pathlib.Path(CAD_DIR).expanduser().resolve() if CAD_DIR else None
if OUT: OUT.mkdir(parents=True, exist_ok=True)
V = App.Vector
NU, PY, PZ = 45.0, 140.0, 480.0
N = V(0, math.sin(math.radians(NU)), math.cos(math.radians(NU)))
TABLE_R = 720.0
TABLE_THICKNESS = 180.0
HEAD_RADIUS = 280.0
JOINT_T = 0.0  # Physical B bearing at the C/B frame origin.
JOINT_BOSS_RADIUS = 190.0
UPPER_BOTTOM = -160.0
LOWER_TOP = 270.0
HEAD_TOP = 400.0  # In the C/B frame; spindle nose is at -PZ.
GUIDE = dict(series='THK SRG100LC dimensional reference',
             rail_width_mm=100, rail_height_mm=77, block_width_mm=250,
             block_length_mm=395, block_body_length_mm=280.2,
             assembly_height_mm=120, block_bottom_mm=16, rail_hole_pitch_mm=105,
             flange_thickness_mm=35, rail_counterbore_diameter_mm=39,
             rail_counterbore_depth_mm=32)
GUIDE_HEIGHT = GUIDE['assembly_height_mm']
# Keep the 220 mm Y carriage and the existing ram/head datum: the two
# thicker guide stacks move the beam 60 mm back, not the spindle forwards.
Y_RAIL_X = -300 - GUIDE_HEIGHT * 2 - 220
BRIDGE_SHIFT_X = Y_RAIL_X - (-700)
BRIDGE_LIFT_Z = GUIDE_HEIGHT - 90
WALL_BASE = -1050.0
WALL_TOP = 2025.0  # 3075 mm wall height, 25% less than V8's 4100 mm.
MACHINE_ZERO_Y = -PY  # C/ram centre at world Y=0 when joint Y=0.
MACHINE_ZERO_Z = 1325.0
LIMITS = [[-1500,1500],[-1300,1300],[-1325,0],[-360,360],[-185,185],[-320,320]]
DEMO = [0, 0, -475, 0, 0, 0]
WORK_POSE = [0, 140, -475, 0, 0, 0]
COL = {'cast': [0.39,0.43,0.46], 'paint':[0.78,0.80,0.79],
       'dark':[0.15,0.19,0.22], 'steel':[0.64,0.68,0.70],
       'accent':[0.12,0.39,0.43], 'stock':[0.67,0.59,0.43]}

def box(x0,y0,z0,x1,y1,z1):
    return Part.makeBox(x1-x0,y1-y0,z1-z0,V(x0,y0,z0))

def bevel(s, r=8):
    try: return s.makeChamfer(r,s.Edges)
    except Exception as exc:
        print('Chamfer omitted:', exc, flush=True)
        return s

def cyl(r,h,origin=(0,0,0),axis=(0,0,1)):
    return Part.makeCylinder(r,h,V(*origin),V(*axis))

def cone(r0,r1,h,origin=(0,0,0),axis=(0,0,1)):
    return Part.makeCone(r0,r1,h,V(*origin),V(*axis))

def fuse(shapes):
    if len(shapes)==1: return shapes[0]
    return shapes[0].multiFuse(shapes[1:]).removeSplitter()

def compound(shapes): return Part.makeCompound(shapes)

def along(r,t0,t1): return Part.makeCylinder(r,t1-t0,N*t0,N)

def halfspace(t,positive):
    s=box(-1000,-1000,0,1000,1000,2000)
    s.Placement=App.Placement(N*t, App.Rotation(V(0,0,1),N if positive else -N))
    return s

# Common simplified SRG100 section, shared by all three linear axes.
# Local X = travel, Y = transverse, Z = normal to the rail mounting plane.
def guide_rail(length):
    # Scale the independently drawn groove profile to the catalog envelope;
    # this is a visual model, not a copy of the manufacturer's raceways.
    section=[(-29.5,0),(29.5,0),(31.5,2),(31.5,18),(27.5,23),
             (27.5,32),(31.5,37),(31.5,50),(28.5,53),(-28.5,53),
             (-31.5,50),(-31.5,37),(-27.5,32),(-27.5,23),(-31.5,18),(-31.5,2)]
    section=[(y*GUIDE['rail_width_mm']/63,z*GUIDE['rail_height_mm']/53) for y,z in section]
    wire=Part.makePolygon([V(0,y,z) for y,z in section+[section[0]]])
    rail=Part.Face(wire).extrude(V(length,0,0))
    pitch=GUIDE['rail_hole_pitch_mm']
    count=int((length-60)//pitch)+1
    edge=(length-(count-1)*pitch)/2
    # Symmetric mounting pattern; shallow counterbores keep the mesh compact.
    depth=GUIDE['rail_counterbore_depth_mm']
    cuts=[cyl(GUIDE['rail_counterbore_diameter_mm']/2,depth+1,
              (edge+i*pitch,0,GUIDE['rail_height_mm']-depth)) for i in range(count)]
    rail=rail.cut(compound(cuts)).removeSplitter()
    if length>3900:
        width=GUIDE['rail_width_mm']/2+1
        rail=rail.cut(box(length/2-0.1,-width,-1,length/2+0.1,width,GUIDE['rail_height_mm']+1))
    return rail

def guide_block():
    half_body=GUIDE['block_body_length_mm']/2
    half_length=GUIDE['block_length_mm']/2
    half_width=GUIDE['block_width_mm']/2
    bottom=GUIDE['block_bottom_mm']
    flange_z=GUIDE_HEIGHT-GUIDE['flange_thickness_mm']
    # Broad mounting flange over a narrower roller body and dark end caps.
    body=bevel(fuse([box(-half_body,-90,bottom,half_body,90,GUIDE_HEIGHT),
                    box(-half_body,-half_width,flange_z,half_body,half_width,GUIDE_HEIGHT)]),3)
    ends=compound([bevel(box(x0,-89,bottom,x1,89,GUIDE_HEIGHT-5),2)
                   for x0,x1 in [(-half_length,-half_body),(half_body,half_length)]])
    channel_width=GUIDE['rail_width_mm']/2+0.5
    channel=box(-half_length-1,-channel_width,0,half_length+1,channel_width,GUIDE['rail_height_mm']+1)
    # SRG100LC: six flange holes and three central blind holes, simplified.
    holes=compound([cyl(8.9,36,(x,y,flange_z-0.5)) for x in (-100,0,100) for y in (-110,110)] +
                   [cyl(8.9,23,(x,0,GUIDE_HEIGHT-22)) for x in (-100,0,100)])
    return body.cut(channel).cut(holes), ends.cut(channel)

def guide_place(shape, origin, travel, normal):
    s=shape.copy()
    u,w=V(*travel),V(*normal)
    s.Placement=App.Placement(V(*origin),App.Rotation(u,w.cross(u),w,'ZXY'))
    return s

block_body,block_ends=guide_block()
guide_layout=[]

def guide_set(axis,rail_group,block_group,lanes,rail_start,rail_length,
              block_centres,travel,normal):
    # Lanes are expressed at longitudinal coordinate zero in the rail group.
    rails=[];bodies=[];ends=[]
    prototype=guide_rail(rail_length)
    u=V(*travel)
    for origin in lanes:
        origin=V(*origin)
        rails.append(guide_place(prototype,tuple(origin+u*rail_start),travel,normal))
        for centre in block_centres:
            p=tuple(origin+u*centre)
            bodies.append(guide_place(block_body,p,travel,normal))
            ends.append(guide_place(block_ends,p,travel,normal))
    add(axis+'_guide_rails',rail_group,'steel',compound(rails))
    add(axis+'_guide_blocks',block_group,'steel',compound(bodies))
    add(axis+'_guide_endcaps',block_group,'dark',compound(ends))
    guide_layout.append(dict(axis=axis,rail_group=rail_group,block_group=block_group,
        lanes=lanes,rail_start=rail_start,rail_length=rail_length,
        block_centres=block_centres,travel=travel,normal=normal,
        rail_count=len(lanes),segments_per_rail=2 if rail_length>3900 else 1,block_count=len(lanes)*len(block_centres)))

if 'TWP_Realistic' in App.listDocuments(): App.closeDocument('TWP_Realistic')
doc=App.newDocument('TWP_Realistic')
motion=doc.addObject('Spreadsheet::Sheet','Motion')
motion.Label='Achsen / Motion (mm, deg)'
motion.set('A1','Joint'); motion.set('B1','Value'); motion.set('C1','Range')
for i,(axis,val,limits) in enumerate(zip('XYZABC',DEMO,
        [f'{a} … {b} '+('mm' if j<3 else 'deg') for j,(a,b) in enumerate(LIMITS)]),2):
    motion.set('A'+str(i),axis)
    motion.set('B'+str(i),'='+str(val)+(' mm' if i<5 else ' deg'))
    motion.setAlias('B'+str(i),'Joint'+axis)
    motion.set('C'+str(i),limits)
motion.setColumnWidth('A',75); motion.setColumnWidth('B',105); motion.setColumnWidth('C',190)

groups=[
 {'id': 'x_bridge', 'parent': 'root', 'translate': [-1000, 0, 0]},
 {'id': 'y_saddle', 'parent': 'x_bridge', 'translate': [0, MACHINE_ZERO_Y, 0]},
 {'id': 'xyz_head', 'parent': 'y_saddle', 'translate': [0, 0, MACHINE_ZERO_Z]},
 {'id': 'c_swivel', 'parent': 'xyz_head', 'translate': [0, PY, PZ]},
 {'id': 'b_nut', 'parent': 'c_swivel'},
 {'id': 'tool', 'parent': 'b_nut', 'translate': [0, -PY, -PZ]},
 {'id': 'a_table', 'parent': 'root', 'translate': [-1700.0, 0.0, 0.0]},
 {'id': 'a_work', 'parent': 'a_table', 'translate': [700, MACHINE_ZERO_Y, MACHINE_ZERO_Z]}
]
kins=[
 {'group': 'x_bridge', 'joint': 0, 'type': 'translate', 'direction': 'x', 'sign': 1},
 {'group': 'y_saddle', 'joint': 1, 'type': 'translate', 'direction': 'y', 'sign': 1},
 {'group': 'xyz_head', 'joint': 2, 'type': 'translate', 'direction': 'z', 'sign': 1},
 {'group': 'a_table', 'joint': 3, 'type': 'rotate', 'direction': 'x', 'sign': -1},
 {'group': 'b_nut', 'joint': 4, 'type': 'rotate', 'axis': [N.x, N.y, N.z], 'sign': 1},
 {'group': 'c_swivel', 'joint': 5, 'type': 'rotate', 'direction': 'z', 'sign': 1}
]
bygroup={k['group']:k for k in kins}
cadgroups={}
for g in groups:
    obj=doc.addObject('App::Part',g['id'])
    obj.Label=g['id']
    cadgroups[g['id']]=obj
    if g['parent']!='root': cadgroups[g['parent']].addObject(obj)
    obj.Placement.Base=V(*g.get('translate',[0,0,0]))
    if g['id'] in bygroup:
        k=bygroup[g['id']]; letter='XYZABC'[k['joint']]
        obj.addProperty('App::PropertyString','SimulationJoint').SimulationJoint=letter
        if k['type']=='translate':
            idx='xyz'.index(k['direction']); base=g.get('translate',[0,0,0])[idx]
            obj.setExpression('Placement.Base.'+k['direction'],f'{base} mm + Motion.Joint{letter}')
        else:
            axis=k.get('axis',{'x':[1,0,0],'z':[0,0,1]}.get(k.get('direction')))
            obj.Placement.Rotation=App.Rotation(V(*axis),1)
            obj.setExpression('Placement.Rotation.Angle',f'{k["sign"]} * Motion.Joint{letter}')

parts=[]; local_shapes={}; objects={}
def add(name,group,color,shape,stock=False):
    assert not shape.isNull() and shape.isValid(), name+' invalid'
    assert len(shape.Solids)>0 and shape.Volume>0, name+' not solid'
    o=doc.addObject('PartDesign::Feature',name)
    o.Label=name.replace('_',' ')
    o.Shape=shape
    o.addProperty('App::PropertyString','SimulationGroup').SimulationGroup=group or 'root'
    if group: cadgroups[group].addObject(o)
    if App.GuiUp:
        o.ViewObject.ShapeColor=tuple(COL[color]); o.ViewObject.LineColor=(0.12,0.14,0.15)
    p={'id':name,'file':name+'.stl','group':group,'translate':[0,0,0],'color':COL[color]}
    if stock:p['stock']=True
    parts.append(p); local_shapes[name]=shape; objects[name]=o

# Fixed bed and continuous side walls lowered by 25%, with unchanged wall thickness and spacing.
add('bed',None,'cast',bevel(box(-4330,-3150,-1650,1450,3150,-1050),45))
add('chip_tray',None,'dark',box(-3950,-2090,-1050,1270,2090,-990))
add('x_side_walls',None,'paint',compound([
    bevel(box(-4220,y-440,-1050,1320,y+440,WALL_TOP),30) for y in (-2550,2550)]))
add('leveling_pads',None,'dark',compound([
    cyl(175,90,(x,y,-1740)) for x in (-3800,-2000,-300,1100) for y in (-2700,2700)]))
guide_set('x',None,'x_bridge',[(0,y+d,WALL_TOP) for y in (-2550,2550)
    for d in (-265,265)],-4190,5440,[x+BRIDGE_SHIFT_X for x in (-1405,-785)],(1,0,0),(0,0,1))

# Four X blocks on each wall carry a separate 200 mm saddle plate.
add('x_saddle_plates','x_bridge','cast',compound([
    bevel(box(-1650+BRIDGE_SHIFT_X,y-475,WALL_TOP+GUIDE_HEIGHT,
              -540+BRIDGE_SHIFT_X,y+475,WALL_TOP+GUIDE_HEIGHT+200),16) for y in (-2550,2550)]))
# The crossbeam sits on both saddle plates. There are no moving columns.
add('x_bridge_casting','x_bridge','paint',bevel(box(-1490+BRIDGE_SHIFT_X,-2950,WALL_TOP+GUIDE_HEIGHT+200,
    Y_RAIL_X,2950,WALL_TOP+1240+BRIDGE_LIFT_Z),25))
add('x_drive_housings','x_bridge','accent',compound([
    bevel(box(-1425+BRIDGE_SHIFT_X,y-230,WALL_TOP+1240+BRIDGE_LIFT_Z,
              -765+BRIDGE_SHIFT_X,y+230,WALL_TOP+1450+BRIDGE_LIFT_Z),18) for y in (-2550,2550)]))
add('bridge_rear_panel','x_bridge','dark',box(-1497+BRIDGE_SHIFT_X,-2250,WALL_TOP+380+BRIDGE_LIFT_Z,
    -1491+BRIDGE_SHIFT_X,2250,WALL_TOP+1150+BRIDGE_LIFT_Z))
guide_set('y','x_bridge','y_saddle',[(Y_RAIL_X,0,z+BRIDGE_LIFT_Z) for z in (WALL_TOP+390,WALL_TOP+1140)],
          -2925,5850,[PY-280,PY+280],(0,1,0),(1,0,0))

# Y and Z block/rail pairs use the same 120 mm installation stack.
# Rail-pair and block-pair centres coincide with their carriage centre lines.
add('y_carriage','y_saddle','accent',bevel(box(Y_RAIL_X+GUIDE_HEIGHT,PY-510,WALL_TOP+GUIDE_HEIGHT,
    -300-GUIDE_HEIGHT,PY+510,WALL_TOP+1440+BRIDGE_LIFT_Z),20))
add('z_ram','xyz_head','paint',bevel(box(-300,PY-340,HEAD_TOP+PZ+10,300,PY+340,WALL_TOP+1320+BRIDGE_LIFT_Z),22))
guide_set('z','xyz_head','y_saddle',[(-300,y,0) for y in (PY-200,PY+200)],
          920,2425,[z+BRIDGE_LIFT_Z for z in (WALL_TOP+465,WALL_TOP+1065)],(0,0,1),(-1,0,0))
add('z_top_motor','xyz_head','dark',bevel(box(-180,PY-210,WALL_TOP+1320+BRIDGE_LIFT_Z,
    180,PY+210,WALL_TOP+1620+BRIDGE_LIFT_Z),20))

# Offset universal head following the user's section sketch. Both housings
# are finite cylinders, so the 45-degree cut terminates at broad flat shoulders.
# C/ram centreline is Y=+PY in the XYZ frame; the neutral spindle is at Y=0.
upper_casting=cyl(HEAD_RADIUS,HEAD_TOP-UPPER_BOTTOM,(0,0,UPPER_BOTTOM)).common(halfspace(8,True))
upper=fuse([upper_casting,along(JOINT_BOSS_RADIUS,2,10)])
add('c_head','c_swivel','accent',upper)
lower_casting=cyl(HEAD_RADIUS,LOWER_TOP+PZ-55,(0,-PY,-PZ+55)).common(halfspace(-8,False))
lower=fuse([cone(270,HEAD_RADIUS,15,(0,-PY,-PZ+40)),
            lower_casting,along(JOINT_BOSS_RADIUS,-10,-2)])
add('b_head','b_nut','paint',lower)
spindle=fuse([cone(65,90,24,(0,-PY,-PZ)),cyl(90,10,(0,-PY,-PZ+24)),
             cyl(155,6,(0,-PY,-PZ+34))])
spindle=spindle.cut(compound([cyl(5,4,(135*math.cos(math.radians(a)),
    -PY+135*math.sin(math.radians(a)),-PZ+33)) for a in range(0,360,45)]))
add('spindle_nose','b_nut','steel',spindle)
add('c_mount_ring','xyz_head','steel',cyl(290,10,(0,PY,HEAD_TOP+PZ)))
ring=along(JOINT_BOSS_RADIUS+1,-8,-2).cut(along(JOINT_BOSS_RADIUS,-9,-1))
add('b_joint_ring','b_nut','steel',ring)

# A-side rotary fixture. The kinematic axis and stock placement are kept;
# faceplate diameter and thickness are reduced to useful proportions.
support=fuse([bevel(box(-2700,-720,-1050,-1800,720,-850),30),
              bevel(box(-2580,-650,-900,-1910,650,-350),35),
              cyl(580,435,(-2340,0,0),(1,0,0)),
              box(-2580,-470,-610,-1905,470,0)])
add('a_headstock',None,'paint',support)
add('a_bearing_ring',None,'dark',cyl(490,25,(-1905,0,0),(1,0,0)))
disk=cyl(TABLE_R,TABLE_THICKNESS,(-TABLE_THICKNESS,0,0),(1,0,0))
# Radial face grooves and bolt holes are cut into the actual solid.
cuts=[]
for ang in range(0,360,45):
    slot=box(-12,120,-8,2,TABLE_R-35,8)
    slot.rotate(V(0,0,0),V(1,0,0),ang); cuts.append(slot)
    a=math.radians(ang+22.5)
    cuts.append(cyl(12,25,(-24,650*math.cos(a),650*math.sin(a)),(1,0,0)))
disk=disk.cut(compound(cuts)).removeSplitter()
add('a_faceplate','a_table','steel',disk)
add('a_drive_cover',None,'accent',cyl(300,28,(-2368,0,0),(1,0,0)))
console=bevel(box(0,-490,-110,1050,490,0),12)
console=console.cut(compound([box(24,y-7,-17,1020,y+7,2) for y in (-370,-250,250,370)]))
add('fixture_plate','a_table','cast',console)
# Short gussets stay within the rotary disk radius and support the plate.
gussets=[]
for y in (-350,350):
    wire=Part.makePolygon([V(8,y-14,-110),V(950,y-14,-110),V(8,y-14,-420),V(8,y-14,-110)])
    gussets.append(Part.Face(wire).extrude(V(0,28,0)))
add('fixture_ribs','a_table','cast',compound(gussets))
add('work_piece','a_table','stock',box(300,-300,0,900,300,600),True)

doc.recompute()
assert not any('Invalid' in o.State for o in doc.Objects), 'invalid document expressions'
assert abs(cadgroups['xyz_head'].Placement.Base.z-(MACHINE_ZERO_Z+DEMO[2]))<1e-6
machine={'name':'TWP 45 — Wall Gantry',
 'source':'Independent FreeCAD geometry; XYZACB-TRSRN kinematic frames from LinuxCNC/lcnc-suite (GPL-2.0-or-later).',
 'groups':groups,'parts':parts,'kinematics':kins,
 'workGroup':'a_work','toolGroup':'tool'}
(STLDIR/'machine.json').write_text(json.dumps(machine,indent=2)+'\n')
report={'parts':[],'reference_commit':'f8c5339','cad_pose':DEMO,
 'head':{'c_housing_diameter_mm':2*HEAD_RADIUS,'b_spindle_housing_diameter_mm':2*HEAD_RADIUS,
         'joint_plane_offset_mm':JOINT_T,'joint_gap_mm':4,
         'housing_cut_gap_mm':16,'cut_angle_deg':NU,
         'neutral_c_to_spindle_offset_y_mm':-PY,
         'upper_flat_bottom_z_mm':UPPER_BOTTOM,'lower_flat_top_z_mm':LOWER_TOP,
         'upper_shoulder_width_in_yz_section_mm':HEAD_RADIUS+UPPER_BOTTOM-8/N.z,
         'lower_shoulder_width_in_yz_section_mm':HEAD_RADIUS+PY-LOWER_TOP-8/N.z,
         'boss_diameter_mm':2*JOINT_BOSS_RADIUS,'top_z_in_c_frame_mm':HEAD_TOP,
         'total_height_mm':HEAD_TOP+PZ+10},
 'linear_guides':dict(GUIDE,layout=guide_layout),
 'wall_top_z_mm':WALL_TOP,'wall_base_z_mm':WALL_BASE,
 'wall_height_mm':WALL_TOP-WALL_BASE,'wall_height_reduction_percent':25,
 'machine_zero_world_mm':[-1000,MACHINE_ZERO_Y,MACHINE_ZERO_Z],
 'joint_limits':LIMITS,'work_pose':WORK_POSE,'x_saddle_plate_thickness_mm':200,
 'x_blocks_per_wall':4,
 'pins':{'nut-angle':NU,'y-pivot':PY,'z-pivot':PZ,'x-offset':0,'y-offset':0,
         'y-rot-axis':-MACHINE_ZERO_Y,'z-rot-axis':-MACHINE_ZERO_Z}}
for p in parts:
    shape=local_shapes[p['id']]
    mesh=MeshPart.meshFromShape(Shape=shape,LinearDeflection=0.65,AngularDeflection=0.14,Relative=False)
    assert mesh.isSolid(), p['id']+' STL is not closed'
    mesh.write(str(STLDIR/p['file']))
    report['parts'].append({'id':p['id'],'valid':shape.isValid(),
        'solids':len(shape.Solids),'volume_mm3':shape.Volume,
        'triangles':mesh.CountFacets,'closed':mesh.isSolid()})
    print(p['id'],len(shape.Solids),mesh.CountFacets,flush=True)
doc.recompute()
if OUT:
    doc.saveAs(str(OUT/'TWP_45_Gantry.FCStd'))
    # Export STEP in the visible demo pose, with named component solids.
    stepdoc=App.newDocument('STEP_Export')
    stepobjs=[]
    for p in parts:
        s=local_shapes[p['id']].copy()
        s.Placement=objects[p['id']].getGlobalPlacement()
        o=stepdoc.addObject('PartDesign::Feature',p['id']); o.Label=p['id']; o.Shape=s
        stepobjs.append(o)
    stepdoc.recompute()
    import Import
    Import.export(stepobjs,str(OUT/'TWP_45_Gantry.step'))
    App.closeDocument(stepdoc.Name)
    (OUT/'geometry-validation.json').write_text(json.dumps(report,indent=2)+'\n')
for old_stl in STLDIR.glob('*.stl'):
    if old_stl.name not in {p['file'] for p in parts}:old_stl.unlink()
print('DONE',len(parts),'parts',sum(x['triangles'] for x in report['parts']),'triangles',flush=True)

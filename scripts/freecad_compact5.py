# SPDX-License-Identifier: GPL-2.0-or-later
"""Original compact XYZAC machining centre. Run with FreeCAD's freecadcmd.

Set COMPACT5_CAD_DIR for optional FCStd, STEP and embedded-preview data.
The exported STL coordinates are local to the machine.json groups.
This is an illustrative machine, not manufacturing drawings or an OEM copy.
"""
import json
import math
import os
from pathlib import Path

import FreeCAD as App
import MeshPart
import Part

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'examples/sim_config/machine-xyzac-compact'
OUT = Path(os.environ['COMPACT5_CAD_DIR']) if os.environ.get('COMPACT5_CAD_DIR') else None
DEST.mkdir(parents=True, exist_ok=True)
if OUT:
    OUT.mkdir(parents=True, exist_ok=True)
V = App.Vector
LIMITS = [[-250, 250], [-200, 200], [100, 500], [-110, 110], [-36000, 36000]]
POSE = [0, 0, 350, 0, 0]
FLOOR_Z = -905
X_GUIDE_Y = 475
Z_GUIDE_Y = 315
Z_PLATE_FRONT = 155
Z_PLATE_BACK = 255
BEARING_INNER = 365
BEARING_WIDTH = 190
BEARING_OUTER = BEARING_INNER + BEARING_WIDTH
YOKE_INNER = 235
YOKE_OUTER = 345
GUIDE = dict(reference='HIWIN HGW45HC / HGR45 envelope; independently drawn simplified profile',
             rail_width=45, rail_height=38, block_width=120, block_length=171.2,
             body_length=128.8, assembly_height=60, hole_pitch=105)
COL = {'cast': [0.32, 0.37, 0.40], 'paint': [0.80, 0.82, 0.81],
       'dark': [0.16, 0.20, 0.23], 'steel': [0.65, 0.70, 0.72],
       'accent': [0.12, 0.40, 0.43], 'stock': [0.72, 0.62, 0.43]}


def box(x0, y0, z0, x1, y1, z1):
    return Part.makeBox(x1-x0, y1-y0, z1-z0, V(x0, y0, z0))


def cyl(r, h, p=(0, 0, 0), axis=(0, 0, 1)):
    return Part.makeCylinder(r, h, V(*p), V(*axis))


def compound(shapes):
    return Part.makeCompound(shapes)


def fuse(shapes):
    return shapes[0].multiFuse(shapes[1:]).removeSplitter() if len(shapes) > 1 else shapes[0]


def bevel(shape, r=6):
    try:
        return shape.makeChamfer(r, shape.Edges)
    except Exception:
        return shape


def yz_profile(points, x0, width):
    wire = Part.makePolygon([V(x0, y, z) for y, z in points + points[:1]])
    return Part.Face(wire).extrude(V(width, 0, 0))


GROUPS = [dict(id='y_table', parent='root'), dict(id='a_yoke', parent='y_table'),
          dict(id='c_platter', parent='a_yoke'), dict(id='x_saddle', parent='root'),
          dict(id='z_head', parent='x_saddle'), dict(id='tool', parent='z_head')]
KINS = [dict(group='x_saddle', joint=0, type='translate', direction='x', sign=1),
        dict(group='y_table', joint=1, type='translate', direction='y', sign=-1),
        dict(group='z_head', joint=2, type='translate', direction='z', sign=1),
        dict(group='a_yoke', joint=3, type='rotate', direction='x', sign=1),
        dict(group='c_platter', joint=4, type='rotate', direction='z', sign=1)]
doc = App.newDocument('Compact_5_Axis')
motion = doc.addObject('Spreadsheet::Sheet', 'Motion')
motion.set('A1', 'Axis'); motion.set('B1', 'Position'); motion.set('C1', 'Limits')
for row, (axis, value, limits) in enumerate(zip('XYZAC', POSE, LIMITS), 2):
    unit = ' mm' if row < 5 else ' deg'
    motion.set(f'A{row}', axis)
    motion.set(f'B{row}', '=' + str(value) + unit)
    motion.setAlias(f'B{row}', 'Joint' + axis)
    motion.set(f'C{row}', f'{limits[0]} to {limits[1]}{unit}')
cadgroups = {}
for g in GROUPS:
    o = doc.addObject('App::Part', g['id'])
    cadgroups[g['id']] = o
    if g['parent'] != 'root':
        cadgroups[g['parent']].addObject(o)
    k = next((k for k in KINS if k['group'] == g['id']), None)
    if k:
        expression = f'{k["sign"]} * Motion.Joint{"XYZAC"[k["joint"]]}'
        if k['type'] == 'translate':
            o.setExpression('Placement.Base.' + k['direction'], expression)
        else:
            axis = (1, 0, 0) if k['direction'] == 'x' else (0, 0, 1)
            o.Placement.Rotation = App.Rotation(V(*axis), 1)
            o.setExpression('Placement.Rotation.Angle', expression)
parts, shapes, objects = [], {}, {}


def add(name, group, color, shape, stock=False):
    assert shape.isValid() and shape.Volume > 0 and shape.Solids, name
    o = doc.addObject('PartDesign::Feature', name)
    o.Label = name.replace('_', ' ')
    o.Shape = shape
    o.addProperty('App::PropertyString', 'SimulationGroup').SimulationGroup = group or 'root'
    if group:
        cadgroups[group].addObject(o)
    if App.GuiUp:
        o.ViewObject.ShapeColor = tuple(COL[color])
    p = dict(id=name, file=name + '.stl', group=group, color=COL[color])
    if stock:
        p['stock'] = True
    parts.append(p); shapes[name] = shape; objects[name] = o


# Six levelling feet, deep bed, wide rear casting. Recesses leave thick ribs.
add('levelling_feet', None, 'dark', compound([
    cyl(85, 45, (x, y, FLOOR_Z)) for x in (-630, 630) for y in (-620, 50, 740)]))
bed = bevel(box(-770, -790, -860, 770, 920, -540), 25)
bed = bed.cut(compound([bevel(box(x-170, -802, -795, x+170, -748, -625), 18)
                       for x in (-465, 0, 465)]))
add('machine_bed', None, 'cast', bed)
# The column sits ON its foot. The lower leg stays back for trunnion clearance;
# the forward upper face brings both head slides closer to the spindle axis.
column = yz_profile([(560, -405), (900, -405), (900, 1190), (555, 1190),
                     (X_GUIDE_Y, 1090), (X_GUIDE_Y, 350), (540, 200)], -720, 1440)
column = bevel(column, 14)
column = column.cut(compound([bevel(box(x-145, 850, -280, x+145, 935, 950), 20)
                             for x in (-470, 0, 470)]))
add('rear_column', None, 'paint', column)
add('column_foot', None, 'cast', bevel(box(-740, 535, -540, 740, 915, -405), 12))
rail_seats = compound([box(x-75, -515, -540, x+75, 515, -520) for x in (-320, 320)])
add('chip_pan', None, 'dark', bevel(box(-600, -690, -539, 600, 505, -527), 4).cut(rail_seats))

# Shared 45 mm profile and long flanged blocks, two rails / four blocks per axis.
def rail(length):
    section = [(-20, 0), (20, 0), (22.5, 2.5), (22.5, 11), (19, 15),
               (19, 23), (22.5, 27), (22.5, 35), (19.5, 38), (-19.5, 38),
               (-22.5, 35), (-22.5, 27), (-19, 23), (-19, 15), (-22.5, 11), (-22.5, 2.5)]
    wire = Part.makePolygon([V(0, y, z) for y, z in section + section[:1]])
    s = Part.Face(wire).extrude(V(length, 0, 0))
    n = int((length-60) // 105) + 1
    edge = (length-(n-1)*105)/2
    return s.cut(compound([cyl(10, 15, (edge+i*105, 0, 24)) for i in range(n)]))


channel = box(-87, -23, 0, 87, 23, 39)
block_body = bevel(fuse([box(-64.4, -40, 9.5, 64.4, 40, 60),
                         box(-64.4, -60, 45, 64.4, 60, 60)]), 2)
block_body = block_body.cut(channel).cut(compound([
    cyl(6, 16, (x, y, 44.5)) for x in (-40, 40) for y in (-50, 50)]))
block_ends = compound([bevel(box(a, -40, 10, b, 40, 56), 2)
                       for a, b in [(-85.6, -64.4), (64.4, 85.6)]]).cut(channel)
layouts = []


def placed(shape, origin, travel, normal):
    s = shape.copy(); u, w = V(*travel), V(*normal)
    s.Placement = App.Placement(V(*origin), App.Rotation(u, w.cross(u), w, 'ZXY'))
    return s


def guides(axis, fixed, moving, lanes, start, length, centres, travel, normal):
    rails, bodies, ends = [], [], []
    for origin in lanes:
        origin, u = V(*origin), V(*travel)
        rails.append(placed(rail(length), tuple(origin + u*start), travel, normal))
        for c in centres:
            p = tuple(origin + u*c)
            bodies.append(placed(block_body, p, travel, normal))
            ends.append(placed(block_ends, p, travel, normal))
    for suffix, group, color, solids in [('rails', fixed, 'steel', rails),
                                        ('blocks', moving, 'steel', bodies),
                                        ('endcaps', moving, 'accent', ends)]:
        add(axis + '_guide_' + suffix, group, color, compound(solids))
    layouts.append(dict(axis=axis, lanes=lanes, rail_start=start, rail_length=length,
                        block_centres=centres, travel=travel, normal=normal,
                        fixed=fixed, moving=moving, rails=2, blocks=4))


add('y_rail_seats', None, 'cast', rail_seats)
guides('y', None, 'y_table', [(-320, 0, -520), (320, 0, -520)], -500, 1000,
       [-150, 150], (0, 1, 0), (0, 0, 1))
add('y_saddle', 'y_table', 'paint', bevel(box(-580, -280, -460, 580, 280, -320), 12))
guides('x', None, 'x_saddle', [(0, X_GUIDE_Y, 400), (0, X_GUIDE_Y, 990)], -690, 1380,
       [-150, 150], (1, 0, 0), (0, -1, 0))
add('x_saddle', 'x_saddle', 'cast', bevel(box(-245, Z_GUIDE_Y, 325, 245, X_GUIDE_Y-60, 1155), 10))
guides('z', 'x_saddle', 'z_head', [(-130, Z_GUIDE_Y, 0), (130, Z_GUIDE_Y, 0)], 325, 820,
       [325, 545], (0, 0, 1), (0, -1, 0))
add('z_slide', 'z_head', 'paint', bevel(box(-205, Z_PLATE_FRONT, 85, 205, Z_PLATE_BACK, 645), 8))

# The head casting mounts directly to the full-thickness Z plate, without a spacer.
head = bevel(box(-175, -145, 85, 175, Z_PLATE_FRONT, 445), 22)
add('spindle_head', 'z_head', 'paint', head)
add('spindle_motor_cover', 'z_head', 'accent', bevel(box(-125, -112, 445, 125, 125, 585), 16))
add('spindle_cartridge', 'z_head', 'dark', fuse([
    cyl(112, 28, (0, 0, 57)), Part.makeCone(65, 100, 42, V(0, 0, 15))]))
nose = cyl(65, 15).cut(cyl(20, 17, (0, 0, -1)))
add('spindle_nose', 'z_head', 'steel', nose)

# Symmetric bearing pedestals, bored for actual shafts. A rotates about X.
support_profile = [(-250, -320), (250, -320), (190, -120), (155, 40),
                   (130, 115), (-130, 115), (-155, 40), (-190, -120)]
supports, rings, covers = [], [], []
for x0 in (-BEARING_OUTER, BEARING_INNER):
    body = fuse([yz_profile(support_profile, x0, BEARING_WIDTH),
                 cyl(165, BEARING_WIDTH, (x0, 0, 0), (1, 0, 0))])
    body = bevel(body, 7).cut(cyl(124, BEARING_WIDTH+2, (x0-1, 0, 0), (1, 0, 0)))
    supports.append(body)
    # Rings project from the inner face instead of sharing its exposed plane.
    inner = -BEARING_INNER if x0 < 0 else BEARING_INNER-12
    rings.append(cyl(170, 12, (inner, 0, 0), (1, 0, 0)).cut(cyl(122, 14, (inner-1, 0, 0), (1, 0, 0))))
    outer = -BEARING_OUTER-20 if x0 < 0 else BEARING_OUTER
    covers.append(cyl(135, 20, (outer, 0, 0), (1, 0, 0)))
add('a_bearing_pedestals', 'y_table', 'paint', compound(supports))
add('a_bearing_rings', 'y_table', 'steel', compound(rings))
add('a_drive_covers', 'y_table', 'accent', compound(covers))
# One connected, thick U-shaped yoke. The bottom and both cheeks are structural.
yoke = fuse([bevel(box(-340, -175, -235, 340, 175, -125), 10),
             bevel(box(-YOKE_OUTER, -150, -200, -YOKE_INNER, 150, 0), 9),
             bevel(box(YOKE_INNER, -150, -200, YOKE_OUTER, 150, 0), 9),
             cyl(150, YOKE_OUTER-YOKE_INNER, (-YOKE_OUTER, 0, 0), (1, 0, 0)),
             cyl(150, YOKE_OUTER-YOKE_INNER, (YOKE_INNER, 0, 0), (1, 0, 0)),
             cyl(185, 85, (0, 0, -135))])
add('a_yoke_casting', 'a_yoke', 'accent', yoke)
add('a_trunnion_shafts', 'a_yoke', 'steel', compound([
    cyl(120, BEARING_OUTER-YOKE_OUTER, (-BEARING_OUTER, 0, 0), (1, 0, 0)),
    cyl(120, BEARING_OUTER-YOKE_OUTER, (YOKE_OUTER, 0, 0), (1, 0, 0))]))
add('c_bearing_lip', 'a_yoke', 'dark', cyl(191, 8, (0, 0, -50)))
platter = cyl(200, 40, (0, 0, -40))
slots = [box(-205, y-6, -12, 205, y+6, 1) for y in (-120, -60, 0, 60, 120)]
slots += [cyl(6, 18, (170*math.cos(a), 170*math.sin(a), -17))
          for a in [math.radians(i) for i in range(15, 360, 30)]]
add('c_faceplate', 'c_platter', 'steel', platter.cut(compound(slots)).removeSplitter())
add('fixture_blank', 'c_platter', 'stock', bevel(box(-65, -65, 0, 65, 65, 60), 3), True)

doc.recompute()
assert not any('Invalid' in o.State for o in doc.Objects)
assert abs(cadgroups['z_head'].Placement.Base.z - POSE[2]) < 1e-7
machine = dict(name='Compact 500 — XYZAC Trunnion',
               source='Original illustrative FreeCAD design, GPL-2.0-or-later; no OEM meshes.',
               groups=GROUPS, parts=parts, kinematics=KINS, workGroup='c_platter', toolGroup='tool')
with (DEST / 'machine.json').open('w') as f:
    json.dump(machine, f, indent=2); f.write('\n')
report = dict(joint_limits=LIMITS, cad_pose=POSE, table_diameter=400,
              guides=dict(GUIDE, layout=layouts), parts=[],
              structure=dict(x_plate_thickness=100, z_plate_thickness=Z_PLATE_BACK-Z_PLATE_FRONT,
                             y_plate_thickness=140, yoke_cheek_thickness=YOKE_OUTER-YOKE_INNER,
                             yoke_crossplate_thickness=110, bearing_width=BEARING_WIDTH,
                             spindle_axis_to_z_plate=Z_PLATE_FRONT, floor_z=FLOOR_Z),
              pins={k: 0 for k in ('x-rot-point', 'y-rot-point', 'z-rot-point', 'y-offset', 'z-offset')})
preview = dict(machine, initialPose=POSE, jointLimits=LIMITS, floorZ=FLOOR_Z, parts=[])
for p in parts:
    shape = shapes[p['id']]
    mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.3, AngularDeflection=0.12, Relative=False)
    assert mesh.isSolid(), p['id'] + ' mesh is not closed'
    mesh.write(str(DEST / p['file']))
    report['parts'].append(dict(id=p['id'], valid=shape.isValid(), solids=len(shape.Solids),
                                closed=mesh.isSolid(), triangles=mesh.CountFacets, volume_mm3=shape.Volume))
    if OUT:
        preview['parts'].append(dict(p, positions=[round(c, 5) for facet in mesh.Facets
                                                  for point in facet.Points for c in point]))
    print(p['id'], mesh.CountFacets, flush=True)
with (DEST / 'dimensions.json').open('w') as f:
    json.dump(report, f, indent=2); f.write('\n')
# Remove exports of components intentionally removed from this generated model.
for obsolete in DEST.glob('*.stl'):
    if obsolete.name not in {p['file'] for p in parts}:
        obsolete.unlink()
if OUT:
    doc.saveAs(str(OUT / 'Compact_500_XYZAC.FCStd'))
    stepdoc = App.newDocument('STEP_Export')
    stepobjs = []
    for p in parts:
        s = shapes[p['id']].copy(); s.Placement = objects[p['id']].getGlobalPlacement()
        o = stepdoc.addObject('PartDesign::Feature', p['id']); o.Shape = s; stepobjs.append(o)
    stepdoc.recompute()
    import Import
    Import.export(stepobjs, str(OUT / 'Compact_500_XYZAC.step'))
    App.closeDocument(stepdoc.Name)
    with (OUT / 'preview-data.json').open('w') as f:
        json.dump(preview, f, separators=(',', ':'))
print('DONE', len(parts), 'parts', flush=True)

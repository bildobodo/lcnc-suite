#!/usr/bin/env python3
"""R46 offline contact model: original C body, fixed HAL plate and current
feeder. No LinuxCNC/HAL. No servo quantisation, finder/work correction.
Run: python3 -B probe.py ARCHIVE_ROOT > probe.json
"""
import ctypes,importlib.util,json,re,subprocess,sys,tempfile
from pathlib import Path
root=Path(sys.argv[1]);work=Path(tempfile.mkdtemp(prefix='r46-contact-'))
source=root/'examples/sim_config/sim_toolsetter/sim_toolsetter.comp'
body=source.read_text().split('FUNCTION(_) {',1)[1].rsplit('}',1)[0]
c='#include <math.h>\nint trip(double x,double y,double z,double plate_x,double plate_y,double plate_z,double radius,double tool_length,int enable,int manual){int contact,out;'+body+'return out;}\n'
(work/'contact.c').write_text(c)
subprocess.run(['nice','-n','19','cc','-shared','-fPIC','-o',str(work/'contact.so'),str(work/'contact.c'),'-lm'],check=True)
lib=ctypes.CDLL(str(work/'contact.so'));trip=lib.trip;trip.argtypes=[ctypes.c_double]*8+[ctypes.c_int]*2;trip.restype=ctypes.c_int
p=root/'examples/sim_config/sim_toolsetter/sim_toolsetter_feed.py'
spec=importlib.util.spec_from_file_location('r46feed',p);feed=importlib.util.module_from_spec(spec);spec.loader.exec_module(feed)
hal=(root/'examples/sim_config/hallib/sim_toolsetter.hal').read_text()
for n,axis in enumerate('xyz'):
 assert re.search(rf'net\s+\S+\s+joint\.{n}\.pos-fb\s+=>\s+sim-toolsetter\.0\.{axis}',hal)
core=(root/'examples/sim_config/hallib/core_sim_5.hal').read_text()
plate=[float(re.search(rf'setp sim-toolsetter.0.plate-{a} (\S+)',core).group(1)) for a in 'xyz']
def check(length,reference=-300,motor_offset=0):
 L,enabled,why=feed.feed_values(13,[(13,length)])
 px,py,pz=plate
 contact_joint=pz+L
 contact_motor=contact_joint+motor_offset
 assert not trip(px,py,contact_joint+.001,px,py,pz,25,L,enabled,False)
 assert trip(px,py,contact_joint,px,py,pz,25,L,enabled,False)
 return {'plate':plate,'reference_used_by_routine':reference,'table_length':L,
  'motor_minus_joint':motor_offset,'contact_G53':contact_joint,'motor_at_contact':contact_motor,
  'G10_length':round(abs(reference)+contact_joint,9),'enable':enabled,'why':why}
def repeat(reference,motor_offset):
 rows=[];length=65
 for i in range(3):
  row=check(length,reference,motor_offset);rows.append(row);length=row['G10_length']
 return rows
result={'commit':'95aaf08','native_body_from':str(source.relative_to(root)),
 'baseline':check(65),'repeat_correct_reference_motor_offset_1mm':repeat(-300,1),
 'repeat_reference_20mm_too_high':repeat(-280,0),
 'manual_without_length':bool(trip(0,0,0,*plate,25,0,False,True)),
 'automatic_without_length':bool(trip(0,0,-100,*plate,25,0,False,False))}
assert [v['G10_length'] for v in result['repeat_correct_reference_motor_offset_1mm']]==[65,65,65]
assert result['manual_without_length'] and not result['automatic_without_length']
print(json.dumps(result,indent=2))

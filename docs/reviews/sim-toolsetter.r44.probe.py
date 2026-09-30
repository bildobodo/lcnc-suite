#!/usr/bin/env python3
"""Compile only sim_toolsetter.comp's pure FUNCTION body, no HAL/LinuxCNC.
Run: python -B probe.py ARCHIVE_ROOT. Uses temporary files and a tiny C library.
The numerical measurement model is tool_touch_off.ngc's G10 result with
zero work offset, no finder correction and no servo quantisation.
"""
import ctypes,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
root=Path(sys.argv[1]);work=Path(tempfile.mkdtemp(prefix='r44-contact-'))
source=root/'examples/sim_config/sim_toolsetter/sim_toolsetter.comp'
body=source.read_text().split('FUNCTION(_) {',1)[1].rsplit('}',1)[0]
c='#include <math.h>\nint trip(double x,double y,double z,double plate_x,double plate_y,double plate_z,double radius,double tool_length,int enable,int manual){int contact,out;'+body+'return out;}\n'
(work/'contact.c').write_text(c)
subprocess.run(['nice','-n','19','cc','-shared','-fPIC','-o',str(work/'contact.so'),str(work/'contact.c'),'-lm'],check=True)
lib=ctypes.CDLL(str(work/'contact.so'));trip=lib.trip;trip.argtypes=[ctypes.c_double]*8+[ctypes.c_int]*2;trip.restype=ctypes.c_int
p=root/'examples/sim_config/sim_toolsetter/sim_toolsetter_feed.py'
spec=importlib.util.spec_from_file_location('r44feed',p);feed=importlib.util.module_from_spec(spec);spec.loader.exec_module(feed)
def check(plate_z,length,motor_offset=0,new_reference=None):
 params=feed.read_params(f'3100 150\n3101 0\n3102 {plate_z}\n')
 px,py,pz,L,enabled,why=feed.feed_values(params,13,[(13,length)])
 contact_machine=pz+L-motor_offset
 assert not trip(px,py,contact_machine+motor_offset+.001,px,py,pz,25,L,enabled,False)
 assert trip(px,py,contact_machine+motor_offset,px,py,pz,25,L,enabled,False)
 reference=pz if new_reference is None else new_reference
 return {'plate_read_by_feeder':pz,'reference_used_by_routine':reference,
  'table_length':L,'motor_minus_joint':motor_offset,'contact_G53':contact_machine,
  'G10_length':round(abs(reference)+contact_machine,9),'enable':enabled,'why':why}
result={'commit':'f82c323','native_body_from':str(source.relative_to(root)),
 'baseline':check(-300,65),
 'stale_plate_after_settings_change':check(-300,65,new_reference=-280),
 'motor_offset_1mm':check(-300,65,motor_offset=1),
 'repeat_with_1mm_motor_offset':[]}
length=65
for i in range(5):
 case=check(-300,length,motor_offset=1);length=case['G10_length'];result['repeat_with_1mm_motor_offset'].append(case)
result['manual_without_setup']=bool(trip(0,0,0,0,0,0,25,0,False,True))
result['automatic_without_setup']=bool(trip(0,0,-100,0,0,0,25,0,False,False))
assert result['baseline']['G10_length']==65
assert result['stale_plate_after_settings_change']['G10_length']==45
assert result['motor_offset_1mm']['G10_length']==64
assert result['manual_without_setup'] and not result['automatic_without_setup']
print(json.dumps(result,indent=2))

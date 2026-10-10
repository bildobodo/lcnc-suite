"""R118 additions to the repo's command-prohibited native offline probe.
Run from archive/lcnc-gateway: python ../evidence/native-probe.py CASE.
Only fixture configuration is injected; no product function is changed.
The existing helper isolates the tool mmap and installs no_command.
"""
from pathlib import Path
import sys
p=Path.cwd()/'native_start_probe.py'
s=p.read_text()
cases={
 'r118_g53_g91': ('G21 G90\nG0 X11 Y22 Z33\nG91 G53 G0 Z0\nM2\n','mm',0.,(490,),{}),
 'r118_g30_no_words': ('G21 G90\nG0 X11 Y22 Z33\nG30\nM2\n','mm',0.,(490,),{'var':{5181:100,5182:200,5183:300}}),
 'r118_g30_z': ('G21 G90\nG0 X11 Y22 Z33\nG91 G30 Z0\nM2\n','mm',0.,(490,),{'var':{5181:100,5182:200,5183:300}}),
 'r118_g30_z_waypoint': ('G21 G90\nG0 X11 Y22 Z33\nG30 Z400\nM2\n','mm',0.,(490,),{'var':{5181:100,5182:200,5183:300}}),
 'r118_random_repeat': ('G21 G90\nG0 X0 Y0 Z-100\nT7 M6\nG43\nG0 X10\nM2\n',
  'mm',0.,(490,),{'emcio':'RANDOM_TOOLCHANGER = 1','tools':[(7,66),(1,10),(2,20)]})
}
marker='program, units, z_off, gcodes_live, extra = CASES[sys.argv[1]]'
assert marker in s
s=s.replace(marker,'CASES.update('+repr(cases)+')\n'+marker)
if sys.argv[1]=='r118_random_repeat':
 # Model a real random table: P0 contains the loaded T7, P1 T1, P2 T2.
 s=s.replace('f"T{n} P{n} Z{z} D6\\n" for n, z in _tools', 'f"T{n} P{pocket} Z{z} D6\\n" for pocket, (n, z) in enumerate(_tools)')
 s=s.replace('_td["_Z13tooldata_initb"](False)', '_td["_Z13tooldata_initb"](True)')
 s=s.replace('tool_in_spindle=1, tool_table=[tool(*_tools[0])] + [tool(n, z) for n, z in _tools]', 'tool_in_spindle=7, tool_table=[tool(n, z) for n, z in _tools]')
exec(compile(s,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})

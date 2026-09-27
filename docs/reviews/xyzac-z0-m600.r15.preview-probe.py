"""R15: read-only RS274 preview of the actual M600/M601 wrappers.

Requires the operator's running XYZAC sim for linuxcnc.stat() / StatMixin.
Never constructs linuxcnc.command or an error-channel reader. The preview
interpreter has #<_task>=0 and writes only a private copy of the var file.
"""
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import linuxcnc
import gcode

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'lcnc-gateway'))
from gcode_canon import PreviewCanon

s=linuxcnc.stat();s.poll()
assert Path(s.ini_filename).name=='lcnc_suite_sim_5axis_xyzac.ini'
os.environ['INI_FILE_NAME']=s.ini_filename
os.chdir(Path(s.ini_filename).parent)  # match the gateway's relative INI paths
ini=linuxcnc.ini(s.ini_filename)
assert ini.find('KINS','KINEMATICS')=='xyzac-trt-kins sparm=identityfirst'
var=Path(ini.find('RS274NGC','PARAMETER_FILE'))
if not var.is_absolute():var=Path(s.ini_filename).parent/var
result={'method':'gcode.parse with real PreviewCanon, read-only live STAT; #<_task>=0, private var file',
        'ini':s.ini_filename,'live_file_before':Path(s.file).name,'cases':[]}
with tempfile.TemporaryDirectory(prefix='codex-r15-preview-') as tmp:
    for mode,start in ((0,'M429'),(1,'M428')):
        for command in ('M600','M601'):
            p=Path(tmp)/f'{mode}-{command}.ngc'
            # No tool selection: this probe checks wrapper mode restoration,
            # not a particular live table entry or task-side measurement.
            p.write_text(f'G21 G90 G94 F100\n{start}\n{command}\nG1 X0\nG1 X1\nM2\n')
            param=Path(tmp)/f'{mode}-{command}.var';shutil.copyfile(var,param)
            canon=PreviewCanon(s,0);canon.parameter_file=str(param)
            rc,line=gcode.parse(str(p),canon,['G21','G90'],'')
            events=list(canon.kins_events)
            result['cases'].append({'mode':mode,'command':command,'rc':rc,'line':line,
                                    'error':gcode.strerror(rc) if rc>gcode.MIN_ERROR else None,
                                    'kins_events':events,'sub_events':list(canon.sub_events)})
s.poll();result['live_file_after']=Path(s.file).name
Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

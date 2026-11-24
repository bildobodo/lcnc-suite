"""Offline interpreter only: no controller, HAL, network or motion.
Uses a private INI containing only a Python plugin with an inert toplevel.
Uses the reviewed PreviewCanon with a synthetic status object and private
parameter files. Run in /tmp/r466 under the shared computation lock.
"""
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace

os.environ.pop('INI_FILE_NAME', None)
sys.path.insert(0, '/tmp/r466/tree/lcnc-gateway')
import gcode
from gcode_canon import PreviewCanon, interp_this

root = Path('/tmp/r466/native')
root.mkdir(exist_ok=True)
cases = {
    'control_metric': '(T13 D=6)\nG21\nG0 X1\nM2\n',
    'hot_semicolon': '(T13 D=6)\nG21\n;py,from interpreter import this; this.execute("G20")\nG0 X1\nM2\n',
    'hot_pyrun': '(T13 D=6)\nG21\n(pyrun,/tmp/r466/native/inch.py)\nG0 X1\nM2\n',
}
(root/'inch.py').write_text('from interpreter import this; this.execute("G20")\n')
(root/'toplevel.py').write_text('import interpreter\n')
(root/'offline.ini').write_text('[PYTHON]\nTOPLEVEL = '+str(root/'toplevel.py')+'\n[RS274NGC]\n')
os.environ['INI_FILE_NAME']=str(root/'offline.ini')

class Observed(PreviewCanon):
    def record(self, args):
        i = interp_this()
        self.moves.append({'line': i.sequence_number, 'length_units': int(i.length_units),
                           'canon_x_inches': args[0], 'x_mm': args[0]*25.4})
    def straight_traverse(self,*args):
        self.record(args)
        super().straight_traverse(*args)
    def straight_feed(self,*args):
        self.record(args)
        super().straight_feed(*args)

out=[]
for name,text in cases.items():
    p=root/(name+'.ngc'); p.write_text(text)
    var=root/(name+'.var'); var.write_text('5220 1\n')
    s=SimpleNamespace(tool_table=[(-1,*([0.0]*12),0)], angular_units=1.0,
                      linear_units=1.0, axis_mask=7, block_delete=False)
    canon=Observed(s); canon.moves=[]; canon.parameter_file=str(var)
    code,line=gcode.parse(str(p),canon,['G21'], '')
    assert code <= gcode.MIN_ERROR, (name,code,line,gcode.strerror(code))
    assert canon.moves,(name,canon.moves)
    expect=25.4 if name != 'control_metric' else 1.0
    assert abs(canon.moves[-1]['x_mm']-expect)<1e-6,(name,canon.moves)
    out.append({'case':name,'program':text,'initcode':'G21','return':code,'moves':canon.moves})
print(json.dumps(out,indent=2))

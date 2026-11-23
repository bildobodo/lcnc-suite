"""R437: offline interpreter only; no controller or HAL connection."""
import json, os, sys, tempfile, subprocess
from pathlib import Path
sys.path.insert(0, '/tmp/r437/head/lcnc-gateway')
from test_error_line_golden import SUBS, RUNNER
out=[]
with tempfile.TemporaryDirectory() as tmp:
 d=Path(tmp);(d/'subs').mkdir()
 for name,text in SUBS.items():(d/'subs'/name).write_text(text)
 (d/'sim.var').write_text('');(d/'tool.tbl').write_text('T1 P1 D6 Z50 ;\n')
 ini=d/'mini.ini';ini.write_text('[EMC]\nVERSION = 1.1\n[RS274NGC]\nPARAMETER_FILE = sim.var\n'+f'SUBROUTINE_PATH = {d / "subs"}\n'+'REMAP=M610 modalgroup=6 ngc=m610_bad\n[EMCIO]\nTOOL_TABLE = tool.tbl\n[TRAJ]\nLINEAR_UNITS = mm\nANGULAR_UNITS = degree\nCOORDINATES = X Y Z\n[KINS]\nKINEMATICS = trivkins\nJOINTS = 3\n')
 runner=RUNNER.replace('out = {}', '''orig = worker.proven_error_line
    def observe(canon):
        t=worker.gcode_canon.interp_this()
        val=orig(canon)
        print('__OBS__'+json.dumps({'seq':t.sequence_number,'call':t.call_level,'remap':t.remap_level,'filename':t.filename,'offset':t.blocks[0].offset,'mapped':canon._byte_line(int(t.blocks[0].offset)+1),'line':val}))
        return val
    worker.proven_error_line=observe
    out = {}''')
 # Align the called file's byte offset with different main-file lines by padding.
 progs=[]
 for pad in (0,30,80,200):
  for target in ('o<bad_sub> call','M610'):
   name=f'{"sub" if target.startswith("o") else "remap"}_{pad}.ngc'
   text='G21 G90\n'+target+' '*pad+'\nM2\n';p=d/name;p.write_text(text);progs.append(str(p))
   out.append({'name':name,'program':text,'expected':None})
 r=subprocess.run([sys.executable,'-c',runner,'/tmp/r437/head/lcnc-gateway',str(ini),*progs],capture_output=True,text=True,cwd=d,env={**os.environ,'INI_FILE_NAME':str(ini)},timeout=90)
 Path('/tmp/r437/error-probe.stdout.txt').write_text(r.stdout)
 Path('/tmp/r437/error-probe.stderr.txt').write_text(r.stderr)
 results=[json.loads(l[len('__RESULT__'):]) for l in r.stdout.splitlines() if l.startswith('__RESULT__')]
 for p in out:p['actual']=results[0].get(p['name']) if results else None
 print(json.dumps({'returncode':r.returncode,'cases':out},indent=2))

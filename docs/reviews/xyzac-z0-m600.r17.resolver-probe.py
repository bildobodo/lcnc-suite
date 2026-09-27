"""R17: pure load-context matrix, using the new restore/update interface.
No LinuxCNC access. Missing record, explicit empty record and MAIN differ.
"""
import json
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'lcnc-gateway'))
from gateway_util import LoadedProgram
MAIN='/review/nc/main.ngc'
SUB='/review/nc/shared/probe.ngc'
result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'cases':[]}

for record_name in ('absent','empty','main'):
    for idle in (False,True):
        p=LoadedProgram()
        if record_name!='absent': p.restore(MAIN if record_name=='main' else None)
        steps=[]
        for t,raw,is_idle in ((0,SUB,idle),(.1,SUB,True),(.2,MAIN,True)):
            events=p.update(raw,is_idle,t)
            steps.append({'raw':raw,'idle':is_idle,'loaded':p.loaded,'unconfirmed':p.unconfirmed,'events':events})
        assert p.loaded==(MAIN if record_name=='main' else None)
        result['cases'].append({'name':f'restart_{record_name}_initial_idle_{idle}','steps':steps})

for baseline in (None,MAIN):
    for explicit in (False,True):
        p=LoadedProgram();p.restore(baseline);p.update(baseline,True,0)
        if explicit:p.request_load(SUB,.1)
        events=p.update(SUB,False,.2)+p.update(SUB,True,.3)
        assert p.loaded==(SUB if explicit else baseline)
        result['cases'].append({'name':f'baseline_{baseline}_explicit_{explicit}',
            'loaded':p.loaded,'unconfirmed':p.unconfirmed,'events':events})

Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

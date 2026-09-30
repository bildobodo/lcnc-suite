import importlib.util, json, sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(root/'lcnc-gateway'))
from gateway_util import evaluate_tlo_drift as new
p=Path(__file__).with_name('viewer-palette-fest.r51.previous-drift.py')
spec=importlib.util.spec_from_file_location('previous_drift',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
base={'table_mtime':5.,'tlos':[[13,0.,0.,65.0589,8.]],'loaded_tool':13,'applied_tlo':[0.,0.,65.064]}
cases=[
 ('end_measured_g43',5.,13,65.0589,[(13,65.0589)],False,None),
 ('manual_g49',5.,13,0.,[(13,65.0589)],False,None),
 ('manual_dynamic',5.,13,12.5,[(13,65.0589)],False,None),
 ('table_file_changed',6.,13,65.064,[(13,65.0589)],False,'table_mtime'),
 ('loaded_tool_changed',5.,2,65.064,[(13,65.0589)],False,'tool_loaded'),
 ('table_row_changed',5.,13,65.064,[(13,66.)],False,'table_row'),
 ('midrun_own_m6',5.,2,12.5,[(13,65.0589)],True,None),
 ('midrun_table_row_changed',5.,2,12.5,[(13,66.)],True,'table_row'),
]
rows=[]
for name,mtime,tool,applied,table,mid,expected in cases:
 before=m.evaluate_tlo_drift(base,mtime,tool,applied,table_rows=table,table_only=mid)
 after=new(base,mtime,tool,table_rows=table,table_only=mid)
 rows.append({'case':name,'live_applied_z':applied,'before':before,'after':after,'expected':expected})
 assert after==expected,(name,after,expected)
Path(__file__).with_name('viewer-palette-fest.r51.drift-probe.json').write_text(json.dumps(rows,indent=2)+'\n')
print(f'{len(rows)}/{len(rows)} drift cases passed')

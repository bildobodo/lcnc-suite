"""R479: pure dependency checks and explicitly labelled plan projections.
No TF-2 implementation exists yet. No gateway, NML or live machine import.
"""
from pathlib import Path
import json
import subprocess
import sys
import tempfile

ROOT=Path('/tmp/r479')
sys.path.insert(0,str(ROOT/'tree/lcnc-gateway'))
from tool_table import home_tools, parse_tool_table_bytes
from test_form_rule2 import load_refusal as v2_form_refusal

ORA=Path('/tmp/r478/oracle/oracle')
cases={
 'plain':b'T1 P5 Z10 D6\n',
 'hash text first':b'# words\nT1 P5 Z10 D6\n',
 'hash pocket first':b'# words P7\nT1 P5 Z10 D6\n',
 'hash pocket between':b'T1 P5 Z10 D6\n# words P7\nT2 P6 Z20 D3\n',
 'hash pocket last':b'T1 P5 Z10 D6\n# words P7\n',
 'hash pocket after semicolon':b'# words ; P7\nT1 P5 Z10 D6\n',
 'semicolon pocket first':b';T9 P9\nT1 P5 Z10 D6\n',
 'indented hash pocket first':b'  # words P7\nT1 P5 Z10 D6\n',
 'indented hash pocket last':b'T1 P5 Z10 D6\n  # words P7\n',
}
rows=[]
for name,data in cases.items():
    with tempfile.NamedTemporaryFile(dir=ROOT) as f:
        f.write(data);f.flush()
        out=subprocess.check_output([str(ORA),f.name],text=True,stderr=subprocess.DEVNULL)
    actual={int(w[1]):(int(w[2]),int(w[3])) for line in out.splitlines()
            if line.startswith('ROW ') for w in [line.partition('|')[0].split()]}
    got=home_tools(data)
    expected={i+1:(r['T'],r['P']) for i,r in enumerate(parse_tool_table_bytes(data))}
    assert got==actual,(name,got,actual)
    rows.append({'case':name,'bytes':data.decode(),'mirror':got,'original_reader':actual,
                 'v2_form_admits':v2_form_refusal(data) is None,
                 'v3_index_condition_admits':got==expected})

previous=json.loads(Path('/home/cnc/lcnc-suite/docs/reviews/maschinentag.r478.codex-probe.json').read_text())
projected=[]
for case in previous['cases']:
    projected.append({'case':case['case'],'load':'requested',
        'values':'shown' if case['V']['state']=='complete' and case['S_unchanged'] else 'not shown',
        'proof_scope':'compared table values only; no pocket, remark or load-execution claim',
        'observed_pocket':case['actual_pocket']})

# Shows-it is only a plan predicate here, not a new component function.
base=dict(path='/tool.tbl',instance='A',ini='/sim.ini',link='e.1',rev='r')
def shows(read):
    return read is not None and read.get('proof')=='complete' and all(read.get(k)==v for k,v in base.items())
checks=[{'case':'owner A, same bytes', 'read':base|{'proof':'complete'},'expected':True},
        {'case':'owner B, same path and complete','read':base|{'instance':'B','proof':'complete'},'expected':False},
        {'case':'new Link to same instance','read':base|{'link':'e.2','proof':'complete'},'expected':False},
        {'case':'WS closed','read':None,'expected':False},
        {'case':'same owner after WS reconnect','read':base|{'proof':'complete'},'expected':True},
        {'case':'another revision','read':base|{'rev':'r2','proof':'complete'},'expected':False},
        {'case':'failed read','read':{'proof':'failed'},'expected':False}]
for c in checks:
    c['shows_it']=shows(c['read']);assert c['shows_it']==c['expected']
print(json.dumps({'index_probe':rows,
 'r478_evidence_projected_to_v3_plan_only':projected,
 'display_predicate_plan_only':checks},indent=2))

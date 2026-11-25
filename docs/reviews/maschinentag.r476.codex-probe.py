"""R476 plan counterexamples; offline source oracle + explicit contract models.
No gateway, NML or live LinuxCNC is imported. No claim of native execution.
"""
import ast, hashlib, json, math, subprocess, sys
from pathlib import Path
from types import SimpleNamespace
HERE=Path('/tmp/r476')
sys.path.insert(0,str(HERE/'tree/lcnc-gateway'))
from tool_table import parse_tool_table_bytes
from tool_proof import scan_table, compare, STAT_FIELDS
# Exactly the function in the plan's scratch form rule, not a guessed replacement.
a=ast.parse((HERE/'form_rule_original.py').read_text())
f=next(x for x in a.body if isinstance(x,ast.FunctionDef) and x.name=='form_refusal')
ns={};exec(compile(ast.Module(body=[f],type_ignores=[]),'form-rule-extract','exec'),ns)
form_refusal=ns['form_refusal']
def oracle(data,name):
 p=HERE/(name+'.tbl');p.write_bytes(data)
 r=subprocess.run([str(HERE/'oracle/oracle'),str(p)],capture_output=True,text=True,check=True)
 rows=[]
 for line in r.stdout.splitlines():
  if line.startswith('ROW '):
   w=line.split('|')[0].split();rows.append(dict(index=int(w[1]),T=int(w[2]),P=int(w[3]),Q=int(w[16])))
 return rows
print('ORACLE_SHA256',hashlib.sha256((HERE/'oracle/oracle').read_bytes()).hexdigest())
for q in [3,2147483647,2147483648,4294967299,-2147483649]:
 data=f'T5 P5 Z10 D6 Q{q}\n'.encode();unread=[]
 rows=parse_tool_table_bytes(data,unread=unread);got=oracle(data,'q'+str(q))
 form_ok=form_refusal(data) is None and not unread
 print('Q_FORM',json.dumps(dict(Q=q,form_ok=form_ok,all_numeric_finite=all(math.isfinite(v) for k,v in rows[0].items() if isinstance(v,(int,float))),gateway_Q=rows[0]['Q'],io_Q=got[0]['Q'],same=rows[0]['Q']==got[0]['Q'])))
 assert form_ok
 assert (got[0]['Q']==q)==(-2147483648<=q<=2147483647)
old=oracle(b'T5 P5 Z10 D6\nT6 P6 Z9 D5\n','before')
new=oracle(b'T5 P9 Z10 D6\nT6 P6 Z9 D5\n','after-pocket-change')
prepared_index=1; pins=dict(tool_prep_index=1,tool_prep_number=5,tool_prep_pocket=5)
plan_allows=old[prepared_index-1]['T']==new[prepared_index-1]['T']
print('PREPARED',json.dumps(dict(before=old,after=new,held_prepare_pins=pins,plan_same_index_same_T_allows=plan_allows,reported_tool_from_pocket_after_M6=new[0]['P'])))
assert plan_allows and pins['tool_prep_pocket']!=new[0]['P']
def mem(data):
 rows=parse_tool_table_bytes(data)
 def t(r):
  return SimpleNamespace(id=r['T'],**{attr:r.get(k,0) for k,attr in STAT_FIELDS})
 return [t(dict(T=-1))]+[t(r) for r in rows]
data=b'T5 P9 Z10 D6\n'
v=compare(scan_table(data),mem(b'T5 P5 Z10 D6\n'),None)['state']=='complete'
# Observable tuples admitted by section 1.4. Cancellation trace is source-derived,
# not an execution of emctaskmain: RCS_ERROR can disappear before the next poll.
observations=dict(echo=71,serial=71,status='DONE',interp='IDLE',task_state='ON',admission_task_state='ON',poll_began_after_send=True,V=v,S=True,owner_same=True,newest=True)
plan_confirms=all([v,observations['S'],observations['echo']==observations['serial'],observations['status']=='DONE',observations['interp']=='IDLE',observations['task_state']==observations['admission_task_state'],observations['poll_began_after_send']])
print('COMPLETE_PROOF_MODEL',json.dumps(dict(observations=observations,plan_confirms=plan_confirms,possibilities=[dict(io_load_executed=True,loaded_pocket=9),dict(io_load_executed=False,task_internal_abort=True,loaded_pocket=5)],native=False)))
assert plan_confirms
write=dict(epoch='gateway-E',seq=1,path='/cfg/tool.tbl',instance='111:111')
loaded=dict(epoch='gateway-E',seq=2,owner='111:111')
read=dict(epoch='gateway-E',path='/cfg/tool.tbl',instance='222:222',complete=True,loaded=loaded)
settles=(read['path']==write['path'] and loaded['epoch']==write['epoch'] and loaded['seq']>write['seq'])
print('LOAD_STAMP_MODEL',json.dumps(dict(write=write,read=read,section3_positive_predicate=settles,owner_changed=True,native=False)))
assert settles
print('All counterexample assertions reached; this is a plan audit, not a product test.')

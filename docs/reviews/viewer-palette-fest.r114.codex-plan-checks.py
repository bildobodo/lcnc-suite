"""R114: pure real context builder + explicit plan-admission countermodel.
No gateway import or controller; only files within the supplied archive are used.
Usage: python3 plan-checks.py ARCHIVE OUTPUT_JSON
"""
import ast
import copy
import hashlib
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
root=Path(sys.argv[1])

def source_function(file,name):
    tree=ast.parse((root/file).read_text())
    f=next(n for n in ast.walk(tree) if isinstance(n,ast.FunctionDef) and n.name==name)
    scope={'Optional':Optional,'hashlib':hashlib}
    exec(compile(ast.Module(body=[f],type_ignores=[]),str(root/file),'exec'),scope)
    return scope[name]
pinned=source_function('lcnc-gateway/bulk_pipeline.py','pinned_ctx')
edge=source_function('lcnc-gateway/gateway_util.py','preview_file_edge_action')
source=source_function('lcnc-gateway/gateway_util.py','program_source')
path=root/'r114-input.ngc';path.write_text('G21 G90\nG92 X-100\nG4 P1\nM2\n')
old_mtime=path.stat().st_mtime;old_source=source(str(path));os.utime(path,(old_mtime+2,old_mtime+2));new_source=source(str(path))
assert old_source==new_source
assert edge(True,False,False,None,str(path),path.stat().st_mtime)=='schedule'

def state(idx,g92):
    return SimpleNamespace(published_ctx={'file':str(path),'g5x_index':idx,'var_patches':{'5221':g92}},published_params={'text':f'5221 {g92}\n','g92':[g92,0,0]},published_rotary_seed={'a':0,'b':0,'c':0},published_tlo={'loaded_tool':1},tool_basis={'xyz':[0,0,0],'mode':0},PINNED_NICE=19)
a=state(1,0);b=state(2,100)
ctx_a=pinned(a,str(path));ctx_b=pinned(b,str(path))
# Stable seed digest for this countermodel; not a proposed complete product digest.
digest=lambda x:hashlib.sha256(json.dumps(x,sort_keys=True).encode()).hexdigest()
run={'run_id':1,'ctx_digest':digest(ctx_a),'tool_basis_rev':9,'verified':True,'state':'sent','file':str(path),'source':old_source}
# Plan 1b copies the still-verified run's tuple, not the actual seed context.
for_run={k:run[k] for k in ['run_id','ctx_digest','tool_basis_rev']}
origin={'version':3,'file':str(path),'source':new_source,'pinned':True,'for_run':for_run,'tool_basis_rev':9}
checks={'pinned':origin['pinned'],'displayed_version':origin['version']==3,'for_run_matches':all(for_run[k]==run[k] for k in for_run),'run_verified':run['verified'],'interpreter_running':True}
assert all(checks.values()) and digest(ctx_b)!=for_run['ctx_digest']
# The explicit R113 cross-run counterexample now correctly fails.
run2={**run,'run_id':2}
cross_run_passes=all(for_run[k]==run2[k] for k in for_run)
assert not cross_run_passes
out={
 'scope':'Actual pure pinned_ctx/file-edge/source helpers, plus a plan countermodel; no implemented run_basis/for_run or live parse is claimed.',
 'file_edge':{'same_source':old_source==new_source,'old_mtime':old_mtime,'new_mtime':path.stat().st_mtime,'action':'schedule','gateway_route':'gateway.py 1625-1671 selects an unpinned file-edge reparse without an IDLE gate'},
 'events':['A is the published start context, no parse in flight; AUTO run 1 is verified against A','during run 1 a metadata-only external file update schedules an ordinary parse with the then-current context B','B is published, pinned=false; no in-run sweep is admitted for this publication','later table drift schedules a pinned parse; plan 1b stamps for_run from the original run basis A','the actual existing pinned_ctx builder reads the newest published B, not the original A','the listed plan 3a comparisons all pass for this newly labelled pinned publication'],
 'original_context':ctx_a,'later_published_context':ctx_b,'run_basis_model':run,'labelled_origin':origin,'actual_seed_digest':digest(ctx_b),'plan_3a_conditions':checks,
 'cross_run_control':{'for_run':for_run,'current_run_id':2,'admitted':cross_run_passes},
 'required_invariant':'for_run identifies the context actually frozen and sent to the worker; reject mismatching seeds or use the immutable verified run context.'}
Path(sys.argv[2]).write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print('PASS: unchanged-source file edge; actual pinned_ctx follows newest publication; plan countermodel accepted; old cross-run case rejected')

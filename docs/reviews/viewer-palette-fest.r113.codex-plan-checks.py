"""R113 plan countermodels and pure repository helpers; no gateway import/run.
Usage: python3 plan-checks.py ARCHIVE_ROOT OUTPUT_JSON
"""
import ast
import copy
import json
import sys
from pathlib import Path
import numpy as np
root = Path(sys.argv[1])

def pure(file, name, extra=None):
    tree = ast.parse((root/file).read_text())
    f = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    scope = dict(extra or {})
    exec(compile(ast.Module(body=[f], type_ignores=[]), str(root/file), 'exec'), scope)
    return scope[name]

# This gate intentionally compares geometry without occurrence/order.
distance = pure('scripts/sim_parity.py', 'path_deviation', {'np':np})
a = np.array([[0,0,0,0,0,0],[100,0,0,0,0,0],[100,20,0,0,0,0],[0,20,0,0,0,0],[0,0,0,0,0,0]], dtype=float)
b = a[::-1].copy()
ab = distance(a,b); ba = distance(b,a)
assert ab == (0.0,0.0) and ba == (0.0,0.0)
ordered_diffs = np.sqrt(((a-b)**2).sum(1)).tolist()
assert max(ordered_diffs)>10

# Identical tool values can still reparse when the file timestamp changes.
drift = pure('lcnc-gateway/gateway_util.py', 'evaluate_tlo_drift')
meta = {'table_mtime':100.0,'tlos':[[1,0,0,20,6]],'loaded_tool':1}
unchanged = drift(meta,100.0,1,table_rows=[(1,20)],table_only=True)
rewritten = drift(meta,101.0,1,table_rows=[(1,20)],table_only=True)
assert unchanged is None and rewritten == 'table_mtime'

# Countermodels below execute the plan's rules, NOT yet-existing product code.
# A legal order: send start; an immediate program modal write; first UI frame.
start = {'g92':[0,0,0],'tool':1,'run_id':1}
first_frame = {'g92':[100,0,0],'tool':1,'run_id':1}
client_capture = copy.deepcopy(first_frame)
assert client_capture['g92'] != start['g92']

# Plan 1a has no parse-run or parse-start-basis in published_origin.
origin = {'version':18,'file':'/nc/a.ngc','source':'same-content-hash','reason':'midrun:table_mtime','pinned':True,'table':{'mtime':101,'rows':'table-B'}}
current = {'file':'/nc/a.ngc','source':'same-content-hash','run_id':2,'running':True}
run_basis = {'run_id':2,'start_basis':'B'}
origin_actual = {'run_id':1,'start_basis':'A'} # deliberately NOT on planned wire
checks = {
 'pinned_midrun':origin['pinned'] and origin['reason'].startswith('midrun:'),
 'same_file_and_source':origin['file']==current['file'] and origin['source']==current['source'],
 'running':current['running'],
 'same_run_as_client_basis':current['run_id']==run_basis['run_id'],
}
assert all(checks.values()) and origin_actual['run_id'] != run_basis['run_id']
result = {
 'scope':'Plan reference models and exact pure source functions, no implemented R113 code or live execution',
 'parity':{'path_a':a.tolist(),'path_b':b.tolist(),'a_to_b_max_p99':ab,'b_to_a_max_p99':ba,'same_index_distances':ordered_diffs,'conclusion':'Geometric set agreement alone proves no occurrence-aligned bound; this is a limitation of using the gate as a rest-floor premise, not a bug report against its declared path-only contract.'},
 'same_value_table':{'meta':meta,'unchanged_timestamp':unchanged,'rewritten_timestamp':rewritten},
 'start_snapshot_countermodel':{'events':['gateway sends AUTO under start basis','program changes G92 before next status frame','client receives run_id 1 together with already changed live state'], 'actual_start':start,'first_client_frame':first_frame,'planned_capture':client_capture},
 'origin_countermodel':{'events':['pinned parse starts in run 1, basis A','run 1 ends; old rest job is invalidated','run 2 starts same file/source, basis B','old parse publishes after run 2 started'], 'origin':origin,'actual_origin_not_on_wire':origin_actual,'current_status':current,'run_basis':run_basis,'plan_3a_conditions':checks,'planned_acceptance':all(checks.values())},
}
Path(sys.argv[2]).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print('PASS: geometric parity scope, table-mtime control and two explicit plan countermodels')

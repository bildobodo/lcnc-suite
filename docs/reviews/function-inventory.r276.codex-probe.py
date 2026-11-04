"""Run only in an isolated /tmp archive of fa09223a, with local node_modules.
The toolsetter mutation is restored; --format probes use an isolated temp file.
No gateway import, network or machine access.
Usage: python3 -B r276-probe.py /tmp/codex-r276
"""
import ast, asyncio, copy, hashlib, importlib.util, json, subprocess, sys, tempfile
from types import SimpleNamespace
from pathlib import Path
root=Path(sys.argv[1]).resolve(); assert str(root).startswith('/tmp/')
web=root/'lcnc-webui'; path=web/'src/toolsetterSetup.ts'; before=path.read_bytes()
out={'target':'fa09223a','source_hash_before':hashlib.sha256(before).hexdigest()}
def vitest(name,pattern=None):
 args=['node','node_modules/vitest/vitest.mjs','run',name,'--maxWorkers=1','--allowOnly=false','--retry=0']
 if pattern:args+=['-t',pattern]
 r=subprocess.run(args,cwd=web,capture_output=True,text=True)
 return {'args':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
try:
 old='"3104": p.toolMinDis';new='"3904": p.toolMinDis'
 assert before.decode().count(old)==1
 path.write_text(before.decode().replace(old,new))
 out['mutated_cited_test']=vitest('src/toolsetterSetup.test.ts','writes the var numbers')
 out['mutated_exact_contract']=vitest('src/r276Keyset.test.ts')
finally:path.write_bytes(before)
out['restored_exact_contract']=vitest('src/r276Keyset.test.ts')
out['source_hash_after']=hashlib.sha256(path.read_bytes()).hexdigest()
# The new formatter promises equality; check current data and its failure path.
sp=importlib.util.spec_from_file_location('r276_functions',root/'scripts/inventory/functions.py');fn=importlib.util.module_from_spec(sp);sp.loader.exec_module(fn)
webatoms,pyatoms,fns=fn.load()
out['formatter_current_roundtrip']=json.loads(fn.dump(fns))==fns
out['formatter_current_idempotent']=fn.dump(json.loads(fn.dump(fns)))==fn.dump(fns)
with tempfile.TemporaryDirectory(prefix='r276-format-',dir='/tmp') as td:
 p=Path(td)/'functions.json'; data=copy.deepcopy(fns)
 # This input is accepted by the current inventory validator, but dump omits
 # function-level fields it did not enumerate. Failure must leave input intact.
 data['functions'][0]['reviewNote']='R276: operator explanation that must survive formatting'
 out['formatter_input_validation']=fn.problems(webatoms,pyatoms,data,root)
 original=json.dumps(data,ensure_ascii=False,indent=2).encode();p.write_bytes(original)
 fn.HERE=Path(td); sys.argv=['functions.py','--format']
 try:fn.main()
 except Exception as e:out['formatter_failure']=type(e).__name__
 out['formatter_changed_before_failure']=p.read_bytes()!=original
 out['formatter_retains_reviewNote']='reviewNote' in json.loads(p.read_text())['functions'][0]
 # Supported key with a legal empty value also fails AFTER replacing the file.
 data=copy.deepcopy(fns);data['functions'][0]['uses']=[]
 p.write_text(json.dumps(data));old=p.read_bytes()
 try:fn.main()
 except Exception as e:out['formatter_empty_uses_failure']=type(e).__name__
 out['formatter_empty_uses_changed_before_failure']=p.read_bytes()!=old
# Evaluate ONLY the existing check expressions on fabricated trajectories.
# No live script is imported or executed. These are evidence countermodels.
checks={}
tree=ast.parse((root/'scripts/twp_buttons_check.py').read_text())
for n in ast.walk(tree):
 if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='check' and n.args and isinstance(n.args[0],ast.Constant):
  checks[n.args[0].value]=n
cases=[
 ('Zero ABOVE', '→ Zero from ABOVE Z0 (G53 Z+50): Z unchanged (never lowered), X/Y at work zero', [[10,10,50],[0,0,0],[0,0,50]]),
 ('G30 BELOW', '→ G30 from BELOW Z0: retracts to the top first (max Z seen ~ 0), then lands on #5181..#5183', [[10,10,-60],[40,-30,-60],[40,-30,0],[40,-30,-60]])]
out['live_definition_countermodels']=[]
for name,title,positions in cases:
 node=checks[title]
 expression=ast.Expression(body=node.args[2]);ast.fix_missing_locations(expression)
 values={'r':{'ok':True},'ran':True,'hi':max(p[2] for p in positions),'lo':min(p[2] for p in positions),'s':SimpleNamespace(actual_position=positions[-1]),'d':[0,0]}
 accepted=eval(compile(expression,'<existing live check>','eval'),{'__builtins__':{'abs':abs}},values)
 out['live_definition_countermodels'].append({'case':name,'script_line':node.lineno,'expression':ast.unparse(node.args[2]),'positions':positions,'check_passes':accepted,'violation':'Z drops below its start then returns' if name=='Zero ABOVE' else 'XY move to the target before the retract to Z0'})
 assert accepted

# Execute the stop helper's AST with an in-memory command recorder only.
# This checks its mode/scope definition, not the WS-to-controller integration.
gateway_tree=ast.parse((root/'lcnc-gateway/gateway.py').read_text())
helper=next(n for n in gateway_tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_jog_stop_for_client')
helper_code=compile(ast.Module(body=[helper],type_ignores=[]),'<isolated jog helper>','exec')
out['disconnect_helper_cases']=[]
for label,enabled,auto_running,booked in [('AUTO idle',True,False,{0:(1,0)}),('AUTO running',True,True,{0:(1,0)}),('two globally booked jogs',True,False,{0:(1,0),2:(1,2)})]:
 calls=[]
 async def stop(axis):
  calls.append(axis);booked.pop(axis,None)
 env={'safe_get':lambda key,default=False:enabled,'_active_jogs':booked,'_auto_running':lambda:auto_running,'_send_jog_stop':stop,'_trace':SimpleNamespace(emit=lambda *a,**kw:None)}
 exec(helper_code,env)
 asyncio.run(env['_jog_stop_for_client']())
 out['disconnect_helper_cases'].append({'case':label,'stop_calls':calls})
condition=next(n for n in ast.walk(gateway_tree) if isinstance(n,ast.If) and ast.unparse(n.test)=='client.armed and CMD is not None and (not _shutting_down)')
out['disconnect_stop_admission']={'line':condition.lineno,'expression':ast.unparse(condition.test),'armed':bool(eval(compile(ast.Expression(condition.test),'<admission>','eval'),{'client':SimpleNamespace(armed=True),'CMD':object(),'_shutting_down':False})),'unarmed':bool(eval(compile(ast.Expression(condition.test),'<admission>','eval'),{'client':SimpleNamespace(armed=False),'CMD':object(),'_shutting_down':False}))}

assert out['source_hash_before']==out['source_hash_after']
assert out['mutated_cited_test']['exit']==0
assert out['mutated_exact_contract']['exit']==1
assert out['restored_exact_contract']['exit']==0
assert out['formatter_input_validation']==[]
print(json.dumps(out,ensure_ascii=False,indent=2))

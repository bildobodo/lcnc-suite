import ast, json, subprocess
from pathlib import Path
root=Path('/tmp/codex-r359')
old=ast.parse(subprocess.check_output(['git','-C','/home/cnc/lcnc-suite','show','90047025:lcnc-gateway/gateway.py'],text=True))
new=ast.parse((root/'lcnc-gateway/gateway.py').read_text())
def blocks(tree):
    out={}
    for n in (node for fn in tree.body if isinstance(fn,(ast.FunctionDef,ast.AsyncFunctionDef)) and (fn.name=='_handle_command_impl' or fn.name.startswith('_cmds_')) for node in ast.walk(fn)):
        if isinstance(n,ast.If) and isinstance(n.test,ast.Compare):
            t=n.test
            if isinstance(t.left,ast.Name) and t.left.id=='cmd' and len(t.ops)==1 and isinstance(t.ops[0],ast.Eq) and isinstance(t.comparators[0],ast.Constant) and isinstance(t.comparators[0].value,str):
                out[t.comparators[0].value]=ast.dump(n,include_attributes=False)
    return out
a,b=blocks(old),blocks(new)
r={'base':'90047025','head':'999a8ca9','old_blocks':len(a),'new_blocks':len(b),'changed_blocks':[k for k in a if k in b and a[k]!=b[k]],'removed_blocks':list(a.keys()-b.keys()),'added_blocks':list(b.keys()-a.keys())}
(root/'probes/ast.json').write_text(json.dumps(r,indent=2)+'\n')
print(json.dumps(r,indent=2))

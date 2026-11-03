"""R260 follow-up. Usage: python probes.py TMP_WORK
TMP_WORK/repo is an isolated checkout of f1ba6eb0 with frontend dependencies.
Only TMP_WORK and that checkout are written. No live application or server access.
"""
from pathlib import Path
import contextlib,hashlib,json,subprocess,sys
w=Path(sys.argv[1]).resolve();repo=w/'repo';assert str(w).startswith('/tmp/')
sys.path.insert(0,str(repo/'scripts'))
from test_select import reads,selector,proof
result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()}
@contextlib.contextmanager
def edit(rel,fn):
 p=repo/rel;old=p.read_bytes()
 try:p.write_text(fn(old.decode()));yield p
 finally:p.write_bytes(old)
result['clean_control']=reads.problems(repo);assert result['clean_control']==[]
extra='readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");'
heavy='lcnc-webui/src/viewer/collisionContacts.test.ts';spec='lcnc-webui/e2e/freecad-import.spec.ts'
known='const bundle = JSON.parse(readFileSync(new URL("../../test-fixtures/freecad/custom-native.json", import.meta.url), "utf8"));'
old={
 'r257_same_line':(spec,lambda s:s.replace(known,known+' '+extra)),
 'r257_split_call':(spec,lambda s:s+'\n'+extra.replace('readFileSync(', 'readFileSync\n(')+'\n'),
 'r258_namespace_space':(heavy,lambda s:s+'\n'+extra.replace('readFileSync(', 'fs .readFileSync(')+'\n'),
 'r258_namespace_wrap':(heavy,lambda s:s+'\n'+extra.replace('readFileSync(', 'fs.\nreadFileSync(')+'\n'),
 'r258_mixed_import':(spec,lambda s:s+'\nimport r258fs, { constants as r258constants } from "node:fs";\n'+extra.replace('readFileSync(', 'r258fs.readFileSync(')+'\nvoid r258constants;\n'),
}
for name,(rel,fn) in old.items():
 with edit(rel,fn):
  problems=reads.problems(repo);assert problems,(name,problems)
  result[name]={'problems':problems}
path='["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/")'
forms={
 'named_default':('import { default as extraFs } from "node:fs";',f'extraFs.readFileSync({path}, "utf8")','readFileSync'),
 'named_promises':('import { promises as ioPromises } from "node:fs";',f'await ioPromises.readFile({path}, "utf8")','readFile'),
 'handed_promises':('import baseFs from "node:fs";\nconst ioPromises = baseFs.promises;',f'await ioPromises.readFile({path}, "utf8")',None),
 'destructured_promises':('import baseFs from "node:fs";\nconst { readFile } = baseFs.promises;',f'await readFile({path}, "utf8")',None),
}
for name,(imports,expression,prim) in forms.items():
 added=imports+'\nasync function r259Read() { return '+expression+'; }\n'
 f=w/(name+'.ts');f.write_text(added)
 syntax=reads.scan(repo,[str(f)])[str(f)]
 if prim:
  assert [c['prim'] for c in syntax['calls']]==[prim] and not syntax['refused'],syntax
 else:
  assert len(syntax['refused'])==1 and not syntax['calls'],syntax
 with edit(spec,lambda s:(s+'\n'+added).replace('const errors: string[] = [];','expect((await r259Read()).length).toBeGreaterThan(0);\n  const errors: string[] = [];',1)):
  problems=reads.problems(repo);assert problems,(name,problems)
  result[name]={'added':added,'call_in_test':'expect((await r259Read()).length).toBeGreaterThan(0);','scan':syntax,'problems':problems}
  if name in ('named_default','destructured_promises'):
   r=subprocess.run(['/home/cnc/lcnc-suite-tiers/lcnc-gateway/.venv/bin/python3','-B','-m','pytest','-q','-p','no:cacheprovider','scripts/test_select/test_selector.py::test_every_read_site_is_declared_exactly'],cwd=repo,text=True,capture_output=True)
   (w/(name+'-guard.txt')).write_text(r.stdout+r.stderr)
   assert r.returncode==1 and 'FAILED scripts/test_select/test_selector.py::test_every_read_site_is_declared_exactly' in r.stdout,r.stdout+r.stderr
   result[name]['guard']={'exit':r.returncode,'failed_test':'test_every_read_site_is_declared_exactly'}
# Independent closure/control cases: no need to run any file-writing operations.
cases={
 'nested_namespace_read':('import * as fs from "node:fs"; fs.default.promises.readFile("x");',['readFile'],0),
 'nested_namespace_value':('import * as fs from "node:fs"; const p = fs.default.promises;',[],1),
 'computed_namespace':('import * as fs from "node:fs"; fs.promises["readFile"]("x");',[],1),
 'unknown_export':('import { unknownThing as x } from "node:fs";',[],1),
 'unknown_member':('import fs from "node:fs"; fs.unknownThing("x");',[],1),
 'write_constants_control':('import fs, {writeFileSync, constants} from "node:fs"; fs.promises.writeFile("x", "y"); writeFileSync("x", "y"); void constants.O_RDONLY;',[],0),
 'read_import_alias':('import { readFileSync as rf } from "node:fs"; rf("x");',['readFileSync'],0),
 'reader_taken_as_value':('import {readFileSync} from "node:fs"; const r = readFileSync;',[],1),
 'comment_string_control':('const s = "fs.readFileSync(x)"; // fs.readFileSync(y)\nconst r = /x/; r.exec("x");',[],0),
 'new_read_api':('import fs from "node:fs"; fs.copyFileSync("x", "y");',['copyFileSync'],0),
 'process_run':('import * as cp from "node:child_process"; cp.spawnSync("x");',['spawnSync'],0),
 'dynamic_io':('const m = await import("node:fs");',[],1),
 'io_reexport':('export { readFileSync } from "node:fs";',[],1),
}
files=[]
for name,(src,prims,nrefused) in cases.items():
 f=w/('form-'+name+'.ts');f.write_text(src);files.append(str(f))
scanned=reads.scan(repo,files)
result['closure_controls']={}
for f,(name,(src,prims,nrefused)) in zip(files,cases.items()):
 got=scanned[f];assert [c['prim'] for c in got['calls']]==prims and len(got['refused'])==nrefused,(name,got)
 result['closure_controls'][name]=got
# Independently recalculate the selection of this scripts-only round.
sel=selector.select(repo,'0e5f30b1','f1ba6eb0',[])
assert sel['browser']['run']==[] and sel['unit']['heavy']==[] and sel['backend']['run']
result['round_selection']=sel
logs=Path('/home/cnc/lcnc-suite-tiers/docs/reviews/test-tiers.round5.gate-round.logs')
lst=json.loads((logs/'unit-light.list.json').read_text());ran=json.loads((logs/'unit-light.json').read_text())
assert proof.check_unit_executed(lst,ran)==[]
assert proof.vitest_retried(ran)==[]
from collections import Counter
statuses=Counter(a['status'] for f in ran['testResults'] for a in f['assertionResults'])
assert statuses=={'passed':2573},statuses
result['round5_reports']={'listed':len(lst),'assertions':sum(proof.vitest_ran(ran).values()),'retried':proof.vitest_retried(ran),'assertion_status':dict(statuses),
 'sha256':{f:hashlib.sha256((logs/f).read_bytes()).hexdigest() for f in ['unit-light.list.json','unit-light.json']}}
assert reads.problems(repo)==[]
assert subprocess.check_output(['git','status','--porcelain'],cwd=repo)==b''
(w/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps({k:'PASS' for k in result},indent=2))

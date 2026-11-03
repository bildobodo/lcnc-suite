"""R259 offline review. Usage: python probes.py TMP_WORK
Only TMP_WORK/repo and TMP_WORK are changed; all source edits restored.
No browser, machine connection or live-tree tests.
"""
from pathlib import Path
from unittest.mock import patch
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
assert reads.problems(repo)==[]
extra='readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");'
heavy='lcnc-webui/src/viewer/collisionContacts.test.ts';spec='lcnc-webui/e2e/freecad-import.spec.ts'
known='const bundle = JSON.parse(readFileSync(new URL("../../test-fixtures/freecad/custom-native.json", import.meta.url), "utf8"));'
old={
 'r257_same_line':(spec,lambda s:s.replace(known,known+' '+extra)),
 'r257_split_call':(spec,lambda s:s+'\n'+extra.replace('readFileSync(', 'readFileSync\n(')+'\n'),
 'r258_namespace_space':(heavy,lambda s:s+'\n'+extra.replace('readFileSync(', 'fs .readFileSync(')+'\n'),
 'r258_namespace_wrap':(heavy,lambda s:s+'\n'+extra.replace('readFileSync(', 'fs.\nreadFileSync(')+'\n'),
 'r258_mixed_import':(spec,lambda s:s+'\nimport r258fs, { constants as r258constants } from "node:fs";\n'+extra.replace('readFileSync(', 'r258fs.readFileSync(')+'\nvoid r258constants;\n'),
 'scenes_dynamic_import':('lcnc-webui/e2e/scenes.viewer.spec.ts',lambda s:s+'\nvoid import("node:fs");\n'),
}
for name,(rel,fn) in old.items():
 with edit(rel,fn):
  problems=reads.problems(repo);assert problems,(name,problems)
  result[name]={'problems':problems}
# Valid Node namespace exports; either recognizing or refusing them would satisfy the contract.
path='["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/")'
forms={
 'named_default':('import { default as extraFs } from "node:fs";',f'extraFs.readFileSync({path}, "utf8")'),
 'named_promises':('import { promises as ioPromises } from "node:fs";',f'await ioPromises.readFile({path}, "utf8")'),
 'handed_promises':('import baseFs from "node:fs";\nconst ioPromises = baseFs.promises;',f'await ioPromises.readFile({path}, "utf8")'),
 'destructured_promises':('import baseFs from "node:fs";\nconst {{ readFile }} = baseFs.promises;'.replace('{{','{').replace('}}','}'),f'await readFile({path}, "utf8")'),
}
for name,(imports,expression) in forms.items():
 # A function declaration keeps the async reads usable in the spec's existing CommonJS transform.
 added=imports+'\nasync function r259Read() { return '+expression+'; }\n'
 f=w/(name+'.ts');f.write_text(added)
 syntax=reads.scan(repo,[str(f)])[str(f)]
 assert syntax=={'calls':[],'refused':[]},(name,syntax)
 with edit(spec,lambda s:(s+'\n'+added).replace('const errors: string[] = [];', 'expect((await r259Read()).length).toBeGreaterThan(0);\n  const errors: string[] = [];',1)) as p:
  problems=reads.problems(repo);assert problems==[],(name,problems)
  result[name]={'added':added,'call_in_test':'expect((await r259Read()).length).toBeGreaterThan(0);','scan':syntax,'problems':problems}
  if name=='named_default':
   r=subprocess.run(['/home/cnc/lcnc-suite-tiers/lcnc-gateway/.venv/bin/python3','-B','-m','pytest','-q','-p','no:cacheprovider','scripts/test_select/test_selector.py','-k','not test_a_listening_port_is_seen'],cwd=repo,text=True,capture_output=True)
   (w/'mutant-guards.txt').write_text(r.stdout+r.stderr)
   result[name]['guards']={'exit':r.returncode,'output':r.stdout}
   assert r.returncode==0
 code=imports+'\nconsole.log(('+expression+').length);'
 r=subprocess.run(['node','--input-type=module','-e',code],cwd=repo/'lcnc-webui',capture_output=True,text=True,check=True)
 result[name]['node_read_length']=int(r.stdout)
with patch.object(selector,'changed_paths',return_value=[('M','scripts/test_fixtures/macro_refusals.json')]):
 sel=selector.select(repo,'HEAD','HEAD',[])
result['data_only_selection']={'browser':sel['browser']['run'],'heavy':sel['unit']['heavy'],'freecad_selected':'freecad-import' in sel['browser']['run']}
assert not result['data_only_selection']['freecad_selected']
sel=selector.select(repo,'32e6ba68','0e5f30b1',[])
assert sel['browser']['run']==['scenes.viewer'],sel
result['actual_round_selection']=sel
# Check the provided complete listing, selected listing, execution, order, and unit report ourselves.
logs=Path('/home/cnc/lcnc-suite-tiers/docs/reviews/test-tiers.round4.gate-round.logs')
full=json.loads((logs/'list-full.json').read_text());listed=json.loads((logs/'list-run.json').read_text());ran=json.loads((logs/'playwright.json').read_text())
unitlisted=json.loads((logs/'unit-light.list.json').read_text());unitran=json.loads((logs/'unit-light.json').read_text())
assert proof.check_listing(full,listed,['scenes.viewer'])==[]
assert proof.check_executed(listed,ran)==[]
assert proof.check_order(ran,proof.full_chain((repo/'lcnc-webui/playwright.config.ts').read_text()))==[]
assert proof.check_unit_executed(unitlisted,unitran)==[]
result['round4_reports']={'browser_listed':len(proof.playwright_tests(listed)),'browser_executed':len(proof.playwright_tests(ran)),
 'unit_listed':len(unitlisted),'unit_assertions':sum(proof.vitest_ran(unitran).values()),
 'sha256':{f:hashlib.sha256((logs/f).read_bytes()).hexdigest() for f in ['list-full.json','list-run.json','playwright.json','unit-light.list.json','unit-light.json']}}
assert subprocess.check_output(['git','status','--porcelain'],cwd=repo)==b''
(w/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False))

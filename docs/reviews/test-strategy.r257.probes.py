"""R257 offline follow-up. Usage: python probes.py TMP_WORK LIVE_REPO
TMP_WORK/repo is an isolated checkout of 53610c4b. Only it and TMP_WORK are
written. The existing R256 browser evidence and Claude's full report are read.
No browser or machine connection; the gate preflight briefly tests its own
random loopback port through the repository's selector tests.
"""
from pathlib import Path
import contextlib,hashlib,json,subprocess,sys
from unittest.mock import patch
w,live=map(lambda x:Path(x).resolve(),sys.argv[1:]);repo=w/'repo'
assert str(w).startswith('/tmp/')
sys.path.insert(0,str(repo/'scripts'))
from test_select import selector,reads,rules,proof,round_gate,test_selector as guards
result={}
@contextlib.contextmanager
def edit(rel,fn):
    p=repo/rel;old=p.read_bytes()
    try:p.write_text(fn(old.decode()));yield
    finally:p.write_bytes(old)
# Unchanged input cases of R256, adapted only to new APIs.
for path in ['lcnc-webui/e2e/macroFolder.ts','scripts/test_fixtures/macro_refusals.json']:
    with patch.object(selector,'changed_paths',return_value=[('M',path)]):
        sel=selector.select(repo,'HEAD','HEAD',[])
    assert 'probe-click' in sel['browser']['run']
    result[path]={'browser':sel['browser']['run'],'reads':selector.readers_of(path)}
extra='readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");'
known='const bundle = JSON.parse(readFileSync(new URL("../../test-fixtures/freecad/custom-native.json", import.meta.url), "utf8"));'
file='lcnc-webui/e2e/freecad-import.spec.ts'
variants={
 'r256_extra_line':lambda s:s+'\n'+extra+'\n',
 'r257_same_line':lambda s:s.replace(known,known+' '+extra),
 'r257_split_call':lambda s:s+'\n'+extra.replace('readFileSync(', 'readFileSync\n(')+'\n',
}
for name,fn in variants.items():
    with edit(file,fn):
        problems=reads.problems(repo)
        result[name]={'problems':problems,'actual_read_sites':reads.sites((repo/file).read_text())}
        assert bool(problems)==(name=='r256_extra_line'),(name,problems)
heavyextra='\nfs.readFileSync(path.join(ROOT, "scripts", "test_fixtures", "macro_refusals.json"), "utf8");\n'
with edit('lcnc-webui/src/viewer/collisionContacts.test.ts',lambda s:s+heavyextra):
    problems=reads.problems(repo);assert problems;result['r256_heavy_extra_line']=problems
with patch.object(selector,'changed_paths',return_value=[('M','scripts/test_fixtures/macro_refusals.json')]):
    sel=selector.select(repo,'HEAD','HEAD',[])
result['undeclared_read_not_selected']={'freecad-import_selected':'freecad-import' in sel['browser']['run'],'heavy':sel['unit']['heavy']}
# Gate really aborts before selection when the real UI graph guard fails.
with edit('lcnc-webui/src/GcodePanel.vue',lambda s:s.replace('<script setup lang="ts">','<script setup lang="ts">\nimport { PROBE_FALLBACK } from "./probeVars";\nvoid PROBE_FALLBACK;',1)):
    issues=guards.graph_problems();assert issues
    out=w/'preflight-failure.json'
    with patch.object(selector,'select',side_effect=AssertionError('selection must not be reached')) as chosen:
        code=round_gate.main(['--base','HEAD','--out',str(out)])
    data=json.loads(out.read_text());assert code==1 and data['verdict']=='FAIL' and chosen.call_count==0
    result['preflight']={'graph_problems':issues,'record':data,'selection_calls':chosen.call_count}
# The old actual focused browser report must now fail.
listed=json.loads((live/'docs/reviews/test-strategy.r256.only-listed.json').read_text())
ran=json.loads((live/'docs/reviews/test-strategy.r256.only-actual.json').read_text())
errors=proof.check_executed(listed,ran);assert len(errors)==5,errors
result['r256_actual_only_report']=errors
# Independently re-evaluate the complete run evidence (not a new full run).
logs=Path('/home/cnc/lcnc-suite-tiers/docs/reviews/test-tiers.round2.gate-round.logs')
lst=json.loads((logs/'list-run.json').read_text());ran=json.loads((logs/'playwright.json').read_text())
unitlst=json.loads((logs/'unit-light.list.json').read_text());unitran=json.loads((logs/'unit-light.json').read_text())
assert proof.check_executed(lst,ran)==[]
assert proof.check_unit_executed(unitlst,unitran)==[]
assert proof.check_order(ran,proof.full_chain((repo/'lcnc-webui/playwright.config.ts').read_text()))==[]
failmessages=[{'file':f['name'],'title':a['title'],'messages':a['failureMessages']} for f in unitran['testResults'] for a in f['assertionResults'] if a.get('failureMessages')]
result['provided_full_run']={'browser_listed':len(proof.playwright_tests(lst)),'browser_ran':len(proof.playwright_tests(ran)),
    'unit_listed':len(unitlst),'unit_assertions':sum(proof.vitest_ran(unitran).values()),'unit_failureMessages':failmessages,
    'checks':'complete and ordered','sha256':{f:hashlib.sha256((logs/f).read_bytes()).hexdigest() for f in ['list-run.json','playwright.json','unit-light.list.json','unit-light.json']}}
assert not failmessages
assert subprocess.check_output(['git','status','--porcelain'],cwd=repo)==b''
(w/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps({k:('PASS' if k not in ['r257_same_line','r257_split_call'] else 'UNKNOWN READ NOT DETECTED') for k in result},indent=2))

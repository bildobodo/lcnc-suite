"""R256 counterprobes. Only a disposable repository below /tmp is mutated.
No servers, browsers or LinuxCNC. Re-run: python probes.py COPY OUT_DIR
"""
from pathlib import Path
import contextlib,copy,importlib,json,re,subprocess,sys,tempfile
from unittest.mock import patch
repo,out=map(lambda v:Path(v).resolve(),sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
assert str(repo).startswith('/tmp/')
sys.path.insert(0,str(repo/'scripts'))
from test_select import selector,rules,proof,round_gate,graph,test_selector as guards
results={}
# Existing real imports: macroFolder -> layout-fixtures -> probe-click and others.
specs=selector.spec_files(repo,'HEAD')
direct=selector.helper_importers(repo,'HEAD','lcnc-webui/e2e/macroFolder.ts',specs)
assert 'probe-click' not in direct
assert 'from \'./macroFolder\'' in (repo/'lcnc-webui/e2e/layout-fixtures.ts').read_text()
assert "from './layout-fixtures'" in (repo/'lcnc-webui/e2e/probe-click.spec.ts').read_text()
with patch.object(selector,'changed_paths',return_value=[('M','lcnc-webui/e2e/macroFolder.ts')]):
    helper_sel=selector.select(repo,'HEAD','HEAD',[])
assert helper_sel['browser']['run']!=rules.FULL and 'probe-click' not in helper_sel['browser']['run']
with patch.object(selector,'changed_paths',return_value=[('M','scripts/test_fixtures/macro_refusals.json')]):
    data_sel=selector.select(repo,'HEAD','HEAD',[])
assert 'probe-click' not in data_sel['browser']['run']
results['transitive_helpers']={'helper':helper_sel,'fixture_data':data_sel,
    'missing_import_chain':['probe-click.spec.ts','layout-fixtures.ts','macroFolder.ts','scripts/test_fixtures/macro_refusals.json']}
# New unresolvable reads in files which already contain one known reader.
@contextlib.contextmanager
def edit(rel,change):
    p=repo/rel;old=p.read_bytes()
    try:p.write_text(change(old.decode()));yield
    finally:p.write_bytes(old)
heavy='lcnc-webui/src/viewer/collisionContacts.test.ts'
newread='\nfs.readFileSync(path.join(ROOT, "scripts", "test_fixtures", "macro_refusals.json"), "utf8");\n'
with edit(heavy,lambda s:s+newread):
    guards.test_every_heavy_read_lies_under_a_data_rule()
    guards.test_a_heavy_file_reading_from_disk_names_what_it_reads()
results['unresolved_heavy_read']={'added':newread.strip(),'file':heavy,'both_guards':'PASS despite undeclared input','later_data_change_heavy':data_sel['unit']['heavy']}
newread2='\nreadFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");\n'
with edit('lcnc-webui/e2e/freecad-import.spec.ts',lambda s:s+newread2):
    guards.test_every_e2e_disk_read_outside_the_frontend_is_declared()
results['unresolved_e2e_read']={'added':newread2.strip(),'guard':'PASS despite undeclared input','later_data_change_specs':data_sel['browser']['run']}
# Actual gate wiring: no cheap selection preflight for a UI-only round.
# Compare the real graph guard with the selection that omits the backend
# component carrying it; no full gate execution is claimed.
with patch.object(selector,'changed_paths',return_value=[('M','lcnc-webui/src/probeVars.ts')]):
    ui_sel=selector.select(repo,'HEAD','HEAD',[])
assert not ui_sel['backend']['run']
with edit('lcnc-webui/src/GcodePanel.vue',lambda s:s.replace('<script setup lang="ts">','<script setup lang="ts">\nimport { PROBE_FALLBACK } from "./probeVars";\nvoid PROBE_FALLBACK;',1)):
    issues=guards.graph_problems()
    assert any('probeVars.ts' in s for s in issues),issues
results['guard_not_run_for_ui']={'selection':ui_sel,'countercase_graph_failures':issues}
# Listing / run proof accepts different test counts even within a selected file.
def report(n):
    return {'suites':[{'specs':[{'file':'probe-click.spec.ts','title':f'case{i}',
      'tests':[{'projectName':'serial-guards','results':[{'startTime':f'2026-11-03T00:00:0{i}.000Z','duration':10,'status':'passed'}]}]} for i in range(n)]}],
      'stats':{'expected':n,'unexpected':0,'flaky':0,'skipped':0}}
full,partial=report(5),report(1)
assert proof.check_listing(full,partial,['probe-click'])==[]
assert proof.check_order(partial,[('serial-guards',True)])==[]
p=out/'partial-report.json';p.write_text(json.dumps(partial))
check={'status':'PASS'};round_gate.judge(check,round_gate.playwright_counts(p))
assert check['status']=='PASS'
results['partial_browser_proof']={'full_tests':5,'selected_or_actual_tests':1,'listing_problems':[], 'order_problems':[],'judgement':check}
(out/'results.json').write_text(json.dumps(results,indent=2))
print(json.dumps({k: ('reproduced' if k!='transitive_helpers' else v['missing_import_chain']) for k,v in results.items()},indent=2))

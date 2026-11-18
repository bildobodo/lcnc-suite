#!/usr/bin/env python3
"""R396 probes against a copy of the actual merge-run artifacts; never runs a driver."""
import argparse
import copy
import json
import shutil
import sys
import tempfile
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--root',type=Path,required=True)
p.add_argument('--logs',type=Path,required=True)
p.add_argument('--head',required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args()
sys.path.insert(0,str(a.root/'scripts/inventory'))
import coverage as c
import functions

files=['list-run.json','playwright.json','firefox-list.json','firefox.json','unit-light.list.json',
       'unit-light.json','unit-heavy.list.json','unit-heavy.json','replay.json','firefox-replay.json',
       'backend/backend.junit.xml','unit-light.options.json','unit-heavy.options.json']
out={}
with tempfile.TemporaryDirectory(prefix='r396-coverage-') as tmp:
    logs=Path(tmp)/'logs'
    originals={}
    for name in files:
        target=logs/name;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(a.logs/name,target)
        originals[name]=target.read_bytes()
    def restore():
        for name,data in originals.items():(logs/name).write_bytes(data)
    def edit(name,fn):
        path=logs/name;data=json.loads(path.read_text());fn(data);path.write_text(json.dumps(data))
    def specs(data):
        for sp in data.get('specs',[]):yield sp
        for s in data.get('suites',[]):yield from specs(s)
    def evaluate(name,live_paths=None):
        r=c.coverage_of(logs,a.head,'merge',[],live_paths or [],root=a.root,label=name)
        out[name]={'verdict':r['verdict'],'errors':r['errors'],'gaps':len(r['gaps']),
          'checked':sum(s['checked']=='passed' for f in r['functions'] for s in f['statements']),
          'arm_s2':next(s for f in r['functions'] if f['id']=='F-ARM' for s in f['statements'] if s['id']=='S2'),
          'estop_triggers':next(f for f in r['functions'] if f['id']=='F-ESTOP')['triggered']}
        print(name,out[name]['verdict'],'errors',len(r['errors']),'checked',out[name]['checked'])
        return r
    baseline=evaluate('control_actual_merge_artifacts')
    for name in ('list-run.json','firefox-list.json'):edit(name,lambda d:d.update(suites=[]))
    for name in ('unit-light.list.json','unit-heavy.list.json'):(logs/name).write_text('[]')
    evaluate('empty_browser_and_unit_listings');restore()
    edit('playwright.json',lambda d:d['config']['metadata'].update(run='different-run'))
    evaluate('foreign_playwright_run');restore()
    edit('playwright.json',lambda d:[sp.update(id='foreign-'+sp['id']) for sp in specs(d)])
    evaluate('foreign_playwright_ids');restore()
    edit('replay.json',lambda d:(d.update(run='different-run'),[x.update(test='not-listed-id') for x in d['attempt_list']]))
    evaluate('foreign_replay_run_and_ids');restore()
    edit('replay.json',lambda d:d.update(verdict='FAIL',findings=['invented invalid payload in the passed test']))
    evaluate('failed_replay');restore()
    def xfail(d):
        sp=next(sp for sp in specs(d) if sp['file']=='setup-gates.spec.ts' and sp['title'].startswith('the recovery order:'))
        for t in sp['tests']:
            t.update(expectedStatus='failed',status='expected',annotations=[{'type':'fail'}])
            t['results']=[{'status':'failed','retry':0,'errors':[{'message':'expected failure'}]}]
    edit('playwright.json',xfail)
    evaluate('expected_browser_failure');restore()
    # The native collection deviation: a metadata string, present in the
    # declared source, is not a case emitted by any native check.
    original_load=functions.load
    web,py,fns=functions.load(a.root)
    fns=copy.deepcopy(fns)
    ev=next(e for f in fns['functions'] for s in f.get('statements',[]) for e in s['evidence'] if e['layer']=='native')
    old=dict(ev);ev['title']='commit'
    functions.load=lambda root:(web,py,fns)
    r=evaluate('native_metadata_word_collected_as_case')
    out['native_metadata_word_collected_as_case']['native']=[row for f in r['functions'] for row in f['native'] if row['title']=='commit']
    out['native_metadata_word_collected_as_case']['original_evidence']=old
    functions.load=original_load
    # Existing open variants disappear from the run report, not invented input.
    out['inventory_open_variants']={'source':functions.completeness(web,py),
       'output_inventoried':baseline['functions'][0]['inventoried'],
       'output_mentions_variantsOpen':'variantsOpen' in json.dumps(baseline)}
    live_path=Path(tmp)/'live.json'
    for label,scenarios in {
        'live_absent_control': {},
        'live_null_scenario': {'sigstop_trip':None},
        'live_missing_direct': {'sigstop_trip':{}},
        'live_pass_control': {'sigstop_trip':{'direct':{'sticky_ok':True,'recovered_ok':True}}},
    }.items():
        live={'commit':a.head,'dirty':False,'run_id':'r396-synthetic','scenarios':scenarios}
        live_path.write_text(json.dumps(live))
        r=evaluate(label,[live_path])
        out[label]['live_report']=live
        out[label]['evidence']=[e for f in r['functions'] for s in f['statements']
                               for e in s['evidence'] if e['title']=='sigstop_trip']
a.out.write_text(json.dumps({'head':a.head,'code':'1ec5e093','cases':out},indent=2,ensure_ascii=False)+'\n')

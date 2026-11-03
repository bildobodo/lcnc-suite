"""R264: execute just the real browser stage twice at the SAME output path.
Not a full gate. Own copy/build and loopback mocks only. Preflight refuses busy ports.
Usage: python3 gate-repeat.py REVIEWED_CHECKOUT OUTPUT_DIR
"""
import sys,json,shutil
from pathlib import Path
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
from test_select import round_gate,proof
out=Path(sys.argv[2]); out.mkdir(exist_ok=True)
logs=out/'same.logs'; logs.mkdir(exist_ok=True)
sel={'browser':{'run':['mock-baseline']}}
(logs/'selection.json').write_text(json.dumps(sel))
rows=[]
for i in [1,2]:
    busy=[p for p in round_gate.ports() if round_gate.listening(p)]
    assert not busy, f'Foreign listener; no stage started: {busy}'
    # A previous log must not vouch for the new run. Even a prior marker must go.
    with (logs/'mock-events.jsonl').open('a') as f:f.write(json.dumps({'event':'stale-probe','run':'stale-old'})+'\n')
    checks=round_gate.browser(sel,logs)
    assert all(c['status']=='PASS' for c in checks),checks
    r=json.loads((logs/'playwright.json').read_text())
    ev=[json.loads(l) for l in (logs/'mock-events.jsonl').read_text().splitlines()]
    run=next(c['run'] for c in checks if c['name']=='browser-workers')
    assert proof.report_run(r)==run
    assert all(e['run']==run for e in ev)
    assert len([e for e in ev if e['event']=='test-start'])==2
    rows.append({'iteration':i,'run':run,'checks':checks,'stats':r['stats'],'events':ev})
    saved=out/f'iteration-{i}'; saved.mkdir()
    for name in ['playwright.json','list-run.json','mock-events.jsonl']:shutil.copyfile(logs/name,saved/name)
assert rows[0]['run']!=rows[1]['run']
(out/'result.json').write_text(json.dumps({'pass':True,'kind':'browser stage only, repeated output path','runs':rows},indent=2)+'\n')
print('PASS: two real selected browser stages, 2 + 2 tests, distinct run IDs, no inherited events')

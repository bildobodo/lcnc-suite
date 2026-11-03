"""Independent R263 consistency audit, not using proof.check_workers.
Usage: python3 reports-check.py CLAUDE_DOCS_REVIEWS
"""
import sys,json,collections,datetime
from pathlib import Path
root=Path(sys.argv[1]); out={}
def cases(report):
    rows=[]
    def walk(s,path):
        for sp in s.get('specs',[]):
            for t in sp.get('tests',[]):
                rows.append(((sp['file'],t['projectName'],' › '.join(path+[sp['title']])),t))
        for s2 in s.get('suites',[]):walk(s2,path+[s2['title']])
    for s in report['suites']:walk(s,[])
    return rows
for name in ['r263-selected','r263-full-w2','r263-full-w3']:
    p=root/f'per-worker-mock.{name}.gate-round.logs'
    r=json.loads((p/'playwright.json').read_text()); li=json.loads((p/'list-run.json').read_text())
    ev=[json.loads(s) for s in (p/'mock-events.jsonl').read_text().splitlines()]
    errors=[]; bound={}; stops=collections.defaultdict(list); starts=collections.defaultdict(list); ends=collections.defaultdict(list)
    for e in ev:
        typ=e['event']
        if typ=='bound':
            if e['instance'] in bound:errors.append('duplicate bound')
            bound[e['instance']]=e
            if e['port']!=4500+e['slot'] or e['endpoint']!=f"http://localhost:{e['port']}/":errors.append('port mapping')
        elif typ=='stopped':stops[e['instance']].append(e)
        elif typ in ['test-start','test-end']:
            (starts if typ=='test-start' else ends)[(e['file'],e['project'],e['title'])].append(e)
    rows=cases(r); expected={k for k,_ in cases(li)}
    if len({e['run'] for e in ev})!=1:errors.append('mixed runs')
    if set(starts)!=expected or set(ends)!=expected or {k for k,_ in rows}!=expected:errors.append('case identity mismatch')
    for k,t in rows:
        if len(t['results'])!=1 or len(starts[k])!=1 or len(ends[k])!=1:errors.append('case multiplicity');continue
        result=t['results'][0]; a=starts[k][0]; b=ends[k][0]; own=bound.get(a['instance']); stop=stops[a['instance']]
        if result['status']!='passed' or result['retry']!=0 or result['errors']:errors.append('case did not pass once')
        if not own or len(stop)!=1:errors.append('lifecycle missing');continue
        if any((x['workerIndex'],x['slot'])!=(result['workerIndex'],result['parallelIndex']) for x in [a,b,own]):errors.append('report owner mismatch')
        if any(x['run']!=own['run'] or x['instance']!=own['instance'] for x in [a,b,stop[0]]):errors.append('owner lifecycle mismatch')
        if not own['t']<=a['t']<=b['t']<=stop[0]['t']:errors.append('lifecycle order')
    out[name]={'tests':len(rows),'mocks':len(bound),'worker_indices':sorted({x['workerIndex'] for x in bound.values()}),'errors':dict(collections.Counter(errors))}
print(json.dumps(out,indent=2))

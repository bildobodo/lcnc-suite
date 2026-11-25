from pathlib import Path
import json
p=Path(__file__).resolve().parent
rows=[json.loads(s) for s in (p/'codex.txt').read_text().splitlines() if s.startswith('{')]
a=rows[0];c=a['counts']
assert a['total']==56971
assert sum(r['excused'] for r in c)>0
assert all(r['excused']<=r['positive'] for r in c)
assert rows[1]['checks']==74 and rows[1]['CAP']==1024
q=(p/'q16.txt').read_text()
assert 'negative 12284: excused 0' in q
assert q.count('fedOver false')==18 and q.count('fedOver true')==2
assert q.count('40 facet orders of both bodies: apart false')==2
assert q.count('40 facet orders of both bodies: apart true')==1
l=(p/'q19.txt').read_text().splitlines()
notch=[s for s in l if 'fed out ' in s]
assert len(notch)==12
assert all('S+U {collision rapid:1}' in s for s in notch)
rows=[json.loads(s) for s in (p/'pairs.txt').read_text().splitlines() if s.startswith('{')]
assert [(r['pairs'],r['maxAsks'],r['maxSteps']) for r in rows]==[(1,2,2050),(4,8,8200),(16,32,32800)]
print(json.dumps({'PASS':True,'independentReference':{'cases':a['total'],'negatives':sum(r['negative'] for r in c),'falseExemptions':0,'positives':sum(r['positive'] for r in c),'conservativeRefusals':sum(r['conservative'] for r in c)},'otherAssertions':74,'openNotchCases':12,'pairAskFactor':[r['maxAsks'] for r in rows]},indent=2))

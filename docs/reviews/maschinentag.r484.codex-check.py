from pathlib import Path
import json
p=Path(__file__).parent
rs=[json.loads(l) for l in (p/'probes.jsonl').read_text().splitlines()]
parallel=[r for r in rs if r['case']=='parallel-axis reentry']
assert [r['exempt'] for r in parallel]==[True,True,True,False,False]
shifted=parallel[2]
assert shifted['storedShift']>1e-4
assert shifted['runs'][0]['by']=={'collision rapid':1}
assert shifted['runs'][1]['by']=={}
top,bottom=[r for r in rs if r['case']=='open stock representative']
assert top['closed']==bottom['closed']==[False,True]
assert top['distance']==bottom['distance']==9
assert top['apartByReps'] is True and bottom['apartByReps'] is False
pin=[json.loads(l) for l in (p/'pin.txt').read_text().splitlines() if l.startswith('{')]
a,b=pin
assert a['oldPin']==a['body']
miss=[(x,y) for x,y in b['oldPin'] if not any(u<=y+0.01 and v>=x-0.01 for u,v in b['body'])]
assert len(miss)==1 and 57<miss[0][0]<58 and 90<miss[0][1]<91
assert b['oldPin']==b['newPin']
print('R484 observations verified: lateral tolerance counterexample; open-body representative permutation; existing pin interval absent from A+H body. These assert the findings, not compliance with the proposed contract.')

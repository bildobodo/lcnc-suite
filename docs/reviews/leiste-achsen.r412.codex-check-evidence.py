import collections
import hashlib
import json
from pathlib import Path
review = Path('/home/cnc/lcnc-suite/docs/reviews')
source = review/'leiste-achsen.r412.spindle-rows.jsonl'
rows = [json.loads(s) for s in source.read_text().splitlines()]
groups = collections.defaultdict(list)
for row in rows:
    groups[(row['browser'],row['vp'])].append(row)
assert set(groups)=={('chromium','touch-1920'),('chromium','desktop-1920'),('firefox','desktop-1920')}
result=[]
for (browser,viewport),values in groups.items():
    assert len(values)==15 and len({(r['tool'],r['word']) for r in values})==15
    assert {r['tool'] for r in values}=={'T1','T12','T99999'}
    assert {r['word'] for r in values}=={'G43','G43.1','Off (G49)','Other offset','—'}
    assert all(r['base']==r['width'] and r['secScroll']==0 and r['btnInside'] and r['wordInside'] and not r['wordCut'] and r['rowsBottomGap']==0 for r in values)
    result.append({'browser':browser,'viewport':viewport,'rows':len(values),'base':values[0]['base'],'height':values[0]['btnH']})
keys = [json.loads(s) for s in Path('/tmp/r412/key-release.jsonl').read_text().splitlines()]
assert len(keys)==6
assert all(r['clickOld']==1 and r['clickNew']==0 for r in keys)
print(json.dumps({'suppliedSpindleEvidence':result,'suppliedSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'ownKeyCases':keys},indent=2,ensure_ascii=False))

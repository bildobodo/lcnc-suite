#!/usr/bin/env python3
"""Check the declared 50-ms first-arrival limit in R164's measured browser data.
Usage: python3 acceptance.py browser-keys.json acceptance.json
This is separate from the browser specs' functional PASS.
"""
import json,sys
from pathlib import Path
cases=json.loads(Path(sys.argv[1]).read_text())
rows=[]
for case in cases:
    step=case['steps'][0]
    assert step['keys']>0, 'requires actual key input samples'
    rows.append({'shape':case['shape'],'wallMs':step['wallMs'],
                 'longestTaskMs':step['longestMs'],'longTasks':step['longTasks'],
                 'keyDelayMaxMs':step['keyDelayMaxMs'],
                 'taskWithin50ms':step['longestMs']<=50,
                 'keyWithin50ms':step['keyDelayMaxMs']<=50})
assert len(rows)==4, 'requires the four independent measured shapes'
report={'rows':rows,'allFirstArrivalTasksWithin50ms':all(x['taskWithin50ms'] for x in rows),
        'allSampledKeysWithin50ms':all(x['keyWithin50ms'] for x in rows)}
Path(sys.argv[2]).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
assert report['allFirstArrivalTasksWithin50ms'], 'Form 1 first-arrival task limit failed'
assert report['allSampledKeysWithin50ms'], 'sampled input exceeds 50 ms'

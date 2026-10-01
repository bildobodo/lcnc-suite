#!/usr/bin/env python3
"""Read-only R61 golden comparison. Usage: python3 this.py /path/to/repo"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
repo = Path(sys.argv[1])
paths = ['scripts/preview_goldens/3axis/1001.json',
         'scripts/preview_goldens/3axis/haus.json',
         'scripts/preview_goldens/3axis/kontur.json',
         'scripts/preview_goldens/twp_gantry/twp_simple_example.json',
         'scripts/test_fixtures/tool_basis_pairs.json']
def read(rev, path):
    return subprocess.check_output(['git', '-C', str(repo), 'show', f'{rev}:{path}'])
def changes(a, b, path=''):
    if type(a) is not type(b):
        return [{'path':path, 'before':a, 'after':b}]
    if isinstance(a, dict):
        assert a.keys() == b.keys(), (path, 'keys changed')
        return [d for k in a for d in changes(a[k], b[k], path+'/'+k)]
    if isinstance(a, list):
        assert len(a) == len(b), (path, 'length changed')
        return [d for i, (x,y) in enumerate(zip(a,b)) for d in changes(x,y,path+'/'+str(i))]
    return [] if a == b else [{'path':path, 'before':a, 'after':b}]
results=[]
for path in paths:
    before=read('557f8b8',path)
    after=read('9edcc9b',path)
    diff=changes(json.loads(before),json.loads(after))
    assert diff and all(d['path'].endswith('/preview_schema') and d['before']==9 and d['after']==10 for d in diff), diff
    results.append({'file':path,'sha256':hashlib.sha256(after).hexdigest(),'changes':diff})
print(json.dumps({'commit':'9edcc9b','results':results},indent=2))

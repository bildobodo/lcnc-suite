#!/usr/bin/env python3
"""R395: adjacent ownership/chain controls; synthetic logs, no gateway."""
import argparse
import json
import sys
import tempfile
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--root',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args()
sys.path.insert(0,str(a.root/'scripts/test_select'))
from test_http_paths import Rec

results={}
def check(name,rec,why=None):
    with tempfile.TemporaryDirectory(prefix='r395-extra-') as d:
        r=rec.judge(Path(d))
    ok=not r['findings'] if why is None else any(why in f for f in r['findings'])
    results[name]={'passed':ok,'expected_problem':why,'actual':r}
    print(name, 'PASS' if ok else 'FAIL',r['findings'])

def fetched():
    r=Rec().req('1','/devices').act('1','handler').act('1','fetch',op='f1')
    r.lines.append({'k':'fetched','id':'1','op':'f1','status':200})
    return r.contact('/devices','fetch:f1',served='handler').act('1','fulfill',status=200).end('1')

check('completed_fetch_control',fetched())
check('self_cycle',Rec().req('1','/devices',frm='1').act('1','catch-all').contact('/devices','req:1').end('1'),'cycle')
check('two_node_cycle',Rec().req('1','/a',frm='2').end('1').req('2','/b',frm='1').end('2'),'cycle')
r=fetched()
r.req('2','/devices').act('2','fetch',op='f2').act('2','fulfill',status=200).end('2')
next(x for x in r.lines if x['k']=='fetched')['op']='f2'
check('fetch_completion_of_other_request',r,'a fetched line of no fetch it opened')
r=fetched()
next(x for x in r.lines if x['k']=='fetched')['_in']=1
check('fetch_completion_in_other_worker',r,'a fetched line written by worker 1')
r=Rec().req('1','/devices').act('1','catch-all').contact('/devices','req:1').end('1').closing(9).closing(10)
check('duplicate_owner_close_control',r)
a.out.write_text(json.dumps({'head':'43b1531a','cases':results},indent=2)+'\n')
assert all(x['passed'] for x in results.values())

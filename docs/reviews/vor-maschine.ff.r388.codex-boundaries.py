#!/usr/bin/env python3
"""R388: exercise real core()/unload_guard() on saved reports, replacing I/O launches only."""
import copy,json,sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(sys.argv[1]).resolve()/'scripts'))
from test_select import firefox,round_gate
D=json.loads(Path(sys.argv[2]).read_text())
results=[]
for case in ['baseline','missing core report','missing guard report','guard report from other run']:
    out=Path(tempfile.mkdtemp(prefix='r388-boundary-'))
    def fake_run(name,cmd,cwd,logs,env):
        phase='guard' if name=='firefox-unload-guard' else 'core'
        orig=D[phase]
        r=json.loads(json.dumps(orig['report']).replace(orig['run'],env['LCNC_E2E_RUN']))
        e=json.loads(json.dumps(orig['events']).replace(orig['run'],env['LCNC_E2E_RUN']))
        if case=='guard report from other run' and phase=='guard':
            r['config']['metadata']['run']='not-the-requested-run'
        if case!=f'missing {phase} report':
            Path(env['PLAYWRIGHT_JSON_OUTPUT_FILE']).write_text(json.dumps(r))
        Path(env['LCNC_E2E_EVENTS']).write_text(''.join(json.dumps(x)+'\n' for x in e))
        return {'name':name,'status':'PASS','exit':0,'seconds':0}
    with patch.object(round_gate,'output',return_value='Version isolated-proof'), \
         patch.object(firefox.fetch_firefox,'fetch',return_value={'sha256':'unused','binary':'/not-executed','cache':'proof'}), \
         patch.object(firefox.fetch_firefox,'check_newer',return_value={'status':'not queried'}), \
         patch.object(round_gate,'listing',return_value=(D['core']['report'],None)), \
         patch.object(round_gate,'listening',return_value=False), \
         patch.object(round_gate,'run',side_effect=fake_run):
        r=firefox.core(out,replay_on=False,missing='FAIL')
    checks={c['name']:c for c in r['checks']}
    failed={k:c.get('why') for k,c in checks.items() if c['status']!='PASS'}
    if case=='baseline':assert not failed,failed
    elif case=='missing core report':
        assert 'firefox-core' in failed and 'no report' in str(failed['firefox-core']),failed
        assert 'firefox-browser' not in checks and 'firefox-graphics' not in checks
    elif case=='missing guard report':
        assert {'firefox-unload-guard','firefox-browser','firefox-graphics'}<=failed.keys(),failed
        assert all('no report' in str(failed[k]) for k in ['firefox-unload-guard','firefox-browser','firefox-graphics'])
    else:assert 'firefox-unload-guard' in failed and 'not-the-requested-run' in str(failed['firefox-unload-guard']),failed
    results.append({'case':case,'checks':r['checks'],'expected_result_observed':True,'output':str(out)})
print(json.dumps({'evaluator':'cd23f813','method':'Saved R387 reports, run IDs rebound to the generated request; external commands not executed','results':results},indent=2))

#!/usr/bin/env python3
"""R332 own counterexamples. Private locks, FakeHost, no services or machine.
Usage: python3 cases.py /tmp/archive
"""
from pathlib import Path
from unittest.mock import patch
import contextlib,io,json,sys,subprocess,tempfile,os
ROOT=Path(sys.argv[1]).resolve()
# A fallback lock path for every import/child, regardless of test fixtures.
with tempfile.TemporaryDirectory(prefix='r332-cases-') as tmp:
    d=Path(tmp);os.environ['LCNC_HEAVY_LOCK']=str(d/'heavy.lock')
    sys.path[:0]=[str(ROOT/'scripts'),str(ROOT/'scripts/test_select')]
    import native_run as nr
    from test_native_stage import FakeHost
    from test_support import heavy_lock as hl,restore_lan as rl
    out=[]; logs=io.StringIO()
    with contextlib.redirect_stdout(logs):
        # The real successful run restores in finally and settles; a waiting
        # new gate may now enter before the first unit's mandatory post proof.
        h=FakeHost();run=d/'normal'
        with hl.heavy_lock('probe'):
            report=nr.run(h,[('own no-machine case',lambda c:[{'case':'own','status':'PASS'}])],run)
        before=hl.owed(); real_lock=hl.heavy_lock
        with hl.heavy_lock('next gate',wait=0):
            def short_restore_lock(who,wait=None,path=None,owed_by=None):
                return real_lock(who,wait=.01,path=path,owed_by=owed_by)
            try:
                with patch.object(hl,'heavy_lock',short_restore_lock):
                    rl.main(['--from',str(run/'pre.json'),'--out',str(run/'restore-post.json')],host_factory=lambda _:h)
            except TimeoutError as e:err=str(e)
            else:err=None
        out.append({'case':'normal_return_releases_before_mandatory_post','verdict':nr.verdict(report),
                    'normal_restore':report['restore']['outcome'],'owed_after_finally':before,
                    'next_gate_entered':True,'post_error':err,'post_report_exists':(run/'restore-post.json').exists(),
                    'production_restore_wait_s':600,'scaled_wait_s':.01})
        # The post proof itself succeeds after the competing gate is gone.
        rc=rl.main(['--from',str(run/'pre.json'),'--out',str(run/'restore-post.json')],host_factory=lambda _:h)
        out[-1]['post_after_gate_ended']={'rc':rc,'outcome':json.loads((run/'restore-post.json').read_text())['outcome']}

        # Exact locking mechanism of the documented external repro-load.sh;
        # replace the load body with a print, never execute burners/npx.
        with hl.heavy_lock('probe'):
            hl.owe('/private/run-that-still-owes')
        cmd=['bash','-c','exec 9>>"$1"; flock -n 9 || exit 4; printf "RAW_FLOCK_ENTERED\\n"', 'own-lock-test',str(hl.LOCK)]
        r=subprocess.run(cmd,capture_output=True,text=True,timeout=5)
        out.append({'case':'documented_load_runner_raw_flock','marker':hl.owed(),
                    'returncode':r.returncode,'stdout':r.stdout.strip()})
        hl.settle('/private/run-that-still-owes')

        # Diagnostic of how the new state reader treats unread/invalid marks.
        # No real filesystem failure is induced: one read is mocked.
        with hl.heavy_lock('probe'):hl.owe('/private/run')
        real_read=Path.read_text; owed=hl._owed_path(hl.LOCK)
        def denied(p,*a,**k):
            if p==owed:raise PermissionError('own simulated unreadable marker')
            return real_read(p,*a,**k)
        with patch.object(Path,'read_text',denied):
            with hl.heavy_lock('next gate',wait=0):entered=True
        out.append({'case':'unreadable_marker_is_admitted','next_gate_entered':entered,'marker_still_present':hl.owed()})
        hl.settle('/private/run')
    print(json.dumps({'cases':out,'captured_messages':logs.getvalue().splitlines()},indent=2))

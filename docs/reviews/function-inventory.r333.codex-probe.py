#!/usr/bin/env python3
"""R333 isolated recheck: FakeHost, private locks, real shell entry with fake
ss/npx and ZERO burners. No service, controller or live port is used.
Usage: python3 probe.py /tmp/archive /path/to/repro-load.sh
"""
from pathlib import Path
from unittest.mock import patch
import contextlib,io,json,os,sys,subprocess,tempfile,time,signal,hashlib
ROOT=Path(sys.argv[1]).resolve(); LOAD=Path(sys.argv[2]).resolve()
with tempfile.TemporaryDirectory(prefix='r333-cases-') as tmp:
    d=Path(tmp);os.environ['LCNC_HEAVY_LOCK']=str(d/'heavy.lock')
    sys.path[:0]=[str(ROOT/'scripts')]
    import native_run as nr
    from test_native_stage import FakeHost
    from test_support import heavy_lock as hl, restore_lan as rl
    out=[];messages=io.StringIO()
    def admitted(owner=None):
        try:
            with hl.heavy_lock('own candidate',wait=0,owed_by=owner):return True,None
        except TimeoutError as e:return False,str(e)
    with contextlib.redirect_stdout(messages):
        h=FakeHost();run=d/'normal'
        with hl.heavy_lock('probe'):
            report=nr.run(h,[('own case',lambda c:[{'case':'own','status':'PASS'}])],run)
        marker_before=hl.owed();entered,why=admitted()
        assert nr.verdict(report)=='PASS' and marker_before['run']==str(run) and not entered
        rc=rl.main(['--from',str(run/'pre.json'),'--out',str(run/'restore-post.json')],host_factory=lambda _:h)
        post=json.loads((run/'restore-post.json').read_text())
        after,_=admitted()
        assert rc==0 and post['outcome']=='complete' and post['owed']=='settled' and after and hl.owed() is None
        out.append({'case':'A1_normal_run_through_final_restore','normal_verdict':nr.verdict(report),
                    'owed_after_finally':marker_before,'next_gate_before_post':entered,
                    'post':{'rc':rc,'outcome':post['outcome'],'owed':post['owed']},'next_gate_after_post':after})

        # Re-run R332's injected read error, then malformed JSON/schema cases.
        mark=hl._owed_path(hl.LOCK);read_text=Path.read_text
        for kind,text in [('permission',None),('invalid_json','{'),('wrong_shape','[]'),('empty_run','{"run":""}')]:
            hl.owe('/own/run')
            if text is not None:mark.write_text(text)
            def read(p,*a,**k):
                if kind=='permission' and p==mark:raise PermissionError('own read fault')
                return read_text(p,*a,**k)
            with patch.object(Path,'read_text',read):
                other,other_why=admitted();owner,owner_why=admitted('/own/run')
                settlement=hl.settle('/own/run')
            assert not other and not owner and settlement.startswith('unreadable:') and mark.exists()
            out.append({'case':'A3_'+kind,'ordinary_admitted':other,'owner_admitted':owner,'settle':settlement,'marker_kept':mark.exists()})
            mark.unlink()   # only this probe's private malformed fixture
        free,_=admitted();assert free
        out.append({'case':'A3_confirmed_absent','admitted':free})

        # Actual updated external script: fake only the WORKLOAD commands.
        # The lock helper, env/exec/bash path and inherited fd stay real.
        fake=d/'bin';fake.mkdir(); target=d/'load-result.json';entered_file=d/'load-entered'
        (fake/'ss').write_text('#!/bin/sh\nexit 0\n')
        (fake/'npx').write_text('#!/usr/bin/env python3\nimport os,time,json\nfrom pathlib import Path\n'
            'Path(os.environ["R333_ENTERED"]).write_text("entered")\n'
            'Path(os.environ["PLAYWRIGHT_JSON_OUTPUT_FILE"]).write_text(json.dumps({"suites":[]}))\n'
            'time.sleep(1)\n')
        for p in fake.iterdir():p.chmod(0o755)
        env={**os.environ,'PATH':str(fake)+os.pathsep+os.environ['PATH'],'R333_ENTERED':str(entered_file)}
        env.pop('LCNC_HEAVY_LOCK_HELD',None)
        hl.owe('/own/owed-before-load')
        p=subprocess.Popen(['bash',str(LOAD),str(ROOT),str(target),'1','0','own-placeholder.spec.ts'],env=env,
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        try:
            time.sleep(.5)
            blocked=p.poll() is None and not entered_file.exists() and not target.exists()
            assert blocked,'load ran despite an owed return'
            hl.settle('/own/owed-before-load')
            deadline=time.monotonic()+5
            while not entered_file.exists() and time.monotonic()<deadline and p.poll() is None:time.sleep(.01)
            assert entered_file.exists(),'workload not entered after settlement'
            while_body,body_why=admitted()
            assert not while_body,'executed shell did not retain the descriptor'
            stdout,stderr=p.communicate(timeout=5)
            after_body,_=admitted()
            assert p.returncode==0 and after_body
            out.append({'case':'A2_actual_repro_script','script':str(LOAD),'sha256':hashlib.sha256(LOAD.read_bytes()).hexdigest(),
                'blocked_while_owed':blocked,'entered_after_settle':entered_file.exists(),
                'gate_admitted_during_fake_workload':while_body,'gate_admitted_after_exit':after_body,
                'exit':p.returncode,'stdout':stdout.splitlines(),'stderr':stderr.splitlines(),
                'workload':'ss empty; npx own JSON stub; burners=0; no Playwright or CPU load'})
        finally:
            if p.poll() is None:os.killpg(p.pid,signal.SIGKILL)
            p.wait(timeout=5)
    print(json.dumps({'checks':out,'captured_messages':messages.getvalue().splitlines()},indent=2))

#!/usr/bin/env python3
"""R318 saved-data replay; argv[1] exact archive. No live connections.
HAL from raw samples and receipt files; protocol observations from the
sanitized sequences/metadata now preserved in the reports, not new traffic.
"""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(sys.argv[1])/'scripts'))
import native_run as nr
from test_support import servo as sv, servo_cases as sc, servo_time as st

runs=[]
for name in ['20261106T033826','20261106T034700-latch-delayed']:
    folder=Path('/home/cnc/claude-work/live-tier')/name
    hashes={}
    def read(filename):
        data=(folder/filename).read_bytes(); hashes[filename]=hashlib.sha256(data).hexdigest()
        return json.loads(data)
    report=read('report.json'); rows={r['case']:r for r in report['rows']}
    assert report['commit'].startswith('d4b843d6')
    clock=report['clock']; assert st.clock_contract(clock['sha256'],clock['version'])==clock
    restored={}
    for filename in ['restore.json','restore-post.json']:
        d=read(filename); restored[filename]={k:d.get(k) for k in ['outcome','isolation','cleanup']}
        assert d['outcome']=='complete' and not d['isolation'] and not d['cleanup']
    out={'run':name,'commit':report['commit'],'clock':clock,'restore':restored,'results':{},'sha256':hashes}
    for rec in report['servo_sections']:
        case=rec['case']
        if not case.startswith(('clients','disconnect','latch')): continue
        data=(folder/rec['file']).read_bytes(); hashes[rec['file']]=hashlib.sha256(data).hexdigest()
        samples=[json.loads(line) for line in data.splitlines()]; times=read(rec['time_file'])
        assert all(b[1]==a[1]+1 for a,b in zip(samples,samples[1:]))
        assert samples[-1][1]+1==rec['end_n'] and samples[0][1]==rec['first_n']
        assert len(samples)==rec['samples'] and not rec['problems']
        sec={'samples':samples,'problems':rec['problems'],'t0_ns':times['t0_ns'],
             'recv_ns':dict(times['recv_ns']),'clock':clock,
             'phase_first':{p['mark']:next(i for i,s in enumerate(samples) if s[2][sv.MARK_INDEX]==p['mark'])
                            for p in times['phases']}}
        if case.startswith('clients'):
            old=rows[case]; marks=[p['mark'] for p in times['phases']]
            r=sc.eval_clients(case,sec,*marks,old['n'],old['hellos'],old['fetches'],old['published'])
            keys=['status','detail','worst_upper_ns','worst_lower_ns','pre_ns','post_ns','pairs']
            assert all(r[k]==old[k] for k in keys)
            assert all(f['version']==old['published']['version'] for f in old['fetches'])
            out['results'][case]={k:r[k] for k in keys}
            out['results'][case]['wrap_proof']=st.proven(samples,sec['recv_ns'],sec['t0_ns'],clock)
        elif case.startswith('disconnect'):
            old=rows[case]; mark=times['phases'][0]['mark']
            frames=[(i,{'interp_state':interp,'task_mode':mode}) for i,(interp,mode) in enumerate(old['b_states'])]
            r=sc.eval_disconnect(case,sec,mark,old['event'],frames,
                                 frozenset(range(1,len(nr.DISC_PROGRAM.splitlines())+1)))
            keys=['status','detail','frames_after','w_n','travel_mm','window_ns_lower']
            assert all(r[k]==old[k] for k in keys)
            out['results'][case]={k:r[k] for k in keys}
            out['results'][case]['wrap_proof']=st.proven(samples,sec['recv_ns'],sec['t0_ns'],clock)
        elif case=='latch-outage':
            delayed=report.get('variant')=='latch-delayed'
            cid='latch-same-cycle.delayed-order' if delayed else 'latch-same-cycle'
            same=sc.eval_latch_same_cycle(cid,sec,delayed)
            old=rows[cid]
            for k,v in same.items(): assert old[k]==v,(cid,k,v,old[k])
            old=rows['latch-sticky']
            sticky=sc.eval_latch_sticky('latch-sticky',sec,old['reset_reply'],old['trip_frames'])
            for k,v in sticky.items(): assert old[k]==v,('sticky',k)
            out['results'][case]={'same_cycle':same,'sticky':sticky}
        else:
            old=rows['latch-recovered']
            r=sc.eval_latch_recovered('latch-recovered',sec,old['frames'])
            for k in ['status','detail','samples','cleared_n','frames']: assert old[k]==r[k]
            assert not r['last_frame']['safety_trip'] and r['last_frame']['is_estop'] is False
            assert r['last_frame']['is_enabled'] is True
            out['results'][case]=r
    assert all(r['status']=='PASS' for case,r in out['results'].items() if case!='latch-outage')
    out['protocol_source']='Saved report: B states, trip flags, recovery frames, HTTP response metadata and reset reply. Bodies not fetched again.'
    runs.append(out)
print(json.dumps(runs,ensure_ascii=False,indent=2))

#!/usr/bin/env python3
"""Recompute saved R317 servo evidence, no live access. argv[1]: archive.
Protocol frame assertions cannot be replayed: their raw frames were not saved.
Published/fetch metadata below is reused from the supplied report, not independently verified.
"""
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(sys.argv[1]); sys.path.insert(0,str(ROOT/'scripts'))
from test_support import servo as sv, servo_cases as sc, servo_time as st

def clock_fields(value, path=''):
    fields=[]
    if isinstance(value,dict):
        for key,item in value.items():
            name=path+'.'+key
            if 'clock' in key.lower() or 'rtapi' in key.lower(): fields.append(name)
            fields.extend(clock_fields(item,name))
    elif isinstance(value,list):
        for i,item in enumerate(value): fields.extend(clock_fields(item,path+f'[{i}]'))
    return fields

runs=[]
for name in ['20261106T030736','20261106T031618-latch-delayed']:
    folder=Path('/home/cnc/claude-work/live-tier')/name
    report=json.loads((folder/'report.json').read_text())
    rows={r['case']:r for r in report['rows']}
    out={'run':name,'commit':report['commit'],'recorded_verdict':report['verdict'],
         'results':{},'sha256':{},'clock_metadata_fields':clock_fields(report),
         'servo_metadata_fields':list(report.get('servo',{})), 'restore':{}}
    assert not out['clock_metadata_fields']
    for name2 in ['report.json','restore.json','restore-post.json']:
        data=(folder/name2).read_bytes(); out['sha256'][name2]=hashlib.sha256(data).hexdigest()
        if name2!='report.json':
            restore=json.loads(data)
            out['restore'][name2]={k:restore.get(k) for k in ['outcome','isolation','cleanup']}
            assert restore.get('outcome')=='complete'
            assert not restore.get('isolation') and not restore.get('cleanup')
    for rec in report['servo_sections']:
        case=rec['case']
        if not case.startswith(('clients','disconnect','latch')): continue
        sample_file=folder/rec['file']; time_file=folder/rec['time_file']
        data=sample_file.read_bytes(); td=time_file.read_bytes()
        out['sha256'][sample_file.name]=hashlib.sha256(data).hexdigest()
        out['sha256'][time_file.name]=hashlib.sha256(td).hexdigest()
        samples=[json.loads(x) for x in data.splitlines()]
        times=json.loads(td)
        assert all(b[1]==a[1]+1 for a,b in zip(samples,samples[1:]))
        assert samples[-1][1]+1==rec['end_n']
        assert len(samples)==rec['samples'] and not rec['problems']
        sec={'samples':samples,'problems':rec['problems'],'t0_ns':times['t0_ns'],
             'recv_ns':dict(times['recv_ns']), 'phase_first':{p['mark']:next(
                 i for i,s in enumerate(samples) if s[2][sv.MARK_INDEX]==p['mark'])
                 for p in times['phases']}}
        if case.startswith('clients'):
            old=rows[case]; marks=[p['mark'] for p in times['phases']]
            row=sc.eval_clients(case,sec,*marks,old['n'],old['hellos'],old['fetches'],old['published'])
            for key in ['status','worst_upper_ns','worst_lower_ns','pre_ns','post_ns','pairs']:
                assert row[key]==old[key],(case,key,row[key],old[key])
            out['results'][case]={'arithmetic_and_samples':{k:row[k] for k in
                 ['status','worst_upper_ns','worst_lower_ns','pre_ns','post_ns','pairs']},
                 'wrap_proof':st.proven(samples,sec['recv_ns'],sec['t0_ns']),
                 'protocol_inputs':'reused report metadata'}
        elif case.startswith('disconnect'):
            a=next(iter(sec['phase_first'].values())); rng=st.proven(samples,sec['recv_ns'],sec['t0_ns'])
            w=samples[a:]
            travel=sum(abs(x[2][0]-y[2][0]) for x,y in zip(w,w[1:]))
            duration=st.duration_lower(samples,rng,a,len(samples)-1)
            assert duration==rows[case]['window_ns_lower']
            assert round(travel,3)==rows[case]['travel_mm']
            assert all(s[2][sv.LATCH]==0 for s in samples)
            out['results'][case]={'duration_ns_lower':duration,'travel_mm':round(travel,3),
                'wrap_proof':rng,'latch_false':True,'B_frames':'not saved; not independently replayed'}
        elif case=='latch-outage':
            delayed=report.get('variant')=='latch-delayed'
            cid='latch-same-cycle.delayed-order' if delayed else 'latch-same-cycle'
            same=sc.eval_latch_same_cycle(cid,sec,delayed)
            assert same['status']==rows[cid]['status']=='PASS'
            assert same['edge_n']==rows[cid]['edge_n']
            e=same['edge_index']; start=e+int(delayed)
            assert all(s[2][sv.LATCH]==0 for s in samples[:e])
            assert all(s[2][sv.LATCH]==1 for s in samples[start:])
            assert any(s[2][sv.HB_OK]==1 for s in samples[e+1:])
            out['results'][case]={'same_cycle':same,'sticky_hal':True,
                                 'trip_frames_and_early_reset':'not replayed from raw protocol'}
        else:
            first=next(i for i,s in enumerate(samples) if s[2][sv.LATCH]==0)
            assert all(s[2][sv.LATCH]==0 for s in samples[first:])
            assert samples[first][1]==rows['latch-recovered']['cleared_n']
            out['results'][case]={'latch_clear_from':samples[first][1],
                                 'clear_to_end':True,'status_frames':'not saved'}
    runs.append(out)
print(json.dumps(runs,indent=2))

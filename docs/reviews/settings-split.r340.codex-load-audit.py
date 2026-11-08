"""Independent read-only audit of R340 report2 against R339 preserved samples.
Usage: python3 this.py <docs/reviews-directory>
No writes, network or simulation calls. Histogram bins are not exact values.
"""
import hashlib,json,math,sys
from pathlib import Path
root=Path(sys.argv[1])
def rows(n):
    return [json.loads(x) for x in (root/('settings-split.r339.codex-load.raw-'+n+'.jsonl')).read_text().splitlines()]
report=json.loads((root/'settings-split.r340.load-report2.json').read_text())
starts={}; phases=[]
for m in rows('marks'):
    if m['edge']=='start': starts[m['phase']]=m['t']
    else:phases.append((m['phase'],starts[m['phase']],m['t']))
out={'checks':[],'limits':[
    'Quantiles and window maxima describe fully contained windows; phase edges remain separate.',
    'The first-busy/next-idle CPU interval is a sampled interval, not exact check execution time.',
    'No hardware-panel GPU result, peak latency guarantee or extra native run is inferred.'
]}
for name,lo,hi in phases:
    for device in ['panel','laptop']:
        r=[x['rec'] for x in rows('perf-'+device)]
        inside=[x for x in r if lo<=x['win_start'] and x['win_end']<=hi]
        edge=[x for x in r if x['win_start']<hi and x['win_end']>lo and not(lo<=x['win_start'] and x['win_end']<=hi)]
        actual=report['phases'][name][device]['status']
        assert actual['windows_inside']==len(inside)
        assert len(actual['edge_windows'])==len(edge)
        for channel,field,maxfield in [('age','age_h','age_max_ms'),('cadence_gap','gap_h','gap_max_ms')]:
            expanded=sorted(float(b) for x in inside for b,n in x[field].items() for _ in range(n))
            assert actual[channel]['n']==len(expanded)
            for q in [50,95,99]:assert actual[channel][f'p{q}_bin_ms']==expanded[math.ceil(len(expanded)*q/100)-1]
            assert actual[channel]['window_max_ms']==max(x[maxfield] for x in inside)
        ordered=sorted(inside,key=lambda x:x['win_start'])
        gaps=[round(b['win_start']-a['win_end'],3) for a,b in zip(ordered,ordered[1:])]
        out['checks'].append({'phase':name,'device':device,'histograms_and_maxima_match':True,
          'inside_seconds':actual['covered_s'],'phase_seconds':(hi-lo)/1000,
          'edge_windows':len(edge),'inner_window_gap_max_ms':max(gaps,default=0),
          'start_without_whole_window_ms':round(ordered[0]['win_start']-lo,1),
          'end_without_whole_window_ms':round(hi-ordered[-1]['win_end'],1)})
for name,lo,hi in phases:
    data=[x for x in rows('samples') if lo<=x['t']<=hi]
    for device in ['panel','laptop']:
        cpu=round(100*(data[-1][device]['cpu']-data[0][device]['cpu'])/((data[-1]['t']-data[0]['t'])/1000),1)
        assert cpu==report['phases'][name][device]['cpu_pct_phase']
out['sha256_report']=hashlib.sha256((root/'settings-split.r340.load-report2.json').read_bytes()).hexdigest()
print(json.dumps(out,indent=2))

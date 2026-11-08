"""Read-only R339 audit: receipt-time phase selection vs actual page windows.
Usage: python3 measurement-audit.py <raw-directory> [filename-prefix]
Contained-window maxima below are NOT full-phase verdicts. Border windows
need separate accounting; one histogram cannot be split by event time.
"""
import hashlib
import json
import sys
from pathlib import Path
root = Path(sys.argv[1])
prefix = sys.argv[2] if len(sys.argv)>2 else ''
def read(name):
    return [json.loads(s) for s in (root/(prefix+name)).read_text().splitlines() if s.strip()]
marks=read('marks.jsonl'); starts={}; phases=[]
for m in marks:
    if m['edge']=='start': starts[m['phase']]=m['t']
    else: phases.append((m['phase'],starts[m['phase']],m['t']))
files=['marks.jsonl','samples.jsonl','perf-panel.jsonl','perf-laptop.jsonl']
out={'source':str(root),'sha256':{n:hashlib.sha256((root/(prefix+n)).read_bytes()).hexdigest() for n in files},'devices':{}}
for name in ['panel','laptop']:
    perf=read('perf-'+name+'.jsonl'); rows={}
    for phase,t0,t1 in phases:
        selected=[p for p in perf if t0<=p['t']<=t1]
        contained=[p for p in perf if t0<=p['rec']['win_start']<=p['rec']['win_end']<=t1]
        wrong=[p for p in selected if not t0<=p['rec']['win_start']<=p['rec']['win_end']<=t1]
        worst=max(selected,key=lambda p:p['rec'].get('age_max_ms',0))
        rows[phase]={
          'phase_ms':[t0,t1], 'selected_by_receipt_n':len(selected),
          'selected_not_wholly_inside_phase_n':len(wrong),
          'max_receipt_delay_ms':round(max(p['t']-p['rec']['win_end'] for p in selected),1),
          'receipt_selected_age_max_ms':worst['rec'].get('age_max_ms'),
          'worst_age_window_relative_to_phase_start_ms':[round(worst['rec'][k]-t0,1) for k in ['win_start','win_end']],
          'fully_contained_age_max_ms_NOT_full_phase':max((p['rec'].get('age_max_ms',0) for p in contained),default=None),
          'border_or_foreign_windows':[{'receipt':p['t'],'window':[p['rec']['win_start'],p['rec']['win_end']],
              'age_max_ms':p['rec'].get('age_max_ms')} for p in wrong],
          'raw_histograms_available':all('age_h' in p['rec'] and 'gap_h' in p['rec'] for p in selected),
        }
    out['devices'][name]=rows
samples=read('samples.jsonl')
out['sampling']={'n':len(samples),'max_gap_ms':max(b['t']-a['t'] for a,b in zip(samples,samples[1:])),
  'panel_collision_seen':any((r['panel'].get('work') or {}).get('worker') for r in samples),
  'panel_unobserved_work_n':sum(r['panel'].get('work') is None for r in samples)}
out['interpretation']=[
  'Receipt-time selection includes foreign/border windows; use actual windows and explicit edge accounting.',
  'A max of window p95 values is not the pooled phase p95; gap and status age are distinct.',
  'Max gap refutes an uninterrupted once-per-second work probe. No observed panel worker is still meaningful.',
  'CPU difference 258.9-142.9=116.0 percentage points belongs to the 47.9 s load phase, not only its 36.1 s check.',
  'No complete performance acceptance or causal path attribution is calculated by this audit.'
]
print(json.dumps(out,indent=2))

"""Offline simDump boundary and synthetic-coverage controls; no live truth."""
import json,sys
from pathlib import Path
root=Path(sys.argv[1]);sys.path.insert(0,str(root/'scripts'))
from sim_parity import compare_files
rows=[json.loads(s) for s in (root/'r126.dump.jsonl').read_text().splitlines()]
samples=[r for r in rows if 'joints' in r]
chain=json.loads((root/'r126.codex-chain.json').read_text())
band_pts=[p for p in chain['points'] if p['band']]
end=max(p['cum'] for p in band_pts)
assert any(r.get('band') for r in samples)
assert not any(r.get('band') and r['cum']>end+1e-4 for r in samples)
# A synthetic reference truncates just the brake leg at -102.13 (P=-100).
# This checks the changed directionality, not a physical brake model.
truth=[{'joints':list(r['joints'])} for r in samples]
for r in truth: r['joints'][2]=max(r['joints'][2],-102.13)
t=root/'r126.synthetic-truth.ndjson';t.write_text('\n'.join(json.dumps(r) for r in truth)+'\n')
plain=root/'r126.no-band.jsonl';plain.write_text('\n'.join(json.dumps({'joints':r['joints']}) for r in samples)+'\n')
ok,report=compare_files(str(t),str(root/'r126.dump.jsonl'),.5)
without,rep_without=compare_files(str(t),str(plain),.5)
assert ok
assert not without
out={'samples':len(samples),'band_samples':sum(bool(r.get('band')) for r in samples),'band_end_cum':end,'band_outside_end':False,'synthetic_coverage_ok':ok,'synthetic_coverage_report':report,'without_band_ok':without,'without_band_report':rep_without,'limitation':'Synthetic reference; no live measurement, no parity acceptance.'}
(root/'r126.codex-parity.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))

from pathlib import Path
root=Path('/tmp/r497/tree/lcnc-webui')
src=(root/'src/viewer/collision.ts').read_text()
needle='            const step = cutStep(was, cls, () => !entryRapid || boundary, () => known && ownHole(pi, free));'
assert src.count(needle)==1
src=src.replace(needle,needle+'\n            (globalThis as any).__R497?.push({s, isRapid, inBand, was, f, known, entryAt, entryRapid, entryBand: bandAt(segAtDist(entryAt), entryAt), next:step.state, beforeMute:cutMute[pi], ep:epRow[pi]});')
(root/'src/viewer/collisionR497Probe.ts').write_text(src)
h=(root/'src/viewer/stockMuteHarness.ts').read_text().replace('from "./collision"','from "./collisionR497Probe"')
(root/'src/viewer/stockMuteR497Harness.ts').write_text(h)
p=(root/'r497-band-probe.ts').read_text().replace('stockMuteHarness','stockMuteR497Harness')
p=p.replace(' const r=findings', ' (globalThis as any).__R497=[]; const r=findings').replace('results.push({approach', 'results.push({trace:(globalThis as any).__R497,approach')
(root/'r497-band-trace.ts').write_text(p)

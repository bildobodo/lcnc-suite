from pathlib import Path
import subprocess,os,json
p=Path('/tmp/codex-r409/lcnc-webui/e2e/strip-fit.spec.ts');before=p.read_text()
a="  expect(fit.clipped, 'cut sideways under the note').toEqual([]);"
b="  expect([...fit.clipped, ...fit.wraps], 'cut sideways under the note').toEqual([]);"
assert before.count(a)==1
try:
 p.write_text(before.replace(a,b))
 with Path('/tmp/r409-mutant.txt').open('w') as f:
  r=subprocess.run(['npx','playwright','test','e2e/strip-fit.spec.ts','--grep','corner chamfer','--workers=1','--reporter=line,json'],cwd=p.parent.parent,stdout=f,stderr=subprocess.STDOUT,env={**os.environ,'LCNC_E2E_RUN':'codex-r409-mutant','LCNC_E2E_EVENTS':'/tmp/r409-mutant-events.jsonl','LCNC_E2E_REPLAY_DIR':'/tmp/r409-mutant-replay','LCNC_E2E_HTTP_DIR':'/tmp/r409-mutant-http','PLAYWRIGHT_JSON_OUTPUT_FILE':'/tmp/r409-mutant.json'})
 Path('/tmp/r409-mutant.exit').write_text(str(r.returncode)+'\n')
 assert r.returncode==1,r.returncode
finally:p.write_text(before)

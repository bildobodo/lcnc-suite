"""R256 accidental test.only counterprobe. Usage: python only-probe.py TMP_WORK
TMP_WORK/repo must be a disposable copy of 08fb69d9 with node_modules.
Only lists tests and runs a no-browser sentinel, all web servers disabled.
"""
from pathlib import Path
import subprocess,json,os,sys
w=Path(sys.argv[1]).resolve();root=w/'repo';web=root/'lcnc-webui'
assert str(w).startswith('/tmp/')
sys.path.insert(0,str(root/'scripts'))
from test_select import proof,round_gate
p=web/'e2e/probe-click.spec.ts';old=p.read_bytes();c=web/'r256-only.config.ts'
selection=w/'only-selection.json';selection.write_text('["probe-click"]')
env={**os.environ,'LCNC_E2E_SELECTION':str(selection)}
try:
    p.write_text(old.decode()+ '\ntest.only("R256 accidental focus sentinel", () => { expect(1).toBe(1); });\n')
    c.write_text('import { defineConfig } from "@playwright/test";\nimport selected from "./playwright.select.config";\nexport default defineConfig({...selected, webServer: []});\n')
    # No browser fixture in sentinel, no servers, no machine.
    runs={}
    for name,extra in [('full-list',['--list']),('selected-list',['-c','playwright.select.config.ts','--list']),('actual',['-c','r256-only.config.ts'])]:
        cmd=['npx','playwright','test',*extra,'--reporter=json']
        r=subprocess.run(cmd,cwd=web,env=env,capture_output=True,text=True)
        (w/f'only-{name}.json').write_text(r.stdout);(w/f'only-{name}.err').write_text(r.stderr)
        assert r.returncode==0,(name,r.stderr,r.stdout[-1000:])
        runs[name]=json.loads(r.stdout)
    listing=proof.check_listing(runs['full-list'],runs['selected-list'],['probe-click'])
    order=proof.check_order(runs['actual'],proof.full_chain((web/'playwright.config.ts').read_text()))
    check={'status':'PASS'};round_gate.judge(check,round_gate.playwright_counts(w/'only-actual.json'))
    result={'listing':listing,'order':order,'judgement':check,
     'selected_listing':runs['selected-list']['stats'],'actual':runs['actual']['stats'],
     'note':'only sentinel executes, webServer disabled for this offline proof; no page/browser fixture'}
    (w/'only-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
finally:p.write_bytes(old);c.unlink(missing_ok=True)

from pathlib import Path
import subprocess,json,os,hashlib
w=Path('/tmp/codex-r279/a/lcnc-webui');out={}
def run(args,name,env=None):
 p=subprocess.run(args,cwd=w,text=True,capture_output=True,env=env)
 Path('/tmp/codex-r279/'+name+'.txt').write_text(p.stdout+'\n'+p.stderr);return p.returncode
s=w/'src/useGamepad.ts';original=s.read_bytes()
try:
 old='if (perms.resume) deps.fire({ cmd: "cycle_resume" }, ACTION_GATES.resume);'
 assert original.decode().count(old)==1
 s.write_text(original.decode().replace(old,'if (perms.resume && perms.run) deps.fire({ cmd: "cycle_resume" }, ACTION_GATES.resume);'))
 out['gamepad_exit']=run(['node','node_modules/vitest/vitest.mjs','run','src/useGamepad.test.ts','src/actionAdmission.test.ts','--maxWorkers=1','--allowOnly=false','--retry=0'],'a-mut-gamepad')
finally:
 s.write_bytes(original);out['gamepad_restored']=s.read_bytes()==original
s=w/'src/App.vue';original=s.read_bytes()
try:
 changes=[('value: !optionalStopOn.value','value: true'),('value: !blockDeleteOn.value','value: false'),('function spindleReverse(speed: number) {\n  fire({ cmd: "spindle_reverse", speed }','function spindleReverse(_speed: number) {\n  fire({ cmd: "spindle_reverse", speed: 1000 }')]
 text=original.decode()
 for a,b in changes:
  assert text.count(a)==1,a
  text=text.replace(a,b)
 s.write_text(text)
 out['build_exit']=run(['npm','run','build'],'a-mut-build');assert out['build_exit']==0
 env={**os.environ,'LCNC_E2E_RUN':'codex-r279-a-mut','LCNC_E2E_EVENTS':'/tmp/codex-r279/a-mut-events.jsonl','R279_REPORT':'/tmp/codex-r279/a-mut-browser.json'}
 out['browser_exit']=run(['node','node_modules/@playwright/test/cli.js','test','-c','playwright.r279.config.ts','strip-actions.spec.ts:85','strip-actions.spec.ts:119'],'a-mut-browser',env)
 out['browser_stats']=json.loads(Path('/tmp/codex-r279/a-mut-browser.json').read_text())['stats']
finally:
 s.write_bytes(original);out['app_restored']=s.read_bytes()==original
 Path('/tmp/codex-r279/a-mutations.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out,indent=2))

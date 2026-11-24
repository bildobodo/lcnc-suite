import json, os, socket, subprocess
from pathlib import Path
root=Path('/tmp/r463'); web=root/'tree/lcnc-webui'
env=dict(os.environ, CI='1', LCNC_E2E_WORKERS='1', LCNC_E2E_RUN='codex-r463',
         LCNC_E2E_EVENTS=str(root/'events.jsonl'), LCNC_E2E_REPLAY_DIR=str(root/'replay'))
env['PATH']=str(web/'node_modules/.bin')+os.pathsep+env.get('PATH','')
(root/'replay').mkdir(exist_ok=True)
results=[]
def run(name,args,cwd,timeout=240):
    with (root/(name+'.txt')).open('w') as f:
        p=subprocess.run(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=timeout)
    results.append({'step':name,'exit':p.returncode})
    (root/'results.json').write_text(json.dumps(results,indent=2))
    print(results[-1],flush=True)
    return p.returncode
run('native',['python3','/tmp/r463/native.py'],root,30)
run('unit',['node','node_modules/vitest/vitest.mjs','run','src/viewer/programToolHeader.test.ts',
            'src/viewer/checkContext.test.ts','src/viewer/r463.codex.test.ts','--maxWorkers=1'],web)
if (web/'dist/index.html').is_file():  # already built successfully; no product edits since
    sockets=[]
    try:
        for port in [4173,4500]:
            s=socket.socket(); sockets.append(s); s.bind(('127.0.0.1',port))
    finally:
        for s in sockets: s.close()
    run('browser',['node','node_modules/@playwright/test/cli.js','test','-c','playwright.gate.config.ts',
                   'program-header.viewer.spec.ts','--workers=1','--reporter=list'],web,240)

import pathlib, subprocess, socket
r=pathlib.Path('/tmp/r460')
web=r/'tree/lcnc-webui'
for port in (4280,4500):
    with socket.socket() as s:
        s.bind(('127.0.0.1',port))
def run(args,name):
    with (r/name).open('w') as f:
        p=subprocess.run(args,cwd=web,stdout=f,stderr=subprocess.STDOUT)
    print(name,'rc',p.returncode,flush=True)
    return p.returncode
assert run(['node','node_modules/vite/bin/vite.js','build'],'build.txt')==0
raise SystemExit(run(['node','node_modules/@playwright/test/cli.js','test',
 '--config=playwright.codex-r460.config.ts','e2e/codex-r458-unmodified.viewer.spec.ts',
 'e2e/codex-r460.viewer.spec.ts','e2e/scrub-start.viewer.spec.ts'],'browser.txt'))

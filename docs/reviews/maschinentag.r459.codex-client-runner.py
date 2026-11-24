import pathlib, socket, subprocess, sys
r=pathlib.Path('/tmp/r459')
web=r/'tree/lcnc-webui'
for port in (4279,4500):
    with socket.socket() as s:
        s.bind(('127.0.0.1',port))
def run(args, name):
    with (r/name).open('w') as f:
        p=subprocess.run(args,cwd=web,stdout=f,stderr=subprocess.STDOUT)
    print(name,'rc',p.returncode,flush=True)
    assert p.returncode==0, name
run(['node','node_modules/vitest/vitest.mjs','run','src/viewer/codex-r459.test.ts',
     'src/viewer/startDepPayloads.test.ts','--allowOnly=false','--retry=0'], 'client-tests.txt')
run(['node','node_modules/vite/bin/vite.js','build'], 'build.txt')
run(['node','node_modules/@playwright/test/cli.js','test',
     '--config=playwright.codex-r459.config.ts','e2e/start-believed.viewer.spec.ts'], 'browser.txt')

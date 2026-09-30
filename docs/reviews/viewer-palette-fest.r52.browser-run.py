import os, subprocess, time, urllib.request
from pathlib import Path
root = Path(__file__).resolve().parent.parent
web = root / 'lcnc-webui'
env = dict(os.environ, MOCK_HOST='127.0.0.1', MOCK_PORT='4188')
with open(root/'evidence/viewer-palette-fest.r52.mock.txt','w') as log:
    server = subprocess.Popen(['nice','-n','19','node','e2e/mock-gateway.mjs'], cwd=web, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError('mock exited')
            try:
                urllib.request.urlopen('http://127.0.0.1:4188/',timeout=1).close()
                break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('mock unavailable')
        with open(root/'evidence/viewer-palette-fest.r52.browser-tests.txt','w') as out:
            result = subprocess.run(['nice','-n','19','node','node_modules/@playwright/test/cli.js','test','--config','playwright.r52.config.ts'],cwd=web,stdout=out,stderr=subprocess.STDOUT)
        print('browser exit',result.returncode,'mock before cleanup',server.poll(),flush=True)
        raise SystemExit(result.returncode)
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill(); server.wait()

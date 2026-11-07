#!/usr/bin/env python3
"""R330 browser counterexample; run ONLY in an own archive with built web UI.
Usage: python3 this.py /tmp/own-archive --out /tmp/own-result --port 4591
Creates/removes one private mock beside e2e/mock-gateway.mjs; no live service.
The product's browser helper/evaluator are used without edits.
"""
from pathlib import Path
import argparse, os, subprocess, json, sys

ap=argparse.ArgumentParser(description=__doc__)
ap.add_argument('root', type=Path)
ap.add_argument('--out', type=Path, required=True)
ap.add_argument('--port', type=int, default=4591)
a=ap.parse_args(); root=a.root.resolve(); out=a.out.resolve(); out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root/'scripts'))
from test_support.install_cases import eval_browser

src=root/'lcnc-webui/e2e/mock-gateway.mjs'
mock=src.with_name('r330-init-only.mjs')
assert not mock.exists(), f'own mock already exists: {mock}'
s=src.read_text()
def change(old,new):
    global s
    assert s.count(old)==1, old
    s=s.replace(old,new,1)
change('import { existsSync } from "node:fs";', 'import { existsSync, writeFileSync } from "node:fs";')
change('let quiet = false;', 'let quiet = true;')
change('const connectFrames = () => [withEnvelope(state), activeViewerInit];',
       'const connectFrames = () => [activeViewerInit];')
change('  if (path === "/macros") {', '''  if (path === "/settings") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, settings: {} }));
    return;
  }
  if (path === "/macros") {''')
change('wss.on("connection", (ws) => {', '''const sentFrames = [];
wss.on("connection", (ws) => {
  const originalSend = ws.send.bind(ws);
  ws.send = (...args) => {
    try { sentFrames.push(JSON.parse(String(args[0])).type); } catch {}
    writeFileSync(process.env.R330_WIRE, JSON.stringify(sentFrames));
    return originalSend(...args);
  };''')
mock.write_text(s)
p=None
try:
    env={**os.environ,'MOCK_PORT':str(a.port),'MOCK_INSTANCE':'codex-r330-init-only',
         'R330_WIRE':str(out/'wire.json')}
    p=subprocess.Popen(['node',str(mock)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    while True:
        line=p.stdout.readline()
        if 'MOCK-BOUND' in line:break
        if not line: raise RuntimeError(p.stderr.read())
    result=subprocess.run(['node',str(root/'scripts/install_probe_browser.mjs'),
       '--webui',str(root/'lcnc-webui'),'--url',f'http://127.0.0.1:{a.port}/',
       '--out',str(out/'browser.json'),'--step-ms','5000'],capture_output=True,text=True,timeout=30)
    data=json.loads((out/'browser.json').read_text())
    frames=json.loads((out/'wire.json').read_text())
    print(json.dumps({'browser_returncode':result.returncode,'sent_frames':frames,
      'status_frames':sum(t in ('status','status_delta') for t in frames),
      'evaluation':eval_browser(data),'browser':data},indent=2))
finally:
    if p is not None:
        p.terminate();p.wait(timeout=10)
    mock.unlink()

"""R453: read-only source audit, not a browser or controller test.

Run from any directory. Only the two named evidence files are written.
No product module is imported and no server or controller is contacted.
"""
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path('/home/cnc/lcnc-suite')
BASE = '54955611'
OUT = ROOT / 'docs/reviews'
PREFIX = 'maschinentag.r453.codex-'
FILES = {
    'lcnc-webui/src/App.vue': [(335, 335), (1745, 1775), (1793, 1819), (2279, 2317), (3167, 3209), (3231, 3234)],
    'lcnc-webui/src/permissions.ts': [(184, 240)],
    'lcnc-webui/src/machineControls.ts': [(76, 94), (268, 274)],
    'lcnc-webui/src/modalRegistry.ts': [(36, 50), (123, 131), (169, 200)],
    'lcnc-webui/src/DialogFrame.vue': [(160, 185)],
    'lcnc-webui/src/JogStrip.vue': [(133, 144), (378, 387), (413, 431), (530, 563)],
    'lcnc-webui/src/SetupStrip.vue': [(234, 241)],
    'lcnc-webui/src/SetupActions.vue': [(48, 59)],
    'lcnc-webui/src/lcncWs.ts': [(436, 442)],
    'lcnc-webui/src/ws/wsTransport.ts': [(195, 207)],
    'lcnc-webui/src/wsWorker.ts': [(381, 400)],
    'lcnc-gateway/command_policy.py': [(670, 680)],
    'lcnc-gateway/gateway.py': [(7064, 7071), (12381, 12418), (13584, 13632)],
    'subroutines/probe_basic/on_abort.ngc': [(1, 20)],
    'examples/sim_config/twp/remap_subs/on_abort_twp.ngc': [(1, 60)],
}
UPSTREAM = Path('/home/cnc/claude-work/bg/upstream-2.9.4')
UPSTREAM_RANGES = {
    'emctaskmain.cc': [(2108, 2121)],
    'emctask.cc': [(225, 263), (743, 750)],
    'motion-command.c': [(494, 533)],
    'control.c': [(1059, 1100), (1153, 1163)],
}


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def sha(data):
    return hashlib.sha256(data).hexdigest()


manifest = {
    'review': 'R453', 'kind': 'source audit only',
    'product': git('rev-parse', BASE).decode().strip(),
    'document_head_at_audit': git('rev-parse', 'HEAD').decode().strip(),
    'no_build_test_or_live_connection': True,
    'sources': [],
}
text = ['R453: source audit at product 54955611; no runtime claims.\n']


def record(name, data, ranges, **extra):
    manifest['sources'].append({'path': name, 'sha256': sha(data), 'ranges': ranges, **extra})
    lines = data.decode().splitlines()
    text.append('\nSOURCE ' + name + '\nSHA256 ' + sha(data))
    for lo, hi in ranges:
        text.append(f'--- lines {lo}..{min(hi, len(lines))}')
        text.extend(f'{i}: {lines[i-1]}' for i in range(lo, min(hi, len(lines)) + 1))


for path, ranges in FILES.items():
    record(path, git('show', f'{BASE}:{path}'), ranges, revision=BASE)

origins = json.loads((UPSTREAM / 'sources.json').read_text())
for path, ranges in UPSTREAM_RANGES.items():
    data = (UPSTREAM / path).read_bytes()
    origin = next(s for s in origins['sources'] if s['file'] == path)
    assert sha(data) == origin['sha256'], path
    record(str(UPSTREAM / path), data, ranges, upstream=origins['upstream'], url=origin['url'])

body = ('\n'.join(text) + '\n').encode()
evidence = OUT / (PREFIX + 'source-audit.txt')
evidence.write_bytes(body)
manifest['audit_sha256'] = sha(body)
(OUT / (PREFIX + 'manifest.json')).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
print(f'{len(FILES)} product sources, {len(UPSTREAM_RANGES)} upstream sources; upstream hashes match recorded v2.9.4 origins.')
print('Static evidence written; no runtime tests, builds or live connection.')

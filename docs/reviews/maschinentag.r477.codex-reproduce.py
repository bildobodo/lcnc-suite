"""Reproduce R477's OFFLINE probes in a fresh /tmp archive, under heavy_lock.

Usage: python3 this-file.py [path-to-lcnc-webui/node_modules]
No live gateway, browser, NML or machine command. No checkout or product edit.
The common lock requires write access to ~/claude-work/live-tier/heavy.lock.
"""
from pathlib import Path
import io
import subprocess
import sys
import tarfile
import tempfile

evidence = Path(__file__).resolve().parent
repo = evidence.parent.parent
node_modules = Path(sys.argv[1] if len(sys.argv) > 1 else
                    '/home/cnc/lcnc-suite-p6c/lcnc-webui/node_modules').resolve()
work = Path(tempfile.mkdtemp(prefix='r477-repro-'))
tree = work / 'tree'
tree.mkdir()
data = subprocess.check_output(['git', 'archive', '24f3bd3a',
    'lcnc-webui/src', 'examples/sim_config/xyz3/tool.seed.json',
    'examples/sim_config/xyz3/tool.tbl', 'scripts/test_support/heavy_lock.py'], cwd=repo)
with tarfile.open(fileobj=io.BytesIO(data)) as archive:
    archive.extractall(tree, filter='data')
probe = work / 'probe'
probe.mkdir()
for src in sorted((evidence / 'maschinentag.r477.codex-scratch').glob('*.ts')):
    (probe / src.name).write_text(src.read_text().replace('/home/cnc/lcnc-suite-p6c', str(tree)))
(probe / 'codex.ts').write_text((evidence / 'maschinentag.r477.codex-geometry.ts').read_text()
                               .replace('/tmp/r477/tree', str(tree)))
exe = next(node_modules.glob('@esbuild/*/bin/esbuild'))
subprocess.check_call([str(exe), str(probe / 'codex.ts'), '--bundle', '--platform=node',
    '--format=esm', '--target=es2022', f'--outfile={probe / "codex.mjs"}',
    f'--alias:three={node_modules / "three/build/three.module.js"}',
    f'--alias:three-mesh-bvh={node_modules / "three-mesh-bvh"}',
    f'--alias:vue={node_modules / "vue"}',
    f'--alias:@msgpack/msgpack={node_modules / "@msgpack/msgpack"}',
    '--log-level=warning', '--tsconfig-raw={}'], cwd=work)
print('Archive:', tree, flush=True)
subprocess.check_call(['python3', '-I', str(tree / 'scripts/test_support/heavy_lock.py'),
    '--who', 'codex-r477-reproduction', '--wait', '50', '--', 'node',
    str(probe / 'codex.mjs')], cwd=work)
subprocess.check_call(['python3', str(evidence / 'maschinentag.r477.codex-contracts.py')], cwd=work)

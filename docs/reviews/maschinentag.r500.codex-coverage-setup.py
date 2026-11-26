"""Derive a review-only pool coverage probe from R500's exact test.

The original assertions are kept. Only the dynamic worker import varies;
the test records the real shard progress, transferred value and publisher's
held value. No product/worktree file is changed.
"""
from pathlib import Path

root = Path('/tmp/r500/tree/lcnc-webui')
viewer = root / 'src/viewer'
worker = (viewer / 'collisionWorker.ts').read_text()
test = (viewer / 'stockMutePaths.test.ts').read_text()
old = 'covered: run.progress.slice()'
assert worker.count(old) == 1

for name, value in [('control', 'run.progress.slice()'), ('zero', 'run.progress.map(() => 0)'), ('whole', 'run.progress.map(() => 1)')]:
    mod = f'r500Worker_{name}'
    (viewer / f'{mod}.ts').write_text(worker.replace(old, f'covered: {value}'))
    source = test.replace('await import("./collisionWorker")', f'await import("./{mod}")')
    mark = '    shards[1]!.fail();'
    assert source.count(mark) == 1
    source = source.replace(mark, '    const atFailure = shards.map(s => s.run!.progress);\n' + mark)
    ret = '    return { before, after: events(), result: result as unknown as Msg | null, sent, t, p, id };'
    assert source.count(ret) == 1
    source = source.replace(ret,
        f'    console.log("R500_COVERAGE " + JSON.stringify({{ variant: "{name}", atFailure, handoff: sent.filter(m => m.heldCoverage).map(m => m.heldCoverage), held: p.tablesOf(id)?.held?.covered, before: before.length, after: events().length }}));\n' + ret)
    (viewer / f'r500Coverage_{name}.test.ts').write_text(source)

(root / 'r500.coverage.config.ts').write_text('''import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['src/viewer/r500Coverage_*.test.ts'],
testNamePattern:'the earlier keys stay',maxWorkers:1,testTimeout:120000},
cacheDir:'/tmp/r500/vite-coverage-cache'});
''')

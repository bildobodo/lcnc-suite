"""Derive a review-only pool coverage probe from R501's exact test.

The original assertions are kept. Only the dynamic worker import varies;
the test records the real shard progress, transferred value and publisher's
held value. No product/worktree file is changed.
"""
from pathlib import Path

root = Path('/tmp/r501/tree/lcnc-webui')
viewer = root / 'src/viewer'
worker = (viewer / 'collisionWorker.ts').read_text()
test = (viewer / 'stockMutePaths.test.ts').read_text()
old = 'covered: run.progress.slice()'
assert worker.count(old) == 1

for name, value in [('control', 'run.progress.slice()'), ('zero', 'run.progress.map(() => 0)'), ('whole', 'run.progress.map(() => 1)')]:
    mod = f'r501Worker_{name}'
    (viewer / f'{mod}.ts').write_text(worker.replace(old, f'covered: {value}'))
    source = test.replace('await import("./collisionWorker")', f'await import("./{mod}")')
    mark = '    shards[1]!.fail();'
    assert source.count(mark) == 1
    source = source.replace(mark, '    const atFailure = shards.map(s => s.run!.progress);\n' + mark)
    ret = '    return { before, after: events(), result: result as unknown as Msg | null, sent, t, p, id, reached };'
    assert source.count(ret) == 1
    source = source.replace(ret,
        f'    console.log("R501_COVERAGE " + JSON.stringify({{ variant: "{name}", atFailure, handoff: sent.filter(m => m.heldCoverage).map(m => m.heldCoverage), held: p.tablesOf(id)?.held?.covered, before: before.length, after: events().length }}));\n' + ret)
    (viewer / f'r501Coverage_{name}.test.ts').write_text(source)

(root / 'r501.coverage.config.ts').write_text('''import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['src/viewer/r501Coverage_*.test.ts'],
testNamePattern:'the earlier keys stay',maxWorkers:1,testTimeout:120000},
cacheDir:'/tmp/r501/vite-coverage-cache'});
''')

# This fourth mutation leaves the worker handoff intact and corrupts only
# the publisher's retained copy. It must fail the other new assertion.
publisher = (viewer / 'contactPublisher.ts').read_text()
old = 't.covered = m.heldCoverage.covered.slice();'
assert publisher.count(old) == 1
(viewer / 'r501Publisher_zero.ts').write_text(publisher.replace(old, 't.covered = m.heldCoverage.covered.map(() => 0);'))
control = (viewer / 'r501Coverage_control.test.ts').read_text()
control = control.replace('await import("./contactPublisher")', 'await import("./r501Publisher_zero")')
control = control.replace('variant: "control"', 'variant: "publisher_zero"')
(viewer / 'r501Coverage_publisher_zero.test.ts').write_text(control)

// Run from repository root. Loads the unchanged production status module;
// feeds it snapshots from the actual offline SettingsStore / HTTP handler.
// Expected defects are recorded as unmet criteria, not hidden as passing tests.
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const ts = require('typescript');
const exports = {};
vm.runInNewContext(ts.transpileModule(
  fs.readFileSync('lcnc-webui/src/settingsSaveStatus.ts', 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } },
).outputText, { exports, require });
const data = { mapping: { abort: 'F9' } };
const results = [];
for (const mode of ['success', 'disk-full', 'corrupt', 'missing']) {
  const store = JSON.parse(execFileSync('lcnc-gateway/.venv/bin/python3',
    ['docs/reviews/ui-optimierungen.implementation-review.r7.store-probe.py'],
    { input: JSON.stringify({ mode, data }), encoding: 'utf8' }));
  exports.resetSaveStatusForTests();
  exports.noteSavePending('keyboard');
  exports.noteSaveBeaconed('keyboard', data, true);
  exports.noteSaveConnectionLost();
  exports.noteSaveServerState(store.cacheAfterRequest);
  const actual = exports.saveStatus.state;
  const expected = mode === 'success' ? 'saved' : 'error';
  results.push({ ...store, actual, text: exports.saveStatusText(), expected,
    acceptancePassed: actual === expected });
}
const report = { date: '2026-09-23', productCommit: '691e642', scope:
  'Actual SettingsStore and HTTP handler, temporary files; unchanged frontend ledger; no LinuxCNC', results };
fs.writeFileSync('docs/reviews/ui-optimierungen.implementation-review.r7.ledger-evidence.json',
  JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

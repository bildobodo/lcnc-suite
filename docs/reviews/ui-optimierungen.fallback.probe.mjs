// Run from the repository root:
// node docs/reviews/ui-optimierungen.fallback.probe.mjs
// Executes the unchanged registration callbacks extracted from defaults.ts.
// No browser, gateway, file mutation or machine command.
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const ts = require('typescript');
const source = fs.readFileSync('lcnc-webui/src/defaults.ts', 'utf8');
const definitions = new Map();
const logs = [];
const context = {
  registerSection: (key, fallback, merge) => definitions.set(key, { fallback, merge }),
  console: { warn: (...x) => logs.push(x), error: (...x) => logs.push(x) },
};
for (const [start, end] of [
  ['const MACHINE_FALLBACK:', 'export function loadMachineDefaults'],
  ['const MACROS_FALLBACK:', 'export function loadMacrosDefaults'],
]) {
  const from = source.indexOf(start), to = source.indexOf(end);
  if (from < 0 || to <= from) throw new Error(`Source block missing: ${start}`);
  const js = ts.transpileModule(source.slice(from, to), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(js, context);
}
for (const [key, saved] of [
  ['machine', { toolChangeMode: 'invalid', rflSpindleDir: 'invalid', spindleFeedbackUnit: 'invalid', autoDisarmMin: -1 }],
  ['macros', { macros: [{ id: 'valid', name: 'OK', command: 'G0 X0' }, { id: 'invalid', name: 'broken', command: 123 }] }],
  ['macros', { macros: 'malformed' }],
]) {
  const d = definitions.get(key);
  console.log(JSON.stringify({ section: key, input: saved, loaded: d.merge(saved, d.fallback), warnings: logs.splice(0) }));
}

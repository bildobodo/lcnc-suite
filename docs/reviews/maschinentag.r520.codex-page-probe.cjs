// R520 actual TS + verbatim Vue callback, controlled payload adoption.
// R519 harness adaptation: viewerGcode is now an explicit input.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = process.argv[2], ts = require(path.join(process.argv[3], 'typescript'));
const src = fs.readFileSync(path.join(root, 'lcnc-webui/src/coordBasisView.ts'), 'utf8');
const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(src, { compilerOptions: {
  module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports, mod);
const vue = fs.readFileSync(path.join(root, 'lcnc-webui/src/ScrubBar.vue'), 'utf8');
const body = vue.match(/const sweepShown = computed<SimSweepView \| null>\(\(\) => \{([\s\S]*?)\n\}\);/)[1];
const data = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
function show(raw, shownVersion, programId = 'codex-program.1') {
  const v = new Function('sweepView', 'coordBasis', 'clearWithheld', 'viewerGcode', body)(
    { value: {state: 'done', result: 'Clear', tone: 'ok', short: 'Clear', coverage: 'checked in full', verdict: 'Clear'} },
    { value: mod.exports.parseCoordBasis(raw) }, mod.exports.clearWithheld,
    { value: {publishedVersion: shownVersion, programId} });
  return { shownVersion, programId, proof: raw?.publication_id, result: v.result };
}
const rows = [];
function check(name, raw, version, expected, pid) {
  const row = {name, ...show(raw, version, pid)};
  rows.push(row);
  assert.equal(row.result, expected, name);
}
check('A with its own refused proof', data.old_frame, 101, '');
for (let n = 0; n < 10; n++) check('B proof while still showing A, frame ' + n, data.new_frame, 101, '');
check('B adopted with its matching proof', data.new_frame, 102, 'Clear');
check('C adopted, old confirming B frame arrives', data.new_frame, 103, '');
check('C with its own refused proof', data.last_frame, 103, '');
check('same version but another program', data.new_frame, 102, '', 'another-program.1');
check('absent entry', null, 102, '');
check('no proof identity', {...data.new_frame, publication_id: null}, 102, '');
check('matching proof recovered', data.new_frame, 102, 'Clear');
console.log(JSON.stringify({scope: 'Actual gateway frames, TS parser and extracted Vue callback; no rendered browser claim.', rows}, null, 2));

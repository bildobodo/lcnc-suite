// Pure calls of the actual map / extracted send functions; no Vue or browser run.
// node r380-panel-probe.cjs ARCHIVE TYPESCRIPT_MODULE
const fs = require('fs');
const vm = require('vm');
const ts = require(process.argv[3]);
const root = process.argv[2];
function js(text) {
  return ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
}
function extract(path, name) {
  const text = fs.readFileSync(`${root}/${path}`, 'utf8');
  const script = text.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1];
  const sf = ts.createSourceFile(path+'.ts', script, ts.ScriptTarget.Latest, true);
  const fn = sf.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn) throw Error(name);
  return fn.getText(sf);
}
const ctx = {exports: {}};
vm.createContext(ctx);
vm.runInContext(js(fs.readFileSync(`${root}/lcnc-webui/src/probeVars.ts`, 'utf8')), ctx);
const {PROBE_FALLBACK, probeVarMap} = ctx.exports;
const fixture = probeVarMap(PROBE_FALLBACK, 0);
ctx.can = {value: {ready: true}};
ctx.props = {probing: false};
ctx.activeGridOp = {value: null};
ctx.params = {value: {...PROBE_FALLBACK}};
ctx.autoZero = {value: PROBE_FALLBACK.autoZero};
ctx.saveProbeDefaults = () => {};
ctx.buildVarMap = mode => probeVarMap(ctx.params.value, mode);
let panel;
ctx.emit = (_, p) => {panel = p;};
vm.runInContext(js(extract('lcnc-webui/src/ProbePanel.vue', 'runGridProbe')), ctx);
ctx.runGridProbe({id: 'z', macro: 'probe_z_minus_wco'});
const defaultMode = panel.vars['3030'];
ctx.autoZero.value = true;
ctx.runGridProbe({id: 'z', macro: 'probe_z_minus_wco'});
const enabledMode = panel.vars['3030'];
let job;
ctx.fireJob = (_, p) => {job = p;};
const app = extract('lcnc-webui/src/App.vue', 'onRunProbe');
vm.runInContext(js(app), ctx);
ctx.onRunProbe(panel);
if (JSON.stringify(job.vars) !== JSON.stringify(fixture)) throw Error('control mismatch');
// A changed send site, while probeVars.ts and its fixture guard stay untouched.
const altered = app.replace('routine: macro, vars', "routine: macro, vars: {...vars, '3030': 1}");
if (altered === app) throw Error('mutation not applied');
vm.runInContext(js(altered), ctx);
ctx.onRunProbe(panel);
const currentAssertions = job.cmd === 'probe_run' && /^probe_[a-z_]+$/.test(job.routine)
  && JSON.stringify(Object.keys(job.vars).sort()) === JSON.stringify(Object.keys(fixture).sort())
  && Object.values(job.vars).every(Number.isFinite) && [0,1].includes(job.vars['3030']);
if (!currentAssertions || defaultMode !== 1 || enabledMode !== 0) throw Error('probe changed');
console.log(JSON.stringify({
  actual_grid_default_mode: defaultMode,
  actual_grid_auto_zero_mode: enabledMode,
  actual_app_control_equals_native_fixture: true,
  send_site_mutant_mode: job.vars['3030'],
  existing_value_assertions_accept_mutant: currentAssertions,
  standalone_map_fixture_guard_unchanged: JSON.stringify(probeVarMap(PROBE_FALLBACK,0)) === JSON.stringify(fixture),
  full_wire_fixture_comparison_accepts_mutant: JSON.stringify(job.vars) === JSON.stringify(fixture),
  limitation: 'Source-function calls and a modeled existing assertion set; no browser test run.'
}, null, 2));

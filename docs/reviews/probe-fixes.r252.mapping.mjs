// R252: compare moved mapping against the pre-change function, including
// non-default values so swapped fields cannot pass on equal zero defaults.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
const old = fs.readFileSync('../../legacy-ProbePanel.vue', 'utf8');
const body = old.match(/function buildVarMap\(probeMode: number\): Record<string, number> \{([\s\S]*?)\n\}/)[1];
const originalDefaults = old.match(/const params = ref\(\{([\s\S]*?)\n\}\);/)[1];
const js = ts.transpileModule(fs.readFileSync('src/probeVars.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const exported = {}; new Function('exports',js)(exported);
const {PROBE_FALLBACK,probeVarMap} = exported;
const original = new Function('params','probeMode',body);
const legacyDefaults = new Function(`return {${originalDefaults}}`)();
const {autoZero,...defaults} = PROBE_FALLBACK;
assert.equal(autoZero,false); assert.deepEqual(defaults,legacyDefaults);
const distinct = Object.fromEntries(Object.keys(defaults).map((key,i)=>[key,i*7+0.25]));
for (const p of [defaults,distinct]) for (const mode of [0,1,2]) {
  assert.deepEqual(probeVarMap(p,mode), original({value:p},mode));
}
for (const dir of ['xyz3','xyzac5','xyzabc6']) {
  const vals=Object.fromEntries(fs.readFileSync(`../examples/sim_config/${dir}/sim.var`,'utf8').trim().split('\n').map(l=>l.trim().split(/\s+/)).map(([k,v])=>[k,Number(v)]));
  for (const [key,value] of Object.entries(probeVarMap(defaults,1))) assert.equal(vals[key],value,`${dir} #${key}`);
}
console.log(JSON.stringify({defaultMove:'identical',mappingComparisons:6,templateValuesChecked:96,result:'PASS'},null,2));

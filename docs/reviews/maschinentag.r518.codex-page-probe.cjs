// R518: actual TS module and verbatim sweepShown callback; no browser/native claim.
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ts = require(path.join(process.argv[3], 'typescript'));
const code = fs.readFileSync(path.join(root,'lcnc-webui/src/coordBasisView.ts'),'utf8');
const out = ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const mod={exports:{}};
new Function('exports','module',out)(mod.exports,mod);
const cb=mod.exports;
const source=fs.readFileSync(path.join(root,'lcnc-webui/src/ScrubBar.vue'),'utf8');
const body=source.match(/const sweepShown = computed<SimSweepView \| null>\(\(\) => \{([\s\S]*?)\n\}\);/)[1];
const shown=(raw)=>new Function('sweepView','coordBasis','clearWithheld',body)(
 {value:{state:'done',result:'Clear',tone:'ok',short:'Clear',coverage:'checked in full',verdict:'Clear'}},
 {value:cb.parseCoordBasis(raw)}, cb.clearWithheld);
const cases=[
 ['confirmed control',{state:'confirmed',publication:null}],
 ['unconfirmed control',{state:'unconfirmed',publication:'Coordinate basis not confirmed'}],
 ['absent (gateway status failure)',null],
 ['malformed entry',{state:'unreadable'}],
 ['known inconsistent, missing publication',{state:'inconsistent',findings:{origin:'G54 X: interpreter 5 · status 0'}}],
 ['known unconfirmed, publication not supplied',{state:'unconfirmed'}],
];
const rows=cases.map(([name,raw])=>({name,raw,parsed:cb.parseCoordBasis(raw),shown:shown(raw)}));
console.log(JSON.stringify({scope:'Actual module and extracted callback; no browser/rendering',rows},null,2));
if(rows.slice(2).some(r=>r.shown.result==='Clear')) process.exitCode=1;

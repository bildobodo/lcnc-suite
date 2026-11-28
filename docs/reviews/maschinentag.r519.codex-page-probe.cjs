// R519 actual TS module + verbatim sweepShown callback, controlled arrival order.
const fs=require('fs'), path=require('path');
const root=process.argv[2], ts=require(path.join(process.argv[3],'typescript'));
const src=fs.readFileSync(path.join(root,'lcnc-webui/src/coordBasisView.ts'),'utf8');
const mod={exports:{}};
new Function('exports','module',ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(mod.exports,mod);
const vue=fs.readFileSync(path.join(root,'lcnc-webui/src/ScrubBar.vue'),'utf8');
const body=vue.match(/const sweepShown = computed<SimSweepView \| null>\(\(\) => \{([\s\S]*?)\n\}\);/)[1];
const data=JSON.parse(fs.readFileSync(process.argv[4],'utf8'));
function show(raw,shownVersion){
 const v=new Function('sweepView','coordBasis','clearWithheld',body)(
  {value:{state:'done',result:'Clear',tone:'ok',short:'Clear',coverage:'checked in full',verdict:'Clear'}},
  {value:mod.exports.parseCoordBasis(raw)},mod.exports.clearWithheld);
 return {shownVersion,framePublication:raw.publication,result:v.result};
}
const rows=[
 {name:'old A result with its refused proof (control)',...show(data.old_frame,101)},
 {name:'still A, newer B proof received before B payload adoption',...show(data.new_frame,101)},
 {name:'B adopted, its matching proof (control)',...show(data.new_frame,102)},
 {name:'B result, old A refusal arrives (opposite-order control)',...show(data.old_frame,102)},
];
console.log(JSON.stringify({scope:'Actual gateway frames and page callback; controlled sequence, no browser/rendered claim.',rows},null,2));
if(rows[1].result==='Clear') process.exitCode=1;

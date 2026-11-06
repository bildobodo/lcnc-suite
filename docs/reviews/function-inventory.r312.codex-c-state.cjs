// R312: project native evaluator inputs through the real UI's pure modules.
// node c-state.cjs ARCHIVE NODE_MODULES C_JSON OUT_JSON
const fs=require('fs'),path=require('path');
const ts=require(path.resolve(process.argv[3],'typescript'));
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {toolsetterSetup}=require(path.resolve(process.argv[2],'lcnc-webui/src/toolsetterSetup.ts'));
const {toolsetterMachineState}=require(path.resolve(process.argv[2],'lcnc-webui/src/toolsetterState.ts'));
const probe=JSON.parse(fs.readFileSync(process.argv[4],'utf8')),out={};
const setup=toolsetterSetup(probe.section);
for(const [key,p] of Object.entries(probe.booking_countercases)){
 out[key]={native:p.actual.status,before:toolsetterMachineState(setup,p.before),after:toolsetterMachineState(setup,p.after)};
}
if(out.after_wrong_six_decimals.after.kind!=='pending')throw Error(JSON.stringify(out));
if(out.before_empty.before.kind!=='unconfirmed'||out.before_assumed.before.kind!=='unconfirmed')throw Error(JSON.stringify(out));
out.recorded={before:toolsetterMachineState(setup,probe.saved_run.booking.before),after:toolsetterMachineState(setup,probe.saved_run.booking.after)};
if(out.recorded.before.kind!=='pending'||out.recorded.after.kind!=='confirmed')throw Error(JSON.stringify(out));
fs.writeFileSync(process.argv[5],JSON.stringify(out,null,2)+'\n');

// R312: load real pure TS modules using TypeScript's CJS transform; no browser.
// Usage: node probe_state.cjs ARCHIVE_A NODE_MODULES A_JSON
const fs=require('fs'),path=require('path');
const ts=require(path.resolve(process.argv[3],'typescript'));
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {toolsetterSetup}=require(path.resolve(process.argv[2],'lcnc-webui/src/toolsetterSetup.ts'));
const {toolsetterMachineState,toolsetterMachineText}=require(path.resolve(process.argv[2],'lcnc-webui/src/toolsetterState.ts'));
const probe=JSON.parse(fs.readFileSync(process.argv[4],'utf8')).rounding;
const state=toolsetterMachineState(toolsetterSetup(probe.section),probe.booking);
if(state.kind!=='confirmed')throw Error(JSON.stringify(state));
console.log(JSON.stringify({input:probe.section.touchZ,gatewaySent:probe.sent_3102,clientRounded:Number(probe.section.touchZ.toFixed(6)),state,text:toolsetterMachineText(state),expected:'confirmed'},null,2));

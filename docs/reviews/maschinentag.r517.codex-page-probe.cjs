// Run actual TS modules and one verbatim function from the reviewed Vue file.
// No browser, servers or machine connection. Vue and TypeScript loaded read-only.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const tree=path.resolve(process.argv[2] || '/tmp/codex-r517-review');
const deps=path.resolve(process.argv[3] || '/home/cnc/lcnc-suite-start/lcnc-webui/node_modules');
const ts=require(deps+'/typescript'), vue=require(deps+'/vue');
const src=path.join(tree,'lcnc-webui/src');
const cache=new Map();
function load(file){
 const abs=path.resolve(src,file); if(cache.has(abs))return cache.get(abs).exports;
 const m={exports:{}}; cache.set(abs,m);
 const js=ts.transpileModule(fs.readFileSync(abs,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=n=>n==='vue'?vue:n.startsWith('.')?load(path.resolve(path.dirname(abs),n+'.ts')):require(deps+'/'+n);
 new Function('require','module','exports',js)(req,m,m.exports);return m.exports;
}
const {createStartAttempts}=load('startAttempt.ts');
function harness(action='start'){
 let program='E.1',n=0;const sent=[],pending={};
 const s=createStartAttempts({send:x=>{sent.push(x);return String(++n)},awaitReply:id=>new Promise(r=>pending[id]=r),connKey:()=> 'k1',activeProgramId:()=>program,claim:()=>({calc:'running',version:10})});
 s.request(action,action==='rfl'?{cmd:'auto_run',version:10,line:7,program_id:'E.1'}:{cmd:'cycle_start'});
 return {s,sent,reply:async r=>{pending[1](r);await Promise.resolve();await Promise.resolve()},change:()=>{program='E.2';s.supersede('program changed')}};
}
const ask=action=>({ok:false,ask:{ask_id:8,attempt:1,program_id:'E.1',version:10,verified:true,why:null,reason:action==='rfl'?'run_from_line':'check_running',action,start_line:action==='rfl'?7:0,offers:['continue','unchecked'],at:'entry'}});
(async()=>{
 const out={source:'87bf2435',scope:'actual TS modules; extracted Vue function with controlled inputs (no browser)'};
 for(const action of ['start','rfl']){
  const h=harness(action);h.change();await h.reply(ask(action));out['program_changed_before_'+action+'_ask']={state:h.s.current.value.state,sent:h.sent};
 }
 const staleRun=harness('rfl');staleRun.s.supersede('a run began');await staleRun.reply(ask('rfl'));out.foreign_run_before_rfl_ask={state:staleRun.s.current.value.state,sends:staleRun.sent.length};
 const control=harness('rfl');await control.reply(ask('rfl'));out.rfl_control={state:control.s.current.value.state,sends:control.sent.length};
 const {basisFromRun}=load('viewer/checkBasis.ts');
 const file=fs.readFileSync(src+'/ThreeViewer.vue','utf8');
 const script=file.slice(file.indexOf('>',file.indexOf('<script'))+1,file.indexOf('</script>'));
 const ast=ts.createSourceFile('v.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='_colReuseFinishedMain').getText(ast);
 const track={depEnd:0},idle={kind:'idle',runId:null},rb={state:'sent',runId:3,start:{joints:[0,0,0],toolNumber:0}};
 const r=v=>({value:v});const context={basis:idle,marker:'old idle card'};
 const sandbox={viewerGcode:r({scrubTrack:track,publishedVersion:10}),runBasis:r(rb),collisionResult:r({pairCount:1}),collisionBusy:r(false),collisionResumable:r(false),collisionRun:r(null),collisionTrack:r(track),_colBasis:idle,_colResultReq:1,_colReqJob:new Map([[1,{key:'same',side:false,range:null}]]),basisFromRun,_colKeyFor:()=> 'same',_colRunGen:0,runBeginOf:()=> 'known',_colDropEntry:()=>{},_colReqRunGen:null,emitTelemetry:()=>{},_colRunLog:[],collisionContext:r(context),_colPendingCtx:null};
 vm.createContext(sandbox);vm.runInContext(ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
 out.reuse_context={reused:sandbox._colReuseFinishedMain(),runBasis:sandbox._colBasis.kind,runId:sandbox.collisionRun.value?.runId,shownCardBasis:sandbox.collisionContext.value.basis.kind,shownCardRunId:sandbox.collisionContext.value.basis.runId};
 out.expected={program_changed_before_start_ask:'superseded; no dialog',program_changed_before_rfl_ask:'superseded; one send only',foreign_run_before_rfl_ask:'no automatic consent after a foreign run',reuse_context:'card names this run or explicitly splits reused main and run beginning'};
 out.failed_guards=[];
 if(out.program_changed_before_start_ask.state!=='superseded') out.failed_guards.push('late start ask after program change');
 if(out.program_changed_before_rfl_ask.sent.length!==1) out.failed_guards.push('late RFL ask sends a consent after program change');
 if(out.foreign_run_before_rfl_ask.sends!==1) out.failed_guards.push('late RFL ask sends a consent after foreign run');
 if(out.reuse_context.shownCardBasis!=='run' || out.reuse_context.shownCardRunId!==3) out.failed_guards.push('reused main keeps the idle card');
 if(out.rfl_control.sends!==2) throw new Error('the positive RFL control failed');
 console.log(JSON.stringify(out,null,2));
 if(out.failed_guards.length) process.exitCode=1;
})();

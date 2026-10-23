// R193: exercise current source contracts, not an implementation of planned E2.
// Usage: node this.cjs REPO WEBUI_WITH_DEPENDENCIES [revision]
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const [repo, deps, revision = 'a8486ee9'] = process.argv.slice(2);
const ts = createRequire(path.join(deps, 'package.json'))('typescript');
const read = p => fs.readFileSync(path.join(repo,p), 'utf8');
const js = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS}}).outputText;
const script = read('lcnc-webui/src/ThreeViewer.vue').split('<script setup lang="ts">')[1].split('</script>')[0];
const source = ts.createSourceFile('ThreeViewer.ts',script,ts.ScriptTarget.Latest,true);
const fun = name => { const n = source.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name); assert.ok(n,name); return n.getText(source); };
const decl = name => { for(const s of source.statements) if(ts.isVariableStatement(s)) for(const d of s.declarationList.declarations) if(d.name.getText(source)===name) return 'const '+d.getText(source)+';'; throw Error(name); };
let reply;
function visit(n) { if(ts.isBinaryExpression(n) && n.left.getText(source)==='_pfWorker.onmessage') reply=n.getText(source); ts.forEachChild(n,visit); }
visit(source); assert.ok(reply);
const missing = new Proxy({}, {get:(_o,k)=>()=>{throw Error('unexpected geometry import '+String(k));}});
const wcs={exports:{},require:()=>missing};
vm.runInNewContext(js(read('lcnc-webui/src/viewer/wcsEpochs.ts')),wcs);
const zero=[0,0,0,0,0,0];
const epoch=(z,extra={})=>({seq:0,idx:1,rotationDeg:0,rewritten:false,g5x:[0,0,z,0,0,0],g92:zero,...extra});
const payload=(v,z)=>({file:'/nc_files/example.ngc',publishedVersion:v,wcsEvents:[epoch(z)]});
const posts=[], applications=[], timers=[];
const worker={postMessage:m=>posts.push(m)};
const ctx={exports:{},console,Float32Array,
  computed:f=>({get value(){return f();}}),
  viewerGcode:{value:payload(10,10)},vst:{value:null},previewRefresh:{value:null},
  previewTloStale:{value:false},previewTableStale:{value:false},viewerInit:{value:{}},
  previewWcsStaleFor:wcs.exports.previewWcsStaleFor,
  _pfWorker:worker,_pfReqId:0,_pfPayloadId:17,_pfPending:false,_pfAppliedMode:'part',_pfAnchorFor:null,_pfWcsTimer:undefined,
  _pv:{wcsTable:[]},_partFrameEligible:()=>true,_pfGetWorker:()=>worker,
  _pfEnsureLoaded:()=>{},_pfMachine:()=>({}),_roomEnd:()=>0,
  _pfWcs:()=>({g5x:ctx.vst.value.g5x_offset,g92:zero,rotationDeg:0}),
  // Only axis-aligned Z is used. Geometry math is outside this contract probe.
  anchorTerms:w=>({ox:0,oy:0,oz:w.g5x[2],thetaDeg:0}),
  timeSpan:(_n,f)=>f(),requestRender:()=>{},toolpathCtx:()=>({}),
  toolpath:{apply:(_c,g,a)=>applications.push({version:g.publishedVersion,anchorZ:a.oz})},
  _applyProgrammed:()=>{throw Error('unexpected fallback');},_reachSchedule:()=>{},
  setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout:()=>{},
};
vm.createContext(ctx);
vm.runInContext(js([decl('previewWcsStale'),decl('pathStaleNow'),fun('applyGcode'),reply+';',fun('_pfScheduleWcsRefresh')].join('\n')),ctx);
function live(z){ctx.vst.value={g5x_index:1,g5x_offset:[0,0,z,0,0,0],g92_offset:zero,rotation_xy:0,wcs_table:[{name:'G54',x:0,y:0,z,a:0,b:0,c:0,r:0}]};}
function answer(){worker.onmessage({data:{id:posts.at(-1).id,feedPos:new Float32Array([0,0,0])}});}
function state(){return {payloadVersion:ctx.viewerGcode.value.publishedVersion,payloadZ:ctx.viewerGcode.value.wcsEvents[0].g5x[2],liveZ:ctx.vst.value.g5x_offset[2],drawn:applications.at(-1),pending:ctx._pfPending,previewWcsStale:vm.runInContext('previewWcsStale.value',ctx),pathStaleNow:vm.runInContext('pathStaleNow.value',ctx)};}
const results=[];
// First offset A -> B bakes. E2 will hold the later B -> A refresh.
live(20); ctx.applyGcode(ctx.viewerGcode.value); answer();
assert.equal(applications.at(-1).anchorZ,20);
live(10);ctx.previewRefresh.value={file:'example.ngc',job:41};
assert.equal(state().pathStaleNow,true);
ctx.previewRefresh.value=null; // the gap or completed parse before adoption
const returned=state();assert.equal(returned.previewWcsStale,false);assert.equal(returned.pathStaleNow,false);assert.notEqual(returned.drawn.anchorZ,returned.liveZ);
results.push({name:'A -> B baked -> A held; no refresh word',pass:true,state:returned,fixture:'Only the skipped apply is the proposed hold; the stale expressions and reply/apply wiring are unmodified source.'});
// Adopt a new matching payload; its asynchronous transform has not replied.
ctx.viewerGcode.value=payload(11,30);live(30);
ctx.applyGcode(ctx.viewerGcode.value);
const adopted=state();assert.equal(adopted.pending,true);assert.equal(adopted.pathStaleNow,false);assert.equal(adopted.drawn.version,10);assert.equal(adopted.drawn.anchorZ,20);
results.push({name:'matching payload adopted while its transform is pending',pass:true,state:adopted});
answer();const applied=state();assert.equal(applied.pending,false);assert.equal(applied.drawn.version,11);assert.equal(applied.drawn.anchorZ,30);
results.push({name:'only the matching reply actually applies the new geometry',pass:true,state:applied});
// Clarify the existing programmed-path exception: not all single epochs skip.
ctx._pfAppliedMode='programmed';
for(const [name,e,expected] of [['single active non-rewritten',epoch(30),0],['single rewritten',epoch(30,{rewritten:true}),1],['single other fixture',epoch(30,{idx:2}),1]]){
  ctx.viewerGcode.value={...payload(12,30),wcsEvents:[e]};const before=timers.length;ctx._pfScheduleWcsRefresh();
  assert.equal(timers.length-before,expected);
  results.push({name,pass:true,timersScheduled:timers.length-before});
}
console.log(JSON.stringify({revision,kind:'actual current helpers and extracted Vue callbacks; planned hold is only the named skipped refresh; no renderer or network',results},null,2));

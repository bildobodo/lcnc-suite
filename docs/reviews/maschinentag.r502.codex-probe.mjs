// Review R502: real pure functions at dbd14cab; no gateway/browser/PLC.
// Plan predicates below are a literal executable model of section 4.2,
// not an implementation test of the proposed (unbuilt) start flow.
import fs from 'node:fs';
import path from 'node:path';
import ts from '/home/cnc/lcnc-suite-start/lcnc-webui/node_modules/typescript/lib/typescript.js';
const root = '/tmp/r502/tree/lcnc-webui/src/viewer';
function moduleUrl(file, replacements={}) {
  let src = fs.readFileSync(path.join(root,file),'utf8');
  for (const [a,b] of Object.entries(replacements)) src=src.replace(a,b);
  const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const {basisFromLive,basisFromRun,sameCheckInputs}=await import(moduleUrl('checkBasis.ts'));
const lineIndex=moduleUrl('lineIndex.ts');
const {bindBeginning}=await import(moduleUrl('startDep.ts',{'"./lineIndex"':JSON.stringify(lineIndex)}));
const pv={g5x:[0,0,0],g92:[0,0,0],rotationXy:0,toolOffset:[0,0,0],wcsTable:[],toolNum:1,toolDiam:6,toolLen:20,eoffsetZ:0,eoffsetEnabled:false};
const idle=basisFromLive(pv,null);
function run(joints){return basisFromRun({runId:1,state:'sent',start:{g5xOffset:pv.g5x,g92Offset:pv.g92,rotationXy:0,toolOffset:pv.toolOffset,wcsTable:[],toolNumber:1,toolDiameter:6,toolLength:20,eoffsetZ:0,eoffsetEnabled:false,joints}},null)}
const a=run([0,0,0]), b=run([0,100,0]);
const ignoreJoints=(x,y)=>sameCheckInputs({...x,startJoints:null},{...y,startJoints:null});
const base={count:4,pos:new Float32Array([0,0,0,10,0,0,10,10,0,10,10,10]),abc:new Float32Array(12),lines:new Uint32Array([1,2,3,4]),cum:new Float32Array([0,0,0,0]),brk:new Uint8Array([1,1,1,1]),dep:new Uint8Array([7,6,4,0]),depEnd:3,depBrk:new Uint8Array([1,0,0,0]),depDur:new Float32Array(4),depBasis:new Uint8Array([0,1,1,1]),startBelieved:[0,0,0],timeBased:false};
const boundA=bindBeginning(base,a.startJoints),boundB=bindBeginning(base,b.startJoints);
if(JSON.stringify([...boundA.pos])===JSON.stringify([...boundB.pos])) throw Error('control: beginnings should differ');
const pid='load-1';
function matches(ack,v){return !!ack&&ack.program_id===pid&&(ack.verified===false||v.verified)}
function asks(check,v,line=0){return !v.verified||check.state==='unfinished'||(check.state==='finished'&&check.version!==v.version)||line>0}
function entryAllows(check,v,ack=null){return !asks(check,v)||matches(ack,v)}
function recordAllows(v,ack=null){return v.verified||matches(ack,v)}
const finished={state:'finished',version:10};
const v10={verified:true,version:10},v11={verified:true,version:11},notVerified={verified:false,version:11};
const ack={program_id:pid,version:10,verified:true};
const output={
  kind:'Plan counterexamples plus execution of unchanged pure functions',
  base:'dbd14cab',
  recordRace:{page:finished,entry:v10,record:v11,entryAllows:entryAllows(finished,v10),recordAllows:recordAllows(v11),sameEntryRuleAtRecordWouldAsk:asks(finished,v11)},
  acceptanceVersion:{ack,current:v11,matches:matches(ack,v11)},
  positiveControls:{sameVersionStarts:entryAllows(finished,v10)&&recordAllows(v10),changedVersionAsksAtEntry:!entryAllows(finished,v11),verifiedAcceptanceDoesNotCoverUnverified:!recordAllows(notVerified,ack)},
  actualCheckBasis:{idleVsA:sameCheckInputs(idle,a),idleVsB:sameCheckInputs(idle,b),withoutJointsA:ignoreJoints(idle,a),withoutJointsB:ignoreJoints(idle,b),runA:[...boundA.pos],runB:[...boundB.pos],differentBeginning:true},
  limitations:['Synthetic admitted straight track; bindBeginning really executed, no collision sweep or native motion.','Plan rules are modeled verbatim, not product code (the feature is unbuilt).','No browser timing or gesture guarantee is derived from these probes.']
};
process.stdout.write(JSON.stringify(output,null,2)+'\n');

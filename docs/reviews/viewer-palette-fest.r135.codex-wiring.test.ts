import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three';
import { decode } from '@msgpack/msgpack';
import { decodePreviewStreams } from '../previewDecode';
import { buildScrubTrack, buildEntryTrack, sliceTrack } from './scrubTrack';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
import { mergeBeginningOntoBase } from './sweepMerge';
import ts from 'typescript';
import {beginSentence,depTimeSentence,runBeginOf,runBeginView} from './startDep';
import {displayLineForPoint} from './scrubTrack';

const out = path.resolve(process.env.REVIEW_OUT ?? '../..');
const evidence: Record<string, any> = {};
afterAll(() => fs.writeFileSync(path.join(out, 'wiring.json'), JSON.stringify(evidence, null, 2)));
const machine: CollisionMachine = {
 groups:[{id:'table',parent:'root'},{id:'head',parent:'root'}],
 kinematics:[{group:'head',joint:0,type:'translate',direction:'x',sign:1},
 {group:'head',joint:1,type:'translate',direction:'y',sign:1},
 {group:'head',joint:2,type:'translate',direction:'z',sign:1}],
 workGroup:'table',toolGroup:'head',unitScale:1,axes:['X','Y','Z'],
};
const cube=()=>{const g=new THREE.BoxGeometry(2,2,2).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;};
const model=(at:[number,number,number]=[500,0,0])=>buildCollisionModel(machine,[{id:'obstacle',group:'table',positions:cube(),translate:at},
 {id:'head',group:'head',positions:cube()}]);
function actualSweepView(result:any, run:any) {
 // Execute the actual component's computed body with deterministic ref/prop
 // inputs. No copied verdict implementation, DOM, browser or live service.
 const source=fs.readFileSync(path.resolve('src/ScrubBar.vue'),'utf8');
 const begin=source.indexOf('const sweepView = computed<SimSweepView | null>');
 const end=source.indexOf('/** A provisional check',begin);
 expect(begin).toBeGreaterThan(0);expect(end).toBeGreaterThan(begin);
 const body=ts.transpileModule(source.slice(begin,end)+'\nreturn sweepView;',
   {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const refs={computed:(f:()=>any)=>f(),shownResult:{value:result},props:{collisionBusy:false,collisionRunCheck:run},
   hitTargets:{value:[]},sweepToolSentence:{value:''},verdictDetail:{value:''},sweepCaveat:{value:result.uncertified},
   boundaryDetail:{value:''},sweptFrac:{value:1},pctOf:(n:number)=>String(n*100)+'%'};
 return new Function(...Object.keys(refs),body)(...Object.values(refs));
}
function actualVerdictDetail(result:any, track:any) {
 const source=fs.readFileSync(path.resolve('src/ScrubBar.vue'),'utf8');
 const begin=source.indexOf('const verdictDetail = computed<string>');
 const end=source.indexOf('\n});',begin)+4;
 const body=ts.transpileModule(source.slice(begin,end)+'\nreturn verdictDetail;',
   {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const refs={computed:(f:()=>any)=>f(),beginSentence,depTimeSentence,shownResult:{value:result},props:{collisionBusy:false},track:{value:track},
  provisionalOnScreen:{value:false},stoppedTitle:{value:''},hits:{value:result.hits},sweepCaveat:{value:result.uncertified},
  pctOf:(n:number)=>String(n*100)+'%'};
 return new Function(...Object.keys(refs),body)(...Object.values(refs));
}
function load(name: string, start=[100,100,100]) {
 const raw=decode(fs.readFileSync(path.join(out,'payloads',name+'.msgpack'))) as Record<string,any>;
 const d=decodePreviewStreams(raw);
 const base=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,d.rotaryCmd,d.startBelieved,d.startUnbound)!;
 const wcs={g5x:[],g92:[],rotationDeg:0,tool:raw.tlo_start} as any;
 const rates={linear:raw.rapid_rate,rotary:raw.rot_rapid_rate,axisVmax:raw.axis_vmax,trajVmax:raw.traj_vmax};
 const entry=buildEntryTrack(base,start,['X','Y','Z'],wcs,undefined,undefined,0,rates);
 const snap=(t:any)=>t&&({count:t.count,pos:Array.from(t.pos),rapid:Array.from(t.rapid),cum:Array.from(t.cum),
   dep:t.dep&&Array.from(t.dep),depBasis:t.depBasis&&Array.from(t.depBasis),depF:t.depF&&Array.from(t.depF),
   brk:t.brk&&Array.from(t.brk),ustart:t.ustart&&Array.from(t.ustart),depEnd:t.depEnd,depTime:t.depTime,
   startBelieved:t.startBelieved,tlo:t.tlo&&Array.from(t.tlo),tloEvents:t.tloEvents});
 evidence[name]={raw:{rapid_dep:raw.rapid_dep&&Array.from(raw.rapid_dep),rapid_dep_basis:raw.rapid_dep_basis&&Array.from(raw.rapid_dep_basis),
   start_writes_untracked:raw.start_writes_untracked,start_believed:raw.start_believed},base:snap(base),entry:snap(entry)};
 return {raw,base,entry:entry!,wcs};
}

// Run the actual coordinator functions together. Only the surrounding
// admitted run/model/worker transport is controlled; no live Vue app or
// gateway. Function bodies and the display computed come from the commit.
function coordinator(track:any, wcs:any, joints:number[] | null=[100,100,100], why:string|null=null) {
 const file=fs.readFileSync('src/ThreeViewer.vue','utf8');
 const script=file.slice(file.indexOf('<script setup lang="ts">')+24,file.indexOf('</script>'));
 const ast=ts.createSourceFile('ThreeViewer.ts',script,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const functionNames=['_startRunCheck','_runBoundTrack','_colPostSide','_colOnSideMessage','_colBaseFor','_colRunSideFailed','_colCancelSide','_colDropEntry','runBeginNow'];
 const texts:string[]=[];
 for(const name of functionNames){
  const f=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  expect(f, name).toBeTruthy();texts.push(f!.getText(ast));
 }
 const v=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='collisionRunCheckView'));
 expect(v).toBeTruthy();texts.push(v!.getText(ast));
 const prelude=`
 const computed=(f)=>({get value(){return f()}});
 const ref=(x)=>({value:x});
 const viewerGcode=ref({scrubTrack:track,file:'offline.ngc',publishedVersion:7,rapid_rate:10,rot_rapid_rate:10});
 const runBasis=ref({runId:1,start:{jointsWhy:why}}),previewOrigin=ref({}),status=ref({data:{}});
 const runPlayhead=ref(null),viewerInit=ref({axes:['X','Y','Z']});
 const collisionRun=ref(null),collisionRunSide=ref(null),collisionEntry=ref(null),collisionRunSideState=ref(null);
 const collisionBusy=ref(false),collisionResumable=ref(false),collisionResult=ref(null),collisionTrack=ref(null);
 const collisionPartial=ref(null),collisionPartialTrack=ref(null);
 const basis={startJoints:joints};
 let _colRunGen=0,_colSide=null,_colSideSeq=0,_colModelSent=null;
 const _colRunLog=[],events=[],posted=[];
 const _colWorker={postMessage:(x)=>posted.push(x)},_colGetWorker=()=>_colWorker;
 const emitTelemetry=(type,data)=>events.push({type,data});
 const emit=()=>{},_colRetint=()=>{};
 const admitRunCheck=()=>({ok:true}),_runInProgress=()=>true,basisFromRun=()=>basis;
 const _colWcs=()=>wcs,specFromWire=()=>undefined,epochTermsFor=()=>undefined;
 const cancelCollisionCheck=()=>{},runCollisionCheck=()=>{};
 const _colBuildRequest=(_track,id)=>({msg:{id},transfer:[],modelKey:'test',bodies:2});
 const _liveCheckBasis=()=>basis,toRaw=(x)=>x;
 `;
 const expose=`
 return {
   start:()=>_startRunCheck(),
   setBase:(r)=>{collisionResult.value=r;collisionTrack.value=track},
   reply:(data)=>_colOnSideMessage({id:_colSide.id,...data}),
   view:()=>collisionRunCheckView.value,
   result:()=>_colBaseFor(track),
   side:()=>_colSide,
   snapshot:()=>({run:collisionRun.value,view:collisionRunCheckView.value,pending:!!_colSide,events,posted}),
 };`;
 const code=ts.transpileModule(prelude+texts.join('\n')+expose,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const dependencies={track,wcs,joints,why,runBeginOf,runBeginView,buildEntryTrack,sliceTrack,mergeBeginningOntoBase,displayLineForPoint};
 return new Function(...Object.keys(dependencies),code)(...Object.values(dependencies));
}
function sweep(base:any,wcs:any,opts:any={}){
 return sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1,...opts});
}
describe('R134 integrated coordinator and new boundary cases',()=>{
 for (const name of ['m6_first_absolute','m6_only_absolute']) it(`${name}: the unbindable first motion stays explicitly unchecked`,()=>{
  const {base,entry,wcs,raw}=load(name);
  expect(raw.start_unbound).toEqual([0,1,2]);expect(entry).toBeNull();
  const result=sweep(base,wcs), h=coordinator(base,wcs);
  expect(h.start()).toBe(true);h.setBase(result);
  const shown=actualSweepView(h.result(),h.view());
  const help=actualVerdictDetail(h.result(),base);
  evidence[name]={raw:{ustart:Array.from(raw.rapid_ustart??[]),unbound:raw.start_unbound},K:base.depEnd??0,result,view:h.view(),shown,help};
  expect(shown.verdict).not.toContain('checked in full');
  expect(help).toMatch(/not checked|cannot know/);
 });
 for(const order of ['base-first','side-first']) it(`control: ${order} merges the matching bound start`,()=>{
  const {base,wcs}=load('first_g1_x_control');const h=coordinator(base,wcs);
  expect(h.start()).toBe(true);const side=h.side();expect(side).toBeTruthy();
  const main=sweep(base,wcs), beginning=sweep(side.slice,wcs);
  if(order==='base-first'){
   h.setBase(main);expect(actualSweepView(h.result(),h.view()).verdict).toContain('still checking');
   h.reply({result:beginning});
  }else{
   h.reply({result:beginning});expect(h.result()).toBeNull();h.setBase(main);
  }
  const shown=actualSweepView(h.result(),h.view());
  evidence[order]={view:h.view(),shown,startDependent:h.result().startDependent??null};
  expect(h.view().begin).toBe('checked');expect(shown.verdict).toBe('Clear · checked in full');
 });
 it('control: missing joints stay not checked with their reason',()=>{
  const {base,wcs}=load('first_g1_x_control');const h=coordinator(base,wcs,null,'not in position');
  expect(h.start()).toBe(true);h.setBase(sweep(base,wcs));
  const shown=actualSweepView(h.result(),h.view());
  evidence.nojoints={view:h.view(),shown,sentence:beginSentence(h.result().startDependent,h.view())};
  expect(h.view().begin).toBe('nojoints');expect(shown.verdict).not.toContain('checked in full');
  expect(beginSentence(h.result().startDependent,h.view())).toContain('not in position');
 });
 for(const failure of ['worker-error','need-bodies-twice']) it(`${failure}: a failed side check does not remain checking forever`,()=>{
  const {base,wcs}=load('first_g1_x_control');const h=coordinator(base,wcs);
  expect(h.start()).toBe(true);h.setBase(sweep(base,wcs));
  if(failure==='worker-error')h.reply({error:'injected side sweep failure'});
  else {h.reply({needBodies:true});h.reply({needBodies:true});}
  const shown=actualSweepView(h.result(),h.view());
  evidence[failure]={state:h.snapshot(),shown};
  expect(h.side()).toBeNull();
  expect(shown.state).not.toBe('checking');
  expect(shown.verdict).toMatch(/not checked|failed/);
 });
 it('control: a stopped side is not a full check',()=>{
  const {base,wcs}=load('first_g1_x_control');const h=coordinator(base,wcs);
  expect(h.start()).toBe(true);h.setBase(sweep(base,wcs));
  const result=sweep(h.side().slice,wcs);result.truncated={covered:0.5,reason:'backstop'} as any;
  h.reply({result});const shown=actualSweepView(h.result(),h.view());
  evidence.stopped={view:h.view(),truncated:h.result().truncated,shown};
  expect(h.result().truncated.covered).toBe(0);expect(shown.verdict).not.toContain('checked in full');
 });
});

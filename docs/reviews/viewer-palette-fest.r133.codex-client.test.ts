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

const out = path.resolve(process.env.REVIEW_OUT ?? '../..');
const evidence: Record<string, any> = {};
afterAll(() => fs.writeFileSync(path.join(out, 'client.json'), JSON.stringify(evidence, null, 2)));
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
 const refs={computed:(f:()=>any)=>f(),shownResult:{value:result},props:{collisionBusy:false},track:{value:track},
  provisionalOnScreen:{value:false},stoppedTitle:{value:''},hits:{value:result.hits},sweepCaveat:{value:result.uncertified},
  pctOf:(n:number)=>String(n*100)+'%'};
 return new Function(...Object.keys(refs),body)(...Object.values(refs));
}
function load(name: string, start=[100,100,100]) {
 const raw=decode(fs.readFileSync(path.join(out,'payloads',name+'.msgpack'))) as Record<string,any>;
 const d=decodePreviewStreams(raw);
 const base=buildScrubTrack(d.feed,d.rapid,d.kinsFrames,d.wcsEvents,d.subNames,d.tloEvents,d.rotaryCmd,d.startBelieved)!;
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
describe('R133 independent native-payload contracts',()=>{
 it('first G1 with all XYZ specified keeps its feed kind and F',()=>{
  const {entry}=load('first_g1_xyz',[100,0,0]);
  expect(entry.rapid[1]).toBe(0);
  expect(entry.cum[1]).toBeCloseTo(60,4);
 });
 it('control: first G1 with dependent Y/Z keeps its F',()=>{
  const {entry}=load('first_g1_x_control',[100,0,0]);
  expect(entry.rapid[1]).toBe(0);
  expect(entry.cum[1]).toBeCloseTo(60,4);
 });
 it('G43 before the first move does not subtract its offset twice from dependent Z',()=>{
  const {entry}=load('g43_before_first');
  // Machine starts at Z100, G43.1 Z10 relabels the tip to program Z90.
  // G0 X10 moves no Z: the endpoint must still be program Z90.
  expect(entry.pos[5]).toBeCloseTo(90,4);
 });
 it('the G43 error must not hide an obstacle on the real horizontal X move',()=>{
  const {entry,wcs}=load('g43_before_first');
  const correct={...entry,pos:entry.pos.slice()}; correct.pos[5]=90;
  const actual=sweepCollisions(model([50,100,100]),{...entry,wcs:entry.wcsEpoch},wcs,
    {margin:0.1,tloEvents:entry.tloEvents});
  const reference=sweepCollisions(model([50,100,100]),{...correct,wcs:correct.wcsEpoch},wcs,
    {margin:0.1,tloEvents:correct.tloEvents});
  evidence.g43Collision={actual:actual.hits,analyticHorizontalReference:reference.hits};
  expect(reference.hits.length).toBeGreaterThan(0);
  expect(actual.hits.length).toBeGreaterThan(0);
 });
 it('control: G43 after first move keeps program Z90 at its relabel',()=>{
  const {entry}=load('g43_after_first_control');
  expect(entry.pos[8]).toBeCloseTo(90,4);
 });
 it('a first endpoint after unseen M6 travel is not connected to the program-start pose',()=>{
  const {entry}=load('m6_before_first');
  expect(!entry||entry.brk?.[1]===1).toBe(true);
 });
 it('slicing the real side request preserves the untracked-write caveat',()=>{
  const {raw,base,entry,wcs}=load('untracked_writes');
  expect(raw.start_writes_untracked).toBe(true);
  const K=base.depEnd??0;
  const side=sliceTrack(entry,0,Math.min(K+1,entry.count-1)+1);
  const opts={margin:0.1,startWritesUntracked:true};
  const fullResult=sweepCollisions(model(),{...entry,wcs:entry.wcsEpoch},wcs,opts);
  const sideResult=sweepCollisions(model(),{...side,wcs:side.wcsEpoch},wcs,opts);
  evidence.sideNotes={full:fullResult.uncertified,sliced:sideResult.uncertified,hasDep:!!side.dep};
  expect(sideResult.uncertified).toContain('start-dependent beginning');
 });
 it('merging the run beginning retains a provisional range and boundary contacts',()=>{
  const {base,entry,wcs}=load('first_g1_x_control');
  const K=base.depEnd??0;
  const baseResult=sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1,range:{from:K}});
  const sideResult=sweepCollisions(model(),{...sliceTrack(entry,0,K+2),wcs:entry.wcsEpoch},wcs,{margin:0.1});
  const merged=mergeBeginningOntoBase(sideResult,baseResult,entry.cum[K+1]!,base.cum[base.count-1]!,entry.cum[1]);
  evidence.runMerge={before:baseResult.range,after:merged.range,boundaryBefore:baseResult.boundaryContacts,boundaryAfter:merged.boundaryContacts};
  expect(merged.range).toEqual(baseResult.range);
  expect(merged.boundaryContacts).toEqual(baseResult.boundaryContacts);
 });
 it('a full run check without start joints never calls a wholly dependent track clear',()=>{
  const {base,wcs}=load('all_dep');
  const result=sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1});
  expect(result.startDependent?.whole).toBe(true);
  const idle=actualSweepView(result,null);
  const run=actualSweepView(result,{phase:'full',provisionalShown:false,fromLine:null});
  evidence.wholeVerdict={startDependent:result.startDependent,idle,run};
  expect(run.verdict).not.toMatch(/Clear|checked in full/);
 });
 it('a run whose beginning is still unbound never says checked in full',()=>{
  const {base,wcs}=load('first_g1_x_control');
  const result=sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1});
  expect(result.startDependent?.whole).toBe(false);
  const run=actualSweepView(result,{phase:'full',provisionalShown:false,fromLine:null});
  evidence.unboundVerdict={startDependent:result.startDependent,run};
  expect(run.verdict).not.toContain('checked in full');
 });
 it('a call-less store before the first absolute move is still untracked',()=>{
  const {raw,base,wcs}=load('store_before_first_absolute');
  evidence.initialStore={flag:raw.start_writes_untracked??null,stale:raw.stale_offset_lines??null,depEnd:base.depEnd??0,
    result:sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1,startWritesUntracked:raw.start_writes_untracked})};
  expect(raw.start_writes_untracked===true||!!raw.stale_offset_lines?.length).toBe(true);
 });
 it('control: a store after fully known coordinates has no start-dependent caveat',()=>{
  const {raw}=load('store_after_known_control');
  expect(raw.start_writes_untracked).toBeUndefined();
 });
 it('the untracked-write flag is authoritative even when no endpoint retains a mask',()=>{
  const {base,wcs}=load('store_before_first_absolute');
  // Independent consumer check: even a corrected producer sending the flag
  // would currently be ignored when every emitted endpoint is absolute.
  const result=sweepCollisions(model(),{...base,wcs:base.wcsEpoch},wcs,{margin:0.1,startWritesUntracked:true});
  evidence.initialStoreFlagForced={uncertified:result.uncertified,depEnd:base.depEnd??0};
  expect(result.uncertified).toContain('start-dependent beginning');
 });
 it('unknown time begins at the first G93 move, not its successor',()=>{
  const {entry}=load('g93_no_limits');
  expect(entry.depTime).toEqual({line:2,bound:false});
 });
 it('the help names the cause and line of unknown beginning time',()=>{
  const {entry,wcs}=load('g93_no_limits');
  const result=sweepCollisions(model(),{...entry,wcs:entry.wcsEpoch},wcs,{margin:0.1});
  const detail=actualVerdictDetail(result,entry);
  evidence.timeDetail={depTime:entry.depTime,cum:Array.from(entry.cum),detail};
  expect(detail).toMatch(/L2/);
  expect(detail).toMatch(/unknown|lower bound|time/i);
 });
});

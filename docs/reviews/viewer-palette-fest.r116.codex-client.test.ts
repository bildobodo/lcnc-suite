import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { computed, ref } from 'vue';
import { it, expect } from 'vitest';
import { emptyLineIndex } from './lineIndex';
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from './collision';
import { clashTargets } from './clashTargets';
import { clashTintBodies } from './clashTint';
const out = process.env.R116_EVIDENCE!;
const script = (file:string) => fs.readFileSync(new URL('../'+file, import.meta.url),'utf8').split('<script setup lang="ts">')[1]!.split('</script>')[0]!;
function tree(file:string) { return ts.createSourceFile(file,script(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS); }
function expression(file:string,name:string) {
 const sf=tree(file);
 for(const st of sf.statements) if(ts.isVariableStatement(st)) for(const d of st.declarationList.declarations) {
  if(d.name.getText(sf)===name) return d.initializer!.getText(sf);
 }
 throw new Error(name);
}
function func(file:string,name:string) {
 const sf=tree(file);const fn=sf.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)!;
 return fn.getText(sf);
}
function evaluate(src:string,env:Record<string,any>) {
 const js=ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return new Function(...Object.keys(env),js)(...Object.values(env));
}
function comp(name:string,env:Record<string,any>) {
 return evaluate('return '+expression('ScrubBar.vue',name),{computed,...env});
}
function cube(){const g=new THREE.BoxGeometry(10,10,10).toNonIndexed();const p=new Float32Array(g.getAttribute('position').array);g.dispose();return p;}
const MILL:CollisionMachine={groups:[{id:'table',parent:'root'},{id:'platter',parent:'table'},{id:'head',parent:'root',translate:[0,0,50]}],kinematics:[{group:'table',joint:0,type:'translate',direction:'x',sign:1},{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'platter',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
const model=()=>buildCollisionModel(MILL,[{id:'vise',group:'table',positions:cube()},{id:'spindle',group:'head',positions:cube()}]);
function track(z:number[]){const cum=new Float32Array(z.length);for(let i=1;i<z.length;i++)cum[i]=cum[i-1]!+Math.abs(z[i]!-z[i-1]!);return {pos:new Float32Array(z.flatMap(v=>[0,0,v])),abc:new Float32Array(z.length*3),cum,rapid:new Uint8Array(z.length),lines:new Uint32Array(z.map((_,i)=>i+1)),count:z.length,timeBased:false,lineIndex:emptyLineIndex()};}
const wcs={g5x:[],g92:[],rotationDeg:0};
const write=(n:string,d:any)=>fs.writeFileSync(out+'/'+n+'.json',JSON.stringify(d,null,2)+'\n');

it('a real boundary contact still becomes an ordinary G-code collision mark',()=>{
 const t=track([0,-45,0]);const r=sweepCollisions(model(),t,wcs,{margin:2,range:{from:1}});
 expect(r.boundaryContacts).toHaveLength(1);expect(r.hits.every(h=>h.boundary)).toBe(true);
 expect(clashTargets(r.hits)).toHaveLength(0);
 // Extract the real emission expression, not a replacement mapping.
 const sf=tree('ThreeViewer.vue');let payload='';
 function walk(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(sf)==='emit'&&n.arguments[0]?.getText(sf)==='"collision-lines"'&&n.arguments[1]?.getText(sf).startsWith('result.hits.map'))payload=n.arguments[1]!.getText(sf);ts.forEachChild(n,walk);}
 walk(sf);expect(payload).not.toBe('');
 const marks=evaluate('return '+payload,{result:r});
 const titleFn=evaluate(func('GcodePanel.vue','lineMarkTitle')+'\nreturn lineMarkTitle',{violationsByLine:ref(new Map()),collisionLineSet:ref(new Map(marks.map((m:any)=>[m.line,m]))),violationText:()=>''});
 const title=titleFn(r.hits[0]!.line);const glow=[...clashTintBodies(r.hits,r.hits[0]!.line,46)];
 write('boundary-consumers',{result:r,countedCollisions:clashTargets(r.hits).length,emittedMarks:marks,title,glow});
 expect(title).toBe('collision clearance hit — see viewer Check results');
 expect(marks[0].boundary).toBeUndefined();expect(glow.length).toBe(2);
});

it('a timed-out provisional sweep paints its unswept suffix while the full sweep runs',()=>{
 const t=track([0,-45,-44,0]);const r=sweepCollisions(model(),t,wcs,{margin:2,range:{from:1},maxMs:0,yieldMs:0});
 expect(r.truncated?.reason).toBe('time');expect(r.truncated!.covered).toBeLessThan(1);
 const props={collisionBusy:true,collisionProgress:0.1,collisionStopped:null,collisionResumable:false,collisionRunCheck:{phase:'full',provisionalShown:true,fromLine:3,fromCum:t.cum[1]}};
 const env:any={props,track:ref(t),baseTrack:ref(t),cumMax:ref(t.cum[t.count-1]),shownResult:ref(r),mergedSweptFraction:()=>{throw new Error('no merged track');},routeWord:ref('program'),pctOf:(v:number)=>`${Math.round(v*100)} %`};
 env.sweptFrom=comp('sweptFrom',env);env.sweptFrac=comp('sweptFrac',env);env.sweepCaveat=comp('sweepCaveat',env);
 const from=env.sweptFrom.value,to=env.sweptFrac.value,caveat=env.sweepCaveat.value;
 write('provisional-coverage',{result:r,fullCheckProgress:props.collisionProgress,displayedBand:[from,to],actualCoverageEnd:r.truncated!.covered,caveat});
 expect(to).toBe(1);expect(to).toBeGreaterThan(r.truncated!.covered);expect(caveat).toBeNull();
});

it('the sole boundary detail hides every pair after the third',()=>{
 const bc=Array.from({length:5},(_,i)=>({a:'moving'+i,b:'fixed'+i,line:i+10,cum:i,dist:0,cutting:true}));
 const detail=comp('boundaryDetail',{shownResult:ref({boundaryContacts:bc}),partLabel:(s:string)=>s}).value;
 write('boundary-help',{input:bc,detail});
 expect(detail).toContain('moving2');expect(detail).not.toContain('moving3');expect(detail).not.toContain('moving4');
});

it('needBodies retries a provisional request without its range or run generation',()=>{
 const sf=tree('ThreeViewer.vue');let callback='';
 function walk(n:ts.Node){if(ts.isBinaryExpression(n)&&n.left.getText(sf)==='_colWorker.onmessage')callback=n.right.getText(sf);ts.forEachChild(n,walk);}
 walk(sf);expect(callback).not.toBe('');
 const t=track([0,-45,0]);const completed=sweepCollisions(model(),t,wcs,{margin:2});
 const sent:any[]=[];const calls:any[]=[];
 const basis={kind:'run',runId:9};
 const env:any={toRaw:(x:any)=>x,viewerGcode:ref({scrubTrack:t}),_colSide:null,_colReqId:7,_colNeedBodiesRetried:false,
  _colModelSent:'m',_colPendingTrack:t,_colReqRunGen:12,_colKeepShown:false,_colBasis:basis,_colReqMeta:{range:1},
  _colStopPending:false,_colRotaryAtStart:null,_colStartedAt:0,
  collisionBusy:ref(true),collisionPrevious:ref(null),collisionProgress:ref(0),collisionResult:ref(null),
  collisionTrack:ref(null),collisionPartial:ref(null),collisionPartialTrack:ref(null),collisionResumable:ref(false),collisionStopped:ref(null),
  collisionRun:ref({version:3,runId:9,gen:12,phase:'provisional',fromIndex:1,basis}),_colRunLog:[],
  _checkBasisNow:()=>basis,_colBuildRequest:(track:any,id:number,side:boolean,b:any,range:any)=>{
   calls.push({id,side,basis:b,range:range??null});return {msg:{id,options:range?{range}:{}},transfer:[],modelKey:'m',bodies:2};
  },_colGetWorker:()=>({postMessage:(msg:any)=>sent.push(msg)}),_colApplyPauses:()=>{},_rotaryNow:()=>null,
  emitTelemetry:()=>{},emit:()=>{},_colRetint:()=>{},_colFail:()=>{throw new Error('unexpected failure')},performance,
  completed};
 const got=evaluate(func('ThreeViewer.vue','runCollisionCheck')+'\nconst onmessage='+callback+';\n'
  +'onmessage({data:{id:7,needBodies:true}}); const retry={meta:_colReqMeta,gen:_colReqRunGen,keepShown:_colKeepShown};'
  +'onmessage({data:{id:_colReqId,result:completed}});return {retry,phase:collisionRun.value.phase,log:_colRunLog};',env);
 write('retry-context',{original:{gen:12,phase:'provisional',range:{from:1}},sent,calls,after:got});
 expect(calls[0].range).toBeNull();expect(got.retry.gen).toBeNull();expect(got.phase).toBe('provisional');expect(got.log).toEqual([]);
});

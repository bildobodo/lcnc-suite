import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { expect,it,afterAll } from "vitest";
import { buildCollisionModel,pairInside,pairDistance,poseModel,sweepCollisions,type CollisionMachine,type CollisionBody } from "./collision";
import { meshClosure } from "./insideCheck";
import { mergeEntryResult } from "./sweepMerge";
import { mergeShardResults } from "./sweepShards";
const rows:any[]=[];
afterAll(()=>writeFileSync("../evidence/viewer-palette-fest.r101.codex-contracts.json",JSON.stringify(rows,null,2)));
const M:CollisionMachine={groups:[{id:"table",parent:"root"},{id:"part",parent:"table"},{id:"head",parent:"root"}],kinematics:[{group:"head",joint:0,type:"translate",direction:"x",sign:1}],workGroup:"part",toolGroup:"head",unitScale:1,axes:["X","Y","Z"]};
const box=(s:number,x=0,y=0,z=0)=>{const g=new THREE.BoxGeometry(s,s,s).toNonIndexed();g.translate(x,y,z);const p=new Float32Array(g.getAttribute("position").array as Float32Array);g.dispose();return p;};
const pair=(inner:Float32Array,outer:Float32Array)=>buildCollisionModel(M,[{id:"outer",group:"table",positions:outer},{id:"inner",group:"head",positions:inner}]);
const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
const tr={count:2,pos:new Float32Array([0,0,0,1,0,0]),abc:new Float32Array(6),cum:new Float32Array([0,1]),lines:new Uint32Array([1,2]),rapid:new Uint8Array(2)};
it("all 257 representative points survive the component-box cap; only the last is inside",()=>{
 const components=Array.from({length:256},(_,i)=>box(1,100+i*2));components.push(box(1));
 const positions=new Float32Array(components.flatMap(p=>Array.from(p)));
 const m=pair(positions,box(20));poseModel(m,[0,0,0]);
 const inner=m.bodies.find(b=>b.id==="inner")!,outer=m.bodies.find(b=>b.id==="outer")!;
 expect(inner.comps.length).toBe(6);expect(inner.insideReps.length).toBe(257*3);
 expect(pairInside(inner,outer)).toBe("inside");
 rows.push({case:"257 components",componentBoxes:inner.comps.length/6,representatives:inner.insideReps.length/3,inside:pairInside(inner,outer)});
});
it("an open container is skipped but the reverse direction (open part in closed container) is retained",()=>{
 const closed=pair(box(1).slice(9),box(60));poseModel(closed,[0,0,0]);
 expect(closed.open).toEqual(["inner"]);expect(pairInside(closed.bodies[0]!,closed.bodies[1]!)).toBe("inside");
 const open=pair(box(1),box(60).slice(9));poseModel(open,[0,0,0]);
 expect(pairInside(open.bodies[0]!,open.bodies[1]!)).toBe("outside");
 const r=sweepCollisions(open,tr,wcs,{margin:.1});
 expect(r.hits).toEqual([]);expect(r.staticContacts).toEqual([]);expect(r.uncertified).toContain("outer: surface not closed");
 rows.push({case:"open directions",known:pairInside(closed.bodies[0]!,closed.bodies[1]!),skipped:r});
});
it("both merge paths preserve independent model and uncertain-span notes, including legacy results",()=>{
 const r=sweepCollisions(pair(box(1),box(60)),tr,wcs,{margin:.1});
 const a={...r,notes:["open model","uncertain A L2"],uncertified:"open model; uncertain A L2"};
 const b={...r,notes:["open model","uncertain B L3"],uncertified:"open model; uncertain B L3"};
 const legacy={...r,notes:undefined,uncertified:"unknown start L4"};
 const shard=mergeShardResults([a,b,legacy]),entry=mergeEntryResult(a,b,1,1);
 expect(shard.notes).toEqual(["open model","uncertain A L2","uncertain B L3","unknown start L4"]);
 expect(entry.notes).toEqual(["open model","uncertain A L2","uncertain B L3"]);
 rows.push({case:"note unions",shard:shard.notes,entry:entry.notes});
});
it("pairDistance in nested boxes certifies no more than their analytic surface clearance, including Infinity",()=>{
 const m=pair(box(1),box(120)); const values:any[]=[];
 for(const x of [-65,-60,-55,-40,-20,0,20,40,55,60,65]){
  poseModel(m,[x,0,0]);const a=m.bodies[0]!,b=m.bodies[1]!;
  const dist=pairDistance(a,b,20,.1),gap=Math.max(0,Math.abs(Math.abs(x)-60)-.5);
  const bound=Number.isFinite(dist)?dist:20;
  expect(bound).toBeLessThanOrEqual(gap+1e-5);
  if(gap>1e-4)expect(pairInside(a,b)).toBe(Math.abs(x)<59.5?"inside":"outside");
  values.push({x,dist:Number.isFinite(dist)?dist:"Infinity",bound,analytic:gap});
 }
 rows.push({case:"nested clearance",values});
});

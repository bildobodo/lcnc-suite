import {writeFileSync} from "node:fs";
import * as THREE from "three";
import {expect,it} from "vitest";
import {buildCollisionModel,sweepCollisions,type CollisionMachine,poseModel,pairInside} from "./collision";
import {sweepCollisions as noCert} from "./r101.noCert";
import {sweepCollisions as speedBound} from "./r101.speedBound";
const box=(s:number)=>{const g=new THREE.BoxGeometry(s,s,s).toNonIndexed();return new Float32Array(g.getAttribute("position").array as Float32Array);};
function run() {
 const x0=1000*Math.cos(11.25*Math.PI/180);
 const m:CollisionMachine={groups:[{id:"table",parent:"root"},{id:"part",parent:"table"},{id:"head",parent:"root"}],kinematics:[{group:"head",joint:0,type:"translate",direction:"x",sign:1}],workGroup:"part",toolGroup:"head",unitScale:1,axes:["X","Y","Z","A","C"],kins:{type:"xyzac-trt",identityFirst:true,params:{}}};
 const make=()=>buildCollisionModel(m,[{id:"outer",group:"table",positions:box(20),translate:[x0,0,0]},{id:"inner",group:"head",positions:box(1)}]);
 const t={count:2,pos:new Float32Array([1000,0,0,1000,0,0]),abc:new Float32Array([0,0,-11.25,0,0,11.25]),cum:new Float32Array([0,22.5]),lines:new Uint32Array([1,2]),rapid:new Uint8Array(2),mode:new Uint8Array([1,1])};
 const wcs={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
 const a=sweepCollisions(make(),t,wcs,{margin:.1}),b=noCert(make(),t,wcs,{margin:.1});
 const exit=11.25-Math.acos((x0+10.5)/1000)*180/Math.PI;
 const fixed=speedBound(make(),t,wcs,{margin:.1});
 const radius=1000,phi=22.5*Math.PI/180,bulge=radius*phi*phi/8;
 const V=bulge/22.5,clearance=9.5;
 const positions=[0,3.680272591280805,5,10,11.25,18.819727408719196,22.5].map(s=>{
  const C=-11.25+s,x=radius*Math.cos(C*Math.PI/180),posed=make();poseModel(posed,[x,0,0,0,C]);
  return {s,C,x,inside:pairInside(posed.bodies[0]!,posed.bodies[1]!),clearanceLeftClaimed:clearance-s*V};
 });
 const artifact={x0,exit,expectedIntervals:[[0,exit],[22.5-exit,22.5]],V,bulge,maxActualSpeed:1000*Math.sin(11.25*Math.PI/180)*Math.PI/180,positions,with:a,without:b,derivativeBoundControl:fixed};
 writeFileSync("../evidence/viewer-palette-fest.r101.codex-bulge.json",JSON.stringify(artifact,null,2));
 return artifact;
}
const r=run();
it("analytic control: at 5 and 10 degrees the cube is outside",()=>{
 expect(r.positions.filter(p=>p.s===5||p.s===10).map(p=>p.inside)).toEqual(["outside","outside"]);
 expect(r.positions.find(p=>p.s===10)!.clearanceLeftClaimed).toBeGreaterThan(0);
});
it("without the inside certificate the first interval ends at the analytic exit",()=>{
 expect(r.without.hits[0]!.cumEnd).toBeCloseTo(r.exit,2);
});
it("the inside certificate must not extend the first interval past the real exit",()=>{
 expect(r.with.hits[0]!.intervals![0]![1]).toBeCloseTo(r.exit,2);
});
it("the shared speed bound must not miss the return into the box",()=>{
 expect(r.with.hits[0]!.intervals).toHaveLength(2);
});
it("derivative-bound control recovers both analytic intervals, certificate enabled",()=>{
 const iv=r.derivativeBoundControl.hits[0]!.intervals!;
 expect(iv).toHaveLength(2);
 for(let i=0;i<2;i++) for(let j=0;j<2;j++) expect(iv[i]![j]).toBeCloseTo(r.expectedIntervals[i]![j]!,2);
});

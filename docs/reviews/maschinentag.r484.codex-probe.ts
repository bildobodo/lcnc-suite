import * as THREE from 'three';
import { ownHoleAxis } from './owncut';
import { Prog, sweep, MACHINE, buildCollisionModel, boxPositions } from './lib';
import { pairDistance, pairInside } from '@coll';
import { inLocalBoxes, pointInside } from '@src/insideCheck';
const log = (x: any) => console.log(JSON.stringify(x));
// Same cylinder, a new parallel centre line 0.0015 mm to the right:
// the new radial extreme was never within any of the earlier fed disks.
for (const dx of [0, 0.00005, 0.0015, 0.0021, 0.02]) {
 const p = new Prog();
 p.g0({x:50,y:30,z:15}).g0({z:3}).g1({z:-6}).g0({z:3}).g0({x:50+dx}).g0({z:-5}).g1({z:-8}).g0({z:15});
 const t=p.track(), seg=5, entry=t.cum[seg-1]+3;
 const exempt=ownHoleAxis(t,t.cum,seg,entry,()=>true);
 const runs=['A','C'].map(rule=>{ (globalThis as any).__RULE=rule; const r=sweep(t,{stock:[-10,110,-10,70,-30,0]}); return {rule,by:r.by}; });
 const shift=t.pos[seg*3]-t.pos[2*3];
 log({case:'parallel-axis reentry',dx,storedShift:shift,exempt,newMaterialOverContactEps:shift>1e-4,runs});
}
// The plan's rep-vertex box exclusion on an OPEN stock. Permuting triangles
// changes only the selected representative, never the material or surfaces.
const allStock=boxPositions(20,20,30,0,0,-15);
const openStock=Float32Array.from(Array.from({length:allStock.length/9},(_,i)=>Array.from(allStock.slice(i*9,i*9+9))).filter(t=>!(t[2]===0&&t[5]===0&&t[8]===0)).flat());
const allTool=boxPositions(2,2,60,0,0,25);
const tris=Array.from({length:allTool.length/9},(_,i)=>Array.from(allTool.slice(i*9,i*9+9)));
function apartByReps(A:any,B:any) {
 for(const [P,Q] of [[A,B],[B,A]]) {
  if(Q.insideClosed)continue;
  const rel=new THREE.Matrix4().copy(Q.world).invert().multiply(P.world);
  for(let i=0;i<P.insideReps.length;i+=3) {
   const p=new THREE.Vector3(...Array.from(P.insideReps.slice(i,i+3)) as [number,number,number]).applyMatrix4(rel);
   if(Q.geom.boundingBox.containsPoint(p)&&inLocalBoxes(p,Q.comps))return false;
  }
 }
 return true;
}
for(const where of ['top','bottom']) {
 const z=where==='top'?55:-5;
 const first=tris.findIndex(t=>t[2]===z&&t[5]===z&&t[8]===z);
 const ts=[tris[first],...tris.filter((_,i)=>i!==first)];
 const model=buildCollisionModel(MACHINE,[{id:'stock',group:'table',positions:openStock,stock:true},{id:'tool',group:'tool',positions:Float32Array.from(ts.flat()),tool:true}]);
 const a=model.bodies[0],b=model.bodies[1];
 log({case:'open stock representative',order:where,closed:[a.insideClosed,b.insideClosed],representatives:Array.from(b.insideReps),distance:pairDistance(a,b,100,2),insideResult:pairInside(a,b),apartByReps:apartByReps(a,b),toolZ:[-5,55],stockZ:[-30,0],knownOverlapWithClosedBox:5});
}

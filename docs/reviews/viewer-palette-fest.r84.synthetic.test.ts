// Small synthetic evidence for the R84 idea review; no operator program.
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { writeFileSync } from 'node:fs';
import { buildCollisionModel, sweepCollisions, type CollisionMachine, type CollisionBody } from './collision';
import { clashTargets } from './clashTargets';
const results:Record<string,unknown>={};
const save=()=>writeFileSync('../evidence/viewer-palette-fest.r84.synthetic.json',JSON.stringify(results,null,2)+'\n');
const machine:CollisionMachine={groups:[{id:'fixed',parent:'root'},{id:'head',parent:'root',translate:[0,0,50]}],kinematics:[{group:'head',joint:2,type:'translate',direction:'z',sign:1}],workGroup:'fixed',toolGroup:'head',unitScale:1,axes:['X','Y','Z']};
function boxes():CollisionBody[]{return ['fixed','head'].map(group=>{const g=new THREE.BoxGeometry(10,10,10).toNonIndexed();const positions=new Float32Array(g.getAttribute('position').array);g.dispose();return {id:group,group,positions};});}
function path(cycles:number,sameLine:boolean){
 const n=cycles*2+1,pos=new Float32Array(n*3),cum=new Float32Array(n),lines=new Uint32Array(n);
 for(let i=0;i<n;i++){pos[i*3+2]=i%2?-45:0;cum[i]=i*45;lines[i]=sameLine?7:i+1;}
 return {pos,abc:new Float32Array(n*3),lines,rapid:new Uint8Array(n),cum,count:n};
}
const WCS={g5x:[0,0,0,0,0,0],g92:[],rotationDeg:0};
it('the mesh distance is not a penetration depth',()=>{
 const outer=new THREE.BoxGeometry(2,2,2),bvh=new MeshBVH(outer),other=new THREE.BoxGeometry(2,2,2);
 const rows=[];
 for(const x of [2.5,1.9,.2]){const d=bvh.closestPointToGeometry(other,new THREE.Matrix4().makeTranslation(x,0,0))!.distance;rows.push({x,surfaceDistance:d,analyticOverlap:Math.max(0,2-x)});}
 const inner=new THREE.BoxGeometry(.5,.5,.5),contained=bvh.closestPointToGeometry(inner,new THREE.Matrix4())!.distance;
 results.distance={rows,fullyContainedSurfaceDistance:contained};save();
 expect(rows[1]!.surfaceDistance).toBeCloseTo(0,6);expect(rows[2]!.surfaceDistance).toBeCloseTo(0,6);expect(contained).toBeCloseTo(.75,6);
 outer.dispose();other.dispose();inner.dispose();
});
it('the same line has a second lossy cap at sixteen contact intervals',()=>{
 const r=sweepCollisions(buildCollisionModel(machine,boxes()),path(17,true),WCS,{margin:.1,maxMs:10000});
 const intervals=r.hits.flatMap(h=>h.intervals??[]);
 // The last clear tip at the top of the retraction is cum 16*90.
 const clearAt=16*90;
 results.intervalCap={expectedEpisodes:17,records:r.hits.length,targets:clashTargets(r.hits).length,intervals,knownClearCum:clearAt,clearInsideReportedInterval:intervals.some(([a,b])=>a<clearAt&&clearAt<b),truncated:r.truncated,uncertified:r.uncertified,samples:r.samples};save();
 expect(r.truncated).toBeNull();expect(intervals).toHaveLength(16);expect(intervals.some(([a,b])=>a<clearAt&&clearAt<b)).toBe(true);
});
it('more than two hundred onset records are dropped without a reporting-completeness field',()=>{
 const r=sweepCollisions(buildCollisionModel(machine,boxes()),path(201,false),WCS,{margin:.1,maxMs:10000});
 results.recordCap={expectedEpisodes:201,records:r.hits.length,targets:clashTargets(r.hits).length,lastReportedLine:Math.max(...r.hits.map(h=>h.line)),lastExpectedOnsetLine:402,truncated:r.truncated,uncertified:r.uncertified,samples:r.samples,resultKeys:Object.keys(r)};save();
 expect(r.truncated).toBeNull();expect(r.hits).toHaveLength(200);expect(clashTargets(r.hits)).toHaveLength(200);expect(Math.max(...r.hits.map(h=>h.line))).toBeLessThan(402);
});

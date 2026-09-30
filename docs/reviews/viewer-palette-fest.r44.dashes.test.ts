import { test } from 'vitest';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { makeBoxEdges, MACHINE_BOX_DASH_PX, TOOLPATH_BOX_DASH_PX } from './boxLines';
test('R44 numerical projection of actual box dashes',()=>{
 const result:any[]=[];
 for(const projection of ['ortho','perspective']) for(const dir of [[1,2,.7],[1,.12,.25]]){
  const cam=projection==='ortho'?new THREE.OrthographicCamera(-400,400,300,-300,.1,10000):new THREE.PerspectiveCamera(45,800/600,.1,10000);
  cam.up.set(0,0,1);cam.position.fromArray(dir).normalize().multiplyScalar(800);cam.lookAt(0,0,0);cam.updateMatrixWorld();cam.updateProjectionMatrix();
  for(const dashPx of [MACHINE_BOX_DASH_PX,TOOLPATH_BOX_DASH_PX]){
   const box=makeBoxEdges([500,400,310],{color:'#15181c',alt:'#f0f2f4',width:2,dashPx,role:'bounds'});
   box.updateMatrixWorld();
   const line:any=box.children[1];
   line.onBeforeRender({getSize:(v:THREE.Vector2)=>v.set(800,600)},new THREE.Scene(),cam);
   const d=line.material.dashSize;
   const projected:Record<string,number>={};
   for(const [i,axis] of ['X','Y','Z'].entries()){
    // Middle of one real edge of that direction, projected dash around it.
    const centre=new THREE.Vector3(i===0?0:250,i===1?0:200,i===2?0:155);
    const a=centre.clone(),b=centre.clone();a.setComponent(i,a.getComponent(i)-d/2);b.setComponent(i,b.getComponent(i)+d/2);
    a.project(cam);b.project(cam);projected[axis]=Math.hypot((b.x-a.x)*400,(b.y-a.y)*300);
   }
   result.push({projection,dir,wantedDashCssPx:dashPx,worldDash:d,projectedDashCssPx:projected});
  }
 }
 writeFileSync('../evidence/viewer-palette-fest.r44.dashes.json',JSON.stringify(result,null,2));
});

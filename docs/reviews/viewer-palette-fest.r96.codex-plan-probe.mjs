import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {writeFileSync} from 'node:fs';
// An inner cuboid is encoded at +45 degrees in its local frame and posed
// at -45 degrees. Its actual geometry fits; a transformed LOCAL AABB does not.
const g=new THREE.BoxGeometry(2,.2,.2).rotateZ(Math.PI/4);g.computeBoundingBox();
const matrix=new THREE.Matrix4().makeRotationZ(-Math.PI/4);
const transformedLocalBox=g.boundingBox.clone().applyMatrix4(matrix);
const exact=new THREE.Box3().setFromBufferAttribute(g.clone().applyMatrix4(matrix).getAttribute('position'));
const outer=new THREE.Box3(new THREE.Vector3(-1.05,-1.05,-1.05),new THREE.Vector3(1.05,1.05,1.05));
const box={actual:exact.toJSON?.()??{min:exact.min.toArray(),max:exact.max.toArray()},transformedLocalBox:{min:transformedLocalBox.min.toArray(),max:transformedLocalBox.max.toArray()},actualFits:outer.containsBox(exact),planPrefilterPasses:outer.containsBox(transformedLocalBox)};
const cube=new THREE.BoxGeometry(2,2,2);const bvh=new MeshBVH(cube);
const directions=[[1,1,.213],[.317,1,1],[1,.411,1]];
const rays=directions.map(d=>{const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(...d).normalize());const hits=bvh.raycast(ray,THREE.DoubleSide);return {direction:d,triangles:hits.length,distances:hits.map(h=>h.distance),naiveInside:hits.length%2===1};});
const result={box,rays,allRaysAgreeOutside:rays.every(r=>!r.naiveInside),analyticCubeCenterInside:true};
writeFileSync('../evidence/viewer-palette-fest.r96.codex-plan-geometry.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));

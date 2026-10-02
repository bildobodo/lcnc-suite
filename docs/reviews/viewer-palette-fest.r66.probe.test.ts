import { it, expect } from 'vitest';
import * as THREE from '../lcnc-webui/node_modules/three/build/three.module.js';
import { writeFileSync } from 'node:fs';
import { buildChains } from '../lcnc-webui/src/viewer/geoDash';
import { makeBoxEdges, makeBoxTicks, TICK_ARM_PX } from '../lcnc-webui/src/viewer/boxLines';

it('R66: returning chains at a junction keep their phase when storage is reversed', () => {
  // Two square contours sharing one vertex (degree four there). Each
  // contour is a chain from that junction back to that same junction.
  const segs = [
    [0,0,0, 1,0,0], [1,0,0, 1,1,0], [1,1,0, 0,1,0], [0,1,0, 0,0,0],
    [0,0,0, -1,0,0], [-1,0,0, -1,-1,0], [-1,-1,0, 0,-1,0], [0,-1,0, 0,0,0],
  ];
  const measure = (ss: number[][]) => {
    const ch = buildChains(ss.flat());
    const out = ss.map((s,i) => {
      const a=s.slice(0,3), b=s.slice(3), forward=a.join(',') < b.join(',');
      const lo=forward ? a : b, hi=forward ? b : a;
      const ta=ch.t[2*i+(forward ? 0 : 1)]!, tb=ch.t[2*i+(forward ? 1 : 0)]!;
      const t=ta+(tb-ta)*0.37;
      return { edge:[lo,hi], tAtSample:t, toneAtN16:Math.floor(t*16)%2 };
    }).sort((a,b)=>JSON.stringify(a.edge).localeCompare(JSON.stringify(b.edge)));
    return { count:ch.count, out };
  };
  const first=measure(segs), reversed=measure(segs.slice().reverse());
  const changed=first.out.filter((v,i)=>v.toneAtN16!==reversed.out[i]!.toneAtN16).length;
  writeFileSync('../evidence/viewer-palette-fest.r66.chains.json',JSON.stringify({first,reversed,changed},null,2));
  expect(reversed.out).toEqual(first.out);
});

it('R66: end marks stay ten CSS px near the perspective viewport edge', () => {
  const W=1000,H=600;
  const camera=new THREE.PerspectiveCamera(45,W/H,0.1,1000);
  camera.updateProjectionMatrix();camera.updateMatrixWorld();
  const box=makeBoxEdges([1,1,1],{color:'#15181c',alt:'#f0f2f4',width:1,role:'toolpathBounds'});
  box.position.set(2.4,0,-5);
  const ticks=makeBoxTicks({dark:'#15181c',light:'#f0f2f4',role:'toolpathBounds'});
  box.add(ticks);box.updateMatrixWorld(true);
  ticks.pose(box,camera,W,H);ticks.updateMatrixWorld(true);
  const screen=(p:number[])=>{
    const v=new THREE.Vector3(...p as [number,number,number]).project(camera);
    return [(v.x+1)/2*W,(1-v.y)/2*H,v.z];
  };
  const bars=ticks.worldSegments().map((s,i)=>{
    const a=screen(s.slice(0,3)), b=screen(s.slice(3));
    const inside=[a,b].every(p=>p[0]!>=0&&p[0]!<=W&&p[1]!>=0&&p[1]!<=H&&Math.abs(p[2]!)<=1);
    return {i,a,b,inside,length:Math.hypot(b[0]!-a[0]!,b[1]!-a[1]!)};
  }).filter(s=>s.inside&&s.length>0.1);
  const max=Math.max(...bars.map(s=>s.length));
  writeFileSync('../evidence/viewer-palette-fest.r66.tick-size.json',JSON.stringify({W,H,eye:[0,0,0],box:[2.4,0,-5],target:2*TICK_ARM_PX,bars,max},null,2));
  expect(bars.length).toBeGreaterThanOrEqual(18);
  expect(max).toBeCloseTo(2*TICK_ARM_PX,0);
});

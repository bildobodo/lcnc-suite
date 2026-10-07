import {test,expect} from '@playwright/test';
import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
test('Vite source worker loads its children and answers a side request',async({page},info)=>{
 const g=new THREE.BoxGeometry(4,4,4).toNonIndexed(),positions=Array.from(g.getAttribute('position').array);g.dispose();
 await page.goto('http://127.0.0.1:4189/r90-worker.html');
 const data=await page.evaluate(async(positions)=>{
  const worker=new Worker('/src/viewer/collisionWorker.ts?worker_file&type=module',{type:'module'});
  const messages:any[]=[],errors:string[]=[],waiters=new Map<number,(m:any)=>void>();
  worker.onmessage=e=>{messages.push(e.data);if(e.data.result||e.data.error||e.data.needBodies)waiters.get(e.data.id)?.(e.data);};
  worker.onerror=e=>errors.push(e.message);
  const machine={groups:[{id:'frame',parent:'root'},{id:'slide',parent:'root'}],kinematics:[{group:'slide',joint:0,type:'translate',direction:'x',sign:1}],workGroup:'frame',toolGroup:'slide',unitScale:1,axes:['X','Y','Z']};
  const req={id:1,modelKey:'r90-native-dev',machine,bodies:[{id:'fixed',group:'frame',positions:new Float32Array(positions)},{id:'slide',group:'slide',positions:new Float32Array(positions),tool:true}],tool:null,
   track:{pos:new Float32Array([10,0,0,-10,0,0]),abc:new Float32Array(6),lines:new Uint32Array([1,2]),rapid:new Uint8Array([1,1]),cum:new Float32Array([0,20]),count:2},wcs:{g5x:[],g92:[],rotationDeg:0},options:{margin:2},maxShards:3};
  const wait=(id:number)=>new Promise<any>((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('No result: '+id+'; errors: '+errors.join(','))),20000);waiters.set(id,m=>{clearTimeout(timeout);resolve(m);});});
  let pending=wait(1);worker.postMessage(req);const main=await pending;
  pending=wait(-1);worker.postMessage({...req,id:-1,side:true,bodies:undefined});const side=await pending;
  worker.terminate();return {main,side,messages,errors,cores:navigator.hardwareConcurrency};
 },positions);
 writeFileSync('../evidence/viewer-palette-fest.r90.dev-'+info.project.name+'.json',JSON.stringify(data,null,2)+'\n');
 expect(data.errors).toEqual([]);expect(data.main.error).toBeUndefined();expect(data.main.result.hits.some((h:any)=>h.line===2&&h.dist<=1e-4)).toBe(true);
 if(data.cores>=3)expect(data.main.result.shards).toBeGreaterThan(1);
 expect(data.side.error).toBeUndefined();expect(data.side.result.hits.some((h:any)=>h.line===2&&h.dist<=1e-4)).toBe(true);
});

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { latheColumns, latheSize } from './latheColumns';
const F32=globalThis.Float32Array,U16=globalThis.Uint16Array,U32=globalThis.Uint32Array;
const raw=new WeakMap<object,any>();
function makeTrack(C:any, onWrite:()=>void) {
 return new Proxy(C,{construct(target,args){const a=Reflect.construct(target,args);const p=new Proxy(a,{get(t,k){const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;},set(t,k,v){if(typeof k==='string'&&/^\d+$/.test(k))onWrite();return Reflect.set(t,k,v,t);}});raw.set(p,a);return p;}});
}
const cases=[[600,512],[131,499],[128,511],[800,499],[2000,199],[2048,194]];
const records:any[]=[];
for (const [n,s] of cases) {
 const prof=new F32(2*n);for(let j=0;j<n;j++){prof[2*j]=j===0||j===n-1?0:3;prof[2*j+1]=j;}
 let floats=0,inds=0,maxV=0,maxI=0,steps=0,out:any,counts:any[]=[];
 (globalThis as any).Float32Array=makeTrack(F32,()=>floats++);
 (globalThis as any).Uint16Array=makeTrack(U16,()=>inds++);
 (globalThis as any).Uint32Array=makeTrack(U32,()=>inds++);
 try {
  const g=latheColumns(prof,s);
  for(;;){floats=inds=0;const r=g.next(); maxV=Math.max(maxV,floats/6);maxI=Math.max(maxI,inds);steps++;if(floats||inds)counts.push([floats/6,inds]);if(r.done){out=r.value;break;}}
 } finally {globalThis.Float32Array=F32;globalThis.Uint16Array=U16;globalThis.Uint32Array=U32;}
 const pos=raw.get(out.positions),norm=raw.get(out.normals),idx=raw.get(out.index);
 const buffers=[...new Set([pos.buffer,norm.buffer,idx.buffer])]; const bytes=buffers.reduce((z,b)=>z+b.byteLength,0);
 const size=latheSize(n,s);
 assert.equal(pos.length,3*size.v);assert.equal(norm.length,pos.length);assert.equal(idx.length,size.i);
 assert.equal(bytes,24*size.v+idx.BYTES_PER_ELEMENT*size.i);assert(size.i<6*size.v);assert(bytes<=19_200_000);assert(size.v<=400_000);
 let equal=null;
 if(n<=131){const ref=new THREE.LatheGeometry(Array.from({length:n},(_,j)=>new THREE.Vector2(prof[2*j],prof[2*j+1])),s);const swap=(a:any)=>{for(let i=0;i<a.length;i+=3){const y=a[i+1];a[i+1]=-a[i+2];a[i+2]=y;}};const p=ref.getAttribute('position').array,q=ref.getAttribute('normal').array;swap(p);swap(q);equal={positions:p.every((v,i)=>Object.is(v,pos[i])),normals:q.every((v,i)=>Object.is(v,norm[i])),index:ref.index!.array.every((v,i)=>v===idx[i]),indexType:ref.index!.array.constructor===idx.constructor};assert(Object.values(equal).every(Boolean));ref.dispose();}
 records.push({n,s,...size,bytes,indexBytes:idx.BYTES_PER_ELEMENT,maxVerticesBetweenYields:maxV,maxIndexWritesBetweenYields:maxI,steps,equal});
}
assert.equal(records[0].bytes,14_747_712);assert.equal(records[4].maxVerticesBetweenYields,6000);
console.log(JSON.stringify({cases:records,formulaBound:48*400_000,meridianMaxBytes:2048*2*8,notes:['Byte and equality assertions pass.','Prototype 2000 x 199 is admitted at 400000 vertices, but writes 6000 vertices between yields. The plan requires <=4096; implementation guard still owed.']}));

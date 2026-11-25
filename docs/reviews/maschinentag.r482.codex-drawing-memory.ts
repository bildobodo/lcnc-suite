import { canonProfile, latheSector } from './hull7';
import { latheDraw } from './timing7';
// All admission limits in plan v7: native profile < 2048 points,
// per-tool canonical bytes far below 64 MB, drawn vertices < 400000.
const n=600,segments=512;
const pts=Array.from({length:n},(_,i)=>({x:i===0||i===n-1?0:1000,y:i}));
const prof=canonProfile(pts);
const g=latheSector(prof,0,segments,segments);
const attributes=Object.fromEntries(Object.entries(g.attributes).map(([name,attr]:any)=>
 [name,{count:attr.count,itemSize:attr.itemSize,bytes:attr.array.byteLength}]));
const idx=g.getIndex()!;
const arrays=Object.values(g.attributes).map((a:any)=>a.array).concat([idx.array]);
const buffers=new Set(arrays.map(a=>a.buffer));
const bytes=[...buffers].reduce((s,b)=>s+b.byteLength,0);
const full={profilePoints:n,canonicalBytes:prof.byteLength,segments,
 vertices:g.getAttribute('position').count,triangles:idx.count/3,attributes,
 index:{count:idx.count,bytes:idx.array.byteLength},uniqueBufferBytes:bytes,
 planDrawingBytes:14400000,overPlanBytes:bytes-14400000,
 finitePositions:Array.from(g.getAttribute('position').array).every(Number.isFinite)};
g.dispose();
process.env.SECTOR='4096';
const build=latheDraw(prof,segments);
let merged:any, yields=0;
for(;;){const result=build.next();if(result.done){merged=result.value;break;}yields++;}
const fields=Object.fromEntries(Object.entries(merged).map(([k,a]:any)=>[k,{length:a.length,bytes:a.byteLength}]));
const sum=Object.values(merged).reduce((s:number,a:any)=>s+a.byteLength,0);
console.log(JSON.stringify({full,sectors:{profilePoints:n,canonicalBytes:prof.byteLength,
 segmentColumns:segments,sectorBudget:4096,vertices:merged.positions.length/3,
 fields,uniqueBufferBytes:sum,planDrawingBytes:14400000,overPlanBytes:sum-14400000,
 yields,admittedProfile:n<=2048,admittedVertices:merged.positions.length/3<=400000,
 note:'Returned arrays only: no temporary sector arrays, JS heap objects or GPU buffers counted'}},null,2));

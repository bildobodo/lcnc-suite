import assert from 'node:assert/strict';
import { fedOver, fs, CAP, type FedTrack } from './fedpath2';
// Independent interval-union reference. It does not use the candidate's greedy walk.
function ref(t: FedTrack, seg: number, u: number, axis: number): boolean {
  const p=(i:number)=>t.pos[i*3+axis]!;
  const direction=Math.sign(p(seg)-p(seg-1));
  const top=p(seg-1)+(p(seg)-p(seg-1))*u;
  let end=p(seg);
  for(let i=seg+1;i<t.count&&t.rapid[i];i++) end=direction>0?Math.max(end,p(i)):Math.min(end,p(i));
  const required=[Math.min(top,end),Math.max(top,end)];
  const intervals:number[][]=[];
  for(let i=(t.depEnd??0)+1;i<seg;i++) if(!t.rapid[i]) intervals.push([Math.min(p(i-1),p(i)),Math.max(p(i-1),p(i))]);
  intervals.sort((a,b)=>a[0]!-b[0]!);
  let cursor=required[0]!;
  for(const [l,h] of intervals) { if(l!>cursor) return false; if(h!>cursor) cursor=h!; if(cursor>=required[1]!) return true; }
  return false;
}
function track(z:number[], rapid:number[],axis=2):FedTrack {
  const pos=new Float32Array(z.length*3),abc=new Float32Array(z.length*3);
  for(let i=0;i<z.length;i++){pos.set([40,30,20],i*3);pos[i*3+axis]=z[i]!;abc.set([17,23,31],i*3);}
  return {pos,abc,rapid:Uint8Array.from(rapid),count:z.length};
}
let rngState=0x488;const random=()=>{rngState=(Math.imul(rngState,1664525)+1013904223)>>>0;return rngState/4294967296;};
const counts=Array.from({length:6},()=>({positive:0,negative:0,excused:0,conservative:0}));
for(let sample=0;sample<60000;sample++){
  const axis=sample%3,dir=sample%2?1:-1,n=4+Math.floor(random()*28);
  const z=Array.from({length:n},()=>Math.floor(random()*81)-40),rapid=Array.from({length:n},()=>random()<.5?1:0);
  const candidates=[];for(let i=1;i<n;i++)if(rapid[i]&&Math.sign(z[i]!-z[i-1]!)===dir)candidates.push(i);
  if(!candidates.length)continue;
  const seg=candidates[Math.floor(random()*candidates.length)]!,t=track(z,rapid,axis);
  t.depEnd=Math.floor(random()*seg);
  const steps=Math.abs(z[seg]!-z[seg-1]!),u=Math.floor(random()*steps)/steps;
  const want=ref(t,seg,u,axis),got=fedOver(t,seg,u),row=counts[axis*2+(dir>0?1:0)]!;
  assert(!got||want,JSON.stringify({z,rapid,seg,u,axis,dir,depEnd:t.depEnd}));
  row[want?'positive':'negative']++;if(got)row.excused++;else if(want)row.conservative++;
}
console.log(JSON.stringify({case:'full_union_reference',counts,total:counts.reduce((n,r)=>n+r.positive+r.negative,0)}));
let checks=0;
for(const axis of [0,1,2])for(const direction of [-1,1]){
  const make=()=>track([5,-6,5,-5,-8,5].map(x=>direction*x),[1,0,1,1,0,1],axis);
  const t=make();assert.equal(fedOver(t,3,.4),true);checks++;
  t.depEnd=1;assert.equal(fedOver(t,3,.4),false);checks++;
  for(const key of ['tlo','wcs','mode','frame','cond','brk','ustart','band','unpredicted'] as const){
    const v=make();(v as any)[key]=new Uint32Array(v.count);(v as any)[key][2]=1;
    assert.equal(fedOver(v,3,.4),false,key);checks++;
  }
  const v=make();v.pos[3*3+(axis+1)%3]+=0.00005;assert.equal(fedOver(v,3,.4),false);checks++;
}
// A distant, otherwise valid previous feed exactly at / beyond the backward budget.
for(const distance of [CAP,CAP+1]){
  const seg=distance+1,z=[5,-6,...Array(distance-1).fill(5),-5],r=[1,0,...Array(distance-1).fill(1),1];
  const t=track(z,r);assert.equal(t.count,seg+1);assert.equal(fedOver(t,seg,.4),distance===CAP);checks++;
}
console.log(JSON.stringify({case:'basis_floor_lateral_cap',CAP,checks,stats:fs}));

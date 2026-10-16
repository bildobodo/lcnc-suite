import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { eachPieceSteps, pieceFrom, unionReach, unionScratch, NO_SEPARATORS, type UnionSide, type UnionPiece } from './contactUnion';
import { runToEnd } from './steps';

type Iv = { a:number; b:number; w:number; p?:number; r?:number; ed?:boolean; xd?:boolean };
function side(ivs:Iv[]):UnionSide {
 const reach=unionReach(ivs.length,k=>ivs[k]!.a,k=>ivs[k]!.p??NaN,k=>ivs[k]!.r??0,()=>true);
 return {n:ivs.length,enter:k=>ivs[k]!.a,end:k=>ivs[k]!.b,witness:k=>ivs[k]!.w,
  open:()=>false,enterDecided:k=>ivs[k]!.ed!==false,exitDecided:k=>ivs[k]!.xd!==false,afterTool:()=>false,
  freeAt:k=>ivs[k]!.p??NaN,freeR:k=>ivs[k]!.r??0,back:reach.back,front:reach.front};
}
const contains=(p:UnionPiece,x:number)=>(p.start<x||(p.start===x&&!p.startOpen))&&(p.end>x||(p.end===x&&!p.endOpen));
const bounds=(p:UnionPiece)=>[p.start,p.startOpen,p.end,p.endOpen,p.startKind,p.startSide,p.startIdx];
const summary={cases:0,confirmedPoints:0,freeSamples:0,queriedPieces:0,scales:[] as number[],seed:0x163c0de};
function check(gs:Iv[][],label:string){
 const sides=gs.map(side), ps:UnionPiece[]=[],local=[true,true];
 runToEnd(eachPieceSteps(sides,NO_SEPARATORS,p=>{ps.push({...p});},undefined,unionScratch(),{n:0},undefined,(si,_j,_front,_back,ok)=>{local[si]=local[si]&&ok;}));
 const points=gs.flatMap(g=>g.flatMap(iv=>[iv.w,...(iv.ed!==false?[iv.a]:[]),...(iv.xd!==false?[iv.b]:[])]));
 for(const x of points){
  expect(ps.some(p=>contains(p,x)),label+' confirmed '+x).toBe(true);summary.confirmedPoints++;
 }
 expect(local,label+' exact structure').toEqual([true,true]);
 for(const g of gs)for(const iv of g){
  if(iv.p===undefined||points.includes(iv.p))continue;
  expect(ps.some(p=>contains(p,iv.p!)),label+' free '+iv.p).toBe(false);summary.freeSamples++;
 }
 // Ask via both paths. No second implementation of the cut rule: check
 // that the independently computed answers name precisely the built pieces.
 for(const useLocal of [false,true]){
  const ss=sides.map((s,i)=>({...s,local:useLocal?local[i]:false}));
  let p=pieceFrom(ss,NO_SEPARATORS,0,-Infinity);
  for(const built of ps){
   expect(p,label+' query exists').not.toBeNull();
   expect(bounds(p!),label+' build/query, local='+useLocal).toEqual(bounds(built));summary.queriedPieces++;
   p=pieceFrom(ss,NO_SEPARATORS,0,p!.end,p!.endOpen);
  }
  expect(p,label+' no additional piece').toBeNull();
 }
 summary.cases++;
}
it('confirmed points survive decimal cuts at either end, across scales, translations, and generations',()=>{
 const bases:Iv[][][]=[
  [[{a:0,b:.1,w:.1,p:.9,r:.8},{a:2,b:2.5,w:2.25}],[{a:0,b:2.5,w:2.4,ed:false,xd:false}]],
  [[{a:-1,b:-.9,w:-.95,p:.3,r:.7},{a:.9,b:1.5,w:.9}],[{a:-1,b:1.5,w:-1,ed:false,xd:false}]],
 ];
 for(const e of [-24,-10,-1,0,1,10,30]){
  const s=2**e;summary.scales.push(s);
  for(const shift of [-3.7,-1.1,-.1,0,.1,.3,1.1,7.7])for(let b=0;b<bases.length;b++)for(const swap of [false,true]){
   const gs=bases[b]!.map(g=>g.map(iv=>({...iv,a:(iv.a+shift)*s,b:(iv.b+shift)*s,w:(iv.w+shift)*s,
     p:iv.p===undefined?undefined:(iv.p+shift)*s,r:iv.r===undefined?undefined:Math.fround(iv.r*s)})));
   if(swap)gs.reverse();check(gs,`base=${b} e=${e} shift=${shift} swap=${swap}`);
  }
 }
 let seed=summary.seed;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let t=0;t<500;t++){
  const a=rand()*100, gap=.001+rand()*3, b=a+.1+rand(), p=b+gap, next=p+.001+rand()*3, end=next+.1+rand();
  const h:Iv[]=[{a,b,w:rand()<.5?b:(a+b)/2,p,r:Math.fround((rand()<.5?gap:next-p)*(1+rand()*.5))},{a:next,b:end,w:rand()<.5?next:(next+end)/2}];
  const c:Iv[]=[{a,b:end,w:rand()<.2?p:(rand()<.5?a:end),ed:false,xd:false}];
  check(t%2?[h,c]:[c,h],`random ${t}`);
 }
 writeFileSync(`${process.env.R163_OUT}/points.json`,JSON.stringify(summary,null,2)+'\n');
});

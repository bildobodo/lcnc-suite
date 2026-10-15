import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {eachPieceSteps,NO_SEPARATORS,unionScratch,type UnionSide} from './contactUnion';
import {runToEnd} from './steps';
it('reports capacities retained across groups with opposite large sides',()=>{
 const n=4095,sc=unionScratch();
 const side=(count:number):UnionSide=>({n:count,enter:k=>4*k,end:k=>4*k+1,open:()=>false,witness:k=>4*k+.5,enterDecided:()=>true,exitDecided:()=>true,afterTool:()=>false,freeAt:k=>4*k+2,freeR:()=>.1,back:0,front:0});
 runToEnd(eachPieceSteps([side(n),side(1)],NO_SEPARATORS,()=>{},undefined,sc));
 runToEnd(eachPieceSteps([side(1),side(n)],NO_SEPARATORS,()=>{},undefined,sc));
 const seen=new Set<ArrayBufferLike>();let actual=0;
 const visit=(x:unknown)=>{if(ArrayBuffer.isView(x)){if(!seen.has(x.buffer)){seen.add(x.buffer);actual+=x.buffer.byteLength;}}else if(x&&typeof x==='object')for(const y of Object.values(x))visit(y);};visit(sc);
 const out={maxIntervalsInOneGroup:n+1,sideCapacities:sc.sides.map(x=>x.enter.length),combinedFreeCapacity:sc.fLo.length,scratchBytes:actual,formula84TimesLargestGroup:84*(n+1)};
 writeFileSync(`${process.env.R159_OUT}/scratch.json`,JSON.stringify(out,null,2)+'\n');
 expect(out.sideCapacities).toEqual([n,n]);expect(actual).toBeGreaterThan(out.formula84TimesLargestGroup);
});

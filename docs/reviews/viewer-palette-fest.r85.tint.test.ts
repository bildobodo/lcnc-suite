
import {it,expect} from 'vitest';
import {clashTintBodies} from './clashTint';
import type {CollisionHit} from './collision';
import {writeFileSync} from 'node:fs';
const h=(a:string,b:string,line:number,cum:number,cumEnd:number,rest:Partial<CollisionHit>={}):CollisionHit=>({a,b,line,cum,cumEnd,dist:0,rapid:false,...rest});
it('R85: shared bodies remain on, clear gaps and ends turn off, input order never changes the set',()=>{
 const hits=[h('column','saddle',1,0,2,{intervals:[[0,2]],spanCumEnd:50}),h('column','cover',20,20,30,{intervals:[[20,22],[28,30]]}),h('column','saddle',21,23,26,{dist:1.5}),h('column','tool',0,40,45,{continuation:0,intervals:[[40,45]]})];
 const cases=[{line:20,cum:21,expect:['column','cover','saddle']},{line:20,cum:25,expect:['column','saddle']},{line:21,cum:25,expect:[]},{line:0,cum:42,expect:['column','saddle','tool']},{line:99,cum:51,expect:[]}];
 const rows=cases.map(c=>({...c,got:[...clashTintBodies(hits,c.line,c.cum)].sort()}));
 writeFileSync('../evidence/viewer-palette-fest.r85.tint.json',JSON.stringify(rows,null,2)+'\n');
 for(const c of rows){expect(c.got).toEqual(c.expect);expect([...clashTintBodies([...hits].reverse(),c.line,c.cum)].sort()).toEqual(c.expect);}
});

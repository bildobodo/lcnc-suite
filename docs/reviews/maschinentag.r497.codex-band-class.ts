import {start, findings, digest} from './src/viewer/stockMuteHarness';
const results=[];
for (const approach of ['rapid','feed'] as const) for (const band of [false,true]) for (const near of [.05,.5,1,1.9]) for (const depth of [.108,2]) {
 const p=start();p.move(approach==='rapid',{z:near});
 p.band=band;p.g1({z:-depth});p.band=false;p.g0({z:-5}).g0({z:15});
 const r=findings(p.track());
 results.push({approach,band,near,depth,wantCollisions:band?1:0,got:r.collisions,list:r.list,table:digest(r.st)});
}
console.log(JSON.stringify({pass:results.filter(x=>x.wantCollisions===x.got).length,fail:results.filter(x=>x.wantCollisions!==x.got).length,results},null,2));
if(results.some(x=>x.wantCollisions!==x.got))process.exitCode=1;

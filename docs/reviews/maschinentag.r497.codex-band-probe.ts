import {start, findings, digest} from './src/viewer/stockMuteHarness';
const results=[];
for (const approach of ['rapid','feed'] as const) for (const band of [false,true]) {
 const p=start();
 p.move(approach==='rapid',{z:1});
 p.band=band; p.g1({z:-2});p.band=false;p.g0({z:-5}).g0({z:15});
 const r=findings(p.track());
 results.push({approach,band,wantCollisions:band?1:0,got:r.collisions,list:r.list,table:digest(r.st),points:p.pts});
}
console.log(JSON.stringify(results,null,2));
if (results.some(x=>x.wantCollisions!==x.got)) process.exitCode=1;

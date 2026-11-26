import { pathsProgram, findings, canonical, canonicalDiff, SHARD_TOL } from './src/viewer/stockMuteHarness';
import { ContactStore, NONE, type ColumnTable } from './src/viewer/contactStore';

const base = findings(pathsProgram().track(), { stocks: 4 }).st;
const want = canonical([base]);
const changes: Array<[string,(s:ContactStore)=>void]> = [
  ['R500 back-reference',s=>s.intervals.set(0,'episode',5)],
  ['R500 foreign first',s=>s.episodes.set(4,'firstIv',1)],
  ['R500 foreign next',s=>s.intervals.set(0,'next',5)],
  ['first beyond rows',s=>s.episodes.set(4,'firstIv',s.intervals.rows)],
  ['next beyond rows',s=>s.intervals.set(0,'next',s.intervals.rows)],
  ['self cycle',s=>s.intervals.set(0,'next',0)],
  ['two-row cycle',s=>s.intervals.set(4,'next',0)],
  ['chain cut short',s=>s.intervals.set(0,'next',NONE)],
  ['wrong count',s=>s.episodes.set(4,'ivCount',3)],
  ['orphan interval',s=>s.intervals.append(Object.fromEntries(s.intervals.schema.map(([k])=>[k,s.intervals.get(0,k)])))],
  ['owner beyond episodes',s=>s.intervals.set(0,'episode',s.episodes.rows)],
];
const cases=changes.map(([name,mutate])=>{
  const s=base.copy(); mutate(s);
  const got=canonical([s]);
  return {name,broken:got.broken,exact:canonicalDiff(want,got),bounded:canonicalDiff(want,got,SHARD_TOL),
    invalidAgainstItself:canonicalDiff(got,got)};
});
// Renumber both tables while preserving each pair's episode order and chain.
// The four near episodes still precede that pair's contact episode.
const permE=[3,2,1,0,7,6,5,4], permI=[7,6,5,4,3,2,1,0];
const reindexed=new ContactStore(2,0);
function copyRows(src:ColumnTable,dst:ColumnTable,oldOrder:number[],refs:Record<string,(v:number)=>number>){
  for(const old of oldOrder) dst.append(Object.fromEntries(src.schema.map(([k])=>{
    const v=src.get(old,k);return [k,refs[k]?refs[k]!(v):v];
  })));
}
copyRows(base.episodes,reindexed.episodes,permE,{firstIv:v=>v===NONE?v:permI.indexOf(v)});
copyRows(base.intervals,reindexed.intervals,permI,{episode:v=>permE.indexOf(v),next:v=>v===NONE?v:permI.indexOf(v)});
const controls={
  intact:canonicalDiff(want,canonical([base.copy()])),
  reindexed:canonicalDiff(want,canonical([reindexed])),
  reindexedBounded:canonicalDiff(want,canonical([reindexed]),SHARD_TOL),
  empty:canonicalDiff(canonical([new ContactStore(3,0)]),canonical([new ContactStore(4,0)]))
};
const pass=cases.every(c=>c.broken.length&&c.exact.length&&c.bounded.length&&c.invalidAgainstItself.length)
  &&Object.values(controls).every(c=>c.length===0);
console.log(JSON.stringify({head:'dbd14cab',pass,cases,controls},null,2));
if(!pass)process.exitCode=1;

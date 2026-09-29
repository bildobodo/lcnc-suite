// R35: the requested continuation policy, including a later independent interval.
import {test,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {mergeEntryResult} from '../src/viewer/sweepMerge';
import {clashTargets} from '../src/viewer/clashTargets';
import {sampleCum,targetAfter,targetBefore} from '../src/viewer/findingNav';
import type {CollisionHit,CollisionResult} from '../src/viewer/collision';
const res=(hits:CollisionHit[]):CollisionResult=>({hits,staticContacts:[],samples:0,coarsened:false,uncertified:null,pairCount:2,pairsPrescreened:0,bvhMs:0,sweepMs:0,truncated:null});
const entry=res([{line:7,cum:2,cumEnd:10,intervals:[[2,10]],a:'tool',b:'work',dist:0,rapid:true}]);
const other:CollisionHit={line:9,cum:50,cumEnd:55,intervals:[[50,55]],a:'holder',b:'fixture',dist:0,rapid:false};
test('a merged continuously open contact falls back to position: next later finding, previous entry onset',()=>{
 const base=res([{line:7,cum:0,cumEnd:4,intervals:[[0,4]],a:'tool',b:'work',dist:0,rapid:false},other]);
 const chosen=clashTargets(base.hits)[0]!;
 const merged=mergeEntryResult(entry,base,10,80),targets=clashTargets(merged.hits);
 const pos=10+sampleCum(chosen),sel={key:chosen.key,pos};
 const next=targetAfter(targets,pos,sel)!,prev=targetBefore(targets,pos,sel)!;
 writeFileSync('../evidence/r35.merge-continuous.json',JSON.stringify({entry,base,merged,targets,pos,sel,next,prev},null,2)+'\n');
 expect(targets).toHaveLength(2);expect(next.cum).toBe(60);expect(prev.entry).toBe(true);expect(prev.cum).toBe(2);
});
test('a later interval on the same program record survives merging only the initial continuous interval',()=>{
 const base=res([{line:7,cum:0,cumEnd:30,intervals:[[0,4],[20,30]],a:'tool',b:'work',dist:0,rapid:false},other]);
 const merged=mergeEntryResult(entry,base,10,80),targets=clashTargets(merged.hits);
 writeFileSync('../evidence/r35.merge-intervals.json',JSON.stringify({entry,base,merged,targets},null,2)+'\n');
 expect(targets.some(t=>!t.entry&&t.cum===30),'The second program onset at 20 shifts to 30 and remains navigable').toBe(true);
 expect(targets).toHaveLength(3);
});

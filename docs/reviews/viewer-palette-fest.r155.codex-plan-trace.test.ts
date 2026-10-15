// R155 PLAN trace, not a test of an implemented Form 1 scheduler.
// The storage/view operations are production code at bb2214c0. The order is
// section 3.6 read literally: publish B, retire P, before catching P up a
// fallback retains B; the old-generation drain then writes B again.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ContactStore, NONE } from './contactStore';
import { buildContactView, targetPos } from './contactView';
const add = (s: ContactStore, at: number) => {
  const ep=s.episodes.append({pair:at,ordinal:0,onset:at,end:at+1,closeAt:at,closeDist:0,firstIv:s.intervals.rows,ivCount:1});
  s.intervals.append({episode:ep,enter:at,exit:at+1,next:NONE,witness:at,freeAt:NaN});
};
const view=(s:ContactStore)=>buildContactView({sources:[{stores:[s],at:c=>c}],pairName:p=>({a:'tool',b:`body${p}`}),coverage:20});
it('documents why a post-publication fallback cannot drain into the currently displayed B',()=>{
  const sender=new ContactStore(155,0),P=new ContactStore(155,0),B=new ContactStore(155,0);
  add(sender,1);const first=sender.takeDelta(true)!;P.apply(first);B.apply(first);sender.ack();
  const oldView=view(P);
  add(sender,3);const d1=sender.takeDelta(true)!;B.apply(d1);
  const shown=view(B); // publish B; the plan retires oldView here
  expect([oldView.n,shown.n,targetPos(shown,1)]).toEqual([1,2,3]);
  // Fallback arrives before P has caught up. The sender has one additional
  // contact not in the owner's in-flight delta yet: the old-generation drain.
  add(sender,5);sender.ack();const drain=sender.takeDelta(true)!;
  const held=B;held.apply(drain);
  expect(()=>targetPos(shown,1)).toThrow(/tables changed/);
  writeFileSync('/tmp/codex-r155-r1lqnetr/plan-trace.json',JSON.stringify({
    commit:'bb2214c0',scope:'Literal plan ordering with real store/view primitives; Form 1 is not implemented',
    order:['P shows one contact; B matches P','D1 applied only to B; B has two contacts',
      'publish view(B); retire view(P), catch-up not started','fallback: B becomes held, acknowledge D1',
      'old generation drains D2 into held B; B has three contacts','query displayed view(B) throws tables changed'],
    oldPContacts:P.episodes.rows,heldBContacts:held.episodes.rows,displayedQuery:'throws',
    conclusion:'The post-publication fallback must keep the displayed buffer immutable and finish catch-up into the other buffer before that buffer takes the drain.'
  },null,2)+'\n');
});

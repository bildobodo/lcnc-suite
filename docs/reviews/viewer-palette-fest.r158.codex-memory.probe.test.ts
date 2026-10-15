import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { ContactStore, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE } from './contactStore';
import { ContactPublisher } from './contactPublisher';
import { shownContactViewSteps, type ShownContacts } from './shownContacts';
import { heldBytes, viewCountsSteps, startTargetsSteps, contactBandsSteps, retireView, type ContactView } from './contactView';
import { clashIndexOfView, clashTicksSteps } from './simWindow';
it('counts the current phase-2 view while its real derived-data jobs are still running', () => {
 const queue: Array<() => void> = [], track = {}, n = 8192, end = n * 4;
 const st = new ContactStore(1, 0);
 for (let i=0;i<n;i++) {
  const at=4*i, ep=st.episodes.append({pair:i,ordinal:0,flags:0,onset:at,end:at+1,closeAt:at,closeDist:0,firstIv:NONE,ivCount:1});
  st.episodes.set(ep,'firstIv',st.intervals.append({episode:ep,enter:at,exit:at+1,flags:IV_ENTER_DECIDED|IV_EXIT_DECIDED,next:NONE,witness:at+0.5,freeAt:at+2,freeR:0.1}));
 }
 let resident: ContactView | null = null;
 const p = new ContactPublisher<object,ShownContacts,object>({
  tracks:()=>[track],specOf:()=>({key:'one',ids:[1],spec:{base:{id:1,map:null,coverage:end,ownEnd:end},side:null,axisEnd:end}}),
  *build(_track,spec,tables,held) {
   // The real ThreeViewer callback order, with only a diagnostic reference
   // added. No artificial yield or delay is introduced here.
   const view=yield* shownContactViewSteps(tables,spec as any,undefined,held);
   if(!view)return null;resident=view;
   const lineAt=()=>1, cols=1200, axisEnd=end;
   const counts=yield* viewCountsSteps(view);
   const starts=yield* startTargetsSteps(view);
   const ticks=yield* clashTicksSteps(clashIndexOfView(view,lineAt),cols,axisEnd);
   const bands=yield* contactBandsSteps(view,cols,axisEnd);
   return {view,lineAt,derived:{counts,starts,ticks,bands,cols,axisEnd}};
  },
  viewBytes:sv=>heldBytes(sv.view),retire:sv=>retireView(sv.view),
  effect:()=>{},stage:()=>({}),publish:()=>{},ack:()=>{},owners:()=>new Set([1]),
  schedule:f=>queue.push(f),sliceMs:0,now:()=>0,
 });
 p.receive({id:1,contacts:[st.takeDelta(true)!],contactPairs:Array.from({length:n},(_,i)=>['t'+i,'w'+i])});p.kick();
 for(let k=0;k<100000&&queue.length;k++)queue.shift()!();
 const old=p.viewOf(track)!.view;resident=null;
 p.receive({id:1});p.kick();
 for(let k=0;k<100000&&queue.length&&resident===null;k++)queue.shift()!();
 expect(resident).not.toBeNull();expect(p.phase).toBe(2);expect(p.viewOf(track)!.view).toBe(old);
 const actual=heldBytes(resident!),stats=p.stats();
 writeFileSync(`${process.env.R158_OUT ?? '/tmp/codex-r158-af75xrww'}/memory.json`,JSON.stringify({phase:p.phase,oldViewBytes:heldBytes(old),pendingViewBytes:actual,reported:stats.views},null,2)+'\n');
 expect(stats.views.building,'a fully allocated current view is alive throughout counts/starts/ticks/bands').toBeGreaterThanOrEqual(actual);
});

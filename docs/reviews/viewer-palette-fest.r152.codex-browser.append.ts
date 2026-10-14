
// Codex R152: page + real table receiver + shownContactView, with controlled
// worker messages. No request reaches a real gateway or controller.
import { writeFileSync as r152Write } from 'node:fs';
test('Codex R152: a joined entry contact is not duplicated by base fallback',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript({content:FROM_WIRE_INIT});
 await page.addInitScript(()=>{
  const tap:any={main:null,side:null,deliver:null};(window as any).__r152=tap;
  const Real=window.Worker;
  const Tap=function(url:string|URL,opts?:WorkerOptions){
   const w=new Real(url,opts);if(!/collisionWorker/.test(String(url)))return w;
   let handler:any=null;
   Object.defineProperty(w,'onmessage',{configurable:true,get:()=>handler,set:f=>{handler=f}});
   w.addEventListener('message',e=>handler?.(e));
   tap.deliver=(d:any)=>handler?.(new MessageEvent('message',{data:d}));
   // The controlled sweep owns both requests; no collision-worker replies race it.
   w.postMessage=((m:any)=>{if(m?.track){if(m.side)tap.side=m;else tap.main=m;}}) as any;
   return w;
  } as any;Tap.prototype=Real.prototype;window.Worker=Tap;
 });
 await prepare(page,context,{file:'/r152-join.ngc',version:29151,lines:[1,2],joints:[-100,0,-100,0,0],feed:[[0,0,-100],[10,0,-100]]});
 await expect.poll(()=>page.evaluate(()=>(window as any).__r152.main?.id??null)).not.toBeNull();
 const main=await page.evaluate(()=>{const m=(window as any).__r152.main;return{id:m.id,end:m.track.cum[m.track.count-1]};});
 const pairs=[['spindle_nose','a_yoke_casting']];
 const base=oneContact(main.id,0,0,.3*main.end);
 const hit={line:2,cum:0,cumEnd:.3*main.end,a:pairs[0]![0],b:pairs[0]![1],dist:0,rapid:true,intervals:[[0,.3*main.end]]};
 const result={hits:[hit],staticContacts:[],samples:10,coarsened:false,uncertified:null,pairCount:1,pairsPrescreened:0,bvhMs:0,sweepMs:10,truncated:{covered:.5,reason:'running'}};
 await page.evaluate(({w,id,pairs,result})=>(window as any).__r152.deliver({id,contacts:[(window as any).__fromWire(w)],contactPairs:pairs,progress:.5,partial:result}),{w:wireDelta(base),id:main.id,pairs,result});
 await expect(clashRows(page)).toHaveCount(1);
 await page.locator('.scrubBar').getByRole('checkbox',{name:'Sim'}).check();
 await expect.poll(()=>page.evaluate(()=>(window as any).__r152.side?.id??null)).not.toBeNull();
 const side=await page.evaluate(()=>{const m=(window as any).__r152.side;return{id:m.id,end:m.track.cum[m.track.count-1]};});
 const entry=oneContact(side.id,0,.2*side.end);
 const entryHit={...hit,line:0,cum:.2*side.end,cumEnd:side.end,intervals:[[.2*side.end,side.end]]};
 await page.evaluate(({w,id,pairs,result})=>(window as any).__r152.deliver({id,contacts:[(window as any).__fromWire(w)],contactPairs:pairs,result}),{w:wireDelta(entry),id:side.id,pairs,result:{...result,hits:[entryHit],truncated:null}});
 await expect(clashRows(page)).toHaveCount(1);
 const capture=async()=>({rows:await clashRows(page).evaluateAll(rs=>rs.map(r=>({key:r.getAttribute('data-sim-row'),text:r.textContent}))),summary:await page.locator('.simPanel .simSummary').innerText()});
 const before=await capture();
 await page.evaluate(id=>(window as any).__r152.deliver({id,heldCoverage:{generation:0,covered:[.5]}}),main.id);
 const newBase=new ContactStore(main.id,1);
 // Copy the exact same contact into the new generation, as a rerun does.
 const ep=newBase.episodes.append({pair:0,ordinal:0,flags:4,onset:0,end:.3*main.end,closeAt:0,closeDist:0,firstIv:0,ivCount:1});
 newBase.intervals.append({episode:ep,enter:0,exit:.3*main.end,flags:6,next:0xffffffff,witness:0,freeAt:NaN});
 await page.evaluate(({w,id,pairs})=>(window as any).__r152.deliver({id,contacts:[(window as any).__fromWire(w)],contactPairs:pairs}),{w:wireDelta(newBase),id:main.id,pairs});
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getContacts?.().main?.generation)).toBe(1);
 // The generation switch was observed; let its Vue update and paint finish.
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const after=await capture();
 r152Write('/tmp/codex-r152-706x1qnd/browser-join.json',JSON.stringify({main,side,before,after,errors},null,2)+'\n');
 await page.screenshot({path:'/tmp/codex-r152-706x1qnd/browser-join.png'});
 expect(errors).toEqual([]);
 expect(after.rows,'no additional contact was discovered').toHaveLength(before.rows.length);
});

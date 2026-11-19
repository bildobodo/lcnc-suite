// R412 plan probe: native Space release versus a deferred form swap.
// Exact product base dc9dc3e4; injected candidate lifecycle, not product code.
import {appendFileSync} from 'node:fs';
import {test,expect} from './test';
import {openLayout,PROFILES} from './layout-fixtures';
for(const when of ['none','microtask','task'] as const) test(`R412 Space release ${when}`,async({page},info)=>{
 await openLayout(page,PROFILES[0],{name:'1920-desktop',width:1920,height:1080,touch:false});
 const nav=page.getByRole('button',{name:'Tool Table',exact:true});
 await nav.focus();await expect(nav).toBeFocused();
 await page.evaluate(when=>{
  const old=[...document.querySelectorAll('[data-strip="tool"] button')].find(b=>b.textContent?.trim()==='Tool Table') as HTMLElement;
  const target=old.cloneNode(true) as HTMLElement;target.textContent='Tool T12';target.style.display='none';
  document.querySelector('[data-strip="spindle"]')!.append(target);
  const result={events:[] as string[],swapped:false,clickOld:0,clickNew:0};
  (window as any).__r412=result;
  window.addEventListener('click',e=>{
   if(e.target instanceof Node && old.contains(e.target)){result.events.push('click:old');result.clickOld++;}
   if(e.target instanceof Node && target.contains(e.target)){result.events.push('click:new');result.clickNew++;}
  },true);
  const swap=()=>{
   result.events.push('swap');
   (document.querySelector('[data-strip="tool"]') as HTMLElement).style.display='none';
   target.style.display='';result.swapped=true;
   requestAnimationFrame(()=>{target.focus();result.events.push('focus:new');});
  };
  window.addEventListener('keyup',e=>{
   if(e.code!=='Space')return;result.events.push('keyup');
   if(when==='microtask')queueMicrotask(swap);
   if(when==='task')setTimeout(swap,0);
  },{once:true});
 },when);
 await page.keyboard.down('Space');await page.keyboard.up('Space');
 if(when==='none') await expect.poll(()=>page.evaluate(()=>(window as any).__r412.clickOld)).toBe(1);
 else await expect.poll(()=>page.evaluate(()=>(window as any).__r412.events.includes('focus:new'))).toBe(true);
 const result=await page.evaluate(()=>(window as any).__r412);
 appendFileSync('/tmp/r412/key-release.jsonl',JSON.stringify({browser:info.project.name,when,...result})+'\n');
 expect(result.clickNew).toBe(0);
 if(when!=='microtask')expect(result.clickOld).toBe(1);
});

import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
const OUT='/tmp/codex-r240-9rkrv36t';
const FEED=Array.from({length:30},(_,i)=>[i*3,i%2?20:0,0]);
const TEXT=Array.from({length:34},(_,i)=>i===9?'T3 M6':i===19?'T5 M6':`G1 X${i} F100`).join('\n');
async function prepare(page:Page,context:BrowserContext,seconds:number,vp:string,unknown=false){
 const stats={feedMoves:30,rapidMoves:0,linearMoves:30,arcMoves:0,feedDist:1,rapidDist:0,linearDist:1,arcDist:0,feedTime:seconds,rapidTime:0,totalTime:seconds,feedRates:[100],toolChanges:2,toolsUsed:[3,5],unit:'mm',fileSize:1};
 const data={file:'/r237.ngc',preview_schema:11,feed:FEED,feed_lines:FEED.map((_,i)=>i+3),feed_seq:FEED.map((_,i)=>i+3),
 rapid_rate:1,feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>i*seconds/29)).buffer),stats,
 ...(unknown?{probe_unpredicted:[[20,3,'length',10]]}: {})};
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(data))}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:TEXT}));
 await openLayout(page,PROFILES[1],VIEWPORTS.find(v=>v.name===vp)!);
 await ctl({op:'status_delta',data:{active_file:'/r237.ngc',enabled:false,is_enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:7237,file:'/r237.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible({timeout:15000});
 await page.getByRole('tab',{name:'Sim',exact:true}).click();
 await expect(page.locator('.simPanel .checkVerdict')).toBeVisible({timeout:30000});
 await settleLayout(page);
}
const barSnapshot=(page:Page)=>page.locator('.scrubBar').evaluate(el=>{
 const box=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
 const slot=el.querySelector('.posSlot') as HTMLElement;
 const cs=getComputedStyle(slot);
 const details=Array.from(slot.querySelectorAll('span')).map(x=>({text:x.textContent,w:x.getBoundingClientRect().width,display:getComputedStyle(x).display}));
 return {slider:box('.sliderWrap'),slot:box('.posSlot'),play:box('button'),select:box('select'),link:box('.simTabLink'),
   font:{family:cs.fontFamily,size:cs.fontSize,weight:cs.fontWeight,variant:cs.fontVariantNumeric,kerning:cs.fontKerning},details,
   max:Number((el.querySelector('.sliderInput') as HTMLInputElement).max),
   text:slot.innerText,title:slot.title,template:slot.querySelector('.alt')?.textContent,
   whole:slot.scrollWidth<=slot.clientWidth+1,sim:document.querySelector('.simPanel .simTime')?.textContent};
});


const coverage=async(page:Page)=>({
 ...await page.locator('.scrubBar').evaluate(el=>{
  const box=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
  const slot=el.querySelector('.checkSlot') as HTMLElement;
  return {text:slot.innerText,title:slot.getAttribute('title'),glyph:slot.querySelectorAll('.checkGlyph').length,
   warn:slot.classList.contains('text-warn'),slot:box('.checkSlot'),slider:box('.sliderWrap')};
 }),
 summary:await page.locator('.simPanel .simSummary .sumItem').first().getAttribute('aria-label'),
 tabPct:await page.locator('.simPanel .checkPct').innerText(),
 progress:await page.getByRole('progressbar',{name:'Collision check progress'}).getAttribute('aria-valuenow'),
});
for(const c of [{name:'desktop',vp:'desktop',zoom:1},{name:'portrait150',vp:'touch-portrait',zoom:1.5}])
test(`R240 completion, caveats, nothing checked, replacement; fixed geometry (${c.name})`,async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await prepare(page,context,116,c.vp);
 if(c.zoom!==1){await page.evaluate(z=>document.documentElement.style.zoom=String(z),c.zoom);await settleLayout(page);}
 const rows:any[]=[];const slot=page.locator('.scrubBar .checkSlot');
 const snap=async(name:string,text:string,title:string|null)=>{
  await expect(slot).toHaveText(text);if(title===null)await expect(slot).not.toHaveAttribute('title');else await expect(slot).toHaveAttribute('title',title);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const data=await coverage(page);rows.push({name,...data});
  expect(data.glyph).toBe(0);expect(data.warn).toBe(false);
  if(rows.length>1){expect({x:data.slot.x,w:data.slot.w}).toEqual({x:rows[0].slot.x,w:rows[0].slot.w});expect(data.slider).toEqual(rows[0].slider);}
  return data;
 };
 await snap('no moving pairs','',null);
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionHits!([]))).toBe(true);
 let state=await snap('clear, complete','100 %','Collision check: checked in full');
 expect(state.summary).toBe('Clear · checked in full');expect(state.tabPct).toBe('100 %');expect(state.progress).toBe('100');
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionHits!([{line:12}]))).toBe(true);
 state=await snap('collision, complete','100 %','Collision check: checked in full');
 expect(state.summary).toMatch(/1 collision/);
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionHits!([]))).toBe(true);
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionNote!('R240 omitted geometry'))).toBe(true);
 state=await snap('complete, caveat','100 %','Collision check: checked to the end');
 expect(state.summary).toContain('not certified');
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionNote!(null))).toBe(true);
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionStartDependent!({fromLine:2,toLine:4,whole:false,unbound:true}))).toBe(true);
 state=await snap('start unchecked, rest complete','100 %','Collision check: start not checked');
 expect(state.summary).toBe('Clear · start not checked');
 for(const unbound of [true,false]){
  expect(await page.evaluate(u=>window.__viewerDiag!.setCollisionStartDependent!({fromLine:2,toLine:32,whole:true,unbound:u}),unbound)).toBe(true);
  state=await snap(unbound?'whole unbound':'whole depends on position','',null);
  expect(state.summary).toBe(unbound?'Not checked':"Depends on the machine's position");
  expect(state.tabPct).toBe('100 %');expect(state.progress).toBe('100');
 }
 expect(await page.evaluate(()=>window.__viewerDiag!.setCollisionStartDependent!(null))).toBe(true);
 await snap('complete again','100 %','Collision check: checked in full');
 // A fresh publication starts a real new mock-model check: the old 100 must not stick.
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:7241,file:'/r237.ngc'}});
 await expect(page.locator('.simPanel .simSummary .sumItem').first()).toHaveAttribute('aria-label','No moving pairs');
 await snap('new publication, no moving pairs','',null);
 expect(errors).toEqual([]);
 writeFileSync(`${OUT}/coverage-${c.name}.json`,JSON.stringify({rows,errors},null,2));
});
test.afterAll(async()=>{await ctl({op:'reset'});});

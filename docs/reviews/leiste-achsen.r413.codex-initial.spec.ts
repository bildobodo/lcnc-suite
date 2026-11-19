import {appendFileSync} from 'node:fs';
import {test,expect,type Page} from './test';
import {openLayout} from './layout-fixtures';
import {XYZ,XYZAC,TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled,sample} from './r413-prototype';
const OUT='/tmp/r413';
const cases=[{name:'TWP1600',p:TWP,w:1600},{name:'XYZAC1280',p:XYZAC,w:1280},{name:'TWP1280',p:TWP,w:1280}];
async function setup(page:Page,c:typeof cases[number],touch:boolean){
 await openLayout(page,c.p,{name:c.name,width:c.w,height:800,touch});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const f=await formOf(page,true);await applyB1(page,f.form,'button');await settled(page);return f.form;
}
async function geometry(page:Page){
 return page.evaluate(()=>{
  const s=document.querySelector('.strip') as HTMLElement,sr=s.getBoundingClientRect();
  const safety=document.querySelector('.safetyStrip')!.getBoundingClientRect();
  const whole=(el:Element)=>{const r=el.getBoundingClientRect();return r.width>0 && r.left>=sr.left && r.right<=sr.right && r.top>=sr.top && r.bottom<=sr.bottom &&
   [r.left+2,(r.left+r.right)/2,r.right-2].every(x=>[r.top+2,(r.top+r.bottom)/2,r.bottom-2].every(y=>{
    const h=document.elementFromPoint(x,y);return h&&(h===el ||el.contains(h)||(h.contains(el)&&h.closest('[data-strip],.safetyStrip,.nkStrip')===el.closest('[data-strip],.safetyStrip,.nkStrip')));
   }));};
  const rect=(el:Element|null)=>{if(!el)return null;const r=el.getBoundingClientRect();return {l:r.left,r:r.right,w:r.width,t:r.top,b:r.bottom,whole:whole(el)};};
  const a=document.activeElement;
  return {scroll:s.scrollLeft,max:s.scrollWidth-s.clientWidth,safetyRight:safety.right,
   active:a?{tag:a.tagName,text:a.getAttribute('aria-label')??a.textContent?.trim().slice(0,35),section:a.closest('[data-strip]')?.getAttribute('data-strip'),inStrip:s.contains(a),visible:a.matches(':focus-visible'),...rect(a)}:null,
   keypad:rect(document.querySelector('.nkStrip')),spindle:rect(document.querySelector('[data-strip="spindle"]')),jog:rect(document.querySelector('[data-strip="jog"]')),
   safety:rect(document.querySelector('.safetyStrip')),stop:rect(document.querySelector('[data-probe="reserved-stop"]'))};
 });
}
for(const c of cases) test(`R413 full Tab ${c.name}`,async({page,browserName},info)=>{
 test.setTimeout(90000);const form=await setup(page,c,browserName==='chromium');
 await page.locator('.safetyStrip button').first().focus();const rows=[];
 for(let i=0;i<110;i++){
  const g=await geometry(page);if(!g.active?.inStrip)break;rows.push(g);
  await page.keyboard.press('Tab');await settled(page);
 }
 appendFileSync(`${OUT}/tab.jsonl`,JSON.stringify({project:info.project.name,case:c.name,form,rows,bad:rows.filter(g=>!g.active?.whole)})+'\n');
 expect(rows.length).toBeGreaterThan(20);
});
for(const c of cases) for(const owner of ['spindle','jog'] as const) test(`R413 helper ${c.name} ${owner}`,async({page,browserName},info)=>{
 test.setTimeout(90000);const form=await setup(page,c,browserName==='chromium');
 const input=owner==='spindle'?page.locator('.spRpmInput'):page.locator('[data-strip="jog"] input[type="number"]').first();
 await input.click();await expect(page.locator('.nkStrip')).toBeVisible();await settled(page);
 const after=await geometry(page);const snap=await sample(page,form);
 appendFileSync(`${OUT}/helper.jsonl`,JSON.stringify({project:info.project.name,case:c.name,form,owner,after,snap})+'\n');
 await page.locator('.strip').screenshot({path:`${OUT}/${info.project.name}-${c.name}-${owner}.png`});
});
// The actual pointer-input modality of range controls, without assuming that
// :focus-visible means a keyboard event. Record focus-time scroll synchronously.
for(const control of ['range','select'] as const) test(`R413 pointer focus ${control}`,async({page,browserName},info)=>{
 test.setTimeout(90000);const c=cases[2]!;await setup(page,c,browserName==='chromium');
 await page.evaluate(()=>{
  const strip=document.querySelector('.strip') as HTMLElement;
  (window as any).__pointerFocus=[];
  document.addEventListener('pointerdown',()=>{(window as any).__pointerHeld=true;},true);
  document.addEventListener('pointerup',()=>{(window as any).__pointerHeld=false;},true);
  document.addEventListener('focusin',ev=>{const t=ev.target as HTMLElement;const before=strip.scrollLeft;
   if(!strip.contains(t))return;
   const row={tag:t.tagName,type:(t as HTMLInputElement).type,visible:t.matches(':focus-visible'),held:(window as any).__pointerHeld,before,after:0};
   queueMicrotask(()=>{row.after=strip.scrollLeft;(window as any).__pointerFocus.push(row);});
  },true);
 });
 const loc=control==='range'?page.locator('[data-strip="jog"] input[type="range"]').first():page.locator('[data-strip="jog"] select').first();
 expect(await loc.count()).toBeGreaterThan(0);
 // Put its centre just beyond Safety. At least a piece of the control is hit-testable.
 await loc.evaluate(el=>{const s=document.querySelector('.strip') as HTMLElement;const edge=document.querySelector('.safetyStrip')!.getBoundingClientRect().right;const r=el.getBoundingClientRect();s.scrollLeft+=(r.left+r.right)/2-edge-6;});await settled(page);
 const point=await loc.evaluate(el=>{const r=el.getBoundingClientRect();const edge=document.querySelector('.safetyStrip')!.getBoundingClientRect().right;return{x:Math.max(edge+3,r.left+3),y:(r.top+r.bottom)/2};});
 const before=await geometry(page);await page.mouse.move(point.x,point.y);await page.mouse.down();
 const during=await geometry(page);await page.mouse.up();await page.keyboard.press('Escape');
 const events=await page.evaluate(()=>(window as any).__pointerFocus);
 appendFileSync(`${OUT}/pointer.jsonl`,JSON.stringify({project:info.project.name,control,before,during,events})+'\n');
});

import {appendFileSync} from 'node:fs';
import {test,expect,type Page} from './test';
import {openLayout} from './layout-fixtures';
import {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled,sample} from './r414-prototype';

async function setup(page:Page,touch:boolean){
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const {form}=await formOf(page,true);expect(form).toBe('F4');
 await applyB1(page,form,'button');await settled(page);return form;
}
async function state(page:Page){return page.evaluate(()=>{
 const s=document.querySelector('.strip') as HTMLElement;
 const a=document.activeElement as HTMLElement;
 const r=a?.getBoundingClientRect(),sr=s.getBoundingClientRect();
 const f=(window as any).__focusScroll;
 return {scroll:s.scrollLeft,tag:a?.tagName,text:a?.textContent?.trim().slice(0,45),
 left:r?.left,right:r?.right,visR:sr.left+s.clientLeft+s.clientWidth,
 pointers:[...f.pointers],kb:f.kb,pending:f.pending?.textContent?.trim().slice(0,45)??null};
});}
for(const which of ['partial','next','far'] as const)test(`R414 held Tab ${which}`,async({page,browserName},info)=>{
 await setup(page,browserName==='chromium');
 const buttons=page.locator('[data-strip="setup"] button:not([disabled])');
 // First target is partly outside, as in Claude's probe. Its next control
 // is wholly outside. Set up the Tab predecessor without causing a scroll.
 const index=which==='partial'?0:which==='next'?1:4;
 const target=buttons.nth(index);
 await target.evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 await page.keyboard.press('Shift+Tab');await settled(page);
 const prev=await page.evaluateHandle(()=>document.activeElement as HTMLElement);
 await page.locator('.strip').evaluate(el=>{el.scrollLeft=0;});await settled(page);
 const expected=await target.evaluate(el=>{const r=el.getBoundingClientRect();return{text:el.textContent?.trim(),left:r.left,right:r.right};});
 const head=(await page.locator('.safetyStrip .sub').first().boundingBox())!;
 await page.mouse.move(head.x+4,head.y+head.height/2);await page.mouse.down();
 await prev.evaluate(el=>el.focus({preventScroll:true}));
 const before=await state(page);
 await page.keyboard.press('Tab');await settled(page);
 const held=await state(page);
 const landed=await target.evaluate(el=>el===document.activeElement);
 await page.mouse.up();await settled(page);
 const after=await state(page);
 appendFileSync('/tmp/r414/tab.jsonl',JSON.stringify({project:info.project.name,which,expected,before,held,after,landed})+'\n');
 expect(landed).toBe(true);
 // Record the actual movement; the review checks it against the contract.
 expect(held.pointers.length).toBe(1);
});
test('R414 strict Safety overlay and fourth height',async({page,browserName},info)=>{
 const form=await setup(page,browserName==='chromium');
 await page.locator('.strip').evaluate(el=>{el.scrollLeft=200;});await settled(page);
 const before=await sample(page,form);
 const boxes=await page.locator('.safetyBtns button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return{width:r.width,height:r.height};}));
 await page.addStyleTag({content:'.safetyStrip::before {content:"";position:absolute;inset:0;z-index:999;pointer-events:auto;}'});
 const after=await sample(page,form);
 appendFileSync('/tmp/r414/occlusion.jsonl',JSON.stringify({project:info.project.name,before,after,boxes})+'\n');
 expect(before.estop&&before.stopOk).toBe(true);expect(after.estop||after.stopOk).toBe(false);
 expect(boxes).toHaveLength(4);expect(Math.max(...boxes.map(x=>x.height))-Math.min(...boxes.map(x=>x.height))).toBeLessThanOrEqual(0.5);
});

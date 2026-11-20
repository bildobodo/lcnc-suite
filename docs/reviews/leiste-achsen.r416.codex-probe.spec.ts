import {appendFileSync} from 'node:fs';
import {test,expect,type Page} from './test';
import {openLayout} from './layout-fixtures';
import {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled} from './r416-prototype';
async function setup(page:Page,touch:boolean){
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const {form}=await formOf(page,true);expect(form).toBe('F4');
 await applyB1(page,form,'button');await settled(page);
}
async function active(page:Page){return page.evaluate(()=>{
 const e=document.activeElement as HTMLElement;
 const st=(window as any).__focusScroll;
 return{tag:e.tagName,text:e.textContent?.trim().slice(0,60),aria:e.getAttribute('aria-label'),title:e.getAttribute('title'),
 section:e.closest('[data-strip]')?.getAttribute('data-strip')??null,
 safety:!!e.closest('.safetyStrip'),dialog:e.closest('[role="dialog"]')?.getAttribute('aria-label')??!!e.closest('[role="dialog"]'),
 class:e.className,tabIndex:e.tabIndex,scroll:document.querySelector('.strip')!.scrollLeft,
 pointers:[...st.pointers],pending:st.pending?.textContent?.trim().slice(0,50)??null,
 openDialogs:(window as any).__modalRegistry.count()};
});}
async function holdHeader(page:Page){const r=(await page.locator('.safetyStrip .sub').first().boundingBox())!;await page.mouse.move(r.x+4,r.y+r.height/2);await page.mouse.down();}

test('R416 held Jog Tab and ShiftTab keep the button still',async({page,browserName},info)=>{
 await setup(page,browserName==='chromium');
 const buttons=page.locator('[data-strip="setup"] button:not([disabled])');
 await buttons.first().evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 await page.locator('.strip').evaluate(el=>{el.scrollLeft=0;});await settled(page);
 const jog=page.getByRole('button',{name:'X+',exact:true}),r=(await jog.boundingBox())!;
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
 const before=await active(page);
 await page.keyboard.press('Tab');await settled(page);const forward=await active(page),forwardBox=await jog.boundingBox();
 expect(await buttons.nth(1).evaluate(el=>el===document.activeElement)).toBe(true);
 await page.keyboard.press('Shift+Tab');await settled(page);const back=await active(page);
 expect(await buttons.first().evaluate(el=>el===document.activeElement)).toBe(true);
 await page.keyboard.press('Tab');await page.mouse.up();await settled(page);const after=await active(page);
 appendFileSync('/tmp/r416/held.jsonl',JSON.stringify({project:info.project.name,before,forward,back,after,boxBefore:r,boxHeld:forwardBox})+'\n');
 expect(forward.scroll).toBe(before.scroll);expect(back.scroll).toBe(before.scroll);expect(forwardBox).toEqual(r);
});
for(const held of [false,true])test(`R416 Tab from neutral strip held ${held}`,async({page,browserName},info)=>{
 await setup(page,browserName==='chromium');
 if(held)await holdHeader(page);
 await page.locator('.strip').evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 const before=await active(page);await page.keyboard.press('Tab');await settled(page);const after=await active(page);
 if(held)await page.mouse.up();
 appendFileSync('/tmp/r416/neutral.jsonl',JSON.stringify({project:info.project.name,held,before,after})+'\n');
 expect(before.tabIndex).toBe(-1);
});
for(const held of [false,true])test(`R416 dialog Tab scope held ${held}`,async({page,browserName},info)=>{
 await setup(page,browserName==='chromium');
 await page.getByTitle('Settings',{exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 if(held)await holdHeader(page);
 await page.locator('.safetyBtns button').nth(2).evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 const before=await active(page);await page.keyboard.press('Tab');await settled(page);const after=await active(page);
 if(held)await page.mouse.up();
 appendFileSync('/tmp/r416/dialog.jsonl',JSON.stringify({project:info.project.name,held,before,after})+'\n');
 expect(after.openDialogs).toBe(1);
});
for(const where of ['strip','dialog','keypad'] as const)test(`R416 same target ${where}`,async({page,browserName},info)=>{
 await setup(page,browserName==='chromium');
 if(where==='dialog'){
  await page.getByTitle('Settings',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 }
 if(where==='keypad'){
  await page.locator('.spRpmInput').click();
  await expect(page.locator('.nkStrip')).toBeVisible();await settled(page);
 }
 const start=where==='strip'?page.locator('.strip'):where==='dialog'?page.locator('.safetyBtns button').nth(2):page.locator('.nkStrip');
 const key=where==='keypad'?'Tab':'Shift+Tab';
 await start.evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 await page.keyboard.press(key);await settled(page);
 const free=await active(page),freeTarget=await page.evaluateHandle(()=>document.activeElement);
 const header=where==='keypad'?page.locator('.nkStrip .sub'):page.locator('.safetyStrip .sub').first();
 const r=(await header.boundingBox())!;
 await page.mouse.move(r.x+4,r.y+r.height/2);await page.mouse.down();
 await start.evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 const before=await active(page);await page.keyboard.press(key);await settled(page);const held=await active(page);
 const same=await freeTarget.evaluate(el=>document.activeElement===el);
 await page.mouse.up();await settled(page);const after=await active(page);
 appendFileSync('/tmp/r416/extra.jsonl',JSON.stringify({project:info.project.name,where,key,free,before,held,after,same})+'\n');
 expect(same).toBe(true);expect(held.scroll).toBe(before.scroll);
});

import {appendFileSync} from 'node:fs';
import {test,expect} from './test';
import {openLayout} from './layout-fixtures';
import {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled} from './r415-prototype';
test('R415 held Tab dialog walk',async({page,browserName},info)=>{
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch:browserName==='chromium'});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const {form}=await formOf(page,true);await applyB1(page,form,'button');await settled(page);
 await page.getByTitle('Settings',{exact:true}).click();await expect(page.getByRole('dialog',{name:'Settings',exact:true})).toBeVisible();
 const r=(await page.locator('.safetyStrip .sub').first().boundingBox())!;
 await page.mouse.move(r.x+4,r.y+r.height/2);await page.mouse.down();
 await page.locator('.safetyBtns button').nth(2).evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 const rows=[];
 for(let i=0;i<10;i++){
  await page.keyboard.press('Tab');await settled(page);
  rows.push(await page.evaluate(()=>{
   const e=document.activeElement as HTMLElement, f=(window as any).__focusScroll;
   return {text:e.textContent?.trim().slice(0,40),aria:e.getAttribute('aria-label'),
    section:e.closest('[data-strip]')?.getAttribute('data-strip'),safety:!!e.closest('.safetyStrip'),
    dialog:!!e.closest('[role="dialog"]'),reachable:!!e.closest('[data-dialog-reachable]'),pointers:[...f.pointers],
    open:(window as any).__modalRegistry.count()};
  }));
 }
 await page.mouse.up();
 appendFileSync('/tmp/r415/dialog-walk.jsonl',JSON.stringify({project:info.project.name,rows})+'\n');
 expect(rows.every(r=>r.open===1&&r.pointers.length===1)).toBe(true);
});

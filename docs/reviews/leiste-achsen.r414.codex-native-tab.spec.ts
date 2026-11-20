import {appendFileSync} from 'node:fs';
import {test,expect} from './test';
import {openLayout} from './layout-fixtures';
import {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled} from './r414-prototype';
for(const listener of [false,true])test(`R414 native Tab with held Jog focus-listener ${listener}`,async({page,browserName},info)=>{
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch:browserName==='chromium'});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 await page.evaluate(()=>{
  const s=document.querySelector('.strip') as HTMLElement, orig=s.addEventListener;
  (s as any).addEventListener=function(type:string,fn:EventListener,...rest:any[]){
   if(type==='focusin')(window as any).__focusFn=fn;
   return orig.call(this,type,fn,...rest);
  };
 });
 const {form}=await formOf(page,true);await applyB1(page,form,'button');await settled(page);
 if(!listener)await page.evaluate(()=>document.querySelector('.strip')!.removeEventListener('focusin',(window as any).__focusFn));
 const buttons=page.locator('[data-strip="setup"] button:not([disabled])');
 await buttons.first().evaluate(el=>(el as HTMLElement).focus({preventScroll:true}));
 await page.locator('.strip').evaluate(el=>{el.scrollLeft=0;});await settled(page);
 const jog=page.getByRole('button',{name:'X+',exact:true});
 const r=(await jog.boundingBox())!;const point={x:r.x+r.width/2,y:r.y+r.height/2};
 const measure=async()=>({
  ...(await page.evaluate(()=>{
   const s=document.querySelector('.strip') as HTMLElement,f=(window as any).__focusScroll;
   return{scroll:s.scrollLeft,pointers:[...f.pointers],pending:f.pending?.textContent?.trim()??null};
  })),
  prevActive:await buttons.first().evaluate(el=>document.activeElement===el),
  targetActive:await buttons.nth(1).evaluate(el=>document.activeElement===el),
  jog:await jog.boundingBox(),
 });
 await page.mouse.move(point.x,point.y);await page.mouse.down();
 const before=await measure();
 await page.keyboard.press('Tab');await settled(page);
 const held=await measure();
 await page.mouse.up();await settled(page);
 const after=await measure();
 appendFileSync('/tmp/r414/native-tab.jsonl',JSON.stringify({project:info.project.name,listener,point,before,held,after})+'\n');
 expect(before.prevActive).toBe(true);expect(held.targetActive).toBe(true);
 expect(held.pointers.length).toBe(1);
 // Counterexample: the native default scrolls even without our listener.
 expect(held.scroll-before.scroll).toBeGreaterThan(400);
});

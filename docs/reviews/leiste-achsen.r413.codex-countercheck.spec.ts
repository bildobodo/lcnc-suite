// Countercheck of R413's whole-box oracle. Only CSS/DOM in the isolated mock.
import {appendFileSync} from 'node:fs';
import {test,expect} from './test';
import {openLayout} from './layout-fixtures';
import {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled,sample} from './r413-prototype';
test('R413 whole-box oracle excludes a covering Safety ancestor',async({page,browserName},info)=>{
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch:browserName==='chromium'});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const {form}=await formOf(page,true);expect(form).toBe('F4');
 await applyB1(page,form,'button');await settled(page);
 await page.locator('.strip').evaluate(el=>{el.scrollLeft=200;});await settled(page);
 const before=await sample(page,form);expect(before.jogVisible).toBe(true);expect(before.padStopWhole).toBe(false);expect(before.reservedWhole).toBe(true);
 await page.addStyleTag({content:'.safetyStrip::before {content:"";position:absolute;inset:0;z-index:999;pointer-events:auto;}'});
 const after=await sample(page,form);
 const hit=await page.evaluate(()=>{
  const btn=document.querySelector('[data-probe="reserved-stop"]')!,r=btn.getBoundingClientRect();
  const h=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)!;
  return {tag:h.tagName,cls:h.className,isButtonOrChild:h===btn||btn.contains(h),isAncestor:h.contains(btn)};
 });
 appendFileSync('/tmp/r413/mutation.jsonl',JSON.stringify({project:info.project.name,form,before,after,hit})+'\n');
 expect(hit.isButtonOrChild).toBe(false);
 // Assert the counterexample, not the claimed contract.
 expect(after.stopOk).toBe(true);expect(after.estop).toBe(true);
});
for(const enabled of [false,true]) test(`R413 pointer on select focus-scroll ${enabled}`,async({page,browserName},info)=>{
 await openLayout(page,TWP,{name:'TWP1280',width:1280,height:800,touch:browserName==='chromium'});
 await toolRowsIntoSpindle(page);await page.addStyleTag({content:HIDE_TOOL});await settled(page);
 const {form}=await formOf(page,true);
 // Save only the listener that the proposed construction adds, so the control
 // preserves all native/product listeners and all of B2's other CSS/DOM.
 await page.evaluate(()=>{
  const el=document.querySelector('.strip') as HTMLElement;const orig=el.addEventListener;
  (el as any).addEventListener=function(type:string,fn:EventListener,...rest:any[]){
   if(type==='focusin')(window as any).__bFocus=fn;return orig.call(this,type,fn,...rest);
  };
 });
 await applyB1(page,form,'button');await settled(page);
 if(!enabled)await page.evaluate(()=>document.querySelector('.strip')!.removeEventListener('focusin',(window as any).__bFocus));
 const loc=page.locator('[data-strip="jog"] select').first();
 await loc.evaluate(el=>{const s=document.querySelector('.strip') as HTMLElement;const edge=document.querySelector('.safetyStrip')!.getBoundingClientRect().right;const r=el.getBoundingClientRect();s.scrollLeft+=(r.left+r.right)/2-edge-6;});await settled(page);
 const measure=()=>loc.evaluate(el=>{const r=el.getBoundingClientRect();return{scroll:document.querySelector('.strip')!.scrollLeft,left:r.left,right:r.right,focusVisible:el.matches(':focus-visible'),active:document.activeElement===el};});
 const point=await loc.evaluate(el=>{const r=el.getBoundingClientRect();const edge=document.querySelector('.safetyStrip')!.getBoundingClientRect().right;return{x:Math.max(edge+3,r.left+3),y:(r.top+r.bottom)/2};});
 const before=await measure();await page.mouse.move(point.x,point.y);await page.mouse.down();
 const held=await measure();await page.mouse.up();
 appendFileSync('/tmp/r413/select-control.jsonl',JSON.stringify({project:info.project.name,enabled,point,before,held,delta:held.scroll-before.scroll})+'\n');
 expect(held.active).toBe(true);
});

import { test, expect } from './test';
import { writeFileSync } from 'node:fs';
import { ctl, publishToolTable } from './ctl';
import { PROFILES, VIEWPORTS, openLayout } from './layout-fixtures';
const results:any={};const save=()=>writeFileSync('/tmp/r405-boundary.json',JSON.stringify(results,null,2)+'\n');
async function measure(page:any){return page.evaluate(()=>{
 const strip=document.querySelector('.strip') as HTMLElement;
 const tool=document.querySelector('[data-strip="tool"]') as HTMLElement;
 const info=tool.querySelector('.toolInfo') as HTMLElement;
 const note=tool.querySelector('.statusNote') as HTMLElement;
 const box=(e:HTMLElement)=>({rect:e.getBoundingClientRect().toJSON(),clientW:e.clientWidth,scrollW:e.scrollWidth,clientH:e.clientHeight,scrollH:e.scrollHeight});
 return {stripOver:strip.scrollWidth-strip.clientWidth,tool:box(tool),info:box(info),note:box(note),last:box(info.lastElementChild as HTMLElement),retry:box(note.querySelector('button')!)};
});}
test('R405 S4a: wrapping a long error still needs a reachable content region',async({page})=>{
 await openLayout(page,PROFILES[0],VIEWPORTS.find(v=>v.name==='touch-fullhd')!);
 await publishToolTable([{T:12,P:12,D:12.7,Z:-1234.567,type:'endmill',description:'Description remains reachable'}]);
 await ctl({op:'status_delta',data:{tool_in_spindle:12,tool_number:12,tool_diameter:12.7,tool_length:-1234.567,tool_table_z:-1234.567,tool_offset:[0,0,-50,0,0,0,0,0,0],gcodes:[430]}});
 await expect(page.locator('.toolInfo')).toContainText('Description remains reachable');
 await page.addStyleTag({content:'.toolInfo {overflow:auto} [data-strip="tool"] .statusNote {overflow-wrap:anywhere}'});
 await page.locator('.toolInfo').evaluate(el=>el.classList.add('scroll-thin'));
 const error='Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/'+('customer_fixture_123456/'.repeat(12))+'tool.tbl';
 await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error}});
 await ctl({op:'raw',frame:{type:'tool_table_changed',version:200}});
 await expect(page.locator('[data-strip="tool"] .statusNote')).toContainText(error);
 await page.locator('.toolInfo').evaluate(el=>{el.scrollTop=el.scrollHeight});
 results.wrappedDataOnly=await measure(page);
 await page.locator('.strip').screenshot({path:'/tmp/r405-wrapped-error.png'});
 // Compare an explicit alternative: error + retry + tool data in one bounded scroll box.
 await page.locator('[data-strip="tool"] .stripSection').evaluate(el=>{
  const note=el.querySelector('.statusNote')!,info=el.querySelector('.toolInfo') as HTMLElement;
  const box=document.createElement('div');box.className='r405Common scroll-thin';
  box.style.cssText='overflow:auto;min-height:0;flex:1';
  el.append(box);box.append(note,info);info.style.overflow='visible';info.scrollTop=0;
  box.scrollTop=box.scrollHeight;
 });
 results.commonScrollAtEnd=await measure(page);
 results.commonBox=await page.locator('.r405Common').evaluate(el=>({clientH:el.clientHeight,scrollH:el.scrollHeight,scrollTop:el.scrollTop,rect:el.getBoundingClientRect().toJSON()}));
 save();
});
test('R405 count scope: one, two and three axes at Full HD',async({page})=>{
 results.axes={};
 for(const axes of [['X'],['X','Y'],['X','Y','A']]){
  await openLayout(page,{name:'axis-scope',axes,kins:null} as any,VIEWPORTS.find(v=>v.name==='touch-fullhd')!);
  results.axes[axes.join('')]=await page.locator('.strip').evaluate(el=>({over:el.scrollWidth-el.clientWidth,sections:[...el.querySelectorAll('[data-strip]')].map(e=>({name:(e as HTMLElement).dataset.strip,width:e.getBoundingClientRect().width}))}));
 }
 save();
});

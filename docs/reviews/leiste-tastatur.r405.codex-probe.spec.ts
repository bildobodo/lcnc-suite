import { test, expect } from './test';
import { writeFileSync } from 'node:fs';
import { ctl, publishToolTable } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, enterStripState } from './layout-fixtures';
import { TOOL_TYPE_LABELS } from '../src/toolTypes';
const results: any = {};
const save = () => writeFileSync('/tmp/r405-probe.json', JSON.stringify(results,null,2)+'\n');
async function toolGeometry(page: any) {
 return page.evaluate(() => {
  const strip=document.querySelector('.strip') as HTMLElement;
  const tool=document.querySelector('[data-strip="tool"]') as HTMLElement;
  const info=tool.querySelector('.toolInfo') as HTMLElement;
  const note=tool.querySelector('.statusNote') as HTMLElement|null;
  const rows=[...info.querySelectorAll('.statusRow')].map(r=>{
   const rect=r.getBoundingClientRect(); const value=r.lastElementChild as HTMLElement;
   return {text:r.textContent?.trim(),w:rect.width,h:rect.height,scrollW:r.scrollWidth,clientW:r.clientWidth,
    valueW:value.getBoundingClientRect().width,valueScrollW:value.scrollWidth,
    top:rect.top,bottom:rect.bottom};
  });
  return {stripOver:strip.scrollWidth-strip.clientWidth,tool:tool.getBoundingClientRect().toJSON(),
   info:{box:info.getBoundingClientRect().toJSON(),clientH:info.clientHeight,scrollH:info.scrollHeight,clientW:info.clientWidth,scrollW:info.scrollWidth,scrollTop:info.scrollTop},
   note:note?{box:note.getBoundingClientRect().toJSON(),scrollH:note.scrollHeight,clientH:note.clientHeight}:null,rows};
 });
}
test('R405 A: every declared type and the proposed data-only scrolling under a long file error',async({page})=>{
 test.setTimeout(120000);
 await openLayout(page,PROFILES[0],VIEWPORTS.find(v=>v.name==='touch-fullhd')!);
 await ctl({op:'status_delta',data:{tool_in_spindle:12,tool_number:12,tool_diameter:12.7,tool_length:-1234.567,tool_table_z:-1234.567,tool_offset:[0,0,-50,0,0,0,0,0,0],gcodes:[430]}});
 results.types={};
 for(const [type,label] of Object.entries(TOOL_TYPE_LABELS)){
  await publishToolTable([{T:12,P:12,D:12.7,Z:-1234.567,type,description:'Twelve mm three flute carbide roughing end mill'}]);
  await expect(page.locator('[data-strip="tool"] .statusRow').filter({has:page.locator('.label-muted',{hasText:/^Type$/})})).toContainText(label);
  results.types[type]=await toolGeometry(page);
 }
 // This is S4a's proposed data-only scroll box, applied as a measurement, not an implementation.
 await page.addStyleTag({content:'.toolInfo { overflow: auto; }'});
 await page.locator('.toolInfo').evaluate(el=>el.classList.add('scroll-thin'));
 for(const n of [1,12]){
  const error='Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/'+('customer_fixture_123456/'.repeat(n))+'tool.tbl';
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error}});
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:100+n}});
  await expect(page.locator('[data-strip="tool"] .statusNote')).toContainText(error);
  await page.locator('.toolInfo').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  results['error_'+n]={error,...await toolGeometry(page)};
 }
 await page.locator('.strip').screenshot({path:'/tmp/r405-long-error.png'});
 save();
});
test('R405 K: full column keys including the close key',async({page})=>{
 await openLayout(page,PROFILES[0],VIEWPORTS.find(v=>v.name==='touch-portrait')!);
 await enterStripState(page,PROFILES[0],'keypad-setup');
 results.keypad=await page.locator('.nkStrip').evaluate(el=>({w:el.getBoundingClientRect().width,keys:[...el.querySelectorAll('button')].map(b=>({text:b.getAttribute('aria-label')??b.textContent?.trim(),x:b.getBoundingClientRect().x,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}))}));
 save();
});

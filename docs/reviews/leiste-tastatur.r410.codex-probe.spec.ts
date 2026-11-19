import {test,expect} from './test';
import {writeFileSync} from 'node:fs';
import {ctl,publishToolTable} from './ctl';
import {openLayout,settleLayout, type Profile} from './layout-fixtures';
import {TOOL_TYPE_LABELS} from '../src/toolTypes';
const evidence:Record<string,unknown>={};
const save=()=>writeFileSync('/tmp/r410-own.json',JSON.stringify(evidence,null,2)+'\n');
const NOTE='Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/'+'customer_fixture_123456/'.repeat(12)+'tool.tbl';
const DESC='A_Long_Unbroken_Description_'.repeat(64);
const xyz:Profile={name:'xyz',axes:['X','Y','Z'],kins:null};
const xya:Profile={name:'xya',axes:['X','Y','A'],kins:null};
const tool={T:12,P:12,D:25.4,Z:-1234.567,type:'cornerchamfer',description:DESC};
async function useTool(page:any,T=12){
 await ctl({op:'status_delta',data:{tool_in_spindle:T,tool_number:T,tool_diameter:25.4,tool_length:-1234.567,tool_table_z:-1234.567,tool_offset:[0,0,-2345.678,0,0,0,0,0,0],gcodes:[430]}});
 await expect(page.locator('[data-strip="tool"] .toolInfo')).toContainText(`T${T}`);
 await settleLayout(page);
}
async function note(page:any){
 await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error:NOTE}});
 await ctl({op:'raw',frame:{type:'tool_table_changed',version:9410}});
 await expect(page.locator('[data-strip="tool"] .statusNote')).toContainText(NOTE);await settleLayout(page);
}
async function measure(page:any){return page.locator('[data-strip="tool"]').evaluate((el:HTMLElement)=>{
 const b=el.querySelector('.toolBody') as HTMLElement,c=b.lastElementChild as HTMLElement,d=el.querySelector('.toolDesc') as HTMLElement|null;
 const strip=document.querySelector('.strip') as HTMLElement, s=document.querySelector('.safetyStrip') as HTMLElement;
 const r=el.getBoundingClientRect(),br=b.getBoundingClientRect(),cr=c.getBoundingClientRect(),sr=strip.getBoundingClientRect(),safe=s.getBoundingClientRect();
 const z=Number.parseFloat(getComputedStyle(document.documentElement).zoom)||1;
 return {width:r.width,toolMin:parseFloat(getComputedStyle(el).getPropertyValue('--strip-tool-w')),flexGrow:getComputedStyle(el).flexGrow,
  stripOverflow:strip.scrollWidth-strip.clientWidth,bodyOverflow:b.scrollHeight-b.clientHeight,
  cardGap:br.top+(b.clientTop+b.clientHeight)*z-cr.bottom,
  description:d?{client:d.clientWidth,scroll:d.scrollWidth,overflow:getComputedStyle(d).overflowX,ellipsis:getComputedStyle(d).textOverflow}:null,
  strip:{top:sr.top,bottom:sr.bottom},safety:{bottom:safe.bottom},body:{height:br.height,width:br.width},card:{height:cr.height,width:cr.width}};
 });}

test('codex R410: a long description does not consume the reserve or grow the row',async({page})=>{
 test.setTimeout(120000);const results=[];
 for(const touch of [false,true])for(const cfg of [{p:xyz,w:1920},{p:xyz,w:2560},{p:{...xyz,name:'x',axes:['X']},w:1920},{p:xya,w:1920}]){
  await openLayout(page,cfg.p,{name:'probe',width:cfg.w,height:1080,touch});const before=await measure(page);
  await publishToolTable([tool]);await useTool(page);await expect(page.locator('.toolDesc')).toHaveText(DESC);
  const after=await measure(page);
  expect(Math.abs(before.width-after.width)).toBeLessThanOrEqual(.5);
  expect(after.stripOverflow).toBe(before.stripOverflow);expect(after.bodyOverflow).toBe(0);expect(Math.abs(after.cardGap)).toBeLessThanOrEqual(.5);
  expect(after.description!.ellipsis).toBe('ellipsis');expect(after.description!.overflow).toBe('hidden');
  if(cfg.w===2560)expect(after.description!.client).toBeGreaterThan(120);
  results.push({touch,axes:cfg.p.axes,viewport:cfg.w,before,after});
  if(touch&&cfg.w===1920&&cfg.p===xyz)await page.screenshot({path:'/tmp/r410-symmetric-xyz.png'});
 }
 evidence.description=results;save();
});

test('codex R410: every built-in type remains whole at the minimum with and without a note',async({page})=>{
 test.setTimeout(120000);await openLayout(page,xya,{name:'minimum',width:1920,height:1080,touch:true});
 const types=Object.entries(TOOL_TYPE_LABELS);await publishToolTable(types.map(([type],i)=>({...tool,T:i+1,P:i+1,type})));
 const results=[];
 for(const error of [false,true]){
  if(error)await note(page);
  for(let i=0;i<types.length;i++){
   await useTool(page,i+1);
   const row=page.locator('[data-strip="tool"] .statusRow').filter({has:page.locator('.label-muted',{hasText:/^Type$/})});
   await expect(row).toContainText(types[i][1]);await row.scrollIntoViewIfNeeded();
   const m=await measure(page);expect(m.width).toBe(224);
   const g=await row.evaluate(el=>{
    const r=el.getBoundingClientRect(),b=el.closest('.toolBody')!.getBoundingClientRect(),s=document.querySelector('.strip')!.getBoundingClientRect();
    const range=document.createRange();range.selectNodeContents(el);
    return {height:r.height,visible:r.top>=b.top-.5&&r.bottom<=b.bottom+.5&&r.left>=s.left-.5&&r.right<=s.right+.5,
     textInside:[...range.getClientRects()].every(q=>q.left>=r.left-.5&&q.right<=r.right+.5)};
   });expect(g.visible).toBe(true);expect(g.textInside).toBe(true);
   results.push({error,type:types[i][0],geometry:g,bodyOverflow:m.bodyOverflow});
  }
 }
 evidence.types=results;save();
});

for(const zoom of [1,1.5])test(`codex R410: portrait tool data and error are reachable at zoom ${zoom}`,async({page})=>{
 await openLayout(page,xyz,{name:'portrait',width:900,height:1200,touch:true});
 await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
 await publishToolTable([tool]);await useTool(page);await note(page);
 const toolBox=page.locator('[data-strip="tool"]');
 const results=[];
 const targets=toolBox.locator('.statusRow, .statusNote button');
 for(let i=0;i<await targets.count();i++){
  await targets.nth(i).evaluate(el=>el.scrollIntoView({block:'end'}));await settleLayout(page);
  const seen=await targets.nth(i).evaluate(el=>{
   const r=el.getBoundingClientRect(),s=document.querySelector('.strip')!.getBoundingClientRect(),h=document.querySelector('.safetyStrip')!.getBoundingClientRect();
   return {text:el.textContent?.trim(),top:r.top,bottom:r.bottom,minTop:Math.max(s.top,h.bottom),maxBottom:Math.min(s.bottom,innerHeight),left:r.left,right:r.right,stripLeft:s.left,stripRight:s.right};
  });
  expect(seen.top).toBeGreaterThanOrEqual(seen.minTop-.6);expect(seen.bottom).toBeLessThanOrEqual(seen.maxBottom+.6);
  expect(seen.left).toBeGreaterThanOrEqual(seen.stripLeft-.6);expect(seen.right).toBeLessThanOrEqual(seen.stripRight+.6);results.push(seen);
 }
 const m=await measure(page);expect(m.flexGrow).toBe('0');expect(m.stripOverflow).toBe(0);
 const noteLines=await toolBox.locator('.statusNote > span').evaluate((el,z)=>{
  const strip=document.querySelector('.strip') as HTMLElement,range=document.createRange();range.selectNodeContents(el);
  const count=range.getClientRects().length;const out=[];
  for(let i=0;i<count;i++){
   const q=range.getClientRects()[i]!,s=strip.getBoundingClientRect();strip.scrollTop+=(q.bottom-s.bottom+10*z)/z;
   const r=range.getClientRects()[i]!,h=document.querySelector('.safetyStrip')!.getBoundingClientRect(),b=strip.getBoundingClientRect();
   out.push(r.top>=Math.max(b.top,h.bottom)-.6&&r.bottom<=Math.min(b.bottom,innerHeight)+.6&&r.left>=b.left-.6&&r.right<=b.right+.6);
  }return out;
 },zoom);
 expect(noteLines.length).toBeGreaterThan(0);expect(noteLines.every(Boolean)).toBe(true);
 evidence[`portrait_${zoom}`]={geometry:m,targets:results,noteLines};save();
});

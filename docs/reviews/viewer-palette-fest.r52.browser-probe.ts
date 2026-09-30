import { test, expect } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const N=4000;
const feed=Array.from({length:N},(_,i)=>[i%2?10:0,i*.5,0]);
const preview=Buffer.from(encode({file:'/r52-glide.ngc',preview_schema:9,feed,
 feed_lines:feed.map((_,i)=>i+1),feed_seq:feed.map((_,i)=>i+1),feed_outside:new Uint8Array(N),rapid:[],violations:[],violations_total:0}));
test.afterEach(async()=>{await ctl({op:'reset'});});
for (const reduce of [false,true]) test(`R52 running-line visibility: 20 lines per packet, reduced=${reduce}`,async({page,context})=>{
 test.setTimeout(60000);
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:feed.map((p)=>`G1 X${p[0]} Y${p[1]} F100`).join('\n')}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await page.emulateMedia({reducedMotion:reduce?'reduce':'no-preference'});
 await ctl({op:'status_delta',data:{active_file:'/r52-glide.ngc'}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5201,file:'/r52-glide.ngc'}});
 const viewer=page.locator('.codeViewer:not(.mdiHistoryList)');
 await expect(viewer.locator('.codeLine').first()).toBeVisible();
 await ctl({op:'quiet',on:true});
 let line=200;
 await ctl({op:'status_delta',data:{interp_state:2,task_mode:2,motion_line:line}});
 await expect(viewer.locator('.codeLine.active .lineNumber')).toHaveText(String(line));
 await page.waitForTimeout(200);
 await page.evaluate(()=>{
  const w=window as any;w.__r52Samples=[];w.__r52Stop=false;
  const el=document.querySelector<HTMLElement>('.codeViewer:not(.mdiHistoryList)')!;
  function f(now:number){
   if(w.__r52Stop)return;
   const a=el.querySelector<HTMLElement>('.codeLine.active');const v=el.getBoundingClientRect();const b=a?.getBoundingClientRect();
   w.__r52Samples.push({now,scroll:el.scrollTop,viewH:el.clientHeight,line:a?.querySelector('.lineNumber')?.textContent??null,
    visible:!!b&&b.bottom>v.top&&b.top<v.bottom,offset:b?b.top+b.height/2-v.top-v.height/2:null});
   requestAnimationFrame(f);
  }requestAnimationFrame(f);
 });
 for(let i=0;i<36;i++){
  line+=20;await ctl({op:'status_delta',data:{motion_line:line}});await page.waitForTimeout(33);
 }
 const rows=await page.evaluate(()=>{(window as any).__r52Stop=true;return (window as any).__r52Samples;});
 await page.waitForTimeout(250);
 await expect(viewer.locator('.codeLine.active .lineNumber')).toHaveText(String(line));
 const active=rows.slice(3,-3);
 const summary={reduce,line,frames:active.length,invisibleFrames:active.filter((r:any)=>!r.visible).length,
  invisibleShare:active.filter((r:any)=>!r.visible).length/active.length,viewH:rows[0].viewH,
  maxAbsOffset:Math.max(...active.map((r:any)=>Math.abs(r.offset??0)))};
 writeFileSync(`../evidence/viewer-palette-fest.r52.glide-${reduce?'reduced':'normal'}.json`,JSON.stringify({summary,rows},null,2)+'\n');
 console.log(JSON.stringify(summary));
 if(reduce)expect(summary.invisibleFrames).toBe(0);
});

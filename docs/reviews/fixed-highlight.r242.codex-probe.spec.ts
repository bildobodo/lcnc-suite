import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from './layout-fixtures';
import { simShow } from './simTab';
import { withLimitRuns } from './limitRuns';
const OUT='/tmp/codex-r242-wryvpp3n';
const SEL='.codeViewer:not(.mdiHistoryList)';
async function program(page:Page,context:BrowserContext,n:number) {
 const feed=Array.from({length:1200},(_,i)=>[i%2?10:0,i*.5,0]);
 const preview=Buffer.from(encode({file:'/probe.ngc',preview_schema:11,feed,feed_lines:feed.map((_,i)=>i+1),feed_seq:feed.map((_,i)=>i+1),feed_outside:new Uint8Array(feed.length),rapid:[],violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:n},(_,i)=>`G1 X${i%2?10:0} Y${i*.5} F100`).join('\n')}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await page.emulateMedia({reducedMotion:'no-preference'});
 await ctl({op:'status_delta',data:{active_file:'/probe.ngc'}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:24100,file:'/probe.ngc'}});
 await expect(page.locator(SEL+' .codeLine').first()).toBeVisible({timeout:30000});
 await ctl({op:'quiet',on:true});
}
async function line(page:Page,n:number){ await ctl({op:'status_delta',data:{interp_state:2,task_mode:2,motion_line:n}}); }
async function startRecord(page:Page) {
 await page.evaluate(sel=>{
 const w=window as any; w.__frames=[];w.__phase=''; w.__record=true;
 const tick=()=>{ const el=document.querySelector(sel)!; const v=el.getBoundingClientRect(); const a=el.querySelector('.codeLine.active')!; const r=a?.getBoundingClientRect();const band=el.querySelector('.codeFollowBand');const h=(band??a)?.getBoundingClientRect();
 w.__frames.push({t:performance.now(),phase:w.__phase,line:a?.querySelector('.lineNumber')?.textContent,hl:h?.top! - v.top,run:r?.top! - v.top,h:r?.height,view:v.height,st:el.scrollTop,band:!!band});
 if(w.__record)requestAnimationFrame(tick);};requestAnimationFrame(tick);
 },SEL);
}
async function phase(page:Page,name:string,values:number[],gap=40){
 await page.evaluate(p=>(window as any).__phase=p,name);
 for(const n of values){await line(page,n);await page.waitForTimeout(gap);}
 await page.waitForTimeout(220);
}
for(const n of [1200,600000,2000000]) test(`independent program transitions ${n} lines`,async({page,context})=>{
 test.setTimeout(120000);await program(page,context,n);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 const center=n===1200?100:550000;
 await line(page,center);await expect(page.locator(SEL+' .codeLine.active .lineNumber')).toHaveText(String(center));await page.waitForTimeout(300);
 await startRecord(page);
 await phase(page,'forward',Array.from({length:20},(_,i)=>center+3*(i+1)));
 await phase(page,'reverse',Array.from({length:20},(_,i)=>center+57-3*i));
 await phase(page,'visible-band-jumps',[center+20,center+40,center+60,center+40,center+20,center]);
 await phase(page,'file-start',[1,2,3,4,5,6,7,8,9,10]);
 await phase(page,'file-end',[n-10,n-9,n-8,n-7,n-6,n-5,n-4,n-3,n-2,n-1,n]);
 await page.evaluate(()=>(window as any).__record=false);
 const frames:any[]=await page.evaluate(()=>(window as any).__frames);
 writeFileSync(`${OUT}/program-${n}.json`,JSON.stringify({errors,frames},null,2));
 const free=frames.filter(f=>f.phase==='forward'||f.phase==='reverse');
 const report=['forward','reverse'].map(p=>{const fs=free.filter(f=>f.phase===p);return {phase:p,spread:Math.max(...fs.map(f=>f.hl))-Math.min(...fs.map(f=>f.hl)),missing:fs.filter(f=>!f.line).length};});
 console.log('program',n,report);
 if(n===1200){
  const fs=free.filter(f=>f.phase==='forward'); const steady=fs.filter(f=>f.t>fs[0].t+300);
  const lag=Math.max(...steady.map(f=>(f.run-f.hl)/f.h));
  console.log('steady lag at 3 lines per packet',lag);
  // R242 accepts the interpolated-display contract: record lag, no obsolete bound.
 }
 expect(errors).toEqual([]);
 expect(free.filter(f=>!f.line),'active row present in each free frame').toEqual([]);
 for(const r of report)expect.soft(r.spread,`${n} ${r.phase}: fixed band spread`).toBeLessThanOrEqual(1);
 await expect(page.locator(SEL+' .codeFollowBand')).toHaveCount(0);
 await expect(page.locator(SEL+' .codeLine.active .lineNumber')).toHaveText(String(n));
});
const FEED=Array.from({length:60},(_,i)=>[i*2,i%2?20:0,0]);
const PREVIEW=Buffer.from(encode(withLimitRuns({file:'/long.ngc',preview_schema:11,feed:FEED,feed_lines:FEED.map((_,i)=>i+3),feed_seq:FEED.map((_,i)=>i+3),feed_outside:new Uint8Array(FEED.length),feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>i*4)).buffer),violations:Array.from({length:50},(_,i)=>({line:i+8,axis:'X',value:110,limit:100,kind:'max'})),violations_total:50})));
async function sim(page:Page,context:BrowserContext){
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:PREVIEW}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:64},(_,i)=>`G1 X${i} F100`).join('\n')}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS[0]!);await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:800});
 await ctl({op:'status_delta',data:{active_file:'/long.ngc',is_enabled:false,enabled:false}});await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:24101,file:'/long.ngc'}});
 await simShow(page,'limit');await expect(page.locator('.simPanel tr[data-sim-row="L57@57"]')).toHaveCount(1,{timeout:15000});await settleLayout(page);
 await page.locator('.simPanel tr[data-sim-row="L8@8"]').click();await expect(page.locator('.simBanner')).toBeVisible();
}
async function scrub(page:Page,f:number){await page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement,f)=>{el.value=String(Number(el.max)*f);el.dispatchEvent(new Event('input',{bubbles:true}));},f);}
const simState=(page:Page)=>page.evaluate(()=>{const sc=document.querySelector<HTMLElement>('.simPanel .simTable')!;const band=sc?.querySelector('.simFollowBand');return{band:!!band?.getClientRects().length,marked:sc?.querySelector('tr.shownRow,tr.nextRow')?.getAttribute('data-sim-row'),followed:sc?.querySelector('tr.followed')?.getAttribute('data-sim-row'),st:sc?.scrollTop,top:band?.getBoundingClientRect().top};});
test('independent Sim ends, filter and resize clear the transient band',async({page,context})=>{
 await sim(page,context);const results:any[]=[];
 for(const end of ['end','filter','resize','tab']){
 await simShow(page,'limit');await scrub(page,.4);await page.waitForTimeout(250);await scrub(page,.5);
 if(end==='end') await scrub(page,1);
 if(end==='filter')await page.locator('.simPanel select[name="simFilter"]').selectOption('tool');
 if(end==='resize')await page.setViewportSize({width:1300,height:900});
 if(end==='tab'){await page.getByRole('tab',{name:'MDI',exact:true}).click();await scrub(page,.65);await page.getByRole('tab',{name:'Sim',exact:true}).click();}
 await page.waitForTimeout(350);results.push({end,...await simState(page)});
 }
 writeFileSync(`${OUT}/sim-transitions.json`,JSON.stringify(results,null,2));console.log(results);
 for(const r of results)expect.soft(r.band,`${r.end}: no band at rest`).toBe(false);
});
test('independent expanded subroutine retains its fixed highlight across sub-line updates',async({page,context})=>{
 test.setTimeout(60000);
 const f=Array.from({length:80},(_,i)=>[i,i%2,0]);const inSub=(i:number)=>i>=20&&i<60;
 const p=Buffer.from(encode({file:'/sub-main.ngc',preview_schema:11,feed:f,
 feed_lines:f.map((_,i)=>inSub(i)?i-10:i<20?i+1:i-39),feed_seq:f.map((_,i)=>i+1),
 feed_lineok:new Uint8Array(f.map((_,i)=>inSub(i)?0:1)),feed_sub:new Uint8Array(f.map((_,i)=>inSub(i)?0:255)),
 feed_cline:new Uint8Array(Uint16Array.from(f.map((_,i)=>inSub(i)?20:0)).buffer),sub_names:['r241sub'],
 feed_tcum:new Uint8Array(Float32Array.from(f.map((_,i)=>i)).buffer),feed_outside:new Uint8Array(f.length),rapid:[],violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:p}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:200},(_,i)=>i===19?'o<r241sub> call':`G1 X${i} F100`).join('\n')}));
 await context.route(/\/subfile\?/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:100},(_,i)=>i===0?'o<r241sub> sub':i===99?'o<r241sub> endsub':`G1 Y${i} F100`).join('\n')}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);await page.emulateMedia({reducedMotion:'no-preference'});
 await ctl({op:'status_delta',data:{active_file:'/sub-main.ngc',is_enabled:false,enabled:false}});await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:24103,file:'/sub-main.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible();
 await page.locator('.scrubBar input[type="checkbox"]').check();
 await scrub(page,.3);await expect(page.locator(SEL+' .subRow.active')).toBeVisible();await page.waitForTimeout(300);
 await page.evaluate(sel=>{
 const w=window as any;w.__sub=[];w.__subRec=true;
 const tick=()=>{const el=document.querySelector(sel)!;const v=el.getBoundingClientRect();const a=el.querySelector('.subRow.active');const r=a?.getBoundingClientRect();const band=el.querySelector('.codeFollowBand');const h=(band??a)?.getBoundingClientRect();w.__sub.push({t:performance.now(),line:a?.querySelector('.lineNumber')?.textContent,hl:h?.top!-v.top,run:r?.top!-v.top,band:!!band,st:el.scrollTop});if(w.__subRec)requestAnimationFrame(tick);};requestAnimationFrame(tick);
 },SEL);
 for(let i=24;i<47;i++){await scrub(page,i/79);await page.waitForTimeout(40);}
 await page.waitForTimeout(300);await page.evaluate(()=>(window as any).__subRec=false);
 const frames:any[]=await page.evaluate(()=>(window as any).__sub);
 writeFileSync(`${OUT}/subroutine.json`,JSON.stringify(frames,null,2));
 const spread=Math.max(...frames.map(f=>f.hl))-Math.min(...frames.map(f=>f.hl));
 console.log('subroutine',{frames:frames.length,lines:new Set(frames.map(f=>f.line)).size,bands:frames.filter(f=>f.band).length,spread});
 expect(new Set(frames.map(f=>f.line)).size).toBeGreaterThan(15);
 expect.soft(frames.filter(f=>f.band).length,'updates within the same expansion keep a band').toBeGreaterThan(5);
 expect.soft(spread,'subroutine fixed highlight').toBeLessThanOrEqual(1.5);
});

// R242: the row window and band use the requested fractional scroll; a
// subsequent independent DOM scroll must use its own mapping instead.
test('manual scroll and both ends of the scaled file retain the row mapping',async({page,context})=>{
 test.setTimeout(120000);const n=2000000;await program(page,context,n);
 await line(page,550000);await page.waitForTimeout(300);
 await ctl({op:'status_delta',data:{interp_state:1,motion_line:0}});await page.waitForTimeout(100);
 const result:any[]=[];
 for(const where of [0,1,25,100,1000,17000,1500000,6000000,11999573,0]){
  await page.locator(SEL).evaluate((el,y)=>el.scrollTop=y,where);await page.waitForTimeout(60);
  result.push(await page.locator(SEL).evaluate((el,n)=>{
   const sc=el as HTMLElement,v=el.getBoundingClientRect(),lh=23,content=n*lh,scale=(content-sc.clientHeight)/(12000000-sc.clientHeight);
   const rows=[...el.querySelectorAll<HTMLElement>('.codeLine')].map(r=>({line:Number(r.querySelector('.lineNumber')!.textContent),top:r.getBoundingClientRect().top-v.top-sc.clientTop}));
   const onscreen=rows.filter(r=>r.top+lh>0&&r.top<sc.clientHeight);
   return{st:sc.scrollTop,viewport:sc.clientHeight,first:onscreen[0],last:onscreen.at(-1),wantTop:onscreen[0]?(onscreen[0].line-1)*lh-sc.scrollTop*scale:null};
  },n));
 }
 await line(page,650000);await page.waitForTimeout(300);
 const active=page.locator(SEL+' .codeLine.active .lineNumber');await expect(active).toHaveText('650000');
 writeFileSync(`${OUT}/manual-scroll.json`,JSON.stringify(result,null,2));
 for(const r of result){expect(r.first,JSON.stringify(r)).toBeDefined();expect.soft(Math.abs(r.first.top-r.wantTop),JSON.stringify(r)).toBeLessThanOrEqual(1);}
 expect(result[0].first.line).toBe(1);expect(result.at(-1).first.line).toBe(1);
});

// Public wire path, no Vue state injection: the run is on a marked sub's
// segment, with and without an attributed call line. The Program tab must
// keep naming the sub even where no line in the main file can be lit.
for(const callLine of [0,2])test(`run subroutine name survives without an inline expansion (call ${callLine})`,async({page,context})=>{
 const file='/origin-name.ngc';const f=[[0,0,0],[10,0,0],[20,0,0],[30,0,0],[40,0,0]];
 const p=Buffer.from(encode({file,preview_schema:11,feed:f,feed_lines:[1,2,339,340,3],feed_seq:[1,2,3,4,5],
  feed_lineok:new Uint8Array([1,1,0,0,1]),feed_sub:new Uint8Array([255,255,0,0,255]),sub_names:['originprobe'],
  feed_cline:new Uint8Array(Uint16Array.from([0,0,callLine,callLine,0]).buffer),feed_outside:new Uint8Array(5),rapid:[],violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:p}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:'G1 X10 F100\no<originprobe> call\nG1 X40\nM2'}));
 await context.route(/\/subfile\?/,r=>r.fulfill({status:404,body:'source not available'}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await ctl({op:'status_delta',data:{active_file:file,joint_pos:[0,0,0],actual_position:[0,0,0],g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),tool_offset:Array(9).fill(0),rotation_xy:0}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:24210+callLine,file}});
 await expect(page.locator(SEL+' .codeLine').first()).toBeVisible();await expect(page.locator('.scrubBar')).toBeVisible();
 await ctl({op:'quiet',on:true});
 await ctl({op:'status_delta',data:{interp_state:2,task_mode:2,motion_line:339,joint_pos:[15,0,0],actual_position:[15,0,0]}});
 await page.waitForTimeout(100);
 await ctl({op:'status_delta',data:{motion_line:339,joint_pos:[16,0,0],actual_position:[16,0,0]}});
 // A different view already states this exact sub. This also proves that
 // the run watcher attached, not an off-path fixture or missing parse.
 await expect(page.locator('.simPanel .simLine')).toHaveText(callLine?'L2 (originprobe)':'(originprobe)');
 const chip=page.locator('[title^="Executing inside the originprobe subroutine"]');
 const data={callLine,simLine:await page.locator('.simPanel .simLine').textContent(),chipCount:await chip.count(),active:await page.locator(SEL+' .codeLine.active .lineNumber').allTextContents(),text:await page.locator('.sidePane').innerText()};
 writeFileSync(`${OUT}/sub-name-${callLine}.json`,JSON.stringify(data,null,2));await page.screenshot({path:`${OUT}/sub-name-${callLine}.png`});
 await expect(chip,'the Program tab must explain the called-file origin').toBeVisible();
 if(!callLine){await expect(chip).toContainText('in subroutine (originprobe)');await expect(page.locator(SEL+' .codeLine.active')).toHaveCount(0);}
});

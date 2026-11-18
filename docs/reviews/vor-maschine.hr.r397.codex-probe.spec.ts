import { test, expect } from './test';
import { enterTouch } from './touchMode';
import { ctl, MOCK } from './ctl';
import { setTimeout as delay } from 'node:timers/promises';
const PERMS_ALL = {
 idle:true,jog:true,override:true,ready:true,run:true,pause:false,resume:false,step:true,abort:true,
 spindleStop:true,probe:true,zero:true,machineFrame:true,goZero:true,planeFrame:true,touchoff:true,
 touchoffRotary:true,twpCapture:true,surfaceComp:true,safety:true,setup:true,sourceWrite:true,
 toolTableWrite:true,armed:true,always:true,programLoad:true,modeManual:true,modeCoord:true,
 parameterRead:true,g30Write:true,spindleManual:true,armEnable:true,estopReset:true,
};
test.use({hasTouch:true,viewport:{width:1280,height:800}});
async function open(page:any) {
 await ctl({op:'reset'}); await page.goto(MOCK);
 await expect(page.locator('input.setupInput').first()).toBeVisible();await enterTouch(page);
 await ctl({op:'quiet',on:true});
 await ctl({op:'status_delta',data:{active_file:'/A.ngc',homed:[1,1,1],permissions:PERMS_ALL}});
 const b=page.getByRole('button',{name:'Unhome All',exact:true});await expect(b).toBeEnabled();
 const box=(await b.boundingBox())!;
 await ctl({op:'clearCmds'});
 const cdp=await page.context().newCDPSession(page);
 return {cdp,p:{x:box.x+box.width/2,y:box.y+box.height/2}};
}
async function count() {return ((await ctl({op:'lastCmds'})) as any).cmds.filter((c:any)=>c.cmd==='unhome_all').length;}
test.afterEach(async()=>{await ctl({op:'quiet',on:false});await ctl({op:'reset'});});
for (const block of [520,540,600]) test(`real touch tap with ${block} ms block`,async({page})=>{
 test.setTimeout(90_000);const {cdp,p}=await open(page);const rows:any[]=[];
 for(let i=0;i<30;i++) {
  await ctl({op:'status_delta',data:{homed:[1,1,1],permissions:PERMS_ALL}});await ctl({op:'clearCmds'});
  await page.evaluate((ms)=>{
   const w=window as any;w.__trace=[];w.__arm=true;
   if(!w.__installed){
    w.__installed=true;const old=window.setTimeout.bind(window);
    window.setTimeout=((fn:any,n?:number,...args:any[])=>{
     if(n===500&&w.__arm){w.__arm=false;const orig=fn;fn=()=>{w.__trace.push({t:'hold-due',now:performance.now()});orig(...args);};}
     return old(fn,n,...args);
    }) as any;
    for(const t of ['pointerdown','pointerup','pointercancel'])window.addEventListener(t,e=>w.__trace.push({t,now:performance.now(),ts:e.timeStamp,trusted:e.isTrusted}),true);
    const warn=console.warn.bind(console);console.warn=(...x:any[])=>{if(String(x[0]).startsWith('[hold]'))w.__trace.push({t:'hold-log',now:performance.now(),text:String(x[0])});warn(...x);};
   }
   window.addEventListener('pointerdown',()=>setTimeout(()=>{
    const s=performance.now();w.__trace.push({t:'block-start',now:s});while(performance.now()-s<ms){}
    w.__trace.push({t:'block-end',now:performance.now()});
   },0),{once:true});
  },block);
  const t0=Date.now();
  const down=cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
  const up=(async()=>{await delay(120);return cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});})();
  await Promise.all([down,up]);await delay(200);
  const row={block,i,elapsed:Date.now()-t0,fired:await count(),events:await page.evaluate(()=>(window as any).__trace)};
  rows.push(row);console.log('R397 '+JSON.stringify(row));
 }
 const trueTaps=rows.filter(r=>{const d=r.events.find((e:any)=>e.t==='pointerdown');const u=r.events.find((e:any)=>e.t==='pointerup');return d&&u&&u.ts-d.ts<500;});
 console.log('R397-SUMMARY '+JSON.stringify({block,total:rows.length,trueTaps:trueTaps.length,falseFires:trueTaps.filter(r=>r.fired>0).length}));
 expect(trueTaps.length).toBeGreaterThanOrEqual(20);
 // Observation probe: false-fire rows are the finding, not discarded by a fail-fast assertion.
});

test('a deferred old frame must not activate a new short press',async({page})=>{
 const {cdp,p}=await open(page);
 await page.evaluate(()=>{
  const w=window as any;w.__held=[];w.__trace=[];let intercept=false;
  const raf=window.requestAnimationFrame.bind(window);const warn=console.warn.bind(console);
  console.warn=(...x:any[])=>{if(String(x[0]).includes('timer late'))intercept=true;warn(...x);};
  window.requestAnimationFrame=(fn)=>{if(intercept){intercept=false;w.__held.push(fn);w.__trace.push({t:'frame-held',now:performance.now()});return 987654;}return raf(fn);};
  for(const t of ['pointerdown','pointerup'])window.addEventListener(t,e=>w.__trace.push({t,now:performance.now(),ts:e.timeStamp,trusted:e.isTrusted}),true);
  window.addEventListener('pointerdown',()=>setTimeout(()=>{const s=performance.now();while(performance.now()-s<600){}},0),{once:true});
 });
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
 await expect.poll(()=>page.evaluate(()=>(window as any).__held.length)).toBe(1);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 expect(await count()).toBe(0);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
 await page.evaluate(()=>{const w=window as any;w.__trace.push({t:'old-frame-run',now:performance.now()});w.__held.shift()(performance.now());});
 await delay(80);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await delay(150);
 const result={fired:await count(),events:await page.evaluate(()=>(window as any).__trace)};
 console.log('R397-OLD-FRAME '+JSON.stringify(result));
 expect(result.fired).toBe(0);
});

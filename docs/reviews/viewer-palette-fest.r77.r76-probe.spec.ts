import {test, expect, type Page} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {ctl, MOCK} from './ctl';

const selectors=['.statusBanner','.safetyStrip button.flashing'];
const save=(browser:string,name:string,value:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r76.${browser}-${name}.json`,JSON.stringify(value,null,2)+'\n');

async function ready(page:Page){
  await ctl({op:'reset'});
  await page.addInitScript(()=>{
    (window as any).__r76={events:[],refs:[]};
    for(const type of ['animationstart','animationcancel'])document.addEventListener(type,e=>{
      const a=e as AnimationEvent;
      if(a.animationName.startsWith('flash-'))(window as any).__r76.events.push({type,name:a.animationName,at:document.timeline.currentTime});
    },true);
  });
  await page.setViewportSize({width:1600,height:1000});
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'status_delta',data:{estop:false,is_estop:false,enabled:true,is_enabled:true,homed:[1,1,1]}});
  await expect(page.locator('.statusBanner')).toContainText('IDLE');
  await ctl({op:'quiet',on:true});
}
const setState=(estop:boolean,trip:boolean)=>ctl({op:'raw',frame:{type:'status_delta',armed:true,
  data:{estop,is_estop:estop,enabled:!estop,is_enabled:!estop},safety_trip:trip?{reason:'hb_timeout'}:null}});
const starts=(page:Page)=>page.evaluate(sels=>sels.map(s=>document.querySelector(s)?.getAnimations()
  .filter(a=>(a as CSSAnimation).animationName?.startsWith('flash-')).map(a=>a.startTime)??[]),selectors);
const remember=(page:Page)=>page.evaluate(sels=>{
  (window as any).__r76.refs=sels.map(s=>document.querySelector(s)!.getAnimations()
    .find(a=>(a as CSSAnimation).animationName?.startsWith('flash-'))!);
},selectors);
const oldStates=(page:Page)=>page.evaluate(()=>(window as any).__r76.refs.map((a:Animation)=>a.playState));

test.afterEach(async()=>{await ctl({op:'reset'});});

test('R76: CSS still cancels and recreates aligned flashes through state and reduced-motion changes',async({page,browserName})=>{
  await ready(page);
  const snapshots:unknown[]=[];
  const snap=async(label:string)=>snapshots.push({label,starts:await starts(page),oldStates:await oldStates(page)});
  await setState(false,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[]]);
  await page.waitForTimeout(300);
  await setState(true,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[0]]);
  await remember(page);
  await snap('both running');

  // A real status change removes only the button animation. The banner
  // continues to display the unacknowledged trip.
  await setState(false,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[]]);
  await expect.poll(()=>oldStates(page)).toEqual(['running','idle']);
  await snap('button class removed by status');
  await setState(true,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[0]]);
  expect(await page.evaluate(sels=>(window as any).__r76.refs[1]!==document.querySelector(sels[1]!)!.getAnimations()
    .find(a=>(a as CSSAnimation).animationName?.startsWith('flash-')),selectors)).toBe(true);
  await snap('button recreated');

  // The operating-system preference changes while both are active.
  await remember(page);
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>starts(page)).toEqual([[],[]]);
  await expect.poll(()=>oldStates(page)).toEqual(['idle','idle']);
  await snap('reduced motion cancels both');
  await page.waitForTimeout(350);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect.poll(()=>starts(page)).toEqual([[0],[0]]);
  await snap('preference restored');

  await remember(page);
  await setState(false,false);
  await expect(page.locator('.statusBanner')).toContainText('IDLE');
  await expect.poll(()=>starts(page)).toEqual([[],[]]);
  await expect.poll(()=>oldStates(page)).toEqual(['idle','idle']);
  const pulse=await page.locator('.statusBanner').evaluate(e=>e.getAnimations()
    .filter(a=>(a as CSSAnimation).animationName?.startsWith('banner-pulse')).map(a=>a.startTime));
  expect(pulse).toHaveLength(1);
  expect(pulse[0]).toBeGreaterThan(0);
  await snap('status cleared, ordinary pulse unaffected');
  const events=await page.evaluate(()=>(window as any).__r76.events);
  save(browserName,'lifecycle',{userAgent:await page.evaluate(()=>navigator.userAgent),snapshots,pulse,events});
});

test('R76: a CSS flash aligns again after hide/show and DOM removal, without losing CSS ownership',async({page,browserName})=>{
  await ready(page);
  await setState(true,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[0]]);
  // Reuse the real styled button as a detached DOM fixture, including Vue's
  // scoped attributes. No interaction is dispatched to this fixture.
  await page.evaluate(()=>{
    const clone=document.querySelector('.safetyStrip button.flashing')!.cloneNode(true) as HTMLElement;
    clone.id='r76-css-fixture';document.body.appendChild(clone);
    (window as any).__r76.fixture=clone;
  });
  const fixtureStarts=()=>page.locator('#r76-css-fixture').evaluate(e=>e.getAnimations()
    .filter(a=>(a as CSSAnimation).animationName?.startsWith('flash-')).map(a=>a.startTime));
  await expect.poll(fixtureStarts).toEqual([0]);
  await page.locator('#r76-css-fixture').evaluate(e=>{
    (window as any).__r76.fixtureOld=e.getAnimations().find(a=>(a as CSSAnimation).animationName?.startsWith('flash-'));
    (e as HTMLElement).style.display='none';
  });
  await expect.poll(fixtureStarts).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>(window as any).__r76.fixtureOld.playState)).toBe('idle');
  await page.waitForTimeout(250);
  await page.locator('#r76-css-fixture').evaluate(e=>(e as HTMLElement).style.removeProperty('display'));
  await expect.poll(fixtureStarts).toEqual([0]);
  await page.locator('#r76-css-fixture').evaluate(e=>{
    (window as any).__r76.fixtureOld=e.getAnimations().find(a=>(a as CSSAnimation).animationName?.startsWith('flash-'));
    e.remove();
  });
  await expect.poll(()=>page.evaluate(()=>(window as any).__r76.fixtureOld.playState)).toBe('idle');
  await page.waitForTimeout(250);
  await page.evaluate(()=>document.body.appendChild((window as any).__r76.fixture));
  await expect.poll(fixtureStarts).toEqual([0]);
  save(browserName,'remount',{userAgent:await page.evaluate(()=>navigator.userAgent),fixtureStarts:await fixtureStarts(),
    originalStarts:await starts(page),events:await page.evaluate(()=>(window as any).__r76.events)});
});

test('R76: rendered flash colours and timeline progress agree in the browser native colour notation',async({page,browserName})=>{
  await ready(page);
  await setState(false,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[]]);
  await page.waitForTimeout(300);
  await setState(true,true);
  await expect.poll(()=>starts(page)).toEqual([[0],[0]]);
  await page.waitForTimeout(450);
  const samples=await page.evaluate(async sels=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
    const records=[];
    for(let i=0;i<30;i++){
      const at=document.timeline.currentTime;
      const values=sels.map(sel=>{
        const el=document.querySelector(sel)!;
        const colour=getComputedStyle(el).backgroundColor;
        ctx.clearRect(0,0,1,1);ctx.fillStyle=colour;ctx.fillRect(0,0,1,1);
        const rgba=Array.from(ctx.getImageData(0,0,1,1).data);
        const a=el.getAnimations().find(a=>(a as CSSAnimation).animationName?.startsWith('flash-'))!;
        return {colour,rgba,on:Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))>4,
          startTime:a.startTime,currentTime:a.currentTime,progress:a.effect!.getComputedTiming().progress,playState:a.playState};
      });
      records.push({at,values});
      await new Promise(r=>setTimeout(r,45));
    }
    return records;
  },selectors);
  save(browserName,'colour-samples',{userAgent:await page.evaluate(()=>navigator.userAgent),samples});
  expect([...new Set(samples.map(s=>s.values[0]!.on))].sort()).toEqual([false,true]);
  expect([...new Set(samples.map(s=>s.values[1]!.on))].sort()).toEqual([false,true]);
  expect(samples.filter(s=>s.values[0]!.on!==s.values[1]!.on)).toEqual([]);
  expect(samples.every(s=>s.values.every(v=>v.startTime===0&&v.playState==='running'))).toBe(true);
});

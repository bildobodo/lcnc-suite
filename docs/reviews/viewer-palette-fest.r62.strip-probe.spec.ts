import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
import {ctl} from './ctl';
test('R62: compact strips measurements and axes hit targets',async({page})=>{
 test.setTimeout(120000);
 const rows:any[]=[];
 const profiles=[...PROFILES,{name:'9axis',axes:['X','Y','Z','A','B','C','U','V','W'],kins:null}];
 for(const profile of profiles) for(const view of [VIEWPORTS[0],VIEWPORTS[2],VIEWPORTS[3]]){
  await openLayout(page,profile as any,view!);await settleLayout(page);
  const data=await page.evaluate(()=>{
   const jog=document.querySelector('[data-strip="jog"]')!;
   const setup=document.querySelector('[data-strip="setup"]')!;
   return {jogWidth:jog.getBoundingClientRect().width,setupWidth:setup.getBoundingClientRect().width,
    buttons:[...jog.querySelectorAll<HTMLButtonElement>('.axisCluster .jogBtn')].map(b=>{
     const r=b.getBoundingClientRect(),cs=getComputedStyle(b);
     return {name:b.textContent!.trim(),x:r.x,y:r.y,width:r.width,height:r.height,minHeight:Number.isFinite(parseFloat(cs.minHeight))?parseFloat(cs.minHeight):0};
    }),names:[...setup.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label'))};
  });
  rows.push({profile:profile.name,view:view!.name,...data});
  writeFileSync('../evidence/viewer-palette-fest.r62.strip-layout.json',JSON.stringify(rows,null,2)+'\n');
  for(const b of data.buttons) expect.soft(b.height,`${profile.name} ${view!.name} ${b.name}: meets own button floor`).toBeGreaterThanOrEqual(Math.max(b.minHeight,view!.touch?44:28)-0.5);
  for(let i=0;i<data.buttons.length;i++)for(let j=i+1;j<data.buttons.length;j++){
   const a=data.buttons[i]!,b=data.buttons[j]!;
   const overlap=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>0.5 && Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>0.5;
   expect.soft(overlap,`${profile.name} ${view!.name} ${a.name}/${b.name}: disjoint hit areas`).toBe(false);
  }
  if(profile.name==='5axis-xyzac'&&view!.name==='desktop'){
   await page.locator('[data-strip="jog"]').screenshot({path:'../evidence/viewer-palette-fest.r62.strip-jog.png'});
   await page.locator('[data-strip="setup"]').screenshot({path:'../evidence/viewer-palette-fest.r62.strip-setup.png'});
  }
 }
 await ctl({op:'reset'});
});

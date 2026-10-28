import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, settleLayout } from './layout-fixtures';

const OUT='/tmp/codex-r222-gok448x4';
const views=[...VIEWPORTS.map(v=>({...v,zoom:1})),{...VIEWPORTS[3]!,name:'touch-portrait-150',zoom:1.5}];
test('R222 joint marks: geometry, all themes and accessible description',async({page})=>{
  test.setTimeout(90000);
  const profile=PROFILES[1]!;
  const results:any[]=[];
  for(const v of views){
    await page.evaluate(()=>{document.documentElement.style.zoom='';}).catch(()=>{});
    await openLayout(page,profile,v);
    await ctl({op:'quiet',on:true});
    await ctl({op:'setJointJog',jointJog:{enabled:true,fraction:0.1,reason:null,
      axes:profile.axes.map((letter,joint)=>({letter,joint,reason:null}))}});
    await setLayoutState(page,profile,'unhomed',['jog']);
    if(v.zoom!==1)await page.evaluate(z=>{document.documentElement.style.zoom=String(z);},v.zoom);
    await settleLayout(page);
    await expect(page.locator('[data-strip="jog"] .cornerLabel')).toHaveCount(10);
    const strip=page.locator('[data-strip="jog"]');
    for(const theme of ['light','dark','hc-light','hc-dark','auto-dark']){
      await page.emulateMedia({colorScheme:theme==='auto-dark'?'dark':'light',reducedMotion:'reduce'});
      await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:theme==='auto-dark'?'auto':theme}}}});
      if(theme==='auto-dark')await expect(page.locator('html')).not.toHaveAttribute('data-theme',/./);
      else await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      await page.waitForTimeout(180);
      const data=await strip.evaluate(root=>{
        const rect=(r:DOMRect)=>({x:r.x,y:r.y,w:r.width,h:r.height});
        const cv=document.createElement('canvas');cv.width=cv.height=1;
        const cx=cv.getContext('2d',{willReadFrequently:true})!;
        const rgba=(s:string)=>{cx.clearRect(0,0,1,1);cx.fillStyle=s;cx.fillRect(0,0,1,1);return [...cx.getImageData(0,0,1,1).data];};
        const lum=(rgb:number[])=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i]!,0);
        const overlap=(a:DOMRect,b:DOMRect)=>Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
        return [...root.querySelectorAll('.cornerLabel')].map(m=>{
          const b=m.closest('button')!;const mr=m.getBoundingClientRect(),br=b.getBoundingClientRect();
          const fg=rgba(getComputedStyle(m).color),bg=rgba(getComputedStyle(b).backgroundColor);
          const l=[lum(fg),lum(bg)].sort((a,b)=>b-a);
          return {mark:m.textContent,label:b.querySelector('.jogLabel')?.textContent,
            marker:rect(mr),button:rect(br),fg,bg,contrast:(l[0]!+.05)/(l[1]!+.05),
            outside:mr.left<br.left||mr.top<br.top||mr.right>br.right||mr.bottom>br.bottom,
            overlaps:[...b.querySelectorAll('.jogIcon,.jogLabel')].map(e=>({kind:e.getAttribute('class'),area:overlap(mr,e.getBoundingClientRect()),rect:rect(e.getBoundingClientRect())})),
            ariaHidden:m.getAttribute('aria-hidden'),name:b.getAttribute('aria-label'),description:b.getAttribute('aria-description'),describedBy:b.getAttribute('aria-describedby')};
        });
      });
      results.push({viewport:v.name,theme,data});
      if(theme==='light'){
        await strip.screenshot({path:`${OUT}/${v.name}.png`});
        writeFileSync(`${OUT}/${v.name}.aria.txt`,await strip.ariaSnapshot());
      }
    }
  }
  writeFileSync(`${OUT}/visual.json`,JSON.stringify(results,null,2));
  console.log('MARK_RESULTS',JSON.stringify(results.map(r=>({viewport:r.viewport,theme:r.theme,minContrast:Math.min(...r.data.map((m:any)=>m.contrast)),overlaps:r.data.filter((m:any)=>m.overlaps.some((o:any)=>o.area>1)).map((m:any)=>m.label),outside:r.data.filter((m:any)=>m.outside).map((m:any)=>m.label)}))));
});

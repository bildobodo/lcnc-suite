import { test, expect } from '@playwright/test';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState } from './layout-fixtures';

const OUT='/tmp/codex-r223-05gi921x';
test.beforeEach(async({page})=>{
  const profile=PROFILES[1]!;
  await openLayout(page,profile,VIEWPORTS[0]!);
  await ctl({op:'quiet',on:true});
  await ctl({op:'setJointJog',jointJog:{enabled:true,fraction:0.1,reason:null,
    axes:profile.axes.map((letter,joint)=>({letter,joint,reason:null}))}});
  await setLayoutState(page,profile,'unhomed',['jog']);
  await expect(page.locator('[data-strip="jog"] .cornerLabel')).toHaveCount(10);
});

test('R222 the visible joint number meets the text contrast target in dark',async({page})=>{
  await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:'dark'}}}});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.waitForTimeout(200);
  const strip=page.locator('[data-strip="jog"]');
  await strip.screenshot({path:`${OUT}/dark.png`});
  const contrast=await strip.locator('.cornerLabel').first().evaluate(mark=>{
    const cv=document.createElement('canvas');cv.width=cv.height=1;
    const cx=cv.getContext('2d',{willReadFrequently:true})!;
    const read=(s:string)=>{cx.clearRect(0,0,1,1);cx.fillStyle=s;cx.fillRect(0,0,1,1);return [...cx.getImageData(0,0,1,1).data];};
    const lum=(c:number[])=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i]!,0);
    const fg=read(getComputedStyle(mark).color),bg=read(getComputedStyle(mark.closest('button')!).backgroundColor);
    const l=[lum(fg),lum(bg)].sort((a,b)=>b-a);
    return {fg,bg,ratio:(l[0]!+.05)/(l[1]!+.05)};
  });
  console.log('actual visible mark contrast',contrast);
  expect(contrast.fg[3]).toBe(255);expect(contrast.bg[3]).toBe(255);
  expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
});

test('R222 the stable axis name has its new joint target as accessible description',async({page})=>{
  const z=page.locator('[data-strip="jog"]').getByRole('button',{name:'Z+',exact:true});
  await expect(z.locator('.cornerLabel')).toHaveText('J2');
  await expect(z).toBeEnabled();
  console.log('Z+ accessible subtree',await z.ariaSnapshot());
  await expect(z).toHaveAccessibleDescription(/(?:joint|gelenk)\s*2|\bJ2\b/i);
});

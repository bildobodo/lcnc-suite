// Codex R31 extra probes; isolated mock only, ctl.ts points to :4188.
import { test, expect } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync } from 'node:fs';
import { ctl, MOCK } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const OUT = process.env.R31_EVIDENCE || '../evidence';

test('R31 box edge has screen-space casing and core at DPR 1 and 2', async({browser})=>{
  const results = [];
  for(const dpr of [1,2]) {
    const context=await browser.newContext({viewport:{width:1400,height:1000},deviceScaleFactor:dpr});
    const page=await context.newPage();
    await ctl({op:'reset'});
    await page.goto(MOCK);
    await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.ready)).toBe(true);
    await page.waitForTimeout(300);
    await page.evaluate(()=>window.__viewerDiag!.setViewDirection!([1,2,0.7]));
    for(const theme of ['light','dark']) {
      await ctl({op:'raw',frame:{type:'settings_changed',settings:{display:{theme},viewer:{layers:{hud:false,bounds:true,toolpath:false,tool:false,machine:false,workzero:false,groundGrid:false}}}}});
      await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
      await page.waitForTimeout(300);
      const edge=await page.evaluate(()=>window.__viewerDiag!.projectRole!('bounds'));
      expect(edge).not.toBeNull();
      const shot=await page.screenshot({path:`${OUT}/r31.box-dpr${dpr}-${theme}.png`});
      const samples=await page.evaluate(async({png,edge,dpr})=>{
        const img=new Image();img.src=`data:image/png;base64,${png}`; await img.decode();
        const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;
        const cx=cv.getContext('2d',{willReadFrequently:true})!;cx.drawImage(img,0,0);
        return Array.from({length:17*dpr},(_,i)=>{
          const t=i-8*dpr;
          const x=Math.round(edge!.x*dpr-edge!.dy*t),y=Math.round(edge!.y*dpr+edge!.dx*t);
          return {tCss:t/dpr,rgb:Array.from(cx.getImageData(x,y,1,1).data.slice(0,3))};
        });
      },{png:shot.toString('base64'),edge,dpr});
      const palette=await page.evaluate(()=>window.__viewerDiag!.getPalette!());
      results.push({dpr,theme,edge,core:palette.drawn.bounds,casing:palette.drawn.boundsCasing,samples});
    }
    await context.close();
  }
  writeFileSync(`${OUT}/r31.box-profiles.json`,JSON.stringify(results,null,2)+'\n');
});

test('R31 reveal contains only the requested rapid section', async({page,context})=>{
  const feed=Array.from({length:10},(_,i)=>[i*3,i%2?20:0,0]);
  const rapid=[[0,80,0],[90,80,0],[98,20,0],[105,20,0]];
  const preview=Buffer.from(encode({file:'/two-rapids.ngc',preview_schema:9,feed,
    feed_lines:feed.map((_,i)=>i+3),feed_seq:feed.map((_,i)=>i+3),feed_outside:new Uint8Array(10),
    rapid,rapid_lines:[1,2,13,14],rapid_seq:[1,2,13,14],rapid_outside:new Uint8Array([0,0,0,1]),
    violations:[{line:14,axis:'X',value:105,limit:100,kind:'max'}],violations_total:1}));
  await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview}));
  await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:16},(_,i)=>`G1 X${i} F100`).join('\n')}));
  await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
  await ctl({op:'status_delta',data:{active_file:'/two-rapids.ngc'}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:1971,file:'/two-rapids.ngc'}});
  await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag!.projectRole!('rapid'))).not.toBeNull();
  const before=await page.evaluate(()=>window.__viewerDiag!.projectRole!('rapid'));
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{layers:{rapids:false}}}}});
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag!.projectRole!('rapid'))).toBeNull();
  await ctl({op:'status_delta',data:{is_enabled:false,enabled:false}});
  await page.locator('.scrubBar [aria-label="Next limit violation"]').click();
  await expect(page.locator('[data-path-reveal]')).toHaveCount(1);
  const after=await page.evaluate(()=>window.__viewerDiag!.projectRole!('rapid'));
  const data={remoteRapid:[[0,80,0],[90,80,0]],findingRapid:[[98,20,0],[105,20,0]],before,after,
    notice:await page.locator('[data-path-reveal]').textContent()};
  writeFileSync(`${OUT}/r31.multirapids.json`,JSON.stringify(data,null,2)+'\n');
  await page.screenshot({path:`${OUT}/r31.multirapids.png`});
  expect(after!.length,'The 90 mm rapid away from the 7 mm finding should stay hidden').toBeLessThan(before!.length/2);
});


test('R31 custom box contrast labels the failing comparison', async({page})=>{
  await ctl({op:'reset'});
  await page.goto(MOCK);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.ready)).toBe(true);
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{display:{theme:'light'},viewer:{paletteMode:'custom',colors:{bounds:'#3a3f45',toolpathBounds:'#3a3f45'}}}}});
  await page.getByTitle('Settings',{exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  await dialog.getByRole('tab',{name:'3D Viewer',exact:true}).click();
  const row=dialog.locator('[data-contrast-hint] tr[data-role="bounds"]');
  await row.scrollIntoViewIfNeeded();
  const cells=await row.locator('td').allTextContents();
  const all=await dialog.locator('[data-contrast-hint]').textContent();
  writeFileSync(`${OUT}/r31.custom.json`,JSON.stringify({customCore:'#3a3f45',fixedCasing:'#3a3f45',coreCasingRatio:1,cells,table:all},null,2)+'\n');
  await page.screenshot({path:`${OUT}/r31.custom.png`});
  expect(cells[1],'The passing 10.6:1 background ratio is not the low core/casing ratio').not.toContain('low');
});

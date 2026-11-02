import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, settleLayout } from './layout-fixtures';
import { ctl } from './ctl';

const out = '/tmp/codex-r252-x76aweny/browser';
mkdirSync(out, {recursive:true});
test.afterEach(async () => { await ctl({op:'reset'}); });

for (const profile of PROFILES.slice(0,2)) {
  for (const vp of VIEWPORTS.filter(v=>['desktop','touch-fullhd','touch-portrait'].includes(v.name))) {
    test(`${profile.name} ${vp.name}: real glyphs and the old width`, async ({page,browser}, info) => {
      await openLayout(page,profile,vp);
      const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
      const side=page.locator('.sidePane');
      await side.getByRole('tab',{name:'Probing',exact:true}).click();
      const observations:any[]=[];
      const measure=()=>side.locator('.gridCell').evaluateAll(els=>els.map(el=>{
        const r=el.getBoundingClientRect(), svg=el.querySelector('svg')!;
        const s=svg.getBoundingClientRect(), b=svg.getBBox();
        return {cell:[r.width,r.height],svg:[s.width,s.height],drawing:[b.width,b.height]};
      }));
      for (const state of ['homed','unhomed'] as const) {
        await setLayoutState(page,profile,state);
        const paramTops:number[]=[];
        for (const sub of ['Outside','Inside','Angle','Boss/Pocket','Ridge/Valley','Calibrate']) {
          await side.getByRole('tab',{name:sub,exact:true}).click();
          await settleLayout(page);
          const cells=await measure();
          expect(cells.length).toBeGreaterThanOrEqual(4);
          for (const c of cells) {
            expect(c.cell[0]).toBeGreaterThanOrEqual(44);
            expect(Math.abs(c.cell[0]-c.cell[1])).toBeLessThanOrEqual(1);
            expect(c.svg[0]).toBeGreaterThanOrEqual(40);
            expect(c.svg[1]).toBeGreaterThanOrEqual(40);
            expect(c.drawing[0]).toBeGreaterThan(0);
            expect(c.drawing[1]).toBeGreaterThan(0);
          }
          const geometry=await side.locator('.gridSection').evaluate(el=>{
            el.closest('.scroll-thin, .tab-content')?.scrollTo(0,0);
            const r=el.getBoundingClientRect();
            const kids=[...el.querySelectorAll('.gridCell')].map(c=>c.getBoundingClientRect());
            return {bottom:r.bottom, lastCellBottom:Math.max(...kids.map(c=>c.bottom)),
              parameterTop:(el.nextElementSibling??el).getBoundingClientRect().top};
          });
          expect(geometry.lastCellBottom).toBeLessThanOrEqual(geometry.bottom+1);
          paramTops.push(Math.round(geometry.parameterTop));
          observations.push({state,sub,cells,geometry});
          if (state==='homed' && sub==='Outside') {
            await side.screenshot({path:`${out}/${info.project.name}-${profile.name}-${vp.name}.png`});
            const old=await page.addStyleTag({content:'.gridWrap {width:auto !important;max-width:294px !important;}'});
            await settleLayout(page);
            const oldCells=await measure();
            observations.push({oldWidth:oldCells});
            if(info.project.name==='firefox159') {
              // The old content-width collapse reaches the global compact
              // touch minimum (36 px); desktop reaches padding alone (10 px).
              expect(oldCells.map(c=>[c.cell[0],c.svg[0]]),JSON.stringify(oldCells))
                .toEqual(oldCells.map(()=>vp.touch ? [36,26] : [10,0]));
            }
            await old.evaluate(el=>el.remove());
            await settleLayout(page);
            expect(await measure()).toEqual(cells);
          }
        }
        expect(new Set(paramTops).size,JSON.stringify(paramTops)).toBe(1);
      }
      expect(errors).toEqual([]);
      writeFileSync(`${out}/${info.project.name}-${profile.name}-${vp.name}.json`,JSON.stringify({browser:browser.version(),profile:profile.name,viewport:vp,observations},null,2));
    });
  }
}

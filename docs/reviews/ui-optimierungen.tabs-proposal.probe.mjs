// Exercises the standalone visual proposal only, with no server or machine.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const require=createRequire(resolve('lcnc-webui/package.json'));
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const report={date:'2026-09-23',target:'compact standalone design proposal, not product UI',profiles:[]};
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve('docs/reviews/ui-optimierungen.design-proposal.html')).href);
  // Historical scroll-tab comparison; the default recommendation now uses
  // a picker for methods and is checked by navigation-picker.probe.mjs.
  await page.locator('#nav-style').selectOption('scroll');
  const main=page.getByRole('tablist',{name:'Arbeitsbereiche',exact:true});
  const sub=page.getByRole('tablist',{name:'Probing-Verfahren',exact:true});
  await expect(main.getByRole('tab',{name:'Probing',exact:true})).toHaveAttribute('aria-selected','true');
  await sub.getByRole('tab',{name:'Outside',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(sub.getByRole('tab',{name:'Inside',exact:true})).toBeFocused();
  await expect(sub.getByRole('tab',{name:'Outside',exact:true})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('Enter');
  await expect(sub.getByRole('tab',{name:'Inside',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(main.getByRole('tab',{name:'Probing',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#method-panel-inside')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#method-panel-inside').getByRole('button',{name:'Messung starten',exact:true})).toBeFocused();
  await main.getByRole('tab',{name:'MDI',exact:true}).click();
  await expect(page.locator('#nav-panel-mdi')).toBeVisible();
  await expect(page.locator('#nav-panel-probe')).not.toBeVisible();
  await main.getByRole('tab',{name:'Probing',exact:true}).click();
  await expect(sub.getByRole('tab',{name:'Inside',exact:true})).toHaveAttribute('aria-selected','true');
  await sub.getByRole('tab',{name:'Outside',exact:true}).click();
  for(const profile of [
    {name:'light',width:1400,dark:false,touch:false},
    {name:'dark',width:1400,dark:true,touch:false},
    {name:'touch-600',width:600,dark:false,touch:true},
    {name:'touch-450',width:450,dark:false,touch:true},
  ]){
    await page.setViewportSize({width:profile.width,height:1000});
    await page.locator('#dark').setChecked(profile.dark);
    await page.locator('#touch').setChecked(profile.touch);
    await sub.getByRole('tab',{name:'Outside',exact:true}).click();
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const metrics=await page.evaluate(()=>({
      pageOverflow:document.documentElement.scrollWidth>innerWidth,
      tabs:[...document.querySelectorAll('#navigation-example [role=tablist]')].map(el=>({
        name:el.getAttribute('aria-label'),height:el.getBoundingClientRect().height,
        scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
        minTabHeight:Math.min(...[...el.querySelectorAll('[role=tab]')].map(t=>t.getBoundingClientRect().height)),
        selectedCount:el.querySelectorAll('[aria-selected="true"]').length,
        tabStops:el.querySelectorAll('[role=tab][tabindex="0"], [role=tab]:not([tabindex])').length,
      })),
    }));
    expect(metrics.pageOverflow).toBe(false);
    for(const row of metrics.tabs){expect(row.selectedCount).toBe(1);expect(row.tabStops).toBe(1);if(profile.touch)expect(row.minTabHeight).toBeGreaterThanOrEqual(44)}
    if(profile.touch){
      await sub.getByRole('tab',{name:'Outside',exact:true}).focus();
      await page.keyboard.press('End');
      await expect(sub.getByRole('tab',{name:'Toolsetter',exact:true})).toBeFocused();
      await page.keyboard.press('Space');
      await expect(page.locator('#method-panel-toolsetter')).toBeVisible();
      expect(await sub.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
      await sub.getByRole('tab',{name:'Toolsetter',exact:true}).press('Home');
      await page.keyboard.press('Enter');
    }
    await main.getByRole('tab',{name:'Probing',exact:true}).focus();
    const path=`docs/reviews/ui-optimierungen.consistency-tabs-${profile.name}.png`;
    await page.locator('#navigation-example').screenshot({path});
    report.profiles.push({...profile,...metrics,screenshot:path});
  }
  // The existing separate layout example must not affect the main/nested tabs.
  await page.getByRole('tablist',{name:'Layoutbeispiele',exact:true}).getByRole('tab',{name:'Program',exact:true}).click();
  await expect(page.locator('#panel-program')).toBeVisible();
  await expect(main.getByRole('tab',{name:'Probing',exact:true})).toHaveAttribute('aria-selected','true');
  await page.emulateMedia({forcedColors:'active'});
  const colors=await sub.getByRole('tab',{name:'Outside',exact:true}).evaluate(el=>({border:getComputedStyle(el).borderBottomStyle,width:getComputedStyle(el).borderBottomWidth}));
  expect(colors.width).toBe('3px');
  expect(errors).toEqual([]);
  report.forcedColorsSelection=colors;report.pageErrors=errors;
  await writeFile('docs/reviews/ui-optimierungen.tabs-proposal.evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}

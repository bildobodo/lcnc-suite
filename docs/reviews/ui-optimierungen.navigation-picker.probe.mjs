// Recommended navigation variant: five fixed main tabs + method picker.
// Standalone proposal only; no server, extension or machine connection.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const require=createRequire(resolve('lcnc-webui/package.json'));
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const report={date:'2026-09-23',scope:'Standalone proposal, no product acceptance',cases:[]};
try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve('docs/reviews/ui-optimierungen.design-proposal.html')).href);
  const frame=page.locator('#navigation-example');
  await expect(page.locator('#nav-style')).toHaveValue('picker');
  const method=frame.getByRole('combobox',{name:'Verfahren',exact:true});
  await expect(method.locator('option')).toHaveCount(8);
  await method.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(page.locator('#method-panel-inside')).toBeVisible();
  for(const width of ['522','271','570']){
    await page.locator('#pane-width').selectOption(width);
    await expect(method).toHaveValue('method-inside');
    for(const id of ['outside','inside','angle','boss','ridge','surface','cal','toolsetter']){
      await method.selectOption(`method-${id}`);
      await expect(page.locator(`#method-panel-${id}`)).toBeVisible();
    }
    if(width==='271'){
      const area=frame.getByRole('combobox',{name:'Bereich',exact:true});
      await area.selectOption('nav-mdi');await expect(page.locator('#nav-panel-mdi')).toBeVisible();
      await area.selectOption('nav-probe');
    }else{
      await frame.getByRole('tab',{name:'MDI',exact:true}).click();
      await frame.getByRole('tab',{name:'Probing',exact:true}).click();
    }
    await expect(method).toHaveValue('method-toolsetter');
    await method.selectOption('method-inside');
  }
  await method.selectOption('method-outside');
  for(const p of [
    {width:'522',touch:false,dark:false},
    {width:'522',touch:true,dark:false},
    {width:'522',touch:true,dark:true},
    {width:'271',touch:true,dark:false},
  ]){
    await page.locator('#pane-width').selectOption(p.width);await page.locator('#touch').setChecked(p.touch);await page.locator('#dark').setChecked(p.dark);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const metrics=await frame.evaluate(el=>{
      const r=el.getBoundingClientRect();
      const visible=e=>!!e.getClientRects().length;
      const lists=[...el.querySelectorAll('[role=tablist]')].filter(visible);
      return {width:r.width,height:r.height,tabCount:lists.reduce((n,l)=>n+l.querySelectorAll('[role=tab]').length,0),
        visibleScrollArrows:[...el.querySelectorAll('.tab-scroll')].filter(visible).length,
        horizontalOverflow:el.scrollWidth>el.clientWidth+1||lists.some(l=>l.scrollWidth>l.clientWidth+1),
        minActionHeight:Math.min(...[...el.querySelectorAll('#method-panel-outside .nav-actions button')].map(b=>b.getBoundingClientRect().height)),
        methodHeight:el.querySelector('#probe-method-tabs-choice').getBoundingClientRect().height};
    });
    expect(metrics.horizontalOverflow).toBe(false);expect(metrics.visibleScrollArrows).toBe(0);
    expect(metrics.tabCount).toBe(p.width==='522'?5:0);
    if(p.touch){expect(metrics.methodHeight).toBeGreaterThanOrEqual(44);expect(metrics.minActionHeight).toBeGreaterThanOrEqual(44)}
    const screenshot=`docs/reviews/ui-optimierungen.navigation-picker-${p.width}-${p.touch?'touch':'desktop'}-${p.dark?'dark':'light'}.png`;
    await frame.screenshot({path:screenshot});report.cases.push({...p,...metrics,screenshot});
  }
  expect(errors).toEqual([]);report.pageErrors=errors;
  await writeFile('docs/reviews/ui-optimierungen.navigation-picker.evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}finally{await browser.close()}

// Measures the real product on an isolated mock, then compares both modes
// of the standalone proposal at the actual inner pane widths. No LinuxCNC.
// Run mock-gateway on loopback:4186 with the current production build.
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve('lcnc-webui/package.json'));
const {chromium,expect}=require('@playwright/test');
const WebSocket=require('ws');
const ctl=op=>new Promise((res,rej)=>{
  const ws=new WebSocket('ws://127.0.0.1:4186/ctl');
  ws.once('open',()=>ws.send(JSON.stringify(op)));
  ws.once('message',d=>{ws.close();res(JSON.parse(String(d)))});ws.once('error',rej);
});
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const report={date:'2026-09-23',productCommit:'691e642',zoomMethod:'CSS zoom, not native browser zoom',product:[],proposal:[]};
try{
  for(const profile of [
    {name:'desktop',width:1600,height:1000,touch:false},
    {name:'landscape-touch',width:1280,height:800,touch:true},
    {name:'portrait-touch',width:900,height:1200,touch:true},
  ]){
    await ctl({op:'reset'});
    const page=await browser.newPage({viewport:{width:profile.width,height:profile.height},hasTouch:profile.touch});
    await page.goto('http://127.0.0.1:4186/');await expect(page.locator('.pill.armed')).toBeVisible();
    if(profile.touch)await page.evaluate(()=>document.documentElement.classList.add('touch-device'));
    for(const tab of ['Program','Probing']){
      await page.evaluate(()=>document.documentElement.style.zoom='1');
      await page.getByRole('button',{name:tab,exact:true}).click();
      for(const zoom of [1,1.5,2]){
        await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        const geometry=await page.evaluate(z=>{
          const pane=document.querySelector('.sidePane'),p=pane.getBoundingClientRect(),s=getComputedStyle(pane);
          const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {width:r.width/z,height:r.height/z,top:(r.top-p.top)/z}};
          return {pane:rect(pane),contentWidth:p.width/z-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),
            contentHeight:p.height/z-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom)-parseFloat(s.borderTopWidth)-parseFloat(s.borderBottomWidth),
            mainTabs:rect(pane.querySelector('.topBar')),subTabs:rect(pane.querySelector('.viewTabs')),firstContent:rect(pane.querySelector('.probePanel')),
            paneWithinViewport:p.right<=innerWidth+.5&&p.bottom<=innerHeight+.5,
            paneRight:p.right,viewportWidth:innerWidth};
        },zoom);
        report.product.push({...profile,tab,zoom,...geometry});
      }
    }
    await page.close();
  }
  const page=await browser.newPage({viewport:{width:1400,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve('docs/reviews/ui-optimierungen.design-proposal.html')).href);
  // Preserve the measured scroll-tab comparison from the first density audit.
  await page.locator('#nav-style').selectOption('scroll');
  for(const touch of [false,true]){
    await page.locator('#touch').setChecked(touch);
    for(const width of ['522','570','271']){
      await page.locator('#pane-width').selectOption(width);
      for(const compact of [false,true]){
        await page.locator('#compact-tabs').setChecked(compact);
        await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        const geometry=await page.locator('#navigation-example').evaluate(el=>{
          const frame=el.getBoundingClientRect();
          const firstActions=el.querySelector('#method-panel-outside .nav-actions').getBoundingClientRect();
          const fields=el.querySelector('.nav-form').getBoundingClientRect();
          return {width:frame.width,height:frame.height,actionsTop:firstActions.top-frame.top,actionsHeight:firstActions.height,
            fieldsTop:fields.top-frame.top,fieldsHeight:fields.height,
            choiceVisible:[...el.querySelectorAll('.tab-choice')].filter(e=>e.getClientRects().length).length,
            mainTabVisible:!!el.querySelector('[aria-label="Arbeitsbereiche"]').getClientRects().length,
            actionRows:[...new Set([...el.querySelectorAll('#method-panel-outside .nav-actions button')].map(b=>Math.round(b.getBoundingClientRect().top)))].length,
            minActionHeight:Math.min(...[...el.querySelectorAll('#method-panel-outside .nav-actions button')].map(b=>b.getBoundingClientRect().height))};
        });
        expect(Math.abs(geometry.width-Number(width))).toBeLessThan(1);
        expect(geometry.minActionHeight).toBeGreaterThanOrEqual(touch?44:32);
        if(compact&&width==='271')expect(geometry.choiceVisible).toBe(2);
        const path=`docs/reviews/ui-optimierungen.panel-density-${width}-${touch?'touch':'desktop'}-${compact?'compact':'spacious'}.png`;
        if(touch&&width!=='570')await page.locator('#navigation-example').screenshot({path});
        report.proposal.push({touch,requestedWidth:Number(width),compact,...geometry,screenshot:touch&&width!=='570'?path:null});
      }
    }
  }
  // The compact navigation switches form without losing current selections.
  const frame=page.locator('#navigation-example');
  await frame.getByRole('combobox',{name:'Verfahren',exact:true}).selectOption('method-toolsetter');
  await expect(page.locator('#method-panel-toolsetter')).toBeVisible();
  await frame.getByRole('combobox',{name:'Bereich',exact:true}).selectOption('nav-tools');
  await expect(page.locator('#nav-panel-tools')).toBeVisible();
  await page.locator('#pane-width').selectOption('522');
  await expect(frame.getByRole('tab',{name:'Tools',exact:true})).toHaveAttribute('aria-selected','true');
  await frame.getByRole('tab',{name:'Probing',exact:true}).click();
  await expect(frame.getByRole('tab',{name:'Toolsetter',exact:true})).toHaveAttribute('aria-selected','true');
  await frame.getByRole('tab',{name:'Outside',exact:true}).click();
  await page.locator('#pane-width').selectOption('120');
  await expect(page.locator('#narrow-layout-note')).toBeVisible();
  expect(errors).toEqual([]);report.pageErrors=errors;
  report.limitations=['Mock without a loaded program; banner/strip state affects available height',
    'Proposal panels are schematic, not the complete product forms',
    '120 px pane width is not accepted as a usable layout',
    'CSS zoom probes do not establish native Firefox/macOS zoom behavior'];
  await writeFile('docs/reviews/ui-optimierungen.panel-density.evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.proposal,null,2));
}finally{await browser.close()}

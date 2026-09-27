// R14: real UI paths affected by the global statusNote flex rules.
// Run from repository root, own built-frontend mock on 127.0.0.1:4190.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const origin = 'http://127.0.0.1:4190';
const prefix = fileURLToPath(new URL('./viewer-kontrast.implementation-r5', import.meta.url));
const result = { head: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(), origin, checks: [], samples: [], errors: [] };
const ctl = op => new Promise((resolve,reject) => {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
  const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 6000);
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
  ws.once('error', e => {clearTimeout(timer);reject(e);});
});
const browser = await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']});
const context = await browser.newContext({viewport:{width:1200,height:900}});
await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on('pageerror', e => result.errors.push(e.message));
const check = async (name, f) => {
  try { await f(); result.checks.push({name,pass:true}); }
  catch (e) { result.checks.push({name,pass:false,error:String(e)}); }
  console.log(JSON.stringify(result.checks.at(-1)));
};
const open = async () => {
  await ctl({op:'reset'}); await page.goto(origin);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
};
const layout = async (portrait) => {
  await page.setViewportSize(portrait ? {width:900,height:1200} : {width:1200,height:900});
  await page.evaluate(p => {
    document.documentElement.style.zoom=p ? '1.5' : '';
    document.documentElement.classList.toggle('touch-device', p);
  },portrait);
  await page.waitForTimeout(200);
};
const measure = note => note.evaluate(e => {
  const rect = r => ({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
  return {text:e.textContent.trim(),note:rect(e.getBoundingClientRect()),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,
    children:[...e.childNodes].map(c=>({type:c.nodeType,tag:c.nodeName,text:c.textContent.trim()})),
    buttons:[...e.querySelectorAll('button')].map(b=>{
      const r=document.createRange();r.selectNodeContents(b);
      const s=getComputedStyle(b);
      return {name:b.getAttribute('aria-label')||b.textContent.trim(),box:rect(b.getBoundingClientRect()),text:rect(r.getBoundingClientRect()),flex:s.flex,minWidth:s.minWidth};
    })};
});
const textFits = m => {
  for (const b of m.buttons) {
    expect(b.text.left, b.name+' left').toBeGreaterThanOrEqual(b.box.left-1);
    expect(b.text.right, b.name+' right').toBeLessThanOrEqual(b.box.right+1);
    expect(b.box.left, b.name+' within note left').toBeGreaterThanOrEqual(m.note.left-1);
    expect(b.box.right, b.name+' within note right').toBeLessThanOrEqual(m.note.right+1);
  }
};
try {
  await check('Import result: close stays an icon button at desktop and portrait 150%', async () => {
    const row={T:1,type:'endmill',D:6,current_diameter:6,Z:-42.3,description:'Updated Fusion cutter',current_description:'Measured cutter',reason:null,match:'number'};
    await page.route('**/import-tool-library',route=>route.fulfill({json:{ok:true,tools:[row],total:1,existing_count:3,skipped_duplicates:[],metadata_refresh:{rows:[row],updated:[1],skipped:[],revision:'reviewed-revision'}}}));
    await page.route('**/import-tool-library/refresh',route=>route.fulfill({json:{ok:true,updated:1,skipped:0}}));
    await open();
    await page.getByRole('tab',{name:'Tools',exact:true}).click();
    await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles({name:'tools.json',mimeType:'application/json',buffer:Buffer.from('{"data":[]}')});
    await page.getByRole('button',{name:'Update metadata',exact:true}).click();
    const note=page.locator('.statusNote.ok');
    await expect(note).toContainText('Updated metadata for 1 tools');
    for (const portrait of [false,true]) {
      await layout(portrait); await note.scrollIntoViewIfNeeded();
      const current=await measure(note);
      await page.screenshot({path:`${prefix}-import-${portrait?'portrait':'desktop'}.png`});
      result.samples.push({scenario:'import',portrait,measurement:current});
      const scale=portrait ? 1.5 : 1;
      const b=current.buttons[0].box;
      expect(current.buttons[0].name).toBe('Dismiss import result');
      expect(b.width, 'close keeps icon size').toBeLessThanOrEqual(44*scale);
      expect(current.note.right-b.right, 'close at right edge').toBeLessThan(16*scale);
      textFits(current);
    }
    await note.getByRole('button',{name:'Dismiss import result',exact:true}).click();
    await expect(note).toHaveCount(0);
  });
  await check('Editor conflict: both actions and their labels fit after wrapping', async () => {
    await layout(false);
    await page.route('**/gcode?*',route=>route.fulfill({contentType:'text/plain',body:'(review)\nG0 X0\nG1 X10 F100\nM2\n'}));
    await open();
    const load = async (file,version) => {
      await ctl({op:'status_delta',data:{active_file:file}});
      await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version,file}});
      await expect(page.locator('.fileName')).toHaveText(file.slice(1));
    };
    await load('/A.ngc',8001);
    // The filename changes before the async file text arrives. Match the
    // existing editor-guards setup: edit only after content is displayed.
    await expect(page.locator('.codeLine').first()).toContainText('(review)');
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await load('/B.ngc',8002);
    const note=page.locator('[data-edit-conflict]');
    for(const portrait of [false,true]) {
      await layout(portrait); await note.scrollIntoViewIfNeeded();
      const m=await measure(note);result.samples.push({scenario:'conflict',portrait,measurement:m});
      textFits(m);
    }
    await note.getByRole('button',{name:'Keep editing',exact:true}).click();
    await expect(note).toHaveCount(0);
  });
  await check('File browser retry: action stays readable and works at portrait 150%', async () => {
    let failed=true;
    await page.route(url=>url.pathname==='/files',route=>failed
      ? route.fulfill({status:503,json:{detail:'Program folder temporarily unavailable'}})
      : route.fulfill({json:{ok:true,nc_dir:'/nc_files',subdir:'',entries:[{name:'a.ngc',type:'file',path:'a.ngc',size:20}]}}));
    await open();await layout(false);
    await page.getByRole('button',{name:'Files',exact:true}).click();
    const region=page.getByRole('region',{name:'Server programs'}),note=region.locator('.statusNote.error');
    await expect(note).toBeVisible();await layout(true);await note.scrollIntoViewIfNeeded();
    const m=await measure(note);result.samples.push({scenario:'retry',portrait:true,measurement:m});textFits(m);
    failed=false;await note.getByRole('button',{name:'Retry',exact:true}).click();
    await expect(note).toHaveCount(0);await expect(region.getByRole('button',{name:'a.ngc',exact:true})).toBeVisible();
  });
} catch(e) { result.fatal=String(e); }
finally { await writeFile(prefix+'.notes.json',JSON.stringify(result,null,2)+'\n');await context.close();await browser.close(); }
console.log(JSON.stringify({checks:result.checks,errors:result.errors,fatal:result.fatal}));

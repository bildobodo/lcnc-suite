// Independent review: warning-card overflow and the HelpIcon hit area. Mock only; a reversible browser-only negative control restores the former padding.
// Build lcnc-webui; start its mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
// Run from the repository root: nice -n 15 node docs/reviews/ui-design-welle.implementation-r10-help.probe.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const { encode } = require('@msgpack/msgpack');
const feed = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const previewData = { file: '/leak.ngc', preview_schema: 9, feed,
  feed_lines: feed.map((_, i) => i + 3), feed_seq: feed.map((_, i) => i + 3),
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2],
};
let preview = Buffer.from(encode(previewData));
const origin = 'http://127.0.0.1:4188';
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r10-help', import.meta.url));
function ctl(op) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.once('open', () => ws.send(JSON.stringify(op)));
    ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
    ws.once('error', reject);
  });
}
const result = { head: '3479692', origin, layouts: [], errors: [] };
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.origin !== origin) return r.abort();
  if (u.pathname === '/preview') return r.fulfill({ contentType: 'application/octet-stream', body: preview });
  if (u.pathname === '/gcode') return r.fulfill({ contentType: 'text/plain', body: '(Review R10)\nG0 X0\nG1 X10 F100\nM2\n' });
  return r.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(7000);
page.on('pageerror', e => result.errors.push(e.message));
const settings = async scale => ctl({ op: 'raw', frame: { type: 'settings_init', settings: {
  display: { theme: 'light' }, viewer: { hud: { scale, showMachine: true } },
} } });

async function measure() {
 return page.evaluate(()=>{
  const body=document.querySelector('.hudNotesBody'),card=body.closest('.hudNotes'),icon=body.querySelector('.helpIcon');
  const r=icon.getBoundingClientRect(),cs=getComputedStyle(icon),z=r.width/icon.offsetWidth;
  const d=(parseFloat(cs.getPropertyValue('--help-hit'))/2-1)*z,cx=r.x+r.width/2,cy=r.y+r.height/2;
  const points={centre:[cx,cy],top:[cx,cy-d],bottom:[cx,cy+d],right:[cx+d,cy],left:[cx-d,cy]};
  const hit=([x,y])=>{const at=document.elementFromPoint(x,y);return !!at&&(at===icon||icon.contains(at));};
  const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,right:b.right};};
  const bcs=getComputedStyle(body);
  return {card:rect(card),body:rect(body),scrollWidth:body.scrollWidth,clientWidth:body.clientWidth,
    scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,pointerEvents:bcs.pointerEvents,
    bodyClass:body.className,notesOpen:card.classList.contains('notesOpen'),padding:bcs.padding,margin:bcs.margin,
    points,hits:Object.fromEntries(Object.entries(points).map(([k,p])=>[k,hit(p)])),
    text:body.innerText,icon:rect(icon),pane:rect(document.querySelector('.viewerWrapper'))};
 });
}
try {
 result.scenes=[];
 for(const vp of [{name:'desktop',width:1600,height:1000,zoom:1,touch:false},
   {name:'portrait',width:900,height:1200,zoom:1,touch:true},
   {name:'portrait150',width:900,height:1200,zoom:1.5,touch:true}]) {
  for(const lines of ['alone','first']) {
   await ctl({op:'reset'});await page.setViewportSize({width:vp.width,height:vp.height});await page.goto(origin);
   await expect(page.locator('input.setupInput').first()).toBeVisible();
   await page.evaluate(v=>{document.documentElement.classList.toggle('touch-device',v.touch);document.documentElement.style.zoom=String(v.zoom);},vp);
   await ctl({op:'setAxes',axes:['X','Y','Z','A','C']});
   await ctl({op:'setKins',kins:{module:'xyzac-trt-kins',type:'xyzac-trt',identity_first:true,params:{}}});
   await ctl({op:'status_delta',armed:true,data:{kins_type:0,g5x_index:1,rotary_abc:[20,0,0],
     eoffset_enabled:lines==='first',eoffset_z:0.123,rotation_xy:lines==='first'?12:0}});
   await settings('md');await page.evaluate(()=>document.fonts.ready);
   await expect(page.locator('.hudMode')).toContainText('off datum');await page.waitForTimeout(600);
   if(await page.locator('.notesToggle').isVisible()){await page.locator('.notesToggle').click();await page.waitForTimeout(400);}
   const entry={vp,lines,measured:await measure()};result.scenes.push(entry);
   await page.screenshot({path:`${out}-${vp.name}-${lines}.png`});
   // Actual pointer click at the right edge of the invisible hit area.
   const [x,y]=entry.measured.points.right;await page.mouse.click(x,y);
   await expect(page.locator('.hudNotesBody .helpPopover:popover-open')).toBeVisible();
   entry.helpOpenedByEdge=true;await page.mouse.click(x,y);
   await expect(page.locator('.hudNotesBody .helpPopover:popover-open')).toHaveCount(0);
   if(vp.name==='desktop'&&lines==='alone'){
     await page.locator('.hudNotesBody').evaluate(e=>{e.style.padding='0';e.style.margin='0';});
     await page.waitForTimeout(500);entry.negativeControl=await measure();
     await page.screenshot({path:`${out}-negative-control.png`});
     await page.locator('.hudNotesBody').evaluate(e=>{e.style.removeProperty('padding');e.style.removeProperty('margin');});
     await page.waitForTimeout(500);entry.restored=await measure();
   }
  }
 }
 result.commands=(await ctl({op:'lastCmds'})).cmds;
} catch(e){result.fatal=String(e.stack||e);process.exitCode=1;}
finally {await writeFile(`${out}.json`,JSON.stringify(result,null,2)+'\n');await browser.close();}

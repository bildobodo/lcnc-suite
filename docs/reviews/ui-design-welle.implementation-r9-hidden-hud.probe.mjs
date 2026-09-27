// Independent review: the viewer cap and simulation label while the optional HUD layer is hidden. Mock only.
// Build lcnc-webui; start its mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
// Run from the repository root: nice -n 15 node docs/reviews/ui-design-welle.implementation-r9-hidden-hud.probe.mjs
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
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r9-hidden-hud', import.meta.url));
function ctl(op) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.once('open', () => ws.send(JSON.stringify(op)));
    ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
    ws.once('error', reject);
  });
}
const result = { head: '0418850', origin, layouts: [], errors: [] };
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.origin !== origin) return r.abort();
  if (u.pathname === '/preview') return r.fulfill({ contentType: 'application/octet-stream', body: preview });
  if (u.pathname === '/gcode') return r.fulfill({ contentType: 'text/plain', body: '(Review R9)\nG0 X0\nG1 X10 F100\nM2\n' });
  return r.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(7000);
page.on('pageerror', e => result.errors.push(e.message));
const settings = async scale => ctl({ op: 'raw', frame: { type: 'settings_init', settings: {
  display: { theme: 'light' }, viewer: { hud: { scale, showMachine: true } },
} } });

async function surroundingCards() {
  return page.evaluate(() => {
    const box = e => { if (!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}; };
    const get = s => document.querySelector(s);
    const hit = e => { if(!e)return null;const b=box(e),t=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return !!t&&(e===t||e.contains(t)); };
    const body = get('.findingsRow');
    return {pane:box(get('.viewerWrapper')),banner:box(get('.simBanner')),notes:box(get('.hudNotes')),
      bottom:box(get('.viewerBottom')),scrub:box(get('.scrubBar')),hud:box(get('.hudCard')),
      cap:get('.viewerWrapper').style.getPropertyValue('--viewer-bottom-max'),
      more:{box:box(get('.moreToggle')),hit:hit(get('.moreToggle')),open:get('.moreToggle')?.getAttribute('aria-expanded')},
      notesToggle:{box:box(get('.notesToggle')),hit:hit(get('.notesToggle')),open:get('.notesToggle')?.getAttribute('aria-expanded')},
      bannerHelpHit:hit(get('.simBanner [role="button"]')),
      findings:{box:box(body),scrollTop:body.scrollTop,clientHeight:body.clientHeight,scrollHeight:body.scrollHeight,pointerEvents:getComputedStyle(body).pointerEvents},
    };
  });
}

try {
  const points=feed.map(p=>[...p]);points[29][0]=120;
  preview=Buffer.from(encode({...previewData,feed:points,
    feed_outside:new Uint8Array(points.map(p=>p[0]>100?1:0)),
    violations:[{line:32,axis:'X',value:120,limit:100,kind:'max'}],violations_total:1}));
  await ctl({op:'reset'});
  await page.goto(origin);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'setAxes',axes:['X','Y','Z','A','C']});
  await ctl({op:'setKins',kins:{module:'xyzac_trt',type:'xyzac-trt',identity_first:true,params:{}}});
  await ctl({op:'status_delta',armed:true,data:{kins_type:0,g5x_index:1,active_file:'/leak.ngc',
    is_enabled:false,enabled:false,tool_number:0,tool_diameter:0,tool_length:0,
    eoffset_enabled:true,eoffset_z:0.123,rotation_xy:12,joint_pos:[0,0,0,0,0,0],
    actual_position:[0,0,0],g5x_offset:[0,0,0],g92_offset:[0,0,0],tool_offset:[0,0,0]}});
  await settings('md');await ctl({op:'loadGcode'});
  await expect(page.locator('.scrubBar')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(600);
  result.desktop=await surroundingCards();
  const setHud=async on=>ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:'light'},viewer:{layers:{hud:on},hud:{scale:'md',showMachine:true}}}}});
  await setHud(false);await expect(page.locator('.hudCard')).toBeHidden();
  await page.setViewportSize({width:900,height:1200});
  await page.evaluate(()=>{document.documentElement.classList.add('touch-device');document.documentElement.style.zoom='1.5';});
  await page.waitForTimeout(700);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.([{line:12,frac:0.3},{line:22,frac:0.6,rapid:true}])??false)).toBe(true);
  result.narrowHudHidden=await surroundingCards();
  await page.locator('.scrubBar input.toggle').check();await page.waitForTimeout(700);
  result.simulatingFolded=await surroundingCards();
  await page.screenshot({path:`${out}-folded.png`});
  await page.locator('.moreToggle').click();await page.waitForTimeout(600);
  result.simulatingMore=await surroundingCards();
  await page.screenshot({path:`${out}-more.png`});
  result.hidden=await page.evaluate(()=>({hudVisible:document.querySelector('.hudCard').getBoundingClientRect().height>0,
    narrowClass:document.querySelector('.viewerWrapper').classList.contains('narrowViewer'),
    bannerText:document.querySelector('.simBanner')?.innerText,
    wrapper:document.querySelector('.viewerWrapper').className}));
  await setHud(true);await expect(page.locator('.hudCard')).toBeVisible();await page.waitForTimeout(700);
  result.hudRestored=await surroundingCards();
  await page.screenshot({path:`${out}-restored.png`});
  await page.locator('.moreToggle').click();await page.locator('.scrubBar input.toggle').uncheck();
  result.commands=(await ctl({op:'lastCmds'})).cmds;
} catch(e){result.fatal=String(e.stack||e);process.exitCode=1;}
finally {await writeFile(`${out}.json`,JSON.stringify(result,null,2)+'\n');await browser.close();}

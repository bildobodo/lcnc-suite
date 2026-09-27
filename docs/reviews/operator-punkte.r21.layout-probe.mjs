/** R21 ideas evidence: measure CURRENT built UI on own mock 4188. No product edits.
 * Read-only DOM geometry; all control messages go to the mock /ctl.
 */
import {chromium, expect} from '../../lcnc-webui/node_modules/@playwright/test/index.mjs';
import WebSocket from '../../lcnc-webui/node_modules/ws/wrapper.mjs';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const out={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases:[]};
function ctl(op){return new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:4188/ctl');w.once('open',()=>w.send(JSON.stringify(op)));w.once('message',d=>{w.close();resolve(JSON.parse(String(d)));});w.once('error',reject);});}
const browser=await chromium.launch({headless:true});
try {
 for(const width of [1600,1280]) for(const touch of [false,true]) {
  const page=await browser.newPage({viewport:{width,height:width===1600?1000:800}});
  try {
   await ctl({op:'reset'});await page.goto('http://127.0.0.1:4188/');
   await expect(page.locator('input.setupInput').first()).toBeVisible();
   await ctl({op:'setAxes',axes:['X','Y','Z','A','C']});
   await ctl({op:'setKins',kins:{module:'xyzac-trt-kins',type:'xyzac-trt',identity_first:true,params:{}}});
   await ctl({op:'status_delta',data:{homed:true,homed_joints:[true,true,true,true,true],
      task_mode:1,interp_state:1,enabled:true,estop:false,kins_type:0,g5x_index:1}});
   await expect(page.locator('input.setupInput')).toHaveCount(5);
   if(touch) await page.evaluate(()=>document.documentElement.classList.add('touch-device'));
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(400);
   const strips=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    const node=sel=>{const e=document.querySelector(sel);return e?{selector:sel,...rect(e),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth}:null;};
    const groups=['.stepCol','.modeCol','.wcsOptions'].map(sel=>{
      const e=document.querySelector(sel);
      const labels=[...e.querySelectorAll('label')].map(l=>({text:l.textContent.trim(),...rect(l)}));
      const cs=getComputedStyle(e.querySelector('label')||e),cv=document.createElement('canvas').getContext('2d');
      cv.font=cs.font;
      const longest=Math.max(...labels.map(l=>cv.measureText(l.text).width));
      return {selector:sel,...rect(e),labels,font:cs.font,longestText:longest,
         // Width lower bound for proposed connected rows: compact target 36,
         // label + 2*8px inline padding, equal widths, no gaps.
         proposedEqualRowWidth:Math.max(36,longest+16)*labels.length};
    });
    return {panels:['[data-strip="jog"]','[data-strip="setup"]','.radioGrid','.sidePane'].map(node),groups,
      stripHeight:getComputedStyle(document.documentElement).getPropertyValue('--strip-section-h')};
   });
   await page.getByRole('tab',{name:'Tools',exact:true}).click();
   await expect(page.locator('.toolSearchRow')).toBeVisible();
   const tools=await page.evaluate(()=>{
    const a=document.querySelector('.toolTabManage').getBoundingClientRect();
    const b=document.querySelector('.toolSearchRow').getBoundingClientRect();
    return {managementWidth:a.width,searchWidth:b.width,gap:b.top-a.bottom,
      paneWidth:document.querySelector('.sidePane').getBoundingClientRect().width};
   });
   const shot=`operator-punkte.r21.${width}-${touch?'touch':'desktop'}.png`;
   if(width===1280&&touch)await page.screenshot({path:new URL('./'+shot,import.meta.url).pathname});
   const row={width,touch,strips,tools,...(width===1280&&touch?{screenshot:shot}:{})};
   out.cases.push(row);console.log(JSON.stringify(row));
  }finally{await page.close();}
 }
}catch(e){out.harness_error=String(e);throw e;}
finally{await browser.close();await writeFile(new URL('./operator-punkte.r21.layout-probe.json',import.meta.url),JSON.stringify(out,null,2)+'\n');}

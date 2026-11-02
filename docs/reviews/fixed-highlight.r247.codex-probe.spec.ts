import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {simShow} from './simTab';
const OUT='/tmp/codex-r247-2_4n60rz';
const CODE='.codeViewer:not(.mdiHistoryList)';
let version=24700;
type Fixture={file:string;text:string;lines:number[];changes:[number,number][]};
function preview(f:Fixture){return Buffer.from(encode({file:f.file,preview_schema:11,
 feed:f.lines.map((_,i)=>[i*10,0,0]),feed_lines:f.lines,feed_seq:f.lines.map((_,i)=>i+1),
 feed_outside:new Uint8Array(f.lines.length),rapid:[],violations:[],violations_total:0,
 tool_change_lines:f.changes}));}
async function fixture(page:Page,context:BrowserContext,initial:Fixture){
 let current=initial;
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview(current)}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:current.text}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 const load=async(f:Fixture)=>{
  current=f;await ctl({op:'status_delta',data:{active_file:f.file,is_enabled:false,enabled:false}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:++version,file:f.file}});
  await expect(page.locator(CODE+' .lineContent').first()).toHaveText(f.text.split('\n')[0]!);
  await expect(page.locator('.scrubBar')).toBeVisible();
 };
 await load(initial);return load;
}
async function marks(page:Page){return page.locator(CODE).evaluate(el=>[...el.querySelectorAll('.codeLine.toolChange')].map(r=>({
 line:Number(r.querySelector('.lineNumber')?.textContent),text:r.querySelector('.lineContent')?.textContent,
 glyph:r.querySelector('.lineMark [role="img"]')?.getAttribute('aria-label'),title:r.getAttribute('title')})));}
const A:Fixture={file:'/tool-mark-a.ngc',text:'(tool mark A)\nG21 G90\n#<next> = 8\nT3 M600\nG1 X10 F100\nT#<next> M6\nG1 X20\n(T9 M600)\nT5 M601\nG1 X30\nM2',lines:[2,5,7,10],changes:[[6,8]]};
test('R247 marks use placed tool targets and clear at replacement and unload',async({page,context})=>{
 const load=await fixture(page,context,A);
 await expect.poll(()=>marks(page)).toEqual([
  {line:4,text:'T3 M600',glyph:'Tool change',title:'Tool change → T3'},
  {line:6,text:'T#<next> M6',glyph:'Tool change',title:'Tool change → T8'},
  {line:9,text:'T5 M601',glyph:'Tool change',title:'Tool change → T5'}]);
 const result:any={A:await marks(page)};
 const B:Fixture={file:'/tool-mark-b.ngc',text:'(tool mark B)\nG21 G90\nG1 X10 F100\nG1 X20\nG1 X30\nM2',lines:[2,3,4,5],changes:[]};
 await load(B);await expect.poll(()=>marks(page)).toEqual([]);result.B=await marks(page);
 await load(A);await expect.poll(async()=>(await marks(page)).length).toBe(3);result.reloaded=await marks(page);
 await ctl({op:'status_delta',data:{active_file:null}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:++version,file:null}});
 await expect(page.locator(CODE+' .codeLine')).toHaveCount(0);
 result.unloadedCodeRows=await page.locator(CODE+' .codeLine').count();
 await load(B);await expect.poll(()=>marks(page)).toEqual([]);result.afterUnload=await marks(page);
 writeFileSync(`${OUT}/lifecycle.json`,JSON.stringify(result,null,2));
});
test('R247 parameter names containing M6 or M600 do not create tool changes',async({page,context})=>{
 const f:Fixture={file:'/tool-mark-names.ngc',text:'G21 G90\n#<m600_count> = 0\n#<m6> = 1\n#<m601_done> = 0\n(T99 M6)\n; M600 in a comment\nG1 X10 F100\nG1 X20\nM2',lines:[1,7,8],changes:[]};
 await fixture(page,context,f);await page.waitForTimeout(300);
 const code=await marks(page);
 await simShow(page,'tool');
 const sim=await page.locator('.simPanel tr[data-sim-row^="T"]').allTextContents();
 await page.getByRole('tab',{name:'Program',exact:true}).click();
 await page.screenshot({path:`${OUT}/names.png`});
 writeFileSync(`${OUT}/names.json`,JSON.stringify({fixture:f,code,sim},null,2));
 console.log({code,sim});
 expect(code,'an identifier is not an M command; this program has no tool change').toEqual([]);
});

import {test,expect} from './test';
import {writeFileSync} from 'node:fs';
import {ctl,publishToolTable} from './ctl';
import {PROFILES,VIEWPORTS,openLayout,settleLayout} from './layout-fixtures';
import {TOOL_TYPE_LABELS} from '../src/toolTypes';
const out:any={};const save=()=>writeFileSync('/tmp/r407-s-own.json',JSON.stringify(out,null,2)+'\n');
const notes=[1,12].map(n=>'Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/'+('customer_fixture_123456/'.repeat(n))+'tool.tbl');
async function showNote(page:any, text:string, version:number){
 await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error:text}});
 await ctl({op:'raw',frame:{type:'tool_table_changed',version}});
 await expect(page.locator('[data-strip="tool"] .statusNote > span')).toHaveText('Tool table: '+text);
 await settleLayout(page);
}
async function geometry(page:any){return page.locator('[data-strip="tool"]').evaluate((tool:HTMLElement)=>{
 const body=tool.querySelector('.toolBody') as HTMLElement,strip=document.querySelector('.strip') as HTMLElement;
 return {over:strip.scrollWidth-strip.clientWidth,body:{w:body.clientWidth,h:body.clientHeight,scrollW:body.scrollWidth,scrollH:body.scrollHeight},
 rows:[...tool.querySelectorAll('.statusRow')].map(el=>({text:el.textContent?.trim(),height:el.getBoundingClientRect().height,width:el.clientWidth,scrollW:el.scrollWidth})),
 };
});}
test('codex R407 S: all tool types without and with the data scrollbar',async({page})=>{
 test.setTimeout(120000);
 await openLayout(page,PROFILES[0],VIEWPORTS.find(v=>v.name==='touch-fullhd')!);
 const types=Object.entries(TOOL_TYPE_LABELS);
 await publishToolTable(types.map(([type],i)=>({T:i+1,P:i+1,D:25.4,Z:-1234.567,type,description:'Full description remains available in the tool table'})));
 out.types={};
 for(const error of [false,true]){
  if(error)await showNote(page,notes[0],1200);
  const all:any=[];
  for(let i=0;i<types.length;i++){
   await ctl({op:'status_delta',data:{tool_in_spindle:i+1,tool_number:i+1,tool_diameter:25.4,tool_length:-1234.567,tool_table_z:-1234.567,tool_offset:[0,0,-50,0,0,0,0,0,0],gcodes:[430]}});
   const row=page.locator('[data-strip="tool"] .statusRow').filter({has:page.locator('.label-muted',{hasText:/^Type$/})});
   await expect(row).toContainText(types[i][1]);
   all.push({type:types[i][0],...await geometry(page)});
  }
  out.types[error?'error':'clean']=all;
 }
 save();
});
for(const loaded of [false,true]) test(`codex R407 S: original R405 paths reachable, loaded=${loaded}`,async({page})=>{
 await openLayout(page,PROFILES[0],VIEWPORTS.find(v=>v.name==='touch-fullhd')!);
 if(loaded){await publishToolTable([{T:12,P:12,D:25.4,Z:-1234.567,type:'endmill',description:'A long description'}]);
  await ctl({op:'status_delta',data:{tool_in_spindle:12,tool_number:12,tool_diameter:25.4,tool_length:-1234.567,tool_table_z:-1234.567}});
  await expect(page.locator('.toolInfo')).toContainText('T12');}
 const all:any=[];
 for(let i=0;i<notes.length;i++){
  await showNote(page,notes[i],1300+i);
  const tool=page.locator('[data-strip="tool"]');
  const lines=await tool.evaluate((el:HTMLElement)=>{
   const body=el.querySelector('.toolBody') as HTMLElement;
   const text=el.querySelector('.statusNote > span')!;
   const range=document.createRange();range.selectNodeContents(text);
   const rects=()=>Array.from(range.getClientRects());
   const n=rects().length;const result=[];
   for(let at=0;at<n;at++){
    const a=body.getBoundingClientRect();body.scrollTop+=rects()[at].top-a.top-body.clientTop;
    const q=rects()[at],b=body.getBoundingClientRect();
    result.push(q.top>=b.top+body.clientTop-0.6&&q.bottom<=b.top+body.clientTop+body.clientHeight+0.6&&q.left>=b.left+body.clientLeft-0.6&&q.right<=b.left+body.clientLeft+body.clientWidth+0.6);
   }
   return result;
  });
  const targets=tool.locator('.statusRow, .emptyState, .statusNote button');
  for(let j=0;j<await targets.count();j++){
   await targets.nth(j).evaluate(el=>el.scrollIntoView({block:'nearest'}));
   const seen=await targets.nth(j).evaluate(el=>{
    const box=el.closest('.toolBody') as HTMLElement;const b=box.getBoundingClientRect(),r=el.getBoundingClientRect();
    return r.top>=b.top+box.clientTop-0.6&&r.bottom<=b.top+box.clientTop+box.clientHeight+0.6;
   });expect(seen).toBe(true);
  }
  const retry=tool.getByRole('button',{name:'Retry',exact:true});await retry.scrollIntoViewIfNeeded();
  await ctl({op:'clearCmds'});await retry.click();
  await expect.poll(async()=> ((await ctl({op:'lastCmds'})) as any).cmds.some((x:any)=>x.cmd==='get_tool_table')).toBe(true);
  const commands=await ctl({op:'lastCmds'}) as any;
  all.push({messageLength:notes[i].length,lines,...await geometry(page),commands});
  expect(lines.length).toBeGreaterThan(0);expect(lines.every(Boolean)).toBe(true);
  expect((await geometry(page)).over).toBe(0);
 }
 out['paths_'+loaded]=all;save();
});

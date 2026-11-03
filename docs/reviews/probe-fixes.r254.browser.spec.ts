import {test,expect,type Page,type Locator} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {PROBE_FALLBACK,calibrationVarMap} from '../src/probeVars';
const out='/tmp/codex-r254-xi5hkcf6';
const p={...PROBE_FALLBACK,traverseFr:123,calDiameter:40,xCalWidth:50,yCalWidth:60};
const buttons=[['Round hole — edge start','probe_cal_round_pocket'],['Round boss — outside start','probe_cal_round_boss'],
 ['Rect pocket — edge start','probe_cal_square_pocket'],['Rect boss — outside start','probe_cal_square_boss']];
async function hold(page:Page,target:Locator){
 await expect(target).toBeEnabled(); await target.scrollIntoViewIfNeeded(); const b=(await target.boundingBox())!;
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 await page.waitForTimeout(700);await page.mouse.up();
}
const sent=async()=>((await ctl({op:'lastCmds'})) as {cmds:any[]}).cmds??[];
test('R254 all calibration buttons send the selected axis and mode, with all 33 variables',async({page})=>{
 test.setTimeout(120000);
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await ctl({op:'replyFor',cmd:'mdi',reply:{ok:true}});
 const side=page.locator('.sidePane');
 await side.getByRole('tab',{name:'Probing',exact:true}).click();
 await side.getByRole('tab',{name:'Calibrate',exact:true}).click();
 await ctl({op:'raw',frame:{type:'settings_init',settings:{probe:p}}});
 await expect(side.getByLabel('Diameter',{exact:true})).toHaveValue('40');
 const observations:any[]=[];
 for(const autoZero of [false,true]){
  await side.getByRole('checkbox',{name:'Auto Zero',exact:true}).setChecked(autoZero);
  for(const [axis,label] of ['Avg XY','X Error','Y Error'].entries()){
   await side.getByRole('radio',{name:label,exact:true}).check();
   for(const [title,macro] of buttons){
    await ctl({op:'clearCmds'});
    await hold(page,side.getByTitle(title!,{exact:true}));
    await expect.poll(async()=>(await sent()).filter(c=>c.cmd==='mdi').length).toBe(1);
    const command=(await sent()).find(c=>c.cmd==='mdi');
    observations.push({autoZero,axis,title,command});
    writeFileSync(`${out}/calibration-clicks.json`,JSON.stringify(observations,null,2));
    expect(command.text).toBe(`O<${macro}> CALL`);
    expect(command.vars).toEqual(calibrationVarMap(p,autoZero?0:1,axis));
    // Independent literals: not only map-versus-map assertions.
    expect(Object.keys(command.vars)).toHaveLength(33);
    expect(command.vars['3036']).toBe(axis);expect(command.vars['3030']).toBe(autoZero?0:1);
    expect(command.vars['3017']).toBe(123);expect(command.vars['3033']).toBe(40);
    expect(command.vars['3034']).toBe(50);expect(command.vars['3035']).toBe(60);
   }
  }
 }
 expect(observations).toHaveLength(24);
 await side.screenshot({path:`${out}/calibrate.png`});
});

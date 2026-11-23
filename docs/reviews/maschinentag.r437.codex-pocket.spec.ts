import {test, expect} from "./test";
import {ctl} from "./ctl";
import {PROFILES, VIEWPORTS, openLayout} from "./layout-fixtures";
import {installHoldClock, onPageClock} from "./holdClock";
test("R437 pocket hint timing before and after activation",async({page},testInfo)=>{
 await installHoldClock(page);
 await openLayout(page,PROFILES[0]!,VIEWPORTS.find(v=>v.name==="desktop")!);
 const side=page.locator(".sidePane");
 await side.getByRole("tab",{name:"Probing",exact:true}).click();
 await side.getByRole("tab",{name:"Boss/Pocket",exact:true}).click();
 const cell=side.locator('[data-boss-op="rp"]');
 await expect(cell).toBeEnabled();
 const box=(await cell.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await ctl({op:"clearCmds"});
 const evidence:any[]=[];
 const sample=async(label:string)=>evidence.push({label,hint:await page.locator(".btnHint").allTextContents(),commands:((await ctl({op:"lastCmds"})).cmds??[]).filter((c:any)=>c.cmd==="probe_run")});
 await onPageClock(page,async()=>{
  await sample("before press");
  await page.mouse.down();await page.clock.runFor(100);await sample("100 ms into hold");
  await page.clock.runFor(600);await sample("700 ms into hold");await page.mouse.up();
 });
 await testInfo.attach("hint-timing",{body:JSON.stringify(evidence,null,2),contentType:"application/json"});
 console.log("R437_HINT_TIMING",JSON.stringify(evidence));
 expect(evidence[0].commands).toHaveLength(0);
 expect(evidence[1].commands).toHaveLength(0);
 expect(evidence[2].commands).toHaveLength(1);
});

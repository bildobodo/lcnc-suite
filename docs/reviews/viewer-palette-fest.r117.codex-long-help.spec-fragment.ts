
// Independent R117 stress case: actual app/HelpIcon, synthetic 40-contact
// provisional result at the worker boundary. No controller and no live ports.
test('Codex R117: forty boundary contacts remain reachable at portrait and landscape zoom', async ({ page, context }) => {
  test.setTimeout(180_000);
  await installWorkerTap(page);
  const file = '/r117-longhelp.ngc';
  await runReady(page, context, file, 4351);
  await page.evaluate(() => {
    const t = (window as unknown as { __colTap: ColTap }).__colTap;
    t.holdFull = true;
    t.patchProvisional = { boundaryContacts: Array.from({length:40}, (_,i) => ({
      a:`r117-part-${i}`, b:`r117-peer-${i}`, line:7, cum:280, dist:0, cutting:i%2===0
    })) };
  });
  await ctl({op:'quiet',on:true});
  await runOnL7(page,file,4351);
  await publishInRun(page,file,4352,pinnedFor(9));
  await expect.poll(()=>runLog(page),{timeout:60000}).toEqual(['start provisional 1','full']);
  await expect.poll(()=>colTap(page,t=>t.held.length),{timeout:60000}).toBe(1);
  const results=[];
  for(const size of [{width:1280,height:800,zoom:'1'}, {width:900,height:1200,zoom:'1.5'}, {width:1024,height:768,zoom:'1.5'}]) {
    await page.setViewportSize({width:size.width,height:size.height});
    await page.evaluate(z=>{document.documentElement.style.zoom=z;},size.zoom);
    const button=page.getByRole('button',{name:'Help: Collision check',exact:true});
    await button.focus();
    await page.keyboard.press('Enter');
    const pop=page.locator('.helpPopover:popover-open');
    await expect(pop).toBeVisible();
    // two frames allow the component's placement callback to run.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const before=await pop.evaluate(el=>{
      const r=el.getBoundingClientRect();
      return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,clientHeight:el.clientHeight,
        scrollHeight:el.scrollHeight,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
        overflowY:getComputedStyle(el).overflowY,text:el.textContent};
    });
    for(let i=0;i<40;i++) expect(before.text).toContain(`R117-part-${i}`);
    expect(before.x).toBeGreaterThanOrEqual(0);expect(before.y).toBeGreaterThanOrEqual(0);
    expect(before.right).toBeLessThanOrEqual(size.width+1);expect(before.bottom).toBeLessThanOrEqual(size.height+1);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth+1);
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
    const rect=await pop.boundingBox();
    await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height/2);
    await page.mouse.wheel(0,10000);
    await expect.poll(()=>pop.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop))).toBeLessThanOrEqual(2);
    // A keyboard user can enter the scroll area and move through it.
    await button.focus();
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,cls:document.activeElement?.className}));
    await page.keyboard.press('Home');
    await expect.poll(()=>pop.evaluate(el=>el.scrollTop)).toBe(0);
    await page.keyboard.press('End');
    await expect.poll(()=>pop.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop))).toBeLessThanOrEqual(2);
    await page.screenshot({path:`../evidence/help-${size.width}-${size.zoom}.png`});
    results.push({size,before,focus,atEnd:await pop.evaluate(el=>el.scrollTop)});
    await page.mouse.click(2,2);
    await expect(pop).toHaveCount(0);
  }
  const fs=await import('node:fs');
  fs.writeFileSync('../evidence/long-help.json',JSON.stringify(results,null,2)+'\n');
  await ctl({op:'quiet',on:false});await ctl({op:'reset'});
});

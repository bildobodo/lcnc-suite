
// Codex R154: filtered windows, zoom, keyboard containment and shrinking data.
import { writeFileSync as r154Write } from 'node:fs';
for (const zoom of [1,1.5]) {
 test(`Codex R154: filters and shrinking results keep a bounded reachable list at zoom ${zoom}`,async({page,context})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await prepare(page,context,'desktop',PREVIEW,false);
  if(zoom!==1)await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
  const N=1200;
  await expect.poll(()=>page.evaluate(n=>window.__viewerDiag?.setCollisionHits?.(Array.from({length:n},(_,k)=>({line:12,frac:.01+.98*k/n,near:k%4===0?1:undefined})))??false,N)).toBe(true);
  await simShow(page,'all');
  await expect(rows(page)).toHaveCount(400);
  await expect(page.locator('.simPanel option[value="all"]')).toHaveText('All (1204)');
  await simShow(page,'tool');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('.simPanel .windowMore')).toHaveCount(0);
  await simStepBtn(page,'Next tool change').click();
  await expect(page.locator('.simPanel .shownRow')).toHaveCount(1);
  await simShow(page,'clash');
  await expect(rows(page)).toHaveCount(400);
  await simStepBtn(page,'Next collision').click();
  await expect(page.locator('.simPanel .shownRow')).toHaveCount(1);
  const selected=await page.locator('.simPanel .shownRow').getAttribute('data-sim-row');
  // One Tab stop, physical arrow keys do not escape to the page at the window edge.
  const first=rows(page).first().locator('.rowPick');
  await first.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowUp');
  await expect(first).toBeFocused();
  await page.keyboard.press('End');await page.keyboard.press('ArrowDown');
  await expect(rows(page).last().locator('.rowPick')).toBeFocused();
  const before=await rowKeys(page);
  // Replacing the data with fewer than one window removes the stale counts,
  // retains ownership of focus, and permits another jump.
  await page.evaluate(()=>window.__viewerDiag!.setCollisionHits!([{line:6,ordinal:5000},{line:12,ordinal:5001},{line:26,ordinal:5002}]));
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('.simPanel .windowMore')).toHaveCount(0);
  await expect(page.locator('.simPanel option[value="clash"]')).toHaveText('Collisions (3)');
  const focus=await page.evaluate(()=>({inside:!!document.activeElement?.closest('.simPanel'),key:document.activeElement?.closest('[data-sim-row]')?.getAttribute('data-sim-row')}));
  expect(focus.inside).toBe(true);
  await simStepBtn(page,'Next collision').click();
  await expect(page.locator('.simPanel .shownRow')).toHaveCount(1);
  const after=await rowKeys(page);
  r154Write(`/tmp/codex-r154-ga9vp4vu/browser-${zoom}.json`,JSON.stringify({zoom,selected,oldWindow:{n:before.length,first:before[0],last:before.at(-1)},after,focus,errors},null,2)+'\n');
  await page.screenshot({path:`/tmp/codex-r154-ga9vp4vu/browser-${zoom}.png`});
  expect(errors).toEqual([]);
 });
}

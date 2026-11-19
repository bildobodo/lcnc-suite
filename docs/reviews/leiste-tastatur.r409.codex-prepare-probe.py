from pathlib import Path
root=Path('/tmp/codex-r409/lcnc-webui')
p=root/'e2e/strip-fit.spec.ts'
s=p.read_text().replace("type: 'endmill'", "type: 'cornerchamfer'").replace('strip fit:', 'codex R409:')
assert s!=p.read_text()
s += '''
// Independent reachability check: the approved type wraps but all its text
// and the entire row can still be brought into the real scroll window.
test('codex R409: approved wrapped type remains reachable', async ({page}, info) => {
  await openLayout(page, LINEAR[2]!, FULLHD[0]!);
  await publishToolTable([TOOL]); await loadTool(page, OFFSETS['offset other']!);
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error:NOTES['unbroken 372']}});
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:9300}});
  const tool=page.locator('[data-strip="tool"]');
  await expect(tool.locator('.statusNote')).toContainText(NOTES['unbroken 372']);
  const row=tool.locator('.statusRow').filter({hasText:'Corner Chamfer End Mill'});
  await row.scrollIntoViewIfNeeded();
  const result=await row.evaluate(el=>{
    const body=el.closest('.toolBody') as HTMLElement, r=el.getBoundingClientRect(),b=body.getBoundingClientRect();
    const range=document.createRange(); range.selectNodeContents(el);
    return {height:r.height, rowWidth:r.width, bodyHeight:body.clientHeight,
      vertical:r.top>=b.top+body.clientTop-.5&&r.bottom<=b.top+body.clientTop+body.clientHeight+.5,
      horizontal:[...range.getClientRects()].every(q=>q.left>=r.left-.5&&q.right<=r.right+.5),
      bandOverflow:(document.querySelector('.strip') as HTMLElement).scrollWidth-(document.querySelector('.strip') as HTMLElement).clientWidth,
      text:el.textContent};
  });
  await info.attach('approved-wrapped-type.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.height).toBe(39);
  expect(result.vertical).toBe(true);expect(result.horizontal).toBe(true);expect(result.bandOverflow).toBe(0);
});
'''
(root/'e2e/r409-codex.spec.ts').write_text(s)
print('Counterprobe created; only fixture tool type differs; original product and original guard unchanged.')

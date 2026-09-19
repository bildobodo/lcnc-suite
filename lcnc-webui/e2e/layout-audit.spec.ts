import { test, expect } from '@playwright/test';
import { measureLayout, layoutChanges } from './layout-audit';

test('layout guard finds injected overlaps, clipping, collapsed and missing controls', async ({ page }) => {
  await page.setContent(`<style>
    #panel { width: 300px; height: 80px; display: flex; gap: 12px; }
    button { width: 100px; height: 36px; flex: none; overflow: hidden; white-space: nowrap; }
  </style><div id="panel"><button>First</button><button>Second</button></div>`);
  const root = page.locator('#panel');
  const good = await measureLayout(root, 'fixture');
  expect(good.issues).toEqual([]);
  await page.locator('button').nth(1).evaluate(el => { el.style.transform = 'translateX(-50px)'; });
  expect((await measureLayout(root, 'fixture')).issues.map(i => i.kind)).toContain('overlap');
  await page.locator('button').nth(1).evaluate(el => { el.style.transform = 'translateX(150px)'; });
  expect((await measureLayout(root, 'fixture')).issues.map(i => i.kind)).toContain('outside-panel');
  await page.locator('button').nth(1).evaluate(el => { el.style.transform = ''; el.textContent = 'This label cannot fit in this button'; });
  expect((await measureLayout(root, 'fixture')).issues.map(i => i.kind)).toContain('clipped-label');
  await page.locator('button').nth(1).evaluate(el => { el.style.cssText = 'height:1px; padding:0; border:0'; });
  expect((await measureLayout(root, 'fixture')).issues.map(i => i.kind)).toContain('collapsed');
  await page.locator('button').nth(1).evaluate(el => { el.style.display = 'none'; });
  expect(layoutChanges(good, await measureLayout(root, 'fixture')).map(i => i.kind)).toContain('control-count');
});

test('layout guard catches clipping by an inner container and tolerates intentional page scrolling', async ({ page }) => {
  await page.setContent(`<div style="overflow:auto; width:100px"><div id="panel" style="width:300px;height:100px">
    <div id="clip" style="width:200px;overflow:hidden"><button style="width:180px;height:40px">Action</button></div>
  </div></div>`);
  const root = page.locator('#panel');
  expect((await measureLayout(root, 'fixture')).issues).toEqual([]);
  await page.locator('#clip').evaluate(el => { el.style.width = '30px'; });
  expect((await measureLayout(root, 'fixture')).issues.map(i => i.kind)).toContain('clipped-control');
});

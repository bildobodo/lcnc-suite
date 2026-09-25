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

test('layout guard finds content spilling out of a fixed-height box and a control lying on a separator', async ({ page }) => {
  // Design wave D1 live look: the probe grid's fixed-height section outgrew
  // its 360 px when a description line joined it, and the Edge Width row lay
  // on the Parameters separator — neither is an overlap of two controls.
  await page.setContent(`<style>
    #panel { width: 300px; display: flex; flex-direction: column; gap: 8px; }
    .section { height: 120px; display: flex; flex-direction: column; gap: 8px; }
    .sep { height: 1px; background: #888; }
    input, button { height: 36px; flex: none; }
    .help { position: absolute; top: 0; right: -30px; width: 20px; height: 20px; }
  </style><div id="panel"><div class="section" style="position: relative"><button>Probe</button><input><span class="help"></span></div>
    <div class="sep"></div><button>Next</button></div>`);
  const root = page.locator('#panel');
  expect((await measureLayout(root, 'fixture')).issues).toEqual([]);
  await page.locator('.section').evaluate(el => { el.style.height = '60px'; });
  const kinds = (await measureLayout(root, 'fixture')).issues.map(i => i.kind);
  expect(kinds).toContain('overflowing-box');
  expect(kinds).toContain('crosses-separator');
});

test('layout guard finds a sliver scroll anywhere and any sideways scroll inside the strip', async ({ page }) => {
  // Design wave D1 live look: the portrait Safety section scrolled sideways —
  // its status columns overflowed by 10 px, past the sliver window, and in
  // the strip nothing is meant to scroll sideways.
  await page.setContent(`<style>
    .box { width: 200px; height: 60px; overflow: auto; }
    .wide { height: 20px; }
  </style><div class="strip"><div id="section"><div class="box"><div class="wide" style="width: 200px"></div></div></div></div>
    <div id="panel"><div class="box"><div class="wide" style="width: 200px"></div></div></div>`);
  const section = page.locator('#section'), panel = page.locator('#panel');
  expect((await measureLayout(section, 'fixture', 'div')).issues).toEqual([]);
  expect((await measureLayout(panel, 'fixture', 'div')).issues).toEqual([]);
  await page.locator('.wide').evaluateAll(els => els.forEach(el => { el.style.width = '210px'; }));
  expect((await measureLayout(section, 'fixture', 'div')).issues.map(i => i.kind)).toContain('sideways-scroll');
  expect((await measureLayout(panel, 'fixture', 'div')).issues).toEqual([]);   // a panel may scroll 10 px
  await page.locator('.wide').evaluateAll(els => els.forEach(el => { el.style.width = '202px'; }));
  expect((await measureLayout(panel, 'fixture', 'div')).issues.map(i => i.kind)).toContain('sliver-scroll');
});

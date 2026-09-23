// Chromium/DOM evidence, not a full accessibility certification.
// Same isolated mock/build prerequisites as consistency.probe.mjs.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const out = resolve('runlogs/ui-consistency-20260922');
await mkdir(out, { recursive: true });
const ctl = op => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:4186/ctl');
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', data => { ws.close(); res(JSON.parse(String(data))); });
  ws.once('error', rej);
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' });
const page = await context.newPage();
const report = {};
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const focus = () => page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent,
  class: document.activeElement?.className, aria: document.activeElement?.getAttribute('aria-label'),
  insideDialog: !!document.activeElement?.closest('.dialog') }));
const ax = async () => {
  const client = await context.newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await client.detach();
  const controls = nodes.filter(n => !n.ignored && ['textbox','combobox','slider','spinbutton','radio','checkbox'].includes(n.role?.value));
  return { controls: controls.map(n => ({ role: n.role.value, name: n.name?.value ?? '', value: n.value?.value })),
    dialogs: nodes.filter(n => !n.ignored && ['dialog','alertdialog'].includes(n.role?.value)).map(n => ({role:n.role.value,name:n.name?.value})),
    tabs: nodes.filter(n => !n.ignored && n.role?.value === 'tab').map(n => n.name?.value) };
};
try {
  await ctl({ op:'reset' });
  await page.route('**/gcode?*', route => route.fulfill({contentType:'text/plain',body:'(Contrast sample)\nG0 X0 Y0\nG1 X10 Y20 F100\n#100 = 5\nM2\n'}));
  await page.goto('http://127.0.0.1:4186/');
  await expect(page.locator('.pill.armed')).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:'light'}}}});
  await page.keyboard.press('Tab');
  await page.locator('input[type="range"]').first().focus();
  report.focusedSlider = await page.locator('input[type="range"]').first().evaluate(el => {
    const s=getComputedStyle(el); return {focusVisible:el.matches(':focus-visible'),outline:s.outline,boxShadow:s.boxShadow};
  });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(page.locator('.editDialog')).toBeVisible();
  report.toolDialogInitialFocus = await focus();
  await page.keyboard.press('Tab');
  report.toolDialogFirstTab = await focus();
  report.toolDialogAccessibility = await ax();
  await page.getByRole('button', { name: 'Close tool editor', exact: true }).click();
  await page.getByTitle('Settings', { exact: true }).click();
  await expect(page.getByRole('button',{name:'Close settings',exact:true})).toBeVisible();
  await settle();
  report.settingsAccessibility = await ax();
  await page.getByRole('button', {name:'Close settings',exact:true}).click();
  await page.getByRole('button', {name:'Probing',exact:true}).click();
  report.probingAccessibility = await ax();
  await page.getByRole('button', {name:'Program',exact:true}).click();
  await ctl({op:'loadGcode'});
  report.themes = [];
  for (const theme of ['light','dark','hc-light','hc-dark']) {
    await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme},viewer:{previewMode:'programmed'}}}});
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
    await settle();
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      const tokens = Object.fromEntries(['--bg','--panel','--fg','--info','--ok','--danger','--warn','--syntax-mcode','--syntax-coord','--syntax-param','--syntax-comment','--border','--opacity-muted'].map(k=>[k,s.getPropertyValue(k).trim()]));
      const el = document.querySelector('.label-muted'); const st = getComputedStyle(el);
      return {tokens, label:{color:st.color,opacity:st.opacity,font:st.fontSize}};
    });
    report.themes.push({theme,...colors});
    await page.locator('.viewerPane').screenshot({path:resolve(out,`viewer-${theme}.png`)});
    await page.locator('.sidePane').screenshot({path:resolve(out,`syntax-${theme}.png`)});
  }
  await writeFile(resolve(out,'accessibility.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }

// DOM comparison only. No password manager is installed in this Linux
// Chromium profile, so this does NOT reproduce Apple Passwords on macOS.
// Run against the current build via isolated mock-gateway on loopback:4186.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const ctl = op => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:4186/ctl');
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', data => { ws.close(); res(JSON.parse(String(data))); });
  ws.once('error', rej);
});
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{width:1600,height:1000} });
const fields = [];
async function capture(name, field) {
  await expect(field).toBeVisible();
  await field.focus();
  await expect(page.getByRole('button', {name:'Open keyboard',exact:true})).toBeVisible();
  fields.push({ name, ...await field.evaluate(el => ({
    type:el.type,
    attributes:Object.fromEntries(['id','name','type','autocomplete','autocorrect','autocapitalize',
      'spellcheck','aria-label','placeholder','inputmode'].map(a=>[a,el.getAttribute(a)])),
    labels:[...el.labels].map(l=>l.textContent.trim()),
    parentTag:el.parentElement.tagName,
    parentClass:el.parentElement.className,
    inForm:!!el.form,
    textSecurity:getComputedStyle(el).getPropertyValue('-webkit-text-security'),
  })) });
}
try {
  await ctl({op:'reset'});
  await page.goto('http://127.0.0.1:4186/');
  await expect(page.locator('.pill.armed')).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:'light'}}}});
  await page.getByRole('button',{name:'MDI',exact:true}).click();
  const mdi=page.locator('.mdiInput');
  await capture('MDI',mdi);
  await mdi.pressSequentially('G0 X10 ; review');
  await expect(mdi).toHaveValue('G0 X10 ; review');
  const mdiTyped=await mdi.inputValue();
  await page.getByRole('button',{name:'Tools',exact:true}).click();
  await capture('Tool search',page.locator('.toolSearch'));
  await page.getByRole('button',{name:'+ Add',exact:true}).click();
  await capture('Tool description',page.locator('#tool-description'));
  await page.getByRole('button',{name:'Close tool editor',exact:true}).click();
  await page.getByTitle('Settings',{exact:true}).click();
  await page.getByRole('button',{name:'Macros',exact:true}).click();
  await page.getByRole('button',{name:'Add Macro',exact:true}).click();
  await capture('Macro command',page.locator('#macro-edit-command'));
  const {cmds}=await ctl({op:'lastCmds'});
  expect(cmds.some(c=>c.cmd==='mdi')).toBe(false);
  const html=await readFile('lcnc-webui/dist/index.html','utf8');
  const report={date:'2026-09-22',productCommit:'691e642',
    entry:html.match(/src="(\/static\/[^\"]+)"/)[1],
    environment:'Linux Chromium; isolated mock; no browser extensions or Apple Passwords',
    userReport:'MDI is still perceived as a password field; other fields do not exhibit the reported behavior',
    fields,mdiTyped,mdiCommandsSent:cmds.filter(c=>c.cmd==='mdi').length,
    limitations:['DOM contract and typing only; no proof of password-manager classification',
      'The build loaded in the operator browser has not been inspected']};
  await writeFile('docs/reviews/ui-optimierungen.mdi-autofill.evidence.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {await browser.close();}

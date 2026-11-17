// R394 control (uninstrumented Playwright): does route.continue({headers}) REPLACE the
// request's headers — so a spec can drop one — or merge them? Same for route.fetch({headers}).
const http = require('node:http');
const { chromium } = require('@playwright/test');
(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/echo')) { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(req.headers)); return; }
    res.writeHead(200, {'content-type': 'text/html'}); res.end('<p>neutral</p>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({headless: true});
  const out = {};
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base + '/');
    await page.route('**/echo-continue', r => { const h = {...r.request().headers()}; delete h['x-drop']; return r.continue({headers: h}); });
    await page.route('**/echo-fetch', async r => { const h = {...r.request().headers()}; delete h['x-drop'];
      const resp = await r.fetch({headers: h}); await r.fulfill({response: resp}); });
    for (const p of ['/echo-continue', '/echo-fetch'])
      out[p] = await page.evaluate(u => fetch(u, {headers: {'x-drop': '1', 'x-keep': '1'}}).then(r => r.json()).then(h => ({drop: 'x-drop' in h, keep: 'x-keep' in h})), p);
    await context.close();
  } finally { await browser.close(); server.close(); }
  process.stdout.write(JSON.stringify({instrumented: false, ...out}) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });

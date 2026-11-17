const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext();
    await context.route('**/*', r => r.fulfill({body: 'fallback'}));
    const page = await context.newPage();
    await page.goto('http://r393.invalid/neutral');
    const handler = r => r.fulfill({body: 'registered-handler'});
    await page.route('**/__codex/a', handler);
    await page.route('**/__codex/b', handler);
    await page.unroute('**/__codex/a', handler);
    const answer = await page.evaluate(() => fetch('/__codex/a').then(r => r.text()));
    if (answer !== 'fallback') throw new Error('Native unroute failed: ' + answer);
    process.stdout.write(JSON.stringify({instrumented: false, answer, verdict: 'PASS'}) + '\n');
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

// R268: bounded protocol / filesystem probe. No app or machine endpoints.
// Usage: PW_ROOT=/path/to/lcnc-webui/node_modules node probe.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const root = process.env.PW_ROOT;
const { chromium } = require(path.join(root, 'playwright'));
const ts = require(path.join(root, 'typescript'));
async function main() {
  const out = { playwright: require(path.join(root, 'playwright/package.json')).version, typescript: ts.version, cases: [] };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'r268-links-'));
  try {
    const source = path.join(temp, 'original.tsbuildinfo');
    const copy = path.join(temp, 'copied.tsbuildinfo');
    fs.writeFileSync(source, 'old build info');
    fs.linkSync(source, copy);
    ts.sys.writeFile(copy, 'new build info');
    out.hardlink = { sameInode: fs.statSync(source).ino === fs.statSync(copy).ino, originalAfterWriteToCopy: fs.readFileSync(source, 'utf8') };
    assert.equal(out.hardlink.originalAfterWriteToCopy, 'new build info');
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
  let active = null;
  const server = http.createServer((req,res) => {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (active) active.server.push({ path:p, id:req.headers['x-e2e-req'] ?? null });
    if (p === '/real' || p === '/fetch') { res.writeHead(302, {Location:'/end'}); res.end(); }
    else { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<!doctype html><title>probe</title>'); }
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  let browser;
  try {
    browser = await chromium.launch({headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
    out.browser = browser.version();
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const mode of ['real','synthetic','fetch']) {
      const c = {mode, requests:[], routed:[], server:[], responses:[]}; active=c;
      const ctx = await browser.newContext({serviceWorkers:'block'});
      let serial=0; const ids=new WeakMap();
      ctx.on('request', req => {
        const id=`${mode}-${++serial}`; ids.set(req,id);
        c.requests.push({id,path:new URL(req.url()).pathname,from:ids.get(req.redirectedFrom()) ?? null});
      });
      ctx.on('response', response => c.responses.push({id:ids.get(response.request()),status:response.status()}));
      await ctx.route('**/*', async route => {
        const req=route.request(); const id=ids.get(req);
        assert.ok(id, 'request event precedes route');
        c.routed.push({id,path:new URL(req.url()).pathname});
        const headers={...req.headers(),'x-e2e-req':id};
        if (mode==='synthetic' && req.url().endsWith('/synthetic')) await route.fulfill({status:302,headers:{Location:'/end'}});
        else if (mode==='fetch' && req.url().endsWith('/fetch')) { const response=await route.fetch({headers}); await route.fulfill({response}); }
        else await route.continue({headers});
      });
      const page=await ctx.newPage();
      await page.goto(`${origin}/${mode}`,{waitUntil:'load',timeout:10000});
      await ctx.close(); active=null;
      // Ignore browser-generated favicon traffic in this focused proof.
      c.server=c.server.filter(x=>x.path!=='/favicon.ico');
      out.cases.push(c);
    }
    const real=out.cases[0];
    assert.equal(real.requests.length,2);
    assert.equal(real.routed.length,1);
    assert.equal(real.server[0].id,real.server[1].id);
    assert.notEqual(real.server[1].id,real.requests[1].id);
    const fetched=out.cases[2];
    assert.equal(fetched.requests.length,1);
    assert.equal(fetched.server.length,2);
    out.result='Counterexamples reproduced: header is not per redirect hop; hardlink is not write isolation.';
    console.log(JSON.stringify(out,null,2));
  } finally {
    if(browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

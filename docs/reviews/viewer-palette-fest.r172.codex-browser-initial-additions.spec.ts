
// Codex R172: append to collisions.viewer.spec.ts in the archive only.
import { writeFileSync as r172Write } from 'node:fs';

test('R172 own: a folded side uncertainty note keeps its source line', async ({ page, context }) => {
  await sideRunReady(page, context);
  await sideFirst(page);
  const own = await page.evaluate(() => {
    const t = (window as any).__sideTap;
    const c = t.side.track.cum;
    return { line: t.first.line as number, start: c[1] + (c[2] - c[1]) * 0.75, end: c[1] + (c[2] - c[1]) * 0.9,
      lines: Array.from(t.side.track.lines), cum: Array.from(c) };
  });
  sideTables.get(page)!.gaps.append({ pair: 0, start: own.start, end: own.end, reason: GAP_UNDECIDABLE });
  await sideResultMsg(page);
  await expect(page.locator('.simPanel .simSummary .sumItem').first()).toHaveAttribute('aria-label', /checked to the end/);
  await expect(clashRows(page)).toHaveCount(1);
  const label = await clashRows(page).first().locator('.rowPick').innerText();
  await page.getByRole('button', { name: 'Help: Collision check', exact: true }).click();
  const help = await page.locator('.helpPopover:popover-open').innerText();
  r172Write('/tmp/codex-r172-p00xom99/browser-folded.json', JSON.stringify({own, label, help}, null, 2));
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
  expect(label).toBe(`L${own.line}`);
  expect(help).toContain(`(L${own.line})`);
});

test('R172 own: metadata before the first table never shows the raw boundary line', async ({ page, context }) => {
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { main: null, deliver: null };
    (window as any).__r172 = tap;
    const Real = window.Worker;
    const Tap = function(url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      let handler: any = null;
      Object.defineProperty(w, 'onmessage', { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener('message', e => handler?.(e));
      tap.deliver = (d: any) => handler?.(new MessageEvent('message', { data: d }));
      w.postMessage = ((m: any) => { if(m?.track && !m.side) tap.main = m; }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  await prepare(page, context, { file: '/r172-meta.ngc', version: 31721, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]],
    extra: { feed_lineok: new Uint8Array([1, 1, 0, 0]), feed_sub: new Uint8Array([255, 255, 0, 0]), sub_names: ['touch'],
      feed_cline: new Uint8Array(Uint16Array.from([0, 0, 5, 5]).buffer) } });
  await expect.poll(() => page.evaluate(() => (window as any).__r172.main?.id ?? null)).not.toBeNull();
  const m = await page.evaluate(() => { const m = (window as any).__r172.main; return { id: m.id as number, at: (m.track.cum[1] + m.track.cum[2]) / 2 }; });
  const metadata = { staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 1,
    pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated: { covered: 0.3, reason: 'running' },
    boundaryContacts: [{ a: 'spindle_nose', b: 'a_yoke_casting', line: 7, cum: m.at, cutting: true }] };
  await page.evaluate(d => (window as any).__r172.deliver(d), { id: m.id, progress: 0.3, partial: metadata });
  await expect(page.locator('.simPanel .simSummary .sumItem').first()).toHaveAttribute('aria-label', /30 % checked/);
  const before = await basisCard(page);
  const diagnosticsBefore = await page.evaluate(() => window.__viewerDiag!.getContacts!());
  const w = wireDelta(new ContactStore(m.id, 0));
  await page.evaluate(([d, w]) => (window as any).__r172.deliver({ ...d, contacts: [(window as any).__fromWire(w)] }),
    [{ id: m.id, progress: 0.4, partial: { ...metadata, truncated: { covered: 0.4, reason: 'running' } },
      contactPairs: [['spindle_nose', 'a_yoke_casting']] }, w] as const);
  await expect(page.locator('.simPanel .simSummary .sumItem').first()).toHaveAttribute('aria-label', /40 % checked/);
  const after = await basisCard(page);
  r172Write('/tmp/codex-r172-p00xom99/browser-metadata.json', JSON.stringify({m, before, after, diagnosticsBefore}, null, 2));
  await ctl({ op: 'reset' });
  expect(after).toContain('(L5)');
  expect(before).not.toContain('(L7)');
});

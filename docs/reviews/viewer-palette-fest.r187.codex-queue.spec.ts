import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
test('characterize already queued replies when their worker is terminated', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const url = URL.createObjectURL(new Blob(['onmessage = () => { postMessage(1); postMessage(2); postMessage(3); };'], {type:'text/javascript'}));
    const rows: number[][] = [];
    for (let k=0;k<10;k++) {
      const w = new Worker(url), seen: number[] = [];
      await new Promise<void>(resolve => {
        w.onmessage = e => {
          seen.push(e.data);
          if (e.data === 1) { w.terminate(); setTimeout(resolve, 20); }
        };
        w.postMessage(null);
      });
      rows.push(seen);
    }
    URL.revokeObjectURL(url);
    return {rows, userAgent:navigator.userAgent};
  });
  writeFileSync('/tmp/codex-r187-b4k897uq/queue-evidence.json', JSON.stringify(result,null,2));
  expect(result.rows).toHaveLength(10);
});

// Run from repository root: node ...r8.recheck.mjs ledger|browser
// Reuses the round-7 probes unchanged apart from result filename/build label.
// Browser mode: freshly built frontend, isolated mock on 127.0.0.1:4188;
// do not run concurrently with the regular Playwright suite.
import fs from 'node:fs';
const mode = process.argv[2];
if (!['ledger', 'browser'].includes(mode)) throw new Error('Choose ledger or browser');
let source = fs.readFileSync(`docs/reviews/ui-optimierungen.implementation-review.r7.${mode}-probe.mjs`, 'utf8');
source = source.replaceAll('691e642', '9360439').replaceAll(
  `ui-optimierungen.implementation-review.r7.${mode}-evidence.json`,
  `ui-optimierungen.implementation-review.r8.${mode}-evidence.json`,
);
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

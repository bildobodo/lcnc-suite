// Small independent checks of the unmodified pure product functions.
// node notes.mjs <isolated repo> <existing node_modules>
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root = resolve(process.argv[2]);
const modules = resolve(process.argv[3]);
const { build } = await import(pathToFileURL(`${modules}/esbuild/lib/main.js`));
const output = new URL('./notes-product.mjs', import.meta.url).pathname;
await build({ stdin: { contents: 'export * from "./toolLoad"; export * from "./toolTableRead";',
  resolveDir: `${root}/lcnc-webui/src`, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: output });
const m = await import(pathToFileURL(output));
const base = { path: '/copy/tool.tbl', instance: '100:20', ini: '/copy/sim.ini', link: 'run.1', rev: 'a'.repeat(64), memory: 'b'.repeat(64) };
const seen = { kind: 'complete', owner: base, rev: base.rev };
const failed = { kind: 'failed', owner: null, rev: null };
const requested = { ok: true, load: 'requested', basis: 'partial', values: 'not shown', why: 'in time' };
let count = 0;
function check(label, test) { test(); count++; console.log(`PASS ${label}`); }
check('no reply establishes no request', () => assert.equal(m.toolLoadResult(null, base), null));
check('refusal establishes no request', () => assert.equal(m.toolLoadResult({ok:false}, base), null));
const initial = m.toolLoadResult(requested, base);
check('no read shows no note', () => assert.equal(m.toolLoadNote(initial, null), null));
check('failed first read is not a foreign owner', () => assert.deepEqual(m.toolLoadStep(initial, failed), initial));
const positive = m.toolLoadStep(initial, seen);
check('only the displayed complete read makes the note positive', () => assert.equal(m.toolLoadNote(positive, seen).tone, 'ok'));
check('partial basis says values now, no load proof', () => assert.equal(m.toolLoadNote(positive, seen).text,
  "Load requested. LinuxCNC now shows the file's tool values; pockets and remarks are not compared."));
for (const field of ['path', 'instance', 'ini', 'link']) check(`owner change ${field} ends a positive note`, () =>
  assert.equal(m.toolLoadStep(positive, { ...seen, owner: { ...base, [field]: 'other' } }), null));
check('changed revision ends a positive note', () => assert.equal(m.toolLoadStep(positive, {...seen, rev:'c'.repeat(64)}), null));
check('failed read ends a positive note', () => assert.equal(m.toolLoadStep(positive, failed), null));
check('ended note cannot reappear', () => assert.equal(m.toolLoadStep(null, seen), null));
const written = m.toolWriteOutcome({reload:'reload failed'}, base);
const rerequested = m.toolWriteRequest(written, base, true);
check('load request never removes the old write warning', () => assert.equal(m.toolWriteNote(rerequested, {...seen, loadRefusal:null}, base),
  'Table saved, load requested but not confirmed — load table or restart.'));
console.log(`${count} passed; no browser, no gateway, no NML`);

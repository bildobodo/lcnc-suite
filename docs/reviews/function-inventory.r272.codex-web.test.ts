// Review-only boundary checks, run in the isolated archive.
import { expect, it } from 'vitest';
import { framesAdapter, type WebSources } from './webAtoms';

const check = (code: string) => {
  const actual: string[] = [];
  // Execute only these local string fixtures with a fake socket; no network.
  new Function('ws', code)({ send: (value: string) => actual.push(JSON.parse(value).cmd) });
  const a = framesAdapter({files: {'wsWorker.ts': code}} as WebSources);
  const ids = new Set(a.atoms.map(x => x.id));
  expect(actual.every(cmd => ids.has(`frame:${cmd}`)) || a.unresolved.length > 0,
    JSON.stringify({actual, atoms: a.atoms, unresolved: a.unresolved})).toBe(true);
};

it('FI-I03: a local const in a nested helper does not bind the outer parameter', () => {
  check(`
function send(own) {
  function otherFrame() { const own = JSON.stringify({cmd: 'hello'}); return own; }
  otherFrame();
  ws.send(own);
}
send(JSON.stringify({cmd: 'new_frame'}));`);
});

it('FI-I03: a const in a sibling block does not bind the outer parameter', () => {
  check(`
function send(own) {
  { const own = JSON.stringify({cmd: 'hello'}); JSON.parse(own); }
  ws.send(own);
}
send(JSON.stringify({cmd: 'new_frame'}));`);
});

it('sensitivity: a const visible at the send still names its frame', () => {
  check(`function send() { const own = JSON.stringify({cmd: 'hello'}); ws.send(own); } send();`);
});

// Review only. All snippets run against a local fake socket, never a network.
import { expect, it } from 'vitest';
import { framesAdapter, type WebSources } from './webAtoms';
const outer = `const own = JSON.stringify({cmd: 'hello'});\n`;
const next = `JSON.stringify({cmd: 'new_frame'})`;
const cases: Record<string, string> = {
  object_parameter: `function send({own}) { ws.send(own); } send({own: ${next}});`,
  array_parameter: `function send([own]) { ws.send(own); } send([${next}]);`,
  local_destructuring: `function send() { const {own} = {own: ${next}}; ws.send(own); } send();`,
  catch_destructuring: `try { throw {own: ${next}}; } catch ({own}) { ws.send(own); }`,
  for_destructuring: `for (const {own} of [{own: ${next}}]) { ws.send(own); }`,
  function_scoped_var_in_block: `function send() { if (true) { var own = ${next}; } ws.send(own); } send();`,
  function_scoped_var_after_loop: `function send() { for (var own of [${next}]) {} ws.send(own); } send();`,
};

it.each(Object.entries(cases))('FI-I03: %s must block the unrelated outer const', (_name, body) => {
  const code = outer + body;
  const sent: string[] = [];
  new Function('ws', code)({send: (text: string) => sent.push(JSON.parse(text).cmd)});
  expect(sent).toEqual(['new_frame']);
  const a = framesAdapter({files: {'wsWorker.ts': code}} as WebSources);
  expect(a.atoms.some(x => x.id === 'frame:new_frame') || a.unresolved.length > 0,
    JSON.stringify({sent, atoms:a.atoms, unresolved:a.unresolved})).toBe(true);
});

it('sensitivity: the outer const visible through a closure remains readable', () => {
  const a = framesAdapter({files: {'wsWorker.ts': outer + 'function send() { ws.send(own); } send();'}} as WebSources);
  expect([a.atoms.map(x => x.id), a.unresolved]).toEqual([['frame:hello'], []]);
});

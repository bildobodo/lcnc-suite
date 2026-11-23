// R439: isolated source probes, NOT a browser/native/implementation test of the plan.
// Usage: node probe.cjs <594e333c archive> <typescript.js>
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = process.argv[2];
const ts = require(process.argv[3]);
const source = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const leaseText = source('lcnc-webui/src/jogLease.ts');
function leaseProbe(mutation, independentPeriod) {
  let text = leaseText;
  if (mutation === 'period200') text = text.replace('export const RENEW_MS = 100;', 'export const RENEW_MS = 200;');
  if (mutation === 'noClearInterval') text = text.replace('clearInterval(timer);', '/* mutation: no clearInterval */');
  let now = 0, next = 0;
  const timers = new Map(), renewals = [], ends = [];
  const ctx = {
    exports: {},
    require(name) {
      if (name === 'vue') return { watch() {} };
      if (name === './lcncWs') return { connected: {value: true}, send: cmd => renewals.push({at: now, ...cmd}), setJogLeaseFrameHandler() {} };
      if (name === './lcnc') return { OPERATOR_ERROR: 1 };
      if (name === './ws/statusStore') return { pushMessage() {} };
      if (name === './ws/telemetry') return { emitTelemetry() {} };
      throw new Error(name);
    },
    setInterval(fn, period) { const id = ++next; timers.set(id, {fn, period, at: now + period}); return id; },
    clearInterval(id) { timers.delete(id); },
  };
  vm.runInNewContext(ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, ctx);
  const exp = ctx.exports;
  function advance(ms) {
    const until = now + ms;
    for (;;) {
      const active = [...timers.entries()].sort((a,b) => a[1].at - b[1].at)[0];
      if (!active || active[1].at > until) break;
      now = active[1].at; active[1].at += active[1].period; active[1].fn();
    }
    now = until;
  }
  const id = exp.beginLease(cmd => ends.push(cmd), () => {});
  const step = independentPeriod ?? exp.RENEW_MS;
  const counts = [];
  for (let i = 0; i < 5; ++i) { advance(step); counts.push(renewals.length); }
  exp.endLease(id);
  const atRelease = renewals.length;
  advance(4 * step);
  return {
    mutation, step, productPeriod: exp.RENEW_MS, counts,
    proposedCountAssertion: counts.every((n,i) => n === i+1),
    allNameLease: renewals.every(r => r.ids.includes(id)),
    end: ends.map(c => ({...c})),
    renewalsAfterRelease: renewals.length - atRelease,
    timersAfterRelease: timers.size,
  };
}
const cases = [leaseProbe('none'), leaseProbe('period200'), leaseProbe('period200', 100), leaseProbe('noClearInterval')];
assert.equal(cases[0].proposedCountAssertion, true);
assert.ok(cases.every(c => c.allNameLease), 'source emits the lease id under the production target');
assert.equal(cases[1].proposedCountAssertion, true);
assert.equal(cases[2].proposedCountAssertion, false);
assert.equal(cases[3].renewalsAfterRelease, 0);
assert.equal(cases[3].timersAfterRelease, 1);

const varsText = source('lcnc-webui/src/probeVars.ts');
const varsCtx = {exports: {}};
vm.runInNewContext(ts.transpileModule(varsText, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, varsCtx);
const saved = {...varsCtx.exports.PROBE_FALLBACK, calOffset: 0.2};
const draft = {...saved, calOffset: 0.05};
const sent = varsCtx.exports.calibrationVarMap(draft, 1, 0);
assert.equal(sent['3032'], 0.05);
const out = {
  scope: 'Actual source in an isolated VM with synthetic timers/import dependencies; no browser, socket, controller or planned implementation executed.',
  base: '594e333c',
  hashes: {'jogLease.ts': sha(leaseText), 'probeVars.ts': sha(varsText)},
  jog: cases,
  calibrationMap: {savedCalOffset: saved.calOffset, localDraft: draft.calOffset, sent3032: sent['3032'], observation: 'calibrationVarMap still sends the local draft #3032 before the routine; removing writes inside the routine alone does not preserve the prior controller value.'},
};
console.log(JSON.stringify(out, null, 2));

// R191: characterize current contracts, not an implementation of planned E1.
// Usage: node this.cjs REPO DEPENDENCY_ROOT [REV]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const [repo, dependencyRoot, rev = '1adfc403'] = process.argv.slice(2);
const ts = createRequire(path.join(dependencyRoot, 'package.json'))('typescript');
const read = p => fs.readFileSync(path.join(repo,p),'utf8');
const js = text => ts.transpileModule(text, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS}}).outputText;
const results = [];
function add(name, data) { results.push({name, pass:true, ...data}); }
(async () => {
  // Whole source module. Its imported geometry functions are not called by
  // previewWcsStaleFor; fail loudly if this changes.
  const missing = new Proxy({}, {get(_, key) { return () => {throw Error(`unexpected dependency: ${String(key)}`)}; }});
  const ctx = {exports:{}, require:() => missing};
  vm.runInNewContext(js(read('lcnc-webui/src/viewer/wcsEpochs.ts')), ctx);
  const z = [0,0,0,0,0,0];
  const epoch = value => ({seq:0, idx:1, rotationDeg:0, rewritten:false, g5x:[0,0,value,0,0,0], g92:z});
  const live = {g5x:[0,0,20,0,0,0], g92:z, rotationDeg:0};
  const table = [{name:'G54',x:0,y:0,z:20,a:0,b:0,c:0,r:0}];
  const staleOld = ctx.exports.previewWcsStaleFor([epoch(10)],null,table,live);
  const staleMatching = ctx.exports.previewWcsStaleFor([epoch(20)],null,table,live);
  assert.equal(staleOld,true); assert.equal(staleMatching,false);
  const bulk = ts.createSourceFile('bulkData.ts', read('lcnc-webui/src/ws/bulkData.ts'), ts.ScriptTarget.Latest, true);
  const keyNode = bulk.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === '_keyOf');
  assert.ok(keyNode);
  const keyCtx = {};
  vm.runInNewContext(js(keyNode.getText(bulk)),keyCtx);
  const key = keyCtx._keyOf(11,'/nc_files/example.ngc',[0,0,0]);
  assert.equal(key,'/nc_files/example.ngc#11:0,0,0');
  add('a newer adopted version can still carry the preceding WCS basis', {
    fixture:{shownVersionBefore:10, incomingVersion:11, currentWishG54Z:20, incomingG54Z:10},
    currentHelperSaysStale:staleOld, matchingBasisSaysStale:staleMatching,
    existingDecodeGuardKey:key,
    conclusion:'The existing decode key contains file/version/tool basis, not the live WCS basis. Version adoption alone does not prove E1 wish compatibility.'
  });

  // The named public load error combines three independent channels.
  const names = new Set(['_previewErr','_surfaceErr','_compGridErr','previewLoadError']);
  const declarations = bulk.statements.filter(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => names.has(d.name.text)));
  assert.equal(declarations.length,4);
  const vue = createRequire(path.join(dependencyRoot, 'package.json'))('vue');
  const errors = {exports:{},ref:vue.ref,computed:vue.computed};
  vm.runInNewContext(js(declarations.map(s=>s.getText(bulk)).join('\n')),errors);
  assert.equal(errors.exports.previewLoadError.value,null);
  vm.runInNewContext('_surfaceErr.value = "surface-only failure";',errors);
  assert.equal(errors.exports.previewLoadError.value,'surface-only failure');
  assert.equal(vm.runInNewContext('_previewErr.value',errors),null);
  add('previewLoadError also reports an unrelated surface channel failure', {
    previewError:vm.runInNewContext('_previewErr.value',errors),
    namedLoadError:errors.exports.previewLoadError.value,
    conclusion:'This union is not evidence of a failure to load the preview for wish W.'
  });

  let rejectBody;
  let beganBody = false;
  const pendingBody = new Promise((_, reject) => {rejectBody=reject});
  const replies = [];
  const timers = [];
  const worker = {exports:{}, require:() => missing, AbortController,
    self:{postMessage:m=>replies.push(m)},
    fetch:async () => ({ok:true, arrayBuffer:() => {beganBody=true;return pendingBody}}),
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},
    setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length},
    clearTimeout:()=>{},clearInterval:()=>{}
  };
  vm.runInNewContext(js(read('lcnc-webui/src/previewWorker.ts')),worker);
  let settled = false;
  const load = worker.self.onmessage({data:{version:11,url:'/preview?v=11',basisKey:key}}).then(()=>{settled=true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(beganBody,true); assert.equal(settled,false);
  assert.equal(replies.length,0); assert.equal(timers.length,0);
  add('a pending HTTP body gives neither a decoded reply nor an error', {
    httpStatus:200, body:'deliberately pending', settled, replies:replies.length,
    workerDeadlines:timers.length,
    limitation:'No real network or elapsed-time claim; the unchanged worker is exercised with a pending body. There is no application deadline to advance.'
  });
  rejectBody(new Error('injected body failure'));
  await load;
  assert.equal(replies.length,1); assert.match(replies[0].error,/injected body failure/);
  assert.equal(replies[0].version,11);
  add('an actual body rejection produces the error E1 plans to consume', {reply:replies[0]});
  console.log(JSON.stringify({revision:rev,kind:'unchanged-source characterization; E1 is not built',results},null,2));
})().catch(err=>{console.error(err);process.exitCode=1});

// Extract and run the actual function with controlled reply delivery; no DOM or transport.
const fs = require('node:fs'), vm = require('node:vm');
const ts = require('/home/cnc/lcnc-suite-ip3/lcnc-webui/node_modules/typescript');
const root = process.argv[2] || '/tmp/codex-r367';
const src = fs.readFileSync(root + '/lcnc-webui/src/App.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
const ast = ts.createSourceFile('App.ts', src, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'confirmToolChange');
if (!fn) throw Error('function not found');
const constants = ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['CONFIRM_REPLY_MS','CONFIRM_NO_REPLY'].includes(d.name.getText(ast))));
if (constants.length !== 2) throw Error('reply constants not found');
const js = ts.transpileModule(constants.map(n=>n.getText(ast)).join('\n') + '\n' + fn.getText(ast), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
(async () => {
 const out = [];
 for (const [name, reply] of [['timeout',null], ['refused',{ok:false,error:'not delivered'}], ['accepted',{ok:true}]]) {
   let sends=0;
   const s = {toolChangeRequested:{value:true},toolChangeSeq:{value:7},confirmSent:{value:null},confirmRefusal:{value:null},
     CONFIRM_REPLY_MS:30000,fire:()=>{sends++;return 'req-1'},awaitReply:()=>Promise.resolve(reply)};
   vm.createContext(s);vm.runInContext(js,s);s.confirmToolChange();s.confirmToolChange();
   await Promise.resolve();await Promise.resolve();
   out.push({case:name,sends,pending:s.confirmSent.value,notice:s.confirmRefusal.value,
     contract:sends===1 && (name==='timeout'?s.confirmRefusal.value==='No reply — outcome unknown' && s.confirmSent.value==='req-1':name==='refused'?s.confirmSent.value===null && s.confirmRefusal.value==='not delivered':s.confirmSent.value==='req-1' && s.confirmRefusal.value===null)});
 }
 for (const [name, pending] of [['ended-before-timeout',null], ['new-owner-before-timeout','req-2']]) {
   let resolve;
   const reply = new Promise(r=>{resolve=r});
   const s = {toolChangeRequested:{value:true},toolChangeSeq:{value:7},confirmSent:{value:null},confirmRefusal:{value:null},
     fire:()=> 'req-1',awaitReply:()=>reply};
   vm.createContext(s);vm.runInContext(js,s);s.confirmToolChange();
   // The existing status/request watchers clear or replace ownership.
   s.confirmSent.value=pending;
   resolve(null); await Promise.resolve(); await Promise.resolve();
   out.push({case:name,pending:s.confirmSent.value,notice:s.confirmRefusal.value,
     contract:s.confirmSent.value===pending && s.confirmRefusal.value===null});
 }
 console.log(JSON.stringify(out,null,2));
 process.exitCode=out.every(x=>x.contract)?0:1;
})();

// Extract and run the actual function with controlled reply delivery; no DOM or transport.
const fs = require('node:fs'), vm = require('node:vm');
const ts = require('/home/cnc/lcnc-suite-ip3/lcnc-webui/node_modules/typescript');
const root = process.argv[2] || '/tmp/codex-r366';
const src = fs.readFileSync(root + '/lcnc-webui/src/App.vue', 'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
const ast = ts.createSourceFile('App.ts', src, ts.ScriptTarget.Latest, true);
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'confirmToolChange');
if (!fn) throw Error('function not found');
const js = ts.transpileModule(fn.getText(ast), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
(async () => {
 const out = [];
 for (const [name, reply] of [['timeout',null], ['refused',{ok:false,error:'not delivered'}], ['accepted',{ok:true}]]) {
   let sends=0;
   const s = {toolChangeRequested:{value:true},toolChangeSeq:{value:7},confirmSent:{value:null},confirmRefusal:{value:null},
     CONFIRM_REPLY_MS:30000,fire:()=>{sends++;return 'req-1'},awaitReply:()=>Promise.resolve(reply)};
   vm.createContext(s);vm.runInContext(js,s);s.confirmToolChange();s.confirmToolChange();
   await Promise.resolve();await Promise.resolve();
   out.push({case:name,sends,pending:s.confirmSent.value,notice:s.confirmRefusal.value,
     contract:name==='timeout'?s.confirmRefusal.value!==null:name==='refused'?s.confirmSent.value===null:s.confirmSent.value==='req-1'});
 }
 console.log(JSON.stringify(out,null,2));
 process.exitCode=out.every(x=>x.contract)?0:1;
})();

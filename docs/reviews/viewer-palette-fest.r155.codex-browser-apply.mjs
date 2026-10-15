// Standalone page, archive source only; no server, application or machine access.
import { chromium } from 'playwright';
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
const source=readFileSync('src/viewer/contactStore.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/*',route=>route.abort());
 await page.setContent('<title>R155 isolated contact table apply</title>');
 await page.addScriptTag({content:`(()=>{const exports={};${js}\nwindow.CodexContactStore=exports;})();`});
 const out=await page.evaluate(async()=>{
  const {ContactStore,REQUEST_BUDGET}=window.CodexContactStore;
  const sender=new ContactStore(155,0),receiver=new ContactStore(155,0);
  const names=['episodes','intervals','gaps'];
  for(const name of names)for(let i=0;i<REQUEST_BUDGET[name];i++)sender[name].append({pair:i%256,onset:i,enter:i,start:i,end:i+1,exit:i+1,firstIv:0xffffffff,next:0xffffffff});
  const initial=sender.takeDelta(true);sender.ack();
  const timing=f=>{const t=performance.now();f();return performance.now()-t;};
  const appendMs=timing(()=>receiver.apply(initial));receiver.takeDelta(true);receiver.ack();
  const updatesMs=[],tablesMs=[];
  for(let run=0;run<5;run++){
   for(const name of names)for(let i=0;i<sender[name].rows;i++)sender[name].set(i,name==='intervals'?'exit':'end',i+run+2);
   const d=sender.takeDelta(true);sender.ack();
   await new Promise(r=>setTimeout(r,50));
   updatesMs.push(timing(()=>receiver.apply(d)));
   receiver.takeDelta(true);receiver.ack();
  }
  for(let run=0;run<3;run++){
   for(const name of names)for(let i=0;i<sender[name].rows;i++)sender[name].set(i,name==='intervals'?'exit':'end',i+run+9);
   const d=sender.takeDelta(true);sender.ack();
   await new Promise(r=>setTimeout(r,50));
   const m={};for(const name of names)m[name]=timing(()=>receiver[name].apply(d[name]));tablesMs.push(m);
   receiver.takeDelta(true);receiver.ack();
  }
  return {userAgent:navigator.userAgent,rows:REQUEST_BUDGET,appendMs,updatesMs,tablesMs};
 });
 const report={commit:'bb2214c0',page:'about:blank; all network requests aborted',scope:'Only ColumnTable / ContactStore apply; excludes Vue, DOM rendering, view build and catch-up',...out};
 writeFileSync('/tmp/codex-r155-r1lqnetr/browser-apply.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}

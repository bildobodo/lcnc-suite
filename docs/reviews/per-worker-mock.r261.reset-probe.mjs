// R261: existing mock state across sequential clients; no browser and no live suite.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const work=resolve(process.argv[2]);assert(work.startsWith('/tmp/'));
const web=join(work,'repo/lcnc-webui');
const WebSocket=createRequire(join(web,'package.json'))('ws');
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const child=spawn(process.execPath,['e2e/mock-gateway.mjs'],{cwd:web,env:{...process.env,MOCK_PORT:String(port),MOCK_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let output='';child.stderr.on('data',d=>output+=String(d));
const stopped=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
const clients=new Set();
function ask(path,payload){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(`ws://127.0.0.1:${port}/${path}`);clients.add(ws);
 const timer=setTimeout(()=>{ws.terminate();reject(new Error('socket timed out'));},3000);
 ws.once('error',reject);ws.once('open',()=>{if(payload)ws.send(JSON.stringify(payload));});
 ws.on('message',buf=>{const x=JSON.parse(String(buf));if(path==='ws'&&x.type!=='status')return;
  clearTimeout(timer);ws.removeAllListeners('message');ws.once('close',()=>{clients.delete(ws);resolve(x);});ws.close();});
});}
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('mock startup timeout '+output)),5000);
  child.once('error',e=>{clearTimeout(t);reject(e)});child.once('exit',(c)=>{clearTimeout(t);reject(new Error('mock exited '+c+' '+output))});
  child.stdout.on('data',d=>{output+=String(d);if(output.includes('mock-gateway:')){clearTimeout(t);resolve();}});});
 const summarize=s=>({armed:s.armed,x:s.data.work_pos[0]});
 const before=summarize(await ask('ws'));
 await ask('ctl',{op:'status_delta',armed:false,data:{work_pos:[99.125,1,-5.5]}});
 const nextClient=summarize(await ask('ws'));
 await ask('ctl',{op:'reset'});
 const resetClient=summarize(await ask('ws'));
 assert.deepEqual(before,{armed:true,x:12.345});assert.deepEqual(nextClient,{armed:false,x:99.125});assert.deepEqual(resetClient,before);
 writeFileSync(join(work,'reset-result.json'),JSON.stringify({port,pid:child.pid,before,nextClient,resetClient,conclusion:'A fresh client inherits prior mock state; only explicit reset restores defaults.'},null,2));
 console.log(JSON.stringify({before,nextClient,resetClient}));
}finally{for(const ws of clients)ws.terminate();child.kill('SIGTERM');const t=setTimeout(()=>child.kill('SIGKILL'),2000);await stopped;clearTimeout(t);writeFileSync(join(work,'mock-output.txt'),output);}

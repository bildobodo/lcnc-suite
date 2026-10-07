const pending=[];
self.onmessage=e=>pending.push(e);
const NativeWorker = globalThis.Worker;
globalThis.Worker = class extends NativeWorker { constructor() { super("/r91-failing-child.js", {type:"module"}); } };
await import("/src/viewer/collisionWorker.ts?worker_file&type=module");
for(const e of pending) self.onmessage(e);

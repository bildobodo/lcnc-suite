let armed=false;
self.onmessage=()=>{ if(!armed) { armed=true; setTimeout(()=>{throw new Error("R91 injected native child failure");},50); } };

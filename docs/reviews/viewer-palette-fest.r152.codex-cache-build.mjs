import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
await build({entryPoints:['r152.codex-cache-probe.ts'],outfile:'/tmp/codex-r152-706x1qnd/cache-probe.cjs',bundle:true,platform:'node',format:'cjs',plugins:[{name:'read-only-cache-inspection',setup(b){
 b.onLoad({filter:/\/contactView\.ts$/},async args=>({loader:'ts',contents:await readFile(args.path,'utf8')+`\nexport function codexInspectLastGroup(v: ContactView) { const g=lastGroup.get(v); return g?{keys:Object.keys(g),sideCount:g.sides.length,separatorLength:g.seps.length}:null; }\n`}));
}}]});

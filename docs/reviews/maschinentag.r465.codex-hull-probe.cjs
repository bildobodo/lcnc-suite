// Original scratch builder; no product modules or controller used.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ts=require('/home/cnc/lcnc-suite-dev/lcnc-webui/node_modules/typescript');
const text=fs.readFileSync('/tmp/r465/probes/p6probe.f8hull.ts','utf8');
const m={exports:{},performance,require:(id)=>new Proxy({}, {get(){return ()=>{throw Error('unused dependency called: '+id)}}})};
vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m);
const {closedHull,crossSection}=m.exports;
// Independent analytic check: clipping vertices and edges directly to each Z plane,
// without using the builder's polygon clipper or requiredRadii.
function analyticRadius(tris,a,b){
 let radius=0;
 for(let j=0;j<tris.length;j+=9){
  const v=[0,1,2].map(k=>[tris[j+3*k],tris[j+3*k+1],tris[j+3*k+2]]);
  for(const p of v)if(p[2]>=a && p[2]<=b)radius=Math.max(radius,Math.hypot(p[0],p[1]));
  for(let k=0;k<3;k++)for(const z of [a,b]){
    const p=v[k],q=v[(k+1)%3];
    if(p[2]===q[2])continue;
    const t=(z-p[2])/(q[2]-p[2]);
    if(t>=0&&t<=1)radius=Math.max(radius,Math.hypot(p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])));
  }
 }
 return radius;
}
const sample=new Float32Array([4,0,-4, 4,0,160, 0,4,160, 12,0,30, 12,0,100, 4,3,60]);
function check(mut={}){
 const h=closedHull(sample,2,0,{mut:{noPinUnion:true,...mut}});
 let failed=0;
 for(let k=0;k<h.K;k++){
  const req=analyticRadius(sample,h.b[k],h.b[k+1]);
  if(req===0)continue;
  const cross=crossSection(h.pos,(h.b[k]+h.b[k+1])/2);
  if(!cross.axisInside||cross.apothem<req)failed++;
 }
 return {slabs:h.K,failed};
}
const control=check(),vertices=check({verticesOnly:true}),inscribed=check({inscribed:true});
assert.equal(control.failed,0);assert.ok(vertices.failed>0);assert.ok(inscribed.failed>0);
// A closed cylinder with many angular facets: side triangles all span 160 mm,
// cap triangles span no slab. 40,002 vertices / 80,000 triangles: below native limits.
function longCylinder(n){
 const v=new Float32Array(n*4*9);let p=0;
 const add=(...pts)=>{for(const pt of pts)for(const c of pt)v[p++]=c;};
 for(let k=0;k<n;k++){
  const a=2*Math.PI*k/n,b=2*Math.PI*(k+1)/n;
  const a0=[4*Math.cos(a),4*Math.sin(a),0],b0=[4*Math.cos(b),4*Math.sin(b),0];
  const a1=[a0[0],a0[1],160],b1=[b0[0],b0[1],160];
  add(a0,b0,b1);add(a0,b1,a1);add([0,0,0],b0,a0);add([0,0,160],a1,b1);
 }
 return v;
}
const timings=[];
if(!process.argv.includes("--geometry-only")){
const soup=longCylinder(20000);
for(let i=0;i<3;i++){
 const h=closedHull(soup,2,0,{mut:{noPinUnion:true}});
 timings.push({buildMs:h.buildMs,slabs:h.K,inputTriangles:soup.length/9,outputTriangles:h.tris});
}
}
console.log(JSON.stringify({review:'R465',independent_containment:{control,vertices_mutant:vertices,inscribed_mutant:inscribed},
 timings,limits:['Original scratch closedHull with only the optional union with the old pin disabled; this isolates the drawn-shape cost.',
 'No page/worker pool or N100 measurement; synchronous CPU build in Node on this VM.',
 '80k facets of one closed cylinder; within the importer limits. Geometry construction excluded from the timings.']},null,2));

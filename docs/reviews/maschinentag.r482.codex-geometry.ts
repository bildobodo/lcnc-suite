import { cases, scaled, visLenOf } from './contain_lib';
import { generated, rings } from './run7';
import { hullPositions } from './hull5';
import { drawingSteps, bodySteps, drawnSoup6, counter, runAll, OPTS6, setMut6, quarterTurn } from './hull7';
import { judge } from './judge6';
import { toolCylinderPositions, withoutArealessFacets } from '/tmp/r482/tree/lcnc-webui/src/viewer/collision';
import { meshClosure } from '/tmp/r482/tree/lcnc-webui/src/viewer/insideCheck';

function check(c:any,u:number) {
  const vl=visLenOf(c.L,u),o=OPTS6(u),cnt=counter();
  const d=runAll(drawingSteps(c.D,vl,c.meta,u,o,cnt));
  const h=structuredClone(runAll(bodySteps(d,c.D,vl,o,cnt,c.meta?.native_mesh)));
  const pos=hullPositions(h),soup=drawnSoup6(d);
  const shape=judge(soup,pos),pin=judge(toolCylinderPositions(c.D,vl),pos);
  return {h,pos,soup,shape,pin,d};
}
const out:any[]=[];
{
 let count=0,notClosed=0,arealess=0,witnesses=0;const red:any[]=[];
 for(const u of [1,1/25.4])for(const raw of cases()) {
   const c=scaled(raw,u),r=check(c,u);count++;witnesses+=r.shape.wit;
   if(r.shape.bad||r.pin.bad)red.push({name:c.name,u,shape:r.shape,pin:r.pin});
   if(!meshClosure(r.pos).closed)notClosed++;
   arealess+=withoutArealessFacets(r.pos).dropped;
 }
 out.push({kind:'supplied-controls',count,red,notClosed,arealess,witnesses});
}
{
 let count=0,witnesses=0;const red:any[]=[];
 for(const c of generated()) {
   const r=check(c,c.u);count++;witnesses+=r.shape.wit;
   if(r.shape.bad||r.pin.bad)red.push({name:c.name,u:c.u,shape:r.shape,pin:r.pin});
 }
 out.push({kind:'supplied-generator',count,witnesses,red});
}
for(const mut of ['', 'rotated', 'rotatedZPatched']) {
  setMut6(mut);let count=0,red=0;
  for(const c of rings()) { const r=check(c,c.u);count++;if(r.shape.bad||r.pin.bad)red++; }
  out.push({kind:'rings',mut,count,red});
}
const disk={name:'disk',D:2,L:60,meta:{type:'formmill',oal:80,
  native_mesh:{vertices:[[0,0,5],[9,0,5],[0,9,5],[-9,0,5]],triangles:[[0,1,2],[0,2,3]]}}};
const flat={name:'flat profile',D:2,L:60,meta:{type:'formmill',oal:80,native_profile:[[0,5],[9,5],[1,5],[0,5]]}};
const at=(h:any,z:number)=>{let k=0;while(k+1<h.rho.length&&h.z[k+1]<z)k++;return h.rho[k];};
for(const mut of ['', 'flatOneSide']) {
  setMut6(mut);
  for(const c of [disk,flat]) {
    const r=check(c,1),below=at(r.h,4.5),above=at(r.h,5.5);
    out.push({kind:'closed-flat-policy',name:c.name,mut,below,above,
      both:below>=9/Math.cos(Math.PI/20)&&above>=9/Math.cos(Math.PI/20),shape:r.shape});
  }
}
setMut6('');
// The source transformation is the same signed permutation for positions
// and normals, including subnormal/signed-zero values; no geometry builder.
const a=new Float32Array([1,2,3,-0,1e-44,-1e30,1e-9,1e12,-1e-20]);
const before=Array.from(a);quarterTurn(a);
out.push({kind:'exact-swap',before,after:Array.from(a),
 exact:before.every((_,i)=>Object.is(a[i],i%3===0?before[i]:i%3===1?-before[i+1]!:before[i-1]))});
console.log(JSON.stringify(out,null,2));

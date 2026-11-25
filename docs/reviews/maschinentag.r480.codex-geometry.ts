import { cases, scaled, visLenOf, hullOf } from './contain_lib';
import { generated } from './run6';
import { hullPositions } from './hull5';
import { drawingSteps, bodySteps, drawnSoup6, counter, runAll, OPTS6, setRule } from './hull6';
import { judge } from './judge6';
import { toolCylinderPositions, withoutArealessFacets } from '/tmp/r480/tree/lcnc-webui/src/viewer/collision';
import { meshClosure } from '/tmp/r480/tree/lcnc-webui/src/viewer/insideCheck';

function check(c: any, u: number, rule: string) {
  setRule(rule); const vl=visLenOf(c.L,u),o=OPTS6(u),cnt=counter();
  const d=runAll(drawingSteps(c.D,vl,c.meta,u,o,cnt));
  const h=structuredClone(runAll(bodySteps(d,c.D,vl,o,cnt,c.meta?.native_mesh)));
  const pos=hullPositions(h),soup=drawnSoup6(d);
  const shape=judge(soup,pos),pin=judge(toolCylinderPositions(c.D,vl),pos);
  return {h,pos,soup,shape,pin,ops:cnt.max};
}
const rows:any[]=[];
for(const rule of ['closed','open']) {
  let count=0,notClosed=0,arealess=0; const red:any[]=[];
  for(const u of [1,1/25.4])for(const raw of cases()) {
    const c=scaled(raw,u),r=check(c,u,rule); count++;
    if(r.shape.bad||r.pin.bad)red.push({name:c.name,u,shape:r.shape,pin:r.pin});
    if(!meshClosure(r.pos).closed)notClosed++;
    arealess+=withoutArealessFacets(r.pos).dropped;
  }
  rows.push({kind:'supplied-controls',rule,count,red,notClosed,arealess});
}
for(const rule of ['closed','open']) {
  let count=0,witnesses=0;const red:any[]=[];
  for(const c of generated()) {
    const r=check(c,c.u,rule);count++;witnesses+=r.shape.wit;
    if(r.shape.bad||r.pin.bad)red.push({name:c.name,u:c.u,shape:r.shape,pin:r.pin});
  }
  rows.push({kind:'supplied-generator',rule,count,witnesses,red});
}
// A flat disk lies exactly on an internal 5 mm boundary. The old touching
// policy grows both slabs; the v6 scratch flat handler chooses only one even
// when RULE is "closed". This is a policy comparison, not a containment miss.
const disk:any={name:'isolated disk at z=5',D:2,L:60,meta:{type:'formmill',
  native_mesh:{vertices:[[0,0,5],[9,0,5],[0,9,5],[-9,0,5]],triangles:[[0,1,2],[0,2,3]]},oal:80}};
const old=hullOf(disk,1);
function radiusAt(h:any,z:number){let k=0;while(k+1<h.z.length&&h.z[k+1]<z)k++;return h.rho[k];}
for(const rule of ['closed','open']) {
  const r=check(disk,1,rule);
  rows.push({kind:'flat-policy',rule,v5:{below:radiusAt(old,4.5),above:radiusAt(old,5.5)},
    v6:{below:radiusAt(r.h,4.5),above:radiusAt(r.h,5.5)},shape:r.shape});
}
// Admitted finite native-profile inputs. This checks the scratch's remaining
// rotation mixing, not the plan's ideal x/y formula. No physical significance
// is inferred from sub-nanometre discrepancies.
for(const [r,z] of [[1e-9,500],[1,1e12]] as const) {
  const c:any={name:'thin radial ring above the table pin',D:2,L:60,meta:{type:'formmill',
    native_profile:[[0,z-1],[r,z-1],[r,z],[0,z]],oal:z}};
  const x=check(c,1,'closed');
  rows.push({kind:'rotation-residual',r,z,shape:x.shape,pin:x.pin,
    allCoordinatesFinite:Array.from(x.soup).every(Number.isFinite)});
}
console.log(JSON.stringify(rows,null,2));

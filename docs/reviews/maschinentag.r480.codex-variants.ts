import * as THREE from 'three';
import { drawingSteps, bodySteps, drawnSoup6, counter, runAll, OPTS6, setRule, type Drawing } from './hull6';
import { hullPositions } from './hull5';
import { judge } from './judge6';

function exactQuarterTurn(d:Drawing):Float32Array {
  if(d.kind!=='lathe')throw new Error('lathe expected');
  const pieces:Float32Array[]=[];
  for(const {prof,segments} of d.parts){
    const pts=Array.from({length:prof.length/2},(_,i)=>new THREE.Vector2(prof[i*2],prof[i*2+1]));
    const g=new THREE.LatheGeometry(pts,segments),a=g.getAttribute('position').array as Float32Array;
    for(let i=0;i<a.length;i+=3){const y=a[i+1],z=a[i+2];a[i+1]=-z;a[i+2]=y;}
    pieces.push(new Float32Array(g.toNonIndexed().getAttribute('position').array as Float32Array));
  }
  const out=new Float32Array(pieces.reduce((n,p)=>n+p.length,0));let k=0;
  for(const p of pieces){out.set(p,k);k+=p.length;}return out;
}
setRule('closed');
const rows=[];
for(const [r,z] of [[1e-9,500],[1,1e12],[1,500],[10,80]] as const){
  const meta:any={type:'formmill',native_profile:[[0,z-1],[r,z-1],[r,z],[0,z]],oal:z};
  const d=runAll(drawingSteps(2,80,meta,1,OPTS6(1),counter()));
  const pos=hullPositions(runAll(bodySteps(d,2,80,OPTS6(1),counter())));
  rows.push({r,z,scratch:judge(drawnSoup6(d),pos),exactQuarterTurn:judge(exactQuarterTurn(d),pos)});
}
console.log(JSON.stringify(rows,null,2));

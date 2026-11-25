import { cases, scaled, hullOf, soupOf, violations, slabsOf } from './contain_lib';
import { hullPositions, boundaries, OPTS } from './hull5';
import { toolCylinderPositions } from '/tmp/r477/tree/lcnc-webui/src/viewer/collision';

// Repeats the supplied independent judgement, without changing its builder or
// guard. The extra wedge is Codex's input, not a product change.
const controls: any[] = [];
for (const u of [1, 1 / 25.4]) {
  for (const source of cases()) {
    const c = scaled(source, u);
    const h = structuredClone(hullOf(c, u));
    const v = violations(soupOf(c, u), hullPositions(h));
    controls.push({name: c.name, u, ...v});
  }
}
console.log(JSON.stringify({kind: 'supplied-controls', count: controls.length,
  failures: controls.filter(x => x.bad)}, null, 2));

for (const u of [1, 1 / 25.4]) {
  const pin = toolCylinderPositions(2*u, 80*u);
  let minZ = 0;
  for (let i=2; i<pin.length; i+=3) minZ = Math.min(minZ, pin[i]!);
  const level = boundaries(minZ,80*u,OPTS(u))[1]!;
  const buf = new ArrayBuffer(4), fv=new Float32Array(buf), iv=new Uint32Array(buf);
  fv[0]=level; iv[0]++; const ulp=fv[0]!-level;
  for (const above of [0, .25, .4, .75]) {
    const z = level + above*ulp;
    const angles = [Math.PI/20, Math.PI/20+2*Math.PI/20];
    const vertices = [ [0,0,level-.01*u],
      ...angles.map(a=>[10*u*Math.cos(a),10*u*Math.sin(a),z]), [0,0,z] ];
    const c:any = {name:'inner-boundary closed wedge',D:2*u,L:60*u,
      meta:{type:'formmill',native_mesh:{vertices,triangles:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]},oal:80*u}};
    const h=hullOf(c,u), drawn=soupOf(c,u), pos=hullPositions(structuredClone(h));
    // A witness strictly BELOW the boundary, on a drawn triangle's edge:
    // it cannot be rescued by assigning the boundary face to the upper slab.
    const a=vertices[0]!.map(Math.fround), b=vertices[1]!.map(Math.fround);
    const witnessZ=level-.125*ulp;
    const t=(witnessZ-a[2]!)/(b[2]!-a[2]!);
    const point=a.map((x,i)=>x+t*(b[i]!-x));
    const slab=slabsOf(pos).slabs.find(s=>point[2]!>s.a && point[2]!<s.b)!;
    const distanceToSide=Math.max(...slab.planes.map(([nx,ny,d])=>nx*point[0]!+ny*point[1]!-d));
    // Proposed construction variant, probe only: use the same f32 positions
    // that the drawing receives. Leave the original drawing and guard intact.
    const quantized=structuredClone(c);
    quantized.meta.native_mesh.vertices=vertices.map(v=>v.map(Math.fround));
    const variant=violations(drawn,hullPositions(structuredClone(hullOf(quantized,u))));
    console.log(JSON.stringify({kind:'new-wedge',u,above,level,ulp,
      sourceTop:z,drawnTop:Math.fround(z),z:Array.from(h.z),rho:Array.from(h.rho),
      ...violations(drawn,pos),interiorWitness:{point,distanceToSide},
      quantizedInputVariant:variant}, null,2));
  }
}

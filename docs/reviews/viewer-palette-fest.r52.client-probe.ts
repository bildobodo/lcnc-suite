import { it, expect } from 'vitest';
import { readFileSync,writeFileSync } from 'node:fs';
import { tloForIndex } from './viewer/tloEvents';
import { liftToJoints,wcsTerms } from './viewer/partFrame';
it('R52 proposed G53 coordinates plus unchanged client live fallback',()=>{
 const data=JSON.parse(readFileSync('../evidence/viewer-palette-fest.r52.native-probe.json','utf8'));
 const c=data.cases.find((c:any)=>c.case==='g53'&&c.seed_z===10);
 const p=c.rapid[0];
 const terms=wcsTerms({g5x:[0,0,0],g92:[0,0,0],rotationDeg:0});
 const rows=[10,10.005,20].map(live=>{
  const out:number[]=[];
  liftToJoints(p[0],p[1],p[2],0,0,0,terms,tloForIndex(undefined,undefined,[0,0,live]),out);
  return {parseSeedZ:10,liveZ:live,programZ:p[2],reconstructedMachineZ:out[2],expectedG53MachineZ:0};
 });
 expect(rows[0]!.reconstructedMachineZ).toBeCloseTo(0);
 expect(rows[1]!.reconstructedMachineZ).toBeCloseTo(.005);
 expect(rows[2]!.reconstructedMachineZ).toBeCloseTo(10);
 writeFileSync('../evidence/viewer-palette-fest.r52.client-basis.json',JSON.stringify(rows,null,2)+'\n');
});

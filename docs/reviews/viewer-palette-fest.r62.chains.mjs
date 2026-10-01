// Run from an archive's evidence directory (node_modules linked in lcnc-webui).
import {LineSegments2} from '../lcnc-webui/node_modules/three/examples/jsm/lines/LineSegments2.js';
import {LineSegmentsGeometry} from '../lcnc-webui/node_modules/three/examples/jsm/lines/LineSegmentsGeometry.js';
const segments=[
 {chain:'A',start:[7,0,0],end:[10,0,0],expectedStart:7,expectedEnd:10},
 {chain:'B',start:[0,10,0],end:[5,10,0],expectedStart:0,expectedEnd:5},
 {chain:'A',start:[0,0,0],end:[7,0,0],expectedStart:0,expectedEnd:7},
];
const geom=new LineSegmentsGeometry();geom.setPositions(segments.flatMap(s=>[...s.start,...s.end]));
const line=new LineSegments2(geom);line.computeLineDistances();
console.log(JSON.stringify(segments.map((s,i)=>({...s,actualStart:geom.getAttribute('instanceDistanceStart').getX(i),actualEnd:geom.getAttribute('instanceDistanceEnd').getX(i)})),null,2));
line.geometry.dispose();line.material.dispose();

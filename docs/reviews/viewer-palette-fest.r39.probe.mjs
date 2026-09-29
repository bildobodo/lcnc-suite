// R39: small source/API and arithmetic probes; no renderer, DOM, gateway, or product mutation.
// node this-file.mjs [absolute node_modules directory]
import {pathToFileURL} from 'node:url';
const modules=process.argv[2] || '/home/cnc/lcnc-suite/lcnc-webui/node_modules';
const load=rel=>import(pathToFileURL(modules+'/three/'+rel).href);
const THREE=await load('build/three.module.js');
const {LineSegmentsGeometry}=await load('examples/jsm/lines/LineSegmentsGeometry.js');
const {LineSegments2}=await load('examples/jsm/lines/LineSegments2.js');
const {LineMaterial}=await load('examples/jsm/lines/LineMaterial.js');
const geo=new LineSegmentsGeometry().setPositions(new Float32Array([0,0,0,1,0,0, 2,0,0,3,0,0]));
const dist=new THREE.InstancedInterleavedBuffer(new Float32Array([0,1,2,3]),2,1);
geo.setAttribute('instanceDistanceStart',new THREE.InterleavedBufferAttribute(dist,1,0));
geo.setAttribute('instanceDistanceEnd',new THREE.InterleavedBufferAttribute(dist,1,1));
const mat=new LineMaterial({linewidth:2,worldUnits:false,dashed:true});
const line=new LineSegments2(geo,mat);
mat.resolution.set(123,456);
let calls=0;
line.onBeforeRender({getViewport(out){calls++;return out.set(0,0,800,400);}});
const n=1200000,levels=3,MiB=2**20;
// Camera-edge example. Only centreline sphere is used by normal frustum culling.
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
camera.position.z=2;camera.updateMatrixWorld();
const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
const x=1.001,r=.00005,halfWidthWorld=1*2/800;
function percentile(a,p){a=[...a].sort((x,y)=>x-y);return a[Math.ceil(a.length*p/100)-1];}
const a=[...Array(94).fill(1),...Array(6).fill(100)],b=Array(100).fill(1);
const result={
 source:{three_revision:THREE.REVISION,scope:'API/arithmetic only, no WebGL rendering'},
 geometry:{segments:geo.instanceCount,position_bytes:geo.attributes.instanceStart.data.array.byteLength,distance_bytes:dist.array.byteLength,start_end_share_data:geo.attributes.instanceStart.data===geo.attributes.instanceEnd.data,prototype_vertices:geo.attributes.position.count,prototype_indices:geo.index.count,isMesh:line.isMesh,isLine:line.isLine===true,default_depthWrite:mat.depthWrite},
 resolution:{assigned_centrally:[123,456],after_default_onBeforeRender:mat.resolution.toArray(),viewport_reads:calls,cssHeight:400,framebufferHeightAtDpr2:800,widthCSSIfPhysicalResolutionUsedFor400CSS:2*400/800},
 memory_arithmetic:{segments:n,full_levels:levels,position_only_per_level_MiB:24*n/MiB,positions_all_levels_MiB:24*n*levels/MiB,distances_all_rapid_levels_MiB:8*n*levels/MiB,base_plus_full_duplicate_overlay_positions_MiB:2*24*n*levels/MiB,note:'Gross capacities. Not measured net increase; excludes source arrays, metadata, reveal, prototype buffers, retained old branch and allocation/upload peaks. Eager packing does not imply every level has been uploaded to GPU yet.'},
 edge_culling:{camera_x_range:[-1,1],css_width:800,line_width_css:2,centreline_x:x,sphere_radius:r,centreline_sphere_accepted:frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(x,0,0),r)),expanded_line_left_x:x-halfWidthWorld,expanded_line_overlaps_view:x-halfWidthWorld<1},
 quantiles:{window_size:100,window_p95:[percentile(a,95),percentile(b,95)],mean_of_window_p95:(percentile(a,95)+percentile(b,95))/2,pooled_p95:percentile([...a,...b],95),note:'Window quantiles cannot be averaged into an overall run percentile; source emits 3-second windows.'}
};
geo.dispose();mat.dispose();console.log(JSON.stringify(result,null,2));

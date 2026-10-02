"""R67 read-only frame observer, to apply ONLY in the disposable archive.

Records rendered tick endpoints and label scale after renderer.render. Does
not update the camera, re-pose ticks/labels, or change the rendering behavior.
"""
from pathlib import Path
import difflib
p=Path('src/ThreeViewer.vue')
a=p.read_text()
needle='  renderer?.render(scene!, camera!);\n'
addition='''  // R67 evidence ONLY: observe the completed frame without re-posing it.
  if ((window as any).__r67Frames && camera instanceof THREE.PerspectiveCamera && renderer) {
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const screen = (p: number[]) => {
      const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera!);
      return [(v.x + 1) * w / 2, (1 - v.y) * h / 2, v.z];
    };
    const bars = (toolpath.boxTicks() ?? []).map((b, i) => {
      const a = screen(b.slice(0, 3)), c = screen(b.slice(3));
      return { i, visible: [a,c].every(p => p[0]! >= 0 && p[0]! <= w && p[1]! >= 0 && p[1]! <= h && Math.abs(p[2]!) < 1),
        length: Math.hypot(c[0]! - a[0]!, c[1]! - a[1]!) };
    }).filter(b => b.visible && b.length > 0.1);
    const labels = [_machineTypeLabel, _programTypeLabel].filter(g => g?.visible).map(g => {
      const at = g!.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera!.matrixWorldInverse);
      const c = camera as THREE.PerspectiveCamera;
      const expected = 2 * -at.z * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2) / c.zoom / h;
      return {name: g!.name, scale: g!.scale.x, expected, factor: g!.scale.x / expected};
    });
    (window as any).__r67Frames.push({at: performance.now(), eye: camera.position.toArray(), bars, labels});
  }
'''
assert a.count(needle)==1
b=a.replace(needle,needle+addition)
p.write_text(b)
Path('../evidence/viewer-palette-fest.r67.observer.patch').write_text(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/lcnc-webui/src/ThreeViewer.vue',tofile='b/lcnc-webui/src/ThreeViewer.vue')))

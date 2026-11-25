// P6-c6 scratch: the independent judge (brute force, the REBUILT mesh's own
// side planes, tolerance 0) with witnesses strictly inside each slab.
import { slabsOf } from "./contain_lib";
export function judge(soup: Float32Array, pos: Float32Array) {
  const { zs, slabs } = slabsOf(pos); let bad = 0, worst = 0, first = "", wit = 0;
  const z0 = zs[0]!, z1 = zs[zs.length - 1]!;
  const out = (s: any, x: number, y: number) => { let m = -Infinity; for (const [nx, ny, d] of s.planes) m = Math.max(m, nx * x + ny * y - d); return m; };
  const fb = new ArrayBuffer(4), fv = new Float32Array(fb), iv = new Int32Array(fb);
  const ulp = (z: number) => { fv[0] = Math.abs(z) || 1e-30; const a = fv[0]!; iv[0]!++; return fv[0]! - a; };
  for (let t = 0; t < soup.length; t += 9) {
    const P = [0, 3, 6].map(o => [soup[t + o]!, soup[t + o + 1]!, soup[t + o + 2]!] as number[]);
    const lo = Math.min(P[0]![2]!, P[1]![2]!, P[2]![2]!), hi = Math.max(P[0]![2]!, P[1]![2]!, P[2]![2]!);
    if (lo < z0 || hi > z1) { bad++; first ||= `cap ${lo}..${hi} of ${z0}..${z1}`; worst = Math.max(worst, z0 - lo, hi - z1); }
    for (const s of slabs) {
      const flat = lo === hi;
      if (flat ? (lo < s.a || lo > s.b) : (hi <= s.a || lo >= s.b)) continue;
      const pts: number[][] = P.filter(p => p[2]! >= s.a && p[2]! <= s.b);
      for (let e = 0; e < 3; e++) {
        const p = P[e]!, q = P[(e + 1) % 3]!; if (p[2] === q[2]) continue;
        const at = (zc: number) => { const u = (zc - p[2]!) / (q[2]! - p[2]!); return u < 0 || u > 1 ? null : [p[0]! + u * (q[0]! - p[0]!), p[1]! + u * (q[1]! - p[1]!), zc]; };
        for (const zc of [s.a, s.b]) { const x = at(zc); if (x) pts.push(x); }
        // strictly inside, fractions of an ulp from either boundary
        for (const zc of [s.b - ulp(s.b) / 8, s.b - ulp(s.b) / 2, s.a + ulp(s.a) / 8, s.a + ulp(s.a) / 2]) if (zc > s.a && zc < s.b) { const x = at(zc); if (x) { wit++; const m = out(s, x[0]!, x[1]!); if (m > 0) { bad++; worst = Math.max(worst, m); first ||= `witness z ${zc} by ${m}`; } } }
      }
      let m = -Infinity; for (const p of pts) m = Math.max(m, out(s, p[0]!, p[1]!));
      if (flat && m > 0) { const other = slabs.find(x => x !== s && lo >= x.a && lo <= x.b); if (other) { let o2 = -Infinity; for (const p of P) o2 = Math.max(o2, out(other, p[0]!, p[1]!)); m = Math.min(m, o2); } }
      if (m > 0) { bad++; worst = Math.max(worst, m); first ||= `slab ${s.a}..${s.b} by ${m}`; }
    }
  }
  return { bad, worst, first, wit };
}

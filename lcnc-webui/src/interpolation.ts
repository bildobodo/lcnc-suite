/** Inverse Distance Weighting interpolation for probe surface maps. */
export function idwInterp(px: number, py: number, points: [number, number, number][], power = 2): number {
  let wSum = 0, vSum = 0;
  for (const p of points) {
    const dx = px - p[0], dy = py - p[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-10) return p[2];
    const w = 1 / Math.pow(Math.sqrt(d2), power);
    wSum += w;
    vSum += w * p[2];
  }
  return wSum > 0 ? vSum / wSum : 0;
}

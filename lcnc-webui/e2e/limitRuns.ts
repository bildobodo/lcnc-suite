// A synthetic preview payload's limit records, bound to their moves the way
// the gateway binds a MAIN-program record (Codex R177 VP-I130): a record
// without stretches gets the seq runs of the points carrying its line that a
// move ends OUTSIDE at (the payload's flags) — every point of the line where
// none is flagged. A record that names its origin (`sub`) or its runs is kept
// as written.

type Lines = ArrayLike<number> | Uint8Array | undefined;

/** A wire channel as numbers: a plain list, or the gateway's LE uint32 bytes. */
function u32(v: unknown): number[] {
  if (!v) return [];
  if (v instanceof Uint8Array) return Array.from(new Uint32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
  return Array.from(v as ArrayLike<number>);
}

export function withLimitRuns<T extends Record<string, unknown>>(f: T): T {
  const points: Array<[number, number, boolean]> = [];   // [seq, line, outside]
  for (const s of ["feed", "rapid"]) {
    const lines = u32(f[`${s}_lines`] as Lines), seqs = u32(f[`${s}_seq`] as Lines);
    const out = f[`${s}_outside`] as ArrayLike<number> | undefined;
    for (let i = 0; i < Math.min(lines.length, seqs.length); i++) points.push([seqs[i]!, lines[i]!, !!out?.[i]]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const violations = (f.violations as Array<Record<string, unknown>> | undefined)?.map(v => {
    if (v.runs || v.sub != null) return v;
    const flagged = points.some(([, line, o]) => line === v.line && o);
    const runs: Array<[number, number]> = [];
    for (const [q, line, o] of points) {
      if (line !== v.line || (flagged && !o)) continue;
      const last = runs[runs.length - 1];
      if (last && q === last[1] + 1) last[1] = q; else runs.push([q, q]);
    }
    return runs.length ? { ...v, runs, nruns: runs.length } : v;
  });
  return violations ? { ...f, violations } : f;
}

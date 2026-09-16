// Per-line index over a point stream as TYPED ARRAYS (2026-09-05).
//
// line number → first/last point index, and → the scrub parameter (cum)
// at the line's first point. Replaces three Maps and a Set that each held
// one entry per source line: on a 1.18 M-line program that was ~4.7 M
// heap objects the browser's collector marked on every major GC (110 to
// 140 ms measured, the ~100 ms hitch in half of all interactive windows)
// plus a 0.9 s structured clone of the line map on every publish.
//
// Line numbers are dense and bounded by the file's line count, so the
// index is DIRECT: arrays sized maxLine + 1, NO_LINE where a line has no
// point. O(1) lookups, transferable across workers, zero heap objects.
// Semantics mirror the Maps they replace: start/end = first/last point of
// the line (line 0 = unknown line is indexed too, like buildLineMap did);
// cum is recorded for lines > 0 only (lineCum never mapped 0).

export const NO_LINE = 0xffffffff;

/** A corrupt payload must not allocate the moon: 20 M lines × 8 B. */
const MAX_LINE = 20_000_000;

export interface LineIndex {
  /** Highest line number present (arrays are maxLine + 1 long); -1 when empty. */
  readonly maxLine: number;
  /** Point index of the line's FIRST point, NO_LINE when it has none. */
  readonly start: Uint32Array;
  /** Point index of the line's LAST point, NO_LINE when it has none. */
  readonly end: Uint32Array;
  /** cum at the line's first point (scrub tracks); null for drawn streams.
   *  NaN for lines without a point and for line 0. */
  readonly cum: Float64Array | null;
  /** Distinct lines with at least one point. */
  readonly count: number;
}

/** A fresh empty index (never share one: its buffers may be transferred). */
export function emptyLineIndex(): LineIndex {
  return { maxLine: -1, start: new Uint32Array(0), end: new Uint32Array(0), cum: null, count: 0 };
}

export function buildLineIndex(
  lines: ArrayLike<number> | undefined | null,
  cum?: ArrayLike<number> | null,
): LineIndex {
  if (!lines || lines.length === 0) return emptyLineIndex();
  const n = lines.length;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const ln = lines[i]!;
    if (ln > max) max = ln;
  }
  if (max > MAX_LINE) throw new Error(`line index: line number ${max} exceeds ${MAX_LINE}`);
  const start = new Uint32Array(max + 1).fill(NO_LINE);
  const end = new Uint32Array(max + 1).fill(NO_LINE);
  const c = cum ? new Float64Array(max + 1).fill(NaN) : null;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const ln = lines[i]!;
    if (start[ln] === NO_LINE) {
      start[ln] = i;
      count++;
      if (c && ln > 0) c[ln] = cum![i]!;
    }
    end[ln] = i;
  }
  return { maxLine: max, start, end, cum: c, count };
}

export function lineHas(idx: LineIndex | null | undefined, line: number): boolean {
  return !!idx && line >= 0 && line <= idx.maxLine && idx.start[line] !== NO_LINE;
}

export function lineRange(idx: LineIndex | null | undefined, line: number): { start: number; end: number } | undefined {
  if (!lineHas(idx, line)) return undefined;
  return { start: idx!.start[line]!, end: idx!.end[line]! };
}

/** cum of the line's first point, undefined when the line has no point
 *  (or is 0 — the unknown line was never mapped). */
export function lineCumOf(idx: LineIndex | null | undefined, line: number): number | undefined {
  if (!idx || !idx.cum || !lineHas(idx, line)) return undefined;
  const v = idx.cum[line]!;
  return Number.isNaN(v) ? undefined : v;
}

/** Sorted line numbers that have points (tests / diagnostics; O(maxLine)). */
export function lineIndexLines(idx: LineIndex): number[] {
  const out: number[] = [];
  for (let ln = 0; ln <= idx.maxLine; ln++) if (idx.start[ln] !== NO_LINE) out.push(ln);
  return out;
}

/** The buffers to hand to postMessage's transfer list. */
export function lineIndexTransferables(idx: LineIndex | null | undefined): ArrayBuffer[] {
  if (!idx || idx.maxLine < 0) return [];
  const out: ArrayBuffer[] = [idx.start.buffer as ArrayBuffer];
  if (idx.end.buffer !== idx.start.buffer) out.push(idx.end.buffer as ArrayBuffer);
  if (idx.cum) out.push(idx.cum.buffer as ArrayBuffer);
  return out;
}

// ---- line masks (the trusted-lines Set replacement) ----

/** Bitmap over line numbers: mask[line] === 1 means present. */
export function lineMaskFrom(lines: Iterable<number>): Uint8Array {
  let max = -1;
  const arr = Array.from(lines);
  for (const ln of arr) if (ln > max) max = ln;
  const m = new Uint8Array(max + 1);
  for (const ln of arr) if (ln >= 0) m[ln] = 1;
  return m;
}

export function lineMaskHas(mask: Uint8Array | null | undefined, line: number): boolean {
  return !!mask && line >= 0 && line < mask.length && mask[line] === 1;
}

export function lineMaskLines(mask: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out.push(i);
  return out;
}

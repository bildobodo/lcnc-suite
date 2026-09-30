// The ONE count of the typed arrays a path build allocates (Codex R48
// VP-I17). The toolpath ledger's peak bound is "held when a build began +
// what the build allocated", and an allocation must be seen where it
// HAPPENS — scratch that is created, used and dropped included — never read
// off the build's results (a shrunk copy hid its full-size original, and a
// helper's working arrays never reached the ledger at all). Every
// allocation on the build path (lineChunks, fatPaths, boxLines, the
// toolpath controller) goes through here; arrays three creates inside its
// own constructors are counted right after creation (`countedGeometry`).
// fatPaths.test.ts spies the typed-array constructors during a build and
// requires the ledger to cover exactly what they saw.
//
// A plain running total: a build reads the difference across its own
// synchronous run. The workers share the pure helpers and never read it.
import type * as THREE from "three";

let _total = 0;

/** Count an array created elsewhere (a `.slice()`, a copy, three's own). */
export function counted<T extends ArrayBufferView | null | undefined>(a: T): T {
  if (a) _total += a.buffer.byteLength;
  return a;
}

export const f32 = (n: number): Float32Array => counted(new Float32Array(n));
export const u32 = (n: number): Uint32Array => counted(new Uint32Array(n));
export const u8 = (n: number): Uint8Array => counted(new Uint8Array(n));
/** A copy of numbers (a literal, a JS array) as a Float32Array. */
export const f32Of = (v: ArrayLike<number>): Float32Array => counted(new Float32Array(v));

/** Every array a geometry holds that three created — its attributes, its
 *  index, the interleaved buffers behind instanced attributes — counted
 *  once each by buffer. Call right after three built them. */
export function countedGeometry(g: THREE.BufferGeometry): void {
  const seen = new Set<ArrayBufferLike>();
  const add = (a: ArrayBufferView | null | undefined) => {
    if (!a || seen.has(a.buffer)) return;
    seen.add(a.buffer);
    counted(a);
  };
  for (const attr of Object.values(g.attributes)) {
    const inter = (attr as THREE.InterleavedBufferAttribute).data;
    add((inter ? inter.array : (attr as THREE.BufferAttribute).array) as ArrayBufferView);
  }
  add(g.index?.array as ArrayBufferView | undefined);
}

/** Bytes allocated through the meter since the page loaded. */
export function allocatedBytes(): number {
  return _total;
}

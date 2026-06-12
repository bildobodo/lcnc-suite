// HALshow live state (frontend split, A1.1 — extracted from lcncWs.ts).
//
// Leaf module: imports Vue only; never imports lcncWs or its peers. lcncWs
// orchestrates — it dispatches halshow_snapshot / halshow_update frames here
// and resets on WS close — and barrel re-exports the refs/types so consumers
// keep importing from "./lcncWs".
//
// The gateway pushes a full snapshot on subscribe ({cmd:"halshow_live"}) and
// 5 Hz value deltas while the Settings → Halshow tab is visible.
import { ref } from "vue";

export interface HalPin {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
  signal?: string;
  arrow?: string;
}

export interface HalSignalPin {
  arrow: string;
  pin: string;
}

export interface HalSignal {
  type: string;
  value: string;
  name: string;
  pins: HalSignalPin[];
}

export interface HalParam {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
}

export const halPins = ref<HalPin[]>([]);
export const halSignals = ref<HalSignal[]>([]);
export const halParams = ref<HalParam[]>([]);
export const halInitialized = ref(false);

// Persistent name→index maps, rebuilt only when a snapshot arrives (review #7).
// Avoids allocating three Sets + scanning every pin/signal/param on every 5 Hz
// value update — each update then applies only its (few) delta keys via O(1)
// lookups. Reassigned scalars: private to this module by design (A1 rule).
let _halPinIdx = new Map<string, number>();
let _halSigIdx = new Map<string, number>();
let _halParamIdx = new Map<string, number>();

function _buildHalIndex(arr: Array<{ name: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < arr.length; i++) m.set(arr[i]!.name, i);
  return m;
}

function _applyHalDelta(
  delta: Record<string, string>,
  arr: Array<{ value: string }>,
  idx: Map<string, number>,
): number {
  let unknown = 0;
  for (const k in delta) {
    const i = idx.get(k);
    if (i === undefined) { unknown++; continue; }  // key not in the snapshot → stale
    arr[i]!.value = delta[k]!;
  }
  return unknown;
}

/** halshow_snapshot frame: replace all state and rebuild the index maps. */
export function applyHalshowSnapshot(msg: { pins?: HalPin[]; signals?: HalSignal[]; params?: HalParam[] }): void {
  halPins.value = msg.pins ?? [];
  halSignals.value = msg.signals ?? [];
  halParams.value = msg.params ?? [];
  _halPinIdx = _buildHalIndex(halPins.value);
  _halSigIdx = _buildHalIndex(halSignals.value);
  _halParamIdx = _buildHalIndex(halParams.value);
  halInitialized.value = true;
}

/** halshow_update frame: apply only the delta keys via the persistent maps. */
export function applyHalshowUpdate(msg: {
  pins?: Record<string, string>;
  signals?: Record<string, string>;
  params?: Record<string, string>;
}): void {
  const unknownCount =
    _applyHalDelta(msg.pins ?? {}, halPins.value, _halPinIdx)
    + _applyHalDelta(msg.signals ?? {}, halSignals.value, _halSigIdx)
    + _applyHalDelta(msg.params ?? {}, halParams.value, _halParamIdx);
  // Unknown keys mean the local snapshot is out of sync with the server
  // (HAL graph rebuilt, or we missed a snapshot). Mark uninitialised so
  // the panel can ask the user to reload — silent shadowing would let the
  // user act on values that no longer match reality.
  if (unknownCount > 0 && halInitialized.value) {
    console.warn(`halshow_update: ${unknownCount} unknown key(s); snapshot is stale`);
    halInitialized.value = false;
  }
}

/**
 * WS close: the server forgets per-client halshow subscription on disconnect,
 * so cached pin/signal/param values are stale snapshots that could shadow
 * real values. Clear them so the panel honestly shows "no data".
 */
export function resetHalshow(): void {
  halPins.value = [];
  halSignals.value = [];
  halParams.value = [];
  halInitialized.value = false;
}

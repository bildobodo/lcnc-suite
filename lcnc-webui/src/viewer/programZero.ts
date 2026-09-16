// Program-zero markers for the 3D viewer: where is the active fixture's zero
// on the PART, and — under identity kinematics — where will the control
// actually put program zero right now?
//
// INVARIANT (one definition for every marker): program zero is where the
// tool TIP lands when the control is commanded to program (0, 0, 0),
// evaluated through the machine.json chain (work AND tool chains) at the
// joint set the mode implies, expressed in the work group's LOCAL frame.
// That is exactly transformToPartFrame's per-vertex rule, so the markers and
// the "path on part" preview agree by construction: one chain (buildChain),
// one lift (liftToJoints), one TLO convention (peeled in the tool node's
// rotation — tipInWorkFrame). Machine-agnostic by the same token: a linear
// table DOF is table-attached and a rotary DOF is room-fixed without any
// per-machine reasoning. The previous counter-transform W(live)⁻¹·W0·P
// assumed the work group carried no LINEAR DOFs; on a moving-table chain it
// drifted by the slide travel (the xyzac example) — pinned in the tests.
//
// Survey (docs/decisions.md 2026-09-02): every UI draws ONE work-system
// marker, the active fixture, on the workpiece; commercial controls store
// the datum once at the end of the kinematic chain so it rides the table in
// every mode. LinuxCNC switchkins re-interprets the SAME fixture numbers as
// joint-space (identity) or table-frame (TCP) — the mode-switch "jump" the
// operator saw. Rules:
//   * The fixture triad is program zero ON THE PART in every mode: identity
//     → the chain at the fixture's TOUCH-OFF table pose (the W1 stamp A;
//     absent = A 0, the documented rule), drawn under the work group so it
//     rides A; TCP → the numbers (table frame); TOOL/plane with a reserved
//     fixture → the plane compose (activeFixturePose).
//   * The muted "program zero (machine)" ghost: identity kins only, while
//     live A ≠ stamp A — the room-fixed spot identity kins will send the tool
//     to. It coincides with the triad exactly iff live A = stamp A.
//   * Bound: the stamp records A only, so the part-riding placement is honest
//     only when every rotary DOF of the work chain is A. Otherwise (xyzac:
//     A + C) the triad is the machine placement at the LIVE pose, labelled
//     "· machine", no ghost — said once on the console, never silently.
//   * Identity evaluations hold tool-chain rotaries at 0: identity kins
//     compensates no head rotary, so program zero is the control point's zero
//     (what the DRO reads) — the same B/C-blind reading the fixture numbers
//     have always had.

import * as THREE from "three";
import {
  buildChain, liftToJoints, tipInWorkFrame, tipWcs, wcsTerms,
  type Chain, type PartFrameMachine, type PartFrameWcs,
} from "./partFrame";
import { kinsForSegment } from "./kins";
import { normalizeKinematics } from "./kinematics";
import { activeFixturePose, RESERVED_FIXTURES } from "./activeFixtureFrame";
import { fixtureOffDatum, stampAForFixture } from "../twpPose";

/** g5x index (1..9) → fixture name; matches the gateway's _G5X_MAP. */
export const G5X_NAMES = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"] as const;
export function g5xName(idx: number): string {
  return G5X_NAMES[idx - 1] ?? `G5x#${idx}`;
}

const DEFAULT_AXES = ["X", "Y", "Z", "A", "B", "C"];

/** Origin + orthonormal right-handed basis, in the work group's LOCAL frame. */
export interface ProgramZeroPose {
  pos: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
  z: [number, number, number];
}

export interface ProgramZeroInputs {
  /** The SAME shape the part-frame worker gets (ThreeViewer._pfMachine). Memoized by identity. */
  machine: PartFrameMachine;
  /** Live g5x/g92/rotation; `tool` = the live TLO (stat.tool_offset). */
  wcs: PartFrameWcs;
  /** RAW switchkins type; null/undefined = identity. */
  kinsType: number | null | undefined;
  /** TWP frame trio [preRot rad, primary deg, secondary deg] — kins 2 only. */
  frame?: readonly number[] | null;
  /** Canonical [a, b, c], MACHINE-frame degrees, the chain is evaluated at. */
  rotary: readonly number[];
}

const _chains = new WeakMap<PartFrameMachine, Chain>();
function chainFor(m: PartFrameMachine): Chain {
  let c = _chains.get(m);
  if (!c) { c = buildChain(m); _chains.set(m, c); }
  return c;
}

// Scratch (single JS context; never returned).
const _mv: number[] = [0, 0, 0, 0, 0, 0];
const _jv: (number | null)[] = [];
const _o = new THREE.Vector3(), _px = new THREE.Vector3(), _pz = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

/**
 * One point + basis: program (0,0,0) and the program +X / +Z directions,
 * each lifted to joints under the live WCS + TLO and sent through the chain
 * (the twpPlaneForSample probe pattern). null = the chain cannot be
 * resolved (broken machine.json) or the result is not finite — hide, never
 * guess. Writes into `out` when given (no allocation on the jog path).
 */
export function programZeroPose(i: ProgramZeroInputs, out?: ProgramZeroPose): ProgramZeroPose | null {
  const chain = chainFor(i.machine);
  if (chain.workIdx < 0 || chain.toolIdx < 0) return null;
  const o = wcsTerms(tipWcs(i.wcs));
  const tlo = i.wcs.tool ?? [];
  const axes = i.machine.axes.length ? i.machine.axes : DEFAULT_AXES;
  // Identical routing + TLO-Z injection to transformToPartFrame's per-vertex
  // model (kinsForSegment: family-aware, loud when a frame/spec is missing).
  const model = kinsForSegment(axes, i.machine.kins, i.kinsType ?? 0, i.frame ?? null,
                               tlo[2] || undefined, "program zero marker");
  const ra = i.rotary[0] ?? 0, rb = i.rotary[1] ?? 0, rc = i.rotary[2] ?? 0;
  const probe = (px: number, py: number, pz: number, v: THREE.Vector3): boolean => {
    liftToJoints(px, py, pz, 0, 0, 0, o, tlo, _mv);
    // The caller says where the table/head IS (machine-frame rotaries); the
    // program-space rotary offsets liftToJoints adds do not apply to a POSE.
    _mv[3] = ra; _mv[4] = rb; _mv[5] = rc;
    model.inverse(_mv, _jv);
    tipInWorkFrame(chain, _jv, tlo, v);
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  };
  if (!probe(0, 0, 0, _o) || !probe(1, 0, 0, _px) || !probe(0, 0, 1, _pz)) return null;
  _x.subVectors(_px, _o);
  _z.subVectors(_pz, _o);
  if (_x.lengthSq() < 1e-18 || _z.lengthSq() < 1e-18) return null;
  _z.normalize();
  _x.addScaledVector(_z, -_x.dot(_z));   // Gram-Schmidt: x ⊥ z
  if (_x.lengthSq() < 1e-18) return null;
  _x.normalize();
  _y.crossVectors(_z, _x);
  const r = out ?? { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] };
  r.pos[0] = _o.x; r.pos[1] = _o.y; r.pos[2] = _o.z;
  r.x[0] = _x.x; r.x[1] = _x.y; r.x[2] = _x.z;
  r.y[0] = _y.x; r.y[1] = _y.y; r.y[2] = _y.z;
  r.z[0] = _z.x; r.z[1] = _z.y; r.z[2] = _z.z;
  return r;
}

/** Canonical rotary letters driving the root→work and root→tool chains,
 *  root-first (machine.json kinematics, joint → letter via the joint-ordered
 *  `axes`). */
export interface ChainRotaries { work: string[]; tool: string[] }
export function chainRotaryLetters(machine: PartFrameMachine): ChainRotaries {
  const defs = new Map(machine.groups.map(g => [g.id, g]));
  const kin = normalizeKinematics(machine.kinematics);
  const axes = machine.axes.length ? machine.axes : DEFAULT_AXES;
  const walk = (tip: string): string[] => {
    const ids: string[] = [];
    let cur: string | undefined = tip;
    let hops = 0;
    while (cur && cur !== "root" && hops++ < 64) { ids.push(cur); cur = defs.get(cur)?.parent; }
    ids.reverse();
    const out: string[] = [];
    for (const id of ids) {
      for (const k of kin) {
        if (k.group !== id || !k.rotate) continue;
        const l = axes[k.joint];
        if (l) out.push(l.toUpperCase());
      }
    }
    return out;
  };
  return { work: walk(machine.workGroup), tool: walk(machine.toolGroup) };
}
const _letters = new WeakMap<PartFrameMachine, ChainRotaries>();
function lettersFor(m: PartFrameMachine): ChainRotaries {
  let l = _letters.get(m);
  if (!l) { l = chainRotaryLetters(m); _letters.set(m, l); }
  return l;
}

/** The W1 stamp records A only: a part-riding identity placement is honest
 *  iff every rotary DOF of the work chain is A (true for rotary-free chains). */
export function fixtureRidesOnA(machine: PartFrameMachine): boolean {
  return lettersFor(machine).work.every(l => l === "A");
}

const ROT_SLOT: Record<string, number> = { A: 0, B: 1, C: 2 };

/** [a, b, c] for an IDENTITY evaluation: work-chain rotaries at their live
 *  value (A replaced by `aOverride` when given — the stamp), tool-chain
 *  rotaries at 0 (identity kins compensates no head rotary: program zero is
 *  the control point's zero, what the DRO reads). */
export function identityRotaries(
  letters: ChainRotaries, liveAbc: readonly number[] | null | undefined,
  aOverride: number | null, out: number[],
): number[] {
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (const l of letters.work) {
    const s = ROT_SLOT[l];
    if (s != null) out[s] = liveAbc?.[s] ?? 0;
  }
  if (aOverride != null && letters.work.includes("A")) out[0] = aOverride;
  return out;
}

export interface WorkMarkerInputs {
  machine: PartFrameMachine;
  wcs: PartFrameWcs;
  kinsType: number | null | undefined;
  g5xIndex: number | null | undefined;
  /** Live plane frame trio, or null. */
  frame: readonly number[] | null;
  /** Live canonical [a, b, c] (status rotary_abc). */
  rotaryAbc: readonly number[] | null | undefined;
  /** Raw W1 stamp A per fixture (status wcs_prov_a, 9-list). */
  provA: readonly (number | null | undefined)[] | null | undefined;
  /** A scrub/sim pose is displayed — the ghost is a claim about the LIVE machine. */
  scrub: boolean;
}
export interface WorkMarkers {
  /** The active-fixture triad, work-group local; null = hidden. */
  primary: { pose: ProgramZeroPose; label: string } | null;
  /** The muted "program zero (machine)" marker; null = hidden. */
  ghost: ProgramZeroPose | null;
}

let _boundWarned = false;
/** Test hook: the bound warning fires once per JS context. */
export function resetProgramZeroWarningsForTests(): void { _boundWarned = false; }

const _rotA: number[] = [0, 0, 0], _rotB: number[] = [0, 0, 0];

/** The marker rule table (see the header). Pure: the adversarial cases are
 *  unit tests, not browser checks. Poses land in `scratch` when given. */
export function workMarkers(
  i: WorkMarkerInputs,
  scratch?: { primary: ProgramZeroPose; ghost: ProgramZeroPose },
): WorkMarkers {
  const g5x = i.wcs.g5x;
  if (!g5x || !g5x.length) return { primary: null, ghost: null };
  const k = i.kinsType == null ? 0 : Math.round(i.kinsType);
  const idx = i.g5xIndex == null ? 1 : Math.round(i.g5xIndex);
  const name = g5xName(idx);
  const liveA = i.rotaryAbc?.[0];
  const base = { machine: i.machine, wcs: i.wcs };

  if (k === 1 || (k === 2 && RESERVED_FIXTURES.has(idx))) {
    // TCP: the numbers ARE table-frame. TOOL kins + reserved fixture: the
    // plane compose (null → hidden, never guessed).
    const p = activeFixturePose({
      g5x, g92: i.wcs.g92, rotationDeg: i.wcs.rotationDeg, kinsType: k, g5xIndex: idx,
      frame: i.frame, a: liveA ?? 0, spec: i.machine.kins ?? null,
    });
    if (!p) return { primary: null, ghost: null };
    const pose = scratch?.primary ?? { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] };
    for (let n = 0; n < 3; n++) { pose.pos[n] = p.pos[n]!; pose.x[n] = p.x[n]!; pose.y[n] = p.y[n]!; pose.z[n] = p.z[n]!; }
    return { primary: { pose, label: name }, ghost: null };
  }
  if (k === 2) {
    // An operator fixture under TOOL kins — the policy never routes a
    // touch-off here; the chain at the live head, not a guess.
    const p = programZeroPose({ ...base, kinsType: 2, frame: i.frame, rotary: i.rotaryAbc ?? [0, 0, 0] }, scratch?.primary);
    return { primary: p ? { pose: p, label: name } : null, ghost: null };
  }

  // Identity (or no switchable kins: the gateway stamps kins 0 there too).
  const letters = lettersFor(i.machine);
  if (!fixtureRidesOnA(i.machine)) {
    if (!_boundWarned) {
      _boundWarned = true;
      console.warn(`[programZero] work chain carries rotaries ${letters.work.join(",")} but the touch-off stamp records A only — ${name} drawn as a machine-frame point at the live pose`);
    }
    const p = programZeroPose({ ...base, kinsType: 0, rotary: identityRotaries(letters, i.rotaryAbc, null, _rotA) }, scratch?.primary);
    return { primary: p ? { pose: p, label: `${name} · machine` } : null, ghost: null };
  }
  const stampA = stampAForFixture(i.provA, idx);
  const p = programZeroPose({ ...base, kinsType: 0, rotary: identityRotaries(letters, i.rotaryAbc, stampA ?? 0, _rotA) }, scratch?.primary);
  if (!p) return { primary: null, ghost: null };
  const off = fixtureOffDatum(0, stampA, liveA);
  const ghost = (off && !i.scrub)
    ? programZeroPose({ ...base, kinsType: 0, rotary: identityRotaries(letters, i.rotaryAbc, null, _rotB) }, scratch?.ghost)
    : null;
  return { primary: { pose: p, label: name }, ghost };
}

// ---- Repaint diff for the marker inputs ----
// ThreeViewer renders on demand: applyState re-poses the scene every status
// tick but paints only when a tracked field changed. The marker inputs were
// never tracked, so M428 (TCP → identity, same fixture numbers, no motion)
// recomputed the triad and never painted it until the next jog
// (operator-caught: "stays at the moved position until I jog any axis").

export interface MarkerInputsPrev {
  kinsType: number | null; g5xIndex: number | null;
  preRot: number | null; primary: number | null; secondary: number | null;
  rotaryAbc: number[] | null; provA: (number | null)[] | null; scrub: boolean;
}
export function newMarkerInputsPrev(): MarkerInputsPrev {
  return { kinsType: null, g5xIndex: null, preRot: null, primary: null, secondary: null,
           rotaryAbc: null, provA: null, scrub: false };
}
export interface MarkerInputsStatus {
  kins_type?: number | null; g5x_index?: number | null;
  kins_pre_rot?: number | null; kins_primary_angle?: number | null; kins_secondary_angle?: number | null;
  rotary_abc?: number[] | null; wcs_prov_a?: (number | null)[] | null;
}
function _listChanged(prev: (number | null)[] | null, next: (number | null)[] | null | undefined): boolean {
  if (!next) return prev !== null;
  if (!prev || prev.length !== next.length) return true;
  for (let n = 0; n < next.length; n++) if (prev[n] !== next[n]) return true;
  return false;
}
/** Field-wise compare of the marker-only inputs; on change copies into
 *  `prev` and returns true. Allocation-free on the no-change path. */
export function markerInputsChanged(prev: MarkerInputsPrev, st: MarkerInputsStatus, scrub: boolean): boolean {
  let changed = false;
  const k = st.kins_type ?? null, g = st.g5x_index ?? null;
  const pr = st.kins_pre_rot ?? null, pa = st.kins_primary_angle ?? null, sa = st.kins_secondary_angle ?? null;
  if (k !== prev.kinsType) { prev.kinsType = k; changed = true; }
  if (g !== prev.g5xIndex) { prev.g5xIndex = g; changed = true; }
  if (pr !== prev.preRot) { prev.preRot = pr; changed = true; }
  if (pa !== prev.primary) { prev.primary = pa; changed = true; }
  if (sa !== prev.secondary) { prev.secondary = sa; changed = true; }
  if (_listChanged(prev.rotaryAbc, st.rotary_abc)) { prev.rotaryAbc = st.rotary_abc ? [...st.rotary_abc] : null; changed = true; }
  if (_listChanged(prev.provA, st.wcs_prov_a)) { prev.provA = st.wcs_prov_a ? [...st.wcs_prov_a] : null; changed = true; }
  if (scrub !== prev.scrub) { prev.scrub = scrub; changed = true; }
  return changed;
}

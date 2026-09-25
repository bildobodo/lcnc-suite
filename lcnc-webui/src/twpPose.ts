// TWP tool-orientation staleness.
//
// The plane is stored TABLE-relative, so it rides the workpiece and cannot
// go stale. The HEAD SOLVE can: G53.x computes the spindle angles once, for
// the table pose in force at that moment, and no coordinate relabelling can
// swing the head afterwards. So when the A table moves after an orient, the
// tool stops being normal to the plane. The remap publishes the machine-frame
// A the head was last oriented at (`twp_pose_a`); comparing it against the
// live A is what tells the operator the tool is off-normal.
//
// One predicate, two consumers (the kins chip in SetupStrip and the plane
// overlay tint in ThreeViewer) so the epsilon lives in exactly one place.

/** Display threshold — below this the operator cannot act on the difference. */
export const TWP_POSE_EPS_DEG = 0.05;

/**
 * "No orient yet" sentinel written by the remap until G53.x has solved the
 * head (and again whenever the plane changes under it). The pin always
 * exists once the helper comp is loaded, so absence is expressed in the
 * value, not by a missing field — anything at or below this is "none".
 */
export const TWP_POSE_NONE_BELOW = -1e8;

/** A/B/C in degrees — the orient stamp (`twp_pose_a/b/c`) or the live
 *  `rotary_abc`. Any entry may be missing. */
export type PoseAbc = readonly (number | null | undefined)[] | null | undefined;

/** The stamp triple from a status snapshot (TWP-04: the head solve is a
 *  function of ALL three rotaries, so B and C are stamped alongside A). */
export function poseAbcOf(
  d: { twp_pose_a?: number | null; twp_pose_b?: number | null; twp_pose_c?: number | null } | null | undefined,
): PoseAbc {
  if (!d) return null;
  return [d.twp_pose_a, d.twp_pose_b, d.twp_pose_c];
}

/** Signed shortest angular difference a − b, degrees, in [-180, 180). */
export function rotaryDeltaDeg(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

/** The three stamped angles as numbers, or null when ANY is missing,
 *  non-finite or the sentinel — unknown is not a pose. */
function stampedPose(pose: PoseAbc): [number, number, number] | null {
  if (!pose || pose.length < 3) return null;
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const v = pose[i];
    if (v == null || !Number.isFinite(v) || v <= TWP_POSE_NONE_BELOW) return null;
    out.push(v);
  }
  return out as [number, number, number];
}

/**
 * True when a rotary has moved since the head was oriented — i.e. the tool
 * is no longer normal to the plane. Compares the FULL A/B/C stamp against
 * the live rotaries, wrap-aware (359.99 vs −0.01 is not a move). Makes no
 * claim without data: no plane, no orient yet (sentinel), or a missing
 * reading all return false — unknown is not stale. Twin of
 * gateway_util.twp_head_aligned (the backend admission rule).
 */
export function twpPoseStale(
  pose: PoseAbc,
  live: PoseAbc,
  defined: boolean | null | undefined,
): boolean {
  if (!defined) return false;
  const p = stampedPose(pose);
  if (!p || !live || live.length < 3) return false;
  for (let i = 0; i < 3; i++) {
    const l = live[i];
    if (l == null || !Number.isFinite(l)) return false;
  }
  return p.some((pv, i) => Math.abs(rotaryDeltaDeg(live[i] as number, pv)) > TWP_POSE_EPS_DEG);
}

/**
 * True once the remap has published a real head-solve pose (G53.x / Orient
 * completed and stamped all of `twp_pose_a/b/c`) for a DEFINED plane.
 * Unknown (no plane, no data, any sentinel) is false. The Plane jog frame's
 * gate is the backend's (`planeFrame`, which also requires alignment); this
 * is the display's "a solve exists" word.
 */
export function twpPoseOriented(
  pose: PoseAbc,
  defined: boolean | null | undefined,
): boolean {
  if (!defined) return false;
  return stampedPose(pose) !== null;
}

/** Display threshold for a moved datum — 1 µm-class noise must not warn. */
export const TWP_DATUM_EPS = 1e-3;

/**
 * True when the LIVE G54 row has left the datum snapshot the plane was
 * defined against. The remap freezes `saved_work_offset` at G68.2/G68.3
 * (and moves it only through the Plane touch-off, M535) — a plain identity
 * touch-off of G54 afterwards is silently ignored by the plane: the overlay
 * and the NEXT ORIENT keep using the old datum. That is deliberate upstream
 * semantics (not changed here) — this predicate is the honest surface.
 * Unknown is not stale: no plane, no datum echo, or an unreadable row all
 * return false, same rule as twpPoseStale above.
 */
/** Twin of gateway_util.PROV_A_EPS (degrees): a G54 stamped further from
 *  A=0 than this was touched off on a tilted table and is stored as a
 *  TABLE-frame point — not comparable to the machine-frame row. */
export const TWP_PROV_A_EPS = 0.01;

export function twpDatumStale(
  g54row: { x?: number | null; y?: number | null; z?: number | null } | null | undefined,
  datum: readonly number[] | null | undefined,
  defined: boolean | null | undefined,
  stampA?: number | null,
): boolean {
  if (!defined) return false;
  if (!g54row || !datum || datum.length < 3) return false;
  // A tilted W1 stamp: the row is not table-frame, so the comparison would
  // report a frame difference as a datum move — no claim. No stamp (pre-W1
  // touch-off) = touched off at A0 = compare.
  if (stampA != null && Number.isFinite(stampA) && Math.abs(stampA) > TWP_PROV_A_EPS) return false;
  const live = [g54row.x, g54row.y, g54row.z];
  for (let i = 0; i < 3; i++) {
    const l = live[i], d = datum[i];
    if (l == null || d == null || !Number.isFinite(l) || !Number.isFinite(d)) return false;
    if (Math.abs(l - d) > TWP_DATUM_EPS) return true;
  }
  return false;
}

/**
 * The kins-mode chip: ONE derivation for SetupStrip's chip and the viewer
 * HUD (the silent-mode-traversal trap — the TWP demo parks the machine in
 * TOOL kins with zero indication anywhere). Colour priority: head-stale
 * (bad) > datum-moved (warn) > mode tint; the TEXT lists both flags when
 * both hold, so nothing is hidden by the colour choice.
 */
export type ChipCls = "ok" | "warn" | "bad" | "muted";
/** `title` is a short hover NAME; `help` — present on the warn/bad states
 *  only — is the short why + what to do, shown as a "?" beside the chip (a
 *  title never shows on a touchscreen; design wave D1 live look). */
export interface KinsModeChip { text: string; cls: ChipCls; title: string; help?: string }

/** The W1 stamp A of the ACTIVE fixture (1-based g5x index into the 9-list
 *  the payload carries as `wcs_prov_a`); null = no stamp / no data. */
export function stampAForFixture(
  provA: readonly (number | null | undefined)[] | null | undefined,
  g5xIndex: number | null | undefined,
): number | null {
  if (!provA) return null;
  const idx = g5xIndex == null ? 1 : Math.round(g5xIndex);
  const v = provA[idx - 1];
  return v == null ? null : v;
}

export interface OffDatum { stampA: number; liveA: number; stamped: boolean }

/**
 * Identity-kins fixture off the part. Under machine kinematics a fixture is
 * a FIXED POINT IN THE ROOM, valid as the part's datum only at the table
 * pose it was established at — the pose its W1 stamp records (no stamp =
 * the documented A=0 rule, the same reading twpDatumStale takes). Rotate
 * the table away from it and the part leaves the fixture: program zero is
 * still where the triad says, just no longer on the part. Mirror of
 * twpPoseStale (table moved under an ORIENTED HEAD, Plane mode): here the
 * table moved under a MACHINE-FRAME FIXTURE. Not a claim under TCP (the
 * fixture rides the table) or TOOL kins (the plane surfaces cover it), nor
 * without a live reading. Returns the two angles for the chip title.
 */
export function fixtureOffDatum(
  kinsType: number | null | undefined,
  stampA: number | null | undefined,
  liveA: number | null | undefined,
): OffDatum | null {
  if (kinsType == null || Math.round(kinsType) !== 0) return null;
  if (liveA == null || !Number.isFinite(liveA)) return null;
  const stamped = stampA != null && Number.isFinite(stampA);
  const s = stamped ? stampA : 0;
  return Math.abs(liveA - s) > TWP_PROV_A_EPS ? { stampA: s, liveA, stamped } : null;
}

import { g5xName } from "./viewer/programZero";

const DATUM_MOVED_HELP = "G54 was touched off after the plane was defined — Clear plane and Capture again, or re-run G68.2.";

export function kinsModeChip(i: {
  kinsType: number | null | undefined;
  twpActive?: boolean | null;
  twpStale?: boolean | null;
  twpDatumMoved?: boolean | null;
  /** fixtureOffDatum() — identity kins only; ignored on other modes. */
  offDatum?: OffDatum | null;
  /** Active fixture 1..9 (G54 … G59.3). Under Plane kinematics anything but
   *  G59 (6) is the stranded state a program's M2 leaves behind. */
  g5xIndex?: number | null;
}): KinsModeChip | null {
  const k = i.kinsType == null ? null : Math.round(i.kinsType);
  if (k == null) return null;
  let chip: KinsModeChip;
  if (k === 1) {
    chip = { text: "TCP", cls: "ok", title: "TCP kinematics — programmed XYZ is the tool tip" };
  } else if (k === 2) {
    // What is stale is the ORIENT, not the plane: relabelling coordinates
    // cannot swing the head, so a table move leaves the tool off-normal even
    // though the plane still rides the workpiece. Re-orient is the recovery.
    // Wrong fixture: Plane kinematics expresses positions against G59 (the
    // row every orient rewrites); an operator fixture selected under it is
    // the state M2 leaves behind (G54 restored, kins type NOT reset — the
    // trap the TWP demo walks into) and it had no indicator at all
    // (2026-09-03, operator standing in it). Both claims can hold at once;
    // the colour is bad either way and the text lists both.
    const fx = i.g5xIndex == null || !Number.isFinite(i.g5xIndex) ? null : Math.round(i.g5xIndex);
    const wrongFixture = !!i.twpActive && fx != null && fx !== 6;
    const wrongFixtureHelp = fx == null ? "" :
      `Plane kinematics with ${g5xName(fx)} selected, not G59 — select Plane again (M430) or the Machine frame.`;
    if (i.twpStale) {
      chip = { text: i.twpActive ? "TWP" : "TOOL", cls: "bad", title: "Tool orientation stale",
        help: "The table moved since the last orient — the tool is off the plane normal. Press Orient." };
      if (wrongFixture) {
        chip = { text: `${chip.text} · ${g5xName(fx!)}`, cls: "bad", title: "Tool orientation stale, wrong work offset",
                 help: `${chip.help} Also: ${g5xName(fx!)} is selected, not G59.` };
      }
    } else if (wrongFixture) {
      chip = { text: `TWP · ${g5xName(fx!)}`, cls: "bad", title: "Plane kinematics on the wrong work offset", help: wrongFixtureHelp };
    } else if (i.twpActive) {
      chip = { text: "TWP", cls: "warn", title: "Tilted work plane active",
        help: "X/Y/Z jog in the tilted plane; a touch-off sets G54 through it. G69 cancels." };
    } else {
      // No plane under TOOL kins: jogs follow whatever frame the kins pins
      // last held — a trap, not a caution.
      chip = { text: "TOOL", cls: "bad", title: "Tool kinematics without a plane",
        help: "Jogs follow the last plane frame, not the machine axes. G69 restores the Machine frame." };
    }
  } else {
    chip = { text: "MACHINE", cls: "muted", title: "Machine kinematics — jogs move the machine axes" };
    if (i.offDatum) {
      const o = i.offDatum;
      const fx = i.g5xIndex == null || !Number.isFinite(i.g5xIndex) ? null : Math.round(i.g5xIndex);
      const name = fx == null ? "The work offset" : g5xName(fx);
      chip = {
        text: "MACHINE · off datum",
        cls: "warn",
        title: "Off datum — A is not at the touch-off angle",
        help: `${name} ${o.stamped ? `set at A ${o.stampA.toFixed(2)}°` : "has no A stamp (A 0° assumed)"}, A now ${o.liveA.toFixed(2)}° — `
          + "runs at 'program zero (machine)'. Return A, use TCP or touch off.",
      };
    }
  }
  if (i.twpDatumMoved) {
    chip = {
      text: `${chip.text} · datum moved`,
      cls: chip.cls === "bad" ? "bad" : "warn",
      title: "Datum moved since the plane was defined",
      help: `${DATUM_MOVED_HELP}${chip.help ? " Also: " + chip.help : ""}`,
    };
  }
  return chip;
}

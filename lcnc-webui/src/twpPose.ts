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

/**
 * True when the table has moved since the head was oriented — i.e. the tool
 * is no longer normal to the plane. Makes no claim without data: no plane,
 * no orient yet (sentinel), or a missing live reading all return false —
 * unknown is not stale.
 */
export function twpPoseStale(
  poseA: number | null | undefined,
  liveA: number | null | undefined,
  defined: boolean | null | undefined,
): boolean {
  if (!defined) return false;
  if (poseA == null || liveA == null) return false;
  if (!Number.isFinite(poseA) || !Number.isFinite(liveA)) return false;
  if (poseA <= TWP_POSE_NONE_BELOW) return false;
  return Math.abs(liveA - poseA) > TWP_POSE_EPS_DEG;
}

/**
 * True once the remap has published a real head-solve pose (G53.x / Orient
 * ran and stamped `twp_pose_a`) for a DEFINED plane. The Plane jog frame is
 * offered only then. Unknown (no plane, no data, sentinel) is false.
 */
export function twpPoseOriented(
  poseA: number | null | undefined,
  defined: boolean | null | undefined,
): boolean {
  if (!defined) return false;
  if (poseA == null || !Number.isFinite(poseA)) return false;
  return poseA > TWP_POSE_NONE_BELOW;
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
export interface KinsModeChip { text: string; cls: ChipCls; title: string }

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

const DATUM_MOVED_TITLE = "The G54 datum was touched off AFTER this plane was defined — the plane and the next Orient still use the old datum. Capture again (after Clear plane) to accept the new datum, or re-run G68.2.";

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
    chip = { text: "TCP", cls: "ok",
      title: "Tool-center-point kinematics active — programmed XYZ is the tool tip" };
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
    const wrongFixtureTitle = fx == null ? "" :
      `Plane kinematics is active but ${g5xName(fx)} is selected, not G59 (the plane fixture): the DRO and jogs are in the tilted frame against the wrong offsets. A program that ended with M2 left TOOL kinematics on. Select the Plane frame again (M430 selects G59), or G69 / the Machine frame.`;
    if (i.twpStale) {
      chip = { text: i.twpActive ? "TWP" : "TOOL", cls: "bad",
        title: "Tool orientation STALE — the A table has moved since G53.x oriented the head, so the tool is no longer normal to the plane. The plane itself still follows the workpiece. Press Orient to re-solve the head at the current table pose." };
      if (wrongFixture) {
        chip = { text: `${chip.text} · ${g5xName(fx!)}`, cls: "bad", title: `${chip.title} (Also: ${wrongFixtureTitle})` };
      }
    } else if (wrongFixture) {
      chip = { text: `TWP · ${g5xName(fx!)}`, cls: "bad", title: wrongFixtureTitle };
    } else if (i.twpActive) {
      chip = { text: "TWP", cls: "warn",
        title: "Tilted work plane ACTIVE — X/Y/Z jogs move in the tilted plane (Z along the tool axis). A touch-off here sets the WORKPIECE datum (G54) through the plane; rotary touch-off needs the Machine frame. G69 cancels." };
    } else {
      // No plane under TOOL kins: jogs follow whatever frame the kins pins
      // last held — a trap, not a caution.
      chip = { text: "TOOL", cls: "bad",
        title: "TOOL kinematics active without an active plane — X/Y/Z jogs move along the last plane frame, not machine axes. G69 restores machine kinematics." };
    }
  } else {
    chip = { text: "MACHINE", cls: "muted",
      title: "Identity kinematics — X/Y/Z jogs move along machine axes" };
    if (i.offDatum) {
      const o = i.offDatum;
      chip = {
        text: "MACHINE · off datum",
        cls: "warn",
        title: `The active fixture was established with the table at A ${o.stampA.toFixed(2)}°`
          + (o.stamped ? "" : " (no provenance stamp — the A=0 rule applies)")
          + ` and A is now ${o.liveA.toFixed(2)}°. Under machine kinematics a fixture is a fixed point in the room, so it is no longer on the part. In the 3D view the fixture triad rides the part; the muted 'program zero (machine)' marker is where program zero is in the room right now. Return A to the touch-off angle, switch to TCP (the fixture rides the table there), or touch off again here.`,
      };
    }
  }
  if (i.twpDatumMoved) {
    chip = {
      text: `${chip.text} · datum moved`,
      cls: chip.cls === "bad" ? "bad" : "warn",
      title: `${DATUM_MOVED_TITLE}${chip.cls === "bad" ? " (Also: " + chip.title + ")" : ""}`,
    };
  }
  return chip;
}

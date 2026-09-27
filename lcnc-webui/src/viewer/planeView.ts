// The tilted work plane as DRAWN (viewer contrast plan, V4 / E12): ONE
// decision for the plane's colour role, the state label on the object, its
// edge pattern and the normal arrow — and the HUD word reads the same result,
// so the object and the HUD never tell two stories.
//
// The state stands AT THE OBJECT: the HUD word is gone with the HUD layer
// off or the warnings card folded, while the plane still shows. Colour alone
// is no cue (amber and red meet under deuteranopia): the label names the
// state and a stale plane's edge is dashed.
//
// The drawn plane is either the LIVE setup's or, while simulating, the
// PROGRAM's (the scrub sample's plane). Staleness is a claim about the live
// setup, so a simulated plane is never stale — it is "simulated". Live, two
// claims can make the plane stale: the head has left the pose the plane was
// defined at ("head moved" — the normal arrow, the tool-normal claim, turns
// with it) and G54 has left the datum it was defined on ("datum moved" — the
// head is fine, so the arrow is not).
export type PlaneRole = "planeActive" | "planeDefined" | "planeStale";

export interface PlaneViewInput {
  /** The drawn plane is the scrub sample's (simulation), not the machine's. */
  simulated: boolean;
  /** Live: the plane is in effect (the TWP helper's is-active AND the plane kinematics). */
  active: boolean;
  /** Live: the head has left the pose the plane was defined at. */
  headMoved: boolean;
  /** Live: G54 has left the datum the plane was defined on. */
  datumMoved: boolean;
}

export interface PlaneView {
  role: PlaneRole;
  /** The label on the object ("Plane · active"). */
  label: string;
  /** The HUD's word for the same state ("plane active"). */
  hudWord: string;
  /** The edge is dashed (a stale plane). */
  dashed: boolean;
  /** The normal arrow carries the stale colour (the head's claim only). */
  arrowStale: boolean;
}

export function planeView(i: PlaneViewInput): PlaneView {
  if (i.simulated) {
    return { role: "planeActive", label: "Plane · simulated", hudWord: "plane simulated", dashed: false, arrowStale: false };
  }
  const reasons = [i.headMoved ? "head moved" : null, i.datumMoved ? "datum moved" : null].filter((r): r is string => r !== null);
  if (reasons.length) {
    return { role: "planeStale", label: `Plane · ${reasons.join(" · ")}`, hudWord: `plane ${reasons.join(", ")}`,
      dashed: true, arrowStale: i.headMoved };
  }
  return i.active
    ? { role: "planeActive", label: "Plane · active", hudWord: "plane active", dashed: false, arrowStale: false }
    : { role: "planeDefined", label: "Plane · defined", hudWord: "plane defined", dashed: false, arrowStale: false };
}

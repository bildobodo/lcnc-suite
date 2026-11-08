// What the simulation SHOWS on this device — the timeline and the Sim tab —
// (settings split package 2): it follows the device's switch only once no
// press it could move is in progress (heldThroughPress, the input session's
// contract: nothing moves under a press — Codex R339 SS-I05). The
// simulation's WORK stops at once: ThreeViewer's collision starts read
// `simulationOn` themselves, and the timeline leaves the simulation mode the
// moment the switch goes off.
import { heldThroughPress } from "./inputSession";
import { simulationOn } from "./defaults";

export const simShown = heldThroughPress(() => simulationOn.value, () => false);

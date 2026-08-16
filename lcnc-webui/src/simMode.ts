import { ref } from "vue";

// Simulation (program-scrub) mode — CLIENT-LOCAL, like `busy`: it describes
// THIS tab's display state (the 3D model posed along the program instead of
// the live machine), so it gates THIS tab's controls. Other clients' displays
// are live and their controls stay unaffected.
//
// Invariants (owned by ScrubBar.vue, gated in permissions.ts):
//  - Enter requires: armed (outer Gate), machine OFF, program loaded, idle.
//  - While active every machine-action gate is closed except `always`
//    (Arm / E-Stop), `armed` (navigation) and `setup` (file browsing) —
//    including `safety`, so Machine On itself needs a purposeful exit first.
//  - Auto-exits: program starts running, program change, machine turned on
//    (another client), or real joint motion (backstop).
export const simMode = ref(false);

// The switchable suite functions in the client (settings split package 3,
// plan R335–R337, operator OP2): a function switched off LEAVES the UI — its
// tab, its buttons, its reading of the gamepad — and the gateway refuses
// its jobs. The switches are a machine section: what acts is what the
// SERVER holds (loadFeaturesDefaults — each function on where it holds
// nothing, so an install without the section works as before; the
// bootstrap fetch has them before the first render).
//
// What the UI SHOWS follows a switch only once no press it could move is
// in progress (heldThroughPress — nothing moves under a press); a tab the
// operator is IN when its function goes off stays until it is left (the
// tab holds — App.vue / ProbePanel.vue), so a draft in it is never lost
// unasked (SS334-02).
import { computed, type ComputedRef, type Ref } from "vue";
import { heldThroughPress } from "./inputSession";
import { FEATURE_NAMES, loadFeaturesDefaults, serverSettingsReady, settingsVersion, type FeatureName, type FeaturesDefaults } from "./defaults";

/** The switches as they act (the server's section). Read again when the
 *  bootstrap's settings arrive (serverSettingsReady — initServerDefaults bumps
 *  no settingsVersion): this module is evaluated at App's import, before
 *  that fetch, and a stale "all on" painted the Probing and Macros tabs for
 *  the first frames of a page whose functions were off (feature-switches.spec). */
export const features: ComputedRef<FeaturesDefaults> = computed(() => {
  void settingsVersion.value;
  void serverSettingsReady.value;
  return loadFeaturesDefaults();
});

/** Each switch as the UI shows it: an OFF lands once no press is under way,
 *  an ON once every press has had its click. */
export const featureShown = Object.fromEntries(FEATURE_NAMES.map(f =>
  [f, heldThroughPress(() => features.value[f], on => !on)])) as Record<FeatureName, Readonly<Ref<boolean>>>;

/** The gateway's refusal, worded the same (features.off_reason). */
export const FEATURE_LABELS: Record<FeatureName, string> = {
  probing: "Probing", toolsetter: "Toolsetter", surfaceMap: "Surface map",
  camera: "Camera", macros: "Macros", gamepad: "Gamepad",
};

export function featureOffReason(f: FeatureName): string {
  const label = FEATURE_LABELS[f];
  return `${label} ${label.endsWith("s") ? "are" : "is"} off — Settings › Features`;
}

/** The note in a tab that stays only until it is left. */
export function featureHeldNote(f: FeatureName): string {
  return `${featureOffReason(f).split(" — ")[0]} — this closes once you leave it`;
}

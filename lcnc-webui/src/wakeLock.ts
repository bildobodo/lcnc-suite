// Two-tier screen wake-lock manager for the WebUI.
//
// Tier 1 — navigator.wakeLock.request('screen'): secure-context only
//   (localhost + HTTPS). Available on Chrome/Edge desktop+mobile and
//   recent Safari.
// Tier 2 — silent looping <video>: works in non-secure contexts
//   (the common LAN-HTTP case for tablets connecting to the gateway
//   over LAN). Mirrors NoSleep.js's approach.
//
// Per the architecture cleanup: every tier-selection and state change
// emits a telemetry event so we can see in the trace bus which clients
// got the API path vs the video fallback vs unavailable. No silent
// fallbacks.

import { emitTelemetry } from "./ws/telemetry";

type Tier = "api" | "video" | "unavailable";

let _tier: Tier = "unavailable";
let _enabled = false;          // user setting from Display sub-tab
let _sentinel: WakeLockSentinel | null = null;
let _video: HTMLVideoElement | null = null;
let _acquireInFlight = false;

function _detectTier(): Tier {
  if (typeof navigator !== "undefined" && "wakeLock" in navigator) return "api";
  // Video tier requires HTMLCanvasElement.captureStream() — supported by
  // every browser we'd reasonably expect to load this UI (Chrome 51+,
  // Firefox 41+, Safari 11+). The tier check is "do we have what we need
  // to fake a playing video"; we attempt the actual acquire later.
  if (typeof document !== "undefined" &&
      typeof HTMLCanvasElement !== "undefined" &&
      typeof (HTMLCanvasElement.prototype as any).captureStream === "function") {
    return "video";
  }
  return "unavailable";
}

async function _acquireApi(): Promise<void> {
  if (_sentinel && !_sentinel.released) return;
  try {
    _sentinel = await (navigator as any).wakeLock.request("screen");
    _sentinel?.addEventListener?.("release", () => {
      emitTelemetry("wakelock.released", { tier: "api", reason: "sentinel-release" });
      _sentinel = null;
    });
    emitTelemetry("wakelock.acquired", { tier: "api" });
  } catch (e) {
    emitTelemetry("wakelock.acquire_failed", {
      tier: "api",
      error: String((e as Error)?.message ?? e),
    });
    _sentinel = null;
  }
}

function _releaseApi(): void {
  if (!_sentinel) return;
  const s = _sentinel;
  _sentinel = null;
  try {
    s.release();
    emitTelemetry("wakelock.released", { tier: "api", reason: "explicit" });
  } catch (e) {
    emitTelemetry("wakelock.release_failed", {
      tier: "api",
      error: String((e as Error)?.message ?? e),
    });
  }
}

function _acquireVideo(): void {
  if (_video) {
    _video.play().catch(() => { /* play() may reject if already playing */ });
    return;
  }
  // Generate a 1 fps black-canvas stream and play it. Avoids shipping a
  // binary asset and works in non-secure HTTP contexts where the Wake Lock
  // API is blocked. The browser sees "media playing" → keeps screen awake.
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 16, 16);
  }
  const stream = (canvas as any).captureStream?.(1) as MediaStream | undefined;
  if (!stream) {
    emitTelemetry("wakelock.acquire_failed", {
      tier: "video",
      error: "canvas.captureStream returned no stream",
    });
    return;
  }
  const v = document.createElement("video");
  v.setAttribute("muted", "");
  v.setAttribute("autoplay", "");
  v.setAttribute("playsinline", "");
  v.muted = true;
  v.playsInline = true;
  v.srcObject = stream;
  // Off-screen but in the DOM — required for the browser to honour playback
  // as the "keep awake" trigger. display:none is observed to NOT keep the
  // screen awake in some browsers; tiny positive-area off-screen does.
  v.style.position = "fixed";
  v.style.width = "1px";
  v.style.height = "1px";
  v.style.left = "-1px";
  v.style.top = "-1px";
  v.style.opacity = "0";
  v.style.pointerEvents = "none";
  document.body.appendChild(v);
  v.play().then(() => {
    emitTelemetry("wakelock.acquired", { tier: "video" });
  }).catch((e) => {
    emitTelemetry("wakelock.acquire_failed", {
      tier: "video",
      error: String(e?.message ?? e),
    });
  });
  _video = v;
}

function _releaseVideo(): void {
  if (!_video) return;
  const v = _video;
  _video = null;
  try {
    v.pause();
    v.src = "";
    v.remove();
    emitTelemetry("wakelock.released", { tier: "video", reason: "explicit" });
  } catch (e) {
    emitTelemetry("wakelock.release_failed", {
      tier: "video",
      error: String((e as Error)?.message ?? e),
    });
  }
}

async function _acquire(): Promise<void> {
  if (_acquireInFlight) return;
  _acquireInFlight = true;
  try {
    if (_tier === "api") {
      await _acquireApi();
    } else if (_tier === "video") {
      _acquireVideo();
    } else {
      emitTelemetry("wakelock.acquire_skipped", { tier: "unavailable" });
    }
  } finally {
    _acquireInFlight = false;
  }
}

function _release(): void {
  if (_tier === "api") _releaseApi();
  else if (_tier === "video") _releaseVideo();
}

/** Initialize tier detection. Safe to call multiple times. */
function _ensureTier(): void {
  if (_tier !== "unavailable") return;
  const detected = _detectTier();
  if (detected !== _tier) {
    _tier = detected;
    emitTelemetry("wakelock.tier_selected", { tier: _tier });
  }
}

/** Enable wake-lock (called when WS opens and the user setting is true).
 *  Acquires immediately. Caller should also wire visibilitychange to
 *  re-acquire when the tab returns visible (the API auto-releases on hide). */
export async function enableWakeLock(): Promise<void> {
  _ensureTier();
  _enabled = true;
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    await _acquire();
  }
}

/** Disable wake-lock and release any active lock. */
export function disableWakeLock(): void {
  _enabled = false;
  _release();
}

/** Re-acquire after tab visibility returns. No-op if disabled or hidden. */
export async function onVisibilityChange(): Promise<void> {
  if (!_enabled) return;
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    // The Screen Wake Lock API auto-releases on hide. The video tier keeps
    // playing but some browsers pause off-screen videos when the tab hides;
    // .play() on visibility return is the symmetric re-arm in both cases.
    await _acquire();
    emitTelemetry("wakelock.reacquired", { tier: _tier });
  }
}

// Browser-wide visibility wiring. lcncWs.ts owns the WS-open/close hooks
// (they live there next to the existing visibility/heartbeat handlers).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    void onVisibilityChange();
  });
}

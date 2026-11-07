// This browser's device token (settings split, operator 2026-11-07, plan
// Codex R335–R337): the secret that names its device profile on the gateway
// — 128 bits from crypto.getRandomValues (randomUUID and subtle are absent
// on LAN HTTP, an insecure context), kept in localStorage (the fourth
// allowed use, CLAUDE.md), per browser profile and origin. The gateway keeps
// only its hash; a separate public id names the profile to others.
//
// Two tabs opened at once for the first time may each make one. They
// CONVERGE (R336/R337): every tab listens for the key's `storage` event
// BEFORE its first read and binds to the value it READ after writing; an
// event is only the occasion to read the stored value again — a tab whose
// stored value is no longer the one it bound to rebinds (a NEW connection,
// see wsTransport.rebindTransport). A late event about an older value
// changes nothing. Only an OBSERVED failure (the storage throws, the value
// cannot be stored) leaves the tab without a token: the gateway shows it
// the template, it saves no device settings, and the page says so.
const KEY = "lcnc-device-token";

export type DeviceStorage = "ok" | "failed";

let _token: string | null = null;
let _storage: DeviceStorage = "ok";
let _listening = false;
let _onRebind: ((token: string) => void) | null = null;

function valid(t: unknown): t is string {
  return typeof t === "string" && /^[0-9a-f]{32}$/.test(t);
}

/** A new token: 16 random bytes as 32 hex digits. */
export function newDeviceToken(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

/** The stored token — made and stored when there is none; null when the
 *  storage fails. The value READ back is the one that counts (another tab
 *  may have stored its own in between). */
function readOrMake(): string | null {
  let t = localStorage.getItem(KEY);
  if (valid(t)) return t;
  localStorage.setItem(KEY, newDeviceToken());
  t = localStorage.getItem(KEY);
  return valid(t) ? t : null;
}

/** Once at start, before the first settings fetch. */
export function initDeviceToken(): void {
  if (!_listening && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);   // BEFORE the first read
    _listening = true;
  }
  try {
    _token = readOrMake();
    _storage = _token === null ? "failed" : "ok";
  } catch {
    _token = null;
    _storage = "failed";
  }
}

/** Read the stored value again (an event, a reconnect): rebind when it is
 *  not the one this tab is bound to. */
export function recheckDeviceToken(): void {
  if (_storage !== "ok") return;
  let now: string | null;
  try {
    now = readOrMake();     // cleared elsewhere: stored again (others converge on it)
  } catch {
    return;                 // unreadable now: the binding this tab has stays
  }
  if (now === null || now === _token) return;
  _token = now;
  _onRebind?.(now);
}

function onStorage(ev: StorageEvent): void {
  if (ev.key !== null && ev.key !== KEY) return;   // null: the storage was cleared
  recheckDeviceToken();
}

export function deviceToken(): string | null {
  return _token;
}

export function deviceStorage(): DeviceStorage {
  return _storage;
}

/** Called with the new token when this tab must bind to another profile. */
export function onDeviceRebind(fn: (token: string) => void): void {
  _onRebind = fn;
}

/** Tests only. */
export function resetDeviceTokenForTests(): void {
  if (_listening && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  _listening = false;
  _token = null;
  _storage = "ok";
  _onRebind = null;
}

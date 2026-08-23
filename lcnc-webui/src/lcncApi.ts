/**
 * REST API helpers for file upload/listing.
 * Complements lcncWs.ts (which handles WebSocket).
 */
import { authHeaders } from "./auth";

function getBaseUrl(): string {
  return location.origin;
}

async function throwHttpError(resp: Response): Promise<never> {
  // A non-JSON error body (proxy 502 HTML page, empty body) would make
  // resp.json() throw a SyntaxError that masks the real HTTP status. Fall
  // back to the status line so the caller sees "HTTP 502", not a parse error.
  let detail: string | undefined;
  try {
    const body = await resp.json();
    detail = body?.detail;
  } catch {
    detail = undefined;
  }
  throw new Error(detail || `HTTP ${resp.status}`);
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  modified?: number;
}

export interface FilesResponse {
  ok: boolean;
  nc_dir: string;
  subdir: string;
  entries: FileEntry[];
}

export interface UploadResponse {
  ok: boolean;
  path: string;
  filename: string;
  size: number;
}

export async function listFiles(subdir: string = ""): Promise<FilesResponse> {
  const url = new URL(`${getBaseUrl()}/files`);
  if (subdir) url.searchParams.set("subdir", subdir);
  const resp = await fetch(url.toString());
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

/** ---------- subroutine source (W5 inline sub view) ---------- */

const _subfileCache = new Map<string, Promise<string | null>>();

/** Source text of a called subroutine (resolved server-side through
 *  SUBROUTINE_PATH, names restricted to bare o-word tokens). Cached per
 *  name; null = not resolvable (the indent view simply doesn't offer
 *  itself — never a guess). */
export function fetchSubfile(name: string): Promise<string | null> {
  let p = _subfileCache.get(name);
  if (!p) {
    p = fetch(`${getBaseUrl()}/subfile?name=${encodeURIComponent(name)}`)
      .then(r => (r.ok ? r.text() : null))          // 404 = definitive, cached
      .catch(() => { _subfileCache.delete(name); return null; });  // transient — retry later
    _subfileCache.set(name, p);
  }
  return p;
}

/** Program change / reparse: sub files may have been edited — drop the cache. */
export function clearSubfileCache(): void {
  _subfileCache.clear();
}

export interface SaveResponse {
  ok: boolean;
  path: string;
  size: number;
}

export async function saveFile(path: string, content: string): Promise<SaveResponse> {
  // Raw-body PUT, NOT JSON: JSON.stringify of a multi-MB editor save blocked the
  // browser main thread for seconds (escaping + reallocating the whole file) and
  // starved the client heartbeat. The browser sends the string body directly (UTF-8)
  // with no stringify pass; the path rides the query string.
  const url = `${getBaseUrl()}/save?path=${encodeURIComponent(path)}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "text/plain; charset=utf-8", ...authHeaders() },
    body: content,
  });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

/** ---------- G30 tool change position ---------- */

export interface G30Response {
  ok: boolean;
  x: number;
  y: number;
  z: number;
  error?: string;
}

export async function fetchG30(): Promise<G30Response> {
  const resp = await fetch(`${getBaseUrl()}/g30`);
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

/** ---------- Server-side settings ---------- */

export async function fetchSettings(): Promise<Record<string, any>> {
  const resp = await fetch(`${getBaseUrl()}/settings`);
  if (!resp.ok) await throwHttpError(resp);
  const json = await resp.json();
  return json.settings ?? {};
}

export async function saveSettingsSection(section: string, data: any): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/settings/${section}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ data }),
  });
  if (!resp.ok) await throwHttpError(resp);
}

export async function resetServerSettings(): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/settings`, { method: "DELETE", headers: authHeaders() });
  if (!resp.ok) await throwHttpError(resp);
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(`${getBaseUrl()}/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

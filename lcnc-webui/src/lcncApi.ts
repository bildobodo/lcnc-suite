/**
 * REST API helpers for file upload/listing.
 * Complements lcncWs.ts (which handles WebSocket).
 */
import { authHeaders } from "./auth";

function getBaseUrl(): string {
  return location.origin;
}

/** A refused HTTP request, with its status — callers decide whether a
 *  retry can help (a 400 refusal is permanent; a 5xx or a lost network may
 *  not be). The message stays the server's detail. */
export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

async function throwHttpError(resp: Response): Promise<never> {
  // A non-JSON error body (proxy 502 HTML page, empty body) would make
  // resp.json() throw a SyntaxError that masks the real HTTP status. Fall
  // back to the status line so the caller sees "HTTP 502", not a parse error.
  let detail: string | undefined;
  try {
    const body = await resp.json();
    // a refusal with a reason (the gateway's write admission, package 5)
    // carries {error, reason}; a plain refusal a string
    detail = typeof body?.detail === "string" ? body.detail
      : typeof body?.detail?.reason === "string" ? body.detail.reason : undefined;
  } catch {
    detail = undefined;
  }
  throw new HttpError(detail || `HTTP ${resp.status}`, resp.status);
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

export interface DirectoryListing {
  directory: string;
  subdir: string;
  entries: FileEntry[];
}

export interface UploadResponse {
  ok: boolean;
  path: string;
  filename: string;
  size: number;
}

export async function listFiles(subdir: string = "", signal?: AbortSignal): Promise<FilesResponse> {
  const url = new URL(`${getBaseUrl()}/files`);
  if (subdir) url.searchParams.set("subdir", subdir);
  const resp = await fetch(url.toString(), { signal });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

export async function listToolLibraries(subdir = "", signal?: AbortSignal): Promise<DirectoryListing> {
  const resp = await fetch(`/tool-library-files?subdir=${encodeURIComponent(subdir)}`, { headers: authHeaders(), signal });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

export async function readToolLibrary(entry: FileEntry, signal?: AbortSignal): Promise<File> {
  const resp = await fetch(`/tool-library-file?path=${encodeURIComponent(entry.path)}`, { headers: authHeaders(), signal });
  if (!resp.ok) await throwHttpError(resp);
  return new File([await resp.blob()], entry.name);
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

/** The stored G30 position as of LinuxCNC's last synch — a DISPLAY: every
 *  configured axis by letter, a missing row null (never 0). */
export interface G30Response {
  ok: boolean;
  values?: Record<string, number | null>;
  mtime_ms?: number;
  units?: string;
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

/** A program with that name already exists and `overwrite` was not set
 *  (HTTP 409, UI-09). The caller asks the operator: Cancel / Rename / Replace. */
export class UploadConflictError extends Error {
  readonly filename: string;
  constructor(filename: string) {
    super(`A program named ${filename} already exists`);
    this.name = "UploadConflictError";
    this.filename = filename;
  }
}

/**
 * Upload a program. The gateway never replaces an existing file unless
 * `overwrite` is set; a name clash is a 409 surfaced as UploadConflictError.
 * `name` re-sends the same content under a different file name (Rename).
 */
export async function uploadFile(file: File, opts: { overwrite?: boolean; name?: string } = {}): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file, opts.name ?? file.name);
  const url = `${getBaseUrl()}/upload${opts.overwrite ? "?overwrite=1" : ""}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (resp.status === 409) {
    let filename = opts.name ?? file.name;
    let reason: string | null = null;
    try {
      const body = await resp.json();
      if (typeof body?.detail?.filename === "string") filename = body.detail.filename;
      // not a name clash but a refusal (a macro has this name, package 5)
      if (body?.detail?.error === "refused" && typeof body.detail.reason === "string") reason = body.detail.reason;
    } catch { /* keep the requested name */ }
    if (reason) throw new HttpError(reason, 409);
    throw new UploadConflictError(filename);
  }
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}


/** ---------- Macro files (package 5, stage B/C) ---------- */

export type MacroUnit = "length" | "feed" | "angle" | "rpm" | "time" | "count" | "none";

/** A macro's parameter, as the gateway parsed its header (the ONE parser). */
export interface MacroFileParam {
  n: number;
  key: string;
  label: string;
  unit: MacroUnit;
  default: number;
  min: number | null;
  max: number | null;
  integer: boolean;
}

export interface MacroFileNote { line: number; message: string }

/** One macro file: its metadata, the revision (sha256 of its bytes) a run and
 *  a save are bound to, and whether LinuxCNC will run exactly this file. */
export interface MacroFile {
  name: string;
  title: string | null;
  units: "mm" | "inch" | null;
  frame: "machine" | null;
  params: MacroFileParam[];
  description: string[];
  errors: MacroFileNote[];
  warnings: MacroFileNote[];
  revision: string;
  mtime: number;
  runnable: boolean;
  reason: string | null;
}

export interface MacroFolder {
  ok: boolean;
  dir: string | null;
  problems: string[];
  macros: MacroFile[];
}

/** A macro write the gateway refused: the reason, and the revision on disk
 *  now (null when the file is gone) — the caller lets the operator decide;
 *  nothing retries with the new base on its own (Codex VP69-03). */
export class MacroConflictError extends Error {
  readonly revision: string | null;
  readonly exists: boolean;
  constructor(message: string, revision: string | null, exists: boolean) {
    super(message);
    this.name = "MacroConflictError";
    this.revision = revision;
    this.exists = exists;
  }
}

async function macroResponse(resp: Response): Promise<any> {
  if (resp.status === 409) {
    let body: any = null;
    try { body = await resp.json(); } catch { /* status only */ }
    const d = body?.detail;
    if (d && typeof d === "object") {
      const exists = d.error === "exists";
      throw new MacroConflictError(exists ? `A macro named ${d.filename ?? ""} exists` : String(d.reason ?? "Refused"),
        typeof d.revision === "string" ? d.revision : null, exists);
    }
    throw new HttpError(typeof d === "string" ? d : "HTTP 409", 409);
  }
  if (!resp.ok) await throwHttpError(resp);
  return resp;
}

export async function listMacroFiles(signal?: AbortSignal): Promise<MacroFolder> {
  const resp = await fetch(`${getBaseUrl()}/macros`, { headers: authHeaders(), signal });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

/** The macro's text and the revision of exactly these bytes. */
export async function readMacroFile(name: string, signal?: AbortSignal): Promise<{ text: string; revision: string }> {
  const resp = await fetch(`${getBaseUrl()}/macro?name=${encodeURIComponent(name)}`, { headers: authHeaders(), signal });
  if (!resp.ok) await throwHttpError(resp);
  return { text: await resp.text(), revision: resp.headers.get("X-Macro-Revision") ?? "" };
}

/** Save: `base` is the revision the editor started from, or "new". A
 *  RENAME saves under the new name with base "new" and names the old file
 *  and the revision the editor read (`rename`) — the gateway writes the new
 *  one and removes the old one in one step, or neither. */
export async function saveMacroFile(name: string, base: string, text: string,
                                    rename?: { from: string; base: string }): Promise<MacroFile> {
  const r = rename ? `&rename_from=${encodeURIComponent(rename.from)}&rename_base=${encodeURIComponent(rename.base)}` : "";
  const resp = await macroResponse(await fetch(
    `${getBaseUrl()}/macro?name=${encodeURIComponent(name)}&base=${encodeURIComponent(base)}${r}`, {
      method: "PUT", headers: { "Content-Type": "text/plain; charset=utf-8", ...authHeaders() }, body: text }));
  return (await resp.json()).macro;
}

/** Import: creates only, or replaces exactly `replace` (a revision). */
export async function uploadMacroFile(file: File, replace?: string): Promise<MacroFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const q = replace ? `?replace=${encodeURIComponent(replace)}` : "";
  const resp = await macroResponse(await fetch(`${getBaseUrl()}/macro-upload${q}`, {
    method: "POST", headers: authHeaders(), body: form }));
  return (await resp.json()).macro;
}

export async function deleteMacroFile(name: string, base: string): Promise<void> {
  await macroResponse(await fetch(
    `${getBaseUrl()}/macro?name=${encodeURIComponent(name)}&base=${encodeURIComponent(base)}`, {
      method: "DELETE", headers: authHeaders() }));
}

/** The program file at `path` as it is on the disk (Program's Download). */
export async function fetchProgramFile(path: string): Promise<Blob> {
  const resp = await fetch(`${getBaseUrl()}/gcode?path=${encodeURIComponent(path)}`);
  if (!resp.ok) await throwHttpError(resp);
  return resp.blob();
}

/** The tool table FILE as LinuxCNC reads it, and its name (Tools' Download). */
export async function fetchToolTableFile(): Promise<{ name: string; data: Blob }> {
  const resp = await fetch(`${getBaseUrl()}/tool-table`, { headers: authHeaders() });
  if (!resp.ok) await throwHttpError(resp);
  return { name: resp.headers.get("X-File-Name") || "tool.tbl", data: await resp.blob() };
}

/**
 * REST API helpers for file upload/listing.
 * Complements lcncWs.ts (which handles WebSocket).
 */

function getBaseUrl(): string {
  return location.origin;
}

async function throwHttpError(resp: Response): Promise<never> {
  const body = await resp.json();
  throw new Error(body.detail || `HTTP ${resp.status}`);
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

export interface SaveResponse {
  ok: boolean;
  path: string;
  size: number;
}

export async function saveFile(path: string, content: string): Promise<SaveResponse> {
  const resp = await fetch(`${getBaseUrl()}/save`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

/** ---------- HAL viewer ---------- */

export interface HalPin {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
  signal?: string;
  arrow?: string;
}

export interface HalSignalPin {
  arrow: string;
  pin: string;
}

export interface HalSignal {
  type: string;
  value: string;
  name: string;
  pins: HalSignalPin[];
}

export interface HalParam {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
}

export interface HalResponse {
  pins: HalPin[];
  signals: HalSignal[];
  params: HalParam[];
}

export async function fetchHal(): Promise<HalResponse> {
  const resp = await fetch(`${getBaseUrl()}/hal`);
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
  if (!resp.ok) return {};
  const json = await resp.json();
  return json.settings ?? {};
}

export async function saveSettingsSection(section: string, data: any): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/settings/${section}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!resp.ok) await throwHttpError(resp);
}

export async function resetServerSettings(): Promise<void> {
  const resp = await fetch(`${getBaseUrl()}/settings`, { method: "DELETE" });
  if (!resp.ok) await throwHttpError(resp);
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(`${getBaseUrl()}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) await throwHttpError(resp);
  return resp.json();
}

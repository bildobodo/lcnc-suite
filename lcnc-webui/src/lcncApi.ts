/**
 * REST API helpers for file upload/listing.
 * Complements lcncWs.ts (which handles WebSocket).
 */

function getBaseUrl(): string {
  return location.origin;
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
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export async function uploadFile(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const resp = await fetch(`${getBaseUrl()}/upload`, {
    method: "POST",
    body: formData,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

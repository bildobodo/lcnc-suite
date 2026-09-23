// What a failed folder listing tells the operator, and whether "Retry" can
// help (UI-K15). A 400 is the server's permanent refusal (a path outside the
// allowed folder): no Retry button for it — the browser used to show
// "Invalid directory" with a Retry that could only fail again. Anything else
// (network, 5xx, a folder that vanished or is not readable right now) may
// change, so it keeps Retry. Pure — no DOM, no fetch.
import { HttpError } from "./lcncApi";

export interface BrowseFailure { message: string; retry: boolean }

export function browseFailure(e: unknown, fallback = "Could not list files"): BrowseFailure {
  if (e instanceof HttpError) {
    if (e.status === 400) return { message: "This folder cannot be opened — it lies outside the allowed folder.", retry: false };
    if (e.status === 403) return { message: "This folder is not readable (permission denied).", retry: true };
    if (e.status === 404) return { message: "This folder no longer exists.", retry: true };
    return { message: e.message, retry: true };
  }
  return { message: e instanceof Error ? e.message : fallback, retry: true };
}

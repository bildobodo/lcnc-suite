import { describe, expect, it } from "vitest";
import { HttpError } from "./lcncApi";
import { browseFailure } from "./browseFailure";

// UI-K15: a permanent refusal offers no Retry; transient failures keep it.
describe("browse failure", () => {
  it("a 400 refusal is permanent and says why", () => {
    expect(browseFailure(new HttpError("Invalid directory", 400)))
      .toEqual({ message: "This folder cannot be opened — it lies outside the allowed folder.", retry: false });
  });
  it("missing, unreadable, server and network failures keep Retry", () => {
    expect(browseFailure(new HttpError("Directory not found", 404))).toEqual({ message: "This folder no longer exists.", retry: true });
    expect(browseFailure(new HttpError("Permission denied", 403)).retry).toBe(true);
    expect(browseFailure(new HttpError("HTTP 502", 502))).toEqual({ message: "HTTP 502", retry: true });
    expect(browseFailure(new TypeError("Failed to fetch"))).toEqual({ message: "Failed to fetch", retry: true });
    expect(browseFailure("odd")).toEqual({ message: "Could not list files", retry: true });
  });
});

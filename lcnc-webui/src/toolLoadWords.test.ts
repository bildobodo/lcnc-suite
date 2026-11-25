// The gateway's words for a read that is UNKNOWN (tool_proof.LOAD_UNKNOWN,
// groups A and F of load_refusal) and the page's (toolTableRead.LOAD_UNKNOWN):
// one list — the write note says "read again" for them and names any other
// words as the file's own cause (TF-2, plan v3 §3). Node-side: it asks Python.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOAD_OUTDATED } from "./toolLoad";
import { LOAD_UNKNOWN } from "./toolTableRead";

const GATEWAY = fileURLToPath(new URL("../../lcnc-gateway", import.meta.url));

describe("the words of an unknown read", () => {
  it("are the gateway's", () => {
    const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(GATEWAY)}); import tool_proof
print(json.dumps(sorted(tool_proof.LOAD_UNKNOWN)))`;
    expect([...LOAD_UNKNOWN].sort()).toEqual(JSON.parse(execFileSync("python3", ["-I", "-c", py]).toString()));
  });
});

// … and the refusals that say the comparison is outdated (the dialog closes its
// confirm on them, Codex R491): the gateway's own constants, read from its
// source (importing the gateway would bind the live controller)
describe("the words of an outdated comparison", () => {
  it("are the gateway's", () => {
    const src = readFileSync(`${GATEWAY}/gateway.py`, "utf8");
    const gw = ["OTHER", "FILE_CHANGED", "MEMORY_CHANGED", "REMOVED_CHANGED"]
      .map(k => new RegExp(`^TOOL_LOAD_${k} = "([^"]+)"$`, "m").exec(src)?.[1]);
    const py = `import sys, json; sys.path.insert(0, ${JSON.stringify(GATEWAY)}); import tool_proof
print(json.dumps(tool_proof.LOAD_FILE_CHANGED))`;
    const words = [...gw, JSON.parse(execFileSync("python3", ["-I", "-c", py]).toString())];
    expect(words.every(Boolean), String(words)).toBe(true);
    expect([...LOAD_OUTDATED].sort()).toEqual(words.sort());
  });
});

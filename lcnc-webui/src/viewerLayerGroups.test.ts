// The grouped layer list offers every layer exactly once (operator
// 2026-09-30): a layer added to defaults.ts but to no group would have no
// switch in Settings. defaults.ts reaches the DOM at import, so its
// ALL_LAYERS literal is read from the source.
import { describe, it, expect } from "vitest";
import { HUD_LAYER, LAYER_COLUMNS, LAYER_GROUPS } from "./viewerLayerGroups";
import defaultsSrc from "./defaults.ts?raw";

const ALL = [...(defaultsSrc.match(/export const ALL_LAYERS: Layer\[\] = \[([^\]]*)\]/)?.[1] ?? "")
  .matchAll(/"([A-Za-z]+)"/g)].map(m => m[1]!);

describe("viewerLayerGroups", () => {
  it("offers every layer once — the HUD in its own section", () => {
    expect(ALL.length, "ALL_LAYERS read from defaults.ts").toBeGreaterThan(10);
    const offered = [...LAYER_GROUPS.flatMap(g => g.rows.map(r => r.key)), HUD_LAYER];
    expect(new Set(offered).size, "no layer twice").toBe(offered.length);
    expect([...offered].sort()).toEqual([...ALL].sort());
  });

  it("keeps the bounds together and the program's lines together", () => {
    const groupOf = (k: string) => LAYER_GROUPS.find(g => g.rows.some(r => r.key === k))?.id;
    expect(["toolpath", "rapids", "backplot"].map(groupOf)).toEqual(["program", "program", "program"]);
    expect(["toolpathBounds", "bounds", "reachRoom", "reachPart"].map(groupOf)).toEqual(["bounds", "bounds", "bounds", "bounds"]);
  });

  it("reads the groups column by column in their order — two columns, every group once", () => {
    expect(LAYER_COLUMNS.length).toBe(2);
    expect(LAYER_COLUMNS.flat().map(g => g.id)).toEqual(LAYER_GROUPS.map(g => g.id));
    for (const col of LAYER_COLUMNS) expect(col.length, "no empty column").toBeGreaterThan(0);
  });
});

// The timeline's marks and the Sim tab's rows write lucide's X, Triangle and
// Circle out as markup (plan 3.6: a component per mark — up to one per
// timeline column — cost ~18 ms of a large first publication). The markup must
// stay exactly what the components render: rendered here and compared,
// attribute for attribute and child for child — a lucide update that changes
// a glyph fails here.
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { Circle, Triangle, X } from "lucide-vue-next";

type Node = { tag: string; attrs: Record<string, string> };
const parse = (svg: string): { svg: Node; children: Node[] } => {
  const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
  const head = /^<svg\b([^>]*)>/.exec(svg)!;
  const children = [...svg.slice(head[0].length).matchAll(/<(path|circle)\b([^>]*?)\s*\/?>/g)].map(m => ({ tag: m[1]!, attrs: attrs(m[2]!) }));
  return { svg: { tag: "svg", attrs: attrs(head[1]!) }, children };
};
const rendered = async (c: Component, props: Record<string, unknown>) => parse(await renderToString(createSSRApp({ render: () => h(c, props) })));
const writtenOut = (file: string) => {
  const src = fs.readFileSync(path.resolve(__dirname, file), "utf8");
  return [...src.matchAll(/<svg\b[^>]*class="lucide [^"]*"[^>]*>[\s\S]*?<\/svg>/g)].map(m => parse(m[0]));
};
const kindOf = (n: { svg: Node }) => /lucide-(x|triangle|circle)\b/.exec(n.svg.attrs.class ?? "")![1]!;

describe("the written-out lucide glyphs (plan 3.6)", () => {
  // as the components were used: the marks 9 px (X stroke 3), the rows 12 / 11 / 10 px
  const uses: Array<[string, Record<string, [Component, Record<string, unknown>]>]> = [
    ["ScrubBar.vue", { x: [X, { size: 9, "stroke-width": 3 }], triangle: [Triangle, { size: 9, fill: "currentColor" }], circle: [Circle, { size: 9, fill: "currentColor" }] }],
    ["SimPanel.vue", { x: [X, { size: 12, "stroke-width": 3, "aria-hidden": "true" }], triangle: [Triangle, { size: 11, fill: "currentColor", "aria-hidden": "true" }],
                       circle: [Circle, { size: 10, fill: "currentColor", "aria-hidden": "true" }] }],
  ];
  for (const [file, want] of uses) {
    it(`${file}: each glyph is what the lucide component renders`, async () => {
      const found = writtenOut(file);
      expect(found.map(kindOf).sort(), "one of each").toEqual(["circle", "triangle", "x"]);
      for (const g of found) {
        const [c, props] = want[kindOf(g)]!;
        expect(g, kindOf(g)).toEqual(await rendered(c, props));
      }
    });
  }
});

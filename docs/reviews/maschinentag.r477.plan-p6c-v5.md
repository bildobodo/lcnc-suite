# P6-c (machine-day F8) — plan v5: the shape store (c1) and the collision body (c2)

**State.** Code sites at development `24f3bd3a` (worktree `/home/cnc/lcnc-suite-p6c`, branch `feat/p6c`). Plan and scratch probes only; no product code, nothing pushed. It replaces the P6-c parts of `plan-p6ce-v3.md` and Part B of v4. Not re-opened: Q5 = the closed stepped hull, acceptance by pair and stretch coverage, rule R and `_read_tool_files` (merged), "unpaired or no library row = today's cylinder".

**Probes** (`~/claude-work/p6/c5/probe/`, bundled with the worktree's esbuild, run in plain Node 22; timings and counts under the heavy lock on the idle VM, one COLD process per timing, 3 repeats): `cases.ts`, `hull5.ts`, `geom5.ts`, `timing*.ts` → `timing1..4.jsonl`; `contain.ts` → `contain.out`; `counts5.ts` → `counts5.out`; `mute.ts`. Unlocked, beside Codex's R476 load, geometry and rows only: `drawn5.ts`, `toolswap.ts` (a patched COPY of `collision.ts`), and `gil.py` (a timing).

## Summary

| Open point (R461 / R465) | v5 |
|---|---|
| What pairs | A rule-R-proven row `(T, D, Z)` as sent, under one `(table identity, rev.library, units)`. ε = 1e-4 machine units, at comparison only. §1.2 |
| `seen` bounded | 8 newest distinct raw rows per tool. A held publication's decision is kept by its holder; eviction never changes a result. §1.3 |
| Cache with owners | Drawings only: 32 entries and 64 MB idle. An owned entry is never evicted; a 33rd owner gets a private one. A late result lands only in its own live entry. A check's bodies are numbers (≤ 260 bytes) held by the check. §1.5 |
| First build is no long task | Counted steps in 4 ms slices. Longest task 10.0 ms over every case **in Node on this VM**, not in a browser, not on the N100. Up to 7.6 ms of it is one allocation / GC spike between two yields, which the count does not bound. The old builder was one task of 153 ms (Codex's cylinder) to 680 ms (worst importable mesh). §3 |
| Body after transfer | 51/51 inputs in mm and 51/51 in inches inside the body rebuilt from the transferred numbers, judged by an independent check, also against the stepped drawing the marker will show; nine builder mutants and four wire mutants red. §2.4 |
| Native mesh / profile sweep | Run (mm). §4. An inch SWEEP is not run |
| **New:** stock pairs | The hull (and the drawn shape) can lose a rapid gouge that today's pin reports. Counterexample in §2.6, for decision |
| **Not closed** | The reply's decode: 24–26 ms in one task for one maximum mesh, growing with the library's TOTAL triangles; existing. §3.4 |

---

## 1. c1 — the shape store

### 1.1 One reader

`toolTableStore.ts` (new): ONE reader for the page. Today `ToolTablePanel` and `ToolStrip` each read on every ping, and each reply carries every mesh. It owns `ToolTableReads`, the last `ToolTableView` and the raw reply's `table`, `rev`, `version`, `proof`. Both panels become its consumers; the tab keeps its slow note, its 60 s end, Retry and the write notes.

A read is sent on: a connection's open; a `tool_table_changed`; an INI change; a panel's Retry or write; a **publication or base-tool row that no proven row matches** (once per publication and row — this closes the race "publication before the ping"); one retry 1 s after a `partial` reply that leaves a needed tool unproven, at most two per ping.

State: `none` (no reply of this epoch yet) · `reading` · `current` · `failed`. A failed or superseded read never replaces the last good one of the same epoch; its state word does.

### 1.2 What pairs

A **record** is `{T, D, Z, meta}` from one reply, with T in the reply's proven set (`toolTableView(...).proven`: every row of a `complete` read, the named ones of a `partial`). D and Z are the row's raw values, Z signed. `meta` = the row's geometry fields (the list of `tool_visual_metadata`); none of them → "no library shape". It belongs to `(epoch, table.path, table.instance, rev.library, units)`.

A publication's row for T (`parse_tlos`: raw zoffset and diameter; never `toolDimsFor`, which takes |Z| and a 6 mm stub), or the base tool (`basis.toolNum`, `toolDiam`, the new `basis.toolTableZ`: status `tool_table_z`, in a run `run_basis.start`), is **paired** when one `seen` row of T, under the store's current `(identity, rev.library, units)`, differs by at most 1e-4 in D and in Z. A match in `seen` stands even when the newest read is `partial` on T. Without a match it is today's cylinder with the first reason that applies (≤ 60 characters):

| Case | Reason on the card | Warns |
|---|---|---|
| no geometry field in the library row | `no library shape` | no |
| store `none` / `reading` / `failed` | `shape not read` | yes |
| T not proven (differs, missing, duplicate, unread, `unchecked`) | `tool row not confirmed by LinuxCNC` | yes |
| proven rows exist, none matches | `tool table changed since the preview` | yes |
| D ≤ 0 and no native mesh / profile | `no diameter in the table` | yes |
| refused by §3.3 | `shape too detailed` / `shape not usable` | yes |

T ≤ 0 and an unread line without a T attach to nothing. A tool without a length stays "own pairs not checked", as today. Two shapes are never mixed: the pair (row, meta) is one reply's, so the two files once held both.

### 1.3 `seen` and its bound

`seen[T]` holds the **8** newest distinct raw rows (exact values, newest proof first; a re-proof moves a row to the front, the ninth drops the last). No ε merging: a chain of near values must not drift. T is bounded by the table itself.

A DECISION has an owner. `bindings(holder)` keeps, for each holder — the publication on screen, the pending check, the shown result, the run basis, the side run (at most five) — the decision per tool: paired with its meta and dims, or the reason. It is made when the holder takes the row and goes with the holder; once built, the body's numbers (≤ 260 bytes) are kept IN the decision. So:

- **Eviction** can only make a LATER holder unpaired ("tool table changed since the preview"). It never unpairs a held publication and never touches a result.
- **A result** carries its bodies as numbers in its basis (§2.3). Nothing of the store can change them.

### 1.4 What changes when

| Event | Store | Decisions | A shown or running check |
|---|---|---|---|
| Connection closes | cleared: `none`, epoch ends, `seen` empty, cache generation ends | live = "no statement" | stays. **A store without a statement is no change of input.** The marker goes back to its cylinder |
| Reconnect, read answered | fresh `seen` | re-decided | stays when every body equals the basis's (exact numbers), else the existing input-change path |
| `rev.library` changes | `seen` emptied, refilled from this reply | re-decided | re-checked if a body of it differs or is gone; else stays |
| A table row changes, same library | row added to `seen` | old publication stays paired (its row is in `seen`); the next one pairs with the new row | through the new publication, as today |
| Identity (path or instance: restart, rebind, other INI) or units change | cleared | re-decided after the next proven read | as the library line |
| A check was unpaired, its row is proven later | — | now paired | idle: re-checked. **In a run: never** — the basis is the run's; the existing end-of-run comparison decides |
| M600 / Measure in a run | row added | the mid-run pinned publication pairs with its own row; the base tool keeps `run_basis.start`'s | unchanged |
| Tool change in the run | — | per segment, as today (`toolForIndex`) | unchanged |
| Sim mode entered / the entry move's or a run beginning's side sweep | — | the side run takes the bodies of the main check's basis, never a new decision | merged as today |
| Simulation switched off on this device | reads go on (the Tools tab) | no build, no wait | — |

`sameCheckInputs` compares `shapes` this way: no statement on the live side → same; same `(identity, rev.library)` → changed only if the basis was unpaired and live is paired; else equal exact numbers → same.

**A check waits, bounded** (an idle one beside `_colDriftReady`, a run check in `_startRunCheck` by its existing `_colHeldByRun` retry):
1. for the first answer of this connection, or the one read a row asked for (§1.1): at most **3 s** per connection or row, then it goes with the cylinder, named;
2. for the hulls of its paired tools (§3: milliseconds; ≈ 0.1 s per tool at the importer's maximum on the VM).
No wait for a re-parse (Codex R461). The wait belongs to (program generation, input generation, connection): a newer one ends it.

**Live marker:** stays on `st.tool_meta` (named exception, R461). The card never calls it the check's shape.

### 1.5 The cache

`toolShapeCache.ts`. Key `(identity, rev.library, T, D, visual length, unit scale)`; a generation number per (epoch, identity, library, units, scene). An entry is a DRAWING: `building | ready {cutter, shaft, bounds} | refused {why}`. **Bodies are separate jobs**: a hull reads the mesh or profile, not the drawing, so a check builds no drawing and no cache pressure can take a hull a check still needs (five maximum meshes already pass 64 MB). A generation keeps the numbers of at most 256 bodies (LRU) for the next holder. Geometries carry `userData._shared = true` (`disposal.ts` skips them) and their bounding sphere, set by the build: three's own `computeBoundingSphere` at the first frame is a 10–13 ms task at 200 k triangles.

- **Owners** hold GEOMETRY: the scrub marker, and a marker being swapped in. `acquire(key)` / `release()` once each. Checks hold numbers only and own nothing.
- **Bound:** ≤ 32 entries, ≤ 64 MB of geometry in entries without an owner (32 maximum meshes would be 460 MB). LRU goes first among the entries with no owner that are not building.
- **All 32 owned or building:** `acquire` answers a PRIVATE entry, built like any other, disposed on its release, traced `viewer.shape_cache_full`. Never an eviction of an owned entry, never a refusal. (One marker per page: not reachable without a leak; the rule is total anyway.)
- **End of a generation:** entries without an owner are disposed at once; owned ones leave the map and are disposed at their LAST release; building jobs are cancelled at their next yield.
- **A late result** goes only into the entry object that asked for it, and only while that entry is still in the map of its own generation; else it is disposed, unread. A marker swaps only if its wanted key is still that key. No other effect.
- **Jobs** run one at a time: the marker's tool first, then the program tools of the publication on screen in program order. At a publication's adoption they are warmed up, so a scrub past a tool normally finds its shape.

### 1.6 Marker

While scrubbing to a tool that is not the loaded one (`ThreeViewer.vue:2732`), dims stay the publication's; the shape comes from the binding. Not ready or unpaired → the cylinder as today; the swap happens when ready. `getToolMeta(scrubTool)` is no longer read there.

---

## 2. c2 — the body

### 2.1 Input: what is drawn, one dispatch

`toolDrawing(diam, len, meta, u)` (in `toolGeometry.ts`): `{kind: "mesh", mesh}` for `native_mesh`; `{kind: "lathe", parts: [{role, pts, segments}]}` for native profile and parametric types. `buildToolGeometries` draws it (same output; its tests hold it), and the hull reads THE SAME value. A branch cannot be missed.

- **Mesh:** the hull takes the indexed vertices and triangles (f64, machine units): any position, lugs off the axis, z < 0.
- **Lathe:** the hull takes the profile polylines, not the tessellation. A lathe facet's point at height z is a convex combination of points at radius ≤ the profile's, so its radius is ≤ the profile's at z. The guard judges the DRAWN triangles; it found the one place this fails by rounding (the upright rotation gives z = −r·6e-17): 31 of 51 inputs red without the pad below.
- **∪ today's body as built:** the triangles of `toolCylinderPositions(D, visual length)` (bottom at −1.2 µm), visual length from `_toolVisual`.

### 2.2 Construction

1. Range `[min(0, zmin, pin), max(visual length, zmax, pin)]`; for a lathe widened by 1e-9 of itself; ends rounded outward in f32.
2. K = min(32, ceil((range − 1 µm) / 5 mm)), all × unit scale. **The 1 µm enters only this count; the range is never shortened.** Equal slabs; longer than 160 mm → higher slabs.
3. Per slab the largest radius² of: every edge's ends in the closed slab, and the edge's crossing of each boundary it passes. An edge passes boundaries in order, so the cost is 8 + (boundaries crossed) per edge: no polygon clipping, no allocation.
4. ρ = r / cos(π/20) × (1 + 2⁻²⁰), rounded up to f32. Exactly equal neighbours are merged, never near ones. A slab without input (only a mesh with an axial hole beyond the pin) is bridged at D/2.
5. **Numbers:** `{n: 20, z: Float32Array(M+1), rho: Float32Array(M)}`, at most 260 bytes (measured ≤ 172).

A non-finite coordinate or an index out of range → `shape not usable`, never a partial body.

### 2.3 To the worker

`toolDims[T] = {diam, len, hull?}`, `tool = {diam, len, hull?}`; numbers only. `makeToolVariant(diam, len, hull?)` rebuilds ONE closed mesh (cap fans, walls, step annuli; ≤ 2 560 facets) and makes BVH, boxes and closure exactly as today. A malformed hull (lengths, order, finiteness, 3 ≤ n ≤ 64) throws: the check fails by name, never a silent cylinder. `baseToolFor`'s cache key gains the hull's exact numbers (today it is diameter and length alone, so a cached pin would stand in for a hull). The model key stays without a tool (P2b-1); a tool or library change rebuilds no machine BVH.

Probed on a patched copy of `collision.ts` (the hull through `makeToolVariant`, program variants, `baseTool`, the base restored): a program of two tools, a mesh and a parametric one, swapped at the tool change, gives the 8 rows of the two single-tool sweeps, unmatched 0, episode ends within 0.14 (MIN_ADV 0.25), touches within 0.001; the same in 2 and 3 shards; 0 rows with pins.

`CheckBasis` gains `toolTableZ` and `shapes: {identity, library, base, tools: Record<T, {body: "shape"|"envelope", rMax, hull} | {body: "table", why}>}`, taken once when the request is built.

### 2.4 Containment, measured now and kept as the product guard

The guard (`toolBody.test.ts`): numbers → `structuredClone` (the transfer) → the WORKER's `hullPositions` → from the rebuilt mesh alone its z levels and side planes. Every drawn triangle of `buildToolGeometries` (f32) and of the pin: all three vertices and all three edges × both planes of every slab it meets (brute force, f64) against every side plane, tolerance 0; plus the caps. It shares no code with the builder and does no sampling. The same judgement runs on what the CACHE hands out (the stepped drawing), so body and marker cannot drift apart: probed, 12 of 12 meshes bit-equal in position to `buildToolGeometries` (also at 200 k triangles; normals within 6e-8), 444 sector builds of the lathes (1, 5, 7 segments a sector, mm and inch) 0 outside, sampled vertices within 3e-14 mm of three's lathe. The rebuilt body has no arealess facet (102 bodies), so `makeToolVariant`, which does not filter them, equals `buildCollisionModel`, which does.

Inputs, mm and × 1/25.4: T13 at D 1.875 and 8, end mills (Ø6/Ø6, Ø3/Ø6, OAL either side of L + 20, 300 mm drill, Ø0.1 and Ø0.2), no meta, mesh with a lug, mesh and formmill below the tip, the long facets of R461 and R465, a closed cylinder, all 36 shipped xyz3 tools (21 parametric, 14 profiles, 1 mesh).

| | mm | inch |
|---|---|---|
| control: outside / not closed / geometry note | **0 / 0 / 0 of 51** | **0 / 0 / 0 of 51** |
| original vertices only | 34 red | 33 red |
| a crossing counted in one slab only | 7 | 7 |
| inscribed 20-gon | 49 | 49 |
| no union with the pin | 36 | 43 |
| range from 0 | 36 | 41 |
| 1 µm cut off the range | 51 | 51 |
| no 2⁻²⁰ | 4 | 4 |
| neighbours within 5 % merged | 9 | 9 |
| lathe range not widened | 31 | 13 |
| wire: rounded to 3 decimals / rebuilt with n = 12 / last slab lost / ρ sent as the apothem | 39 / 50 / 21 of 21 / 49 | 49 / 50 / 23 of 23 / 49 |

Not distinguishable, so not claimed: nearest instead of outward rounding at the ends, ρ one ulp down (both inside the pad and the 2⁻²⁰), a boundary vertex counted only above. The body equals the R465 candidate's to ≤ 5e-7 mm per slab (one tool 8e-6), so the R465 numbers describe it.

### 2.5 Acceptance (sweep level)

Pair and stretch coverage as in R465 (episodes ± 0.25 of path, touches ± 2e-3), shown and twin, through `opts.baseTool` (the product's install path), for a parametric, a profile and a mesh tool, in mm and inch. Compared too: gaps, truncation, notes, `insideClosed`. Accepted when every stretch of the reference and, outside the stock pair (§2.6), of the pin is covered. **A non-round mesh's reference is its rotating envelope, never the mesh at rest**: in §4 the resting lug gives 0 findings, the body 2 collisions and 2 near misses, and the spinning tool does hit.

### 2.6 Known difference: the stock pair (for decision, §7)

A cutting pair's contact begun on a FEED is machining until a verified separation (> 2 × margin); a rapid touch inside that stay is not reported (`cutMute`, `collision.ts:1881 ff.`). A wider body stays inside the stay longer. Ø3 on Ø6, 20 mm deep, fed out of the block's side to x = 110 + e, rapid back in:

| e | pin (today) | hull | drawn |
|---|---|---|---|
| 5.0 mm | — | — | — |
| **6.2 mm** | **1 rapid collision** | **none** | **none** |
| 8.0 mm | 1 | 1 | 1 |

So "never less than today's pin" holds for the geometry and for every other pair, not for tool × stock findings. The window is the radius difference (here 1.5 mm; T13 near its tip ≤ 0.3 mm). Only machines with a `stock` body are affected (the XYZAC and gantry examples carry one, the shipped 3-axis model none; the operator's own model was not read). **Recommendation:** accept it, name it in `collision.md`, pin it as a test. Alternative: a second tool body (the pin) for the stock pair only, findings united — more pairs and a merge in the contact view.

Apart from P6-c, the first row shows an EXISTING gap: a rapid from 3.5 mm into the stock after a feed out of it is not reported today.

---

## 3. Work bounds

### 3.1 Measured (VM, Node 22, cold, ms)

| Case | v4 builder, one task | v5 total | v5 longest between two yields | v5 longest task, 4 ms slices | drawn geometry today, one task | decode of the reply, one task |
|---|---|---|---|---|---|---|
| 200 k triangles, fine mesh | 45–48 | 34–42 | 3.1 | 8.5 | 31–44 | 24–25 |
| **Codex: 40 002 v / 80 000 t cylinder, 160 mm** | **152–159** | 22–26 | 3.5 | 6.4 | 19–21 | 12 |
| cylinder at the limit, 199 996 t | 351–366 | 39–48 | 7.6 | 7.3 (13.9 at 8 ms slices) | 42–49 | 24–25 |
| worst importable: 200 000 t, each over 32 slabs | **650–684** | 57–64 | 7.1 | 7.5 | 40–42 | 24–26 |
| drawing of that mesh in steps | — | 15–23 | 7.5 | **10.0** | (the column left) | — |
| 40 new tools at once (those 4 meshes + the 36 shipped tools, hull + drawing) | — | 163–169 in 73–76 tasks | — | **7.0** | — | — |
| lathe 100 × 512 / 400 × 512 / 2000 × 512 points × segments | — | 25 / 51 / 162 | — | 6.1 / 7.2 / 6.9 | 19 / 32 / 90–123 | — |

With 8 ms slices (the runner's default) the longest task is 13.9 ms. **Hence 4 ms.** The spikes are allocation and GC, not counted work.

A worker instead: handing the nested arrays over is one page task of 20 ms (serialize, 200 k triangles), so they would have to be packed into typed arrays in steps first (2.5–6.6 ms in all). Per maximum mesh the page would then spend ≈ 7 ms instead of ≈ 60–85 ms spread over 4 ms slices. Not taken: it adds a lifecycle and a failure class for a case no shipped library has (largest mesh 932 triangles). It is the fallback if the N100 measurement fails (§6).

### 3.2 The steps

`runSteps(job, {sliceMs: 4})`, budget 4 096 operations between yields. **Counted:** 3 per vertex scanned, 8 + crossings per edge, 24 per drawn triangle, a lathe sector of ≤ 4 096 vertices as a step of its own (three's `LatheGeometry` with `phiStart` / `phiLength`, then copied), the pin's 80 triangles as one step. Not yielded inside: one `buildToolProfile` (≤ 4.2 ms at 11 600 points), two allocations of ≤ 7.2 MB (a yield before each).

### 3.3 Input bounds (work, not trust)

Checked before any build, on the client, because a hand-edited library passes no importer: mesh ≤ 100 000 vertices and ≤ 200 000 triangles (the importer's limits); profile ≤ 16 384 predicted points (native profile length; formmill arcs by their own step formula; threadmill teeth × arc steps; shipped maximum 51); lathe ≤ 400 000 vertices (shipped 4 225). Above: `shape too detailed` → the table cylinder for body AND marker, named, with a warning. The predictor is a second copy of the arc-step formula: a guard holds predicted ≥ produced over every shipped tool and the extreme cases (a formmill of 4 000 arcs is one 370 ms `buildToolProfile` call).

### 3.4 Not closed: the reply's decode

`get_tool_table` carries every mesh. `msgpackDecode` of one maximum mesh is 24–26 ms in ONE page task (Codex's 80 k: 12 ms; the shipped 36-tool library: 3.6 ms), and it exists today, twice per ping (Tools tab and strip). c1 makes it once. It scales with the library's TOTAL triangles and passes 16 ms at about 125 k. Smallest remedy, not in v5: `get_tool_table {have_library}`, the gateway leaving the meshes out while `rev.library` is unchanged; the first read stays. **The claim is therefore: hull and drawing of any admitted shape — no task over 16 ms (10.0 measured); the decode of a library with more than ≈ 125 k mesh triangles in all — not covered.** The GPU upload of a drawn mesh and the browser itself are not measured here (§6).

Gateway, found on the way: every `get_tool_table` computes `library_rev` on the event loop (`gateway.py:10086`): a 1 ms ticker's worst gap is 76 ms for one maximum mesh (0.6 ms of work for the shipped library). A thread does not help: `json.dumps` holds the GIL (72–74 ms). Build step 0 therefore keeps the revision with the `ToolLibraryStore` cache entry: one computation per file state, not per read.

---

## 4. What the operator sees

**Check basis card**, per tool (the start tool too):
- `T13 · L 63.210 · Ø 1.875 mm · shape, Ø max 8.00` — checked around its library shape;
- `T24 · … · envelope, Ø max 24.00` — an imported mesh: its envelope all round, as it spins;
- `T5 · … · table Ø — tool table changed since the preview`.

The note becomes: "Shape: a stepped body around the library shape, at least the table Ø over the table length + 20 mm. Table Ø: that cylinder alone (no diameter: a 6 mm stub). Holders are not modeled." A tool that HAS a library shape but was checked as `table Ø` also adds a result note ("T5 checked as its table Ø"), which the Sim tab's summary shows as its caveat (the project's rule: what is not known is never plainly clear); no library shape adds none. The 3D tool in the simulation is the library shape (or the cylinder, for the same reason as on the card).

**Counts** (real chain, synthetic scene, one thread on the VM; 5 mm slabs):

| | pin today | body | drawn | sweep ms pin → body |
|---|---|---|---|---|
| T13 D 1.875, relief beside two clamps | 0 | 3 near | 3 near | 989 → 3 100 |
| T13 at the old D 8 | 6 + 16 near | 12 + 16 near | 10 + 17 near | 1 193 → 3 531 |
| Ø3 on a Ø6 shank | 0 | 2 near | 2 near | 164 → 458 |
| native profile with a collar | 0 | 4 near | 4 near | 161 → 468 |
| native mesh with a lug (envelope) | 0 | 2 + 2 near | 0 (lug at rest) | 163 → 471 |

Coverage: the body misses 0 stretches of the drawn shape and 0 of the pin in all five, shown and twin (the pin misses 3 of 3, 27 + 10, 2, 4, 0). **Cost: 2.8–3.1 × the sweep time of this scene (T13: 3.1 ×, not the 2.8 × of R465)**, BVH build unchanged (the machine model's; a tool body 0.3 ms median, ≤ 5 ms cold). More findings near clamps is the purpose; a wrong table D makes a wrong, wider body (P6-e's header hint is its guard).

**Operator's N100: not measurable here; owed at the machine (§6).**

---

## 5. Guards, mutations, files, order

### 5.1 Guards and the mutations that must turn them red

| Rule | Guard | Red on |
|---|---|---|
| 1.1 one reader | `toolTableStore.test.ts`; `tool-table-read.spec`, `tool-edit.spec` unchanged | a second `get_tool_table` per ping; an old epoch's reply applied; `partial` rows outside `proven` taken; no read for an unseen row; a third retry |
| 1.2 pairing | `toolShapePairing.test.ts`: tables of (reply, row) → decision | D only compared; ε = 0 (memory 63.2121551, file 63.212155); `toolDimsFor` (negative Z; D 0); an unproven row; another `rev.library`, instance, unit scale; an unread line attached to a T; T ≤ 0 |
| 1.3 bound | same | ninth row kept; a row dropped for a held publication; ε merge (chain of 0.9e-4); a re-proof that does not refresh |
| 1.4 lifetime | `checkBasis.test.ts` + pairing | "no statement" read as a change (a reconnect re-checks); a library change that does not re-check; a re-check in a run; the run's base tool from the live status |
| 1.5 cache | `toolShapeCache.test.ts` (fake geometries, a hand-driven scheduler) | an owned entry evicted; a double dispose; a 33rd acquire refused; a late result of an ended generation inserted, or shown by a marker that wants another key; 64 MB not kept; two jobs at once |
| 1.6 marker | `tool-shape-sim.viewer.spec.ts` (v3's red spec made product; it reads the marker's own geometries): T13 never loaded → cone end 3.98, length 100; library change; D + type change; disconnect → cylinder → back; 10 × ×100 playback: builds = number of distinct shapes | `getToolMeta` read again; no release on replace |
| 2.1–2.2 body | `toolBody.test.ts` (§2.4) | the nine mutants of §2.4; a lathe branch fed from another profile than it draws |
| 2.3 transfer | `toolBody.test.ts`, `collisionWorker.test.ts` | the four wire mutants; the base cache key without the hull; a malformed hull that becomes a cylinder; `hull` dropped for the base tool, for a program tool, for a shard, for a side run |
| 2.4 drawing | the judgement on the cache's own output, mm + inch; mesh positions equal `buildToolGeometries` | a drawing built from another profile or scale than the body |
| 2.3 closed | variants through `makeToolVariant`, mm + inch: `insideClosed`, no note | a step without its annulus; a cap missing |
| 2.5 coverage | `collision.test.ts` fixture: a clamp face 3.0 mm from the pass (pin 0, body a near miss); the heavy sweep file for §2.5 | `_programToolDims` without the hull |
| 2.6 | the 6.2 mm case pinned as is | — (a record) |
| 3.2 steps | operations between two yields ≤ 4 096 + one triangle's 117, for every mesh case; sector ≤ 4 096 vertices | an uncounted scan; the pin inside the loop; a whole lathe in one step |
| 3.3 bounds | one case above each; predicted points ≥ produced | no check on a hand-edited library; a predictor that counts an arc short |
| 4 card | `checkContext.test.ts`; `sim-panel.viewer.spec` (text, caveat) | a body without its word; the note missing when a shape was not used; a note for a tool without one |
| 0 gateway | pytest: n reads of one file state compute the revision once; a changed file once more, with the new value | computed per read; a stale value after a same-size rewrite |

Times are never asserted in a gate (flaky): each build traces `viewer.shape_build {tool, body, tris, ops, tasks, max_task_ms, total_ms}`; §6 reads it.

### 5.2 Files

New: `toolTableStore.ts`, `toolShapePairing.ts`, `toolShapeCache.ts`, `viewer/toolBody.ts` + tests, `e2e/tool-shape-sim.viewer.spec.ts`. Changed: `toolGeometry.ts` (`toolDrawing`), `ToolTablePanel.vue`, `ToolStrip.vue`, `ThreeViewer.vue` (marker, `_programToolDims`, base tool, waits, `__viewerDiag.getToolMarker`), `viewer/collision.ts` (`ToolSpec`, `makeToolVariant`, `toolDims`, body notes), `viewer/collisionWorker.ts` (`tool`, cache key), `viewer/checkBasis.ts`, `viewer/checkContext.ts`, `tool_store.py` + `gateway.py` (step 0), `e2e/mock-gateway.mjs` (a `get_tool_table` with `proof` and `rev`).

`rules.py`: `toolTableStore.ts`, `toolShapePairing.ts` join the `ToolTablePanel` rule (browser TOOLS) plus VIEWER; `toolShapeCache.ts` a new rule (browser VIEWER + `tool-shape-sim.viewer`); `viewer/toolBody.ts` is under `viewer/**`. `READ_SITES`: the coverage file if it joins `HEAVY_UNIT` and reads the seed (`examples/sim_config/xyz3/**`); the spec only if it reads a file from disk (planned: none, the meta is inline). Function inventory: regenerate if the guard names the trace or the reply fields.

Docs: `collision.md` (body, §2.6; "the local-only DMU carries the first stock body" is out of date), `machine-model.md`, `frontend-modules.md`, CLAUDE.md lines, `docs/decisions.md`.

### 5.3 Order

0. Gateway: one revision per file state. 1. Store + panels, no visible change. 2. Pairing, `seen`, bindings (pure). 3. `toolDrawing`, steps, cache, marker; the browser spec red at `24f3bd3a` first. **Bell 1 (c1).** 4. `toolBody.ts` with the guard. 5. Worker, basis, waits, card, notes. 6. Coverage, mutations, docs. **Bell 2 (c2).** One merge gate for both.

### 5.4 Native

One case (native stage, real LinuxCNC and gateway, the page in Chromium): a program whose M600 measures a tool never loaded on the page, simulation on. The run check on the mid-run publication says `shape` for that tool, with the new Z paired inside the 3 s, and no `table Ø`. It is the race of §1.1 on real timing.

---

## 6. Limits and what is owed

- **At the machine (N100, read from the trace):** sweep time with shapes against the pin; `max_task_ms` (aim < 16; above it, split a mesh's drawing into several geometries); the store's reply time and decode with the machine's library; T13's shape after a library refresh (its entry is from May, without `tapered_type`).
- **In a browser, before the bells:** the same trace fields in Chromium and Firefox, incl. GPU upload and the first frame. Node measured only the JavaScript.
- **Not run:** an inch sweep (in the acceptance, §2.5), the worker itself with hulls (transfer by `structuredClone`, no Worker; a side run), any browser, native cases, anything on the N100. The sweep counts of §4 took the body from `buildCollisionModel(…).baseTool`. Counts come from one synthetic scene.
- **Coarser by design:** a body of revolution in ≤ 32 steps; holders not modeled; a shank in the stock on a feed counts as cutting, as today.
- **Pins that stay:** random toolchanger, tool database, an older gateway: never proven → `table Ø`, named. A library file edited by hand is seen at the next read (no watch on it).
- **Live marker** on `st.tool_meta`, its one-task geometry build unchanged (40–49 ms at the importer's maximum, existing).

## 7. Questions

**Codex.** (1) §2.1: the profile instead of the lathe's triangles as hull input, with the guard on the triangles — agreed? (2) §2.6: accept and name, or the second body? And the existing 2 × margin gap: a package of its own? (3) §1.4: the 3 s waits before a check (first read; one read for an unseen row) — compatible with "no extra waiting"? (4) §3.4: is the decode a named limit, or does `have_library` belong to c1? (5) §1.3 / 1.4: decisions held by their holder, "no statement" never a change — enough for the result's lifetime?

**Operator (one; recommendation: accept).** On a machine whose model has a stock body, the new body can, in a narrow case (§2.6: fed out of the stock by a little more than the thin cutter, less than the shank needs, then rapid back in), no longer report a rapid into the stock that today's check reports; the exact drawn shape does not report it either. Everywhere else its findings cover today's. Accept this, named in the documentation, or build the extra pin body for the stock pair? "Never less than today" was part of the case made for Q5 (`f8-counts-v2.md` §6).

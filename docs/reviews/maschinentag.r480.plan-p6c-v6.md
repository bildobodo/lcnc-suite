# P6-c (machine-day F8) — plan v6: the shape store (c1) and the collision body (c2)

**State.** Code sites at development `24f3bd3a` (worktree `/home/cnc/lcnc-suite-p6c`, branch `feat/p6c`). Plan and scratch probes only; no product code, nothing pushed. v6 answers Codex R477 and replaces v5. Not re-opened: the closed stepped body (Q5), acceptance by pair and stretch, rule R and `_read_tool_files` (merged), "unpaired or no library row = today's cylinder".

**Dependency.** c2 is accepted only on top of the mute-rule package (`feat/stock-mute`, planned separately; Codex R477, Q2). v5's stock exception is gone: the acceptance of §2.5 covers tool × stock like every pair. c1 and the body's construction do not depend on it.

## Changes against v5

1. **MT477-01 (§2.1–2.4).** ONE canonical float32 source for drawing and body. No range pad, no larger tolerance. The fault was wider than reported: v5 fails on **1 678 of 15 368** generated cases, in meshes AND lathes (profile, form mill), by up to 7.6 µm; v6 on **0 of 15 368** with 5.6 M interior witnesses, 0 of 102, 0 of Codex's 8.
2. **MT477-02 (§1.4).** One visible decision: card, side run and the scrub marker read the decisions of the shown check's context. A drawing not yet built shows the checked body itself. "Not read" and "changed" are two states.
3. **MT477-03 (§1.1, 1.2).** The store has two outputs: the current read and the bound shape record. `no library shape` only when the absence is proven.
4. **MT477-04 (§1.3, 1.5, 1.6).** T keys are freed; metadata is one immutable library per revision, in typed arrays (52 MB of heap objects → 3.6 MB per maximum mesh); a bound per kind; a liveness mark instead of map membership.
5. **R477 answers.** Q3: one absolute deadline per check (§1.7). Q4: `have_library` is part of c1 (§1.8). "No task over 16 ms" is a goal until the browser and the N100 are measured (§3). Coordinates float32 cannot hold are a named shape fault; a broken wire format stays a hard worker error.
6. **Separate proposal, not part of MT477-01:** the open-interval slab rule (§2.2a). The canonical source alone, with v5's touching rule, already gave 0 red everywhere. Codex decides (§7).
7. Stock exception, its operator question and the "known difference" test: removed.
8. **Behaviour change of the card, named:** a check's context goes with its result (§1.4).

**Probes.** New in `~/claude-work/p6/c6/probe/`: `hull6.ts` (canonical sources, builder), `judge6.ts`, `run6.ts` (Codex's cases, the 102, the generator, mutants, sectors), `timing6.ts` (`timing6.locked.jsonl`). **Which numbers are locked:** §3.1's table and §4's interleaved times (`timing6.locked.jsonl`, `inter6.p2.locked.out`). Beside Codex's load, unlocked: all geometry, mutants and finding counts (load does not change them), the heap figures, the lathe times and T13's ratios (named where they stand). From v5 (locked, idle): `~/claude-work/p6/c5/probe/`.

---

## 1. c1 — the shape store

### 1.1 One reader, two outputs

`toolTableStore.ts` is the ONE reader of the page (today `ToolTablePanel` and `ToolStrip` each read on every ping). It owns `ToolTableReads`, sends the reads and composes ONE complete reply before anyone sees it (§1.8). Layers: `toolLibrary.ts` (the `SharedLibrary` of §1.5) lies UNDER the store; only the store fills it and merges from it, under its binding. A composed reply goes to two outputs; neither reads the other:

- **`currentRead`** — for the Tools tab, the strip and edits: exactly today's semantics. `{state: closed | reading | done, view, table, error}`; a failed or timed-out read gives the `failed` view (no rows, no identity), a superseded reply changes nothing, a closed connection clears it. The write notes (`toolWriteStands`) judge its identity as today. `ToolTablePanel` / `ToolStrip` import only this.
- **`shapeRecord`** (`toolShapeRecord.ts`) — the historical, bound evidence for shapes: identity, units, `rev.library`, the library (§1.5), `seen` (§1.3), and which rows the last good read proved. It is written only by an `ok` reply of the current epoch, never by a failed, timed-out, superseded or old-epoch one, and is never shown as a table and never an edit basis. The tab's modules import `currentRead` only (import scan). Its rows may reference the same frozen library object; that object is content bound to a revision, not a statement about the current table.

A read is sent on: a connection's open; `tool_table_changed`; an INI change; a panel's Retry or write; the rows a check still needs (§1.7, one read for all of them); one retry 1 s after a `partial` reply that leaves such a row unproven, at most two per ping.

### 1.2 What pairs

A publication's row for T is `parse_tlos`' raw zoffset and diameter (never `toolDimsFor`); the base tool's is `basis.toolNum`, `toolDiam` and the new `basis.toolTableZ` (status `tool_table_z`, in a run `run_basis.start`). It is **paired** when one `seen` row of T under the record's `(identity, units, rev.library)` differs by ≤ 1e-4 machine units in D and in Z. Otherwise it is today's cylinder, with the first reason that applies (≤ 60 characters):

| Case, in this order | Reason | Warns |
|---|---|---|
| no record of this epoch (no `ok` reply yet, `have_library` not resolved, closed) | `shape not read` | yes |
| the record's library holds T (or is known not to) and its entry has no geometry field | `no library shape` | no |
| D ≤ 0 and no native mesh / profile | `no diameter in the table` | yes |
| T is not proven in the last good read and no seen row matches | `tool row not confirmed by LinuxCNC` | yes |
| proven rows of T exist, none matches | `tool table changed since the preview` | yes |
| refused by §3.2 | `shape too detailed` / `shape not usable` | yes |

**`no library shape` is a proven absence**: the record's library is the complete one for its revision and T was a row of the reply that carried it. A missing `meta` without that proof is `shape not read`. T ≤ 0 and an unread line without a T attach to nothing. A tool without a length stays "own pairs not checked".

### 1.3 `seen` and its keys

Per T the **8** newest distinct raw rows `{D, Z}` (exact values, newest proof first; a re-proof moves a row up, the ninth drops the last; no ε merging). Rows hold raw values only; the metadata belongs to the library.

**Keys are freed.** After every `ok` reply (`complete` or `partial`) the keys kept are exactly: the T of its rows, the T of its proof's `missing` (LinuxCNC has them, the file does not), and the T a held decision needs (§1.4). Everything else goes at once. A failed, timed-out, superseded or `unchecked` reply adds and frees nothing. The record goes whole on close, identity, unit or library change (a library change refills from the same reply).

### 1.4 Decisions, and the ONE visible decision

A **decision** for a tool row is immutable: `{T, D, Z, visual length, body: "shape" | "envelope" | "table", why, numbers?}`. Its body numbers (≤ 260 bytes) are part of it.

**A check group** takes one decision per program tool and for the base tool when its first request is built, and every request of the group uses them: the provisional and the full run check, the retry with bodies, the entry move's and the run beginning's side sweeps. A group = (publication, run generation or idle, input generation). It lives as long as its request, its result or its context is held.

**What the page shows comes from one place:** the staged context (`colShown.context`, published with the contact tables). The **card**, the **scrub marker of a not-loaded tool** and the **side run** read ITS decisions.

**A context lives exactly as long as its request or its result** (behaviour change). Today it stays on the card after its result is gone: after an input change, a discarded run check, a failed sweep, a new publication, until the next check begins. From now on every path that removes the result drops the context in the same staged publication. The states without one:

| State | Card | Marker |
|---|---|---|
| request running, first slices (partial) | that request's context | its decisions |
| provisional result kept while the full run check runs (`keepShown`) | the group's context (both requests have the same decisions) | the same |
| parked, stopped, a late result | its context | its decisions |
| result removed: input change, new publication, sweep failed, cancelled by its owner, `_discardRunCheck` (connection, origin, run, idle), run not checked | "No check of the current state yet."; a run's `collisionPrevious` line stays as today, it names a verdict, not a basis | the publication's prospective decision |
| no check yet, or the simulation off on this device | the same words / no card | prospective |

The **prospective decision** belongs to the publication on screen. It is made from the record, refined as rows are proven, kept through a disconnect (no statement changes it) and gone with the publication. It claims nothing on the card.

So a new proof, a library change or a disconnect changes what is visible only together with the result it belongs to:

| Event | Held group (card, marker, side run) | New decisions |
|---|---|---|
| Connection closes; a read fails, times out, is superseded or `unchecked` | **idle result: unchanged.** A run check is discarded on a lost connection, as today: its group ends, card and marker go to the row above together. Card row of a kept one: "Tool shapes": `As read when the check started · not read now`. **No statement: no re-check, no marker change** | `shape not read` |
| Reconnect, read answered, every body of the group equal (exact numbers) | unchanged; "not read now" goes | as decided |
| Late proof, idle: a `table` decision could now be paired | the existing input-change path: result and context go in one publication (card "No check of the current state yet.", marker prospective), then the new group's context brings both | new group |
| Late proof in a RUN | unchanged to the run's end, side run included; then the end-of-run comparison | the next group |
| `rev.library` changes, a body of the group differs or is gone | idle: input change, as above. In a run: at its end, the card saying `· changed since` until then | new group |
| **KNOWN change of owner or units**: another `table.path` / `instance` in a reply, another INI in the status, other `viewer_init.units` | the group and its context END at once (no read needed): result gone, card "No check …", marker to the new prospective decision | `shape not read` until proven |
| Tool table row changes, same library | through the new publication, as today | pairs with its own row |
| New publication | old group and context end in that task | its own |
| M600 / tool change in a run | unchanged (per segment, as today) | the pinned publication's |
| Simulation off on this device | ended; no build, no wait | — |

"Not read" and "known change" are separate inputs of `sameCheckInputs`; only the second, or a decided body difference, is a change.

**The marker's states** (`__viewerDiag.getToolMarker().state`):
- `drawn` — the library shape;
- `body` — **the checked body itself**, rebuilt from the decision's numbers (≤ 2 560 facets): shown while a held decision's drawing is being built, or when it cannot be (evicted after a disconnect, metadata released). The card adds `· shown stepped` when it lasts longer than the build;
- `table` — the cylinder of a `table` decision.

A held decision therefore never needs the store to be drawn. The **live** marker stays on `st.tool_meta` (named exception).

### 1.5 The library: one immutable object per revision

`SharedLibrary` per `(identity, units, rev.library)`: `Map<T, ToolMeta>`, frozen, shared by the record, the tab's rows (by reference) and build jobs. A native mesh is converted ONCE, in counted steps, to its canonical arrays (`pos` f32, `idx` u32; §2.1) and the nested arrays are released. `ToolMeta.native_mesh` may be either form; `buildToolGeometries` (tab preview, live marker) takes both.

**Who needs an old library:** a body or drawing job in flight. A group whose bodies are built holds numbers, not metadata; a group still building holds its library until the last job ends. Nothing else: after a library change the old one is gone with its last job.

### 1.6 Memory, by kind

| Kind | Owner | Bound |
|---|---|---|
| seen rows | record | 8 per kept T (§1.3) × 2 numbers; 1 000 tools ≈ 128 kB + objects |
| library, canonical | record; a second one only while a job uses it | typed: 3.6 MB per maximum mesh; **64 MB per library**, meshes beyond it in T order are `shape too detailed` |
| the reply's nested arrays | the reply, until converted | **not bounded on the page** (the decode makes them at once): 52 MB of heap per maximum mesh, measured; released mesh by mesh |
| body numbers | decisions; a memo of 256 per library | ≤ 260 bytes each, memo ≤ 66 kB |
| waiting jobs | queue | references only; one entry per distinct tool of the publication on screen, plus the marker's |
| the running job | one | canonical ≤ 3.6 MB, body ≤ 1 kB, drawing ≤ 14.4 MB |
| drawings | cache | ≤ 32 entries; ≤ 64 MB without an owner; owned: the marker's (≤ 2) and private ones |
| `body` marker mesh | marker | ≤ 190 kB |
| live `tool_meta` | status (existing) | one nested mesh |

**Cache** (`toolShapeCache.ts`), drawings only. Key = content: `(identity, units, rev.library, T, D, visual length)`. Owners hold geometry: the marker and a marker being swapped in (`acquire` / `release`, once each); checks own nothing. LRU among entries without an owner that are not building. All 32 owned or building → a **private** entry, traced `viewer.shape_cache_full`.

**Liveness is a mark, not membership.** Every entry, in the map or private, carries `{alive, token}`. `alive` ends for a map entry when it is removed and has no owner, for a private one at its owner's release, for both with the scene. **A late result is published iff its entry is still `alive` with the job's token**; else it is disposed unread. A private entry can therefore finish, and a released one cannot. A marker swaps only when its wanted key is the finished entry's. On a library or identity change the entries no visible group references go at once, the others with their group; a known unit change or a cleared scene ends all. Geometries are `_shared`; their bounding sphere is set by the build (10–13 ms at 200 k triangles if left to three).

Jobs run one at a time: bodies a check waits for, then the marker's drawing, then the publication's program tools in order.

### 1.7 The wait before a check: one absolute deadline

When a check is first scheduled (idle: beside the drift wait, not after it; in a run: at admission), the rows it needs are looked up once. If some are unproven it sends ONE read for all of them and sets ONE deadline, **now + 3 s**, for this check. Pings, retries, further rows and further tools neither extend nor restart it. It ends early when every row is decided. At the deadline the missing ones are `table` with their reason. A new program generation, input generation, run generation or connection ends the wait and its deadline. No wait for a re-parse.

**Building the bodies is a second, named phase** (progress line "Tool shapes 3 of 8"), bounded by counted work (§3), not by the 3 s.

### 1.8 `have_library`

`get_tool_table {have_library?: rev}`. The gateway compares it with the revision of the library of THIS read and answers `library: {state: "same" | "full", rev}`; with `same` the rows carry only the table's fields.

- The page sends `have_library` only when its `SharedLibrary`'s identity and units are the ones it last knew; a reconnect keeps the object but not its authority.
- **The store resolves a `same` reply before it delivers it.** It is usable iff `rev`, `table.path`, `table.instance` AND units equal the object's and every row's T was a row of the full reply that filled it (a tool added later has no known entry). Then the delivered rows are the reply's table fields plus the object's metadata: the content a full reply would carry (the revision is the sha256 of it). Else NOTHING of it is delivered: the store sends one full read in its place (next ticket, same epoch), and the tab goes on reading as it does today, with its slow note, end and Retry. So the tab's types, descriptions and edit basis never come from another revision, and step 1 shows no difference. A mesh's array form is no edit field.
- **Omitted is not empty:** no `library` field (an older gateway) is a full reply; an unresolved `same` is no read at all for either output; until the full one answers a shape is `shape not read`, never "no library shape".
- A library that changes during a read cannot mix: revision and rows come from one object under `_cmd_lock` (merged, MT-I37).
- **Step 0:** `library_rev` once per `ToolLibraryStore` file state, not per read. Today every read computes it on the event loop: 76 ms worst loop gap for one maximum mesh, 72–74 ms in a thread (the GIL); 0.6 ms for the shipped library. The FIRST hash per file state, like `json.load`, stays one block: measured at the gates, not removed.
- Effect (probe): a `same` reply decodes in 0.7 ms (36 rows) / 4.4–4.8 ms (1 000 rows) against 24–26 ms per maximum mesh. The first full decode stays one task.

---

## 2. c2 — the body

### 2.1 One canonical float32 source

`toolDrawing(diam, len, meta, u)` returns what is drawn, in float32, and BOTH the drawing and the body are built from it:

- **mesh:** `{pos: Float32Array, idx: Uint32Array}`, every coordinate rounded once;
- **lathe:** per part `{prof: Float32Array [r, z]…, segments}`, every profile coordinate rounded once; the drawn vertex's z IS the profile's z (written after three's lathe, which otherwise leaves −r·6e-17), its x, y are r·sin φ, r·cos φ in f32.

`buildToolGeometries` draws it (the mesh bit-equal to today, 12 of 12; lathe coordinates move ≤ 6.1e-6 mm, one f32 step), so the tab's preview, the live marker, the cache and the body share one source. A coordinate that is not finite in f32, a negative radius or a bad index → `shape not usable`, when the shape is built. The library's own f64 values are not enclosed separately; they differ from the drawn ones by at most half an f32 step.

**Why this encloses.** Mesh: the drawn edges ARE the body's input edges, and every boundary is an f32 number, so each slab's required radius (a convex function's maximum over the facet's part in the slab: its ends and its crossings of both boundaries) is exact to f64. Lathe: a drawn ring or diagonal point at height z has radius ≤ the linear interpolation of its ends' radii (triangle inequality), the ends are the profile's to 2⁻²⁴ each. All remaining errors (f32 of ρ, of x, y, of the rebuilt corners: ≤ 3 × 2⁻²⁴) lie under the 2⁻²⁰ of §2.2. Axially there is no error left to absorb, which is what MT477-01 was.

∪ today's body: the BUILT triangles of `toolCylinderPositions` (f32).

### 2.2 Construction

1. Range `[min, max]` over the canonical coordinates and the built pin: f32 values themselves; nothing is rounded, padded or shortened.
2. K = min(32, ceil((range − 1 µm) / 5 mm)), × unit scale; the 1 µm enters only this count. Inner boundaries in f32.
3. Per slab the largest radius² of every edge's ends in the CLOSED slab and its crossing of each boundary it passes, on both sides of it (the touching rule of v4 and v5). Cost per edge 8 + boundaries crossed.
4. ρ = r / cos(π/20) × (1 + 2⁻²⁰), up to f32. Exactly equal neighbours merged, never near ones. A slab without input is bridged at D/2.
5. Numbers `{n: 20, z: Float32Array(M+1), rho: Float32Array(M)}`, ≤ 260 bytes.

### 2.2a Proposal, for Codex: the open-interval rule

With the canonical source there is no rounding between drawing and body, so a facet that only touches a slab's boundary need not widen that slab: a vertex on a boundary counts where its facet reaches into the open slab; a facet lying IN a boundary needs one of its two slabs, and what no neighbour covers raises the wider one at the end. **Why:** a shoulder on a multiple of 5 mm (every round flute or overall length) makes the next slab as wide as the shank: Ø3 on Ø6 is 10 mm too wide by 1.5 mm; 12 of 51 tools, 85 mm of length, up to 11 mm of radius on a face mill. **Evidence:** 0 red of 102, 8 and 15 368 (5.6 M witnesses), closed everywhere; the five programs of §4 give the same findings and the same coverage as with the touching rule. It is a change of the body agreed in R465, so it is decided by itself; if refused, step 3 stands. The measurements of §2.4 name the rule they used.

### 2.3 To the worker

`toolDims[T] = {diam, len, hull?}`, `tool = {diam, len, hull?}`. `makeToolVariant(diam, len, hull?)` rebuilds one closed mesh (≤ 2 560 facets) and makes BVH, boxes and closure as today. A malformed hull (lengths, order, finiteness, 3 ≤ n ≤ 64) throws: the check fails by name. `baseToolFor`'s key gains the exact numbers. The model key stays without a tool. `CheckBasis` gains `toolTableZ` and `shapes` (the group's decisions, with identity, units and library).

Probed (v5, patched copy of `collision.ts`): two tools, mesh and parametric, swapped at the tool change: the 8 rows of the two single-tool sweeps, unmatched 0, episode ends within 0.14 (MIN_ADV 0.25), touches within 0.001, in 1, 2 and 3 shards; base restored; 0 rows with pins.

### 2.4 Containment

**The judge** (`toolBody.test.ts`, brute force, tolerance 0, no code shared with the builder): numbers → transfer → the WORKER's rebuild → from the rebuilt mesh alone its z levels and side planes. Every triangle of what the CACHE draws and of the pin: vertices, all three edges × both planes of each slab, **and witnesses strictly inside, 1/8 and 1/2 ulp from either boundary**; the caps.

**Inputs.** (a) the 51 of v5 in mm and inch; (b) Codex's 8; (c) a generator around inner boundaries: 2 units × 4 lengths × boundaries 1, 2, middle, last × 17 offsets (−2 … +2 ulp, quarters included) × {mesh cone down / up, native profile down / up, form mill} × 2 radii × 2 slopes (a rim over a 0.01 mm rise makes an axial error 1 000 × radial), end-mill flute ends, chamfers, two boundaries at once, a lone disk in the boundary, shapes below the tip with boundaries near zero.

| | v5 | v6 |
|---|---|---|
| (a) 102 inputs outside / not closed / arealess facets | 0 / 0 / 0 | **0 / 0 / 0** (touching: 155 024 witnesses; open: 162 408) |
| (b) Codex's 8 | 4 red, worst 1.81e-4 mm | **0** |
| (c) generated | **1 678 red** of 15 368 | **0** (touching: of 14 824, 3.8 M witnesses, before the lone-disk cases; open: of 15 368, 5.6 M) |
| — of these: mesh / native profile / form mill | 634 / 568 / 476, worst 7.6e-3 mm | 0 |
| lathe sector builds (1, 5, 7 segments), 2 574 | — | **0** |

| Mutant (open rule) | 102 inputs | generated (every 7th, 2 196) |
|---|---|---|
| **body from the f64 source, drawing f32 (v5's fault)** | **0** | **91** |
| lathe z left as three rotates it | 44 | 50 |
| original vertices only | 70 | 894 |
| a crossing counted in one slab only | 14 | 506 |
| a boundary vertex lost above / below | 0 / 3 | 235 / 94 |
| a lone flat facet on a boundary lost | 0 | 38 |
| inscribed 20-gon | 98 | 2 118 |
| no union with the pin | 79 | 2 147 |
| range from 0 | 33 | 1 043 |
| 1 µm cut off the range | 102 | 2 196 |
| no 2⁻²⁰ | 7 | 58 |
| neighbours within 5 % merged | 18 | 170 |
| wire (v5, mm / inch of 51): rounded to 3 decimals; n = 12; last slab lost; ρ as the apothem | 39 / 49; 50 / 50; 21 of 21 / 23 of 23; 49 / 49 | — |

The rows with 0 are why the generator is part of the product guard: the 102 inputs do not see v5's fault. Every listed mutant is red somewhere; with the touching rule a boundary vertex counted on one side only is NOT distinguishable (other edges carry it). These runs are evidence for the inputs listed, and the argument of §2.1 is the reason; neither is a proof over all libraries.

### 2.5 Acceptance (sweep level)

On top of the mute-rule package. Pair and stretch coverage (episodes ± 0.25, touches ± 2e-3), shown and twin, through `makeToolVariant` / `installToolVariant` in a real worker: a parametric, a profile and a mesh tool, mm and inch, a tool change, 1 and 3 shards, a side run. Every stretch of the drawn reference **and of today's pin, tool × stock included** (the 6.2 mm and 5.0 mm cases of the mute package run with the body too). Compared: gaps, truncation, notes, `insideClosed`. A non-round mesh's reference is its rotating envelope, never the mesh at rest (§4: resting lug 0 findings, the spinning tool hits).

---

## 3. Work bounds

### 3.1 Measured (VM, Node 22, cold, 4 ms slices, 3 repeats; `timing6.locked.jsonl`, under the lock)

| Case | v4 builder, one task | canonical, steps | body, steps | drawing, steps (today: one task) | longest task: nested arrays alive / released |
|---|---|---|---|---|---|
| 200 k triangles, fine | 45–48 ms | 7.1–7.4 ms | 32–40 ms | 5.8–6.6 ms (31–44) | 6.9 / 4.3 ms |
| Codex: 40 002 v / 80 000 t, all 32 slabs | 152–159 | 4.6–5.9 | 22–27 | 4.4–5.1 (19–21) | 5.3 / 4.3 |
| cylinder at the limit, 199 996 t | 351–366 | 7.0–7.9 | 48–59 | 6.2–6.8 (42–49) | **10.3** / 4.3 |
| worst importable, 200 k t each over 32 slabs | 650–684 | 6.8–7.6 | 68–90 | 6.1–6.6 (40–42) | 9.5 / 4.3 |
| 40 new tools at once (those 4 + the 36 shipped; bodies, the 4 meshes' drawings, not the shipped lathes') | — | — | 225–229 ms in 92–94 tasks | | 9.7 / — |

Operations between two yields: ≤ 4 170 (budget 4 096 + one triangle). The spikes over the 4 ms slice were the collector on the nested arrays: with them released (and collected between the phases, in the probe by force) no task passes 4.4 ms. The collection itself then falls at a moment the collector picks.

**Lathe drawing with the z rewrite: timed only beside heavy load** (load average 6 on 6 cores, `lathe6.unlocked.jsonl`; the lock was taken): sectors of 4 096 vertices max 11.1–11.6 ms a task, of 1 024 max 5.5–6.0 (a 2 000-point profile, where one column is 4 000 vertices: 9.6), 40 tools with all drawings max 11.5. v5 under the lock, without the rewrite: 6.1–7.2 at 4 096. Hence 1 024; a locked repeat is owed.

**Heap.** One maximum mesh: nested 52.0 MB, 300 000 small arrays; canonical 3.6 MB. A full GC with it alive: 19–25 ms against 2.3–3.0 ms.

**Goal, not a claim:** no task over 16 ms for canonical form, body and drawing of any admitted shape. Shown in Node on this VM, locked: 10.3 ms with the nested arrays alive. Owed: browser (Chromium, Firefox) with GPU upload and the first frame, and the N100. The first full decode (24–26 ms per maximum mesh, with the library's total triangles) and the gateway's first hash are outside it. Fallback if the N100 fails: the same three jobs in a worker (canonical arrays are transferable; the page then keeps 7 ms of packing).

### 3.2 Input bounds, before any build, on the client

Mesh ≤ 100 000 vertices, ≤ 200 000 triangles; library ≤ 64 MB canonical; profile ≤ 2 048 predicted points (shipped maximum 51; a second copy of the arc-step formula, so a guard holds predicted ≥ produced; one column of a lathe is the smallest step, so the points bound it); lathe ≤ 400 000 vertices. Above: `shape too detailed` → cylinder for body and marker, named. Steps: `runSteps(sliceMs: 4)`, budget 4 096; counted: 4 per vertex and triangle converted, 1 per z scanned, 8 + crossings per edge (the pin's too), 24 per drawn triangle, a lathe sector of ≤ 1 024 vertices per step, at least one column. One `buildToolProfile` (≤ 4.2 ms at 11 600 points) and single allocations are not split.

---

## 4. What the operator sees

**Check basis card**, per tool, start tool included: `T13 · L 63.210 · Ø 1.875 mm · shape, Ø max 8.00` / `… · envelope, Ø max 24.00` (an imported mesh: all round, as it spins) / `… · table Ø — tool table changed since the preview`. One row for all: `Tool shapes: As read when the check started` (`· not read now` / `· changed since`). The note: "Shape: a stepped body around the library shape, at least the table Ø over the table length + 20 mm. Table Ø: that cylinder alone (no diameter: a 6 mm stub). Holders are not modeled." A tool whose shape could not be used adds a result note, shown as the Sim tab's caveat; a proven `no library shape` adds none. The scrub marker shows the same decision (§1.4).

**Counts** (real chain, synthetic scene; the findings are the same with the v5 body, the canonical body with the touching rule and with the open rule; to be run again on the mute package):

| | pin today | body | drawn |
|---|---|---|---|
| T13 D 1.875, relief beside two clamps | 0 | 3 near | 3 near |
| T13 at the old D 8 | 6 + 16 near | 12 + 16 near | 10 + 17 near |
| Ø3 on a Ø6 shank | 0 | 2 near | 2 near |
| native profile with a collar | 0 | 4 near | 4 near |
| native mesh with a lug (envelope) | 0 | 2 + 2 near | 0 (lug at rest) |

Coverage: 0 stretches of the drawn shape and 0 of the pin missed in all five.

**Cost: about 3 × the sweep time of this scene.** Interleaved in one process, 9 repeats, locked (pin / touching / open): Ø3 on Ø6 160 / 448 / 182 ms; mesh 161 / 468 / 214; profile 164 / 467 / 466. T13 (3 repeats, beside heavy load, ratios only): 2.9 / 3.3 ×; at D 8 3.0 / 3.0 ×; v5 locked: 3.1 ×. The two low values are stable but not explained: the mesh's two bodies have the same facets, samples and findings and differ only at z 40–45, far from the scene; a different BVH split is my guess, not a finding. So 3 × is the figure to state. BVH build of the machine unchanged. N100: not measured.

---

## 5. Guards, mutations, files, order

### 5.1 Guards and what must turn them red

| Rule | Guard | Red on |
|---|---|---|
| 1.1 two outputs | `toolTableStore.test.ts`: good read → failure / timeout / superseded in the same epoch: `currentRead` = failed view, no identity; record unchanged. `tool-table-read.spec`, `tool-edit.spec` unchanged. Import scan | the last good view kept as current; the record written by a failed read; a panel importing the record |
| 1.2 pairing | `toolShapeRecord.test.ts`, tables | D only; ε = 0; `toolDimsFor`; an unproven row; other revision / instance / units; T ≤ 0; **`no library shape` before the first read, or from an omitted library; a proven empty entry that warns** |
| 1.3 keys | five successive tables with other T; `partial`; failed reads | keys not freed; freed on a failed read; `missing` freed; a needed T freed; ninth row kept; ε merge |
| 1.4 one decision | **browser, flow A:** result with a shape → disconnect → reconnect; **flow B:** run check at the timeout cylinder → late proof → scrub over that tool change, and the side run. Each step reads the marker's OWN geometry AND the card's row. Units: `sameCheckInputs`; known unit / INI / instance change | marker from the publication's decision; a disconnect that changes marker or card; a re-check for "not read"; no end on a known unit change; a side run with new decisions; a context left on the card after its result (input change, discarded run check, failed sweep, new publication); a `body` state that is the cylinder |
| 1.5, 1.6 memory | eight Z corrections of one large shape: ONE library object, nested arrays released (weak reference); an ended holder releases its library; per-kind counters at their bound | meta per row; a library kept by a finished group; 64 MB (both) not kept |
| 1.6 cache | `toolShapeCache.test.ts` (hand-driven scheduler): the private 33rd entry COMPLETES; its late result after release is disposed; owned entries never evicted; one dispose | membership as the condition; a released private entry published; an ended scene's result inserted |
| 1.7 deadline | fake clock: several missing rows, pings and retries inside the 3 s; drift wait beside it; another generation / connection | serial waits; a restart by ping or retry; a second read per row; a wait after its check ended |
| 1.8 `have_library` | store + pytest: `same` / `full`; reconnect; other instance; other units; a new T; a lost object; revision changed between request and read; older gateway | an unresolved `same` delivered; a composed reply that is not deep-equal to a full one of the same state; `same` accepted over another identity or units; a missing T filled from nothing; an omitted library read as empty; a second full read in a loop |
| step 0 | pytest: n reads of one file state compute the revision once; a same-size rewrite computes it anew | per read; stale |
| 2.1, 2.4 body | `toolBody.test.ts`: (a), (b), (c) on the CACHE's output; witnesses | every mutant of §2.4; a drawing from another source than the body |
| 2.1 faults | 1e39, NaN, −r, bad index → `shape not usable` at the build | a body from it; a worker error |
| 2.3 transfer | `collisionWorker.test.ts`: base, program tool, shard, side run, malformed hull | hull dropped in any of them; cache key without it; a silent cylinder |
| 2.5 | coverage file; a clamp 3.0 mm from the pass (pin 0, body near miss) | `_programToolDims` without the hull |
| 3.2 | operations between yields ≤ 4 096 + 117; sector ≤ 1 024 vertices or one column; one case above each bound; predicted ≥ produced | an uncounted scan; the pin in one step; no bound |
| 4 | `checkContext.test.ts`, `sim-panel.viewer.spec` | a missing word or caveat; a caveat for a proven absence |

Durations are traced, not gated: `viewer.shape_build {tool, phase, tris, ops, tasks, max_task_ms, total_ms}`.

### 5.2 Files

New: `toolTableStore.ts`, `toolLibrary.ts`, `toolShapeRecord.ts`, `toolShapeCache.ts`, `viewer/toolBody.ts` + tests, `e2e/tool-shape-sim.viewer.spec.ts`. Changed: `toolGeometry.ts` (`toolDrawing`, canonical draw; `toolSimulationGeometry` / `freecadGeometry` tests checked against the ≤ 6.1e-6 mm move), `ToolTablePanel.vue`, `ToolStrip.vue`, `ThreeViewer.vue`, `viewer/collision.ts`, `viewer/collisionWorker.ts`, `viewer/checkBasis.ts`, `viewer/checkContext.ts`, `lcnc.ts` (`get_tool_table` field), `command_policy.py` (bounded field), `gateway.py`, `tool_store.py`, `e2e/mock-gateway.mjs`.

`rules.py`: `toolTableStore.ts`, `toolLibrary.ts`, `toolShapeRecord.ts` join the `ToolTablePanel` rule (TOOLS) plus VIEWER; `toolShapeCache.ts` a new rule (VIEWER, `tool-shape-sim.viewer`); `viewer/toolBody.ts` is under `viewer/**`. `toolBody.test.ts` reads `examples/sim_config/xyz3/tool.seed.json` and `tool.tbl`, and its generator took about 10 s in plain Node: it goes into `HEAVY_UNIT` by the measured threshold (or is split into a light file with (a), (b) and a thinned generator, and a heavy one), with its `READ_SITES` entry (`examples/sim_config/xyz3/**`); the coverage file the same. Inventory: regenerate (new command field, trace). Docs: `collision.md`, `machine-model.md`, `frontend-modules.md`, CLAUDE.md lines, `docs/decisions.md`.

### 5.3 Order

0. Gateway: one revision per file state, `have_library`. 1. Store with two outputs, panels moved, no visible change. 2. Record, keys, decisions (pure). 3. Canonical `toolDrawing`, steps, cache, marker, one visible decision; the browser spec red at `24f3bd3a` first. **Bell 1 (c1).** 4. `toolBody.ts` + guard. 5. Worker, groups, deadline, card, notes. **On the merged mute package:** 6. coverage, counts again, mutations, docs. **Bell 2 (c2).**

### 5.4 Native

One case (native stage, real LinuxCNC and gateway, page in Chromium): a program whose M600 measures a tool never loaded on the page. The run check on the mid-run publication says `shape` for it inside the deadline, marker and card agree.

---

## 6. Limits and owed

- **At the machine (N100):** sweep time with shapes against the pin; `max_task_ms`; first decode and first hash with the machine's library; T13 after a library refresh (its entry is from May, without `tapered_type`).
- **Before the bells:** browser times with GPU upload and first frame; the real worker, a side run, an inch sweep, the native case.
- **Not proven offline:** everything in 1.1–1.8 is contract, no implementation exists. The tool swap, shards and the wire mutants ran with the v5 body only; counts come from one synthetic scene and the body from `buildCollisionModel(…).baseTool`; the operator's machine model was not read.
- **Coarser by design:** a body of revolution in ≤ 32 steps; holders not modeled; a shank in the stock on a feed counts as cutting, as today. Random toolchanger, tool database, older gateway: `table Ø`, named. A library edited by hand is seen at the next read.
- **Outside:** the live marker's one-task geometry build and nested `tool_meta`.

## 7. For Codex

(1) §2.1: the canonical source also for lathes: v5 failed there too (568 native-profile and 476 form-mill cases), so your answer to Q1, given for the mesh branch, holds for the method but not for its rounding — agreed, and the f64 library values not enclosed separately? (1a) §2.2a: the open-interval rule? (2) §1.4: the staged context as the one visible owner, dropped with its result (a visible change of the card), and the checked body as the named transition — enough for MT477-02? (3) §1.3: keys freed by `rows ∪ missing ∪ needed` after a `partial` too? (4) §1.6: 64 MB canonical per library as the named bound?

No operator question from this plan; Q477-1 belongs to the mute-rule package.

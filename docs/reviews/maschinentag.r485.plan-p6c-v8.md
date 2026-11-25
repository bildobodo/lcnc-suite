# P6-c (machine-day F8) — plan v8: the shape store (c1) and the collision body (c2)

**State.** Code sites at development `24f3bd3a` (worktree `/home/cnc/lcnc-suite-p6c`, branch `feat/p6c`). Plan and scratch probes only; no product code, nothing pushed. v8 answers Codex R482 and replaces v7. Accepted and not re-opened: everything of v7 but the drawing's byte balance (MT482-01): the quarter turn, the field table and the refusal records, the touching rule, the build order, and the points accepted in R480. From before: the closed stepped body (Q5), acceptance by pair and stretch, rule R and `_read_tool_files`, "unpaired or no library row = today's cylinder".

**Dependency.** c2 is accepted only on top of the mute-rule package (`feat/stock-mute`, planned separately; Codex R477, Q2). v5's stock exception is gone: the acceptance of §2.5 covers tool × stock like every pair. c1 and the body's construction do not depend on it.

## Changes against v7

1. **MT482-01 (§1.6, 2.1, 3.2).** v7's 14.4 MB held for a mesh only. The balance is now derived per geometry kind from the attributes kept, the cache counts the real buffers, and UVs are not made. The lathe is written column by column into its preallocated arrays: no sector geometries beside them. Codex's admissible 600-point lathe: 14 747 712 bytes returned, 14 757 312 held at the peak of the build (v7's builder: 31.7 MB); the input is not reduced and the old 14.4 MB is red on it.
2. **Answers 1–4.** `same` decides by an explicit list of six names ("form payload fields"); Bell 1 merged alone has its own merge gate; a refused holder carries its own note and stays out of the body; one `quarterTurn` for the holder too.

**Probes.** New: `~/claude-work/p6/c8/probe/lathe8.ts` (unlocked, beside Codex's load: bytes and bit-equality only, no times). v7's in `~/claude-work/p6/c7/probe/`: `timing7.locked.jsonl` (§3.1) and `inter7.locked.out` (§4) locked, but at a load average of 2.5–2.9 on 6 cores; all geometry, mutants, extents, findings and coverage unlocked (load does not change them). Codex's own repetition in R482 (102, 15 428, 60 rings, extents) agrees.

---

## 1. c1 — the shape store

### 1.1 One reader, two outputs

`toolTableStore.ts` is the ONE reader of the page (today `ToolTablePanel` and `ToolStrip` each read on every ping). It owns `ToolTableReads`, sends the reads and composes ONE complete reply before anyone sees it (§1.8). `toolLibrary.ts` (the form library of §1.5) lies UNDER the store; only the store fills it, under its binding. A composed reply goes to two outputs; neither reads the other:

- **`currentRead`** — for the Tools tab, the strip and edits: exactly today's semantics. `{state: closed | reading | done, view, table, error}`; a failed or timed-out read gives the `failed` view (no rows, no identity), a superseded reply changes nothing, a closed connection clears it. The write notes (`toolWriteStands`) judge its identity as today. `ToolTablePanel` / `ToolStrip` import only this.
- **`shapeRecord`** (`toolShapeRecord.ts`) — the historical, bound evidence for shapes: identity, units, `rev.library`, the library (§1.5), `seen` (§1.3), and which rows the last good read proved. It is written only by an `ok` reply of the current epoch, never by a failed, timed-out, superseded or old-epoch one, and is never shown as a table and never an edit basis. The tab's modules import `currentRead` only (import scan). Its rows may reference the same frozen form records; a record is content bound to a revision, not a statement about the current table.

A read is sent on: a connection's open; `tool_table_changed`; an INI change; a panel's Retry or write; the rows a check still needs (§1.7, one read for all of them); one retry 1 s after a `partial` reply that leaves such a row unproven, at most two per ping.

### 1.2 What pairs

A publication's row for T is `parse_tlos`' raw zoffset and diameter (never `toolDimsFor`); the base tool's is `basis.toolNum`, `toolDiam` and the new `basis.toolTableZ` (status `tool_table_z`, in a run `run_basis.start`). It is **paired** when one `seen` row of T under the record's `(identity, units, rev.library)` differs by ≤ 1e-4 machine units in D and in Z. Otherwise it is today's cylinder, with the first reason that applies (≤ 60 characters):

| Case, in this order | Reason | Warns |
|---|---|---|
| no record of this epoch (no `ok` reply yet, `have_library` not resolved, closed) | `shape not read` | yes |
| T's row in an `ok` reply carries no geometry field and its form record is `none` | `no library shape` | no |
| D ≤ 0 and no native mesh / profile | `no diameter in the table` | yes |
| T is not proven in the last good read and no seen row matches | `tool row not confirmed by LinuxCNC` | yes |
| proven rows of T exist, none matches | `tool table changed since the preview` | yes |
| refused by §3.2 | `shape too detailed` / `shape not usable` | yes |

**`no library shape` is a proven absence**: the row of T came in an `ok` reply, its scalars name no shape, and its form record says `none`. A missing or pending form record is `shape not read`; a refused one stays `shape too detailed` / `shape not usable`. T ≤ 0 and an unread line without a T attach to nothing. A tool without a length stays "own pairs not checked".

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

A group that has not posted its request yet re-decides when the library, the identity or the units change; a posted group has its numbers (§1.5).

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

### 1.5 Forms: normalised once, refused once

A reply's rows are never handed on as decoded. The store builds the row objects of `currentRead` from the scalar and text fields at once, and gives every row a **form record** per T of the binding `(identity, units, rev.library)`. The decoded geometry belongs to the store's normaliser alone; T by T, in counted steps, sizes checked first (lengths, before any element is read), it makes the record and drops the decoded lists of that T.

| Field of the reply | After normalisation | Counted |
|---|---|---|
| `native_mesh` | `pos` f32, `idx` u32; ≤ 100 000 vertices, ≤ 200 000 triangles | 12 B per vertex + 12 B per triangle |
| `native_profile` | f32 `[r, z]`; ≤ 2 048 points | 8 B per point |
| `profile` (form mill) | f64 `[ex, ey, arc, ccw, cx, cy]`; ≤ 512 segments and ≤ 2 048 predicted points | 48 B per segment |
| `shaft_segments` | f64 `[h, d0, d1]`; ≤ 64 | 24 B per segment |
| `holder_segments` | f64; ≤ 64. Above or invalid: the HOLDER alone is refused, with its own note in the preview ("Holder too detailed to draw" / "Holder not usable"); the tool's shape is judged without it, and it is never part of the collision body | 24 B per segment |
| `type` and the other shape words, the shape numbers (`oal` … `thread_*`) | in the row as they came; the record holds one frozen copy: numbers finite or null, words ≤ 64 characters, else `shape not usable` | 1 kB per T, flat |
| `geometry_note` | cut at 1 024 characters with "…" (a note, no edit field) | 2 B per character |
| `source_metadata`, `source_id`, `fusion_guid` | dropped: no client code reads them (checked) | 0 |
| table and edit fields (P, D, Z, remark, description, material, …) | whole, in the row, from the reply itself | as today: one copy, not P6's |

The branch that is drawn is the one kept (mesh before native profile before the type's own, `buildToolGeometries`' order); the lists of the others go with the raw ones. A record is one of `none` · `param` · `mesh` · `profile` · `segments` · **`refused {why, field, size}`** (≤ 128 B). The library's records are summed in ascending T; a record that would pass **64 MB** is refused in its turn. So:

- **A refusal is content.** The refused lists are gone from every reference: rows, record, library, queue. `shape too detailed` never becomes `no library shape`; the tab's preview says "Shape too detailed to draw" (today it draws it: a named change above the bounds); nothing is read again for it.
- **Raw geometry is kept until normalisation only**, and only by the normaliser's list of T not yet done. A newer reply, another binding or a close cancels it and drops the rest.
- A record not normalised yet is `pending`: `shape not read` for a decision, "Loading shape" in the preview. It belongs to the second, counted phase of §1.7, not to the 3 s.
- The live status's `tool_meta` stays one raw copy (existing, named).

**Who may hold a record:** the library, the rows of `currentRead`, an open edit dialog (its one row) and a queued or running job, by reference. A change of library, identity or units, or a close, drops EVERY waiting job and cancels the running one at its next yield; a group not yet posted re-decides, a posted one has numbers, a held decision without a drawing shows its `body` (§1.4). **No owner ever needs an old library**: at most one library's records are reachable, plus an open dialog's one row and the running job's until its next yield, whatever the number of changes.

### 1.6 Memory, by kind

| Kind | Owner | Bound |
|---|---|---|
| seen rows | record | 8 per kept T (§1.3) × 2 numbers; 1 000 tools ≈ 128 kB + objects |
| form records | library | **64 MB per library, every form field counted** as in §1.5; one library |
| row scalars and text | `currentRead` | as today, one copy of the newest read |
| the decoded reply | the store, until normalised | **not bounded on the page** (the decode makes it at once); 52 MB of heap per maximum mesh, measured; released T by T |
| body numbers | decisions; a memo of 256 per library | ≤ 260 bytes each, memo ≤ 66 kB |
| waiting jobs | queue | references only; one per distinct tool of the publication on screen plus the marker's; emptied on any binding change |
| the running job | one | canonical ≤ 3.6 MB; body ≤ 1 kB; a drawing ≤ **19.2 MB** held at the peak (below), plus its meridian normals ≤ 33 kB per part |
| drawings | cache | ≤ 32 entries; ≤ 64 MB **of real buffers** without an owner; owned: the marker's (≤ 2) and private ones, ≤ 19.2 MB each |
| `body` marker mesh | marker | ≤ 190 kB |
| live `tool_meta` | status (existing) | one raw copy |

**A drawing's bytes, by kind** (attributes kept: position and normal, f32 × 3 each; lathe also an index; **no UVs**: no material of the tool has a map, no code of the page reads a tool's UV, three's lathe made them):

| Kind | Formula | Bound |
|---|---|---|
| mesh, not indexed, flat normals | 72 B per triangle | 200 000 → 14.4 MB |
| lathe, indexed | 24 V + 4 I (2 I below 65 536 vertices); per part V = (segments + 1) × points, I = 6 × segments × (points − 1) < 6 V | **400 000 vertices over ALL parts of the drawing, seam columns included** → ≤ 48 × 400 000 = **19.2 MB** |

The admission computes V from points and segments before anything is allocated. The **cache counts the real buffers**: the `byteLength` of every attribute's and the index's ArrayBuffer, a shared one once, read off the finished geometry; never an estimate.

**What drops a reference.** `BufferGeometry.dispose()` only tells the renderer to free the GPU copy; the CPU arrays live as long as someone holds the geometry (probed: still there after `dispose`). So an entry's end is: `dispose()`, then the entry's `geometry` fields set to null and the entry out of the map; the marker's mesh is removed from the scene and its reference dropped; a job's arrays belong to its generator alone, which `cancel` returns and the queue forgets. No second owner keeps a typed array.

**Cache** (`toolShapeCache.ts`), drawings only. Key = content: `(identity, units, rev.library, T, D, visual length)`. Owners hold geometry: the marker and a marker being swapped in (`acquire` / `release`, once each); checks own nothing. LRU among entries without an owner that are not building. All 32 owned or building → a **private** entry, traced `viewer.shape_cache_full`.

**Liveness is a mark, not membership.** Every entry, in the map or private, carries `{alive, token}`. `alive` ends for a map entry when it is removed and has no owner, for a private one at its owner's release, for both with the scene. **A late result is published iff its entry is still `alive` with the job's token**; else it is disposed unread. A marker swaps only when its wanted key is the finished entry's. On a library or identity change the entries no visible group references go at once, the others with their group; a known unit change or a cleared scene ends all. Geometries are `_shared`; their bounding sphere is set by the build (10–13 ms at 200 k triangles if left to three).

Jobs run one at a time: normalisation, bodies a check waits for, the marker's drawing, the publication's program tools in order.

### 1.7 The wait before a check: one absolute deadline

When a check is first scheduled (idle: beside the drift wait, not after it; in a run: at admission), the rows it needs are looked up once. If some are unproven it sends ONE read for all of them and sets ONE deadline, **now + 3 s**, for this check. Pings, retries, further rows and further tools neither extend nor restart it. It ends early when every row is decided. At the deadline the missing ones are `table` with their reason. A new program generation, input generation, run generation or connection ends the wait and its deadline. No wait for a re-parse.

**Building the bodies is a second, named phase** (progress line "Tool shapes 3 of 8"), bounded by counted work (§3), not by the 3 s.

### 1.8 `have_library`

`get_tool_table {have_library?: rev}`. The gateway compares it with the revision of the library of THIS read and answers `library: {state: "same" | "full", rev}`. With `same` the rows leave out exactly the **six form payload fields**, by name (`FORM_PAYLOAD_FIELDS`: `native_mesh`, `native_profile`, `profile`, `shaft_segments`, `holder_segments`, `source_metadata`; two of them are objects, so never by `Array.isArray` / `list`); **every scalar and text field is always sent** (a description falls back to the row's remark, `_merge_tool_data`, so it may change while the library does not). No edit field ever comes from a cache.

- The page sends `have_library` only when its library's identity and units are the ones it last knew.
- **The store resolves a `same` reply before it delivers it.** Usable iff `rev`, `table.path`, `table.instance` AND units equal the library's and every row's T has a record (made from a full reply; `refused` and `none` are records). Then the rows take those records. Else NOTHING of it is delivered: one full read in its place (next ticket, same epoch); the tab goes on reading as today. A refused shape is not a reason to read again.
- **`full` and `same` give the same result:** the same rows and records, deep-equal.
- **Omitted is not empty:** no `library` field (an older gateway) is a full reply; an unresolved `same` is no read for either output.
- A library that changes during a read cannot mix: revision and rows come from one object under `_cmd_lock` (merged, MT-I37).
- **Step 0:** `library_rev` once per `ToolLibraryStore` file state, not per read. Today: 76 ms worst loop gap per read for one maximum mesh, 72–74 ms in a thread (the GIL); 0.6 ms for the shipped library. The FIRST hash per file state, like `json.load`, stays one block.
- Effect (probe, cold, unlocked): a `same` reply decodes in 3.1–3.5 ms (36 rows) and 9–11 ms (1 000 rows), a full one without meshes in 2.8–4.3 ms, against 24–26 ms per maximum mesh. The first full decode stays one task.

---

## 2. c2 — the body

### 2.1 One canonical float32 source

`toolDrawing(diam, len, meta, u)` returns what is drawn, in float32, and BOTH the drawing and the body are built from it:

- **mesh:** `{pos: Float32Array, idx: Uint32Array}`, every coordinate rounded once;
- **lathe:** per part `{prof: Float32Array [r, z]…, segments}`, every profile coordinate rounded once. `latheColumns` writes three's lathe itself, column by column, into arrays preallocated from points × segments: three's `(r·sin φ, z, r·cos φ)` with the quarter turn as the EXACT signed swap `(x, y, z) → (x, −z, y)`, positions and normals alike, three's meridian normals and index. So the drawn z IS the profile's z, and x, y are the rounded radial coordinates alone. Probed on 148 lathe parts (mm and inch): positions, normals and index EQUAL to three's `LatheGeometry` followed by the swap, value for value. One function, run to its end (tab preview, live marker, holder: `buildToolGeometry`, `buildHolderGeometry`) or in steps (cache): one seam column, no sector duplicates, no intermediate geometry. Today's `rotateX(π/2)` mixes the axial value into y by `y·cos(π/2)`.

`buildToolGeometries` draws it (the mesh bit-equal to today, 12 of 12; lathe coordinates move ≤ 6.1e-6 mm on the 90 lathes, one f32 step), so the tab's preview, the live marker, the cache and the body share one source. A coordinate that is not finite in f32, a negative radius or a bad index → `shape not usable`, when the shape is built. The library's own f64 values are not enclosed separately; they differ from the drawn ones by at most half an f32 step.

**Why this encloses.** Mesh: the drawn edges ARE the body's input edges, and every boundary is an f32 number, so each slab's required radius (a convex function's maximum over the facet's part in the slab: its ends and its crossings of both boundaries) is exact to f64. Lathe: a drawn ring or diagonal point at height z has radius ≤ the linear interpolation of its ends' radii (triangle inequality), the ends are the profile's to 2⁻²⁴ each. All remaining errors are RELATIVE to a radius (f32 of ρ, of x, y, of the rebuilt corners: ≤ 3 × 2⁻²⁴) or f64 (a crossing's error is ≤ 2⁻⁵² of the edge's larger end, and every slab the edge meets holds a point of it at ≥ 1/65 of that radius: at most 32 slabs), under the 2⁻²⁰ of §2.2. Axially there is no error left to absorb, which is what MT477-01 was.

∪ today's body: the BUILT triangles of `toolCylinderPositions` (f32).

### 2.2 Construction

1. Range `[min, max]` over the canonical coordinates and the built pin: f32 values themselves; nothing is rounded, padded or shortened.
2. K = min(32, ceil((range − 1 µm) / 5 mm)), × unit scale; the 1 µm enters only this count. Inner boundaries in f32.
3. Per slab the largest radius² of every edge's ends in the CLOSED slab and its crossing of each boundary it passes, on both sides of it (the touching rule agreed in R465), for EVERY facet or profile segment alike: one that lies in a boundary plane widens both neighbours. Cost per edge 8 + boundaries crossed.
4. ρ = r / cos(π/20) × (1 + 2⁻²⁰), up to f32. Exactly equal neighbours merged, never near ones. A slab without input is bridged at D/2.
5. Numbers `{n: 20, z: Float32Array(M+1), rho: Float32Array(M)}`, ≤ 260 bytes.

### 2.3 To the worker

`toolDims[T] = {diam, len, hull?}`, `tool = {diam, len, hull?}`. `makeToolVariant(diam, len, hull?)` rebuilds one closed mesh (≤ 2 560 facets) and makes BVH, boxes and closure as today. A malformed hull (lengths, order, finiteness, 3 ≤ n ≤ 64) throws: the check fails by name. `baseToolFor`'s key gains the exact numbers. The model key stays without a tool. `CheckBasis` gains `toolTableZ` and `shapes` (the group's decisions, with identity, units and library).

Probed (v5, patched copy of `collision.ts`): two tools, mesh and parametric, swapped at the tool change: the 8 rows of the two single-tool sweeps, unmatched 0, episode ends within 0.14 (MIN_ADV 0.25), touches within 0.001, in 1, 2 and 3 shards; base restored; 0 rows with pins.

### 2.4 Containment

**The judge** (`toolBody.test.ts`, brute force, tolerance 0, no code shared with the builder): numbers → transfer → the WORKER's rebuild → from the rebuilt mesh alone its z levels and side planes. Every triangle of what the CACHE draws and of the pin: vertices, all three edges × both planes of each slab, **and witnesses strictly inside, 1/8 and 1/2 ulp from either boundary**; the caps.

**Inputs.** (a) the 51 of v5 in mm and inch; (b) Codex's 8 (R477); (c) a generator around inner boundaries: 2 units × 4 lengths × boundaries 1, 2, middle, last × 17 offsets (−2 … +2 ulp, quarters included) × {mesh cone down / up, native profile down / up, form mill} × 2 radii × 2 slopes, end-mill flute ends, chamfers, two boundaries at once, a lone disk in the boundary, shapes below the tip with boundaries near zero; (d) Codex's R480 rings: r 1e-9 … 10 × z 80 … 1e12, mm and inch (60; his two among them).

| | v5 | v7 |
|---|---|---|
| (a) 102: outside / not closed / arealess facets | 0 / 0 / 0 | **0 / 0 / 0** (155 024 witnesses) |
| (b) 8 | 4 red | **0** |
| (c) + (d) 15 428 | **1 700 red** | **0** (3 810 400 witnesses) |
| (d) alone, 60: today's rotation / v6's z patch / exact swap | 22 red / 22 red / — | **0** |
| lathe sector builds (1, 5, 7 segments; v7's builder) | — | **0 of 2 703** |

| Mutant | 102 inputs | generated (every 7th, 2 204) | other guard |
|---|---|---|---|
| **body from the f64 source, drawing f32 (v5's fault)** | **0** | **97** | |
| lathe rotated as today | 44 | 50 | rings 22 of 60 |
| rotated, z patched (v6) | 0 | 1 | **rings 22 of 60** |
| original vertices only | 68 | 839 | |
| a crossing counted in one slab only | 14 | 508 | |
| inscribed 20-gon | 98 | 2 125 | |
| no union with the pin | 79 | 2 148 | |
| range from 0 | 33 | 1 042 | |
| 1 µm cut off the range | 102 | 2 201 | |
| no 2⁻²⁰ | 7 | 60 | |
| neighbours within 5 % merged | 18 | 176 | |
| **a flat facet widens one neighbour only (v6's scratch)** | 0 | 0 | **extent: red for disk and flat profile** |
| wire (v5 body, mm / inch of 51): rounded to 3 decimals; n = 12; last slab lost; ρ as the apothem | 39 / 49; 50 / 50; 21 of 21 / 23 of 23; 49 / 49 | — | |

**The extent guard** (containment cannot tell two admissible supersets apart): a lone disk r 9 and a flat native profile at z = 5 give ρ = 9.112195 in the slabs BELOW AND ABOVE. A boundary vertex counted in one slab only is not distinguishable in either guard (its edges carry it) and not claimed.

The rows with 0 and the rings are why generator and rings belong to the product guard. These runs are evidence for the inputs listed, and the argument of §2.1 is the reason; neither is a proof over all libraries. v6's figures labelled "touching" were its scratch mode `closed`, in which flat facets already followed the open rule.

### 2.5 Acceptance (sweep level)

On top of the mute-rule package. Pair and stretch coverage (episodes ± 0.25, touches ± 2e-3), shown and twin, through `makeToolVariant` / `installToolVariant` in a real worker: a parametric, a profile and a mesh tool, mm and inch, a tool change, 1 and 3 shards, a side run. Every stretch of the drawn reference **and of today's pin, tool × stock included** (the 6.2 mm and 5.0 mm cases of the mute package run with the body too). Compared: gaps, truncation, notes, `insideClosed`. A non-round mesh's reference is its rotating envelope, never the mesh at rest (§4: resting lug 0 findings, the spinning tool hits).

---

## 3. Work bounds

### 3.1 Measured (VM, Node 22, cold, 4 ms slices, 3 repeats; under the lock, load average 2.5–2.9)

| Case | v4 builder, one task (quiet) | canonical, steps | body, steps | drawing, steps (today: one task, quiet) | longest task: nested arrays alive / released |
|---|---|---|---|---|---|
| 200 k triangles, fine | 45–48 ms | 9.3–13.4 ms | 37–51 ms | 7.4–9.4 ms (31–44) | 11.6 / 4.3 ms |
| Codex: 40 002 v / 80 000 t, all 32 slabs | 152–159 | 6.7–9.0 | 24–36 | 5.5–7.8 (19–21) | 7.7 / 4.5 |
| cylinder at the limit, 199 996 t | 351–366 | 9.1–11.6 | 56–81 | 7.3–9.5 (42–49) | 12.5 / 4.5 |
| worst importable, 200 k t each over 32 slabs | 650–684 | 9.6–13.6 | 73–99 | 7.3–9.4 (40–42) | **12.6** / 5.0 |
| lathe, 51 × 160 / 100 × 512 / 400 × 512 / 2 000 × 512 points × segments (v7's sector builder; `latheColumns` not timed) | — | — | — | 7–8 / 30–32 / 63–70 / 317–327 ms | 5.7 / 5.7 / 5.9 / 7.1 |
| 40 new tools at once (those 4 meshes + the 36 shipped), bodies and ALL drawings | — | | | 281–298 ms in 102 tasks | 10.5 / — |

Operations between two yields: ≤ 4 180 (budget 4 096 + one triangle). The spikes over the 4 ms slice are the collector on the nested arrays: with them released (collected by force between the phases, in the probe) no task passes 5.0 ms; the collection itself then falls at a moment the collector picks. The step stays 4 096 vertices.

**Heap** (locked). One maximum mesh: nested 52.0 MB, 300 000 small arrays; canonical 3.6 MB, 0.2 MB of heap left. A full GC with it alive: 20–23 ms against 2.2–2.9 ms.

**Goal, not a claim:** no task over 16 ms for normalisation, body and drawing of any admitted shape. Shown in Node on this VM: 12.6 ms with the nested arrays alive. Owed: browser (Chromium, Firefox) with GPU upload and the first frame, and the N100. The first full decode (24–26 ms per maximum mesh, with the library's total triangles) and the gateway's first hash are outside it. Fallback if the N100 fails: the same jobs in a worker (canonical arrays are transferable; the page then keeps the conversion).
### 3.2 Input bounds, before any build, on the client

The bounds of §1.5, checked on lengths before an element is read, are the build's admission too: what is kept can be built. Added for the build: parametric profiles ≤ 2 048 predicted points (a second copy of the arc-step formula, so a guard holds predicted ≥ produced; one column of a lathe is the smallest step, so the points bound it), lathe ≤ 400 000 vertices over all parts of the drawing (§1.6). Above: `shape too detailed` → cylinder for body and marker, named. Steps: `runSteps(sliceMs: 4)`, budget 4 096; counted: 4 per vertex and triangle converted, 1 per z scanned, 8 + crossings per edge (the pin's too), 24 per drawn triangle, lathe columns of ≤ 4 096 vertices per step, at least one column, and as much of the index. One `buildToolProfile` (≤ 4.2 ms at 11 600 points) and single allocations are not split.

---

## 4. What the operator sees

**Check basis card**, per tool, start tool included: `T13 · L 63.210 · Ø 1.875 mm · shape, Ø max 8.00` / `… · envelope, Ø max 24.00` (an imported mesh: all round, as it spins) / `… · table Ø — tool table changed since the preview`. One row for all: `Tool shapes: As read when the check started` (`· not read now` / `· changed since`). The note: "Shape: a stepped body around the library shape, at least the table Ø over the table length + 20 mm. Table Ø: that cylinder alone (no diameter: a 6 mm stub). Holders are not modeled." A tool whose shape could not be used adds a result note, shown as the Sim tab's caveat; a proven `no library shape` adds none. The scrub marker shows the same decision (§1.4).

**Counts** (real chain, synthetic scene, canonical body; the same findings as with the v5 body; to be run again on the mute package):

| | pin today | body | drawn | sweep ms pin → body (interleaved, locked, loaded) |
|---|---|---|---|---|
| T13 D 1.875, relief beside two clamps | 0 | 3 near | 3 near | 1 293 → 3 567 (2.8 ×) |
| T13 at the old D 8 | 6 + 16 near | 12 + 16 near | 10 + 17 near | 1 521 → 4 328 (2.8 ×) |
| Ø3 on a Ø6 shank | 0 | 2 near | 2 near | 205 → 578 (2.8 ×) |
| native profile with a collar | 0 | 4 near | 4 near | 228 → 668 (2.9 ×) |
| native mesh with a lug (envelope) | 0 | 2 + 2 near | 0 (lug at rest) | 202 → 593 (2.9 ×) |

Coverage with the v7 body (`counts7.out`, unlocked): 0 stretches of the drawn shape and 0 of the pin missed in all five, shown and twin. **Cost: about 3 × the sweep time of this scene** (v5 quiet: 2.8–3.1 ×). BVH build of the machine unchanged. N100: not measured.

---

## 5. Guards, mutations, files, order

### 5.1 Guards and what must turn them red

| Rule | Guard | Red on |
|---|---|---|
| 1.1 two outputs | `toolTableStore.test.ts`: good read → failure / timeout / superseded in the same epoch: `currentRead` = failed view, no identity; record unchanged. `tool-table-read.spec`, `tool-edit.spec` unchanged. Import scan | the last good view kept as current; the record written by a failed read; a panel importing the record |
| 1.2 pairing | `toolShapeRecord.test.ts`, tables | D only; ε = 0; `toolDimsFor`; an unproven row; other revision / instance / units; T ≤ 0; **`no library shape` before the first read, or from an omitted library; a proven empty entry that warns** |
| 1.3 keys | five successive tables with other T; `partial`; failed reads | keys not freed; freed on a failed read; `missing` freed; a needed T freed; ninth row kept; ε merge |
| 1.4 one decision (Bell 2) | **browser, flow A:** result with a shape → disconnect → reconnect; **flow B:** run check at the timeout cylinder → late proof → scrub over that tool change, and the side run. Each step reads the marker's OWN geometry AND the card's row. Units: `sameCheckInputs`; known unit / INI / instance change | marker from the publication's decision; a disconnect that changes marker or card; a re-check for "not read"; no end on a known unit change; a side run with new decisions; a context left on the card after its result (input change, discarded run check, failed sweep, new publication); a `body` state that is the cylinder |
| 1.5, 1.6 memory | a walk from the store's roots (`currentRead`, record, library, queue, running job) finds no decoded geometry array after normalisation; inputs: an oversized native profile (4 096 points), an oversized segment list, a mesh over its own and over the library bound, a 1e39 coordinate; each ends as `refused`, its scalars and edit fields intact, the preview's and the card's word right; eight follow-up reads: the same records (identity), no second full read; `full` → `same`: deep-equal rows and records, the refused one included; several library changes during a held build: at most one library reachable, the queue empty of the old ones, the running job ended at its next yield; the 64 MB sum at its bound, in T order | raw lists kept in a row, the record, a job or the queue; a refusal read as `none`; a refusal that triggers a read; a field not counted; a size checked after the conversion; normalisation that differs between `full` and `same`; an old library held by a waiting job |
| 1.6 cache | `toolShapeCache.test.ts` (hand-driven scheduler): the private 33rd entry COMPLETES; its late result after release is disposed; owned entries never evicted; one dispose | membership as the condition; a released private entry published; an ended scene's result inserted |
| 1.6 bytes | Codex's 600-point lathe: admitted, built, **14 747 712 B = 24 V + 4 I**, above 14.4 MB, not refused; the most held while it builds ≤ its result + the meridian normals (an allocation meter in the builder); cutter + shaft parts summed with both seam columns; u16 / u32 index; no `uv` attribute; the cache's sum = the unique ArrayBuffers (a shared one once) and drops by exactly an entry's bytes when it goes; 400 001 vertices over two parts refused, 400 000 built ≤ 19.2 MB; an ended entry holds no geometry | the bound 14.4 MB; an estimate instead of the buffers; a shared buffer counted twice; UVs back; sector geometries kept beside the target; parts judged one by one; `dispose` taken for freeing; the input reduced |
| 1.7 deadline | fake clock: several missing rows, pings and retries inside the 3 s; drift wait beside it; another generation / connection | serial waits; a restart by ping or retry; a second read per row; a wait after its check ended |
| 1.8 `have_library` | store + pytest: `same` / `full`; reconnect; other instance; other units; a new T; a lost object; revision changed between request and read; older gateway | an unresolved `same` delivered; a composed reply that is not deep-equal to a full one of the same state; a scalar or text field left out by `same` (the description that falls back to a changed remark); `same` accepted over another identity or units; a missing T filled from nothing; an omitted library read as empty; a second full read in a loop |
| step 0 | pytest: n reads of one file state compute the revision once; a same-size rewrite computes it anew | per read; stale |
| 2.1, 2.4 body | `toolBody.test.ts`: (a) – (d) on the CACHE's output, stepped and at once; `latheColumns` value-equal to three's `LatheGeometry` + swap (an upgrade of three that changes it is seen); witnesses; the extent of both neighbours; `buildToolGeometries` (tab, live marker) and the cache through the one `latheColumns` | every mutant of §2.4 at its guard; a drawing from another source than the body; a second rotation path |
| 2.1 faults | 1e39, NaN, −r, bad index → `shape not usable` at the build | a body from it; a worker error |
| 2.3 transfer | `collisionWorker.test.ts`: base, program tool, shard, side run, malformed hull | hull dropped in any of them; cache key without it; a silent cylinder |
| 2.5 | coverage file; a clamp 3.0 mm from the pass (pin 0, body near miss) | `_programToolDims` without the hull |
| 3.2 | operations between yields ≤ 4 096 + 117; ≤ 4 096 vertices or one column per step; one case above each build bound; predicted ≥ produced | an uncounted scan; the pin in one step; no bound |
| 4 | `checkContext.test.ts`, `sim-panel.viewer.spec` | a missing word or caveat; a caveat for a proven absence |
| 5.3 Bell 1 | browser, at Bell 1: scrub past a never-loaded tool with a library shape → the marker is today's cylinder and the sweep's body the pin (read from the marker's geometry and the request) | a shape shown before the body checks it |

Durations are traced, not gated: `viewer.shape_build {tool, phase, tris, ops, tasks, max_task_ms, total_ms}`.

### 5.2 Files

New: `toolTableStore.ts`, `toolLibrary.ts`, `toolShapeRecord.ts`, `toolShapeCache.ts`, `viewer/toolBody.ts` + tests, `e2e/tool-shape-sim.viewer.spec.ts`. Changed: `toolGeometry.ts` (`toolDrawing`, canonical draw; `toolSimulationGeometry` / `freecadGeometry` tests checked against the ≤ 6.1e-6 mm move), `ToolTablePanel.vue`, `ToolStrip.vue`, `ThreeViewer.vue`, `viewer/collision.ts`, `viewer/collisionWorker.ts`, `viewer/checkBasis.ts`, `viewer/checkContext.ts`, `lcnc.ts` (`get_tool_table` field), `command_policy.py` (bounded field), `gateway.py`, `tool_store.py`, `e2e/mock-gateway.mjs`.

`rules.py`: `toolTableStore.ts`, `toolLibrary.ts`, `toolShapeRecord.ts` join the `ToolTablePanel` rule (TOOLS) plus VIEWER; `toolShapeCache.ts` a new rule (VIEWER, `tool-shape-sim.viewer`); `viewer/toolBody.ts` is under `viewer/**`. `toolBody.test.ts` reads `examples/sim_config/xyz3/tool.seed.json` and `tool.tbl`, and its generator took about 10 s in plain Node: it goes into `HEAVY_UNIT` by the measured threshold (or is split into a light file with (a), (b) and a thinned generator, and a heavy one), with its `READ_SITES` entry (`examples/sim_config/xyz3/**`); the coverage file the same. Inventory: regenerate (new command field, trace). Docs: `collision.md`, `machine-model.md`, `frontend-modules.md`, CLAUDE.md lines, `docs/decisions.md`.

### 5.3 Order

**Bell 1 (c1): infrastructure under today's cylinder contract. Nothing new is shown as checked.** 0. Gateway: one revision per file state, `have_library`. 1. Store with two outputs, normaliser and form records, panels moved. 2. Record, keys, decisions, groups as pure code. 3. Canonical `toolDrawing`, `latheColumns`, the steps, the cache. Visible then: the tab's preview and the live marker draw the same shapes as today (≤ 6.1e-6 mm), an oversized shape shows its notice. **The scrub marker stays exactly as today** (a tool never loaded in the session is a cylinder; one that was still draws from `getToolMeta`, the existing gap), **the sweep its pin, the card its words** (guard).

**Bell 2 (c2), on the merged mute package.** 4. `toolBody.ts` with its guard. 5. Worker, groups, deadline, card, notes **and the scrub marker together**: the first commit in which a library shape is shown is the one in which its sweep checks the body. The browser red spec (red at `24f3bd3a`) turns green here, with flows A and B. 6. Coverage, counts again, mutations, docs.

Bell 1 may merge alone, since it shows nothing new as checked; that integration head then has its OWN merge gate, and Bell 2 its own. One gate for both only if they integrate as one head. Bell 2's guards are not anticipated by Bell 1.

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

MT482-01 as above. Nothing else is open in the contract. No operator question from this plan; Q477-1 belongs to the mute-rule package.

# TF-2 — load the tool table file into LinuxCNC (plan v2, 2026-11-25, after Codex R476)

Base: development `24f3bd3a` plus the package `feat/tool-guard` (built first, see §0). Contract source: Codex R471 "Antwort TF-2", R468 TF-1c, R465, R472–R475, R476. Q471-1 assumed yes. No product code written.

## Changes against v1

| R476 | Change |
|---|---|
| MT476-01 | The load on a `complete` basis (pocket / remark only) is requested / unconfirmed, always: no `loaded` stamp, no end of the write note, and no text says it was loaded. The exact-echo proof and its machinery (serial, `task_state`, poll record) are gone. `confirmed` exists only for the `partial` transition. A candidate execution proof at io was found and measured offline (appendix A); it is NOT part of this package |
| MT476-02, Q2 | Prepared tool (index / T / pocket, from a fresh prepared value) and standstill are `feat/tool-guard`'s, for all edits and the import. TF-2 calls that guard with the file's rows and owns no copy of it |
| MT476-03, Q3 | Q bounded to signed 32 bit. T, P, Q each tested at their edges in every accepted spelling against the compiled upstream reader (§1.2, measured) |
| MT476-04 | `loaded` is a fully bound record inside the gateway; §3.2 says when a read may carry it (owner, revision, no later job) |
| MT476-05, Q5 | The words follow the cause: what makes the file not loadable is named first, with its own way out; "restart" only where a restart cures it (§2.4), also in the write note |
| Q4 | "LinuxCNC holds T5 twice" stays a restart, named as this package's limit |
| Q6 | The writer's line > 255 bytes is fixed in `feat/tool-guard`; TF-2's form rule still refuses such a file from elsewhere |

**In one sentence:** the operator compares the file with LinuxCNC's table, confirms the named differences, and the gateway sends exactly one `load_tool_table` on the connection the comparison was made on; it writes no file and no library, and answers requested / confirmed / unconfirmed apart.

**Sources.** LinuxCNC 2.9.4 in `~/claude-work/bg/upstream-2.9.4/src/emc` (every cited file matches `SHA256SUMS` / `task_ini.SHA256SUMS`). Probes: `~/claude-work/p6/tf2/` — `oracle/` (upstream `tooldata_common.cc` unchanged, only the mmap stubbed), `test_form_rule.py`, `test_form_rule2.py` (run from `lcnc-gateway/`, `-p conftest`; pure modules only), `oracle/rchar.py`.

## 0. Facts and the package before this one

| # | Fact | Source | Consequence |
|---|---|---|---|
| F1 | The load is a PATH job: io clears the whole table, then opens its configured file at some later io cycle | `ioControl.cc:974–985`, `tooldata_common.cc:271–340` | the file is read again after the values showed (§1.4) |
| F2 | io clears BEFORE `fopen`; a failed open leaves the table EMPTY, `RCS_ERROR`, task aborts everything and stops the spindle | `tooldata_common.cc:296, 299`; `emctaskmain.cc:3473–3520` | named limit; the way back is a load of the restored file (N7) |
| F3 | Index 0 (spindle) is cleared too; it is restored by T number, only if the file holds that T | `ioControl.cc:598–610` | a spindle tool missing in the file is never loadable |
| F4 | `Interp::synch` reads the table and #5400 ff.; it does not write `tool_offset` (G43 / G49 / G43.1 / .2 and init do; G20 / G21 convert the canon's own) | `rs274ngc_pre.cc:2010–2063, 1329–1338`; `interp_convert.cc:5651 ff., 2716–2799` | the offset in effect stays until the next G43; native owed (N9) |
| F5 | Task takes the command in ESTOP / OFF / ESTOP_RESET, ON + MANUAL, ON + AUTO idle, ON + MDI; queued behind motion and io | `emctaskmain.cc:854, 978, 1094, 1442, 1553–1557` | E-Stop and off stay allowed; behind a jog it would run later (standstill: tool-guard) |
| F6 | `emcToolLoadToolTable` returns 0 whatever came of it; an internal abort drops a queued load without a new echo | `taskclass.cc:719–728`; `emctaskmain.cc:3473–3529` | "sent", an echo, DONE prove no load (MT476-01) |
| F7 | io's reader differs from the gateway's on lines > 255 bytes, tab / CR / NUL / non-ASCII in the data part, integers past int32 | `tooldata_common.cc:69–230, 316` | the form rule (§1.2) |
| F8 | STAT carries neither pocket nor remark (the mmap holds the pocket, the remark lives in io's private memory) | `emcmodule.cc:694–735` | neither is compared; a pocket / remark change shows no difference |

**From `feat/tool-guard` (assumed merged; its worktree was still clean at `24f3bd3a`, so the interface is assumed, not read):** (a) the shared `tool_table` admission judges standstill and, given the rows LinuxCNC will hold AFTER the reload, the prepared tool — same index, T and pocket as prepared, the pocket from a fresh prepared value, unknown refuses; (b) the writer refuses a line > 255 bytes. TF-2 passes the file's rows to (a) inside its own admission (§1.3 c). TF-2 does not start before that interface is fixed.

## 1. Contract

### 1.1 Commands

| | `tool_table_preview` | `tool_table_load` |
|---|---|---|
| Payload | none (not queue-safe: dropped on a closed socket) | `base` {`path`, `instance`, `ini`, `link`, `rev`, `memory`} and `removed` [T…], both required, closed shapes |
| Policy | `READ_ONLY_COMMANDS` (free, like the import preview) | gate `toolTableWrite`, effect `input_action`; `COMMAND_SCHEMA`: `ToolLoadBase` (bounded texts; `rev`, `memory` 64 hex), `removed` `Seq(max_len=1000, Num(0…2147483647, integer))` |
| Reads | ONE attempt: bytes (3 signatures), then `owner.link`'s STAT.tool_table and `tool_in_spindle` | the same again, in the write's thread |
| Sends | nothing | one `load_tool_table`; no file, no library |

`base`: canonical path; bound instance; INI; `link` = `<_TRIP_EPOCH>.<Link.seq>`; `rev` = sha256 of the bytes; `memory` = sha256 of LinuxCNC's home entries (canonical, floats exact) plus the spindle tool. The differences are bound on both sides.

Preview reply: `{ok, base, basis: "partial"|"complete", refusal, saved_at, spindle, removed:[{T, name, Z, D}], changed:[{T, name, fields:[{f, now, file}]}], added:[…]}`; `removed` = `proof.missing`, `added` = `proof.extra`, `changed` = `proof.differs`. With a `refusal` no list (no difference claimed on an unknown basis). `name` is display only. The owner is judged last (LINK_CHANGED discards the reply).

`get_tool_table` gains `load_refusal` (the same function's words, else null) and `loaded` {epoch, seq} | null (§3.2). Written-table replies (4 WS edits, import) gain `write` {epoch, seq}.

### 1.2 Never offered — `tool_proof.load_refusal` (pure; ONE function for preview, read and commit; first match)

| Observation | Words (≤ 60, measured) |
|---|---|
| random changer (independent of the Q468-1 switch) | Random tool changer — only a restart loads the file |
| tool database / changer type not read | Tool database — LinuxCNC does not use this file / Changer type not read — check the INI |
| STAT.tool_table not read or empty tuple | LinuxCNC's table not read — try again |
| signatures differ under the read | File changed while read — check again |
| the newest write or load job still awaited | LinuxCNC still loads the last change — try again |
| no final newline: otherwise equal / else | `EDIT_NO_LINE_END` / `EDIT_INCOMPLETE` (a cut file's cause is never named) |
| 0 bytes or no tool row | No tools in the file — restore it |
| a CR anywhere | Windows line ends in the file — save it without them |
| a line > 255 bytes with its newline (comments too) | Line 12 too long for LinuxCNC — shorten it in an editor |
| NUL anywhere; a byte outside 0x20–0x7E before the `;` of a tool line | Line 12 has a tab or control character — remove it |
| a line whose first non-blank is `#`, with a P word (a tool commented out with `#`): io skips the line but counts its table place, so every later tool sits one index higher than its row — measured: `#T5 P5 Z1` then T2 → T2 at index 2; `;T5 P5` → index 1 | Line 12 is a # comment with a P word — use ; instead |
| an unread line | Line 12 not readable — fix it in an editor |
| T outside 0–99999 | A T number outside 0–99999 — fix it in an editor |
| P outside 0–99999 | T5: pocket outside 0–99999 — fix it in an editor |
| **Q outside −2147483648…2147483647** | T5: Q outside the 32-bit range — fix it in an editor |
| a real not finite / D < 0 | T5: not a finite number — fix it in an editor / T5: diameter below 0 — fix it in an editor |
| T twice in the file | T5 twice in the file — remove one, restart LinuxCNC |
| > 1000 rows | More than 1000 tools — remove some in an editor |
| T twice in LinuxCNC only (file valid: a restart cures it) | LinuxCNC holds T5 twice — restart it |
| spindle tool ≠ 0 not in the file / not read | T5 is in the spindle, not in the file — restore it / Spindle tool not read — try again |

The general reader stays as it is; only the load admission is this narrow. With the `#` clause the file's i-th tool row IS io's index i — what the tool-guard's prepared-tool rule needs from the rows TF-2 hands it. T, P use the edits' own bounds (`TOOL_NUMBER_MAX`, pocket); Q keeps LinuxCNC's whole `%d` range, no narrower domain is claimed.

**Measured (compiled upstream reader against `parse_tool_table_bytes`):** T, P, Q at 19 edge values in every spelling the gateway takes (`5`, `5.`, `5.0`, `+5.000000`, leading zeros, 40 decimals, lower case): 356 admitted, all equal; 496 refused, 372 of them really differ. Fuzz with such integers: 647 admitted, all equal; earlier form fuzz: 1623 admitted, all equal. Codex's five Q cases: 3 and 2147483647 admitted and equal, the other three refused. All 140 tables on the VM with every clause above except memory- and spindle-dependent ones: 138 admitted and equal, 2 refused for unread lines. Index: 3000 files with `#`, `;` and blank lines mixed in — every admitted one has its i-th row at io's index i (1678 admitted; 1322 refused, 683 of them really shifted).

### 1.3 Admission of `tool_table_load` (order; no refusal sends anything)

1. Dispatcher: gate, schema, arm. Handler under `_cmd_lock`, owner = `_tool_owner()`; `base.path/instance/ini/link` ≠ the owner's → "Another LinuxCNC or table file — check again".
2. All the rest is the `admit` of `_cmd_blocking(owner.link, op(load_tool_table), wait=None, admit, began)` — in the write's own thread, no await before the NML write:
   a. `_write_admission_refusal(conn_key, tool_table=True, owner=owner)` (no reads for a writer already refused);
   b. one read of bytes, then STAT of `owner.link`: `rev` differs → "The file changed — check again"; `memory` differs → "LinuxCNC's table changed — check again"; `load_refusal` → its words; fresh `missing` ≠ `removed` → "Removed tools not confirmed — check again". The basis state (`partial` / `complete`) and the file's signature are kept for the job;
   c. the shared admission again with the file's rows (tool-guard: standstill, prepared tool): fresh poll, idle, reader, M6, and `standing()` (writer, owner, claims, RFL, load) as the LAST word, memory only (MT-I35);
   d. `_cmd_blocking`'s second Link check, then the write.
3. The JOB (next `seq`; scan, owner, rev, signature, basis) is booked in the section awaited through `_thread_to_end`. No watch baseline is touched (the gateway wrote no file). Booking ANY job drops the `loaded` record (§3.2).

No automatic retry; no second reload on a timeout, a reconnect or a Link change; no other Link is asked.

### 1.4 The proof after sending (`_confirm_tool_write` extended; outside `_cmd_lock`; 2 s bound, cooperative)

| Basis at the admission (2b) | Outcome |
|---|---|
| `partial` (loadable = only changed, missing or added tools) | **confirmed** when **V** (rule R complete for the bound bytes, read after the send) and then **S** (the file read again after V: same dev, inode, mtime_ns, size AND same `rev` as in 2b), the owner unchanged, the job the newest. V after a `partial` 2b is a transition only a load of this unchanged file makes: a foreign G10 L1 that sets a value rewrites the file (S), nothing else removes, adds or sets home entries on a nonrandom changer. io reads the file in one pass, so pocket and remark of that pass are in it |
| `complete` (nothing LinuxCNC shows differs) | never confirmed: V is true before the load, and neither an echo, DONE, a longer wait nor another poll proves that io ran it (F6). The job runs the same bound for what contradicts it — V lost (F2), S broken, owner gone — and otherwise ends **unconfirmed, "not provable"**. No stamp |

A round that sees another file signature ends the job at once.

### 1.5 Replies

`ok: true` = the request went out; `ok: false` = nothing reached LinuxCNC. `load`: `confirmed`; `unconfirmed` with `why` = not provable / not shown / file changed / controller changed / superseded / unknown (NML raised once begun, the wait failed, the gateway ends); `not awaited` (this client's wait was cut).

Abort / E-Stop before the write begins: preempted as today, nothing sent. After it: `ok: true, load: "not awaited"` (`_preempted_tool_wait`, as a written edit); the job goes on, and LinuxCNC's abort may drop a load still queued — then V never comes. Every end of the newest job bumps the table version once. Traces: `tools.load_refused`, `tools.load_sent` (seq, rev, basis, counts, removed ≤ 20), `tools.load_confirmed` / `tools.load_unconfirmed` (why, ms).

## 2. UI

### 2.1 Where

| Place | Form | When |
|---|---|---|
| `[data-read-state]` (partial read) | "Load table" left of Retry, both in one `.row-tight` | `load_refusal` null |
| `[data-write-state]` | "Load table" left of the X | its load part stands, `load_refusal` null, no load requested from this page since |
| Tools › More, after Upload | "Load table", always present | disabled with `load_refusal` as `:reason`; the way for a pocket / remark change (a `complete` read shows no note) |

`MachineBtn type="fileBrowse"` (gate `always`: a preview, a read), `read` in `controlInventory.ts`. A press disables it ("Comparing with LinuxCNC — wait") until the preview's reply; the dialog opens complete, nothing grows under a press. A refused preview opens no dialog (error note at the tab).

### 2.2 The dialog (`ToolLoadDialog.vue`, new; `DialogFrame kind="form" size="md" wide initialFocus="safe"`)

| Part | Component |
|---|---|
| counts, what is not compared, the irreversible line | plain text, `.settingDesc` |
| spindle line; not-confirmable line (`complete` basis) | `.statusNote.warn` |
| the list, 2 columns (Tool, Change), removed → changed → added | `.dataTable` + `vStickyHead` in `.dialogContent scroll-thin`; 200 rows, 200 more when the end comes into view (IntersectionObserver); the counts above name all |
| acknowledgement, only with removed tools | `MachineToggle gate="toolEdit"` above the actions; OFF → confirm disabled "Confirm the removed tools first"; reset by every new preview |
| Cancel | `dialogCancel`, outside the Gate, disabled while busy |
| Load table | `<Gate gate="toolTableWrite">` + `toolDanger` when anything is removed or changed (title `danger` too), else `toolSave` |
| refused / stale | `.statusNote.error` / `.warn` + `retry` "Check again" |

Stale: a `tool_table_changed` ping or a closed connection while open and not busy disables the confirm button, resets the acknowledgement, shows the note; the list never changes by itself. Commit: `fire(…, "toolTableWrite")` + `awaitReply` (60 s); reply lost → `writeUnknown()`, confirm closed until "Check again". Narrow / touch: two columns, values wrap (one scoped layout rule as the panel's `.colDesc`), 44 px buttons, `sidewaysOverflow` guard. **No new global CSS, no new catalog type.**

### 2.3 Texts

| Where | Text |
|---|---|
| Button / busy | Load table / Loading… (`busyLabel` Load in progress) |
| Title | Load tool table into LinuxCNC? |
| Counts | tool.tbl, saved 14:02:11: 2 removed, 1 changed, 3 added. / … : same tools and values as LinuxCNC. |
| Not compared | Pockets and remarks are not compared; loading takes them too. The tool library stays. |
| `complete` basis | LinuxCNC shows no pockets or remarks — this load cannot be confirmed. |
| Irreversible (removed or changed) | LinuxCNC's values of these tools are replaced. This cannot be undone. |
| Spindle tool changed | T5 is in the spindle — its offset in effect stays until the next G43. |
| Row | Removed · Z −49.123 · Ø 6 / Z −49.123 → −50 · Ø 6 → 6.35 / Added · Z … · Ø … |
| Toggle | Remove 2 tools from LinuxCNC |
| Stale | Compared with LinuxCNC before — check again / Connection lost — check again |
| Refused (error) | Not loaded: <reason>. |
| Confirmed (`.statusNote.ok`) | LinuxCNC loaded the tool table. |
| Unconfirmed (warn) | Load requested, not confirmed — LinuxCNC shows no pockets or remarks. / … LinuxCNC did not show it in time. / … the file changed meanwhile. / … connection to LinuxCNC changed. / … a newer table write came. / … its outcome is unknown. |
| Not awaited (warn) | Load requested, not awaited — the table shows the result. |
| Client reasons | Gateway lacks this — restart it / Tool table not read — retry |

One `[data-load-state]` slot under the write note, set with the read that follows, dismissable; gone with the next load or write or another table file, a confirmed one also with any read that is not `complete`. When the write note's load part stands, an unconfirmed load changes THAT note (§2.4) and adds none: one fact, one place.

### 2.4 Ways out by cause (edit refusal, read note, write note — one source)

`partial_reason` first asks for `load_refusal`; only a loadable file gets the difference words. (The edit keeps its own words for the two transient causes: "File changed while read — nothing written; read again", "LinuxCNC still loads the last change — try again".)

| Read / file | Edit refusal and read note |
|---|---|
| not loadable, whatever else differs (form, integers, newline, duplicates, spindle, job awaited …) | that cause's words from §1.2 — never "restart" for a file LinuxCNC would read wrongly at a start too |
| loadable, tools only missing | T5 not in the file — restore it, or load the file / 3 tools not in the file — restore them, or load the file |
| loadable, otherwise different | T5 differs from LinuxCNC — load the file or restart / 3 tools differ from LinuxCNC — load the file or restart |

"restart" remains only in: random changer, "twice … remove one, restart" (LinuxCNC keeps both rows until then), "LinuxCNC holds T5 twice — restart it" (reached only with a valid file), and the loadable difference.

| Write note, load part | Text |
|---|---|
| file loadable | Table saved, load into LinuxCNC failed — load table or restart. |
| file not loadable | Table saved, load into LinuxCNC failed. <its cause and way out>. |
| `earlier` (another LinuxCNC since) | Table saved, load not confirmed — load table or restart. (not loadable: its cause) |
| this page requested a load since, not confirmed | Table saved, load requested but not confirmed — a restart loads it. |
| a gateway without `load_refusal` | today's words |

The requested form claims neither success nor failure, and its way out is true (a restart loads the file). It stays until dismissed, the next write, another table file, or a `loaded` stamp (§3). The metadata part is untouched by all of this.

## 3. What ends the open-write note (load part)

### 3.1 On the page (`toolWriteStands`)

Settled only by a read of the same path with `loaded.epoch` = the note's epoch and `loaded.seq` > the note's `write.seq`. Everything else leaves it: a `complete` read, "sent", unconfirmed / not awaited, another instance, a socket or gateway reconnect, no identity. Dismissing, the next write and another table file end it as today. What that means: a VISIBLE load part stands beside a `complete` (or unchecked) read, where no load is ever confirmed — TF-2 never ends that one, it only rewords it (§2.4). The stamp keeps a HIDDEN one (beside a `partial` read) from reappearing as "load into LinuxCNC failed" after the load that confirmed.

### 3.2 When a read may carry `loaded` (the gateway's record, MT476-04)

Kept: ONE internal record of the newest load that ended `confirmed` (hence `partial` basis): {seq, owner (Link object, instance, INI, table path), rev}. `_read_tool_files` attaches `{epoch, seq}` only if, judged LAST with the read's own owner check (memory only):

| Condition | Else |
|---|---|
| the read's owner is the record's: the same Link object, instance, INI and path | no stamp — also a new Link to the same instance (nothing is carried over) |
| the bytes this read read are the record's `rev` | no stamp |
| the read's proof is `complete` | no stamp |
| no job (edit, import, load) was booked since — booking drops the record | no stamp |

A plain WebSocket reconnect changes none of these: the stamp stays, so a page that lost its socket still sees it. A gateway restart or another LinuxCNC (session-bound: a new gateway) has no record. The wire form is narrow because the gateway enforces the binding; the page cannot and need not.

Limits: "unchanged" is dev / inode / mtime_ns / size / hash (a foreign writer restoring the same bytes inside one mtime tick, and a foreign G10 L1 caught between io's put and its file save, are not seen); the ordinary edit's own `reload: confirmed` for a pocket-only change is as weak as ever (V alone; older, R472) and gives no stamp.

## 4. Safety

| Case | Answer |
|---|---|
| Gate | `toolTableWrite`; E-Stop and off allowed (F5; lag measured: 301 ms off, 518 ms E-Stop) |
| Moving, prepared tool | tool-guard, inside the same admission (§1.3 c) |
| Running / paused / start claim / RFL / load, M6 pending | refused by the shared admission |
| Offset in effect | unchanged until the next G43 (F4); index 0 and #5401–#5413 take the new row; the Tool strip's "In effect" already says it. `save_tool` on the spindle tool has the same effect today, so a changed spindle tool is loadable with the warn line. Its `tool-from-pocket` pin keeps the old pocket until the next change (as with every edit) |
| Toolsetter / M600 | not reachable while one runs; afterwards M600 and `#3103` use the loaded Z (shown in the list). BEFORE the load any G10 L1 (an M600) rewrites the file from LinuxCNC's old table: the hand edit is lost, `rev` differs, the load refuses |
| Foreign NML writer | not excluded, not claimed: before the send caught by `rev` / `memory` except in the last microseconds, after it by S |
| Preview, parameters, simulation mode | the load is an input write (generation, observer "tool_table"), drift re-parses at idle after 2 s; task's synch rewrites the var file as with every edit; `toolTableWrite` stays open in simulation as today. `previewWait` label "the tool table load" |
| F2 (failed open) | LinuxCNC's table empty, abort and spindle stop by LinuxCNC; reply "file changed" or "not shown"; the read names every tool; the restored file is loadable again |

## 5. Guards, mutations, native, files

**Backend.** `test_tool_load.py` (pure): every §1.2 row red without its clause; T / P / Q at their edges in every spelling and the form cases against a golden of the compiled reader (fixture + source sha + generator), the INDEX included; both directions of the differences; the `memory` digest per field and the spindle tool; §2.4: **difference AND a bad line / long line / CR / Q overflow together → the form words** in edit refusal, read note and `load_refusal` alike, and no "restart" in them. `test_tool_load_gateway.py` (real WS path, `tool_io_fixture`): foreign change confirmed; removal confirmed; TF-1c with a Z (confirmed) and with a pocket only (unconfirmed "not provable", no stamp, and the twin where io never ran gives the SAME reply); byte-equal file, library, watch baseline; exactly one NML call on the owner's Link; each refusal of 2a / 2b / 2c held at its read with disarm, unregister, Link, INI, instance changed there; file or memory changed between preview and commit; `removed` too short / too long; spindle tool gone; the tool-guard refusal reached with the FILE's rows (same index and T, other pocket red; only Z changed green); job awaited; file changed before V, between V and S, A→B→A by mtime; Link change after the write; NML raises once begun; abort / E-Stop of another client before the write, in the section, in the wait, twice; nothing sent again. **Stamp:** present after a confirmed load and over a pure WS reconnect; absent after an owner change BETWEEN the confirmation and the next read (Link object, instance, INI, path — each alone), with another revision, with a `partial` read, after a later edit / import / load; `seq` order against the write.

**Frontend.** `toolLoad.test.ts`, `toolTableRead.test.ts` (§2.4 and §3.1 row by row), `commandShapes`, `commandPath`, `controlInventory`; `tool-load.spec.ts`: the three places offered / not offered, list and counts, 1000 + 1000 rows in portions, acknowledgement and reset, danger, Cancel while disarmed, stale by ping and socket, every outcome note, `complete` basis (warn line before, "requested but not confirmed" in the write note after, never "loaded", no second note), a hidden write note not reappearing after a confirmed load — on the writing page, on another page, after a socket loss (and reappearing without the stamp), payload exactly `base` + `removed`, 100 / 150 % portrait and touch, no box moves while it compares; a `dialogs.spec` row. Mock defaults in the same commit.

**Mutations (≈ 45):** drop each of `rev`, `memory`, `removed`, path / instance / ini / link; admission before the reads only; `standing()` not last; `_stat_now()` for the owner's STAT; reads outside `admit`; send on `link()`; each §1.2 clause (Q's both bounds, the `#` line); tool-guard given the OLD rows; V, S, owner, newest each dropped; S before V; a `complete` basis confirmed; early end on a changed file dropped; retry on timeout; second send after reconnect; a file or library write added; `ok: true` for a refusal; preempt raising after the write; stamp from an unconfirmed, a `complete`-basis or an edit job; each §3.2 condition dropped; `>` → `>=`; epoch ignored; record kept over a later job; `partial_reason` asking the differences first; "restart" left for a bad form; page: offered with a refusal, acknowledgement not reset, confirm open while stale, note before the read, two notes for one fact, metadata part settled.

| Contract case (R471) | Backend | Browser | Native |
|---|---|---|---|
| foreign change confirmed | ✓ | ✓ | N1 |
| confirmed removal | ✓ | ✓ | N2 |
| change between preview and commit | ✓ | stale note | N3 |
| change after NML delivery | ✓ | note | N4, N6, N7 |
| foreign Link / instance / INI | ✓ (only layer: a bound gateway never meets a second one natively) | reconnect | – |
| refused / failed reload | ✓ | ✓ | N3, N11 / N7 |
| own commit repeated (TF-1c) | ✓ | note | N8 |
| abort during the wait | ✓ | ✓ | N13 |

**Native** (VM sim, run tree, user service, restore proven; 3-axis; only the run's own `io` is held, SIGSTOP ≤ 3 s):

| N | Case | Pass |
|---|---|---|
| 1 | hand edit (changed + added), load | partial → confirmed → complete → an edit admitted |
| 2 | removal acknowledged | STAT without the tools; library unchanged |
| 3 | file changed between preview and commit | refused, STAT unchanged |
| 4 | `io` held, load sent, file changed, `io` on | unconfirmed "file changed"; the next read is the truth |
| 5 | `io` held 3 s | "not shown" at 2 s, nothing sent again, later complete |
| 6 | `command.tool_offset` of a second NML client while `io` is held | "file changed" |
| 7 | `io` held, file moved away, `io` on | table empty (F2), file back → load confirmed |
| 8 | TF-1c with a Z: commit B, hand-restore A and load A, hand-restore B's exact bytes, load | confirmed, stamp, write note gone |
| 8b | the same with a pocket only (`tool-prep-pocket` after `Tn` shows what LinuxCNC holds) | unconfirmed "not provable" although the pin shows the new pocket; twin with the load dropped (`io` held, abort — that it drops it is to be shown there): same reply, old pocket, note stands |
| 9 | T5 in the spindle with G43, its Z changed, load | `STAT.tool_offset` unchanged, index 0 new; after G43 the new value |
| 10 | tool-guard's native case with a hand-edited file through TF-2 (same index / T, other pocket) | refused, nothing sent |
| 11 | during a jog; E-Stop; off | refused; confirmed; confirmed, lag reported |
| 12 | 1000 tools, off and E-Stop | lag against 2 s reported |
| 13 | abort of a second client in the wait (`partial` basis) | `not awaited`, then the read |

Before the machine update: `load_refusal` over a copy of the machine's real `tool.tbl`.

**Files.** Gateway: `tool_proof.py`, `gateway.py` (`_ToolWriteJob`, new `_send_tool_load`, `_confirm_tool_write`, `_after_tool_write`, `_read_tool_files`, `_cmds_tool_table`; the admission as tool-guard leaves it), `command_policy.py`, `tool_io_fixture.py`; touched tests `test_tool_proof*`, `test_tool_commit_gateway`, `test_payload_contract`, `test_command_policy`, `test_calc_lifetime_wiring`. Registrations: the command as `renumber_tool`, the read as `get_tool_table`. Web: `ToolLoadDialog.vue`, `toolLoad.ts` (new), `toolTableRead.ts`, `ToolTablePanel.vue`, `App.vue` (More), `lcnc.ts`, `previewWait.ts`, `controlInventory.ts`, `commandPath.test.ts`, `commandShapes.test.ts`, `mock-gateway.mjs`. Old words asserted in `test_tool_proof.py`, `test_tool_proof_gateway.py`, `test_tool_commit_gateway.py`, `toolTableRead.test.ts`, `tool-table-read.spec`, `tool-import.spec`, `p6tf.native.py`, `docs/ui-glossary.md`, `functions.json`. `rules.py`: two web files and `tool-load` into TOOLS. Inventory F-TOOLLOAD; `funktionen.md` rendered. Docs: CLAUDE.md, `safety-and-permissions.md`, `ui-patterns.md`, `frontend-modules.md`, `decisions.md`, `testing.md`.

**Build order:** 0 tool-guard merged; 1 `tool_proof` + golden + words; 2 policy / schema / registrations; 3 preview and read fields; 4 send + admission; 5 confirmation + record + stamp; 6 page; 7 docs, inventory, mutations, round gate, native.

**Size:** gateway ≈ 340 lines (v1: 400), web ≈ 400, tests ≈ 1600, native ≈ 330.

**Limits (named):** no byte proof of what io read; a pocket / remark-only load is never confirmed; the form rule is conservative (124 of the 496 refused edge files read alike); mtime-tick ABA and a G10 between io's put and save; a foreign NML writer is not excluded; STAT reads are no atomic snapshot; 2 s is cooperative and a load can run after it; random changer, tool database and a tool LinuxCNC holds twice stay with a restart; `iov2` from source only; F2's abort and spindle stop are LinuxCNC's (`io.reason` on that path not traced).

## 6. Open

**Codex:** (1) the `partial` transition (V then S) as the only confirmation and the only source of `loaded`, with §3.2's binding; (2) §2.4's write-note form "load requested but not confirmed — a restart loads it"; (3) appendix A: leave it out (recommended), or wanted as its own step?
**Operator, Q-TF2-1 (unchanged, not answered):** may the action also remove tools, behind the switch and the danger button? Recommendation: yes; never the tool in the spindle. Q471-1 is assumed, not answered.

## Appendix A — a candidate execution proof at io (found, NOT in this package)

| Looked at | Result |
|---|---|
| io's own echo / status, HAL pins, the error channel | not in the binding (`emcmodule.cc:300–420` carries only `io.tool`, coolant, aux, lube members); no pin or message for a load |
| the synch that follows the load (new inode of the var file) | an internal abort queues the same synch: no difference |
| inotify / fanotify on the file | no pid for a foreign process without privileges: any reader would count |
| the mmap's pocket (through `libtooldata`'s `tooldata_get` or the mmap file) | a value proof for the pocket only, over a C++ struct layout, in-process; `tooldata_get` calls `exit()` when unattached; nothing for the remark |
| **`/proc/<io pid>/io` `rchar`** | the kernel's count of bytes THAT process read. Measured with the compiled reader (4 tables, 52–53,568 bytes): idle +0, a load exactly + the file's size, a failed open +0 |

A rise by k × the file's size (k ≥ 1) from a baseline taken in `admit`, with the file unchanged (S), would show that this io read this file whole after the send; a dropped load leaves it flat. Owed before it could count: that the REAL `io` reads nothing else (NML is shared memory, `linuxcnc.nml` toolCmd / toolSts) over minutes of every state; exactly one io process of this instance (INI argument, start ticks; `iov2` and a renamed `EMCIO`); the file unreadable or accounting off → no claim; and the native counter-case Codex names — a load dropped by an INTERNAL abort (held `io` with an un-acknowledged earlier command keeps the load in task's list; a motion error then clears it without a new echo) must stay unconfirmed. Why not now: the only gain is confirming pocket / remark changes, which the next saved edit or a restart takes over anyway, and it makes another process's accounting part of a safety text.

# TF-2 — ask LinuxCNC to load the tool table file (plan v3, 2026-11-25, after Codex R478)

Base: development `24f3bd3a` plus `feat/tool-guard` (read at `d4b9239f`, not yet reviewed; §0). Contract sources: Codex R471 "Antwort TF-2", R468 TF-1c, R465, R472–R476, R478. Q471-1 assumed yes. No product code written.

## Changes against v2

| Source | Change |
|---|---|
| MT476-01 rest; coordinator's decision | No "confirmed" load, no `loaded` stamp, no text that says LinuxCNC loaded the file. A sent request ends **requested**; beside it, observed and worded apart: "LinuxCNC now shows the file's tool values" (values only), or why not |
| R478 refused save | Source F9: `tooldata_put` stands before `tooldata_save`; a refused save keeps the value and the file. So values that match prove no load, on a `partial` basis either. Guards (§5) and native N12 take the sequence |
| §3 | TF-2 never ends and never hides an open-write note; after a request it only rewords it, by cause, with an explicit priority (§3). `write` / `loaded` {epoch, seq} are gone from every reply |
| MT478-01 | The positive note is derived from the READ on screen (same owner, same file revision, rule R complete); no stamp, no stored result. Owner change or a read that does not show it → gone (§2.5) |
| MT476-05 rest | The priority of causes is ONE list (§1.2 for the file, §3 for the note); a known form error beats the random changer's line; a cause without a proven way out gets none |
| tool-guard is there | The assumed interface is replaced by the real one: `_write_admission_refusal(…, load=<bytes>)` → `tool_proof.prepared_refusal`; `LINE_BYTES_MAX`, `home_tools` reused (§0) |
| Native | 12 cases instead of 14; a foreign value write is `G10 L1` over MDI — `command.tool_offset` leaves the message's `pocket` uninitialised (`emcmodule.cc:1013–1022`, `emc_nml.hh:1609`) |
| Appendix A | dropped (Codex: leave it out) |
| Unchanged | preview, binding, admission order, form rule, `#` clause, dialog, gate |

**In one sentence:** the operator compares the file with LinuxCNC's table, acknowledges the named differences, and the gateway sends exactly one `load_tool_table` on the connection the comparison was made on; it writes no file and no library, and afterwards says what it requested and what LinuxCNC's table shows — never more.

**What it is for:** after a hand edit, or a committed write that was not loaded, every edit is refused until the table reads `complete` again. When the values show, the read IS `complete` and edits are admitted again by rule R — that needs no claim about the load.

**Sources.** LinuxCNC 2.9.4 in `~/claude-work/bg/upstream-2.9.4/src/emc` (cited files match `SHA256SUMS` / `task_ini.SHA256SUMS`). Probes: `~/claude-work/p6/tf2/` (compiled upstream reader, `test_form_rule.py`, `test_form_rule2.py`; pure modules, run from `lcnc-gateway/` with `-p conftest`); Codex's `maschinentag.r478.codex-*` (load / put / refused save with the upstream code).

## 0. Facts and the package before this one

| # | Fact | Source | Consequence |
|---|---|---|---|
| F1 | The load is a PATH job: io clears its table, then opens its configured file, at some later cycle | `ioControl.cc:974–985`, `tooldata_common.cc:271–340` | bytes are never "what LinuxCNC loaded" |
| F2 | io clears BEFORE `fopen`; a failed open leaves the table EMPTY, `RCS_ERROR`, task aborts and stops the spindle | `tooldata_common.cc:296, 299`; `emctaskmain.cc:3473–3520` | named limit; way back = a request for the restored file (N6) |
| F3 | Index 0 (spindle) is cleared too, restored by T number only if the file holds it | `ioControl.cc:598–610` | a spindle tool missing in the file is never loadable |
| F4 | `Interp::synch` does not write `tool_offset` | `rs274ngc_pre.cc:2010–2063, 1329–1338`; `interp_convert.cc:5651 ff.` | the offset in effect stays until the next G43 (N8) |
| F5 | Task takes it in ESTOP / OFF / ESTOP_RESET, MANUAL, AUTO idle, MDI; queued behind motion and io | `emctaskmain.cc:854, 978, 1094, 1442, 1553–1557` | E-Stop and off allowed; standstill: tool-guard |
| F6 | "Sent", an echo, DONE prove no load (`emcToolLoadToolTable` returns 0; an internal abort drops a queued load without a new echo) | `taskclass.cc:719–728`; `emctaskmain.cc:3473–3529` | no execution claim |
| F7 | io's reader differs on lines > 255 bytes, tab / CR / NUL / non-ASCII in the data part, integers past int32 | `tooldata_common.cc:69–230, 316` | form rule §1.2 |
| F8 | STAT carries neither pocket nor remark | `emcmodule.cc:694–735` | neither is ever compared or claimed |
| F9 | `SET_OFFSET`: `tooldata_put`, THEN `tooldata_save`; a refused save returns −1, the value stays, the file is unchanged; the abort that follows reloads no table | `ioControl.cc:1006–1021`; Codex R478 measured it | matching values prove no load |

**`feat/tool-guard` (read at `d4b9239f`):** `_write_admission_refusal(conn_key, tool_table=True, owner=owner, load=data)` judges, on its own poll, standstill ("Machine moving — wait until it stands") and `tool_proof.prepared_refusal(data, scope, index, preparing, number, pocket)` — LinuxCNC's own index assignment (`tool_table.home_tools`, `#` lines included), the pocket from the fresh pins, unknown refuses — then `standing()` as the last word. TF-2 passes the FILE's bytes as `load`; it owns no copy. Its writer's line rule stands; TF-2 reuses `LINE_BYTES_MAX`. TF-2 starts when that package is merged.

## 1. Contract

### 1.1 Commands

| | `tool_table_preview` | `tool_table_load` |
|---|---|---|
| Payload | none (not queue-safe: dropped on a closed socket) | `base` {`path`, `instance`, `ini`, `link`, `rev`, `memory`} and `removed` [T…], both required, closed shapes |
| Policy | `READ_ONLY_COMMANDS` (free, like the import preview) | gate `toolTableWrite`, effect `input_action`; `COMMAND_SCHEMA`: `ToolLoadBase` (bounded texts; `rev`, `memory` 64 hex), `removed` `Seq(max_len=1000, Num(0…2147483647, integer))` |
| Reads | ONE attempt: bytes (3 signatures), then `owner.link`'s STAT.tool_table and `tool_in_spindle` | the same again, in the write's thread |
| Sends | nothing | one `load_tool_table`; no file, no library |

`base`: canonical path; bound instance; INI; `link` = `<_TRIP_EPOCH>.<Link.seq>`; `rev` = sha256 of the bytes; `memory` = sha256 of LinuxCNC's home entries (canonical, floats exact) plus the spindle tool. Both sides of the difference are bound.

Preview reply: `{ok, base, basis, refusal, saved_at, spindle, removed:[{T, name, Z, D}], changed:[{T, name, fields:[{f, now, file}]}], added:[…]}`; `removed` = `proof.missing`, `added` = `proof.extra`, `changed` = `proof.differs`; `basis` = `partial` / `complete`. With a `refusal` no list. The owner is judged last (LINK_CHANGED discards it).

`get_tool_table` gains `load_refusal` (that function's words, else null) and `owner` {`ini`, `link`} (its read's, judged last like `table`). Nothing else on the wire changes.

### 1.2 Never offered — `tool_proof.load_refusal` (pure; ONE function for preview, read and commit)

First match wins; the order is the priority of causes:

| Group | Observation | Words (≤ 60, measured) |
|---|---|---|
| A nothing known | signatures differ under the read | File changed while read — check again |
| B cut | no final newline: only that, by the comparison / else, and wherever there is no comparison (random changer, tool database, unread controller) | `EDIT_NO_LINE_END` / `EDIT_INCOMPLETE` (a cut file's cause is never named) |
| C form | a CR | Windows line ends in the file — save it without them |
| | a line > `LINE_BYTES_MAX` with its newline (comments too) | Line 12 too long for LinuxCNC — shorten it in an editor |
| | NUL anywhere; a byte outside 0x20–0x7E before the `;` of a tool line | Line 12 has a tab or control character — remove it |
| | `home_tools(data)` (tool-guard's one mirror of io's reader) ≠ the rows' (T, P) at index 1, 2, 3 … — a `#` line with a P word takes a place / anything else it reads otherwise | Line 12 is a # comment with a P word — use ; instead / LinuxCNC reads this file otherwise — check it in an editor |
| | an unread line | Line 12 not readable — fix it in an editor |
| | T / P / Q past signed 32 bit | A T number is past LinuxCNC's integers — correct it / T5: pocket is past LinuxCNC's integers — correct it / T5: Q is past LinuxCNC's integers — correct it |
| | a real not finite | T5: not a finite number — fix it in an editor |
| D scope | random changer | Random tool changer — not loaded from here |
| | tool database / changer type not read | Tool database — LinuxCNC does not use this file / Changer type not read — check the INI |
| E content | 0 bytes or no tool row | No tools in the file — restore it |
| | T or P outside 0–99999; D < 0 | A T number outside 0–99999 — fix it in an editor / T5: pocket outside 0–99999 — fix it in an editor / T5: diameter below 0 — fix it in an editor |
| | T twice in the file; > 1000 rows | T5 twice in the file — remove one, restart LinuxCNC / More than 1000 tools — remove some in an editor |
| F unknown | STAT.tool_table not read / empty tuple; spindle tool not read | LinuxCNC's table not read — try again / Spindle tool not read — try again |
| | the newest write or load job still awaited | LinuxCNC still loads the last change — try again |
| G against LinuxCNC | T twice in LinuxCNC only | LinuxCNC holds T5 twice — restart it |
| | spindle tool ≠ 0 not in the file | T5 is in the spindle, not in the file — restore it |

So a known form error is said before the random changer (whose line names no way out: none is proven), and an unknown controller never hides what is wrong with the file. "restart" stands only in E's "twice … remove one, restart" (LinuxCNC may hold both rows until then) and G's "holds T5 twice" (the file is valid up to there, a start reads it). The general reader stays; only the load admission is this narrow. The admitted set is v2's, so its measurements hold: 356 edge spellings of T / P / Q, 647 + 1623 fuzzed files admitted, all equal in LinuxCNC's compiled reader; Codex's five Q cases right; index i = row i in 1678 of 3000 mixed files admitted; the `home_tools` form of the `#` clause refuses exactly the files whose index differs (2457 equal, 543 refused, `home_tools` equal to the compiled reader in all; at tool-guard `d4b9239f`); 138 of 140 tables on the VM admitted and equal (2 hold unread lines; memory- and spindle-dependent clauses not run over them). Codex repeated the integer, Q and index cases (R478).

### 1.3 Admission of `tool_table_load` (order; no refusal sends anything)

1. Dispatcher: gate, schema, arm. Handler under `_cmd_lock`, owner = `_tool_owner()`; `base.path/instance/ini/link` ≠ the owner's → "Another LinuxCNC or table file — check again".
2. All the rest is the `admit` of `_cmd_blocking(owner.link, op(load_tool_table), wait=None, admit, began)` — in the write's own thread, no await before the NML write:
   a. `_write_admission_refusal(conn_key, tool_table=True, owner=owner)` (no reads for a writer already refused);
   b. one read of bytes, then STAT of `owner.link`: `rev` differs → "The file changed — check again"; `memory` differs → "LinuxCNC's table changed — check again"; `load_refusal` → its words; fresh `missing` ≠ `removed` → "Removed tools not confirmed — check again";
   c. the shared admission again with `load=<those bytes>` (tool-guard: standstill, prepared tool), `standing()` (writer, owner, claims, RFL, load) its LAST word, memory only (MT-I35);
   d. `_cmd_blocking`'s second Link check, then the write.
3. The JOB (next `seq`; scan, owner, rev, basis) is booked in the section awaited through `_thread_to_end`. No watch baseline is touched (no file was written).

No automatic retry; no second request on a timeout, a reconnect or a Link change; no other Link is asked.

### 1.4 What is observed afterwards (`_confirm_tool_write` extended; outside `_cmd_lock`; 2 s bound, cooperative)

`values: "shown"` when **V** (rule R complete for the bound bytes, STAT of the job's owner) and then **S** (one whole `_tool_files_attempt` of that owner: `complete` and the same `rev`) hold, the owner unchanged, the job the newest. It says exactly: LinuxCNC's table shows the values (T, X…W, D, I, J, Q within TOL) of this file revision. It says nothing about a load, a pocket or a remark: F6, F8, F9. On a `complete` basis V holds before the request and a wait can add nothing: the REPLY goes out at once (`values: "not awaited"` — 2 s would hold this client's own queue, its `spindle_stop` included, behind nothing), the JOB still runs to the bound and pings at its end, so a failed open (F2) is read. On a `partial` basis the reply waits as an edit's does (tens of ms; at most the bound, the cost R465 names).

Otherwise `values: "not shown"` with `why`: in time / file changed (a round sees another `rev`: ends at once) / controller changed / superseded / unknown (the write raised once begun, the wait failed, the gateway ends). Nothing is sent again.

### 1.5 Replies

| Reply | Meaning |
|---|---|
| `ok: false, error` | nothing reached LinuxCNC (a refusal; preempted before the write began) |
| `ok: true, load: "requested", values: "shown", basis` | requested; the values show |
| `ok: true, load: "requested", values: "not shown", why` | requested; they do not (reason) |
| `ok: true, load: "requested", values: "not awaited", basis` | a `complete` basis (§1.4), or this client's wait was cut (abort, E-Stop, disconnect — `_preempted_tool_wait`, as a written edit); the job goes on |

LinuxCNC's abort may drop a request still queued. Every end of the newest job bumps the table version once, so every client reads again. Traces: `tools.load_refused`, `tools.load_requested` (seq, rev, basis, counts, removed ≤ 20), `tools.load_values_shown` / `tools.load_values_not_shown` (why, ms). The vocabulary has no "confirmed" and no "loaded".

## 2. UI

### 2.1 Where

| Place | Form | When |
|---|---|---|
| `[data-read-state]` (partial read) | "Load table" left of Retry, both in one `.row-tight` | `load_refusal` null |
| `[data-write-state]` | "Load table" left of the X | its load part shows and `load_refusal` is null |
| Tools › More, after Upload | "Load table", always present | disabled with `load_refusal` as `:reason`; the way for a pocket / remark change |

`MachineBtn type="fileBrowse"` (gate `always`: a preview, a read), `read` in `controlInventory.ts`. A press disables it ("Comparing with LinuxCNC — wait") until the preview's reply; the dialog opens complete, nothing grows under a press. A refused preview opens no dialog (error note at the tab).

### 2.2 The dialog (`ToolLoadDialog.vue`, new; `DialogFrame kind="form" size="md" wide initialFocus="safe"`)

| Part | Component |
|---|---|
| counts, what is not compared, the irreversible line | plain text, `.settingDesc` |
| spindle line; `complete`-basis line | `.statusNote.warn` |
| the list, 2 columns (Tool, Change), removed → changed → added | `.dataTable` + `vStickyHead` in `.dialogContent scroll-thin`; 200 rows, 200 more when the end comes into view (IntersectionObserver); the counts above name all |
| acknowledgement, only with removed tools | `MachineToggle gate="toolEdit"` above the actions; OFF → confirm disabled "Confirm the removed tools first"; reset by every new preview |
| Cancel | `dialogCancel`, outside the Gate, disabled while busy |
| Load table | `<Gate gate="toolTableWrite">` + `toolDanger` when anything is removed or changed (title `danger` too), else `toolSave` |
| refused / stale | `.statusNote.error` / `.warn` + `retry` "Check again" |

Stale: a `tool_table_changed` ping or a closed connection while open and not busy disables the confirm button, resets the acknowledgement, shows the note; the list never changes by itself. Commit: `fire(…, "toolTableWrite")` + `awaitReply` (60 s); reply lost → `writeUnknown()`, confirm closed until "Check again". Narrow / touch: two columns, values wrap (one scoped layout rule as the panel's `.colDesc`), 44 px buttons, `sidewaysOverflow` guard. **No new global CSS, no new catalog type.**

### 2.3 Texts of the dialog

| Where | Text |
|---|---|
| Button / busy | Load table / Requesting… (`busyLabel` Request in progress) |
| Title | Load tool table into LinuxCNC? |
| Counts | tool.tbl, saved 14:02:11: 2 removed, 1 changed, 3 added. / … : same tools and values as LinuxCNC. |
| Not compared | Pockets and remarks are not compared. The tool library stays as it is. |
| `complete` basis | LinuxCNC shows no pockets or remarks — whether it takes them cannot be shown. |
| Irreversible (removed or changed) | LinuxCNC's values of these tools are replaced. This cannot be undone. |
| Spindle tool changed | T5 is in the spindle — its offset in effect stays until the next G43. |
| Row | Removed · Z −49.123 · Ø 6 / Z −49.123 → −50 · Ø 6 → 6.35 / Added · Z … · Ø … |
| Toggle | Remove 2 tools from LinuxCNC |
| Stale | Compared with LinuxCNC before — check again / Connection lost — check again |
| Refused (dialog or tab, error) | Not requested: <reason>. |
| Client reasons | Gateway lacks this — restart it / Tool table not read — retry |

### 2.4 Edit refusal and read note (`partial_reason`)

It asks `load_refusal` first (the edit keeps its own words for "File changed while read — nothing written; read again" and "LinuxCNC still loads the last change — try again"); only a loadable file gets the difference words:

| Loadable file | Words |
|---|---|
| tools only missing | T5 not in the file — restore it, or load the file / 3 tools not in the file — restore them, or load the file |
| otherwise different | T5 differs from LinuxCNC — load the file or restart / 3 tools differ from LinuxCNC — load the file or restart |

### 2.5 The result note (`[data-load-state]`, under the write note, dismissable)

The page keeps of its request only `{base, basis, values, why}` from the reply. What it SAYS is computed from the read on screen, never from the reply alone:

| Read on screen | Note |
|---|---|
| none (closed connection, read under way after a reconnect) | nothing; what is kept stays kept |
| **shows it**: `table.path` / `table.instance` / `owner.ini` / `owner.link` = `base`'s, `rev.table` = `base.rev`, proof `complete` | ok: "Load requested. LinuxCNC now shows the file's tool values; pockets and remarks are not compared." — `complete` basis: "Load requested. LinuxCNC shows the file's tool values, as before; pockets and remarks are not compared." |
| same owner, does not show it, and no read has shown it yet (also a failed read) | warn: "Load requested, values not shown — LinuxCNC did not show them in time. / … the file changed meanwhile. / … a newer table write came. / … its outcome is unknown." / (the reply said shown) "… the table changed since." / "Load requested, not awaited — the table shows the result." |
| another owner (path, instance, INI or Link each) | gone for good — only `why` = controller changed, never shown, says so until dismissed: "Load requested, values not shown — connection to LinuxCNC changed." |
| once shown, a read that does not show it (failed reads included) | gone for good |

So the positive note lives exactly as long as reads under its owner show it; a pure WebSocket reconnect keeps it only with a read that shows it again; a late load turns the warn form into the positive one, because the read then shows it. The next request or write, and the X, end it. A lost reply leaves no result note (the dialog says the outcome is unknown). **The word "requested" stands once:** while the write note's load part shows with its requested head (§3), the result note drops its lead — "LinuxCNC now shows the file's tool values; pockets and remarks are not compared." / "Values not shown — …". Every page derives it alike, but only the requesting page has a request to speak of.

## 3. The open-write note

**TF-2 never ends it and never hides it.** It ends as before (dismissed, the next write, another table file) and is hidden as before (its load part beside a `partial` read, R472) — so after a request whose values show, a hidden load part REAPPEARS (the read is `complete` now), with its requested words; that is the normal end of TF-1c, and the X ends it. What changes is its wording, always head + tail:

| Head (first match) | When |
|---|---|
| Table saved, load requested but not confirmed | this page sent a load request for this path after the write, and the last read that named an owner named the request's |
| Table saved, load not confirmed | another LinuxCNC since (`earlier`, sticky as before; a request under the former owner no longer counts), or a request whose reply was lost: neither "failed" nor "requested" is known |
| Table saved, load into LinuxCNC failed | the write's own outcome, nothing requested since |

| Tail (first match, by the read on screen) | Text |
|---|---|
| 1 the file is known not loadable (groups B, C, E, G) | `. <its words>.` |
| 2 the scope (D) | `. <its words>.` — no invented way out |
| 3 the read is unknown: failed, or groups A / F | ` — read again.` |
| 4 loadable | ` — load table or restart.` |
| a gateway without `load_refusal` | today's words |

The tail changes today's words also where nothing was requested: "restart loads it" (R472) becomes tail 1–4; under a random changer or a tool database no way out is named any more.

Priority when several hold: `load_refusal` is already ordered (form before scope, file before unknown controller), so the tail never depends on which note line is read first; a lost reply or an earlier good preview is no knowledge of today's file. A request never turns "not confirmed" into "failed" or into "loaded"; matching values do not end the note (they say nothing of its pocket or remark). The metadata part keeps its own words in front, as today.

## 4. Safety

| Case | Answer |
|---|---|
| Gate | `toolTableWrite`; E-Stop and off allowed (F5; lag measured: 301 ms off, 518 ms E-Stop) |
| Moving, prepared tool | tool-guard, inside the same admission (§1.3 c) |
| Running / paused / start claim / RFL / load, M6 pending | refused by the shared admission |
| Offset in effect | unchanged until the next G43 (F4); index 0 and #5401–#5413 take the new row; the Tool strip's "In effect" already says it. `save_tool` on the spindle tool has the same effect today, so a changed spindle tool is loadable with the warn line |
| Toolsetter / M600 | not reachable while one runs; afterwards M600 and `#3103` use the values shown. BEFORE the request any G10 L1 (an M600) rewrites the file from LinuxCNC's old table: the hand edit is lost, `rev` differs, the request refuses |
| Foreign NML writer | not excluded: before the send caught by `rev` / `memory` except in the last microseconds; after it by S where its save succeeded; a refused save (F9) only makes values match, which is all that is said |
| Edits after it | admitted as soon as rule R is complete — as after any write; R proves no pocket, and the next saved edit rewrites the whole file and asks for its own reload |
| Preview, parameters, simulation mode | an input write (generation, observer "tool_table"), drift re-parses at idle after 2 s; task's synch rewrites the var file as with every edit; `toolTableWrite` stays open in simulation. `previewWait` label "the tool table load" |
| F2 | LinuxCNC's table empty, abort and spindle stop by LinuxCNC; "does not show the file's values"; the restored file is loadable again |

## 5. Guards, mutations, native, files

**Backend — the four sequences (real WS path, a fake io with separate put / save / load):**

| Sequence after the same request | `values` | Nowhere |
|---|---|---|
| the load runs | shown | "loaded", "confirmed"; the write note ended |
| the load is dropped, nothing else | not shown (in time) | a success |
| **dropped load + foreign put of exactly the differing values + refused save** | shown — values only; reply, trace and texts name no load; the pocket kept is the old one | a load success, an ended or hidden write note |
| foreign put with a successful save | not shown (file changed) | a success |

plus: `complete` basis with the load run, dropped, and the table emptied (F2); removal; TF-1c with a Z and with a pocket only; byte-equal file, library, watch baseline; exactly one NML call on the owner's Link; each refusal of 2a / 2b / 2c held at its read with disarm, unregister, Link, INI, instance changed there; file or memory changed between preview and commit; `removed` too short / too long; spindle tool gone; tool-guard reached with the FILE's bytes (same index and T, other pocket red; only Z changed green); job awaited; NML raises once begun; abort / E-Stop of another client before the write, in the section, in the wait, twice; nothing sent again. Pure (`test_tool_load.py`): every §1.2 row red without its clause; **the ORDER by pairs** — long line + random changer, CR + unread controller, Q overflow + job awaited, no rows + unread controller, bad line + difference, cut file + everything, twice in LinuxCNC + spindle missing —; T / P / Q edges and form cases against the compiled reader's golden, the index included; both directions of the differences; `memory` per field and the spindle tool. A vocabulary guard over every TF-2 text, reply value and trace: no "loaded" / "confirmed" as an outcome.

**Frontend.** `toolLoad.test.ts`: §2.5 row by row — shows / does not / owner change by path, instance, INI, Link each alone / revision / partial / failed read / no read / late load / once shown then not; a pure WS reconnect of the same owner, with a read that shows it and with one that does not. `toolTableRead.test.ts`: §3 as the full product of 3 heads × 5 tails plus the overlaps — requested, then the file becomes a long line; requested + failed read; random changer + long line; `earlier` + requested under the old owner; metadata with each — and today's hiding unchanged. `commandShapes`, `commandPath`, `controlInventory`; `tool-load.spec.ts`: the three places, list and counts, 1000 + 1000 rows in portions, acknowledgement and reset, danger, Cancel while disarmed, stale by ping and socket, payload exactly `base` + `removed`, one run of each note through real frames (A's positive note gone under B with the same path and a `complete` read; kept over a socket loss), the write note standing after shown values, 100 / 150 % portrait and touch, no box moves while it compares; a `dialogs.spec` row. Mock defaults in the same commit.

**Mutations (≈ 45):** drop each of `rev`, `memory`, `removed`, path / instance / ini / link; admission before the reads only; `standing()` not last; `_stat_now()` for the owner's STAT; reads outside `admit`; send on `link()`; `load=` left out or given other bytes; each §1.2 clause and each neighbouring pair of its order swapped; V, S, owner, newest each dropped; the job of a `complete` basis ended at once; its reply awaiting the bound; early end on a changed `rev` dropped; retry on timeout; second request after reconnect; a file or library write added; `ok: true` for a refusal; preempt raising after the write; page: each of the four owner fields and the revision dropped from "shows it", shown kept over a read that does not, the reply alone giving the positive note, the write note ended / hidden by shown values, each head and tail swapped, tail 4 before 1 or 3, acknowledgement not reset, confirm open while stale, offered with a refusal, both notes saying "requested", a lost reply counted as requested.

| Contract case (R471) | Backend | Browser | Native |
|---|---|---|---|
| foreign change, values shown | ✓ | ✓ | N1 |
| acknowledged removal | ✓ | ✓ | N2 |
| change between preview and commit | ✓ | stale note | N3 |
| change after NML delivery | ✓ | note | N4, N6 |
| foreign Link / instance / INI | ✓ (only layer: a bound gateway never meets a second one natively) | note gone | – |
| refused / failed request | ✓ | ✓ | N3, N9 / N6 |
| own commit repeated (TF-1c) | ✓ | write note's words | N7 |
| abort during the wait | ✓ | ✓ | N11 |
| refused save after a dropped request (R478) | ✓ | ✓ | N12 |

**Native** (VM sim, run tree, user service, restore proven; 3-axis; only the run's own `io` is held, SIGSTOP ≤ 3 s):

| N | Case | Pass |
|---|---|---|
| 1 | hand edit (changed + added), request | partial → requested, values shown → complete → an edit admitted |
| 2 | removal acknowledged | STAT without the tools; library unchanged |
| 3 | file changed between preview and commit | refused, STAT unchanged |
| 4 | `io` held, request, then (a) the file changed by hand, (b) `G10 L1` of a second NML client; `io` on | "file changed"; the next read is the truth |
| 5 | `io` held 3 s | not shown at 2 s, nothing sent again; the later read shows it and the note turns |
| 6 | `io` held, file moved away, `io` on | table empty (F2), file back → request → values shown |
| 7 | TF-1c: commit B, hand-restore A and request A, hand-restore B's bytes, request — with a Z and with a pocket only | values shown / "as before"; the write note stands with its requested words |
| 8 | T5 in the spindle with G43, its Z changed, request | `STAT.tool_offset` unchanged, index 0 new; after G43 the new value |
| 9 | during a jog; tool-guard's prepared tool with a hand-edited file | refused, nothing sent |
| 10 | E-Stop; off; 1000 tools in both | values shown, lag against 2 s reported |
| 11 | abort of a second client in the wait | `not awaited`, then the read |
| 12 | refused save: hand edit `T5 P9 Z11`, the table made read-only for io's user (0444 in the copy), `io` held, request, abort (that it drops the request is shown by the pocket pin, else the case is void), `io` on, `G10 L1 P5 Z11` | STAT shows Z 11, the file unchanged, `tool-prep-pocket` after `T5` the OLD pocket; page: values shown only, no load success, write note unchanged |

Before the machine update: `load_refusal` over a copy of the machine's real `tool.tbl`.

**Files.** Gateway: `tool_proof.py`, `gateway.py` (`_ToolWriteJob`, new `_send_tool_load`, `_confirm_tool_write`, `_after_tool_write`, `_tool_files_attempt` with the owner's STAT, `_read_tool_files`, `_cmds_tool_table`), `command_policy.py`, `tool_io_fixture.py`; touched tests `test_tool_proof*`, `test_tool_commit_gateway`, `test_tool_guard_gateway`, `test_payload_contract`, `test_command_policy`, `test_calc_lifetime_wiring`. Registrations: the command as `renumber_tool`, the read as `get_tool_table`. Web: `ToolLoadDialog.vue`, `toolLoad.ts` (new), `toolTableRead.ts`, `ToolTablePanel.vue`, `App.vue` (More), `lcnc.ts`, `previewWait.ts`, `controlInventory.ts`, `commandPath.test.ts`, `commandShapes.test.ts`, `mock-gateway.mjs`. Old words asserted in `test_tool_proof.py`, `test_tool_proof_gateway.py`, `test_tool_commit_gateway.py`, `toolTableRead.test.ts`, `tool-table-read.spec`, `tool-import.spec`, `p6tf.native.py`, `docs/ui-glossary.md`, `functions.json`. `rules.py`: two web files and `tool-load` into TOOLS. Inventory F-TOOLLOAD; `funktionen.md` rendered. Docs: CLAUDE.md, `safety-and-permissions.md`, `ui-patterns.md`, `frontend-modules.md`, `decisions.md`, `testing.md`.

**Build order:** 0 tool-guard merged; 1 `load_refusal` + order + golden + words; 2 policy / schema / registrations; 3 preview and read fields; 4 send + admission; 5 observation; 6 page (note functions first); 7 docs, inventory, mutations, round gate, native.

**Size:** gateway ≈ 280 lines (v2: 340), web ≈ 380, tests ≈ 1500, native ≈ 320.

**Limits (named):** no claim that LinuxCNC loaded anything; pockets and remarks are never shown or compared; values can match for another reason (F9); STAT reads are no atomic snapshot; 2 s is cooperative and a request can run after it; a foreign NML writer is not excluded; the form rule is conservative (124 of 496 refused edge files read alike); the numbers of §1.2 are v2's probes, its ORDER is not probed; random changer, tool database and a tool LinuxCNC holds twice are not served; `iov2` from source only; F2's abort and spindle stop are LinuxCNC's. Older and unchanged: an ordinary edit's own `reload: confirmed` is V alone, so for a pocket-only edit it is as weak as before (R472) — a word this package no longer uses for itself.

## 6. Open

**Codex:** (1) the reduced statement (§1.4 / §2.5) and the derivation from the read; (2) §3's head × tail and the order of §1.2; (3) the `#` refusal, now stated through `home_tools`: the prepared-tool rule no longer needs it — keep as caution (planned) or let such files through?; (4) the ordinary edit's word "confirmed" (limits above): leave it, or bring it to the same vocabulary as its own change?
**Operator, Q-TF2-1 (unanswered):** may the action also remove tools, behind the switch and the danger button? Recommendation: yes; never the tool in the spindle. Q471-1 is assumed, not answered.

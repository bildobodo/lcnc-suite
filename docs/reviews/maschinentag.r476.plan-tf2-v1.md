# TF-2 — load the tool table file into LinuxCNC (plan v1, 2026-11-25)

Base: development `24f3bd3a`, worktree `~/lcnc-suite-tf2` (`feat/tf2`). Contract source: Codex R471 "Antwort TF-2" (four points), R468 TF-1c, R465 (no automatic repair), R472–R475 (the open-write note). Q471-1 assumed yes. No product code written.

**In one sentence:** the operator compares the file with LinuxCNC's table, confirms the named differences, and the gateway sends exactly one `load_tool_table` on the connection the comparison was made on; it writes no file and no library, and answers requested / confirmed / unconfirmed apart.

**Sources.** LinuxCNC 2.9.4 in `~/claude-work/bg/upstream-2.9.4/src/emc` (`SHA256SUMS` / `task_ini.SHA256SUMS`: every file cited below checked OK; `taskintf.cc` has no recorded sum). Probe of this plan: `~/claude-work/p6/tf2/oracle/` (upstream `tooldata_common.cc` unchanged, sha `ae1e5120…`, compiled; only the mmap stubbed) and `test_form_rule.py` (3 passed in `lcnc-gateway/`, `-p conftest`).

## 0. Facts from the source that shape the contract

| # | Fact | Source | Consequence |
|---|---|---|---|
| F1 | The load is a PATH job: io clears the whole table, then opens the file it was configured with, at some later io cycle | `ioControl.cc:974–985`, `tooldata_common.cc:271–340` | no byte proof by the hash; the file is read again after the load (§1.4) |
| F2 | io clears BEFORE `fopen`; a failed open leaves LinuxCNC's table EMPTY, `RCS_ERROR`, task aborts everything and stops the spindle | `tooldata_common.cc:296,299`; `emctaskmain.cc:3473–3520` | a named limit; the way back is a second load of the restored file (N7) |
| F3 | Index 0 (spindle) is cleared too; `reload_tool_number` restores it by T number — only when the file holds that T. `toolInSpindle` keeps the number | `ioControl.cc:598–610` | a spindle tool missing in the file is never loadable |
| F4 | `pocketPrepped` is a table INDEX; a load re-assigns indices in file order; M6 then takes the tool at the old index. It is reset only by a finished change (and at start), not by an abort, so > 0 can be a resting state | `ioControl.cc:629–653, 792, 938–960` | a prepared index must hold the SAME tool after the load (§1.3 c), else refuse. Edits and the import have the same hole today (question 2) |
| F5 | `Interp::synch` reads the table and the #5400 block; neither writes `tool_offset` (G43/G49/G43.1/.2 and init do; G20/G21 re-read the canon's own offset in the new unit, not the table) | `rs274ngc_pre.cc:2010–2063, 1329–1338, 1209`; `interp_convert.cc:5651 ff., 2716–2799` | the offset in effect stays until the next G43; native owed (N9) |
| F6 | Task takes the command in ESTOP / OFF / ESTOP_RESET (any mode), ON + MANUAL, ON + AUTO idle, ON + MDI; it is queued, waits for motion AND io done, then the parameter synch follows | `emctaskmain.cc:854, 978, 1094, 1442; 1553–1557` | E-Stop and machine off stay allowed; a load sent while something moves (a jog) runs LATER — standstill is required (§1.3) |
| F7 | `emcToolLoadToolTable` returns 0 whatever `sendCommand` did; the binding sends an empty file name (= the INI's table) | `taskclass.cc:719–728`, `emcmodule.cc:1098–1104` | "sent" proves nothing; the confirmation does |
| F8 | io's reader ≠ the gateway's: a line > 255 bytes is read as TWO lines, a tab / CR / non-ASCII byte outside the remark can make it skip the line, T past int32 wraps | `tooldata_common.cc:69–230, 316` | the form rule (§1.2) |

F8 measured with the compiled source: CRLF with a space before it loses the tool; a 300-byte remark line yields a ghost T9; a long COMMENT line yields a ghost T7; leading or trailing tab / NBSP loses the tool. Form rule: 1623 fuzzed files admitted, all read identically by both; of 140 tables on the VM, 138 pass the FORM clauses and no-unread-line and read identically, the other 2 hold unread lines (the remaining clauses of §1.2 were not run over them). **Found on the way (older, not this package):** the suite's own writer can produce such a line — a remark within the 255 characters the command admits gives a 266-byte line, LinuxCNC then holds a ghost T9 (shown). Named for a follow-up (cap the LINE at 255 bytes in `write_tool_table`).

## 1. Contract

### 1.1 Commands

| | `tool_table_preview` | `tool_table_load` |
|---|---|---|
| Payload | none (not queue-safe: dropped on a closed socket) | `base` {`path`, `instance`, `ini`, `link`, `rev`, `memory`} and `removed` [T…], both required, closed shapes |
| Policy | `READ_ONLY_COMMANDS` (free, like the import preview) | gate `toolTableWrite`, effect `input_action`, `COMMAND_SCHEMA`: new `ToolLoadBase` (texts bounded; `rev`, `memory` = 64 hex), `removed` `Seq(max_len=1000, Num(0…2147483647, integer))` |
| Reads | ONE attempt: bytes (3 signatures), then `owner.link`'s STAT.tool_table, `tool_in_spindle` | the same, again, in the write's thread |
| Sends | nothing | one `load_tool_table`, no file, no library |

`base` names: the table's canonical path; the bound instance; the INI; `link` = `<_TRIP_EPOCH>.<Link.seq>`; `rev` = sha256 of the bytes; `memory` = sha256 of LinuxCNC's home entries (canonical, floats exact) plus the spindle tool. So the differences are bound on BOTH sides (the bytes alone pin one).

Preview reply: `{ok, base, refusal, saved_at, spindle, removed:[{T, name, Z, D}], changed:[{T, name, fields:[{f, now, file}]}], added:[{T, name, Z, D}]}`. `removed` = `proof.missing`, `added` = `proof.extra`, `changed` = `proof.differs` (values from memory and row). With a `refusal` there is no list (no claimed difference on an unknown basis). `name` = library description or remark, display only. The owner is judged last, like `_read_tool_files` (LINK_CHANGED discards it).

`get_tool_table` gains `load_refusal` (why this file is not loadable, else null — the same function) and `loaded` {epoch, seq} | null (§3). The written-table replies (4 WS edits, import) gain `write` {epoch, seq}.

### 1.2 Never offered (`tool_proof.load_refusal`, pure; preview, read and commit use the one function; first match)

| Observation | Words |
|---|---|
| random changer (not subject to the Q468-1 switch) | Random tool changer — only a restart loads the file |
| tool database | Tool database — LinuxCNC does not use this file |
| changer type not read | Changer type not read — check the INI |
| STAT.tool_table not read / empty tuple | LinuxCNC's table not read — try again |
| signatures differ under the read | File changed while read — check again |
| the newest write / load job still awaited (any bytes) | LinuxCNC still loads the last change — try again |
| 0 bytes or no tool row (io's truncate state; a header-only prefix) | No tools in the file — restore it |
| no final newline, everything else equal / otherwise | `EDIT_NO_LINE_END` / `EDIT_INCOMPLETE` (existing) |
| a CR anywhere | Windows line ends in the file — save it without them |
| a line > 255 bytes with its newline (comments too) | Line 12 too long for LinuxCNC — shorten it in an editor |
| NUL anywhere, or a byte outside 0x20–0x7E before the `;` of a tool line | Line 12 has a tab or control character — remove it |
| an unread line | `_line_reason` (existing) |
| T outside 0–99999 (`TOOL_NUMBER_MAX`) | A T number outside 0–99999 — fix it in an editor |
| P outside 0–99999 / D < 0 (the edits' own bounds) | T5: pocket outside 0–99999 — fix it in an editor / T5: diameter below 0 — fix it in an editor |
| a value not finite | T5: not a finite number — fix it in an editor |
| T twice in the file / only in LinuxCNC | existing words (twice in LinuxCNC stays a restart: `compare` has no honest row for it) |
| > 1000 rows | `EDIT_TOO_MANY` |
| spindle tool ≠ 0 not in the file | T5 is in the spindle, not in the file — restore it |
| spindle tool not read | Spindle tool not read — try again |

A `complete` read is loadable too (pockets and remarks; §3).

### 1.3 Admission of `tool_table_load` (the WS name is not the binding's `load_tool_table`, which traces and generations already use) — order; no refusal sends anything

1. Dispatcher: gate, schema, arm. Handler under `_cmd_lock`, owner = `_tool_owner()`; `base.path/instance/ini/link` ≠ the owner's → "Another LinuxCNC or table file — check again".
2. Everything else is the `admit` of `_cmd_blocking(owner.link, load_tool_table, wait=None, admit, began, written)`, so it runs in the write's own thread with no await before the NML write:
   a. `_write_admission_refusal(conn_key, tool_table=True, owner=owner)` — no reads for a writer already refused;
   b. one read of bytes, then STAT of `owner.link`; `rev` differs → "The file changed — check again"; `memory` differs → "LinuxCNC's table changed — check again"; `load_refusal` → its words; fresh `missing` ≠ `removed` → "Removed tools not confirmed — check again";
   c. `_write_admission_refusal(…, tool_load=True)`: fresh poll, idle, reader, M6, and after that poll, from the polled object only: standstill (`motion_still_of`; unread refuses: "Machine motion not read — try again" / "Machine moving — load once it stands"), the prepared tool (`STAT.pocket_prepped` None: "Prepared tool not read — try again"; i > 0 with another tool at `STAT.tool_table[i]` than in the file's i-th tool row, or a `#` line in the file, which can take an index: "A tool is prepared — finish its change or send T0" — a value edit in place passes, so this is a reorder / remove / insert case only). `standing()` (writer, owner, claims, RFL, load) stays the LAST word, memory only (MT-I35);
   d. `_cmd_blocking`'s own second Link check, then the write.
3. `written` books serial and time; the JOB (next `seq`, scan, owner, rev, the file's signature from 2b, serial, sent time) is booked inside the section awaited through `_thread_to_end`. No watch baseline is touched: the gateway wrote no file.

No automatic retry, no second reload on a timeout, a reconnect or a Link change; no other Link is ever asked.

### 1.4 The proof after sending (`_confirm_tool_write` extended; outside `_cmd_lock`, bound 2 s, cooperative as today)

`confirmed` needs ALL of: **V** rule R complete for the bound bytes, read after the send; **S** the file read again after V: same signature (dev, inode, mtime_ns, size) AND same `rev` as in 2b; owner unchanged; newest job; and **L**, that a load happened after the send:
- the admission read (2b) was `partial` (loadable = only changed, missing or added tools): V itself is the transition — only a load of this unchanged file makes every row equal (a G10 L1 would rewrite the file: S);
- it was `complete` (pocket / remark only, V vacuous): LinuxCNC finished EXACTLY this command — a poller poll begun after the write on the same Link with echo **==** this serial, RCS_DONE, interpreter idle (`_poll_record` gains state and interp; `controller_done` alone takes echo ≥ serial, and an abort's own DONE satisfies that), and `task_state` as at the admission. A later echo seen first ends it: "another command came".

Any round that sees another file signature ends it at once. Limit of L in the `complete` case: an abort inside task itself without a `task_state` change (an io or motion error in those cycles) drops the queued load and is not seen.

### 1.5 Replies

`ok: true` = the request went out; `ok: false` = nothing reached LinuxCNC. `load` is:

| `load` | meaning | `why` |
|---|---|---|
| confirmed | §1.4 | – |
| unconfirmed | sent; not proven | not shown / file changed / controller changed / another command / linuxcnc error / superseded / unknown (NML raised once begun, the wait failed, gateway ends) |
| not awaited | this client's wait was cut | – |

Abort / E-Stop: before the write begins → preempted as today, nothing sent. After it → the reply is the request's `ok: true, load: "not awaited"` (`_preempted_tool_wait`, as a written edit); the job goes on. LinuxCNC's abort drops a load still queued (task's list; io's command buffer — N8 shows whether): a job on a `partial` basis can then still end confirmed only if its values came, one on a `complete` basis ends "another command". The next read says what it holds. Every end bumps the table version once (newest job), so every client reads again. Traces: `tools.load_refused` (reason), `tools.load_sent` (seq, rev, counts, removed ≤ 20), `tools.load_confirmed` / `_unconfirmed` (why, ms).

## 2. UI

### 2.1 Where

| Place | Form | When |
|---|---|---|
| `[data-read-state]` note (partial read) | "Load table" left of Retry, both in one `.row-tight` | `load_refusal` null |
| `[data-write-state]` note | "Load table" left of the X | its load part stands |
| Tools › More, after Upload | "Load table", always present (the menu never changes size) | disabled with `load_refusal` as `:reason`; the only way for a pocket / remark change (a `complete` read shows no note) or a dismissed note |

All three are `MachineBtn type="fileBrowse"` (gate `always`: opens a preview, a read), classified `read` in `controlInventory.ts`. A press disables it ("Comparing with LinuxCNC — wait") until the preview's reply; the dialog opens with its content complete, so nothing grows under a press. A refused preview opens no dialog: error note at the tab.

### 2.2 The dialog (`ToolLoadDialog.vue`, new; `DialogFrame kind="form" size="md" wide initialFocus="safe"`)

| Part | Component |
|---|---|
| counts line, what is not compared, the irreversible line | plain text, `.settingDesc` |
| the spindle line | `.statusNote.warn` |
| the list, 2 columns (Tool, Change), removed → changed → added | `.dataTable` with `vStickyHead` inside `.dialogContent scroll-thin`; the first 200 rows, 200 more when its end comes into view (IntersectionObserver); all counts stand above it, so nothing is hidden silently |
| acknowledgement, only with removed tools | `MachineToggle gate="toolEdit"` right above the actions; OFF → confirm button disabled, "Confirm the removed tools first"; reset by every new preview |
| Cancel | `dialogCancel`, outside the Gate, disabled while busy |
| Load table | `<Gate gate="toolTableWrite">` + `toolDanger` when anything is removed or changed, else `toolSave`; title `danger` likewise |
| refusal / stale | `.statusNote.error` / `.warn` + `retry` "Check again" |

Stale rule: a `tool_table_changed` ping or a closed connection while the dialog is open (not busy) disables the confirm button, resets the acknowledgement and shows the stale note; the list never changes by itself under the operator. `busy` until the reply: nothing closes. Commit: `fire(…, "toolTableWrite")` + `awaitReply` (60 s), like the edits; reply lost → existing `writeUnknown()` text, confirm stays disabled until "Check again".

Narrow / touch: two columns, values wrap (one scoped layout rule, `overflow-wrap: anywhere`, as the panel's `.colDesc`; `sidewaysOverflow` guard), md buttons 44 px, the `md.wide` cap in 150 % portrait. **No new global CSS.** No new catalog type.

### 2.3 Texts (all reasons ≤ 60, measured: `p6/tf2/texts.py`)

| Where | Text |
|---|---|
| Edit refusal, loadable file: tool missing | T5 not in the file — restore it, or load the file / 3 tools not in the file — restore them, or load the file |
| Edit refusal, loadable: difference | T5 differs from LinuxCNC — load the file or restart / 3 tools differ from LinuxCNC — load the file or restart |
| the same, NOT loadable | today's words ("… a restart loads the file", "… restart drops it") |
| Write note | Table saved, load into LinuxCNC failed — load table or restart. / Table saved, load not confirmed — load table or restart. |
| Button / busy | Load table / Loading… (`busyLabel` Load in progress) |
| Title | Load tool table into LinuxCNC? |
| Counts | tool.tbl, saved 14:02:11: 2 removed, 1 changed, 3 added. — equal: … same tools and values as LinuxCNC. |
| Not compared | Pockets and remarks are not compared; loading takes them too. The tool library stays. |
| Irreversible (removed or changed) | LinuxCNC's values of these tools are replaced. This cannot be undone. |
| Spindle tool changed | T5 is in the spindle — its offset in effect stays until the next G43. |
| Row | Removed · Z −49.123 · Ø 6 / Z −49.123 → −50 · Ø 6 → 6.35 / Added · Z … · Ø … |
| Toggle | Remove 2 tools from LinuxCNC |
| Stale | Compared with LinuxCNC before — check again / Connection lost — check again |
| Refused (dialog or tab, error) | Not loaded: <reason>. |
| Confirmed (`.statusNote.ok`) | LinuxCNC loaded the tool table. |
| Unconfirmed (warn) | Load requested, not confirmed — LinuxCNC did not show it in time. / … the file changed meanwhile. / … connection to LinuxCNC changed. / … LinuxCNC reported an error. / … a newer table write came. / … another command came first. / … its outcome is unknown. |
| Not awaited (warn) | Load requested, not awaited — the table shows the result. |
| Client reasons | Gateway lacks this — restart it / Tool table not read — retry |

The result note is ONE `[data-load-state]` slot under the write note, dismissable, set with the read that follows (never before it); gone with the next load or write, another table file, and — confirmed only — with any read that is not `complete`. An unconfirmed load keeps its note beside a partial read: the request (it may still run) and the present difference are two facts.

## 3. What ends the open-write note (`toolWriteStands`, load part only)

| Observation | Settles it? |
|---|---|
| a read naming the same path, the same gateway epoch and `loaded.seq` > the note's `write.seq` | **yes** — `loaded` is the newest job that ended `confirmed` as a LOAD (V + S + L). It was sent after the write's section ended (one `seq` under `_cmd_lock`); values by R, pocket and remark because io loads the whole file in one pass and the file was the same from before the send until after (S, L) |
| V alone (a `complete` read), a finished command without S, "sent" | no (R holds no pocket or remark; F1, F7) |
| unconfirmed / not awaited / superseded / file or controller changed | no |
| another instance, a reconnect, another gateway epoch, no identity | no, as today (`earlier` wording) |
| a confirmed EDIT's write on another page | no (as today; on the own page the next write takes the note's place) |
| dismissed / next write / another table file | ends, as today |

The proof travels in the READ, not in the loading page's reply: it reaches every page and survives a lost socket (the class of MT-I43). The metadata part is never settled by a load. Limit: "unchanged" is dev / inode / mtime_ns / size / hash — a foreign writer that writes and restores the same bytes within one mtime tick is not seen.

## 4. Safety

| Case | Answer |
|---|---|
| Gate | `toolTableWrite` (armed, interpreter known idle, no M6 request, fresh reader); E-Stop and off allowed (F6; lag measured before: 301 ms off, 518 ms E-Stop). Standstill and the prepared tool are judged at the send only — rare, no new permission class |
| Program / MDI running, paused, start claim, RFL, load / unload, M6 pending | refused by the shared admission, existing words |
| Offset in effect | unchanged until the next G43 (F5); index 0 and #5401–#5413 take the new row; the Tool strip's "own offset not in effect" already says it. `save_tool` on the spindle tool is the same effect and allowed today, so a changed spindle tool is loadable with the warn line |
| Toolsetter / M600 | not reachable while one runs (not idle). Afterwards M600 and `#3103` use the loaded Z — shown in the list. Before the load: any G10 L1 (an M600) rewrites the file from LinuxCNC's OLD table; the hand edit is lost — `rev` then differs, the load refuses |
| Foreign NML writer (halui, a second GUI) | can send `load_tool_table`, G10 L1, M6 at any time. Before the send: caught by `rev` / `memory` / `pocket_prepped` unless inside the last microseconds. After it: caught by S as "file changed". Not excluded, not claimed |
| Preview | `load_tool_table` is an input write (generation bumped at begin, observer "tool_table", holds the idle parse); tool-table and start-TLO drift then re-parse at idle after 2 s. `previewWait` names it "the tool table load" |
| Parameters | the load is followed by task's synch (the var file is rewritten) — as with every edit today |
| Simulation mode | `toolTableWrite` stays open there, as today; nothing moves |
| F2 (failed open) | table empty in LinuxCNC, abort + spindle stop by LinuxCNC; reply "file changed" or "LinuxCNC reported an error"; the read shows every tool "not in LinuxCNC"; a load of the restored file is the way back — except with a tool in the spindle F3 still holds (it is in the file) |

## 5. Guards, mutations, native, files

**Backend** — `test_tool_load.py` (pure): every row of §1.2 red without its clause; the form rule against a golden of the compiled upstream reader (fixture + source sha, generator beside it); differences against hand-written tables both directions; `memory` digest changes with each field and the spindle tool. `test_tool_load_gateway.py` (real WS path, `tool_io_fixture`): confirmed foreign change; confirmed removal; TF-1c (an edit whose reload was not sent, then the load) with a Z and with a pocket only; nothing written (file, library, watch baseline byte-equal), exactly one NML call on the owner's Link; refusals at 2a, 2b, 2c each held at their read with disarm / unregister / Link / INI / instance changed there; file or memory changed between preview and commit; `removed` too short / too long; spindle tool gone; prepared tool; moving; job awaited; file changed after the write (before V, between V and S, A→B→A by mtime); `complete` basis: no DONE yet, an abort's later echo, `task_state` changed → never confirmed; Link change after the write; NML raises once begun; abort / E-Stop of another client before the write, in the section, in the wait, twice; timeout sends nothing again; `loaded.seq` order (older load, newer write). Registrations (below).

**Frontend** — `toolLoad.test.ts`, `toolTableRead.test.ts` (§3 table, every row), `commandShapes`, `commandPath`, `controlInventory`; `tool-load.spec.ts`: offered / not offered in the three places, list and counts, 1000 + 1000 rows in portions, acknowledgement gate and reset, danger style, Cancel while disarmed, stale by ping and by socket, every outcome note, requested → confirmed, payload exactly `base` + `removed`, 100 / 150 % portrait + touch without sideways overflow, no box of the tab moves while the button compares; a `dialogs.spec` row; `contrast`, `layout` by their sweeps. Mock: `tool_table_preview` and `tool_table_load` defaults, the new fields on `get_tool_table` (same commit).

**Mutations (≈ 45):** drop each of `rev`, `memory`, `removed`, path / instance / ini / link; admission before the reads only; `standing()` not last; `_stat_now()` instead of the owner's; reads outside `admit`; send on `link()`; each §1.2 clause; spindle / prepared / standstill; unread counted as fine (three); V, S, L, owner, newest each dropped; S before V; echo `==` → `>=`; `task_state` ignored; a `complete` basis taken for a transition; early file-change end dropped; retry on timeout; second send after reconnect; a file or library write added; `ok: true` for a refusal; preempt raising after the write; `loaded` from an unconfirmed or an edit job; `>` → `>=`; epoch ignored; page: offered with a refusal, ack not reset, confirm enabled stale, note before the read, confirmed note beside partial, metadata part settled.

**The eight contract cases and their layer**

| Case (R471 point 4) | Backend | Browser | Native |
|---|---|---|---|
| foreign change confirmed | ✓ | ✓ | N1 |
| confirmed removal | ✓ | ✓ | N2 |
| change between preview and commit | ✓ | stale note | N3 |
| change after NML delivery | ✓ | note | N4, N6, N7 |
| foreign Link / instance / INI | ✓ (the only layer: a bound gateway never gets a second one in a native run) | reconnect | – |
| refused / failed reload | ✓ | ✓ | N7 (failed), N3 / N11 (refused) |
| own commit repeated (TF-1c) | ✓ | note gone by `loaded` | N8 |
| abort during the wait | ✓ | ✓ | N13 |

**Native (VM sim, run tree, `~/claude-work` service, restore proven; 3-axis, machine on unless said).** `io` is held with SIGSTOP where an order must be forced (only the run's own `io`, found by its session; ≤ 3 s).

| N | Case | Pass |
|---|---|---|
| 1 | hand edit (changed + added), load | read partial → confirmed → complete → an edit admitted and confirmed |
| 2 | removal acknowledged | STAT without the tools; library section unchanged |
| 3 | file changed between preview and commit | refused, no reload (STAT unchanged) |
| 4 | `io` stopped, load sent, file changed, `io` on | unconfirmed "file changed"; the next read names the truth |
| 5 | `io` stopped 3 s | unconfirmed "not shown" at 2 s; nothing sent again; later complete |
| 6 | a second NML client (`command.tool_offset`) while `io` is stopped | file rewritten → "file changed" |
| 7 | `io` stopped, file moved away, `io` on | LinuxCNC's table empty (F2 shown); file back → load confirmed |
| 8 | TF-1c: `io` stopped, `save_tool`, abort, `io` on — the forced abort should replace the waiting load (to be shown; `taskclass.cc` forceCommand). Fallback with the same end state: commit B, hand-restore A and load A, hand-restore B's exact bytes. Then load; once with a Z, once with a pocket only (the `tool-prep-pocket` pin shows it after `Tn`) | confirmed; the pin shows the new pocket; the write note gone by `loaded` |
| 9 | T5 in the spindle with G43, its Z changed, load | `STAT.tool_offset` unchanged, index 0 new; after G43 the new value |
| 10 | `T5` prepared without M6, then rows re-ordered in the file | refused; as evidence for F4 a raw `load_tool_table` by the test client, then M6: which tool LinuxCNC takes |
| 11 | during a jog | refused; E-Stop and off: confirmed, lag reported |
| 12 | 1000 tools, machine off / E-Stop | lag against the 2 s bound reported |
| 13 | abort of a second client in the wait; and a pocket-only load aborted while `io` is stopped | `not awaited`, then the read; never confirmed, the write note stays |

Before the machine update: `load_refusal` run over a copy of the machine's real `tool.tbl` (with the file clauses already owed).

**Files.** Gateway: `tool_proof.py`, `gateway.py` (`_ToolWriteJob`, `_reload…` unchanged, new `_send_tool_load`, `_confirm_tool_write`, `_after_tool_write`, `_write_admission_refusal`, `_read_tool_files`, `_cmds_tool_table`), `command_policy.py`, `lcnc_iface.py` + `fake_linuxcnc.py` (`pocket_prepped`), `tool_io_fixture.py`; touched tests: `test_tool_proof*`, `test_tool_commit_gateway`, `test_payload_contract`, `test_command_policy`, `test_calc_lifetime_wiring`. Registrations: the command as `renumber_tool` is, the read as `get_tool_table` is (`READ_ONLY_COMMANDS`, `commandPath`, `commandShapes` "a read"). Web: `ToolLoadDialog.vue`, `toolLoad.ts` (new), `toolTableRead.ts`, `ToolTablePanel.vue`, `App.vue` (More), `lcnc.ts` (`WsCommand`), `previewWait.ts`, `controlInventory.ts`, `commandPath.test.ts`, `commandShapes.test.ts`, `mock-gateway.mjs`. Old words asserted in `test_tool_proof.py`, `test_tool_proof_gateway.py`, `test_tool_commit_gateway.py`, `toolTableRead.test.ts`, `tool-table-read.spec`, `tool-import.spec`, `p6tf.native.py`, `docs/ui-glossary.md`, `functions.json`. `rules.py`: the two new web files into the TOOLS rule, `tool-load` into TOOLS. Inventory: new function F-TOOLLOAD (2 commands, the dialog's and three openers' controls), atoms regenerated, `funktionen.md` rendered. Docs: CLAUDE.md (gate line, MT-TF1 sentence), `safety-and-permissions.md`, `ui-patterns.md`, `frontend-modules.md`, `decisions.md`, `testing.md`.

**Build order:** 1 `tool_proof` + golden; 2 policy / schema / registrations + fake; 3 preview and `get_tool_table` fields; 4 send + admission; 5 confirmation + `loaded`; 6 page (pure module, notes, dialog, More, mock); 7 docs, inventory, mutations, round gate, native.

**Size:** gateway ≈ 400 lines, web ≈ 400, tests ≈ 1500, native ≈ 350. One builder, one Codex round for the plan, one or two for the build.

**Limits (named):** no byte proof of what io read; mtime-tick ABA (§3); a foreign NML writer is not excluded; STAT reads are not an atomic snapshot; 2 s is cooperative and can pass while a load still runs; random changer, tool database and tools held twice by LinuxCNC stay with a restart; `iov2` by source only (same block, `ioControl_v2.cc:1129`); F2's abort and spindle stop are LinuxCNC's (from source; `io.reason`'s value on that path not traced).

## 6. Questions

**Codex**
1. The proof V + S + L (§1.4) — transition on a `partial` basis, exact echo + DONE + same `task_state` on a `complete` one — and `loaded.seq` in the READ as what settles the note (§3): accepted, with the named limit?
2. The prepared-tool and standstill terms: planned for TF-2 only. Edits and the import shift indices too (add, delete, renumber, the sorted rewrite); the blunt form ("> 0 refuses") would block every edit after an aborted `Tn`. Same index rule for them, as its own package?
3. The form rule (§1.2, F8) as "never offered", and 0 rows never loadable: agreed? The edits' reader stays as it is.
4. "LinuxCNC holds T5 twice" (file already clean): kept with a restart, although a load would cure it. Right?
5. TF-1's agreed words change only where the file is loadable (§2.3). Agreed?
6. The ghost-tool line of the suite's own writer (> 255 bytes): separate fix before this package, or with it?

**Operator (one), Q-TF2-1:** May this action also REMOVE tools from LinuxCNC when the file lacks them — behind the extra switch and the danger button —, or should removing stay with a restart? Recommendation: allow with the switch (Codex's contract names it); a tool in the spindle is never removed.

# F8 plan v4 — tool files read + closed hull counts (for Codex R465)
Two local files concatenated unchanged. Code sites at development `6c78780c`.


---

<!-- Tool files read — plan v4 -->

# P6 package "tool files read" — plan v4 (after Codex R461 F8-1)

**Scope.** A small package before P6-c: how the gateway reads `tool.tbl` and `tool_library.json` for the Tools tab and the F8 tool-data store, and when such a read may count as a `seen` observation for the pairing rule (C1-P). Code sites at development `6c78780c` (worktree `/home/cnc/lcnc-suite-p6f8`). **Plan and probes only, no product code.**

**Evidence** (all under `~/claude-work/`):

- Upstream sources: `bg/upstream-2.9.4/src/emc/{tooldata,iotask,usr_intf/axis/extensions,task,rs274ngc}/` with `SHA256SUMS` per directory; Debian's patch list in `bg/upstream-2.9.4/debian-patches/` (with `SHA256SUMS`).
- Native run 1 (the write itself): `p6/f8/toolfile/p6f8_native.py`, `drive.sh`, run record `p6/f8/toolfile/runs/20261124T143615-toolfile/` (`report.json.gz`, `restore-post.json`, `sampler-*.json`); in small: `p6/f8/toolfile/toolfile-evidence.json`.
- Native run 2 (rule R against the real STAT, the loaded tool, the lag off / in E-Stop): `p6/f8/toolfile/p6f8_native2.py`, `drive2.sh`, run record `p6/f8/toolfile/runs/20261124T150641-toolfile2/` (`p6f8b.json`, `restore-post.json`).
- The rule checks: `p6/f8/toolfile/rule_check.py` (run 1's contents, every cut, the mutations; output `rule_check.out.txt`) and `rule_check2.py` (run 2; output `rule_check2.out.txt`). Stdlib, the head's line parser by AST, no gateway import.
- Copies of all probes and outputs: `scratch/p6f8/` on branch `feat/p6f8` (not pushed).

## Summary

| Point | v3 | v4 |
|---|---|---|
| LinuxCNC's own write | "in place or atomic: not verified" | **In place, not atomic, measured.** io's `tooldata_save` opens the file with `fopen("w")` (truncate), writes it through stdio in 4096-byte blocks, closes it. No rename, no fsync, no lock. A reader caught the EMPTY file 282 times in 60 saves, and on a 14 kB table 22 cut states, 17 of them with equal fd signatures around the read. |
| What proves a finished write | three equal signatures | **The file equals LinuxCNC's in-memory table.** io puts the new values into its shared table BEFORE it writes the file, so every state during a save is a prefix of the new content while the memory already holds all of it. Rule R (§3) rejects all 41,626 cut positions of the run's 120 real contents and every observed torn state. |
| The WS read and `_cmd_lock` | "the read never takes it"; GW-1 "red by construction" | **Wrong.** `handle_command` (gateway.py:7049–7058) holds `_cmd_lock` around every command, `get_tool_table` included. All three writer sections hold it to their end. The new-table-with-old-library race does not reach the WS read today. |
| `_tool_files_lock` | new lock, reader outside `_cmd_lock` | **Recommended: no new lock** (§2). Coherence with the gateway's writers already holds. The lock would only buy a read that does not wait behind `_cmd_lock` (machine day: `mdi` up to 4.0 s). The full specification is kept in Appendix B in case Codex keeps it. |
| `seen` pairing | every coherent reply | **Only rows that rule R proves** (per tool), and only on a nonrandom changer without a tool database, with STAT read. Run 2: R is complete against the REAL `STAT.tool_table` at 9 / 9 checkpoints, and the loaded tool's index 0, which the publication reads, equals its proven home entry. |
| Gateway writer sections | end after the reload is SENT | **After the section, a cancellable wait until LinuxCNC shows the written rows** (outside the shield, 2 s bound). Measured lag 22–81 ms with the machine on, 301 ms off, 518 ms in E-Stop. Then a read after an edit is complete at the first attempt. |

---

## 1. LinuxCNC 2.9.4's external write contract

### 1.1 Who writes `tool.tbl`

**The writer is `io`** (iocontrol, `/usr/bin/io`, linked to `/lib/libtooldata.so.0`). It writes through `tooldata_save()` (`tooldata/tooldata_common.cc:368–401`). The function is called from three places:

| Caller | When | Source |
|---|---|---|
| `EMC_TOOL_SET_OFFSET` | every G10 L1 / L10 / L11 (canon `SET_TOOL_TABLE_ENTRY`, `emccanon.cc:2000`; `convert_setup_tool`, `interp_convert.cc:3953`), including `G10 L1 R…`, which sets D | `iotask/ioControl.cc:987–1030`, save at :1019 |
| `load_tool()` with `RANDOM_TOOLCHANGER = 1` | every M6 / M61: pockets swapped, then saved | `ioControl.cc:541–571`, save at :570 |
| the same two in `iov2` | | `ioControl_v2.cc:523`, :1175 |

The other paths:

- **Tool database mode** (`[EMCIO] DB_PROGRAM`): `tooldata_save` writes `DB_SPINDLE_SAVE`, a different file (`tooldata_common.cc:375–378`, `tooldata_db.cc:234`). `tool.tbl` is not the source then.
- **Never written by:** the reload `EMC_TOOL_LOAD_TOOL_TABLE` (`ioControl.cc:974–985`, `tooldata_load` with `fopen("r")`), `EMC_TOOL_INIT` (:860), task, the interpreter, or the Python binding.
- **Debian 1:2.9.4-2+deb13u1** carries one patch, `0010-sanitize-hal-paths.patch`, which touches only `src/rtapi/uspace_rtapi_app.cc` (`debian/patches/series` from sources.debian.org).
- **The installed binary agrees.** `libtooldata.so.0` imports `fopen`, `fclose`, `__fprintf_chk`, `fputs`, `fwrite`, `unlink` and `write`. It imports no `rename`, `link`, `fsync` or `flock`. `unlink` and `write` belong to the mmap and database code (`tooldata_mmap.cc:144, 207`; `tooldata_db.cc:141`). Its strings carry `T%-3d P%-3d`, ` D%+f`, ` D%.0f` …

### 1.2 How it writes

**In place.** The save is `fopen(filename, "w")`: `O_WRONLY | O_CREAT | O_TRUNC` on the existing path, so the inode stays. Each line goes out with `fprintf` through the stdio buffer (`st_blksize`, 4096 on the VM's ext4), then `fclose`. There is no temp file, no fsync and no lock.

**The states a reader can see during one save:**

1. the old content;
2. **empty** (after the truncate);
3. for a table over 4096 bytes: prefixes of 4096, 8192, … bytes, cut anywhere in a line;
4. the new content.

A pause of `io` between the truncate and its last write (preemption, a stopped process) leaves one of states 2–3 on disk for as long as it lasts, with no further change to the signatures. This is Codex's R461 counterexample, and it is the real contract.

**Memory first.** `io` puts the new row into the shared tool table (`tooldata_put`, the mmap `$HOME/.tool.mmap`) **before** it calls `tooldata_save` (`ioControl.cc:1016` then :1019). `STAT.tool_table` reads that mmap live, entry by entry, under a per-entry mutex (`emcmodule.cc:694–735`). During a save, LinuxCNC's memory therefore already holds the complete new values.

**The format** (`tooldata_format_toolline`, `tooldata_common.cc:223–268`):

- `T%-3d P%-3d`, then every nonzero field in the order D X Y Z A B C U V W I J Q;
- reals as `%+f` (six decimals, rounded by printf), the integer Q as `%d`;
- zero fields left out;
- the comment as ` ;%s\n`, so every line io writes ends in a newline.

**Ordering with the interpreter.**

- Task forwards `SET_OFFSET` to `io` and posts it DONE at once (`emctaskmain.cc:2464–2478`).
- But an MDI line reaches `INTERP_IDLE` only with `io.status == RCS_DONE` (`mdi_execute_hook`, `emctaskmain.cc:682–698`), and a program's end does the same (`readahead_waiting`, :712–733).
- Task forces `RCS_EXEC` until `io` echoes the serial of the last command it was sent (`taskclass.cc:791–799`). `io` echoes after the switch, that is after the save returned (`ioControl.cc:1132`).
- So a fresh STAT that reads the interpreter idle proves that no **interpreter-issued** save is running.
- The exception: a foreign NML client's direct `EMC_TOOL_SET_OFFSET` (the binding's `command.tool_offset`, `emcmodule.cc:1013`) runs with the interpreter idle. Task accepts it with the machine off in any mode (`emctaskmain.cc:854`), and on in MANUAL (:978), AUTO while idle (:1094) and MDI (:1442). The gateway never sends it.

**The reload** (`EMC_TOOL_LOAD_TOOL_TABLE`): `io` resets the mmap and refills it entry by entry (`tooldata_load`). A STAT reader can see a partly loaded table. `io` takes the command in its next cycle (`[EMCIO] CYCLE_TIME`, default 0.100 s).

**The loaded tool (nonrandom).** A G10 L1 of the tool in the spindle is written TWICE:

- `tooldata_find_index_for_tool` skips index 0 when the tool has a home entry (`tooldata_mmap.cc:303–325`). The first `SET_TOOL_TABLE_ENTRY` goes to the home entry (`interp_convert.cc:4079`).
- The interpreter then sends a second `SET_TOOL_TABLE_ENTRY(0, …)` for the loaded tool (`interp_convert.cc:4133–4145`). `io` writes index 0, the spindle copy, and **saves the file again**. The content is the same, because index 0 is not saved on a nonrandom changer.
- So an M600 measurement of the loaded tool gives two truncate-and-write cycles, two torn windows.
- **Between the two saves** the home entry is new and index 0 still old. A read in that moment proves the new home row while the status and a parse taken then carry the old one. This is for P6-c's pairing note: the pairing compares the publication's row, which is index 0's at its parse, never the proven row of the same instant.
- `parse_tlos` and the status's spindle row take the FIRST entry per tool id (`gcode_parse_worker.py:1516`, `status_runtime.py:135`): index 0 for the loaded tool.
- Measured in run 2 (§3.6): index 0 equals the home entry after the G10 and after every gateway reload (`reload_tool_number`, `ioControl.cc:598–610`). So the value rule R proves (the home entry) IS the value the publication and the status carry.

**The mmap mutex.** `tooldata_get` and `tooldata_put` wait up to 10 s (100 µs polls) for a held mutex, then continue without it (`tooldata_mmap.cc:80–100`). `Stat_tool_table` does not release the GIL. This is an existing exposure: the status loop reads `stat.tool_table` every tick (`status_runtime.py:1250`). The new read adds one read per reply.

### 1.3 Measured

**Setup.** Native stage on the VM at `6c78780c`: the 3-axis copy, nonrandom, `/usr/bin/io`, `st_blksize` 4096. Run `20261124T143615-toolfile`, restore `complete` in `report.json` and in `restore-post.json`, no crash records.

**Method.**

- Each G10 L1 is an MDI through the gateway with a 10-decimal Z.
- io's own `/proc/<pid>/io` gives the exact `write(2)` count. The pid is taken from the run unit's cgroup.
- inotify watches the table's directory.
- A reader process re-reads the file in a tight loop for the whole series.

| Case | Saves | Inode | io `write(2)` per save | Bytes per save | inotify per save | Reader |
|---|---|---|---|---|---|---|
| small table, 3 646 B, 52 tools | 60 | same 60/60 | **1** (60/60) | = file size | MODIFY (truncate) · MODIFY · CLOSE_WRITE | 1 050 314 reads; **the empty file 282 times** |
| large table, 14 006 B, 122 tools | 60 | same 60/60 | **4** (3 × 4096 + 1718) | = file size | MODIFY × 5 · CLOSE_WRITE | 523 670 reads; **22 states between**: empty (195 reads) and 4096 / 8192 / 12288-byte prefixes cut mid-line, e.g. `…T1014 P1014 D+3.000000 Z+65.000000 ; Exa`; **17 of the 22 with equal fd signatures** (fstat before and after the read, at the state's first sight; no path stat) |
| gateway `save_tool` | 10 | **new 10/10** (CREATE `tmp…` → MOVED_TO `tool.tbl`) | **0** (the reload only reads) | 0 | — | reply 23–26 ms; LinuxCNC's memory shows the value **22–79 ms after the reply** |

**Rounding.** |memory − file| ≤ 4.33e-7 over the 120 saves. For example, Z 50.4703703717 is written as `Z+50.470370`, while the memory keeps 50.4703703717.

**Not distinguishable here:** the inotify MODIFY counts are lower bounds, because identical unread events coalesce and the reader's own opens overflowed the queue in 10 of 120 saves. The `write(2)` count is exact.

### 1.4 What follows

- **No observation of the file alone proves that an external write finished.** 17 of the 22 observed torn states had equal fd signatures around the read: v3's rule would have had nothing to retry on. Its third, path signature was not sampled.
- **What does prove it:** the file equals what LinuxCNC holds. During a save, the file is a prefix of the new content while LinuxCNC's memory already holds all of it.
- **A prefix that equals the memory in every value, the tool set and the final newline is the whole content.** The only exception is digits beyond the sixth decimal, which `io` never writes. Rule R (§3) is built on this.

---

## 2. Correction: the WS read already runs under `_cmd_lock`

**The facts.**

- `handle_command` (`gateway.py:7049–7058`) takes `_cmd_lock` and runs `_handle_command_impl` inside it, for **every** command.
- The command worker dispatches every command but `arm` through it (`gateway.py:12636`).
- `get_tool_table` is a branch of `_handle_command_impl` (`gateway.py:8795–8813`), so it runs under `_cmd_lock`.
- All three writer sections hold `_cmd_lock` and run to their END inside it. `_thread_to_end` (`gateway.py:1676–1698`) waits for the inner section through repeated cancels before the lock passes on:

| Writer section | Lock taken at | Section |
|---|---|---|
| WS save / add / delete / renumber | `handle_command` 7054 → `_cmds_tool_table` | `_persist_tool_edit` 5575–5598 |
| REST import apply | `_persist_imported_tools` 3456 | its `section()` 3446–3449 |
| REST metadata refresh | `refresh_tool_library_metadata` 11724 | `_save_refreshed_metadata` 11637–11652 |

**Consequence.** v3's race is not reached by the WS read: "a client pinged at the mid-section bump reads the new table with the OLD library … the read never takes it" (C1-R and GW-1). The read queues behind the section and sees its after-state. v3's GW-1 claim "red at the base by construction" is withdrawn. GW-1 is EXPECTED green at the base (code reading, not run) and stays as a regression guard (§9).

**The readers that do NOT hold `_cmd_lock`:**

| Reader | Reads | Can it see a mix? |
|---|---|---|
| status loop, M6 info (`status_runtime.py:1262–1278`) | table + library, cached by (tool, mtime) | Only by a coincidence the gates exclude. It reads only while an M6 is requested. A gateway section needs toolTableWrite (interpreter idle, no M6 requested), so the two overlap only when a foreign client starts a program during a section. An `io` save does not overlap on a nonrandom changer: `io` raises the M6 request after it finished every earlier command. |
| `/tool-table` download (`gateway.py:11587`) | the raw bytes | An io save in a running program can be cut (§1.3) |
| import preview count (`gateway.py:11676`) | the table, before the lock | cosmetic (a count) |
| status `tool_meta` (`gateway.py:12990`) | the library only (cached) | `io` never writes it |

**Recommendation: (A), no `_tool_files_lock`.** `get_tool_table` stays under `_cmd_lock`. The lock order stays `_cmd_lock` alone, and nothing new can invert.

The cost is that a read waits behind any `_cmd_lock` holder. Measured on the machine day (`~/claude-work/machine-day-logs/2026-11-21`, `ws.command_slow`): `mdi` 12 times over 1 s, up to 4.0 s, median 2.8 s; `arm` 4 times, up to 1.1 s. On the VM's traces none. This is within the store's 8 s slow note.

**(B), only if Codex keeps the separate lock** (Appendix B). It buys a read that does not wait behind an MDI. It costs a dispatch path that bypasses `handle_command`'s lock for one read command. That read would also do its STAT reads (rule R) off `_cmd_lock` in a worker thread, concurrent with the status loop's use of the same `Link.stat` object, so it needs its own `linuxcnc.stat()`.

---

## 3. Rule R — the read admitted by LinuxCNC's own table

### 3.1 The read (one attempt, in ONE thread)

1. Open `tool.tbl`. Take `fstat`, read all bytes from that fd, `fstat` again, then `stat` the path. When the three signatures differ, the attempt is void (the gateway's own rename landed meanwhile).
2. Parse the bytes as today (`parse_tool_table` without `strict`). Additionally:
   - Record every line not understood as `unread: {line, T}`.
   - `T` is set only when the line has exactly one token `T<whole number>`. Otherwise it is `null` and never attached to a tool (Codex R461).
3. Read LinuxCNC's table: `STAT.tool_table`, AFTER the bytes. It is read on the event loop once the file thread has returned, where the handler polls STAT today for `current_tool`. `tool_table` reads the mmap live and needs no poll.
   - The set compared is the HOME entries: on a nonrandom changer, index ≥ 1 with `id > 0`. Index 0 is the spindle copy and is not saved (`tooldata_save` starts at 1, `tooldata_common.cc:394`).
   - Order matters only one way. During a save the memory already holds the new values, so a read of the memory after the bytes can never pair a torn prefix with an older memory that it would match.
4. Read the library strictly (v3 C1-R 3, unchanged): the section for this INI or the seed (`source`). An unreadable or unparsable file gives `ok: false`.

### 3.2 What the attempt proves

**`TOL` = 5.5e-7 machine units.** That is half a unit of `%+f`'s sixth decimal plus binary rounding. Measured: ≤ 4.33e-7. The smallest torn change of a value, one missing last digit, is ≥ 1e-6.

- **A row of tool T is proven when:**
  - there is exactly one parsed row for T;
  - there is exactly one home entry for T in the memory;
  - every field the memory holds (X..W, D, I, J; Q exactly) equals the row's within `TOL`. A field absent from the row counts as 0, which is what `io` does with zero fields.
- **The read is complete when:**
  - the bytes are empty and the memory holds no tool, read from an INITIALISED table (an initialised `STAT.tool_table` always has index 0, the spindle entry; an EMPTY tuple means not initialised, `emcmodule.cc:698–702`, and is "controller not read", A3, never "no tools"); or
  - the bytes end in a newline, the multiset of T in the bytes equals the memory's, every row is proven, and nothing is `unread`.
- **Not provable this way:** the pocket P and the remark. STAT carries neither (`emcmodule.cc:667–683`). P and the remark ride along unproven. The final newline guards only the last line's remark.

### 3.3 Why R holds under §1

- **The gateway's own writes** are atomic: `atomic_write_bytes`, a new inode, measured 10/10. The memory follows by the reload. A complete read of such a file equals what `io` loaded.
- **An `io` save:** the memory holds the new values first (§1.2). Every file state during the save is a prefix of the new content.
  - A prefix cut before the end lacks some tool, which the tool-set clause catches.
  - Or it lacks the final newline, which the newline clause catches.
  - Or a value has a digit cut, which the `TOL` clause catches (≥ 1e-6).
  - A cut inside trailing zeros leaves the value equal. That row is proven, and rightly: its values are the memory's.
- **Old file, new memory** (`io` between `tooldata_put` and the truncate): the changed row differs, so the read is not complete and that row is not proven.
- **A reload in progress** (memory partly loaded, file complete): the tool set or values differ, so the read is not complete. The file is never torn then: `io` handles one command at a time, and the gateway's writes are atomic.

### 3.4 Checked (`rule_check.py` on the run's real contents)

**Inputs.** The 120 complete contents `io` wrote. Each is rebuilt from the run's last content with T1's measured line. Its memory is LinuxCNC's exact double for T1's Z, not the printed digits. **For every other tool the memory is ASSUMED equal to the file's parse**, which makes "every content complete" true by construction for 121 of 122 rows. The cut rejection does not depend on it. The positive side against the real `STAT.tool_table` is run 2's (§3.6).

| Check | small | large |
|---|---|---|
| every content complete | yes | yes |
| cut positions checked (every byte of the first and last content; in the others T1's line and every 4096 boundary) | 10 366 | 31 260 |
| cuts accepted as complete | **0** | **0** |
| proven rows whose values differ from the memory (a self-check of the checker; 0 by definition of "proven") | 0 | 0 |
| observed torn states accepted (against every content's memory) | 0 of 1 | 0 of 22 |
| old file against the next memory accepted | 0 | 0 |
| Codex R461 `T13 P13 D1.` with memory D 1.875 | not complete, nothing proven | |

**Mutations of the rule** (`RULE_MUT=…`):

| Mutation | Result |
|---|---|
| without the newline clause | 116 cuts accepted (a last line's remark cut, e.g. `…T2015 P2015 D+10.000000 Z+25`) |
| without the tool-set clause | 160 / 300 cuts accepted (cuts at a line end) |
| exact comparison (`TOL` 0) | every complete content refused (`%+f` rounding) |

### 3.5 Assumptions, named

- **A1 — the in-place writer is `io`'s `tooldata_save`:** prefix-growing writes, six decimals, a newline per line.
  - For any other writer, R still states the same fact: the file's values equal LinuxCNC's. A tear below `TOL` stays possible only for a writer that prints more than six decimals.
  - A hand-edited file that LinuxCNC has not loaded is never complete. It is named "differs" (§5), which is the truth.
- **A2 — nonrandom changer, no tool database.**
  - A random changer saves index 0 as pocket 0 (`tooldata_save` from index 0) and is not measured. The read is `unchecked: random toolchanger`.
  - A tool database is `unchecked: tool database`.
  - Neither produces `seen`. Both are named, never silent.
- **A3 — STAT readable.** Without a STAT (no NML link), or with an empty `tool_table` tuple (the binding not initialised), the read is `unchecked: controller not read`, with no pairing. A truncated-empty file against an unread STAT must never become "complete, no tools", which is the case store point 2 exists for.

### 3.6 Run 2: the positive side against the real STAT, the loaded tool, the off and E-Stop lag

**Run.** `20261124T150641-toolfile2` (`p6f8_native2.py`, checked by `rule_check2.py`). Restore `complete` in `report.json` and in `restore-post.json`; no crash records.

**What each checkpoint records.** The file's real bytes and the WHOLE `STAT.tool_table`: every index, all 14 fields. Rule R is applied to the real bytes against the real dump (home entries, nonrandom), with nothing assumed.

| Checkpoint | What happened | R | Index 0 (spindle copy) | LinuxCNC shows the edit after the reply |
|---|---|---|---|---|
| fresh | the copy's table as written at the copy (the examples' format, `T1 P1 Z50 D6`), loaded by `io` | **complete**, 52 / 52 proven | empty (no tool) | — |
| io-unloaded | G10 L1 P2 Z47.8139237891 (T2 not loaded) | **complete**, 52 / 52 | — | — |
| m61 | M61 Q1 | **complete** | = home (Z 50) | — |
| io-loaded | G10 L1 P1 Z50.2345678912 (T1 loaded) | **complete** | **= home** (50.2345678912); status `tool_table_z` the same | — |
| edit-on | gateway `save_tool` T3, machine on | **complete** | = home (50.234568: the reload re-read the printed digits) | **26 ms** |
| edit-loaded | gateway `save_tool` T1 (loaded), machine on | **complete** | = home (61.5) | **81 ms** |
| edit-off | gateway `save_tool` T3, machine OFF | **complete** | = home | **301 ms** |
| edit-estop | gateway `save_tool` T3, E-STOP | **complete** | = home | **518 ms** |
| end | E-Stop reset, machine on | **complete** | = home | — |

**What run 2 settles.**

- **The positive side holds.** Every checkpoint is complete against the real memory, with no row where the file and the memory disagree.
  - That covers the examples' format (`Z50 D6`), `io`'s `%+f` format and the gateway's `+013.6f` format.
  - The reload of a printed value: 50.2345678912 became 50.234568 after a gateway reload, and the file and the memory agree again.
- **The loaded tool:** index 0 follows the home entry (the interpreter's second entry, §1.2). "Proven" is the value the publication carries.
- **The reload lands with the machine off and in E-Stop too**, but more slowly (301 and 518 ms, against 26–81 ms with the machine on). §4's 2 s bound covers all three.

---

## 4. After a writer section: wait for LinuxCNC to show it

Today a section ends once the reload is **sent** (`_reload_tool_table_and_bump`, `wait=None`). The measured lag until LinuxCNC shows the new row is 22–79 ms after the reply (machine on). A read right after an edit would find "differs" and need a retry.

**Change.** AFTER the shielded section has returned, still in the handler under `_cmd_lock`, but OUTSIDE `_thread_to_end`:

- Poll `STAT.tool_table` every 10 ms until rule R's comparison of the WRITTEN bytes with the memory is complete.
- Bound: 2 s. A wait with no result traces `tools.reload_unconfirmed` (warn) with the differing tools, and the handler replies as today. The reader then names the state (§5).
- **It writes nothing and is cancellable.** An abort or E-Stop preempts the handler (`_preempt_inflight`) and the wait ends at once. The shield's budget, which `_persist_tool_edit`'s docstring states (one table write, one `load_tool_table`, one library read and write), stays as it is. Inside the shield the wait would add up to 2 s to what an abort waits for behind `_cmd_lock`.

**Costs.**

- With the machine on: about one `io` cycle (≤ 0.1 s, `CYCLE_TIME`) more per tool edit under `_cmd_lock`.
- **Measured in run 2** (§3.6): 26–81 ms with the machine on (12 edits over both runs), **301 ms with it off, 518 ms in E-Stop (ONE sample each)**. An edit is admitted in all three states (`sourceWrite`), and the reload lands in all three. The 2 s bound holds with room.
- **So with the machine off or in E-Stop, every client's next command waits about 0.3–0.5 s behind a tool edit** (the wait holds `_cmd_lock`), against ≤ 0.1 s with the machine on. Stops are not delayed: they preempt the wait.
- Nothing when there is no NML link: then there is no reload, and the trace says so.

The import does the same after its section. The metadata refresh writes no table and has nothing to wait for.

## 5. The reply

**`get_tool_table`** adds the following to today's `tools` / `current_tool` / `table`:

- `proof`:
  - `state`:
    - `complete` (rule R holds);
    - `partial` (R does not hold after the attempts; the tools named);
    - `unchecked` (A2 or A3, the reason named);
  - `proven`: [T…];
  - `differs`: [{T, fields}];
  - `missing`: [T in memory, not in the file];
  - `extra`: [T in the file, not in memory];
  - `why`;
  - `attempts`.
- `unread`: [{line, T | null}].
- `rev`, `version`: as in v3 C1-R 4. `rev.table` is the sha256 of the bytes read, `rev.library` that of the canonical section.

**Attempts.** At most 3, 20 ms apart, under `_cmd_lock` (≤ 40 ms more than today in the worst case). This covers an `io` save's microsecond window. After a gateway section with §4 the first attempt is complete. A `partial` after 3 attempts is not an error: the rows go out with their names (§6).

---

## 6. The store (C1-S, Codex R461's three points)

1. **An old connection's reply is dropped, even after a sequence restart.**
   - Every request carries `(epoch, seq)`. `epoch` is a counter the store increments at every open and never reuses in the page's life. `seq` restarts at 1 per connection.
   - A reply applies only when its epoch is the current one and its seq is that epoch's newest.
   - Close clears everything together with `connKey` (v3).
2. **An error or a missing row never shows as an empty table.**
   - `failed` (an `ok: false` reply or a `null` from `request()`) shows no rows: "Tool table not read." (the existing rule, never "No tools").
   - `partial` shows the file's rows with the named note: "The file differs from LinuxCNC's table: T5, T7" or "T3, T4 missing". The note says "is being written" when the file is empty or shorter while the memory holds tools.
   - "No tools" shows only for `complete` with zero rows.
   - The measured empty state (282 reads) is exactly the case this point is for.
3. **An `unread` line without a readable T never attaches to a tool.**
   - It makes the read not complete and is named by its line number.
   - If `io` loaded a tool from it, that tool shows in `missing` or `differs` through the memory, so it is not proven either.
4. **`seen` (pairing, C1-P) is fed only from `proof.proven` rows:**
   - under the reply's `rev.library`;
   - in the current epoch;
   - for the current table identity;
   - never from a `partial` row outside `proven`, and never from an `unchecked` reply.
   - The pairing tolerance stays 1e-4 (R461). Proven rows are within 5.5e-7 of LinuxCNC's values, about 180 times inside it.
   - **The bound on `seen`** (R461 F8-2) belongs to P6-c's pairing plan, not to this package.

---

## 7. The lock chain (recommendation A)

| Path | Locks, in order | Inside |
|---|---|---|
| WS `get_tool_table` | `_cmd_lock` (`handle_command`) | rule R's attempts: file read + STAT + strict library, in one thread per attempt |
| WS tool edit | `_cmd_lock` → `_thread_to_end(section)` | `_write_tool_table_admitted` (thread: `_write_admission_refusal` STAT read → `check()` strict table + library → `_file_effect` → `write_tool_table`) → `_reload_tool_table_and_bump` (`_cmd_blocking(load_tool_table, wait=None)`, file sig thread, version + 1) → `load_tool_library` → `update_library` → `save_tool_library` (`ToolLibraryStore`'s `threading.Lock`); then, outside the shield, the cancellable **§4 wait** |
| REST import | `_cmd_lock` (3456) → `_thread_to_end(section)` | `_replace` (thread: admission → `_file_effect` → `write_tool_table`) → reload + bump → `save_tool_library`; then, outside the shield, the **§4 wait** |
| REST refresh | `_cmd_lock` (11724) → `_plan_current_metadata_refresh` → `_thread_to_end(persist)` | `_save` (thread: admission → `save_tool_library`) → version + 1 |
| `_ts_read_back`, `_g30_command`, `_apply_probe_vars_detail` | `_cmd_lock` → `_var_file_lock` | no tool-file write |
| `_ensure_prov_var_rows` | `_var_file_lock` alone | no tool-file write |

- **No tool-file path takes `_var_file_lock`.** A static walk over `gateway.py` from every section and reader finds no path to `_get_var_file_lock`, `_var_file_thread`, `_ts_read_back`, `_apply_probe_vars_detail`, `_ensure_prov_var_rows` or `_g30_command`.
- **The reverse walk shows the limit of a syntactic guard.** It reports paths from `_ts_read_back`, `_g30_command` and `_apply_probe_vars_detail` to `_reload_tool_table_and_bump`, but only through closures named `admit` and `section`, which several functions define. Those are name collisions, not calls. This is why §9's lock guard records acquisitions at run time instead of matching names, as Codex asked.

---

## 8. Readers: in or out of the package

| Reader | Decision |
|---|---|
| WS `get_tool_table` | **in**: rule R, the reply of §5 |
| edit base `_tool_table_for_edit` + write-time `check()` | **unchanged**. A torn base needs an `io` save during the read, and every interpreter-issued save ends before the interpreter reads idle (§1.2: FROM SOURCE; the run's 120/120 saves done by the time the MDI read finished are consistent with it, not a proof of the order). The write-time `check()` re-reads after the commit admission (a fresh STAT, idle) and refuses a base that differs. Remaining: a foreign client's direct `SET_OFFSET` (`command.tool_offset`, §1.2). Named as **MT-TF1** for Codex: should the edit base require rule R's `complete`, refusing "Tool table differs from LinuxCNC's — reload it" when it is not? |
| status loop M6 info | **out**, named: a gateway section's middle can mix table and library there. Its cache is keyed by mtime. Not an `io` save on a nonrandom changer. |
| `/tool-table` download | **out**, named: the file as it is; a download during an `io` save in a running program can be cut. |
| import preview count | **out**: cosmetic |

---

## 9. Guards

**Pure** (`tool_files.py`, new, its `rules.py` rule):

- **TF-1, every cut.** An io-format writer in the test (`T%-3d P%-3d`, `%+f`, zero fields left out, ` ;%s\n`) for 50 and 150 tools. Every cut position gives not complete, and every proven row carries the memory's values. Each full content gives complete. Also: Codex's `T13 P13 D1.`; the empty file with tools in memory; a last-line remark cut.
- **TF-2, old file / new memory.** Not complete; the changed T is in `differs`.
- **TF-3, rounding.** Memory 50.4703703717 against `Z+50.470370` is proven; a difference of 1e-6 is not.
- **TF-4, unread.** A line without a whole-number T gives `T: null`, is attached to nothing, and makes the read not complete. A line with one T names it.
- **TF-5, scope.** Nonrandom index 0 is ignored. A duplicate T is unproven on both sides. Random changer, tool database, no STAT, and an EMPTY `tool_table` tuple each give `unchecked` with the reason. An empty file against an empty tuple is `unchecked`, never complete.

**Gateway** (pytest, `fake_linuxcnc`):

- **GW-1, coherent read (regression; expected green at the base — from code reading, run it first).**
  - A writer section stalled between the table write and the library write (an Event in `save_tool_library`), and a concurrent `get_tool_table`.
  - The reply is the section's after-state.
  - **Cancel counter-case:** the writer's handler cancelled twice while stalled (abort preemption). The reader still gets only the after-state.
- **GW-2, partial.** The fake STAT table differs from the file. The reply is `partial` with the T named, after at most 3 attempts (patched sleep).
- **GW-3, strict library.** A corrupt `tool_library.json` gives `ok: false` with the reason, never the cached rows.
- **GW-4, rev.** Same bytes give the same `rev`. An in-place rewrite of the same size gives a new `rev.table`. A metadata-only save changes only `rev.library`.
- **GW-5, the wait after the section.** After `_persist_tool_edit`:
  - the handler replies only once the fake STAT shows the written rows (updated after N polls);
  - it never waits past the bound, and a timeout traces `tools.reload_unconfirmed`;
  - **cancel counter-case:** an abort during the wait ends it at once. The lock passes on, and the table, the reload and the library are written (the shielded section was done).
- **GW-6, lock order at run time.**
  - A recorder wraps `_get_cmd_lock` / `_get_var_file_lock` in the harness and records held locks per task.
  - During each writer section (WS edit, import, refresh) and the read, no `_var_file_lock` acquisition.
  - During `_ts_read_back` / `_g30_command`, no `write_tool_table` / `save_tool_library` call.
  - Plus the site list: every `write_tool_table` and `save_tool_library` call in `gateway.py` is one of the five named sites (5572 and 3443 write the table; 5595, 3448 and 11646 the library). A new site fails until named.

**Store** (`toolLibraryStore.test.ts`, P6-c):

- an old-epoch reply after a sequence restart is dropped;
- `partial` with zero rows never renders "No tools";
- `unread` without T is never attached;
- `seen` only from `proof.proven`.

**Native evidence (owed, through the native stage).** `p6f8_native.py` grows a case that reads `get_tool_table` during the large-table G10 series. Its `proof` is never `complete` on a state the sampler saw torn, and the rows it proves carry LinuxCNC's values.

## 10. Mutations

| Mutation | Red |
|---|---|
| the newline clause removed | TF-1 (measured: 116 cuts) |
| the tool-set clause removed | TF-1 (measured: 160 / 300 cuts) |
| exact comparison | TF-3, and TF-1's full contents |
| comparison with the file's own parse instead of STAT | TF-1 (every cut "complete") |
| the signature rule of v3 | TF-1 (measured: 17 of 22 observed torn states with equal fd signatures) |
| an unread line attached to the nearest T | TF-4 |
| no §4 wait | GW-5 |
| the §4 wait inside the shield | GW-5's cancel counter-case (the abort waits for the wait) |
| `get_tool_table` moved off `_cmd_lock` without Appendix B | GW-1 |
| store: old-epoch reply applied | store unit |
| store: `partial` empty rendered as "No tools" | store unit |

## 11. Files

- **Gateway:**
  - `tool_files.py` (new, pure): rule R, the `unread` T extraction, `rev`. Its `rules.py` rule.
  - `gateway.py`: `get_tool_table`'s attempts and reply; the §4 wait after the two table sections (WS edit, import); traces `tools.read_partial` and `tools.reload_unconfirmed`.
  - `test_tool_files.py`, `test_tool_files_gateway.py`.
- **Client** (with P6-c1):
  - `lcnc.ts`: the reply type;
  - `toolLibraryStore.ts`: the store points.
- **Docs:** `docs/architecture/safety-and-permissions.md` gets no change (no new lock). `frontend-modules.md` (the store); CLAUDE.md's tool-table lines ("Tool change" / "Loaded program" neighbourhood): "a tool-table read is proven by LinuxCNC's table".
- **Inventory:** regenerate if the guard names the new reply fields or traces.

## 12. Not verified / owed

- **A random toolchanger and a tool database.** Not measured; `unchecked` by A2.
- **The loaded tool's two saves per G10** are from source (`interp_convert.cc:4133–4145`). Run 2 measured index 0 equal to home after the G10, but did not count `io`'s writes for that case.
- **The lag off and in E-Stop:** one sample each (301 / 518 ms).
- **GW-1 was not run** (expected green from code reading).
- **"Interpreter idle ⇒ no interpreter-issued save running"** is from source only (§1.2); the runs are consistent with it.
- **The N100's lag and read cost.** Measured on the VM only: lag 22–79 ms, a 122-tool table. Owed on the machine with its table: the §4 wait's length and the reply's size and time.
- **A foreign NML client's direct `SET_OFFSET`** (`command.tool_offset`). Read from source, not run (MT-TF1).
- **`iov2`.** The same calls by source (`ioControl_v2.cc:523, 1175`). The examples run `io`.
- **The mutex wait under a stopped `io`.** From source (10 s per entry, GIL held). Not provoked; an existing exposure of the status loop.

---

## Appendix B — `_tool_files_lock` (only if Codex keeps it after §2)

- **The lock.** `_tool_files_lock`, an `asyncio.Lock`, non-reentrant.
- **Writers.** Order `_cmd_lock` → `_tool_files_lock`.
  - The lock is taken as the FIRST statement inside each `section()` / `persist()`, so the `_thread_to_end` shield owns it.
  - A cancel while the section waits for the lock still runs the section, as today's shield does once started. Its admission stays at the write.
  - It is released only when the section has ended, through repeated cancels. The §4 wait runs after it, outside the shield, still holding `_tool_files_lock`, and is cancellable.
- **Reader.** `get_tool_table` leaves `handle_command`'s lock: a named exception for this one read command in the command worker. It takes only `_tool_files_lock`, across rule R's attempts, to the built reply.
  - It needs its own `linuxcnc.stat()` for the STAT reads: the shared `Link.stat` is polled by the status loop, and this read runs in a worker thread.
  - `current_tool` comes from that object too.
- **Never nested with `_var_file_lock`.** No tool section calls a var-file helper (§7). GW-6's recorder adds: no `_var_file_lock` while `_tool_files_lock` is held, and no `_tool_files_lock` while `_var_file_lock` is held.
- **What the reader waits for.** One section: a table write (+ admission), one `load_tool_table` write, one library read and write; then the §4 wait (≤ one `io` cycle measured with the machine on, 2 s bound, cancellable). It no longer waits behind an MDI.
- **Extra guards.**
  - GW-1 is red at a head that has the exception without the lock.
  - A cancel counter-case: the reader cancelled while waiting for the lock leaves nothing held.


---

<!-- F8 counts v2 — the closed stepped hull -->

# F8 · Q5 counts v2: the CLOSED stepped hull, measured

Measured 2026-11-24 at development `6c78780c` (worktree `/home/cnc/lcnc-suite-p6f8`, branch `feat/p6f8`), after Codex R461 F8-2. v1 (`~/claude-work/p6/f8-counts.md`) measured stacked separate cylinders, an open body. v2 builds the closed body the plan proposes, proves its containment on the built mesh, and judges coverage per pair and stretch.

**Probe files** (`~/claude-work/p6/f8/v2/`, copies under `scratch/p6f8/hull/` on `feat/p6f8`, the logs there as `.out.txt`):

- `p6probe.f8hull.ts`: the hull, its mutants, and the guard's own measurements.
- `p6probe.f8hull2.test.ts`: the containment guard and the mutation matrix. Output in `f8-hull2.json` and `run-hull2.log`.
- `p6probe.f8counts2.test.ts`: the counts and coverage. Output in `f8-counts2.json` and `run-counts2.log`.
- `run-v2.sh`: copies the three files into `lcnc-webui/src/viewer/`, runs vitest, and removes them on exit. Every run was under `heavy_lock.py --who p6f8`.

## 1. The body

`closedHull(drawn, D, L)`:

- **Input.** The triangles of `buildToolGeometries` (every branch: native mesh, native profile, parametric) **plus today's body as built**, `toolCylinderPositions(D, L + 20)`. The built pin's bottom lies 1.2 µm below the tip (f32), so "united with [0, L + 20]" as a formula would not contain it. The guard's first run caught that (G5).
- **Range.** [min(0, zmin), max(L + 20, zmax)] of that input. The outer boundaries are rounded outward in f32, so clipping and mesh use the same numbers.
- **Slabs.** K = min(32, ceil(len / 5 mm)) equal slabs. A slab is 5 mm or less while len ≤ 160 mm, and grows beyond.
  - Without a tolerance, T13 (len 100.0000012 because of the pin's 1.2 µm) gets **21 slabs of 4.76 mm**: the full matrix (§3) ran so.
  - With the slab COUNT ignoring 1 µm of the range (`snapMm`; the range itself stays whole), T13 gets the brief's **20 slabs of 5.0 mm**. The guard and the two P1 counts were rerun so (§3a), and §6 gives those numbers.
- **Radius per slab.** The largest distance from the axis of the input triangles CLIPPED to the slab. That is every original vertex in the slab plus every edge crossing at both boundaries.
- **The polygon.** A regular 20-gon CIRCUMSCRIBED about that radius: circumradius r / cos(π/20) × (1 + 2⁻²⁰), so the f32 vertices never fall inside r.
- **ONE closed solid:**
  - fans at both caps, side walls, and an annulus at every step;
  - equal neighbouring radii merged;
  - every edge shared by two facets in opposite directions, outward winding.
- **Bridging.** A slab with no input geometry would be bridged at D/2 and counted. None of the 45 inputs needed it.

## 2. Containment, proven on the built mesh (`p6probe.f8hull2.test.ts`)

**The guard measures the BUILT mesh, never the hull's own radius array.**

| Check | What it reads |
|---|---|
| G1 | The mesh's cross-section at three heights inside each slab: the axis inside, and its apothem A_k ≥ the REQUIRED radius r_k. r_k is computed by the guard: the clipped points of drawn ∪ pin. A_k ≥ r_k means every point at r_k is inside at every angle, also between two polygon corners. |
| G2 | Every clipped point (vertices + crossings at both boundaries) at \|xy\| ≤ A_k. |
| G3 | An explicit point at r_k along the apothem's direction (between two corners), inside the measured section. |
| G4 | The caps: the mesh's z range covers the input's. |
| G5 | Today's pin as built: its clipped points inside, its bottom not below the hull's. |
| G6 | `buildCollisionModel`: `open` empty, no `geometryNote`, signed volume > 0. |

**Inputs (45):**

- T13 at D 1.875 and at the old D 8;
- end mills Ø6 on Ø6, Ø3 on Ø6, and OAL 120 > L + 20;
- a native mesh with a lug at r 9..12 (table D 6);
- a native mesh reaching z −4;
- a formmill profile with y < 0;
- Codex's long facet (4,0,0) (4,0,20) (0,4,20) at table D 2;
- all 36 tools of the shipped xyz3 seed library: 21 parametric, 14 native profiles, 1 native mesh, each with its table D and L.

**Result: 45 / 45 pass G1–G6**, at both slab counts (without the tolerance and with the 1 µm snap: T13 20 × 5.0, end mills 14 / 12 / 24 × 5.0). The smallest margin A_k − r_k is 1.65e-7: positive, from the 2⁻²⁰ inflation. The mutant counts below are the same in both runs (`f8-hull2.json`, `f8-hull2-snap.json`).

**Mutants** (switches in `closedHull`; the guard unchanged):

| Mutant | Inputs red | First red |
|---|---|---|
| no clipping, original vertices only | **31 / 45** | T13: slab 0 apothem 0.998 < required 1.245 (the cone's facets span 47 mm) |
| inscribed 20-gon | **45 / 45** | T13: slab 0 apothem 1.230 < required 1.245 (= r · cos(π/20)) |
| no union with today's body | 26 / 45 | T13: the bottom cap misses the pin's −1.2 µm; T13 D 8: the tip slab under D/2 |
| range from 0 | 32 / 45 | the native mesh to z −4, the formmill with y < 0, and the pin's −1.2 µm |
| range to L + 20 only | 22 / 45 | T13: top cap 83.19 below the drawn 100 |

**The v1 guard on the "original vertices only" mutant.** It checks original vertices against the hull's own radius array, and it **passes on 45 / 45 inputs, 31 of them red under the v2 guard.** That is Codex R461's counterexample, reproduced on the real tools.

**What the guard does not catch.** The guard's required radii use the same `clipTri` as the builder. A bug in that clipper would pass both. The product guard needs an independent clipper, or dense samples on every facet, for G1/G2.

**Build cost** (desktop VM, main thread):

- median 0.43 ms per tool, max 8.7 ms (the first call, T13);
- a native mesh of **200 000 triangles: 27–33 ms** (4 runs);
- the work is O(triangles × slabs each one meets); a facet usually meets 1–2 slabs.

## 3. The counts (`p6probe.f8counts2.test.ts`)

**Setup.**

- The same synthetic scene, programs, tools, margin (2 mm) and chain as v1: `buildCollisionModel` → `sweepCollisions` → `ContactStore` → `buildContactView` / `viewCounts` / `targetAt`.
- **One variable: the `tool: true` body.**
- Every body: one warm-up sweep (its counts), then 3 timed repeats, the counts checked equal on each (they were, 20/20). The median is shown, the warm-up in brackets.
- Run `run-counts2.log`: vitest passed, 354 s, under the heavy lock.

| Program · tool | Body | Findings (coll. + near) | clampA×tool coll. f/r · near f/r | clampB×tool coll. f/r · near f/r | Sweep ms, median of 3 [warm-up] | Facets | Closed |
|---|---|---|---|---|---|---|---|
| **P1 · T13 D 1.875** | pin (today) | **0** | 0/0 · 0/0 | 0/0 · 0/0 | 1 058 [1 265] | 80 | yes |
| | envelope Ø8 | **22** (6 + 16) | 3/2 · 4/4 | 1/0 · 4/4 | 1 180 [1 190] | 80 | yes |
| | **closed hull, 21 slabs of 4.76** | **3** (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | **3 311** [3 462] | 880 | **yes** |
| | stacked, same 21 slabs (v1 construction) | 3 (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | 3 332 [3 439] | 1 680 | **open** |
| | drawn (reference) | **3** (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | 22 681 [22 640] | 1 440 | yes |
| **P1 · T13, old table D 8** | pin | 22 (6 + 16) | 3/2 · 4/4 | 1/0 · 4/4 | 1 159 [1 171] | 80 | yes |
| | envelope Ø14.08 | 46 (30 + 16) | 9/8 · 4/4 | 7/6 · 4/4 | 1 344 [1 336] | 80 | yes |
| | **closed hull, 21 slabs** | **28** (10 + 18) | 4/3 · 5/4 | 2/1 · 5/4 | 3 256 [3 260] | 880 | **yes** |
| | stacked, same 21 slabs | 28 (10 + 18) | 4/3 · 5/4 | 2/1 · 5/4 | 3 525 [3 528] | 1 680 | **open** |
| | drawn (reference) | **27** (10 + 17) | 4/3 · 5/4 | 2/1 · 4/4 | 23 694 [24 234] | 1 440 | yes |
| **P2 · T1 Ø6 on Ø6** | pin | 2 (0 + 2) | 0/0 · 2/0 | — | 172 [171] | 80 | yes |
| | envelope | 2 | 0/0 · 2/0 | — | 166 [168] | 80 | yes |
| | **closed hull, 14 slabs of 5** | 2 | 0/0 · 2/0 | — | **163** [164] | 160 | **yes** |
| | stacked, same 14 slabs | 2 | 0/0 · 2/0 | — | 433 [427] | 1 120 | open |
| | drawn | 2 | 0/0 · 2/0 | — | 205 [206] | 192 | open (cutter and shaft: two lathes) |
| **P2 · T14 Ø3 on Ø6** | pin | **0** | 0/0 · 0/0 | — | 170 [173] | 80 | yes |
| | envelope | 2 | 0/0 · 2/0 | — | 176 [176] | 80 | yes |
| | **closed hull, 12 slabs of 5** | **2** | 0/0 · 2/0 | — | **453** [468] | 240 | **yes** |
| | stacked, same 12 slabs | 2 | 0/0 · 2/0 | — | 473 [477] | 960 | open |
| | drawn | 2 | 0/0 · 2/0 | — | 208 [209] | 240 | open |

**What does not depend on the body.**

- **Other pairs:** none in any of the 20 runs: no tool × plate, no spindle × clamp, no static contact.
- **Gaps:** 0 in every run, shown and twin.
- **Truncation:** none; every sweep covered the whole track.

**Notes** (`uncertified`):

- "tool: surface not closed" for every stacked body, and for the drawn end mills of P2 (cutter and shaft are two lathes).
- **None for the closed hull.** Its model body is `insideClosed`, so the inside check is asked for it, which no stacked body allowed.

### 3a. The brief's candidate: 20 slabs of 5.0 mm (P1 only)

**Run.** `run-snap.log`, `f8-counts2-snap.json`: `P6_F8_SNAP_MM=0.001`, only P1, and only pin / closed hull / drawn. The drawn reference has one sweep (its counts as in §3), with no timed repeats. Vitest passed (with the guard) under the heavy lock, at head `a2a3d14e` (`6c78780c` plus scratch commits only).

| Program · tool | Body | Findings (coll. + near) | clampA×tool coll. f/r · near f/r | clampB×tool coll. f/r · near f/r | Sweep ms, median of 3 [warm-up] | Facets | Closed |
|---|---|---|---|---|---|---|---|
| **P1 · T13 D 1.875** | pin | 0 | 0/0 · 0/0 | 0/0 · 0/0 | 988 [1 092] | 80 | yes |
| | **closed hull, 20 × 5.0 mm** | **3** (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | **2 745** [2 794] | 800 | **yes** |
| | drawn (reference) | 3 (0 + 3) | 0/0 · 2/1 | 0/0 · 0/0 | [23 901] | 1 440 | yes |
| **P1 · T13, old D 8** | pin | 22 (6 + 16) | 3/2 · 4/4 | 1/0 · 4/4 | 1 122 [1 143] | 80 | yes |
| | **closed hull, 20 × 5.0 mm** | **28** (12 + 16) | 5/3 · 4/4 | 3/1 · 4/4 | **3 202** [3 239] | 880 | **yes** |
| | drawn (reference) | 27 (10 + 17) | 4/3 · 5/4 | 2/1 · 4/4 | [23 019] | 1 440 | yes |

**Coverage at 20 × 5.0** (same method and tolerances as §4):

- **P1, D 1.875.** The hull misses 0 of 3 margin stretches shown and 0 of 120 / 0 of 117 in the twin. Its extra margin path is 3.0 mm.
- **P1, D 8.** The hull misses 0 of 27 margin and **0 of 10 touch** stretches shown, and 0 of 144 / 0 of 127 in the twin. Its extra is 43.6 mm of margin path and 50.9 mm of touch path.
- **D 8 at 5.0 mm, by count:** 28 findings as at 4.76 mm, but 12 + 16 against 10 + 18.
  - At clampA one of the reference's feed near misses becomes a collision (near 5 → 4, collisions 4 → 5).
  - At clampB there is one feed collision more than in the reference, with its near misses unchanged.
  - This is the coarser slab's over-approximation; the coverage is unaffected.
- **The pin** misses as in §4. The hull ⊇ pin, 0 missed.
- **Gaps** 0, **truncation** none, **notes** none for the hull.

## 4. Coverage: pair and stretch, from the raw contact rows

**What is checked.** Every reference stretch must lie inside the union of the candidate's stretches of the same pair:

- **margin stretches:** ContactStore episodes, onset..end;
- **touch stretches:** intervals, enter..exit.

**Tolerances** are the sweep's own resolution, never widened:

- margin ± 0.25 of path (`MIN_ADV`, the guarantee: no margin crossing wider than it is missed);
- touch ± 2e-3 (the bisection stops at 1e-3 on each side).

"Twin" is the same sweep with the stock unflagged, so every tool × stock contact is written too (machining included). Each cell gives the reference stretches missed / their total uncovered length in mm of path.

| Program | Candidate | Margin (shown) | Touch (shown) | Margin (twin) | Touch (twin) | Candidate's extra, margin / touch (mm of path) |
|---|---|---|---|---|---|---|
| P1 T13 D 1.875 | pin | **3 of 3 / 65.8** | 0 of 0 | **3 of 120 / 65.8** | 0 of 117 | 0 / 0 |
| | envelope | 0 of 3 | 0 of 0 | 0 of 120 | 0 of 117 | 507.2 / 135.0 |
| | **closed hull** | **0 of 3** | 0 of 0 | **0 of 120** | **0 of 117** | **2.7 / 0** |
| P1 T13 D 8 | pin | **27 of 27 / 150.0** | **10 of 10 / 109.2** | 27 of 144 / 150.0 | 10 of 127 / 109.2 | 0 / 0 |
| | envelope | 0 of 27 | 0 of 10 | 0 of 144 | 0 of 127 | 695.8 / 602.4 |
| | **closed hull** | **0 of 27** | **0 of 10** | **0 of 144** | **0 of 127** | **44.3 / 8.7** |
| P2 Ø6 on Ø6 | pin, envelope, closed hull | 0 of 2 | 0 of 0 | 0 of 4 | 0 of 2 | 0 / 0 |
| P2 Ø3 on Ø6 | pin | **2 of 2 / 48.2** | 0 of 0 | **2 of 4 / 48.2** | 0 of 2 | 0 / 0 |
| | envelope, closed hull | 0 of 2 | 0 of 0 | 0 of 4 | 0 of 2 | 0 / 0 |

**The closed hull contains today's pin, stretch for stretch.** Every pin stretch is inside the hull's: 0 missed in all four programs, shown and twin, margin and touch (e.g. D 8: 22 margin and 6 touch stretches shown, 139 and 123 in the twin).

**The verdicts.**

- **Closed hull: covers every confirmed conflict stretch of the exact reference, with no miss and zero uncovered length, in every row.** That includes the D 8 row, the only one with reference COLLISIONS (10 touch stretches, 109 mm of touching path that the pin misses in part), and the 117–127 machining contacts of the twins.
- **Pin (today): misses** the reference's stretches wherever the library's shape is wider than the table D. P1 T13 D 1.875: all 3 near misses (66 mm). Ø3 on Ø6: both shank near misses (48 mm). D 8: parts of all 27 margin and all 10 touch stretches (the Ø14 cone end).
- **Envelope:** covers too, at 190× (P1) and 16× (D 8) the hull's extra margin path.
- **Known / unchecked coverage is equal for all bodies:** no gaps, no truncation, no unknown stretches. The certification differs only by closure: the closed hull carries no note; the stacked body and the drawn two-lathe end mills do.

## 5. What the numbers say

1. **The closed hull reports what the exact drawn shape reports.**
   - P1 at the operator's D 1.875: **3 findings = 3** at both 20 × 5.0 mm and 21 × 4.76 mm: the same pair, kinds and stretches, plus 3.0 / 2.7 mm of margin path.
   - At the old D 8: 28 against 27 at both slab heights.
     - At 4.76 mm the hull has the same 10 collisions and one near miss more on clampB.
     - At 5.0 mm, 12 + 16: one clampA near miss becomes a collision and clampB has one collision more.
     - Every reference stretch is covered at both.
   - v1's "5 with the stepped hull" was 16 stacked slabs of 6.25 mm. At 21 slabs of 4.76 the stacked and the closed body both give 3. **The slab height made the difference, not the closure.**
2. **Closure changes the certification, not the counts here.** The closed body is `insideClosed`: no "surface not closed" note, and a part wholly inside the tool would be found. The stacked body has neither.
3. **Cost** (desktop VM, single thread, median of 3):
   - P1 at 20 × 5.0: **2.75 s against the pin's 0.99 s: 2.8×**. At 21 × 4.76: 3.3 s against 1.06 s, 3.1×. The drawn lathe takes 22.7–23.9 s.
   - The stacked body at the same slabs costs the same (3.3–3.5 s): the closure adds no measurable cost. (v1's 2.3 s for 16 stacked slabs was one unrepeated run and is not compared here.)
   - P2 Ø3 on Ø6: 453 against 170 ms, 2.7×. P2 Ø6 on Ø6: 163 against 172 ms, no difference (the hull has a single radius over most of its length).
   - **No N100 figure is claimed.** The machine day's sweep of 9.2 s × 3.1 is arithmetic, not a measurement.
4. **The envelope** stays the plain fallback: 22 findings (6 collisions) where the reference has 3, and 46 (30 collisions) where it has 27.

## 6. For Q5 (updated)

| Body | P1 T13 (D 1.875) | P1 at old D 8 | Ø3 on Ø6 | Sweep P1 | Covers the reference's stretches | Closed |
|---|---|---|---|---|---|---|
| (a) pin, today | 0 | 22 | 0 | 1.06 s | **no**: misses 3/3, 27/27 + 10/10 touches, 2/2 | yes |
| (b) envelope, one cylinder of the widest Ø | 22 (6 coll.) | 46 (30 coll.) | 2 | 1.18 s | yes | yes |
| **(c) closed stepped hull, 20 × 5.0 mm** | **3** (0 coll.) | **28** (12 coll.) | **2** (12 × 5.0) | **2.75 s** | **yes, every stretch** | **yes** |
| drawn shape (reference, not proposed) | 3 | 27 | 2 | 22.7 s | — | yes / open (two lathes) |

**Recommendation to put to the operator: (c), 5 mm slabs.** On this scene, at the operator's D, it reports what the library's shape reports (3 = 3), at 2.8× today's sweep time, and never less than today's pin. At the old wrong D 8 it reports 12 collisions where the shape has 10 (one near miss turned collision, one extra). The 21 × 4.76 mm run gave the same 3 findings, at 3.1×. (b) is the plainer rule at today's cost, with many more findings near clamps on a tapered tool.

## 7. Not verified

- **The scene is synthetic**, as in v1: real counts depend on the clamps and the stepover.
- **The N100.** Sweep times are the desktop VM's, single thread, through the unit chain, not the page's worker pool and shards.
- **The native branches were not swept.** The native mesh and native profile were proven as geometry only (§2: 14 native profiles, 2 meshes); no collision sweep ran with them.
- **The slab range tolerance.** Measured both ways: 21 × 4.76 mm (no tolerance, the full matrix) and 20 × 5.0 mm (the slab count ignoring 1 µm; P1 only, envelope and stacked not rerun, the drawn reference without timed repeats).
- **The shared clipper** (§2): the guard's required radii and the builder use the same `clipTri`.
- **T13's real library entry**: as in v1 (`shoulder_length` 50 assumed, R1, no `tapered_type`).

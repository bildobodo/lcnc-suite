# R433 P4 source audit

Read-only excerpts at 70106a7e; no implementation and no live test.

## lcnc-gateway/gateway.py

SHA256 `54ed19e3abca2a01eee9782a62dc28698cc7af909c1d0c73196cdb204c3e5a4e`

```text
6335:     if cmd == "estop_reset":
6336:         # Trip-ack gate: a client that stayed armed through a trip (a trip
6337:         # revokes nothing — armed is authorization, not liveness) could
6338:         # otherwise Reset -> Machine On without ever confronting the
6339:         # banner; the ack gate on `arm` only bites for clients that lost
6340:         # armed. Enforced recovery order, matching the banner text:
6341:         # Acknowledge -> re-Arm if needed -> E-Stop Reset -> Machine On.
6342:         if _unacked_trip is not None:
6343:             return {"ok": False, "error": "Safety trip not acknowledged"}
6344:         require_armed(armed)
6345:         # Do NOT pre-check emc_enable_in here. Standard LinuxCNC safety
6346:         # chains feed iocontrol.0.user-enable-out back into the AND that
6347:         # drives emc-enable-in (the operator-acknowledgement latch).
6348:         # user-enable-out is LOW by design while task is in STATE_ESTOP,
6349:         # so emc-enable-in is *always* FALSE at the moment of reset —
6350:         # checking it deadlocks the only command that can escape ESTOP.
6351:         # machine_on is the correct gate: by then user-enable-out is
6352:         # TRUE and emc-enable-in reflects only hardware conditions.
6353:         # UI's safetyChainOpen still keeps the estop indicator visible
6354:         # if the chain is hardware-open post-reset, so the operator is
6355:         # not misled. Issues #14 (problem) and #15 (this regression).
6356:         # Pulse the HAL latch reset first so the safety chain can come back
6357:         # up when LinuxCNC transitions out of ESTOP. The gateway sends the
6358:         # IPC; hal_watchdog drives webui-safety.trip-reset-out, and the
6359:         # servo-thread estop_latch clears within a cycle. 20ms sleep ≈ 2×
6360:         # hal_watchdog select slice, enough for the reset edge to propagate
6361:         # and ok-out to land before STATE_ESTOP_RESET is evaluated.
6362:         _hal_send({"trip_reset": True})
6363:         await asyncio.sleep(0.02)
6364:         await _cmd_blocking(link(), op(linuxcnc.command.state, linuxcnc.STATE_ESTOP_RESET), wait=None)
6365:         _estop_hold = False
6366:         _hal_send({"connected": True})
6367:         return {"ok": True}
6368: 
```

```text
5013: async def _tool_table_for_edit(tbl_path: str) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
5014:     """(tools, None) — the table as a tool edit rewrites it, read STRICTLY —
5015:     or (None, the refusal): a line the reader does not understand would be
5016:     dropped by the rewrite, so the edit writes nothing (Codex R323 FI-I50)."""
5017:     try:
5018:         return await asyncio.to_thread(parse_tool_table, tbl_path, True), None
5019:     except ToolTableUnreadable as e:
5020:         _trace.emit("tools.table_unreadable", level="warn", tbl_path=tbl_path, msg=str(e))
5021:         return None, f"{e} — nothing written"
5022: 
5023: 
5024: def _write_tool_table_admitted(tbl_path: str, tools: list, conn_key) -> None:
5025:     """A WS tool edit's write, admitted at the write itself, in its thread
5026:     (button gates BG-14): its connection armed NOW (BG-23); the handler
5027:     holds _cmd_lock, which every start needs. A refusal is a PermissionError
5028:     — the bounded reply."""
5029:     why = _write_admission_refusal(conn_key, tool_table=True)
5030:     if why:
5031:         raise PermissionError(why)
5032:     write_tool_table(tbl_path, tools)
5033: 
5034: 
```

```text
6660:     if cmd == "save_tool":
6661:         require_armed(armed)
6662:         tool_num = finite_int(msg["tool_number"], lo=0)
6663:         tbl_path = get_tool_tbl_path()
6664:         if not tbl_path:
6665:             return {"ok": False, "error": "Tool table path not available"}
6666: 
6667:         # Update tool.tbl — all file I/O off the loop; _cmd_lock stays held
6668:         # so the read-modify-write is still serialized (B3). ToolLibraryStore
6669:         # is lock-guarded, so an offloaded status-loop read can't race it.
6670:         tbl_tools, refusal = await _tool_table_for_edit(tbl_path)
6671:         if tbl_tools is None:   # (None exactly with its refusal)
6672:             return {"ok": False, "error": refusal}
6673:         found = False
6674:         for t in tbl_tools:
6675:             if t["T"] == tool_num:
6676:                 if "pocket" in msg:
6677:                     t["P"] = finite_int(msg["pocket"], lo=0)
6678:                 if "z_offset" in msg:
6679:                     t["Z"] = finite_float(msg["z_offset"])
6680:                 if "diameter" in msg:
6681:                     t["D"] = finite_float(msg["diameter"], lo=0)
6682:                 if "remark" in msg:
6683:                     t["remark"] = str(msg["remark"])
6684:                 found = True
6685:                 break
6686:         if not found:
6687:             return {"ok": False, "error": f"Tool T{tool_num} not found"}
6688: 
6689:         def update(library):
6690:             key = str(tool_num)
6691:             if key not in library:
6692:                 library[key] = {}
6693:             for field in _TOOL_META_FIELDS:
6694:                 if field in msg:
6695:                     library[key][field] = msg[field]
6696:         await _persist_tool_edit(tbl_path, tbl_tools, conn_key, update, meta_dirty=True)
6697:         return {"ok": True}
6698: 
6699:     if cmd == "add_tool":
6700:         require_armed(armed)
```

```text
6758:     if cmd == "renumber_tool":
6759:         # One transactional renumber (issue #30): validate, then rewrite the
6760:         # tool table AND move the metadata together under the already-held
6761:         # _cmd_lock. Replaces the old add_tool+delete_tool client sequence,
6762:         # which could leave a duplicate / lost tool if the second send failed.
6763:         require_armed(armed)
6764:         old_num = finite_int(msg["old_tool_number"], lo=0)
6765:         new_num = finite_int(msg["tool_number"], lo=0)
6766:         tbl_path = get_tool_tbl_path()
6767:         if not tbl_path:
6768:             return {"ok": False, "error": "Tool table path not available"}
6769: 
6770:         tbl_tools, refusal = await _tool_table_for_edit(tbl_path)
6771:         if tbl_tools is None:   # (None exactly with its refusal)
6772:             return {"ok": False, "error": refusal}
6773:         src = next((t for t in tbl_tools if t["T"] == old_num), None)
6774:         if src is None:
6775:             return {"ok": False, "error": f"Tool T{old_num} not found"}
6776:         if new_num != old_num and any(t["T"] == new_num for t in tbl_tools):
6777:             return {"ok": False, "error": f"Tool T{new_num} already exists"}
6778: 
6779:         # Don't renumber the tool in the spindle — its active offset would
6780:         # shift under it.
6781:         link().stat.poll()
6782:         current = safe_get("tool_in_spindle", None)
6783:         try:
6784:             current = int(current) if current is not None else None
6785:         except (ValueError, TypeError):
6786:             current = None
6787:         if current == old_num:
6788:             return {"ok": False, "error": f"Cannot renumber T{old_num} — currently in spindle"}
6789: 
6790:         src["T"] = new_num
6791:         if "pocket" in msg:
6792:             # a renumber changes the number; an unsent pocket stays (Codex
6793:             # R321 FI321-02 — it used to become the new tool number)
6794:             src["P"] = finite_int(msg["pocket"], lo=0)
6795:         src["Z"] = finite_float(msg.get("z_offset", src.get("Z", 0.0)))
6796:         src["D"] = finite_float(msg.get("diameter", src.get("D", 0.0)), lo=0)
6797:         src["remark"] = msg.get("remark", src.get("remark", ""))
6798:         def update(library):
6799:             meta = library.pop(str(old_num), {}) or {}
6800:             for field in _TOOL_META_FIELDS:
6801:                 if field in msg:
6802:                     meta[field] = msg[field]
6803:             library[str(new_num)] = meta
6804:         await _persist_tool_edit(tbl_path, tbl_tools, conn_key, update)
6805:         return {"ok": True, "tool_number": new_num}
6806: 
6807:     if cmd == "tool_change":
6808:         require_armed(armed)
6809:         blocked = reject_if_auto_running()
6810:         if blocked:
6811:             return blocked
6812:         tool_num = finite_int(msg["tool_number"], lo=0)
6813:         refused = await _start_guard(armed)
6814:         if refused:
6815:             return refused
6816:         await set_mode(linuxcnc.MODE_MDI)
6817:         # Separate interpreter blocks are essential: within `Tn M6 G43`
```

## lcnc-webui/src/ToolTablePanel.vue

SHA256 `8ddc2b53740b80da3496e30a9bb9403dc1a211ad2bb3226718d5f492ad3f7ed8`

```text
240: }
241: 
242: function openEdit(tool: Tool) {
243:   showNominalHolder.value = false;
244:   editError.value = null;
245:   saving.value = false;
246:   saveSession.value = null;
247:   editTool.value = tool;
248:   editForm.value = {
249:     T: tool.T,
250:     P: tool.P,
251:     type: tool.type || "",
252:     description: tool.description || tool.remark || "",
253:     D: tool.D,
254:     Z: tool.Z,
255:     flutes: tool.flutes,
256:     oal: tool.oal,
257:     flute_length: tool.flute_length,
258:     corner_radius: tool.corner_radius,
259:     body_length: tool.body_length,
260:     shaft_diameter: tool.shaft_diameter,
261:     taper_angle: tool.taper_angle,
262:     point_angle: tool.point_angle,
263:     tip_diameter: tool.tip_diameter,
264:     material: tool.material || "",
```

```text
291: function buildToolMsg(form: typeof editForm.value) {
292:   return {
293:     tool_number: form.T,
294:     pocket: form.P,
295:     diameter: form.D,
296:     z_offset: form.Z,
297:     remark: form.description,
298:     description: form.description,
299:     type: form.type,
300:     flutes: form.flutes,
301:     oal: form.oal,
302:     flute_length: form.flute_length,
303:     corner_radius: form.corner_radius,
304:     body_length: form.body_length,
305:     shaft_diameter: form.shaft_diameter,
306:     taper_angle: form.taper_angle,
307:     point_angle: form.point_angle,
308:     tip_diameter: form.tip_diameter,
309:     material: form.material || null,
310:     holder: form.holder || null,
311:   };
312: }
313: 
314: function saveEdit() {
315:   if (!editTool.value || saving.value) return;   // belt and braces: one send per session
316:   const orig = editTool.value;
317:   const form = editForm.value;
318:   editError.value = null;
319: 
320:   // Renumber is one transactional backend command (issue #30); add and
321:   // save take the same reply-driven path (UI-12): the dialog stays open —
322:   // fields editable until the send actually happened, disabled while the
323:   // reply is pending — and closes only on ITS ok.
324:   const payload = !isNewTool.value && form.T !== orig.T
325:     ? { cmd: "renumber_tool" as const, old_tool_number: orig.T, ...buildToolMsg(form) }
326:     : isNewTool.value
327:       ? { cmd: "add_tool" as const, ...buildToolMsg(form) }
328:       : { cmd: "save_tool" as const, ...buildToolMsg(form) };
329:   const id = fire(payload, "toolTableWrite");
330:   if (id === null) return;                       // nothing sent — fire() said why; no pending
331:   saveSession.value = { id, cmd: payload.cmd };
332:   saving.value = true;
333:   // The reply for OUR request (by req_id — a map, never a watch on lastReply,
334:   // #28) closes the dialog on ok and reloads; an ok:false keeps the draft and
335:   // shows why. No reply in time: the outcome is unknown, the draft stays.
336:   void awaitReply(id, TOOL_WRITE_REPLY_MS).then((reply) => {
337:     const s = saveSession.value;
338:     if (!s || s.id !== id) return;               // ended already (disconnect)
339:     saveSession.value = null;
340:     saving.value = false;
```

```text
595: const hoverTool = ref<Tool | null>(null);
596: const hoverPos = ref({ x: 0, y: 0 });
597: let hoverTimer = 0;
598: 
599: // Tap or hover is input behaviour: the session's first touch decides it at
600: // once (touchInput), not the touch sizes that follow its press (Codex R231).
601: const tapNotHover = () => touchInput.value;
602: 
603: function onToolEnter(tool: Tool, e: MouseEvent) {
604:   // Touch uses the tap path (onToolTap) — the emulated mouseenter that
605:   // precedes a tap's click would race the 300ms timer against the toggle.
606:   if (tapNotHover()) return;
607:   clearTimeout(hoverTimer);
608:   const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
609:   hoverTimer = window.setTimeout(() => {
610:     hoverPos.value = { x: rect.right + 8, y: rect.top };
611:     hoverTool.value = tool;
612:   }, 300);
613: }
614: 
615: function onToolLeave() {
616:   // Not touch-gated: the emulated mouseleave when tapping elsewhere is
617:   // what dismisses a tap-pinned preview.
618:   clearTimeout(hoverTimer);
619:   hoverTool.value = null;
620: }
621: 
622: /** Touch equivalent of the hover preview: tap a row to pin it, re-tap to hide. */
623: function onToolTap(tool: Tool, e: MouseEvent) {
624:   if (!tapNotHover()) return;
625:   if (hoverTool.value?.T === tool.T) { hoverTool.value = null; return; }
626:   const cell = (e.currentTarget as HTMLElement).querySelector("td");
627:   const rect = (cell ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
628:   hoverPos.value = { x: rect.right + 8, y: rect.top };
629:   hoverTool.value = tool;
630: }
631: 
632: // The loaded tool's row, for the Tools tab's object line (design wave D5).
633: const currentDescription = computed(() =>
```

## lcnc-webui/src/ToolsetterSettings.vue

SHA256 `4f8780af5d63f33e7431bee4b1f71b85053e95a76431266643877ad3ac6d8f65`

```text
158: /** An operator entry into a G30 field (the v-model.number cast, and an edit). */
159: function editDraft(letter: string, v: string | number | null | undefined) {
160:   g30Draft[letter] = v == null || v === "" ? null : Number(v);
161:   draftRev++;
162: }
163: const ticket = (): G30Ticket => ({ seq: ++reqSeq, rev: draftRev, ctx: g30Context() });
164: const applies = (t: G30Ticket) => replyApplies(t, { appliedSeq, rev: draftRev, ctx: g30Context() });
165: /** The draft differs from what the section shows as stored (empty = empty). */
166: const g30Dirty = computed(() => g30Letters.value.some(l => g30Draft[l] == null
167:   ? g30Stored.value[l] != null : !sameG30(g30Draft[l], g30Stored.value[l])));
168: const g30SaveCheck = computed(() => savePayload(g30Draft, g30Basis.value, g30Letters.value));
169: const g30StoredLine = computed(() => {
170:   const state = g30StoredState.value === "confirmed" ? "confirmed by LinuxCNC"
171:     : g30StoredState.value === "file" ? `as of LinuxCNC's last synch${g30StoredAt.value ? ` (${fmtClock(g30StoredAt.value)})` : ""}`
172:     : g30StoredState.value === "unconfirmed" ? "not confirmed — refresh" : "unknown — refresh";
173:   return `Stored: ${state}${g30Dirty.value ? " · draft not saved" : ""}`;
174: });
175: 
176: function resetG30Draft() {
177:   for (const l of g30Letters.value) g30Draft[l] = g30Stored.value[l] ?? null;
178:   g30DraftContext.value = null;
179: }
180: function takeStored(t: G30Ticket, values: G30Values | undefined, state: "file" | "confirmed") {
181:   appliedSeq = t.seq;
182:   g30Stored.value = { ...(values ?? {}) };
183:   g30StoredState.value = state;
184:   // The 3D view's tool-change pin follows a confirmed value at once (Codex R50 VP-I18).
185:   if (state === "confirmed") noteG30Confirmed(values);
186:   const known = g30Letters.value.every(l => g30Stored.value[l] != null);
187:   g30Basis.value = known ? { ...g30Stored.value } : null;
188: }
189: 
190: async function loadG30() {
191:   const t = ticket();
192:   try {
193:     const data = await fetchG30();
194:     const may = applies(t);
```

```text
217: 
218: async function refreshG30() {
219:   const t = ticket();
220:   const r = await g30Request({ cmd: "read_g30" });
221:   const may = applies(t);
222:   if (r?.ok) {
223:     if (!may.stored) return;
224:     takeStored(t, r.values, "confirmed");
225:     if (may.reset) { resetG30Draft(); g30Note.value = null; }
226:     else g30Note.value = { kind: "warn", text: "Stored G30 refreshed — your newer entry stays a draft" };
227:   } else {
228:     if (r?.confirmed === false && may.stored) g30StoredState.value = "unconfirmed";
229:     g30Note.value = { kind: "error", text: r?.error ?? "No reply — G30 not confirmed" };
230:   }
231: }
232: 
233: async function captureG30() {
234:   const t = ticket();
235:   const r = await g30Request({ cmd: "capture_g30" });
236:   if (!r?.ok || !r.current) {
237:     g30Note.value = { kind: "error", text: r?.error ?? "No reply — nothing taken over" };
238:     return;
239:   }
240:   // The position belongs to the request's frame, units and connection, and
241:   // to the draft as it was: another one takes nothing over.
```

```text
255: 
256: async function saveG30() {
257:   const p = g30SaveCheck.value;
258:   if ("error" in p) return;
259:   const t = ticket();
260:   const r = await g30Request({ cmd: "set_g30", ...p });
261:   const may = applies(t);
262:   if (r?.ok) {
263:     if (may.stored) takeStored(t, r.values, "confirmed");
264:     // A newer entry typed while the save was out stays a draft — the
265:     // confirmation never replaces it (Codex R25 OP-I03).
266:     if (!may.reset) {
267:       g30Note.value = { kind: "warn", text: "G30 saved — your newer entry is still a draft" };
268:       return;
269:     }
270:     resetG30Draft();
271:     g30Note.value = { kind: "ok", text: r.open_axes?.length
272:       ? `G30 saved — ${r.open_axes.join(", ")} has no limit in the INI` : "G30 saved — confirmed by LinuxCNC" };
273:     return;
274:   }
275:   if (!may.stored) { /* a newer reply is shown: this one only speaks */ }
276:   else if (r?.confirmed === true && r.values) {
277:     // Shown, never adopted as the basis: "changed meanwhile" asks for a
278:     // reload, it does not re-base the draft silently (Codex R22).
279:     appliedSeq = t.seq;
280:     g30Stored.value = { ...r.values };
281:     g30StoredState.value = "confirmed";
282:     noteG30Confirmed(r.values);
283:   } else if (r?.confirmed === false || r === null) {
284:     g30StoredState.value = "unconfirmed";
```

```text
340:       <template #default="{ input }">
341:         <MachineInput v-bind="input" gate="toolsetterParam" type="number" :modelValue="g30Draft[a.letter]"
342:                       @update:modelValue="v => editDraft(a.letter, v)" />
343:       </template>
344:     </FormField>
345:     <div class="text-muted wide g30Stored">{{ g30StoredLine }}</div>
346:     <div class="row-tight wide">
347:       <!-- No motion: Use Current Position fills the draft, Save writes it. -->
348:       <MachineBtn type="g30Capture" :disabled="g30Busy" @click="captureG30">Use Current Position</MachineBtn>
349:       <MachineBtn type="g30Save" :disabled="g30Busy || 'error' in g30SaveCheck"
350:                   :reason="'error' in g30SaveCheck ? g30SaveCheck.error : undefined" @click="saveG30">Save G30</MachineBtn>
351:       <MachineBtn type="g30Read" :disabled="g30Busy" @click="refreshG30">Refresh</MachineBtn>
352:     </div>
353:     <div v-if="g30Note" class="statusNote wide" :class="g30Note.kind" :role="g30Note.kind === 'ok' ? undefined : 'alert'"><span>{{ g30Note.text }}</span></div>
354: 
355:     <div class="sep"></div>
```

## lcnc-webui/src/g30Form.ts

SHA256 `e232335f180ab686e20c198adf1c7b26b97da51a631eeeb321a59792f2c60fd1`

```text
59:  *  - `stored`: the stored line and the basis — only when no newer request's
60:  *    reply is shown (a late file read never overwrites a confirmed save) AND
61:  *    in the connection and units it was sent under (Codex R26 OP-I03: an
62:  *    answer from before a reconnect supplies no basis);
63:  *  - `reset`: the draft may follow those stored values (a read, a save's
64:  *    confirmation) — nobody edited it since; the frame is irrelevant to
65:  *    machine coordinates;
66:  *  - `draft`: a CAPTURED position may fill the draft — unedited AND the
67:  *    whole context (units, kinematics, connection) unchanged.
68:  *  A save's confirmation never replaces an entry typed while it was out. */
69: export function replyApplies(t: G30Ticket, now: { appliedSeq: number; rev: number; ctx: G30Context }): { stored: boolean; reset: boolean; draft: boolean } {
70:   const stored = t.seq > now.appliedSeq && !storedContextChanged(t.ctx, now.ctx);
71:   return { stored, reset: stored && t.rev === now.rev,
72:            draft: t.rev === now.rev && !contextChanged(t.ctx, now.ctx) };
73: }
```

## subroutines/probe_basic/probe_cal_round_boss.ngc

SHA256 `9ecb5147c42309acad0773d4b145241db7aafcb7b35a271336d3605ea3000bfe`

```text
5: (Probe calibration offset using defined diam round boss)
6: (Start probe position is over center of stock in X and Y axis)
7: (within max z distance, ensure all settings have been)
8: (set properly according to help diagrams)
```

```text
58: 
59:   #<z_probe_stack> = [#<z_clearance> + #<probe_diameter> + #<extra_probe_depth>]
60: 
61:   (Call sub "probe_z_minus_sub" to Probe top of Workpiece)
62:   o<probe_z_minus_sub> call [#3014][#3015][#3016][#3017][#3020][#3021][#3030][#3032]
63: 
64:   (Probe X Positioning Move, X hint/2 + Step Off Width)
65:   G91
66:   F[#<probe_traverse_fr>]
67:   G38.3 X-[#<cal_diameter>/2 + #<step_off_width>]
68: 
69:   (Probe X Positioning Move, to Probing Depth)
70:   F[#<probe_fast_fr>]
71:   G38.3 Z-[#<z_probe_stack>]
72: 
73:   (Call sub "probe_x_plus" to Probe x+ side of Workpiece)
74:   o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][#3032]
```

## subroutines/probe_basic/probe_cal_square_boss.ngc

SHA256 `36b00b77ffbf93a486e7378f91d7e79146898f7725858ad8c5a72c27ad3f6fc9`

```text
5: (Probe calibration offset using defined width square boss)
6: (Start probe position is over center of stock in X and Y axis)
7: (within max z distance, ensure all settings have been)
8: (set properly according to help diagrams)
```

```text
60:   #<z_probe_stack> = [#<z_clearance> + #<probe_diameter> + #<extra_probe_depth>]
61: 
62:   (Call sub "probe_z_minus_sub" to Probe top of Workpiece)
63:   o<probe_z_minus_sub> call [#3014][#3015][#3016][#3017][#3020][#3021][#3030][#3032]
64: 
65:   (Probe X Positioning Move, X hint/2 + Step Off Width)
66:   G91
67:   F[#<probe_traverse_fr>]
68:   G38.3 X-[#<x_cal_width>/2 + #<step_off_width>]
69: 
70:   (Probe X Positioning Move, to Probing Depth)
71:   F[#<probe_fast_fr>]
72:   G38.3 Z-[#<z_probe_stack>]
73: 
74:   (Call sub "probe_x_plus" to Probe x+ side of Workpiece)
75:   o<probe_x_plus> call [#3014][#3015][#3016][#3017][#3018][#3019][#3032]
76: 
```

## subroutines/probe_basic/probe_x_plus.ngc

SHA256 `67ed80d6bf7463afc05774258fc4c79129cbc229525a400e727aebfd3babd45b`

```text
40:   #<x> = #5420
41: 
42:   (Initiate Fast X+ Probe)
43:   G91
44:   F[#<probe_fast_fr>]
45:   G38.2 X[#<max_xy_distance>]
46:   #<x_plus_probed> = #5061
47: 
48:   (Probe Error check, #5070 will be 0 if failed)
49:   o110 if [#5070 EQ 0]
```

```text
58:   G90
59:   G1 F[#<probe_traverse_fr>] X[#<x_plus_probed> - #<xy_clearance>]
60: 
61:   (Slow Probe Rule, if Slow Probe FR is set to 0, Slow Probe is Bypassed)
62:   o120 if [#<probe_slow_fr> GT 0]
63:       (Initiate Slow X+ Probe)
64:       G91
65:       F[#<probe_slow_fr>]
66:       G38.2 X[#<xy_clearance> * 2]
67:       #<x_plus_probed> = #5061
68:       G90
69:       G1 F[#<probe_traverse_fr>] X[#<x_plus_probed> - #<xy_clearance>]
70:   o120 endif
71: 
72:   #<x_plus_zero_edge> = [#<x_plus_probed> + #<probe_center_offset>]
73: 
74:   (defines the edge as x_probed_position for DRO reporting)
75:   #<x_plus_probed_position> = #<x_plus_zero_edge>
```

## lcnc-gateway/gcode_canon.py

SHA256 `8143e619d5b3d7557a9b042bcb5cbf149a3a47cb69cc04b14578ea8e33165c9e`

```text
443:     def main_line(self):
444:         """The MAIN file's line the interpreter executes at this callback —
445:         its current line where the main file runs (an inline or M98 sub's own
446:         line too), else the line the deepest frame of the main file called
447:         from: a remap trigger, an o-call or M98 line (measured natively,
448:         Codex R107); in a remap of the main file whose code keeps its file (a
449:         Python remap) the trigger's line (R109). None outside a parse or
450:         without the interpreter's word; 0 where it names no main-file line
451:         (the initcodes, a Python remap triggered in another file)."""
452:         if self.main_file is None:
453:             return None
454:         t = self.interp()
455:         if t is None:
456:             return None
457:         if int(t.remap_level) == 0 and self._is_main(t.filename):
458:             return int(t.sequence_number)
459:         for k in range(int(t.call_level) - 1, -1, -1):
460:             c = t.sub_context[k]
461:             if self._is_main(c.filename):
462:                 return self._byte_line(int(c.position))
463:         if int(t.remap_level) >= 1 and self._is_main(t.filename):
464:             # A Python remap keeps the file it was triggered in and records no
465:             # frame of it (filename "", position 0); its sequence number is
466:             # whatever its execute() passed, or 0 (Codex R109). The remap's
467:             # controlling block — the trigger — carries its byte offset in
468:             # that file (measured: `blocks[1].offset`, the outermost one).
469:             line = self._byte_line(int(t.blocks[1].offset) + 1)
470:             return line if line is not None else 0
471:         return 0
472: 
```

## lcnc-gateway/gcode_parse_worker.py

SHA256 `9ddb9f4eede948885ef653bf802344e66363393eb99f4bc2eb322fde2589bca1`

```text
482:         t0 = time.monotonic()
483:         result, seq = gcode.parse(filename, canon, initcodes, "")
484:         t1 = time.monotonic()
485:         canon.close_band()      # a braking range a parse error cut short ends there
486:         if result > gcode.MIN_ERROR:
487:             # The interpreter hit an error partway through. We still return the
488:             # polyline collected so far, but flag it so the gateway/UI can badge
489:             # the preview as PARTIAL instead of presenting a truncated path as a
490:             # complete one (silent partial-success was the bug).
491:             parse_error = gcode.strerror(result)
492:             error_line = seq
493:             # Machine-readable marker so the gateway can raise the structured
494:             # parse_partial event WITHOUT decoding the (multi-MB) stdout payload.
495:             print(f"__PARTIAL__\t{seq}\t{parse_error}", file=sys.stderr, flush=True)
496:         print(f"gcode.parse feed={len(canon.feed)} rapid={len(canon.rapid)} parse_ms={(t1-t0)*1000:.0f}", file=sys.stderr, flush=True)
497:         if canon.lineno is not None and canon.lineno >= 1 and gcode_canon.interp_this() is None:
```

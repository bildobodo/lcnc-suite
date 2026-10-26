// The control inventory (button gates BG-01, Codex R202–R204, package C):
// every control a DISARMED client can operate, what it does and why that
// needs no arm. Since package C there is no outer `armed` fieldset; the
// scan (controlScan.ts) finds each control whose own gate and every Gate
// around it in its file open without arm, and controlInventory.test.ts
// fails on a control missing here, on an entry the scan no longer finds,
// and on a category outside this list. A PROTECTED effect — a machine
// command, a file, macro or tool-table write, a protected settings section
// — is never a category: such a control takes an armed gate (catalog or
// an inner <Gate>) and drops out of the scan.
//
// Key: `file|component:entry|handlers` (controlScan.ts), no line numbers.

export type ControlCategory =
  /** closes, cancels, navigates, opens a view or a help — no effect beyond the screen */
  | "nav"
  /** client-local state: a filter, a sort, a selection, an input helper's
   *  key, a preselection for the NEXT command (BG-05) */
  | "local"
  /** reads from the gateway: a listing, a download, a retry, a preview */
  | "read"
  /** writes a DISPLAY settings section (display / viewer / panels /
   *  camera) — free for every client (operator Q2) */
  | "display"
  /** edits or discards a local draft (an editor, a dialog's own fields);
   *  committing it is gated elsewhere */
  | "draft"
  /** a stop: open without arm (BG-08 / BG-18) — the backend's state decides */
  | "stop"
  /** the recovery's first steps: Arm, E-Stop, the trip acknowledgement */
  | "recovery"
  /** a diagnostic with no machine, file or settings effect */
  | "diagnostic"
  /** not a catalog control: its handler re-checks the gate and says why */
  | "gatedInHandler"
  /** a hidden control only a gated opener reaches */
  | "openerGated"
  /** an inner Gate whose gate depends on the target (armed for a protected one) */
  | "dynamicGate"
  /** a catalog component's own element: disabled by its catalog gate */
  | "internal";

export const CONTROL_INVENTORY: Record<string, readonly [ControlCategory, string]> = {
  // ── App.vue ──
  "App.vue|MachineBtn:abort|@click=fire({ cmd: 'abort' }, 'abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "App.vue|MachineBtn:bannerAbort|@click=fire({ cmd: 'abort' }, 'abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "App.vue|MachineBtn:bannerAck|@click=acknowledgeSafetyTrip":
    ["recovery", "acknowledges a safety trip: the first step of the recovery, before Arm (the gateway refuses Arm until it)"],
  "App.vue|MachineBtn:bannerAction|@click=openMessages":
    ["nav", "the banner's messages / page refresh"],
  "App.vue|MachineBtn:bannerAction|@click=reloadPage":
    ["nav", "the banner's messages / page refresh"],
  "App.vue|MachineBtn:dialogCancel|@click=cancelCompToggle":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogCancel|@click=clearMessagesAsk = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogCancel|@click=macroParamDialog = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogCancel|@click=settingsDiscard = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogCancel|@click=showShutdownConfirm = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogCancel|@click=tabLeaveAsk = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|MachineBtn:dialogDanger|@click=clearAllMessages(); clearMessagesAsk = false":
    ["local", "clears this tab's message protocol (per-tab history)"],
  "App.vue|MachineBtn:dialogDanger|@click=confirmSettingsDiscard":
    ["draft", "discards the open settings draft"],
  "App.vue|MachineBtn:dialogDanger|@click=confirmTabLeave":
    ["draft", "leaves a tab and discards its local edit"],
  "App.vue|MachineBtn:fileBrowse|@click=toolTableRef?.toggleImportBrowser()":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "App.vue|MachineBtn:fileBrowse|@click=toolTableRef?.uploadLibrary()":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "App.vue|MachineBtn:fileDownload|@click=toolTableRef?.downloadTable()":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "App.vue|MachineBtn:headerIcon|@click=messagesDialogOpen ? closeMessages() : openMessages()":
    ["nav", "a header icon: messages, settings, reference, fullscreen — navigation"],
  "App.vue|MachineBtn:headerIcon|@click=openDialog('settings')":
    ["nav", "a header icon: messages, settings, reference, fullscreen — navigation"],
  "App.vue|MachineBtn:headerIcon|@click=openGcodeRef()":
    ["nav", "a header icon: messages, settings, reference, fullscreen — navigation"],
  "App.vue|MachineBtn:headerIcon|@click=showShutdownConfirm = true":
    ["nav", "opens the Shut down confirmation; its Shut down button is `shutdown` (armed) and the gateway requires arm"],
  "App.vue|MachineBtn:headerIcon|@click=toggleFullscreen":
    ["nav", "a header icon: messages, settings, reference, fullscreen — navigation"],
  "App.vue|MachineInput:mdiText|@keydown=onMdiKeydown v-model=mdiText":
    ["draft", "the MDI line is a draft (BG-05); Enter sends only under `ready` (canSend) — refused, the text stays"],
  "App.vue|MachineSelect:tabSelect|v-model=probeView":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "App.vue|div|@click=mdiText = entry.text":
    ["draft", "puts a history entry into the MDI line's draft (sending is `ready`)"],
  "App.vue|div|@click=openMessages":
    ["nav", "the banner text opens the message center"],
  // ── Btn.vue ──
  "Btn.vue|button|":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── CameraPip.vue ──
  "CameraPip.vue|MachineBtn:close|@click.stop=close":
    ["display", "the camera picture-in-picture: position, size, minimize, close — the free `camera` section"],
  "CameraPip.vue|MachineBtn:windowToggle|@click.stop=toggleMinimize":
    ["display", "the camera picture-in-picture: position, size, minimize, close — the free `camera` section"],
  "CameraPip.vue|div|@pointerdown=onDragStart":
    ["display", "the camera picture-in-picture: position, size, minimize, close — the free `camera` section"],
  "CameraPip.vue|div|@pointerdown=onResizeStart":
    ["display", "the camera picture-in-picture: position, size, minimize, close — the free `camera` section"],
  // ── ChoiceGroup.vue ──
  "ChoiceGroup.vue|MachineChoice:{o.gate}|@choose=el => choose(o, el)":
    ["internal", "each option carries its own catalog gate (task mode: modeSelect/idle, frame: jogFrame/planeFrame, WCS: wcsSelect/probe; the jog step: jogIncrement, a free preselection)"],
  // ── DebugTab.vue ──
  "DebugTab.vue|MachineBtn:inline|@click=downloadTimingCsv":
    ["read", "downloads the timing CSV: reading"],
  "DebugTab.vue|MachineBtn:inline|@click=resetTimingStats":
    ["local", "clears the tab's own timing statistics"],
  "DebugTab.vue|MachineBtn:inline|@click=toggleTimingLog":
    ["diagnostic", "the gateway's timing log on/off: a diagnostic file in the log dir — no machine, file or settings effect"],
  // ── DetailsPopover.vue ──
  "DetailsPopover.vue|MachineBtn:{props.type}|@click=toggle @pointerdown=onPointerDown":
    ["nav", "opens a details card (detailsIcon / headerIcon): reading"],
  // ── DialogFrame.vue ──
  "DialogFrame.vue|MachineBtn:close|@click=requestClose('x')":
    ["nav", "a dialog's X: closing never needs arm (BG-16 — a dialog open at a disarm must close)"],
  // ── FileBrowser.vue ──
  "FileBrowser.vue|MachineBtn:inline|@click=browse(subdir.split('/').slice(0, -1).join('/'))":
    ["read", "folder navigation / retry: reading (BG-02)"],
  "FileBrowser.vue|MachineBtn:retry|@click=browse(failedDirectory)":
    ["read", "folder navigation / retry: reading (BG-02)"],
  "FileBrowser.vue|button|@click=select(entry) @pointerdown=entry.type === 'file' && fileBlock && explainAt($event, fileBlock) :disabled=busy || (entry.type === 'file' && !!fileBlock)":
    ["gatedInHandler", "a folder row browses (reading, BG-02); a FILE row carries the parent's gate (fileGate: Program `setup` load, Tools a free preview) — disabled with its reason, select() re-checks"],
  // ── FloatingOverlays.vue ──
  "FloatingOverlays.vue|button|@click=inputGlyph.open?.() @pointerdown.prevent=":
    ["local", "the keyboard glyph opens the focused field's input helper; the field's own gate decides what its confirm may do"],
  // ── GamepadMapWizard.vue ──
  "GamepadMapWizard.vue|MachineBtn:dialogCancel|@click=emit('cancel')":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GamepadMapWizard.vue|MachineBtn:inlineMd|@click=requestRestart":
    ["local", "the mapping wizard: start over (its Save is dialogSettingConfirm, armed)"],
  "GamepadMapWizard.vue|MachineBtn:inlineMd|@click=skip":
    ["local", "the mapping wizard: skip a step (its Save is armed)"],
  // ── GamepadTab.vue ──
  "GamepadTab.vue|MachineBtn:dialogCancel|@click=removeConfirm = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  // ── GcodePanel.vue ──
  "GcodePanel.vue|MachineBtn:abort|@click=emit('abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "GcodePanel.vue|MachineBtn:close|@click=downloadError = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:close|@click=saveError = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:close|@click=uploadError = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:dialogCancel|@click=showDiscardConfirm = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:dialogCancel|@click=showRunDialog = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:dialogCancel|@click=uploadConflict = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "GcodePanel.vue|MachineBtn:dialogDanger|@click=confirmDiscard":
    ["draft", "discards the program edit"],
  "GcodePanel.vue|MachineBtn:fileBrowse|@click=toggleBrowser":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "GcodePanel.vue|MachineBtn:fileDiscard|@click=discardEdit":
    ["draft", "discards the local edit — never gated (package B: an edit must never be trapped)"],
  "GcodePanel.vue|MachineBtn:fileDownload|@click=downloadProgram":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "GcodePanel.vue|MachineBtn:inlineDanger|@click=discardEdit":
    ["draft", "discards the local edit — never gated (package B: an edit must never be trapped)"],
  "GcodePanel.vue|MachineBtn:inline|@click=emit('showStats')":
    ["nav", "opens the program statistics"],
  "GcodePanel.vue|MachineBtn:inline|@click=keepEditing":
    ["draft", "keeps the local edit (save conflict note)"],
  "GcodePanel.vue|MachineBtn:{isPaused ? 'resume' : 'pause'}|@click=isPaused ? emit('cycleResume') : emit('cyclePause')":
    ["stop", "Pause is a stop (no arm, BG-08); Resume is its own `resume` gate (armed) — the same button, the entry's gate per state"],
  "GcodePanel.vue|MachineInput:displaySettingNum|v-model.number=dialogSpindleSpeed":
    ["draft", "the run-from-line dialog's own fields: a draft; its confirm is under <Gate gate=\"run\">"],
  "GcodePanel.vue|MachineRadio:displaySetting|@update:modelValue=dialogSpindleDir = 'forward'":
    ["draft", "the run-from-line dialog's own fields: a draft; its confirm is under <Gate gate=\"run\">"],
  "GcodePanel.vue|MachineRadio:displaySetting|@update:modelValue=dialogSpindleDir = 'off'":
    ["draft", "the run-from-line dialog's own fields: a draft; its confirm is under <Gate gate=\"run\">"],
  "GcodePanel.vue|MachineRadio:displaySetting|@update:modelValue=dialogSpindleDir = 'reverse'":
    ["draft", "the run-from-line dialog's own fields: a draft; its confirm is under <Gate gate=\"run\">"],
  "GcodePanel.vue|MachineToggle:displaySetting|v-model=dialogSafeZ":
    ["draft", "the run-from-line dialog's own fields: a draft; its confirm is under <Gate gate=\"run\">"],
  "GcodePanel.vue|div|@click=item.kind === 'main' && onLineClick(item.lineNum)":
    ["local", "selects a program line (the selection; Run from line is `run`)"],
  "GcodePanel.vue|input|@change=onFileSelect":
    ["openerGated", "the hidden program file picker: opened only by Upload (sourceOp / sourceWrite); the gateway admits the upload for an armed connection"],
  "GcodePanel.vue|span|@click=interactive && onTokenClick($event, token) @mouseenter=interactive && onTokenMouseEnter($event, token) @mouseleave=interactive && onTokenMouseLeave()":
    ["nav", "a code word's reference tooltip"],
  // ── GcodeReferenceDialog.vue ──
  "GcodeReferenceDialog.vue|MachineInput:search|v-model=search":
    ["local", "filters, searches or plays the display"],
  "GcodeReferenceDialog.vue|MachineSelect:filter|v-model=filterGroup":
    ["local", "filters, searches or plays the display"],
  "GcodeReferenceDialog.vue|button|@click=toggleSort('code')":
    ["local", "sorts the reference table"],
  "GcodeReferenceDialog.vue|button|@click=toggleSort('name')":
    ["local", "sorts the reference table"],
  // ── HalshowTab.vue ──
  "HalshowTab.vue|MachineBtn:inline|@click=collapseAllHal":
    ["local", "HAL pin browser (Debug): expand, collapse, filter — reading"],
  "HalshowTab.vue|MachineBtn:inline|@click=expandAllHal":
    ["local", "HAL pin browser (Debug): expand, collapse, filter — reading"],
  "HalshowTab.vue|MachineBtn:inline|@click=toggleHalGroup(group)":
    ["local", "HAL pin browser (Debug): expand, collapse, filter — reading"],
  "HalshowTab.vue|MachineInput:search|v-model=halSearch":
    ["local", "HAL pin browser (Debug): expand, collapse, filter — reading"],
  // ── HelpIcon.vue ──
  "HelpIcon.vue|span|@click.prevent.stop=toggle @keydown=onKeydown @pointerdown=onPointerDown":
    ["nav", "opens a help popover"],
  // ── JogStrip.vue ──
  "JogStrip.vue|MachineBtn:jogSpeedReset|@click=emit('resetAngularJogVel')":
    ["local", "a preselection for the NEXT jog (BG-05): no command; a running jog keeps its start values"],
  "JogStrip.vue|MachineBtn:jogSpeedReset|@click=emit('resetJogVel')":
    ["local", "a preselection for the NEXT jog (BG-05): no command; a running jog keeps its start values"],
  "JogStrip.vue|MachineBtn:{btn.axis < 0 ? 'jogStop' : 'jog'}|@contextmenu.prevent= @pointercancel.prevent=stopJog(btn, $event) @pointerdown.prevent=startJog(btn, $event) @pointerleave.prevent=stopJog(btn, $event) @pointermove=slideOffCheck @pointerup.prevent=stopJog(btn, $event)":
    ["stop", "the jog pad: the centre Stop is a stop (jogStop, no arm); every direction is `jog` (armed + homed)"],
  "JogStrip.vue|MachineSelect:jogIncrement|@update:modelValue=(v: string | number | undefined) => { if (v != null) emit('update:jogIncrement', Number(v)) }":
    ["local", "a preselection for the NEXT jog (BG-05): no command; a running jog keeps its start values"],
  "JogStrip.vue|MachineSlider:jogSpeed|@update:modelValue=(v: number | undefined) => { if (v != null) emit('update:angularJogVel', v) }":
    ["local", "a preselection for the NEXT jog (BG-05): no command; a running jog keeps its start values"],
  "JogStrip.vue|MachineSlider:jogSpeed|@update:modelValue=(v: number | undefined) => { if (v != null) emit('update:jogVel', v) }":
    ["local", "a preselection for the NEXT jog (BG-05): no command; a running jog keeps its start values"],
  "JogStrip.vue|div|@focusin=onStepFocusin @focusout=onStepFocusout @keydown=onStepKeydown @pointerdown=holdStep":
    ["local", "the step block's own focus handling (the step itself is a free preselection)"],
  // ── KeyboardTab.vue ──
  "KeyboardTab.vue|td|@click=startCapture(action, $event)":
    ["gatedInHandler", "the key-capture cell: refuses while not armed and says why (startCapture → bindReason; the protected `keyboard` section)"],
  // ── MachineBtn.vue ──
  "MachineBtn.vue|span|@click=explain @keydown=gateExplain.onKeydown":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineChoice.vue ──
  "MachineChoice.vue|button|@click=activate":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineColor.vue ──
  "MachineColor.vue|input|v-model=model :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineInput.vue ──
  "MachineInput.vue|input|@click=onTextClick @focus=onTextFocus @focusout=onTextFocusOut @input=onNativeInput @pointerdown=explain :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  "MachineInput.vue|input|@click=openKeypadFromInput @keydown.enter.prevent=openKeypadFromInput @keydown.space.prevent=openKeypadFromInput @pointerdown=onNumberPointerDown :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineRadio.vue ──
  "MachineRadio.vue|input|@pointerdown=explain v-model=model :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineSelect.vue ──
  "MachineSelect.vue|select|@pointerdown=explain v-model=model :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineSlider.vue ──
  "MachineSlider.vue|input|@contextmenu.prevent= @input=onInput @pointerdown=explain :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MachineToggle.vue ──
  "MachineToggle.vue|input|@change=onChange :disabled=isDisabled":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  "MachineToggle.vue|span|@click=explain @keydown=explainKey":
    ["internal", "the catalog component's own element: disabled by its catalog gate (isDisabled), or the explanation affordance of a dimmed one"],
  // ── MacroBar.vue ──
  "MacroBar.vue|MachineBtn:abort|@click=fire({ cmd: 'abort' }, 'abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  // ── MacrosPanel.vue ──
  "MacrosPanel.vue|MachineBtn:abort|@click=fire({ cmd: 'abort' }, 'abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "MacrosPanel.vue|MachineBtn:close|@click=note = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "MacrosPanel.vue|MachineBtn:dialogCancel|@click=closeEditor":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "MacrosPanel.vue|MachineBtn:dialogCancel|@click=deleteAsk = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "MacrosPanel.vue|MachineBtn:dialogCancel|@click=discardAsk = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "MacrosPanel.vue|MachineBtn:dialogCancel|@click=replaceAsk = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "MacrosPanel.vue|MachineBtn:dialogDanger|@click=confirmDiscard":
    ["draft", "discards the macro editor's draft"],
  "MacrosPanel.vue|MachineBtn:fileDownload|@click=downloadSelected":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "MacrosPanel.vue|MachineBtn:inline|@click=keepEditing":
    ["draft", "keeps the macro draft (conflict note)"],
  "MacrosPanel.vue|MachineBtn:inline|@click=reload":
    ["read", "re-reads the macro file (conflict note)"],
  "MacrosPanel.vue|MachineBtn:retry|@click=reloadMacroFiles":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "MacrosPanel.vue|MachineInput:macroEdit|v-model=descModel":
    ["draft", "a field of the macro editor's draft; Save is sourceWrite"],
  "MacrosPanel.vue|MachineInput:macroEdit|v-model=nameModel":
    ["draft", "a field of the macro editor's draft; Save is sourceWrite"],
  "MacrosPanel.vue|MachineInput:macroEdit|v-model=titleModel":
    ["draft", "a field of the macro editor's draft; Save is sourceWrite"],
  "MacrosPanel.vue|MachineInput:macroSearch|v-model=searchText":
    ["local", "filters, searches or plays the display"],
  "MacrosPanel.vue|MachineSelect:macroSearch|v-model=barFilter":
    ["local", "filters, searches or plays the display"],
  "MacrosPanel.vue|button|@click=sortAsc = !sortAsc":
    ["local", "sorts the macro table"],
  "MacrosPanel.vue|tr|@click=selectedName = f.name":
    ["local", "selects a macro row (Run is probe + hold, editing sourceWrite)"],
  // ── MessagesDialog.vue ──
  "MessagesDialog.vue|MachineBtn:inline|@click=copyShown":
    ["local", "copies the shown messages to the clipboard"],
  "MessagesDialog.vue|MachineBtn:inline|@click=emit('clearAll')":
    ["local", "asks to clear this tab's message protocol"],
  "MessagesDialog.vue|MachineBtn:listAction|@click=emit('copy', messageLine(m, time(m.ts)))":
    ["local", "copies one message"],
  "MessagesDialog.vue|MachineBtn:listAction|@click=emit('dismiss', m.id)":
    ["local", "dismisses one message (this tab)"],
  "MessagesDialog.vue|MachineInput:search|v-model=search":
    ["local", "filters, searches or plays the display"],
  "MessagesDialog.vue|MachineSelect:filter|v-model=filter":
    ["local", "filters, searches or plays the display"],
  "MessagesDialog.vue|button|@click=toggleSort('source')":
    ["local", "sorts the message table"],
  "MessagesDialog.vue|button|@click=toggleSort('time')":
    ["local", "sorts the message table"],
  "MessagesDialog.vue|button|@click=toggleSort('type')":
    ["local", "sorts the message table"],
  // ── MoreMenu.vue ──
  "MoreMenu.vue|MachineBtn:more|":
    ["nav", "opens the More menu; its items keep their own gates"],
  // ── NumberKeypadStrip.vue ──
  "NumberKeypadStrip.vue|MachineBtn:numClose|@click=hide @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numClr|@click=clear @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numDel|@click=del @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numDiscard|@click=cancel @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numEq|@click=evalExpr @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('.') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('0') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('1') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('2') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('3') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('4') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('5') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('6') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('7') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('8') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=append('9') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numKey|@click=confirm @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "the helper's confirm: carries its OWNER field's gate (canConfirm / the owner's gated enter — e.g. the MDI line's send is `ready`)"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append('(') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append(')') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append('*') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append('+') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append('-') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=append('/') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "NumberKeypadStrip.vue|MachineBtn:numOp|@click=negate @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  // ── OffsetPanel.vue ──
  "OffsetPanel.vue|td|@click=startEditCell(row.name as string, axis, Number(row[axis]), $event)":
    ["gatedInHandler", "opens the offset keypad only under `probe` (startEditCell re-checks); locked, the value is text"],
  "OffsetPanel.vue|tr|@click=pinned = row.name as string":
    ["local", "selects the row for Clear (Clear itself is probe + hold)"],
  // ── ProbePanel.vue ──
  "ProbePanel.vue|MachineBtn:abort|@click=emit('abort')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "ProbePanel.vue|MachineBtn:dialogCancel|@click=resetTarget = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ProbePanel.vue|MachineBtn:retry|@click=emit('getCompGrid')":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "ProbePanel.vue|MachineBtn:retry|@click=emit('getProbeResults')":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "ProbePanel.vue|MachineBtn:surfaceRefresh|@click=refreshSurface":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "ProbePanel.vue|MachineToggle:viewerSetting|@update:modelValue=emit('toggleSurfaceLayer', $event!)":
    ["display", "shows the surface map in the viewer: the free `viewer` section"],
  // ── SafetyStrip.vue ──
  "SafetyStrip.vue|MachineBtn:activeCodes|@click=emit('openActiveCodes')":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "SafetyStrip.vue|MachineBtn:arm|@click=emit('arm', !armed)":
    ["recovery", "Arm / Disarm: the authorization itself"],
  "SafetyStrip.vue|MachineBtn:estop|@click=isEstop ? emit('estopReset') : emit('estop')":
    ["recovery", "E-Stop (always) / E-Stop Reset (disabled unless canResetEstop: armed; the gateway also refuses it while a trip is unacknowledged — one recovery map for both is package D, BG-11)"],
  // ── ScrubBar.vue ──
  "ScrubBar.vue|MachineBtn:scrub|@click=togglePlay":
    ["local", "the program scrub: display only; simulation mode's entry needs the machine off and closes every machine gate (simMode.ts)"],
  "ScrubBar.vue|MachineSlider:scrubPos|@input=onScrubInput v-model=sPos":
    ["local", "the program scrub: display only; simulation mode's entry needs the machine off and closes every machine gate (simMode.ts)"],
  "ScrubBar.vue|MachineToggle:simToggle|v-model=simToggleModel":
    ["local", "the program scrub: display only; simulation mode's entry needs the machine off and closes every machine gate (simMode.ts)"],
  // ── SettingsPanel.vue ──
  "SettingsPanel.vue|MachineBtn:dialogCancel|@click=resetTarget = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "SettingsPanel.vue|MachineBtn:dialogDanger|@click=confirmReset":
    ["dynamicGate", "the reset's confirm under <Gate :gate=\"isProtectedSection(resetTarget) ? 'armed' : 'always'\">: a protected section needs arm, a display section none (Q2)"],
  "SettingsPanel.vue|MachineBtn:inline|@click=onPaletteModeChange('auto')":
    ["display", "the viewer palette back to automatic: the free `viewer` section"],
  "SettingsPanel.vue|MachineBtn:listAction|@click=resetMachineColor(part.id)":
    ["display", "a machine part's colour back to the default: the free `viewer` section"],
  "SettingsPanel.vue|MachineBtn:resetDisplay|@click=resetTarget = 'display'":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineBtn:resetDisplay|@click=resetTarget = 'viewer'":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineColor:cameraSetting|@update:modelValue=saveCamTracked v-model=camOverlayColor":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineColor:viewerSetting|@update:modelValue=onColorChange(row.role as UserRole, $event!)":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineColor:viewerSetting|@update:modelValue=onMachineColorChange(part.id, $event!)":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineInput:cameraSetting|@change=saveCamTracked v-model.number=camCircleRadius":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineInput:cameraSetting|@change=saveCamTracked v-model.number=camGridSpacing":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:displaySetting|@update:modelValue=setTheme('auto') v-model=themeMode":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:displaySetting|@update:modelValue=setTheme('dark') v-model=themeMode":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:displaySetting|@update:modelValue=setTheme('hc-dark') v-model=themeMode":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:displaySetting|@update:modelValue=setTheme('hc-light') v-model=themeMode":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:displaySetting|@update:modelValue=setTheme('light') v-model=themeMode":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=hud.scale = s.value; save()":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onPaletteModeChange('auto')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onPaletteModeChange('custom')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onPreviewModeChange('part')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onPreviewModeChange('programmed')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onProjectionChange('parallel')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onProjectionChange('perspective')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onTrackModeChange('none')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onTrackModeChange('tool')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineRadio:viewerSetting|@update:modelValue=onTrackModeChange('wcs')":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineSlider:cameraSetting|@update:modelValue=saveCamTracked v-model=camOverlayOpacity":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:cameraSetting|@update:modelValue=saveCamTracked v-model=camShowCircle":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:cameraSetting|@update:modelValue=saveCamTracked v-model=camShowCrosshair":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:cameraSetting|@update:modelValue=saveCamTracked v-model=camShowGrid":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:displaySetting|@update:modelValue=saveKeepAwake v-model=keepAwake":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:displaySetting|@update:modelValue=saveStartFullscreen v-model=startFullscreen":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:viewerSetting|@update:modelValue=hud[t.key] = $event!; save()":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:viewerSetting|@update:modelValue=onLayerChange(HUD_LAYER, $event!)":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:viewerSetting|@update:modelValue=onLayerChange(lf.key, $event!)":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:viewerSetting|@update:modelValue=onLayerOnTopChange(lf.key as OnTopLayer, $event!)":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  "SettingsPanel.vue|MachineToggle:viewerSetting|@update:modelValue=setMachineEdges(machineEdgesOn); save() v-model=machineEdgesOn":
    ["display", "a display setting (display / viewer / panels / camera): free (Q2)"],
  // ── SimPanel.vue ──
  "SimPanel.vue|MachineBtn:scrub|@click=simStep(KINDS[filter], -1)":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  "SimPanel.vue|MachineBtn:scrub|@click=simStep(KINDS[filter], 1)":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  "SimPanel.vue|MachineSelect:filter|v-model=filter":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  "SimPanel.vue|MachineSelect:simSpeed|v-model=speed":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  "SimPanel.vue|span|@keydown=onPickKey($event, r)":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  "SimPanel.vue|tr|@click=show(r, $event)":
    ["local", "the Sim tab: the simulation's playback, filter, speed and its list — display (simulation mode closes every machine gate)"],
  // ── SpindleStrip.vue ──
  "SpindleStrip.vue|MachineBtn:spindleStop|@click=emit('spindleStop')":
    ["stop", "a stop: open without arm (BG-08 / BG-18); the backend's state decides"],
  "SpindleStrip.vue|MachineInput:stripInput|@input=emit('update:rpmInput', +($event.target as HTMLInputElement).value)":
    ["local", "the RPM preselection for the next Fwd / Rev (BG-05); Fwd / Rev / ± are `ready`"],
  // ── TabNav.vue ──
  "TabNav.vue|MachineBtn:{variant === 'main' ? 'tabMain' : 'tabSub'}|@click=emit('update:modelValue', t.id)":
    ["nav", "tab navigation"],
  // ── TabPanel.vue ──
  "TabPanel.vue|MachineSelect:tabSelect|@update:model-value=onSelect":
    ["nav", "tab navigation"],
  // ── TextKeypadStrip.vue ──
  "TextKeypadStrip.vue|MachineBtn:numClose|@click=closeTextSessionByOperator('closed by the operator') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numKey|@click=insert(k) @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numKey|@click=target?.enter() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "the helper's confirm: carries its OWNER field's gate (canConfirm / the owner's gated enter — e.g. the MDI line's send is `ready`)"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=inputSession.shift = !inputSession.shift @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=insert(' ') @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=setPage(p) @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.backspace() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.clear?.() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.moveCursor?.(-1) @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.moveCursor?.(1) @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.redo?.() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.tab?.() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  "TextKeypadStrip.vue|MachineBtn:numOp|@click=target?.undo?.() @contextmenu.prevent= @pointerdown.prevent=":
    ["local", "an input-helper key: edits the owner field's draft only"],
  // ── ThreeViewer.vue ──
  "ThreeViewer.vue|MachineBtn:viewPreset|@click=resetBackplot":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ThreeViewer.vue|MachineBtn:viewPreset|@click=setView('reset')":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ThreeViewer.vue|MachineBtn:viewerQuickToggle|@click=emit('open-settings', 'viewer')":
    ["nav", "opens Settings → 3D Viewer"],
  "ThreeViewer.vue|MachineBtn:viewerQuickToggle|@click=togglePip":
    ["display", "shows / hides the camera picture-in-picture: the free `camera` section"],
  "ThreeViewer.vue|MachineBtn:windowToggle|@click=notesOpen = !notesOpen":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  // ── ToolStrip.vue ──
  "ToolStrip.vue|MachineBtn:nav|@click=emit('openToolTable')":
    ["nav", "opens the Tools tab"],
  "ToolStrip.vue|MachineBtn:retry|@click=fetchTools":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  // ── ToolTablePanel.vue ──
  "ToolTablePanel.vue|MachineBtn:close|@click=downloadError = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:close|@click=importError = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:close|@click=importResult = null":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogCancel|@click=cancelDelete":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogCancel|@click=cancelImport":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogCancel|@click=closeEditModal":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogCancel|@click=replaceConfirm = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogCancel|@click=showEditDiscard = false":
    ["nav", "closes, cancels, navigates or switches a view — no effect beyond the screen"],
  "ToolTablePanel.vue|MachineBtn:dialogDanger|@click=confirmEditDiscard":
    ["draft", "discards the tool editor's draft"],
  "ToolTablePanel.vue|MachineBtn:fileBrowse|@click=previewImportFile(importFile)":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "ToolTablePanel.vue|MachineBtn:retry|@click=fetchTools":
    ["read", "reads: a download, a retry of a read, a library preview or opening the file browser (BG-02, BG-14)"],
  "ToolTablePanel.vue|MachineInput:toolSearch|v-model=searchText":
    ["local", "filters, searches or plays the display"],
  "ToolTablePanel.vue|MachineSelect:toolSearch|v-model=filterType":
    ["local", "filters, searches or plays the display"],
  "ToolTablePanel.vue|button|@click=toggleSort('D')":
    ["local", "sorts the tool table"],
  "ToolTablePanel.vue|button|@click=toggleSort('T')":
    ["local", "sorts the tool table"],
  "ToolTablePanel.vue|button|@click=toggleSort('Z')":
    ["local", "sorts the tool table"],
  "ToolTablePanel.vue|input|@change=onImportFileSelect":
    ["openerGated", "the hidden tool-library picker: opened by Upload (fileBrowse) — a preview, a read; applying is toolTableWrite"],
  "ToolTablePanel.vue|tr|@click=onToolTap(tool, $event)":
    ["local", "a tool row's hover preview on touch"],
  // ── ViewCube.vue ──
  "ViewCube.vue|canvas|@click=onClick @pointerleave=onPointerLeave @pointermove=onPointerMove":
    ["nav", "the orientation cube: the viewer's camera"],
};

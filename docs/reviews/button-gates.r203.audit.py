#!/usr/bin/env python3
"""R203 source audit; run against an archive, not the live application.

python3 button-gates.r203.audit.py --root ARCHIVE --upstream R202_UPSTREAM
No gateway import, build, browser, network, controller or product mutation.
The proposed gates are not implemented: this is source evidence, not their
runtime acceptance. Upstream hashes are pinned by R202's sources manifest.
"""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--root', required=True, type=Path)
p.add_argument('--upstream', required=True, type=Path)
a = p.parse_args()
manifest = {}

def read(base, name):
    data = (base / name).read_bytes()
    manifest[name] = hashlib.sha256(data).hexdigest()
    return data.decode()

def line(text, needle):
    return text[:text.index(needle)].count('\n') + 1

def between(text, start, end):
    pos = text.index(start)
    return text[pos:text.index(end, pos + len(start))]

gw = read(a.root, 'lcnc-gateway/gateway.py')
policy = read(a.root, 'lcnc-gateway/command_policy.py')
transport = read(a.root, 'lcnc-webui/src/ws/wsTransport.ts')
defaults = read(a.root, 'lcnc-webui/src/defaults.ts')
mdi = read(a.root, 'lcnc-webui/src/useMdiHistory.ts')
keyboard = read(a.root, 'lcnc-webui/src/useKeyboardShortcuts.ts')
app = read(a.root, 'lcnc-webui/src/App.vue')
ledger = read(a.root, 'lcnc-webui/src/settingsSaveStatus.ts')
settings = read(a.root, 'lcnc-gateway/settings_store.py')
task = read(a.upstream, 'emctaskmain.cc')
motion = read(a.upstream, 'motion-command.c')
assert manifest['emctaskmain.cc'] == '1c0fad637343e7a86c8f0c1b6b8b38c61b12d10c67da365883d09a8f19dc468e'
assert manifest['motion-command.c'] == '5169c0fd2e7ea59cda233cf42e83facd56b578e95ec0771be49711f42ff6c15a'

coord = between(motion, 'case EMCMOT_COORD:', 'case EMCMOT_TELEOP:')
assert 'kinType != KINEMATICS_IDENTITY' in coord
assert '!get_allhomed()' in coord

# Each range is one native task-state admission switch, not the interpreter's
# queued execution of an M5. Line numbers refer to upstream v2.9.4.
ranges = [
    ('OFF/ESTOP/ESTOP_RESET', 'case EMC_TASK_STATE_OFF:', 'case EMC_TASK_STATE_ON:', False),
    ('ON/MANUAL', 'case EMC_TASK_MODE_MANUAL:\t// ON, MANUAL', 'case EMC_TASK_MODE_AUTO:\t// ON, AUTO', True),
    ('ON/AUTO/IDLE', 'case EMC_TASK_INTERP_IDLE:\t// ON, AUTO, IDLE', 'case EMC_TASK_INTERP_READING:\t// ON, AUTO, READING', True),
    ('ON/AUTO/READING', 'case EMC_TASK_INTERP_READING:\t// ON, AUTO, READING', 'case EMC_TASK_INTERP_PAUSED:', False),
    ('ON/AUTO/PAUSED', 'case EMC_TASK_INTERP_PAUSED:', 'case EMC_TASK_INTERP_WAITING:', True),
    ('ON/AUTO/WAITING', 'case EMC_TASK_INTERP_WAITING:', 'case EMC_TASK_MODE_MDI:\t// ON, MDI', False),
    ('ON/MDI', 'case EMC_TASK_MODE_MDI:\t// ON, MDI', '// switch (type) in ON, MDI', True),
]
native = []
for state, start, end, expected in ranges:
    part = between(task, start, end)
    present = 'case EMC_SPINDLE_OFF_TYPE:' in part
    assert present == expected, state
    native.append({'state': state, 'from_line': line(task, start),
                   'to_line_exclusive': line(task, end),
                   'direct_spindle_off_in_admission_list': present})

hello = between(gw, '_sid = msg.get("session")', 'want_resume = bool')
assert '_clients[client_id].session_id = _sid' in hello
assert 'sessionStorage.getItem(SESSION_STORAGE_KEY)' in transport
assert '_BASE = (_R_ARMED, _R_NOT_ESTOP, _R_ENABLED)' in policy
assert '"setup":    (_R_ARMED, _R_NOT_ESTOP, _R_IDLE)' in policy
send = between(mdi, 'function handleMdiSend()', 'function clearMdiHistory()')
assert send.index('persistMdiHistory()') < send.index('opts.fire(')
save = between(defaults, 'export function saveSection(', '// ─── Viewer section')
assert save.index('_cache = all') < save.index('setTimeout(')
assert '}, 300)' in save
config = between(keyboard, 'function setKeyboardConfig(', '/** Clear the active-jog-action set')
assert config.index('keyboardConfig.value = normalized') < config.index('saveKeyboardDefaults(normalized)')
reply = between(ledger, 'export function noteSaveReply(', '/** The latest revision left through sendBeacon')
assert 's.failedRev' in reply and 'keyboardConfig' not in reply

result = {
    'round': 'R203', 'commit': 'd82d5e2ecd8ee6599d70f5bd3909e6737678f345',
    'method': 'Static assertions in archived sources; no live or new-gate runtime test',
    'upstream': 'LinuxCNC v2.9.4; hashes match R202; Debian downstream patches not compared',
    'coord': {'source': 'motion-command.c', 'line': line(motion, 'case EMCMOT_COORD:'),
              'unhomed_requires_reported_kinType': 'KINEMATICS_IDENTITY',
              'switchkins_runtime_frame_is_not_the_test': True},
    'native_spindle_off': native,
    'binding_evidence': {
        'client_supplied_session_assignment_line': line(gw, '_clients[client_id].session_id = _sid'),
        'sessionStorage_reuse_line': line(transport, 'const existing = sessionStorage.getItem'),
        'design_counterexample_not_runtime_probe': {
            'clients': [{'connection': 'A', 'session': 'same-id', 'armed': True},
                        {'connection': 'B', 'session': 'same-id', 'armed': False}],
            'http_header': {'X-Client-Session': 'same-id'},
            'conclusion': 'The header alone cannot identify which connected client sent the write.'}},
    'spindle_and_writer_gates': {
        'base_line': line(policy, '_BASE ='),
        'setup_line': line(policy, '"setup":    ('),
        'spindle_stop_handler_line': line(gw, 'if cmd == "spindle_stop":'),
        'base_still_requires_arm': True, 'setup_still_excludes_estop': True,
        'macro_source_guard_line': line(gw, 'def _source_write_refusal()')},
    'settings': {
        'mdi_send_line': line(mdi, 'function handleMdiSend()'),
        'save_line': line(defaults, 'export function saveSection('),
        'persistence_debounce_ms': 300,
        'keyboard_applied_before_save_line': line(keyboard, 'keyboardConfig.value = normalized'),
        'gamepad_applied_before_save_line': line(app, 'gamepadConfig.value = cfg'),
        'ledger_reply_line': line(ledger, 'export function noteSaveReply('),
        'reset_route_line': line(gw, '@app.delete("/settings"'),
        'design_counterexample_not_runtime_probe':
            'An armed idle client sends MDI; the 300-ms delayed history save reaches an idle-only gate while MDI is still running.'},
    'sha256': manifest,
}
print(json.dumps(result, indent=2, ensure_ascii=False))

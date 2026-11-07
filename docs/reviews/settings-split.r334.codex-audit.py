#!/usr/bin/env python3
"""Read-only source evidence for the R334 PLAN review; not a runtime test.

python3 docs/reviews/settings-split.r334.codex-audit.py --repo . > /tmp/r334.json
Reads the pinned git objects. Never imports the gateway or contacts a service.
"""
import argparse
import hashlib
import json
import subprocess

ap = argparse.ArgumentParser()
ap.add_argument('--repo', default='.')
ap.add_argument('--rev', default='0dba29f6')
args = ap.parse_args()

def git(*argv):
    return subprocess.check_output(['git', '-C', args.repo, *argv])

rev = git('rev-parse', args.rev).decode().strip()
cache = {}

def excerpt(path, needle, before=0, after=12):
    if path not in cache:
        cache[path] = git('show', f'{rev}:{path}')
    lines = cache[path].decode().splitlines()
    matches = [i for i, line in enumerate(lines) if needle in line]
    if len(matches) != 1:
        raise ValueError(f'{path}: expected one {needle!r}, found {len(matches)}')
    i = matches[0]
    a, b = max(0, i-before), min(len(lines), i+after+1)
    return {'path': path, 'line': i+1, 'excerpt_start': a+1,
            'source_sha256': hashlib.sha256(cache[path]).hexdigest(),
            'text': '\n'.join(lines[a:b])}

specs = [
    ('shared_store', 'lcnc-gateway/settings_store.py', 'def save_section(', 0, 18),
    ('whole_ini_reset', 'lcnc-gateway/settings_store.py', 'def reset(', 0, 14),
    ('settings_admission', 'lcnc-gateway/gateway.py', 'def _settings_admission(', 0, 12),
    ('rest_initial_settings', 'lcnc-gateway/gateway.py', 'async def get_settings():', 1, 4),
    ('pre_hello_settings', 'lcnc-gateway/gateway.py', '# Send initial settings snapshot (part of WS handshake)', 0, 9),
    ('global_broadcast', 'lcnc-gateway/gateway.py', '# Settings broadcast: send full settings when version changes', 0, 19),
    ('client_bootstrap', 'lcnc-webui/src/main.ts', 'async function bootstrap()', 0, 16),
    ('replace_cache', 'lcnc-webui/src/defaults.ts', 'export function updateServerCache(', 0, 18),
    ('pending_save', 'lcnc-webui/src/defaults.ts', 'export function saveSection(', 0, 30),
    ('actual_dev_transport', 'lcnc-webui/src/ws/wsTransport.ts', 'export function buildWsUrl()', 15, 7),
    ('dev_proxy_fallback', 'lcnc-webui/vite.config.ts', "'/ws': {", 8, 4),
    ('mdi_features', 'lcnc-webui/src/App.vue', 'async function fireWithVars(', 6, 15),
    ('toolsetter_mdi', 'lcnc-webui/src/App.vue', 'async function toolsetterMdi(', 2, 5),
    ('gamepad_plain_commands', 'lcnc-webui/src/useGamepad.ts', 'function dispatchAction(', 0, 30),
    ('gamepad_stops', 'lcnc-webui/src/useGamepad.ts', 'function stopAllJog()', 0, 11),
    ('comp_off_exception', 'lcnc-gateway/command_policy.py', '# May the operator START surface-map work', 0, 9),
    ('camera_subscription', 'lcnc-gateway/gateway.py', 'async def camera_stream():', 1, 14),
    ('macros_are_files', 'lcnc-webui/src/useMacros.ts', '// A macro is a FILE', 0, 9),
    ('bar_sync', 'lcnc-webui/src/useMacros.ts', 'const macroBarNames =', 3, 13),
    ('collision_cancel_is_not_shutdown', 'lcnc-webui/src/ThreeViewer.vue', 'function cancelCollisionCheck()', 0, 24),
    ('collision_auto', 'lcnc-webui/src/ThreeViewer.vue', 'function _colScheduleAuto()', 0, 24),
    ('collision_run', 'lcnc-webui/src/ThreeViewer.vue', 'function _startRunCheck()', 0, 8),
    ('collision_side', 'lcnc-webui/src/ThreeViewer.vue', 'function _colPostSide(', 0, 19),
    ('limit_marks_owner', 'lcnc-webui/src/ScrubBar.vue', 'let _marksSet:', 9, 3),
    ('tool_marks_owner', 'lcnc-webui/src/ScrubBar.vue', 'let _toolMarksSet:', 2, 7),
    ('program_marks_consumer', 'lcnc-webui/src/GcodePanel.vue', 'const violationsByLine =', 3, 3),
    ('existing_press_contract', 'lcnc-webui/src/App.vue', 'const stripLayout = heldThroughPress(', 5, 8),
]
facts = {key: excerpt(path, needle, before, after) for key, path, needle, before, after in specs}
out = {
    'round': 'R334', 'kind': 'plan review / pinned source inspection', 'revision': rev,
    'product_diff_since_53a79824': git('diff', '--name-only', '53a79824', rev,
                                   '--', ':!docs/reviews/**').decode().splitlines(),
    'live_services_contacted': False, 'product_tests_run': False,
    'source_facts': facts,
    'primary_web_references': [
        {'url': 'https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage',
         'checked': '2026-11-07', 'supports': 'Origin scope; private-session lifetime; storage may be denied.'},
        {'url': 'https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues',
         'checked': '2026-11-07', 'supports': 'Available in an insecure context.'},
    ],
    'counterexamples_are_design_cases_not_executed_tests': [
        'A public profile id copied into hello makes a foreign edit appear to be an own edit unless ownership is separately bound.',
        'An old whole-section save from a second tab overwrites a remotely disabled simulation without a revision conflict.',
        'A loaded simulation-off profile arriving after viewer mount cannot undo CPU already spent on the initial check.',
        'Generic mdi and jog_cont carry no unique feature identity; gating the shared permission class disables unrelated functions.',
        'Hiding the surface panel while compensation is on hides its off control; suppressing a gamepad before its stop can strand a jog.',
        'Unmounting ScrubBar clears both the tool-change and limit marks read by GcodePanel, besides removing the timeline.',
        'A browser on the machine using its LAN address is not a loopback peer; the current dev WS is direct, not proxied.',
    ],
}
print(json.dumps(out, ensure_ascii=False, indent=2))

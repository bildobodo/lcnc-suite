"""R22: read-only source checks and small counterexample models.

No server, browser, LinuxCNC connection, command channel, or machine writes.
The geometry example is a calculation using R21's measured monospace font,
not a rendering of the proposed ChoiceGroup (which does not exist yet).
"""
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
offset = (ROOT / 'lcnc-webui/src/OffsetPanel.vue').read_text()
app = (ROOT / 'lcnc-webui/src/App.vue').read_text()
axes_source = (ROOT / 'lcnc-webui/src/useAxes.ts').read_text()
checks = {
    'g92_uses_display_index': 'fmtOffset(g92Offset?.[i])' in offset,
    'tool_uses_display_index': 'fmtOffset(toolOffset?.[i])' in offset,
    'enable_is_boolean_coerced': ':eoffsetEnabled="!!st.eoffset_enabled"' in app,
    'axes_contract_says_canonical': 'CANONICAL 9-wide' in axes_source,
}
assert all(checks.values()), checks
vector = [0, 0, 0, 11, 22, 33, 44, 55, 66]
canonical = 'XYZABCUVW'
examples = []
for axes in ['XYZAC', 'XYZBC', 'XZ']:
    vec = vector if axes != 'XZ' else [0, 7, 9, 0, 0, 0, 0, 0, 0]
    examples.append({
        'axes': axes, 'canonical_vector': vec,
        'current_display_index': {letter: vec[i] for i, letter in enumerate(axes)},
        'correct_by_letter': {letter: vec[canonical.index(letter)] for letter in axes},
    })
labels = ['Cont', '0.000001', '0.000002', '0.000003', '0.000004', '0.000005']
out = {
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'scope': 'Source assertions and counterexample models only; no runtime/UI implementation test.',
    'source_checks': checks,
    'offset_examples': examples,
    'nullable_enable': [
        {'backend': None, 'current_component_prop': False},
        {'backend': False, 'current_component_prop': False},
    ],
    'six_options_model': {
        'labels': labels, 'selection_by_fassung2_rule': 'connected row',
        'assumed_glyph_px_from_r21_monospace_measurement': 7,
        'padding_each_side_px': 8, 'minimum_target_width_px': 36,
        'sum_width_px': sum(max(36, len(t) * 7 + 16) for t in labels),
        'r21_jog_selection_width_touch_px': 211,
        'limitation': 'Illustrates count != width; not a measurement of a new component or entire strip.',
    },
    'stale_file_conflict_model': {
        'based_on': 10, 'old_file': 10, 'interpreter_after_foreign_change': 20,
        'requested': 30, 'first_synch_file_write': 'fails; old file remains readable',
        'compare_using_old_file': 'passes incorrectly',
        'consequence_without_freshness_evidence': 'foreign interpreter change may be overwritten',
        'limitation': 'Failure scenario for the planned contract, not a live reproduction.',
    },
    'wrapped_rotary_example': {
        'commanded_angle': 725, 'g30_1_parameter_if_wrapped': 725 % 360,
        'source': 'LinuxCNC v2.9.4 interp_convert.cc convert_savehome',
    },
}
(HERE / 'operator-punkte.r22.static-probe.json').write_text(json.dumps(out, indent=2) + '\n')
print(json.dumps(out, indent=2))

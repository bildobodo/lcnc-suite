"""R121: replay R120 with fixed expectations and isolated PATH resolution.
File/validator operations only. No Gateway, HAL loader, script execution or NML.
"""
import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path
import fake_linuxcnc
fake_linuxcnc.install()

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root/'scripts'))
from install_examples import render_ini
spec = importlib.util.spec_from_file_location('r121_readback', root/'scripts/toolsetter_readback_check.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
source = root/'examples/sim_config'
SUITE = {'hal_watchdog.py': 'lcnc-gateway/hal_watchdog.py',
         'hal_reader.py': 'lcnc-gateway/hal_reader.py',
         'compensation.py': 'subroutines/surfacemap/compensation.py'}
def suite_which(name):
    return str(root/SUITE[name]) if name in SUITE else shutil.which(name)

rows = []
def check(label, ini, running, expected):
    try:
        m.validate_sim_target(str(ini), str(running) if running else None, which=suite_which)
        accepted, reason = True, None
    except ValueError as e:
        accepted, reason = False, str(e)
    row = {'case': label, 'accepted': accepted, 'reason': reason}
    rows.append(row)
    assert accepted is expected, row

with tempfile.TemporaryDirectory(prefix='r121-targets-') as td:
    p = Path(td)
    shutil.copytree(source/'hallib', p/'hallib')
    shutil.copytree(source/'sim_toolsetter', p/'sim_toolsetter')
    names = [r['ini'] for r in json.loads((source/'profiles.json').read_text())['profiles']]
    for name in names:
        template = (source/name).read_text()
        ini = p/name
        ini.write_text(render_ini(template, template, root))
        check('installed_' + name, ini, ini, True)
    ini = p/names[1]
    baseline = ini.read_text()
    check('other_active_ini', ini, p/names[0], False)
    unknown = p/'production.ini'
    unknown.write_text(baseline)
    check('non_profile_name', unknown, unknown, False)
    ini.write_text(baseline.replace('HALFILE = hallib/core_sim_5.hal', 'HALFILE = physical-drives.hal'))
    check('different_halfile_name', ini, ini, False)
    ini.write_text(baseline)
    core = p/'hallib/core_sim_5.hal'
    ctext = core.read_text()
    core.write_text(ctext + '\nsource hallib/physical-drives.hal\n')
    (p/'hallib/physical-drives.hal').write_text('loadrt hm2_pci\n')
    check('changed_hal_body_same_filename', ini, ini, False)
    core.write_text(ctext)
    ini.write_text(baseline.replace('[HAL]\n', '[HAL]\nHALCMD = source physical-drives.hal\n'))
    check('extra_halcmd', ini, ini, False)
    ini.write_text(baseline)
    sourced = p/'hallib/sim_toolsetter.hal'
    stext = sourced.read_text()
    sourced.write_text(stext + '\nloadrt hm2_pci\n')
    check('changed_sourced_hal', ini, ini, False)
    sourced.unlink()
    check('missing_sourced_hal', ini, ini, False)
    sourced.write_text(stext)

    feeder = p/'sim_toolsetter/sim_toolsetter_feed.py'
    original = feeder.read_text()
    assert 'return length, True, "armed"' in original
    feeder.write_text(original.replace('return length, True, "armed"', 'return length + 100.0, True, "armed"'))
    check('changed_loadusr_python_script', ini, ini, False)
    feeder.unlink()
    check('missing_loadusr_python_script', ini, ini, False)

    line = next(ln for ln in stext.splitlines() if ln.startswith('loadusr '))
    reached = list(m._runs(line))
    assert reached == [('path', 'python3'), ('file', 'sim_toolsetter/sim_toolsetter_feed.py')], reached
    out = {'offline_only': True, 'loadusr_line': line, 'files_found_by_runs': reached,
           'cases': rows}
Path(sys.argv[1]).write_text(json.dumps(out, indent=2) + '\n')
print('PASS: installed profiles accepted and all R119/HAL-recursion controls refused.')
print('PASS: changed and missing loadusr Python script refused; scanner returns interpreter and file.')

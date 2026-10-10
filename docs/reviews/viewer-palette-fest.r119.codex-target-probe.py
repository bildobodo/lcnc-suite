"""Offline target-validation counterexamples: files only, no HAL is loaded.
Import with fake_linuxcnc, never create Gateway, never call main.
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
spec = importlib.util.spec_from_file_location('r119_readback', root / 'scripts/toolsetter_readback_check.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
source = root / 'examples/sim_config'
rows = []
def check(label, ini, running, detail=''):
    try:
        m.validate_sim_target(str(ini), str(running) if running else None)
        result = 'accepted'
    except ValueError as e:
        result = 'refused: ' + str(e)
    rows.append({'case': label, 'result': result, 'detail': detail})
    return result

with tempfile.TemporaryDirectory(prefix='r119-targets-') as td:
    p = Path(td)
    shutil.copytree(source / 'hallib', p / 'hallib')
    names = [x['ini'] for x in json.loads((source / 'profiles.json').read_text())['profiles']]
    for name in names:
        ini = p / name
        shutil.copyfile(source / name, ini)
        assert check('shipped_' + name, ini, ini) == 'accepted'
    ini = p / names[1]
    baseline = ini.read_text()
    assert check('other_active_ini', ini, p / names[0]).startswith('refused:')
    unknown = p / 'production.ini'
    unknown.write_text(baseline)
    assert check('non_profile_name', unknown, unknown).startswith('refused:')
    ini.write_text(baseline.replace('HALFILE = hallib/core_sim_5.hal', 'HALFILE = physical-drives.hal'))
    assert check('different_halfile_name', ini, ini).startswith('refused:')

    ini.write_text(baseline)
    # Same relative name, different local body. No HAL loader is called.
    core = p / 'hallib/core_sim_5.hal'
    original = core.read_text()
    core.write_text(original + '\n# Locally adapted machine wiring\nsource hallib/physical-drives.hal\n')
    (p / 'hallib/physical-drives.hal').write_text('# Offline specimen only\nloadrt hm2_pci\n')
    assert check('changed_hal_body_same_filename', ini, ini,
                 'hallib/core_sim_5.hal adds source hallib/physical-drives.hal; body is not compared') == 'accepted'
    core.write_text(original)

    ini.write_text(baseline.replace('[HAL]\n', '[HAL]\nHALCMD = source physical-drives.hal\n'))
    (p / 'physical-drives.hal').write_text('# Offline specimen only\nloadrt hm2_pci\n')
    assert check('extra_halcmd', ini, ini,
                 'additional HALCMD = source physical-drives.hal; command list is not compared') == 'accepted'

Path(sys.argv[1]).write_text(json.dumps({'offline_only': True, 'cases': rows}, indent=2) + '\n')
print('PASS controls: 3 shipped profiles accepted; 3 old counterexamples refused.')
print('REPRODUCED VP-I73 rest: changed HAL contents and extra HALCMD are both accepted.')

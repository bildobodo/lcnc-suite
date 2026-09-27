"""R15: real installer, isolated temporary repositories/installations only.

Run: python3 docs/reviews/xyzac-z0-m600.r15.migration-probe.py
No connection to LinuxCNC. The stop guard is bypassed ONLY for the isolated
temporary destination; Path.home is redirected so no user libraries are touched.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('review_installer', ROOT / 'scripts/install_examples.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
old_ini = (ROOT / 'scripts/test_fixtures/xyzac_before_datum_shift.ini').read_text()
old_file = lambda rel: subprocess.check_output(['git','show',f'3e501ed:examples/sim_config/{rel}'],cwd=ROOT,text=True)
old_var, old_position, old_demo = [old_file('xyzac5/'+f) for f in ('sim.var','position.txt','demo.ngc')]
NAME = 'lcnc_suite_sim_5axis_xyzac.ini'
result = {'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
          'scope':'Real installer in temporary directories, no live controller access', 'cases':[]}

def set_ini(text, section, key, value):
    current=''
    out=[]
    for line in text.splitlines():
        s=line.strip()
        if s.startswith('[') and s.endswith(']'): current=s[1:-1]
        if current==section and '=' in s and s.split('=',1)[0].strip()==key:
            line=f'{key} = {value}'
        out.append(line)
    return '\n'.join(out)+'\n'

def params(text):
    return {int(s[0]):float(s[1]) for s in (line.split() for line in text.splitlines()) if len(s)>=2}

def snapshot(dest, settings_file):
    ini=installer.values((dest/NAME).read_text())
    var=params((dest/'xyzac5/sim.var').read_text())
    z=float((dest/'xyzac5/position.txt').read_text().split()[2])
    demo=(dest/'xyzac5/demo.ngc').read_text()
    saved=json.loads(settings_file.read_text()).get(str(dest/NAME),{}).get('toolsetter')
    return {'joint_z':{k:ini['JOINT_2',k] for k in ('MIN_LIMIT','MAX_LIMIT','HOME','HOME_OFFSET')},
            'machine_name':ini['EMC','MACHINE'],
            'rotation_point_lines':[s for s in (dest/NAME).read_text().splitlines() if 'setp xyzac-trt-kins.z-rot-point ' in s],
            'frame_translation':json.loads((dest/'machine-5axis-xyzac/machine.json').read_text())['groups'][0],
            'g54_z':var[5223], 'g30_z':var[5183], 'setter_xyz':[var[n] for n in (3100,3101,3102)],
            'disable_preposition':var[3108],
            'g30_z_in_limits':float(ini['JOINT_2','MIN_LIMIT'])<=var[5183]<=float(ini['JOINT_2','MAX_LIMIT']),
            'saved_position_z':z, 'position_in_limits':float(ini['JOINT_2','MIN_LIMIT'])<=z<=float(ini['JOINT_2','MAX_LIMIT']),
            'demo_retracts':[s for s in demo.splitlines() if 'G53 G0 Z' in s],
            'persisted_toolsetter':saved}

for case in ('normal_old', 'missing_var', 'missing_position', 'missing_both',
             'custom_z_max', 'custom_z_min', 'renamed_machine', 'saved_toolsetter'):
    with tempfile.TemporaryDirectory(prefix='codex-r15-') as tmp:
        base=Path(tmp)
        repo=base/'repo'
        (repo/'examples').mkdir(parents=True)
        (repo/'examples/sim_config').symlink_to(ROOT/'examples/sim_config',target_is_directory=True)
        (repo/'lcnc-gateway').mkdir()
        settings_file=repo/'lcnc-gateway/settings.json'
        dest=base/'configs/examples'; backups=base/'backups'
        settings_file.write_text('{}\n')
        def isolated_guard():
            assert dest.is_relative_to(base) and base.parent==Path('/tmp')
        with patch.object(installer.Path,'home',return_value=base/'home'), patch.object(installer,'assert_stopped',isolated_guard):
            installer.install(repo,dest,backups)
            text=old_ini
            if case=='custom_z_max':
                for section in ('JOINT_2','AXIS_Z'): text=set_ini(text,section,'MAX_LIMIT','480')
                for key in ('HOME','HOME_OFFSET'): text=set_ini(text,'JOINT_2',key,'480')
                text=set_ini(text,'TRAJ','HOME','0 0 480 0 0')
            if case=='custom_z_min':
                for section in ('JOINT_2','AXIS_Z'): text=set_ini(text,section,'MIN_LIMIT','150')
            if case=='renamed_machine': text=set_ini(text,'EMC','MACHINE','Operator XYZAC')
            (dest/NAME).write_text(text)
            (dest/'xyzac5/sim.var').write_text(old_var)
            (dest/'xyzac5/position.txt').write_text(old_position)
            if case=='custom_z_max':
                pos=old_position.splitlines();pos[2]='480'
                (dest/'xyzac5/position.txt').write_text('\n'.join(pos)+'\n')
            (dest/'xyzac5/demo.ngc').write_text(old_demo)
            if case in ('missing_var','missing_both'): (dest/'xyzac5/sim.var').unlink()
            if case in ('missing_position','missing_both'): (dest/'xyzac5/position.txt').unlink()
            if case=='saved_toolsetter':
                p=params(old_var);p.update({3100:150,3101:0,3102:300})
                (dest/'xyzac5/sim.var').write_text(''.join(f'{n}\t{v:.6f}\n' for n,v in sorted(p.items())))
                full_settings={'fastFeed':500,'slowFeed':50,'traverseFeed':6000,'maxZTravel':150,
                               'retractDist':2,'spindleZeroHeight':180,'offsetDirection':0,
                               'touchX':150,'touchY':0,'touchZ':300,'useToolTable':1,'toolMinDis':2,
                               'brakeAfter':0,'goBackToStart':0,'spindleStopM':5,'disablePrePos':0,
                               'addReps':0,'lastTry':0,'offsetDiameter':0,'offsetValue':0,
                               'finderTouchX':0,'finderTouchY':0,'finderDiffZ':0}
                settings_file.write_text(json.dumps({str(dest/NAME):{'toolsetter':full_settings}})+'\n')
            migration_detected=installer.xyzac_before_datum_move(text)
            backup=installer.install(repo,dest,backups)
            first=snapshot(dest,settings_file)
            second_backup=installer.install(repo,dest,backups)
            second=snapshot(dest,settings_file)
            result['cases'].append({'case':case,'migration_detected':migration_detected,'backup_created':backup is not None,
                                    'first':first,'second_install_changed':second_backup is not None,'second':second})

Path(__file__).with_suffix('.json').write_text(json.dumps(result,indent=2)+'\n')
for c in result['cases']:
    f=c['first']
    print(json.dumps({'case':c['case'],'detected':c['migration_detected'],'joint_z':f['joint_z'],
                      'position_z':f['saved_position_z'],'position_in_limits':f['position_in_limits'],
                      'g54_z':f['g54_z'],'setter_xyz':f['setter_xyz'],'settings':f['persisted_toolsetter'],
                      'second_install_changed':c['second_install_changed']}))

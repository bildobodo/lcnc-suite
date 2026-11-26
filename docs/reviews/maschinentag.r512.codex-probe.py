#!/usr/bin/env python3
"""R512: isolated file experiments, source arithmetic, native report recheck.

No product imports or execution, no LinuxCNC/WS connection. The L20 and
rotation models are source-derived, not claims about a new native run.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import time


def path_mtime_case(root):
    base_time = time.time()
    backup = root / 'pre-python.ini'
    active = root / 'machine.ini'
    backup.write_text('[EMC]\nMACHINE = example\n')
    os.utime(backup, (base_time - 120, base_time - 120))
    active.write_text('[EMC]\nMACHINE = example\n[PYTHON]\nTOPLEVEL = local.py\n')
    os.utime(active, (base_time - 60, base_time - 60))
    controller_started = base_time - 30
    loaded_path = 'PYTHON'  # model of the already configured interpreter
    before_hash = hashlib.sha256(active.read_bytes()).hexdigest()
    shutil.copy2(backup, active)  # normal restore preserving old mtime
    after_hash = hashlib.sha256(active.read_bytes()).hexdigest()
    ini_newer = active.stat().st_mtime > controller_started
    proposed_path = 'UNKNOWN' if ini_newer else ('PYTHON' if '[PYTHON]' in active.read_text() else 'DETECTOR')
    assert before_hash != after_hash and not ini_newer and proposed_path != loaded_path
    return {'controller_path_model': loaded_path, 'path_by_v5_mtime_rule': proposed_path,
            'restored_contents_changed': True, 'restored_mtime_newer_than_start': ini_newer,
            'operation': 'shutil.copy2 of a pre-existing backup', 'native_run': False}


def shared_toplevel_case(root):
    suite_file = root / 'suite/examples/sim_config/python/read_toplevel.py'
    suite_file.parent.mkdir(parents=True)
    suite_file.write_text('# empty suite module\n')
    ini3, ini5 = root / 'three.ini', root / 'five.ini'
    for ini in (ini3, ini5):
        ini.write_text('[PYTHON]\nTOPLEVEL = ' + str(suite_file) + '\n')
    recorded_hash = hashlib.sha256(suite_file.read_bytes()).hexdigest()
    assert recorded_hash == hashlib.sha256(suite_file.read_bytes()).hexdigest()
    # Literal proposed opt-out: removes the recorded, unchanged file.
    ini3.write_text('')
    suite_file.unlink()
    remaining_ref = ini5.read_text().split('TOPLEVEL = ', 1)[1].strip()
    assert not Path(remaining_ref).exists()
    return {'other_profile_reference_kept': True, 'other_profile_toplevel_exists': False,
            'recorded_hash_matched': True, 'real_install_touched': False}


def l20_cases():
    machine = (10.0, 20.0, 50.0)
    origin = (0.0, 0.0, 0.0)
    tlo = (0.0, 0.0, 50.0)
    g92 = (0.0, 0.0, 0.0)
    before = tuple(m-o-t-g for m,o,t,g in zip(machine,origin,tlo,g92))
    cases = []
    # R=0 and G92 stored=applied: isolate loading untargeted row fields.
    for name,stored,requested in [('Z_only_loads_X',(5.0,0.0,0.0),{2:0.0}),
                                  ('X_only_loads_Z',(0.0,0.0,5.0),{0:0.0})]:
        current_in_stored = tuple(m-t-o-g for m,t,o,g in zip(machine,tlo,stored,g92))
        new_origin = tuple(current_in_stored[n] + stored[n] - requested[n]
                           if n in requested else stored[n] for n in range(3))
        after = tuple(m-o-t-g for m,o,t,g in zip(machine,new_origin,tlo,g92))
        changed_untouched = [n for n in range(3) if n not in requested and before[n] != after[n]]
        assert changed_untouched
        cases.append({'case':name, 'applied_origin_and_status_before':origin,
                      'stored_origin':stored, 'requested_axes':' '.join('XYZ'[n] for n in requested),
                      'g92_premise':True, 'rotation_premise':True,
                      'applied_status_equal_before':True, 'new_applied_and_status_origin':new_origin,
                      'work_before':before, 'work_after':after,
                      'changed_untouched_axes':['XYZ'[n] for n in changed_untouched],
                      'postread_applied_status_equal':True})
    return cases


def rotation_case():
    # Exact expression order in the two pinned local sources:
    # emccanon.cc: ((r)*M_PI/180.0), interp_internal.hh: r*(M_PI/180.).
    r = 100000.0
    canon_t = r * math.pi / 180.0
    interp_t = r * (math.pi / 180.0)
    machine = (1000.0, 0.0)
    point = (machine[0]*math.cos(-canon_t)-machine[1]*math.sin(-canon_t),
             machine[0]*math.sin(-canon_t)+machine[1]*math.cos(-canon_t))
    reconstructed = (point[0]*math.cos(interp_t)-point[1]*math.sin(interp_t),
                     point[0]*math.sin(interp_t)+point[1]*math.cos(interp_t))
    error = max(abs(a-b) for a,b in zip(machine,reconstructed))
    bound = 32 * 2**-53 * sum(abs(v) for v in machine)
    assert error > bound
    return {'rotation_deg':r, 'canon_radians':canon_t, 'interpreter_radians':interp_t,
            'machine':machine, 'point_after_canon_unrotate':point,
            'point_reconstructed_with_interpreter_rotate':reconstructed,
            'error':error, 'v5_32_u_S':bound, 'covered':False,
            'limit':'binary64 source-expression model; compiled native behaviour not asserted'}


def native_recheck():
    root = Path('/home/cnc/claude-work/start/natives/runs')
    names = ['20261126T143949-fgx-eq','20261126T144117-fgx-pyA',
             '20261126T145445-fgx-pyB','20261126T145613-fgx-pyC']
    out = []
    for name in names:
        d = root/name; data=(d/'report.json').read_bytes(); r=json.loads(data)
        assert r['commit']=='dbd14cab4a54e3113ca23e07e0558284ac821400'
        assert r['restore']['outcome']=='complete' and not r['crashes']
        row={'run':name,'report_sha256':hashlib.sha256(data).hexdigest(),
             'commit':r['commit'],'restore':r['restore']['outcome'],'crashes':r['crashes']}
        if name.endswith('-eq'):
            fgx=r['fgx']; assert not fgx['errors']
            assert fgx['start_plain']['run_basis'][0]['verified'] is True
            pos=fgx['start_plain']['sample']['machine_pos']
            assert abs(pos[0]-14.090389553440874)<1e-9 and abs(pos[1]-10.833504408394036)<1e-9
            trace=(d/'logs/trace.ndjson').read_bytes()
            starts=[x for line in trace.decode().splitlines()
                    if (x:=json.loads(line)).get('tag')=='run_basis.start' and x.get('run_id')==2]
            assert len(starts)==1 and starts[0]['verified'] is True
            row.update({'sample':pos,'trace_start':starts[0],
                        'product_tree_present':(d/'tree/lcnc-gateway/gateway.py').exists(),
                        'source_identity_limit':'commit from run report; cleaned run tree not independently hashed',
                        'trace_sha256':hashlib.sha256(trace).hexdigest()})
        else:
            fgx=r['fgx']; variant=r['patched']['variant']
            assert fgx['normal_run']['end'] and fgx['normal_end_pos']==[10.0,10.0,0.0]
            replies=fgx['py']
            if variant in ('pyA','pyB'):
                assert all('Python plugin not initialized' in x for x in replies.values())
            else:
                assert replies['NRPY1']=='NRPY1 1 0.0 0.0 0.0 0.0 2'
                assert replies['NRPY2']=='NRPY2 7.0 0.0 0.0 0.0 0.0 50.0'
            row.update({'variant':variant,'normal_end_pos':fgx['normal_end_pos'],'read_replies':replies,
                        'errors_at_connect':fgx['errors_at_connect']})
        out.append(row)
    return out


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='r512-codex-',dir='/tmp') as tmp:
        root=Path(tmp)
        models={'mtime_not_start_snapshot':path_mtime_case(root),
                'optout_shared_toplevel':shared_toplevel_case(root),
                'l20_untouched_axes':l20_cases(), 'rotation_error_bound':rotation_case()}
    print(json.dumps({'kind':'R512 plan probes and prior native evidence recheck',
                      'new_native_run':False,'product_tests':False,'models':models,
                      'native_recheck':native_recheck(),
                      'result':'all assertions passed; countermodels are not implementation tests'},
                     ensure_ascii=False,indent=2))

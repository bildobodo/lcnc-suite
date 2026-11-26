"""R514 source-bound plan countermodels. No product imports or live access.

The model intentionally contains only the control-flow facts quoted in the
source evidence. It is not a gateway, worker, or browser runtime test.
"""
import json


def ratio_countermodels():
    # ms: page post -> received final result; sweep_ms: active slice clock.
    # The unobserved delay kind differs but the two exposed fields are equal.
    worlds = [
        {'name': 'unpaused_yields_and_delivery', 'active_ms': 1000,
         'hold_ms': 0, 'other_ms': 1000},
        {'name': 'paused', 'active_ms': 1000, 'hold_ms': 1000, 'other_ms': 0},
    ]
    for w in worlds:
        w['ms'] = w['active_ms'] + w['hold_ms'] + w['other_ms']
        w['sweep_ms'] = w['active_ms']
        w['ratio'] = w['ms'] / w['sweep_ms']
    assert worlds[0]['ratio'] == worlds[1]['ratio'] == 2
    cold = {'build_ms': 2000, 'active_ms': 1000, 'yields_ms': 100, 'ack_delivery_ms': 300}
    cold['ratio'] = sum(cold.values()) / cold['active_ms']
    assert cold['ratio'] == 3.4
    concentrated = {'whole_ms': 1001000, 'active_ms': 1000000,
                    'hidden_phase_ms': 1000, 'hidden_phase_work_ms': 0}
    concentrated['ratio'] = concentrated['whole_ms'] / concentrated['active_ms']
    assert concentrated['ratio'] < 1.002 and concentrated['hidden_phase_work_ms'] == 0
    return {'indistinguishable_totals': worlds, 'cold_no_pause': cold,
            'whole_job_near_one_but_no_hidden_work': concentrated}


def status_loop(hidden, settings_changed=False, publication_changed=False):
    # gateway.py:14665-14668 is before all these producers.
    if hidden:
        return []
    result = ['status']
    if settings_changed:
        result.append('settings_changed')
    if publication_changed:
        result.append('viewer_gcode_ready')
    return result


def hidden_hold():
    # bakeHold.ts:99-101: parsing has no deadline. Only a later event ends it.
    hold = {'state': 'parsing', 'deadline': None}
    observed = status_loop(True, publication_changed=True)
    assert not observed
    worker_flags_after_removing_hidden_hold = {'reparse': True}
    assert hold['deadline'] is None and worker_flags_after_removing_hidden_hold['reparse']
    return {'start': 'visible idle refresh -> parsing -> reparse hold',
            'server_after_hiding': 'parse ends, publication changes',
            'frames_received': observed, 'hold': hold,
            'sweep_can_progress': False,
            'time_limit_ms': None,
            'visible_control_frames': status_loop(False, publication_changed=True)}


def hidden_off():
    server_enabled = False  # Other device's authorized save/reset committed.
    local_enabled = True
    frames = status_loop(True, settings_changed=True)
    if 'settings_changed' in frames:
        local_enabled = server_enabled
    assert not server_enabled and local_enabled
    after_show = status_loop(False, settings_changed=True)
    assert 'settings_changed' in after_show
    return {'server_enabled': server_enabled, 'hidden_client_enabled': local_enabled,
            'worker_terminated': False, 'frames_received': frames,
            'visible_control_frames': after_show}


if __name__ == '__main__':
    print(json.dumps({'review': 'R514', 'kind': 'source-bound plan models',
                      'ratio': ratio_countermodels(), 'reparse_hidden': hidden_hold(),
                      'simulation_off_hidden': hidden_off(),
                      'result': 'three countermodels reproduced',
                      'runtime_or_native_run': False}, indent=2))

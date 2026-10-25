#!/usr/bin/env python3
"""R202: isolated admission probes, no gateway import / LinuxCNC commands.
Usage: python3 policy-probe.py /path/to/archive > policy-probe.json
Observed values are assertions of the reviewed baseline, not desired behavior.
"""
import sys, json, time
from pathlib import Path
from dataclasses import asdict, replace
from types import SimpleNamespace
root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'lcnc-gateway'))
import command_policy as cp
import hal_bridge
import status_runtime as sr
import linuxcnc
base = cp.MachineState(armed=True, is_estop=False, is_enabled=True,
    is_homed=True, is_idle=True, is_running=False, is_paused=False,
    eoffset_enabled=False, rotary_at_zero=True, kins_switchable=True,
    kins_type=0, g5x_index=1, a_at_zero=True, rotary_offsets_clean=True,
    g92_xyz_clean=True, twp_capable=True, motion_still=True)
variants = dict(idle={}, observer=dict(armed=False), estop=dict(is_estop=True,is_enabled=False),
    off=dict(is_enabled=False), unhomed=dict(is_homed=False), partially_homed=dict(is_homed=False),
    running=dict(is_idle=False,is_running=True,motion_still=False),
    mdi_running=dict(is_idle=False,is_running=True,motion_still=False),
    paused=dict(is_idle=False,is_paused=True), eoffset=dict(eoffset_enabled=True),
    unknown_kins=dict(kins_type=None), stranded_plane=dict(kins_type=2,twp_active=False),
    jogging=dict(motion_still=False))
matrix={}
for name,changes in variants.items():
    s=replace(base,**changes)
    matrix[name]={'state':asdict(s),'permissions':cp.evaluate_permissions(s),
        'reasons':cp.permission_reasons(s),'commands':{c:cp.check_command(c,s) for c in cp.COMMAND_GATES}}
assert matrix['stranded_plane']['permissions']['step']
assert not matrix['stranded_plane']['permissions']['run']
assert matrix['observer']['commands']['abort'] is not None
assert matrix['running']['permissions']['override'] and not matrix['running']['permissions']['ready']
assert matrix['eoffset']['permissions']['idle'] and not matrix['eoffset']['permissions']['zero']
assert matrix['jogging']['permissions']['idle']
# Real read methods, injected in-memory snapshot. No sockets or reader thread.
b=hal_bridge.HalBridge.__new__(hal_bridge.HalBridge)
b._stale_sec=hal_bridge.READER_STALE_SEC
b._reader_state=({'kins_type':0.0, 'eoffset_enabled':False, 'emc_enable_in':True}, time.monotonic()-10)
p=SimpleNamespace(emc_enable_in=b.reader_get('emc_enable_in'), interp_state=linuxcnc.INTERP_IDLE,
    paused=False, estop=False, enabled=True, homed=True,
    eoffset_enabled=b.reader_get('eoffset_enabled'), rotary_at_zero=True,
    kins_type=b.reader_get('kins_type'),g5x_index=1,rotary_abc=[0,0,0],
    inpos=True,current_vel=0)
s=sr.policy_state_from_payload(p,True,kins_switchable=True,twp_capable=True)
stale={'reader_is_stale':b.reader_is_stale(), 'read_values':dict(b._reader_state[0]),
       'permissions':cp.evaluate_permissions(s)}
assert stale['reader_is_stale'] and stale['permissions']['machineFrame'] and stale['permissions']['probe']
p.interp_state=None
missing=sr.policy_state_from_payload(p,True,kins_switchable=True,twp_capable=True)
assert missing.is_idle and cp.evaluate_permissions(missing)['run']
print(json.dumps({'baseline':'b2ded6d1','scope':'pure policy / in-memory HAL snapshot; no machine operations',
    'matrix':matrix,'stale_reader':stale,'missing_interp_state':{'interpreted_idle':missing.is_idle,
    'run':cp.evaluate_permissions(missing)['run']},'baseline_observation_assertions':8},indent=2))

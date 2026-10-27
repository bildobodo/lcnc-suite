"""R216 independent delayed-state probes. Fake LinuxCNC only, no live access."""
import asyncio
from unittest import mock
from test_button_gates_d import _Writer, TestLoadWithoutAuto
from test_button_gates import _payload, _run
import gateway

lc = gateway.linuxcnc

class ModeAdmission(_Writer):
    def prepare(self, *, current_homing=False, current_moving=False, current_interp=None, current_mode=None):
        # The status just published is idle, standing, not homing, MANUAL.
        gateway._shared_status = _payload(homed=True, inpos=True, current_vel=0.0,
                                         homing_active=False, task_mode=lc.MODE_MANUAL)
        gateway.STAT.homed = [True]*3
        gateway.STAT.joints = 3
        gateway.STAT.joint = [{'homing':current_homing} for _ in range(3)]
        gateway.STAT.inpos = not current_moving
        gateway.STAT.current_vel = 5.0 if current_moving else 0.0
        gateway.STAT.interp_state = current_interp if current_interp is not None else lc.INTERP_IDLE
        gateway.STAT.task_mode = current_mode if current_mode is not None else lc.MODE_MANUAL
        def mode(target):
            self.cmd.calls.append(('mode',(target,),{}))
            gateway.STAT.task_mode = target
        self.cmd.mode = mode
        self.cmd.wait_complete = lambda *a: lc.RCS_DONE

    def test_mode_current_homing_refuses_despite_old_idle_status(self):
        self.prepare(current_homing=True)
        r = _run(gateway.handle_command({'cmd':'set_mode','mode':lc.MODE_MDI},True,self.writer.conn_key))
        print('current homing:',r,self.cmd.names())
        self.assertNotIn('mode',self.cmd.names(),'fresh STAT already shows homing; do not send the mode change')

    def test_mode_current_motion_refuses_despite_old_standing_status(self):
        self.prepare(current_moving=True)
        r = _run(gateway.handle_command({'cmd':'set_mode','mode':lc.MODE_MDI},True,self.writer.conn_key))
        print('current movement:',r,self.cmd.names())
        self.assertNotIn('mode',self.cmd.names(),'fresh STAT already shows movement; do not send the mode change')

    def test_mode_standing_no_homing_is_admitted(self):
        self.prepare()
        r = _run(gateway.handle_command({'cmd':'set_mode','mode':lc.MODE_MDI},True,self.writer.conn_key))
        self.assertTrue(r['ok'],r)
        self.assertIn('mode',self.cmd.names())

    def test_unhomed_spindle_exception_does_not_force_manual_from_new_mdi_run(self):
        self.prepare(current_interp=lc.INTERP_READING,current_mode=lc.MODE_MDI)
        gateway.STAT.homed = [False]*3
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0,
                                         homing_active=False,task_mode=lc.MODE_MANUAL)
        with mock.patch.object(gateway,'_spindle_before_homing',lambda:True):
            r = _run(gateway.handle_command({'cmd':'spindle_forward','speed':1000},True,self.writer.conn_key))
        print('new MDI run, unhomed exception:',r,self.cmd.names())
        self.assertNotIn('mode',self.cmd.names(),'Q1 exception needs current idle/MANUAL; do not force MANUAL')
        self.assertNotIn('spindle',self.cmd.names())

    def test_spindle_exception_current_manual_idle_is_admitted(self):
        self.prepare()
        gateway.STAT.homed = [False]*3
        gateway._shared_status = _payload(homed=False,inpos=True,current_vel=0.0,
                                         homing_active=False,task_mode=lc.MODE_MANUAL)
        with mock.patch.object(gateway,'_spindle_before_homing',lambda:True):
            r = _run(gateway.handle_command({'cmd':'spindle_forward','speed':1000},True,self.writer.conn_key))
        self.assertTrue(r['ok'],r)
        self.assertIn('spindle',self.cmd.names())

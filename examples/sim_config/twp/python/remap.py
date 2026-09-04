# This is a python remap for LinuxCNC implementing 'Tilted Work Plane'
# G68.2, G68.3, G68.4 and related Gcodes G53.1, G53.3, G53.6, G69
#
# Copyright ()c) 2023 David Mueller <mueller_david@hotmail.com>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 2 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
#
# ---------------------------------------------------------------------------
# LCNC-SUITE FORK (GPL v2, same license) of the upstream TWP remap from
# LinuxCNC master @493926b56c configs/sim/axis/vismach/5axis/twp/python/.
# Upstream every entry point starts `if self.task == 0: return` - previews
# (AXIS included) show TWP programs untransformed by design. This fork lets
# the PREVIEW interpreter run the same pure math (no HAL access: nutation
# angle comes from the INI, twp/kins pin state from module-level mirrors)
# and announces the kins switches on the one execution-ordered channel the
# preview canon receives - comment markers, silent in task:
#   (WEBUI_KINSTYPE=n)          emitted where M68 E3 Qn switches switchkins
#                               (the ngc wrappers carry types 0/1; g53x_core
#                               below emits the type-2 marker)
#   (WEBUI_TWPFRAME=p,t1,t2)    emitted where g53x_core pins the TOOL-kins
#                               plane frame: pre-rot in RADIANS, primary /
#                               secondary angles in DEGREES - exactly the
#                               three <kins>.pre-rot/primary-angle/
#                               secondary-angle set_p values (units mirror
#                               the upstream asymmetry, do not "fix" it)
# The G59 origin needs no marker: the G10 L2 P6..9 + G59 writes are plain
# interpreter state and execute in preview. The orient G0 is real canon
# motion, already in the preview stream. All edits are tagged LCNC-SUITE.
# Task-mode behavior is intentionally IDENTICAL to upstream.
# ---------------------------------------------------------------------------
#
import sys
import traceback
import numpy as np
from math import sin,cos,tan,asin,acos,atan,atan2,sqrt,pi,degrees,radians,fabs
from interpreter import *
import emccanon
from util import lineno, call_pydevd
# LCNC-SUITE: pure table-composition geometry (unit-tested off-machine)
from twp_transform import (to_table_frame, from_table_frame,
                           to_table_frame_vector, calc_shortest_distance)
import hal


# logging
import logging
# this name will be printed first on each log message
log = logging.getLogger('remap.py; TWP')
# we have to setup a handler to be able to set the log level for this module
handler = logging.StreamHandler()
formatter = logging.Formatter('%(name)s %(levelname)s: %(message)s')
handler.setFormatter(formatter)
log.addHandler(handler)
# Manually force the log level for this module
log.setLevel(logging.ERROR) # One of DEBUG, INFO, WARNING, ERROR, CRITICAL


# set up parsing of the inifile
import os
import configparser
# get the path for the ini file used to start this config
inifile = os.environ.get("INI_FILE_NAME")
# instantiate a parser in non-strict mode because we have multiple entries for
# some sections in the ini
config = configparser.ConfigParser(strict=False)
# ingest the ini file
config.read(inifile)

## SPINDLE ROTARY JOINT LETTERS
# spindle primary joint
joint_letter_primary = (config['TWP']['PRIMARY']).capitalize()
# spindle secondary joint (ie the one closer to the tool)
joint_letter_secondary = (config['TWP']['SECONDARY']).capitalize()

if not joint_letter_primary in ('A','B','C') or not joint_letter_secondary in ('A','B','C'):
    log.error("Unable to parse joint letters given in INI [TWP].")
elif joint_letter_primary == joint_letter_secondary:
    log.error("Letters for primary and secondary joints in INI [TWP] must not be the same.")
else:
    # get the MIN/MAX limits of the respective rotary joint letters
    category = 'AXIS_' +  joint_letter_primary
    primary_min_limit = float(config[category]['MIN_LIMIT'])
    primary_max_limit = float(config[category]['MAX_LIMIT'])
    log.info('Joint letter for primary   is %s with MIN/MAX limits: %s,%s', joint_letter_primary, primary_min_limit, primary_max_limit)
    category = 'AXIS_' +  joint_letter_secondary
    secondary_min_limit = float(config[category]['MIN_LIMIT'])
    secondary_max_limit = float(config[category]['MAX_LIMIT'])
    log.info('Joint letter for secondary is %s with MIN/MAX Limits: %s,%s', joint_letter_secondary, secondary_min_limit, secondary_max_limit)


## CONNECTIONS TO THE KINEMATIC COMPONENT
# get the name of the kinematic component (this seems to ingest also the next line)
kins_comp = (config['KINS']['KINEMATICS']).partition('\n')[0]
# name of the hal pin that represents the nutation-angle
kins_nutation_angle = kins_comp + '_kins.nut-angle'
# name of the hal pin that represents the pre-rotation
kins_pre_rotation = kins_comp + '_kins.pre-rot'
# name of the hal pin that represents the primary joint orientation angle
kins_primary_rotation = kins_comp + '_kins.primary-angle'
# name of the hal pin that represents the secondary joint orientation angle
kins_secondary_rotation = kins_comp + '_kins.secondary-angle'
# LCNC-SUITE: machine y/z of the work-table rotary's axis line (static geometry)
kins_y_rot_axis = kins_comp + '_kins.y-rot-axis'
kins_z_rot_axis = kins_comp + '_kins.z-rot-axis'

## CONNECTIONS TO THE HELPER COMPONENT
twp_comp = 'twp-helper-comp.'
twp_is_defined = twp_comp + 'twp-is-defined'
twp_is_active = twp_comp + 'twp-is-active'


# ---------------------------------------------------------------------------
# LCNC-SUITE preview support. The preview interpreter may live in a process
# with no HAL component at all (the webui parse worker: hal.get_value raises
# "Cannot call before creating component" there), so every hal.* touch is
# routed through the helpers below. _task_mode is set from self.task at the
# top of every remap entry point - a process only ever hosts one kind of
# interpreter (milltask: task; GUIs / parse worker: preview).
# ---------------------------------------------------------------------------
_task_mode = True
# Preview mirrors of HAL state the remaps read back:
#   twp-helper-comp.twp-status (0 undefined / 1 defined / 2 active)
#   <kins>.pre-rot             (current pre-rotation, radians)
_preview_twp_state = 0
_preview_pre_rot = 0.0


def _ini_halcmd_setp(pin_name):
    """Value of `setp <pin_name> <val>` from the INI's [HAL]HALCMD lines.

    configparser keeps only the LAST duplicate key, and [HAL] sections
    carry many HALCMD lines - so scan the raw file. Returns float or None.
    """
    val = None
    section = None
    try:
        with open(inifile) as f:
            for raw in f:
                line = raw.strip()
                if line.startswith('['):
                    section = line
                    continue
                if section != '[HAL]' or '=' not in line:
                    continue
                key, _, rhs = line.partition('=')
                if key.strip().upper() != 'HALCMD':
                    continue
                parts = rhs.split()
                if len(parts) == 3 and parts[0] == 'setp' and parts[1] == pin_name:
                    try:
                        val = float(parts[2])
                    except ValueError:
                        pass
    except OSError as e:
        log.error('LCNC-SUITE preview: cannot read INI %s: %s', inifile, e)
    return val


# Nutation angle for the preview: static machine geometry, single-sourced
# from the INI HALCMD setp line (same convention the webui gateway parses).
_ini_nut_angle = _ini_halcmd_setp(kins_nutation_angle)


def _get_nut_angle():
    """Nutation angle in degrees: live pin under task, INI value in preview.

    LCNC-SUITE: replaces the direct hal.get_value(kins_nutation_angle)
    calls. Task behavior is unchanged (missing pin still raises, exactly
    like upstream). A preview without the INI setp line raises loudly -
    a wrong-geometry preview would be silently wrong everywhere.
    """
    if _task_mode:
        return hal.get_value(kins_nutation_angle)
    if _ini_nut_angle is None:
        raise RuntimeError(
            "LCNC-SUITE preview: no `setp %s <deg>` line in [HAL]HALCMD of %s"
            " - the preview cannot know the machine's nutation angle"
            % (kins_nutation_angle, inifile))
    return _ini_nut_angle


def _get_pre_rot():
    """Current pre-rotation (radians): live pin under task, mirror in preview."""
    if _task_mode:
        return hal.get_value(kins_pre_rotation)
    return _preview_pre_rot


# LCNC-SUITE: the table rotary's axis LINE (x-parallel, through machine
# y=y-rot-axis, z=z-rot-axis) - static geometry, same INI-setp single-sourcing
# as the nutation angle above.
_ini_y_rot_axis = _ini_halcmd_setp(kins_y_rot_axis)
_ini_z_rot_axis = _ini_halcmd_setp(kins_z_rot_axis)


def _get_rot_axis_yz():
    """Table axis line (machine y, z): live pins under task, INI in preview."""
    if _task_mode:
        return (hal.get_value(kins_y_rot_axis), hal.get_value(kins_z_rot_axis))
    if _ini_y_rot_axis is None or _ini_z_rot_axis is None:
        raise RuntimeError(
            "LCNC-SUITE preview: no `setp %s <val>` / `setp %s <val>` lines in"
            " [HAL]HALCMD of %s - the preview cannot know the table's rotation"
            " axis" % (kins_y_rot_axis, kins_z_rot_axis, inifile))
    return (_ini_y_rot_axis, _ini_z_rot_axis)


# ---------------------------------------------------------------------------
# LCNC-SUITE: touch-off provenance (W1).
#
# The work offset is read below as a TABLE-FRAME point. That is only true of
# the raw numbers if the operator touched off with A at 0 — which used to be
# a STANDING PRECONDITION stated in three places and checkable in none,
# because LinuxCNC records nothing about the pose an offset was set in.
#
# The gateway now records it. The parameter layout lives in twp_prov.py
# (imported below) — a linuxcnc-free module that gateway_util.wcs_prov_params
# twins and lcnc-gateway/test_twp_prov.py pins, so the two sides cannot
# drift silently.
#
# The recorded triple is what makes it falsifiable: we stamp only the writes
# the gateway makes, so a program's `G10 L2`, another GUI, or a typed MDI
# line moves the offset out from under the stamp. A stale record is worse
# than none — it reads as authoritative — so it is believed only while the
# recorded values still match the live fixture.
from twp_prov import prov_params, PROV_STAMPED
# LCNC-SUITE: fixture/G92 parameter layout (linuxcnc-free twin of
# gateway_util.WCS_VAR_BASES; lcnc-gateway/test_twp_params.py pins them).
from twp_params import (wcs_row_params, G92_PARAMS, G92_FLAG_PARAM,
                        RESERVED_FIXTURES, active_index as _active_fixture_index)


class TwpTouchoffKinsError(Exception):
    """The recorded touch-off was made under non-identity kinematics.

    The var row holds literal numbers; under TCP or TOOL kinematics the
    world frame those numbers were computed in is not the machine frame,
    and the stamp cannot tell HOW they were computed. Refusing loudly is
    the only honest move (doctrine: silent wrong beats absent is false)."""


def read_touchoff_pose(self, n, offsets):
    """Machine-frame A the fixture `n` offset was touched off at.

    Returns (a_deg, kins, source) where source is 'recorded', 'stale' or
    'assumed' and kins is the switchkins type recorded at touch-off (0.0
    when not recorded). When no usable record exists we fall back to A = 0
    — the historical precondition — and SAY so, so the caller can tell the
    operator that the old rule is still in force for this offset rather
    than silently pretending the pose is known.
    """
    try:
        pp = prov_params(n)
        if abs(float(self.params[pp["stamped"]]) - PROV_STAMPED) > 1e-9:
            return 0.0, 0.0, 'assumed'                 # never recorded
        rec = [float(self.params[pp[k]]) for k in ("x", "y", "z")]
        if any(abs(rec[i] - float(offsets[i])) > 1e-6 for i in range(3)):
            return 0.0, 0.0, 'stale'                   # changed underneath
        return float(self.params[pp["a"]]), float(self.params[pp["kins"]]), \
            'recorded'
    except (IndexError, KeyError, TypeError, ValueError):
        return 0.0, 0.0, 'assumed'


def to_storage_frame(self, offsets, n):
    """The active work offset as a TABLE-FRAME point.

    A fixture offset is a MACHINE-frame position of the work origin, true at
    the table angle it was touched off at. Converting it through that
    recorded angle is what lets an operator touch off at ANY table angle —
    the whole point of W1. With no record the conversion is the identity, so
    an A=0 touch-off (and every pre-existing var file) behaves exactly as
    before.
    """
    a_touch, kins_touch, source = read_touchoff_pose(self, n, offsets)
    # LCNC-SUITE: the gateway records the switchkins type "so the record is
    # falsifiable" — so READ it. Under TOOL kinematics (2) the world frame is
    # the plane frame (a function of the head pins, tilted or not, at ANY A);
    # under TCP (1) it is the table-riding work frame, which coincides with
    # the machine frame ONLY at the A=0 datum. A record made in either frame
    # converted as if machine-frame would double-rotate the offset — the
    # exact class this whole feature exists to catch — so refuse loudly and
    # have the operator re-touch in machine mode. kins 1 at A=0 is provably
    # the identity (work = Rx(0)(machine - pivot) + pivot = machine) and is
    # admitted; whether tilted TCP touch-offs record table-frame numbers is
    # unknowable without a live probe (follow-up), so it is refused too.
    if source == 'recorded':
        _kt = int(round(kins_touch))
        if _kt == 2 or (_kt != 0 and abs(a_touch) > 1e-9):
            raise TwpTouchoffKinsError(
                "G%s was touched off under non-identity kinematics (kins %d"
                " at A=%.3f deg) - the recorded numbers are not machine-frame."
                " Switch the jog frame to Machine and re-touch-off."
                % (53 + int(n), _kt, a_touch))
    if source != 'recorded' or abs(a_touch) <= 1e-9:
        if source == 'stale':
            log.warning(
                "TWP: G%s offset changed since it was touched off (not by the"
                " web UI) - its recorded table pose no longer describes it, so"
                " A=0 is assumed. Re-touch-off through the UI to restore it.",
                53 + int(n))
        return list(offsets), a_touch, source
    y_rot_axis, z_rot_axis = _get_rot_axis_yz()
    _z, _x, origin_table = to_table_frame(
        (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), list(offsets),
        a_touch, y_rot_axis, z_rot_axis)
    log.info("TWP: G%s touched off at A=%.6f deg - offset %s mapped to table"
             " frame %s", 53 + int(n), a_touch, list(offsets), list(origin_table))
    return list(origin_table), a_touch, source


_ROTARY_ATTR = {"A": "AA", "B": "BB", "C": "CC"}


def _rotary_work_offset(self, letter):
    """ACTIVE-fixture + G92 offset of rotary `letter`, degrees.

    LCNC-SUITE: the interpreter's *_current values are PROGRAM coordinates;
    adding these back reaches the machine frame. Attribute path first; the
    parameter fallback reads the ACTIVE row (the old fallback read #5224,
    the G54 row, which is the wrong row as soon as G59 is active - i.e. at
    every re-orient) and the G92 row.
    """
    attr = _ROTARY_ATTR[letter]
    try:
        return (float(getattr(self, attr + "_origin_offset"))
                + float(getattr(self, attr + "_axis_offset")))
    except AttributeError:
        row = wcs_row_params(_active_fixture_index(self.params))
        g92 = float(self.params[G92_PARAMS[letter]]) if float(self.params[G92_FLAG_PARAM]) else 0.0
        return float(self.params[row[letter]]) + g92


def rotary_offsets_nonzero(self):
    """True when a nonzero A/B/C work/G92 offset makes the machine frame ambiguous.

    LCNC-SUITE: the table composition works in the MACHINE frame; a rotary work
    offset rewritten between definition and orient would silently shift it.
    Upstream already restricts TWP to G54 for similar reasons - this closes the
    rotary corner loudly instead of computing something untested. B/C joined A
    on 2026-08-30: the head solve reads them too (get_current_rotary_positions).
    """
    return any(abs(_rotary_work_offset(self, l)) > 1e-6 for l in "ABC")


def _g92_rotary_nonzero(self):
    """A G92 A/B/C offset in effect - it applies in EVERY fixture, so no
    fixture write can repair it; only G92.1 can."""
    try:
        return any(abs(float(getattr(self, _ROTARY_ATTR[l] + "_axis_offset"))) > 1e-6
                   for l in "ABC")
    except AttributeError:
        if not float(self.params[G92_FLAG_PARAM]):
            return False
        return any(abs(float(self.params[G92_PARAMS[l]])) > 1e-6 for l in "ABC")


def reserved_rows_dirty(self):
    """{(fixture, letter): value} for every nonzero A/B/C/R in G59..G59.3.

    LCNC-SUITE: these four rows are g53x_core's. It writes X/Y/Z at every
    orient and, since 2026-08-30, zeroes A/B/C/R too - upstream left them
    untouched, so a rotary touch-off that landed in G59 (Zero All under the
    Plane jog frame) survived every orient and displaced the head move.
    """
    out = {}
    for n in RESERVED_FIXTURES:
        row = wcs_row_params(n)
        for l in ("A", "B", "C", "R"):
            v = float(self.params[row[l]])
            if abs(v) > 1e-6:
                out[(n, l)] = v
    return out


def get_machine_a(self):
    """Machine-frame A in degrees, valid in task AND preview.

    LCNC-SUITE: the interpreter's AA_current is PROGRAM coordinates, so the
    active work-offset and G92 A terms have to be added back to reach the
    machine frame the table pivot lives in. Falls back to the numbered
    parameters if this interp build lacks the offset attributes (G54-only is
    enforced at definition time, so #5224/#5214 are the right rows).
    """
    return float(self.AA_current) + _rotary_work_offset(self, "A")


def webui_preview_reset():
    """Reset all preview-side module state before a fresh parse.

    The webui parse worker parses many programs in one process while this
    module stays cached in sys.modules - without this hook a previous
    program's TWP state would leak into the next parse. Called by
    gcode_parse_worker before each parse; harmless anywhere else.
    """
    global _preview_twp_state, _preview_pre_rot
    global twp_matrix, twp_flag, twp_build_params, pre_rot
    global saved_work_offset, saved_work_offset_number, orient_mode
    global twp_pose_a
    twp_pose_a = None
    _preview_twp_state = 0
    _preview_pre_rot = 0.0
    twp_matrix = np.asmatrix(np.identity(4))
    twp_flag = []
    twp_build_params = {}
    pre_rot = 0
    saved_work_offset = [0, 0, 0]
    saved_work_offset_number = 1
    orient_mode = 0
# --------------------------- end LCNC-SUITE block --------------------------


# raise InterpreterException if execute() or read() fail
throw_exceptions = 1

## VALUE INITIALIZATION
# we start with the identity matrix (ie the twp is equal to the world coordinates)
twp_matrix = np.asmatrix(np.identity(4))

# some g68.2 p-word modes require several calls to enter all the required parameters so we
# need a flag that indicates when the twp has been defined and is ready for g53.x
# [current p-word, number of calls required, (state of calls required for that p mode added by g68.2)]
# note that we use string since boolean True == 1, which gives wrong results if we want
# to count the elements that are True because it is counted as integer '1'
# eg: twp_flag = [0, 1, 'empty']
twp_flag = []
# we need a place to store the twp-build-parameters if the mode needs more than one call
twp_build_params = {}
# container to store the current work offset during twp operations
current_work_offset_number = 1
saved_work_offset = [0,0,0]
# LCNC-SUITE: the machine-frame A the HEAD was last oriented at (G53.x). The
# PLANE itself is stored table-relative and rides the workpiece, so it cannot
# go stale; the head solve can. Sentinel until the first orient - before that
# there is no solve and "not normal" would be a claim about nothing.
twp_pose_a = None
# LCNC-SUITE: sentinel published when no plane is defined (the pin always
# exists, so "none" must be a value - see twp-helper-comp.py).
TWP_POSE_NONE = -1e9
# orientation mode refers to the strategy used to choose from the different rotary angles for a given
# tool-z vector. The optimization is applied to the primary axis only with mode 0 (shortest path) being
# the default. (0=shortest_path , 1=positive_rotation only, 2=negative_rotation only, )
orient_mode = 0


# defines the kinematic model for (world <-> tool) coordinates of the machine at hand
# returns 4x4 transformation matrix for given angles and 4x4 input matrix
# NOTE: these matrices must be the same as the ones used to derive the kinematic model
def kins_tool_transformation(theta_1, theta_2, pre_rot, matrix_in, direction='fwd'):
    global joint_letter_primary, joint_letter_secondary
    global kins_nutation_angle
    T_in = matrix_in

    ## Define 4x4 transformation for virtual rotation around tool-z to orient tool-x and -y
    Stc = sin(pre_rot)
    Ctc = cos(pre_rot)
    Rtc=np.matrix([[ Ctc, -Stc, 0, 0],
                   [ Stc,  Ctc, 0, 0],
                   [ 0 ,  0 ,   1, 0],
                   [ 0,   0 ,   0, 1]])

    ## Define 4x4 transformation for the primary joint
    # get the basic 3x3 rotation matrix (returns array)
    if joint_letter_primary == 'A':
        Rp = Rx(theta_1)
    elif joint_letter_primary == 'B':
        Rp = Ry(theta_1)
    elif joint_letter_primary == 'C':
        Rp = Rz(theta_1)
    # add fourth column on the right
    Rp = np.hstack((Rp, [[0],[0],[0]]))
    # expand to 4x4 array and make into a matrix
    row_4 = [0,0,0,1]
    Rp = np.vstack((Rp, row_4))
    Rp = np.asmatrix(Rp)

    ## Define 4x4 transformation matrix for the secondary joint
    # get the basic 3x3 rotation matrix (returns array)
    if joint_letter_secondary == 'A':
        Rs = Rx(theta_2)
    elif joint_letter_secondary == 'B':
        Rs = Ry(theta_2)
    elif joint_letter_secondary == 'C':
        Rs = Rz(theta_2)
    # add fourth column on the right
    Rs = np.hstack((Rs, [[0],[0],[0]]))
    # expand to 4x4 array and make into a matrix
    row_4 = [0,0,0,1]
    Rs = np.vstack((Rs, row_4))
    Rs = np.asmatrix(Rs)

    if (joint_letter_primary, joint_letter_secondary)== ('C', 'B'):
        # Additional definitions for nutating joint
        v = radians(_get_nut_angle())
        Sv = sin(v)
        Cv = cos(v)
        Ss = sin(theta_2)
        Cs = cos(theta_2)
        r = Cs + Sv*Sv*(1-Cs)
        s = Cs + Cv*Cv*(1-Cs)
        t = Sv*Cv*(1-Cs) 
        # define rotation matrix for the secondary spindle joint
        Rs=np.matrix([[     Cs, -Cv*Ss,  Sv*Ss, 0],
                      [  Cv*Ss,      r,      t, 0],
                      [ -Sv*Ss,      t,      s, 0],
                      [      0,      0,      0, 1]])

    elif (joint_letter_primary, joint_letter_secondary)== ('C', 'A'):
        # Additional definitions for nutating joint
        v = radians(_get_nut_angle())
        Sv = sin(v)
        Cv = cos(v)
        Ss = sin(theta_2)
        Cs = cos(theta_2)
        r = Cs + Sv*Sv*(1-Cs)
        s = Cs + Cv*Cv*(1-Cs)
        t = Sv*Cv*(1-Cs)
        # define rotation matrix for the secondary spindle joint
        Rs=np.matrix([[      r, -Cv*Ss,      t, 0],
                      [  Cv*Ss,     Cs, -Sv*Ss, 0],
                      [      t,  Sv*Ss,      s, 0],
                      [      0,      0,      0, 1]])

    else:
        log.error('No formula for this spindle kinematic (primary, secondary) %s, %s', joint_letter_primary, joint_letter_secondary)

    # calculate the transformation matrix for the forward tool kinematic
    matrix_tool_fwd = np.transpose(Rtc)*np.transpose(Rs)*np.transpose(Rp)*T_in
    # calculate the transformation matrix for the inverse tool kinematic
    matrix_tool_inv = Rp*Rs*Rtc*T_in
    if direction == 'fwd':
        #log.debug("matrix tool fwd: \n", matrix_tool_fwd)
        #log.debug("inv would have been: \n", matrix_tool_inv)
        return matrix_tool_fwd
    elif direction == 'inv':
        #log.debug("matrix tool inv: \n", matrix_tool_inv)
        #log.debug("fwd would have been: \n", matrix_tool_fwd)
        return matrix_tool_inv
    else:
        return 0


# returns angle 'tc' required to rotate the x-axis of the tool-coords parallelto the machine-xy plane
# for given machine joint position angles.
# For G68.3 this is the default tool-x direction
# NOTE: this uses formulas derived from the transformation matrix in the inverse tool kinematic
def kins_calc_tool_rot_c_for_horizontal_x(self, theta_1, theta_2):
    global joint_letter_primary, joint_letter_secondary
    # The idea is that the tool-x vector is parallel to the machine xy-plane when the
    # z component of the x-direction vector is equal to zero
    # Mathematically we take the symbolic formula found in row 3, column 1 of the transformation
    # matrix from the inverse tool-kinematics, equal that to zero and solve for 'tc'.
    # this makes the x orientation of the tool coords horizontal and the user can set the
    # rotation from there using g68.3 r
    global kins_nutation_angle
    v = radians(_get_nut_angle())
    Cv = cos(v)
    Sv = sin(v)
    Cs = cos(theta_2)
    Ss = sin(theta_2)
    Cp = cos(theta_1)
    Sp = sin(theta_1)
    if (joint_letter_primary, joint_letter_secondary)== ('C', 'B'):
        t = Sv*Cv*(1-Cs)
        tc = atan2((Sv*Ss),t)
    elif (joint_letter_primary, joint_letter_secondary)== ('C', 'A'):
        t = Sv*Cv*(1-Cs)
        tc = atan2(-t,(Sv*Ss))
    else:
        log.error('No formula for this spindle kinematic (primary, secondary) %s, %s', joint_letter_primary, joint_letter_secondary)
    # note: tool-c rotation is done using a halpin that feeds into the kinematic component and the
    # vismach model. In contrast to a gcode command where 'c' refers to a physical machine joint)
    return tc


# calculates the secondary joint position for a given tool-vector
# secondary being the joint closest to the tool
# Note: this uses functions derived from the custom kinematic
def kins_calc_secondary(self, tool_z_req):
    global joint_letter_primary, joint_letter_secondary
    global secondary_min_limit, secondary_max_limit
    global kins_nutation_angle
    epsilon = 0.000001
    theta_2_list=[]
    (Kzx, Kzy, Kzz) = (tool_z_req[0], tool_z_req[1], tool_z_req[2])

    if (joint_letter_primary, joint_letter_secondary)== ('C', 'B'):
        # This kinmatic has infinite results for the vertical tool orientation
        # so we explicitly define the angles for that specific case
        if Kzz > 1 - epsilon:
            return [0]
        else:
            v = radians(_get_nut_angle())
            Sv = sin(v)
            Cv = cos(v)
            theta_2 = acos((Kzz - Cv*Cv)/(1 - Cv*Cv))
    elif (joint_letter_primary, joint_letter_secondary)== ('C', 'A'):
        # This kinmatic has infinite results for the vertical tool orientation
        # so we explicitly define the angles for that specific case
        if Kzz > 1 - epsilon:
            return [0]
        else:
            v = radians(_get_nut_angle())
            Sv = sin(v)
            Cv = cos(v)
            theta_2 = acos((Kzz - Cv*Cv)/(1 - Cv*Cv))
    else:
        log.error('No formula for this spindle kinematic (primary, secondary) %s', (joint_letter_primary, joint_letter_secondary))
    # since we are using acos() we really have two solutions theta_2 and -theta_2
    for theta in [theta_2, -theta_2]:
        log.debug('Checking if result %s is within secondary joint limits of %s and %s.',
                    degrees(theta), secondary_min_limit, secondary_max_limit)
        if theta > secondary_min_limit and theta < secondary_max_limit:
            log.debug('Adding %s to valid angles list.', degrees(theta))
            theta_2_list.append(theta)
    log.debug('List of possible secondary angles: %s\n',  theta_2_list)
    return theta_2_list


# calculates the primary joint position for a given tool-vector
# Note: this uses functions derived from the custom kinematic
def kins_calc_primary(self, tool_z_req, theta_2_list):
    global joint_letter_primary, joint_letter_secondary
    global primary_min_limit, primary_max_limit
    global kins_nutation_angle
    epsilon = 0.000001
    theta_1_list=[]
    (Kzx, Kzy, Kzz) = (tool_z_req[0], tool_z_req[1], tool_z_req[2])
    if (joint_letter_primary, joint_letter_secondary)== ('C', 'B'):
        # This kinmatic has infinite results for the vertical tool orientation
        # so we explicitly define the angles for that specific case
        if Kzz > 1 - epsilon:
            return [0]
        else:
            v = radians(_get_nut_angle())
            Sv = sin(v)
            Cv = cos(v)
            for i in range(len(theta_2_list)):
                theta_2 = theta_2_list[i]
                Ss  = sin(theta_2)
                Cs  = cos(theta_2)
                t = Sv*Cv*(1-Cs)
                p = Sv * Ss

                theta_1 = asin((p*Kzy - t*Kzx)/(t*t + p*p))
    elif (joint_letter_primary, joint_letter_secondary)== ('C', 'A'):
        # This kinmatic has infinite results for the vertical tool orientation
        # so we explicitly define the angles for that specific case
        if Kzz > 1 - epsilon:
            return [0]
        else:
            v = radians(_get_nut_angle())
            Sv = sin(v)
            Cv = cos(v)
            for i in range(len(theta_2_list)):
                theta_2 = theta_2_list[i]
                Ss  = sin(theta_2)
                Cs  = cos(theta_2)
                t = Sv*Cv*(1-Cs)
                p = Sv * Ss
                q = (t*Kzy - p*Kzx)/(t*t + p*p)
                theta_1 = asin(q)
    else:
        log.error('No formula for this spindle kinematic (primary, secondary) %s', (joint_letter_primary, joint_letter_secondary))
    # since we are using asin() we really have two solutions theta_1 and pi-theta_2
    for theta in [theta_1, transform_to_pipi(pi - theta_1)]:
        log.debug('Checking if result %s is within secondary joint limits of %s and %s.',
                    degrees(theta), secondary_min_limit, secondary_max_limit)
        if theta > secondary_min_limit and theta < secondary_max_limit:
            log.debug('Adding %s to valid angles list.', degrees(theta))
            theta_1_list.append(theta)
    log.debug('List of possible secondary angles: %s\n',  theta_2_list)
    return theta_1_list


# this is from 'mika-s.github.io'
# transforms a given angle to the interval of [-pi,pi]
def transform_to_pipi(input_angle):
    revolutions = int((input_angle + np.sign(input_angle) * pi) / (2 * pi))
    p1 = truncated_remainder(input_angle + np.sign(input_angle) * pi, 2 * pi)
    p2 = (np.sign(np.sign(input_angle)
                  + 2 * (np.sign(fabs((truncated_remainder(input_angle + pi, 2 * pi)) / (2 * pi))) - 1))) * pi
    output_angle = p1 - p2
    return output_angle


# this is from 'mika-s.github.io'
# used by 'transform_to_pipi()'
def truncated_remainder(dividend, divisor):
    divided_number = dividend / divisor
    divided_number = -int(-divided_number) if divided_number < 0 else int(divided_number)
    remainder = dividend - divisor * divided_number
    return remainder


# returns a list of valid primary/secondary spindle joint positions for a given tool-orientation vector
# or 'None','None' if no valid position could be found
def kins_calc_jnt_angles(self, tool_z_req):
    log.debug('tool_z_requested: %s', tool_z_req)
    # set the tolerance value
    epsilon = 0.0001
    # create np.array so we can easily calculate differences and check elements
    tool_z_req = np.array([tool_z_req[0], tool_z_req[1], tool_z_req[2]])
    # calculate secondary joint values using kinematic specific formula
    theta_2_pair = kins_calc_secondary(self, tool_z_req)
    # calculate primary joint values using kinematic specific formula
    theta_1_pair = kins_calc_primary(self, tool_z_req, theta_2_pair)
    joint_angles_list = []
    # iterate through all the possible combinations of (theta_1 , theta_2)
    for i in range(len(theta_1_pair)):
        for j in range(len(theta_2_pair)):
            # rotate an identity matrix using the custom tool kinematic model and the (theta_1, theta_2)
            matrix_in = np.asmatrix(np.identity(4))
            t_out = kins_tool_transformation(theta_1_pair[i], theta_2_pair[j], 0, matrix_in,'inv')
            # the resulting tool-z vector for this pair of (theta_1, theta_2) is found in the third column
            tool_z_would_be = np.array([t_out[0,2], t_out[1,2], t_out[2,2]])
            log.debug('tool_z_would_be: %s', tool_z_would_be)
            # calculate the difference of the respective elements
            tool_z_diff = tool_z_req - tool_z_would_be
            # and check if all elements are within [-epsilon,epsilon]
            match = np.all((tool_z_diff > -epsilon) & (tool_z_diff < epsilon))
            log.debug('Is the tool-Z-vector close enough ? %s', match)
            if match:
                # check if we already have this particular pair in the list
                if not (theta_1_pair[i], theta_2_pair[j]) in joint_angles_list:
                    log.debug('Appending (theta_1_pair, theta_2_pair) %s', (degrees(theta_1_pair[i]), degrees(theta_2_pair[j])))
                    joint_angles_list.append((theta_1_pair[i], theta_2_pair[j]))
    log.info('Found valid joint angles: %s', joint_angles_list)
    if joint_angles_list:
        return joint_angles_list
        #return joint_angles_list[-1]
    else:
        return None, None

# LCNC-SUITE: calc_shortest_distance moved to twp_transform.py (imported at
# the top) so the P-word mode logic is unit-testable off-machine. The move
# also fixes upstream's else-binding bug: the final `else` chained onto
# `if mode == 2`, so a mode-1 (positive-only) result was immediately
# overwritten with the shortest distance and could silently rotate the
# negative way.


# this takes a target angle in [-pi,pi] and finds the closest move within [min_limit, max_limit]
# from a given position in [min_limit, max_limit], returns the optimized target angle and the distance
# from the given position to that target angle
def calc_rotary_move_with_joint_limits(position, target, max_limit, min_limit, mode):
    pos = degrees(position)
    trgt = degrees(target)
    log.debug('(Current_pos, target):  %s', (pos, trgt))
    # calculate the shortest distance from position to target for the strategy given by
    # the operator (ie shortest (= default), positive rotation only, negative rotation only )
    dist = calc_shortest_distance(pos, trgt, mode)
    # check that the result is within the rotary axis limits defined in the ini file
    if dist >= 0: # shortest way is in the positive direction
        if (pos + dist) <=  max_limit: # if the limits allow we rotate the joint in the positive sense
            log.debug('Max_limit OK, target changed to: %s', (pos + dist))
            theta = pos + dist
        else: # if positive limits would be exceeded we need to go the longer wey in the other direction
            if mode == 0:
                log.debug('Max_limit reached, target remains: %s', trgt)
                theta = trgt
            else: # if the rotation direction was set by the operator then we can not change direction
                theta = None
                dist = None
    else:  # shortest way is in the negative direction
        if (pos + dist) >=  min_limit: # if the limits allow we rotate the joint in the negative sense
            log.debug('Min_limit OK, target changed to:  %s', (pos + dist))
            theta = pos + dist
        else: # if negative limits would be exceeded we need to go the longer way int the other direction
            if mode == 0:
                log.debug('Min_limit reached, target remains:  %s', trgt)
                theta = trgt
            else: # if the rotation direction was set by the operator then we can not change direction
                theta = None
                dist = None
    # we also attach the distance for this particular move and mode
    log.debug('Angle and distance returned:  %s, %s', theta, dist)
    return theta, dist


# this takes a list of joint angle pairs in [-pi,pi] and optimizes them for shortest moves
# in (min_limit, max_linit) from the current joint positions using the orient_mode set by
# the operator: 0=shortest (default), 1=positive rotation only, 2=negative rotation only
def calc_angle_pairs_and_distances(self, possible_prim_sec_angle_pairs):
    global primary_min_limit, primary_max_limit, secondary_min_limit, secondary_max_limit
    global orient_mode
    # get the current joint positions
    prim_pos, sec_pos = get_current_rotary_positions(self)
    # we want to return a list of angles that are optimized for the orient_mode and the
    # rotary axes limits as set in the ini file
    target_dist_list= []
    for prim_trgt, sec_trgt in possible_prim_sec_angle_pairs:
        # primary joint, here we apply the orient mode requested by the operator
        prim_move, prim_dist = calc_rotary_move_with_joint_limits(prim_pos, prim_trgt,
                                                                  primary_max_limit, primary_min_limit,
                                                                  orient_mode)
        # secondary joint, here we want the shortest move (although we could also apply a strategy here)
        sec_move, sec_dist = calc_rotary_move_with_joint_limits(sec_pos, sec_trgt,
                                                                secondary_max_limit, secondary_min_limit,
                                                                0)
        # if a solution has been found for this particular pair then we add it to the list
        if not (prim_move == None) and not (sec_move == None):
            target_dist_list.append(((prim_move, sec_move),(prim_dist, sec_dist)))
    log.debug('Assembled target_dist_list:  %s',target_dist_list)
    return target_dist_list


# find the optimal joint move from current to target positions in the list
# for this we look at the primary joint move only
# orient_mode is 0=shortest, 1=positive rotation only, 2=negative rotation only
# For orient_mode=(1,2): If no move can be found within joint limits we return None
def calc_optimal_joint_move(self, possible_prim_sec_angle_pairs):
    global orient_mode
    # this returns a list with all moves ((prim_move, sec_move),(prim_dist, sec_dist)) that
    # will result in correct tool orientation, stay within the rotary axis limits and respect the
    # orient_mode if set by the operator
    valid_joint_moves_and_distances = calc_angle_pairs_and_distances(self, possible_prim_sec_angle_pairs)
    # now we need to pick and return the (primary angle, secondary angle) that results in the
    # shortest move of the primary joint
    (theta_1, theta_2) = (None, None)
    dist = 3600
    for trgt_angles, dists in valid_joint_moves_and_distances:
        if orient_mode == 0 and fabs(dists[0]) < fabs(dist): # shortest move requested
            (theta_1, theta_2) = trgt_angles
            dist = dists[0]
        elif orient_mode == 1 and fabs(dists[0]) < fabs(dist) and dists[0] >= 0: # positive primary rotation only
            (theta_1, theta_2) = trgt_angles
            dist = dists[0]
        elif orient_mode == 2 and fabs(dists[0]) < fabs(dist) and dists[0] <= 0: # negative primary rotation only
            (theta_1, theta_2) = trgt_angles
            dist = dists[0]
    log.debug('Shortest move selected for (orient_mode, theta_1, theta_2):  %s', (orient_mode, theta_1, theta_2))
    return theta_1, theta_2


# calculates the required pre-rotation around tool-z so the tool-x matches the requested
# orientation after rotation of the spindle joints
def kins_calc_pre_rot(self, theta_1, theta_2, tool_x_req, tool_z_requested):
    # tolerance setting for check if tool-x-vector needs to be rotated at all
    epsilon = 0.00000001
    log.info("Tool-x-requested: %s", tool_x_req)
    # we need to calculate the current tool-x vector with the given rotations using
    # the transformation matrix from our custom tool kinematic
    log.debug("joint angles (secondary, primary) in radians given: %s", (theta_2, theta_1))
    log.debug("joint angles (secondary, primary) in degrees given: %s", (theta_2*180/pi, theta_1*180/pi))
    # run the identity matrix through the tool kinematic transformation in the requested direction
    # using the given joint angles and pre-rotation zero
    matrix_in = np.asmatrix(np.identity(4))
    t_out = kins_tool_transformation(theta_1, theta_2, 0, matrix_in,'inv')
    # the tool-x vector for the given machine joint rotations is found directly in the first column
    tool_x_is = [t_out[0,0], t_out[1,0], t_out[2,0]]
    log.debug("tool-x after machine rotation would be: %s", tool_x_is)
    # we calculate the angular difference between the two vectors so we can 'pre-rotate'
    # around tool-z to get the requested tool-x vector after machine rotation
    # just to be sure we normalize the two vectors
    tool_x_is = tool_x_is / np.linalg.norm(tool_x_is)
    tool_x_req = tool_x_req / np.linalg.norm(tool_x_req)
    # check if the x-vector is already in the required orientation (ie parallel)
    log.debug("check if vectors are parallel: %s",  np.dot(tool_x_is,tool_x_req))
    if np.dot(tool_x_is,tool_x_req) >  1 - epsilon:
        log.info("Tool x-vector already oriented, setting pre-rotation = 0")
        # if we are already parallel then we don't need to pre-rotate
        pre_rot = 0
    else:
        # we can use the cross product to determine the direction we need to rotate
        cross = np.cross(tool_x_req, tool_x_is)
        log.debug("cross product (tool_x_req, tool_x_is): %s", cross)
        log.info("Tool_z_requested: %s", tool_z_requested)
        pre_rot =  np.arccos(np.dot(tool_x_req, tool_x_is))
        log.debug('base pre_rot: %s', pre_rot)
        # To find out which quadrant we need the angle to be in we create a list of them all
        pre_rot_list = [pre_rot, -pre_rot, 2*pi-pre_rot, -(2*pi-pre_rot)]
        log.debug('pre_rot_list: %s',pre_rot_list)
        # then we run all of them through the kinematic model and see which gives us
        # the requested tool-x-vector
        for pre_rot in pre_rot_list:
            zeta = 0.0001
            # run the identity matrix through the tool kinematic transformation in the requested direction
            # using the given joint angles and pre-rotation angle in the list
            matrix_in = np.asmatrix(np.identity(4))
            t_out = kins_tool_transformation(theta_1, theta_2, pre_rot, matrix_in,'inv')
            # the tool-x vector for the given primary and secondary rotations is found directly in the first column
            tool_x_would_be = [t_out[0,0], t_out[1,0], t_out[2,0]]
            log.debug('tool_x_would_be: %s', tool_x_would_be)
            # calculate the difference of the respective elements
            tool_x_diff = tool_x_req - tool_x_would_be
            # and check if all elements are within [-epsilon,epsilon]
            match = np.all((tool_x_diff > -zeta) & (tool_x_diff < zeta))
            log.debug('Is the tool-X-vector close enough ? %s', match)
            if match:
                # if we have a match we leave the loop and use this angle
                break
        log.info("Pre-rotation calculated [deg]: %s", degrees(pre_rot))
    # return pre_rot in radians
    return pre_rot


# transforms a 4x4 input matrix using the current tool transformation matrix
# (forward or inverse) using the kinematic model of the machine
def kins_calc_tool_transformation(self, matrix_in, theta_1=None, theta_2=None, pre_rot=None, direction='fwd'):
    global kins_pre_rotation
    # if no angle values have been passed we get the current joint positions
    if theta_2 == None or theta_1 == None:
        # read current spindle rotary angles and convert to radians
        theta_1, theta_2 = get_current_rotary_positions(self)
    else:
        log.debug("got for secondary joint: %s", theta_2)
        log.debug("got for primary joint: %s", theta_1)
    # pre-rot is the virtual rotary axis around the tool-z axis to align the tool-x axis
    # if no pre-rot angle is passed then we use the currently active value
    if pre_rot == None:
        pre_rot = _get_pre_rot()  # LCNC-SUITE: live pin under task, preview mirror otherwise
        log.debug("current pre-rot: %s", pre_rot)
    else:
        log.debug("requested pre-rot value [DEG]): %s", degrees(pre_rot))
    # run the input matrix through the tool kinematic transformation in the requested direction
    # using the current joint angles and pre-rotation as requested
    matrix_out = kins_tool_transformation(theta_1, theta_2, pre_rot, matrix_in, direction)
    return matrix_out


# define the basic rotation matrices, used for euler twp modes
def Rx(th):
   return np.array([[1, 0      ,  0      ],
                    [0, cos(th), -sin(th)],
                    [0, sin(th),  cos(th)]])

def Ry(th):
   return np.array([[ cos(th), 0, sin(th)],
                    [ 0      , 1, 0      ],
                    [-sin(th), 0, cos(th)]])

def Rz(th):
   return np.array([[cos(th), -sin(th), 0],
                    [sin(th),  cos(th), 0],
                    [0      ,  0      , 1]])


# returns the rotation matrices for given order and angles
def twp_calc_euler_rot_matrix(th1, th2, th3, order):
    log.debug("euler order requested: %s", order)
    log.debug("angles given (th1, th2 , th3): %s", (th1, th2, th3))
    th1 = radians(th1)
    th2 = radians(th2)
    th3 = radians(th3)
    if order == '131':
        matrix = np.dot(np.dot(Rx(th1), Rz(th2)), Rx(th3))
    elif order=='121':
        matrix = np.dot(np.dot(Rx(th1), Ry(th2)), Rx(th3))
    elif order=='212':
        matrix = np.dot(np.dot(Ry(th1), Rx(th2)), Ry(th3))
    elif order=='232':
        matrix = np.dot(np.dot(Ry(th1), Rz(th2)), Ry(th3))
    elif order=='323':
        matrix = np.dot(np.dot(Rz(th1), Ry(th2)), Rz(th3))
    elif order=='313':
        matrix = np.dot(np.dot(Rz(th1), Rx(th2)), Rz(th3))
    elif order=='123':
        matrix = np.dot(np.dot(Rx(th1), Ry(th2)), Rz(th3))
    elif order=='132':
        matrix = np.dot(np.dot(Rx(th1), Rz(th2)), Ry(th3))
    elif order=='213':
        matrix = np.dot(np.dot(Ry(th1), Rx(th2)), Rz(th3))
    elif order=='231':
        matrix = np.dot(np.dot(Ry(th1), Rz(th2)), Rx(th3))
    elif order=='321':
        matrix = np.dot(np.dot(Rz(th1), Ry(th2)), Rx(th3))
    elif order=='312':
        matrix = np.dot(np.dot(Rz(th1), Rx(th2)), Ry(th3))
    log.debug('euler rotation as matrix: \n %s', matrix)
    return matrix


# The tilted-work-plane is created in identity mode and must NOT be updated after a switch
def gui_update_twp(self):
    global twp_matrix, saved_work_offset, twp_pose_a
    # LCNC-SUITE: the twp-helper pins are display-only (vismach) - a
    # preview interpreter has no HAL and nothing to display
    if self.task == 0:
        return
    # LCNC-SUITE: TABLE-FRAME. twp_matrix is stored relative to the A table
    # (datum'd to coincide with machine coords at A=0), and the viewer draws
    # these numbers inside the a_work group — which IS that frame. Publishing
    # table coordinates is therefore what makes the overlay correct at every
    # table angle instead of only at A=0. (Upstream's own vismach comment
    # below describes drawing the plane inside the rotating table too, so the
    # A-double-count this avoids is latent upstream as well.)
    # twp origin as a vector from the work-offset to the origin of the twp
    hal.set_p("twp-helper-comp.twp-ox-in",str(twp_matrix[0,3]))
    hal.set_p("twp-helper-comp.twp-oy-in",str(twp_matrix[1,3]))
    hal.set_p("twp-helper-comp.twp-oz-in",str(twp_matrix[2,3]))
    # twp x-vector
    hal.set_p("twp-helper-comp.twp-xx-in",str(twp_matrix[0,0]))
    hal.set_p("twp-helper-comp.twp-xy-in",str(twp_matrix[1,0]))
    hal.set_p("twp-helper-comp.twp-xz-in",str(twp_matrix[2,0]))
    # twp z-vector
    hal.set_p("twp-helper-comp.twp-zx-in",str(twp_matrix[0,2]))
    hal.set_p("twp-helper-comp.twp-zy-in",str(twp_matrix[1,2]))
    hal.set_p("twp-helper-comp.twp-zz-in",str(twp_matrix[2,2]))
    # publish the twp offset coordinates in world coordinates (ie identity)
    [work_offset_x, work_offset_y, work_offset_z] = saved_work_offset
    log.debug("Setting work_offsets in the simulation: %s", (work_offset_x, work_offset_y, work_offset_z))
    # this is used to translate the rotated twp to the correct position
    # care must be taken that only the work_offsets in identity mode are sent as that is
    # what the model uses. The visuals for the offsets are created then rotated according to
    # the rotary joint position and then translated.
    # The twp has to be rotated out of the machine xy plane using the g68.2 parameters and is then
    # translated by the offset values of the identity mode.
    hal.set_p("twp-helper-comp.twp-ox-world-in",str(work_offset_x))
    hal.set_p("twp-helper-comp.twp-oy-world-in",str(work_offset_y))
    hal.set_p("twp-helper-comp.twp-oz-world-in",str(work_offset_z))
    # LCNC-SUITE: the machine-frame A the HEAD was last oriented at, or the
    # sentinel when no orient has happened. The PLANE rides the workpiece and
    # cannot go stale; what goes stale is the tool being normal to it.
    hal.set_p("twp-helper-comp.twp-pose-a-in",
              str(twp_pose_a if twp_pose_a is not None else TWP_POSE_NONE))


# NOTE: Due to easier abort handling we currently restrict the use of twp to G54
# as LinuxCNC seems to revert to G54 as the default system
#
# LCNC-SUITE (W1): the active work offset is read as a TABLE-FRAME point, so
# it has to be converted through the table angle it was touched off at — see
# to_storage_frame(). This USED to be a standing precondition ("touch off
# with A at 0") stated in three places and checkable in none, because
# LinuxCNC records no touch-off pose. The gateway now records one, so touch
# off at any table angle. An offset with no record still assumes A=0, which
# is the old rule and the correct fallback: it is what every existing var
# file means.
def get_current_work_offset(self):
    # get which offset is active (g54=1 .. g59.3=9)
    active_offset = int(self.params[5220])
    current_work_offset_number = active_offset
    # set the relevant parameter numbers that hold the active offset values
    # (G54_x: #5221, G55_x:#[5221+20], G56_x:#[5221+40] ....)
    work_offset_x = (active_offset-1)*20 + 5221
    work_offset_y = work_offset_x + 1
    work_offset_z = work_offset_x + 2
    co_x = self.params[work_offset_x]
    co_y = self.params[work_offset_y]
    co_z = self.params[work_offset_z]
    current_work_offset = [co_x, co_y, co_z]
    return [current_work_offset_number, current_work_offset]


def get_current_rotary_positions(self):
    """MACHINE-frame primary/secondary joint angles, radians.

    LCNC-SUITE: *_current is PROGRAM coordinates. Upstream returned it raw,
    so a B/C work offset in the active fixture skewed the shortest-move
    branch selection (and, through kins_calc_tool_transformation's
    theta=None path, the tool frame itself). Add the active offsets back,
    exactly as get_machine_a does for A.
    """
    global joint_letter_primary, joint_letter_secondary
    cur = {"A": self.AA_current, "B": self.BB_current, "C": self.CC_current}
    theta_1 = radians(float(cur[joint_letter_primary])
                      + _rotary_work_offset(self, joint_letter_primary))
    log.debug('Current position Primary joint: %s', degrees(theta_1))
    theta_2 = radians(float(cur[joint_letter_secondary])
                      + _rotary_work_offset(self, joint_letter_secondary))
    log.debug('Current position Secondary joint: %s', degrees(theta_2))
    return theta_1, theta_2


# forms a 4x4 transformation matrix from a given 1x3 point vector [x,y,z]
def point_to_matrix(point):
    # start with a 4x4 identity matrix and add the point vector to the 4th column
    matrix = np.identity(4)
    [matrix[0,3], matrix[1,3], matrix[2,3]] = point
    matrix = np.asmatrix(matrix)
    return matrix


# extracts the point vector form a given 4x4 transformation matrix
def matrix_to_point(matrix):
    point = (matrix[0,3],matrix[1,3],matrix[2,3])
    return point


def reset_twp_params(self):
    global pre_rot, twp_matrix, twp_flag, twp_build_params
    global twp_pose_a
    pre_rot = 0
    # LCNC-SUITE: the plane is gone, so is the head solve it was oriented by
    twp_pose_a = None
    # we must not change tool kins parameters when TOOL kins are active or we get sudden joint position changes
    # ie don't do this: kins_comp_set_pre_rot(self,0)!
    twp_flag = []
    twp_build_params = {}
    log.info("Resetting TWP-matrix")
    twp_matrix = np.asmatrix(np.identity(4))

# Orient the tool to the current twp (with TCP for G53.1 or IDENTITY for G53.6)
# (some controllers offer an optional P-word to give preferred rotation directions this is not implemented yet)
# Note: To avoid that this python code is run prematurely by the read ahead we need a quebuster at the beginning but
# because we need self.execute() to switch the WCS properly this remap needs to be called from
# an ngc reamp that contains a quebuster before calling this code
# IMPORTANT:
# The correct kinematic mode (ie TCP for 53.1 / IDENTITY for G53.6) must be active when this code is called
# (ie do it in the ngc remap mentioned above!)
def g53x_core(self):
    global saved_work_offset, twp_matrix, twp_flag, pre_rot
    global twp_pose_a  # LCNC-SUITE: head-solve pose
    global joint_letter_primary, joint_letter_secondary
    global orient_mode, _task_mode, _preview_twp_state, _preview_pre_rot
    # LCNC-SUITE: upstream returned here for the preview interpreter; the
    # fork runs the same math in preview and emits the frame/kins markers.
    # HAL state checks stay task-only; the preview mirrors them in module
    # state (see the LCNC-SUITE block up top).
    _task_mode = (self.task != 0)
    if not _task_mode and _preview_twp_state < 1:
        # No G68.2/.3 seen in this preview pass: nothing to orient to.
        # Task mode errors on this program anyway - the preview declines
        # to guess rather than emitting a frame from an identity matrix.
        print("LCNC-SUITE preview: G53.x without a defined TWP - "
              "no markers emitted", file=sys.stderr, flush=True)
        yield INTERP_EXECUTE_FINISH
        return INTERP_OK

    # LCNC-SUITE: Q1 = RE-ORIENT. The plane is stored table-relative, so it
    # rides the workpiece and never goes stale — but the head solve does:
    # orient at A=0, jog the table to A=35, and the tool points 35 deg off the
    # face normal, with nothing upstream able to recover short of re-running
    # the program. Q1 re-solves the head at the CURRENT table pose. That is
    # the same work this function already does for a first orient; the ONLY
    # difference is that "TWP already active" is the normal entry state here
    # rather than an error.
    #
    # It is a word on M530 and not a HAL demote (M68 E2 Q1, then G53.x) on
    # purpose. twp-status is an INPUT pin that twp-helper-comp polls to derive
    # twp-is-active, so a demote reaches the guard about a millisecond late —
    # harmless when an operator types two MDI lines seconds apart, a coin flip
    # when a subroutine runs them back to back. Interpreter-side there is no
    # race to lose. Read below the preview return: this is a task-mode
    # concept, and the preview branch deliberately touches no block words.
    _reorient = False
    _adopt = False
    if _task_mode:
        _c = self.blocks[self.remap_level]
        _reorient = bool(_c.q_flag) and int(_c.q_number) == 1
        # LCNC-SUITE: Q2 = ADOPT the current head pose (the Capture-plane
        # path). The plane was just built FROM the live rotaries (G68.3), so
        # the current pose IS a solution — but calc_optimal_joint_move may
        # legitimately pick the OTHER (B,C) branch (observed live: capture
        # at B20 C-15 solved to B-20 C-183.45 — a 168 deg swing with the
        # tip touching the part). Q2 verifies the current pose is normal to
        # the plane and uses it verbatim: a zero-length orient by
        # construction, loud refusal if the head is NOT actually normal.
        _adopt = bool(_c.q_flag) and int(_c.q_number) == 2

    if _task_mode and not hal.get_value(twp_is_defined):
         # reset the twp parameters
        reset_twp_params(self)
        msg = "G53.x: No TWP defined."
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    elif _task_mode and hal.get_value(twp_is_active) and not _reorient:
        # LCNC-SUITE: upstream calls reset_twp_params(self) here. We do NOT.
        # "TWP already active" is an operator/program SEQUENCING mistake, not
        # a corrupt plane — and reset_twp_params wipes twp_matrix to identity
        # (pre_rot, pose stamp and build params with it; it does NOT touch
        # saved_work_offset). So a stray G53.x (a re-run of the orient block,
        # a fat-fingered MDI line) silently DESTROYED a plane that was
        # perfectly good, on a path whose whole job is to refuse. Refusing is
        # right; taking the plane down with it is not. The abort below still
        # stops the program, so nothing runs on a stale state.
        #
        # The status pin IS demoted to 'defined' (1) first: the ngc wrapper
        # already dropped kins to identity (M68 E3 Q0) before M530, so
        # leaving twp-status at 2 would claim ACTIVE on identity kins — a
        # lie the UI chip would repeat. Status 1 + intact plane means a
        # retry (plain G53.x) simply works.
        self.execute("M68 E2 Q1")
        yield INTERP_EXECUTE_FINISH  # drain: the demote must land before the abort flushes the queue
        msg = "G53.x: TWP already active"
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # Check if any words have been passed with the respective G53.x command
    c = self.blocks[self.remap_level]
    p = c.p_number if c.p_flag else 0
    x = c.i_number if c.i_flag else None
    y = c.j_number if c.j_flag else None
    z = c.k_number if c.k_flag else None
    log.debug('G53.x Words passed: (P, X,Y,Z): %s', (p,x,y,z))
    if p not in [0,1,2]:
        # LCNC-SUITE: upstream reset_twp_params here — a typo'd P word must
        # not destroy a valid plane. Refuse loudly, preserve all state; the
        # corrected command then works. (P validation lives ONLY here: both
        # G53.x and M531 funnel through M530.)
        msg = "G53.x : unrecognised P-Word found."
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    orient_mode = p

    # ---- LCNC-SUITE: rotary offsets vs the orient move (2026-08-30) --------
    # The head move below is issued in MACHINE coordinates (G53), so a work
    # offset on B/C cannot displace it any more - but a G92 rotary offset
    # applies in every fixture and no fixture write can repair it: refuse.
    # G59..G59.3's A/B/C/R rows are cleared by the writes below (they are
    # ours); when they held anything the operator is told, never silently.
    _dirty_rows = {}
    if _task_mode:
        if _g92_rotary_nonzero(self):
            msg = ("G53.x: a G92 rotary offset (A/B/C) is in effect - it would"
                   " displace the orient move in every fixture. G92.1 first.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH
            yield INTERP_EXIT
            return INTERP_ERROR
        _dirty_rows = reserved_rows_dirty(self)

    # ---- LCNC-SUITE: map the stored plane TABLE -> MACHINE ------------------
    # twp_matrix is stored in the TABLE frame: the frame in which a
    # table-fixed feature has constant coordinates, datum'd so that it
    # coincides with the machine frame at A = 0. A is a WORK-side rotary
    # here, so a plane stored that way RIDES THE WORKPIECE — it can never go
    # stale, and no definition pose has to be remembered.
    #
    # To orient the head we need the plane where it physically IS right now,
    # so the stored frame is mapped through the LIVE table angle. Below the
    # threshold this is skipped outright, so an A=0 program emits byte-
    # identical G59 rows and the goldens/corpus are untouched.
    #
    # twp_matrix itself is never modified: G68.4 composes onto it (in the
    # plane's own frame, so frame-agnostic) and the helper publishes it for
    # the viewer, whose work group IS the table frame — which is what makes
    # the overlay correct at every A rather than only at A = 0.
    machine_a_now = get_machine_a(self)
    d_a = machine_a_now
    compose_a = abs(d_a) > 1e-4
    tool_z_requested = [twp_matrix[0,2],twp_matrix[1,2],twp_matrix[2,2]]
    tool_x_requested = [twp_matrix[0,0],twp_matrix[1,0],twp_matrix[2,0]]
    twp_offset = (twp_matrix[0,3],twp_matrix[1,3],twp_matrix[2,3])
    origin_composed = None
    if compose_a:
        y_rot_axis, z_rot_axis = _get_rot_axis_yz()
        origin_table = [saved_work_offset[i] + twp_offset[i] for i in range(3)]
        tool_z_requested, tool_x_requested, origin_composed = from_table_frame(
            tool_z_requested, tool_x_requested, origin_table,
            d_a, y_rot_axis, z_rot_axis)
        tool_z_requested = list(tool_z_requested)
        tool_x_requested = list(tool_x_requested)
        log.info("G53.x: table at A=%.6f deg - plane mapped table->machine:"
                 " z=%s x=%s origin=%s",
                 d_a, tool_z_requested, tool_x_requested, origin_composed)
    # LCNC-SUITE: the pose stamp (twp_pose_a = machine_a_now) is written at
    # the END of this function, after the queued moves and the ACTIVE promote
    # have completed — stamping here published "oriented at the current A"
    # before the head ever moved, so an abort mid-orient left the UI claiming
    # a fresh solve that never happened.
    # ---- end LCNC-SUITE table->machine map ---------------------------------

    # ---- LCNC-SUITE: Q2 adopt-current-pose (Capture plane) ------------------
    if _adopt:
        _prim_now, _sec_now = get_current_rotary_positions(self)  # radians
        _t = kins_tool_transformation(_prim_now, _sec_now, 0,
                                      np.asmatrix(np.identity(4)), 'inv')
        _z_now = np.array([_t[0, 2], _t[1, 2], _t[2, 2]])
        _z_req = np.array(tool_z_requested, dtype=float)
        _z_req = _z_req / np.linalg.norm(_z_req)
        # same element-wise tolerance kins_calc_jnt_angles uses for a match
        if not np.all(np.abs(_z_req - _z_now) < 1e-4):
            msg = ("G53.x: Q2 (adopt pose) refused - the current head pose is "
                   "not normal to the plane. Use Orient (G53.1) instead.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH
            yield INTERP_EXIT
            return INTERP_ERROR
        theta_1, theta_2 = _prim_now, _sec_now
    # ---- end LCNC-SUITE Q2 --------------------------------------------------

    # calculate the required rotary joint positions and pre_rotation for the requested tool-orientation
    try:
        # calculate all possible pairs of (primary, secondary) angles so our tool-z vector matches the requested tool-z
        # angles are returned in [-pi,pi] (LCNC-SUITE: skipped under Q2 —
        # the verified current pose IS the solution)
        possible_prim_sec_angle_pairs = ([] if _adopt else
                                         kins_calc_jnt_angles(self, tool_z_requested))
    # An excepton will occur if the requested tool orientation cannot be achieved with the kinematic at hand
    except Exception as error:
        log.error('G53.x: Calculation failed, %s', error)
        possible_prim_sec_angle_pairs = []
    if not _adopt and not possible_prim_sec_angle_pairs:
        # LCNC-SUITE: upstream reset_twp_params here. The plane is NOT the
        # problem — the head cannot reach it AT THIS TABLE POSE. Wiping it
        # while twp-status stays defined/active left the next G53.x to
        # silently orient against an identity matrix (and a failed RE-ORIENT
        # to "succeed" on retry against zeros). Preserve the plane; the
        # abort stops the program, and a retry after moving the table back
        # into reach works against the real definition.
        msg = "G53.x ERROR: Requested tool orientation not reachable -> aborting G53.x"
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # this returns one pair of optimized angles in degrees, or (None, None) if no solution could be found
    if not _adopt:
        theta_1, theta_2 = calc_optimal_joint_move(self, possible_prim_sec_angle_pairs)
    if not _adopt and theta_1 == None:
        # LCNC-SUITE: no reset — same rationale as the branch above (the
        # plane is valid, the pose is the problem; preserve it for retry).
        msg = ("G53.x ERROR: Requested tool orientation not reachable -> aborting G53.x")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    if not _adopt:  # LCNC-SUITE: Q2's adopted angles are already radians
        theta_1 = radians(theta_1)
        theta_2 = radians(theta_2)
    # calculate the pre-rotation needed so our tool-x vector matches the
    # requested tool-x vector (LCNC-SUITE: table-composed above)
    pre_rot = kins_calc_pre_rot(self,theta_1, theta_2, tool_x_requested, tool_z_requested)
    log.debug("Calculated pre-rotation (pre_rot) to match requested tool-x): %s", pre_rot)
    # mark twp-flag as active
    twp_flag = [0, 'active']
    gui_update_twp(self)
    # set the pre-rotation value in the kinematic component
    log.debug("G53.x: setting primary, secondary and pre_rotation angles in kinematic component: %s", (degrees(theta_1), degrees(theta_2), degrees(pre_rot)))
    if _task_mode:
        hal.set_p(kins_pre_rotation, str(pre_rot))
        hal.set_p(kins_primary_rotation, str(degrees(theta_1)))
        hal.set_p(kins_secondary_rotation, str(degrees(theta_2)))
    else:
        _preview_pre_rot = pre_rot  # LCNC-SUITE: mirror of the pre-rot pin
    # LCNC-SUITE: announce the TOOL-kins plane frame on the execution-
    # ordered comment channel (webui preview markers; a comment is silent
    # in task). Values/units are exactly the three set_p writes above:
    # pre-rot RADIANS, primary/secondary DEGREES.
    self.execute("(WEBUI_TWPFRAME=%.9f,%.9f,%.9f)"
                 % (pre_rot, degrees(theta_1), degrees(theta_2)))

    if origin_composed is None:
        # calculate the work offset in tool-coords
        P = matrix_to_point(kins_calc_tool_transformation(self, point_to_matrix(saved_work_offset), theta_1, theta_2, pre_rot))
        # calculate the twp offset in tool-coords
        Q = matrix_to_point(kins_calc_tool_transformation(self, point_to_matrix(twp_offset), theta_1, theta_2, pre_rot))
        O = (P[0]+Q[0], P[1]+Q[1], P[2]+Q[2])
    else:
        # LCNC-SUITE: the table-composed origin is already the SUM point
        # (work offset + twp origin) rotated about the table axis; the tool
        # transformation is a pure rotation, so transforming the sum once is
        # the same operation as upstream's transform-then-add.
        O = matrix_to_point(kins_calc_tool_transformation(self, point_to_matrix(list(origin_composed)), theta_1, theta_2, pre_rot))
    log.debug("G53.x: Setting transformed work-offsets for tool-kins in G59, G59.1, G59.2 and G59.3 to: %s ", O)
    # set the dedicated TWP work offset values (G53, G53.1, G53.2, G53.3)
    # LCNC-SUITE: the rows are written COMPLETELY - A/B/C/R zeroed. Upstream
    # wrote X/Y/Z only, so a foreign rotary offset in G59 (a touch-off made
    # under the Plane jog frame) survived every orient and shifted the G53.3
    # head move below, which runs inside G59.
    for _pn in (6, 7, 8, 9):
        self.execute("G10 L2 P%d X%f Y%f Z%f A0 B0 C0 R0 " % (_pn, O[0], O[1], O[2]), lineno())
    if _dirty_rows:
        _names = {6: "G59", 7: "G59.1", 8: "G59.2", 9: "G59.3"}
        _txt = " ".join("%s %s=%.4f" % (_names[n], l, v)
                        for (n, l), v in sorted(_dirty_rows.items()))
        log.warning("G53.x: cleared foreign rotary/rotation offsets from the reserved TWP fixtures: %s", _txt)
        self.execute("(MSG, G53.x: cleared foreign offsets from the reserved TWP fixtures - %s)" % _txt.replace("(", "").replace(")", ""))
    log.debug("G53.x: Moving (secondary and primary) joints to: %s", (degrees(theta_2), degrees(theta_1)))
    if (x,y,z) == (None,None,None):
        # Move rotary joints to align the tool with the requested twp.
        # LCNC-SUITE: G53 - the solution is MACHINE-frame angles; without it
        # the move was interpreted in the active fixture, and any rotary work
        # offset (G54 A/B/C rows are operator-writable) landed the head at
        # solution + offset ("parallel to the plane" from the operator's
        # side). The G53.3 path below stays a single simultaneous block: it
        # runs inside G59, whose rotary rows the writes above just zeroed.
        self.execute("G53 G0 %s%f %s%f" % (joint_letter_secondary, degrees(theta_2), joint_letter_primary, degrees(theta_1)), lineno())
    # switch to the dedicated TWP work offsets
    self.execute("G59", lineno())
    # activate TOOL kinematics
    self.execute("M68 E3 Q2")
    # LCNC-SUITE: the component that performs the switch announces it
    self.execute("(WEBUI_KINSTYPE=2)")
    # LCNC-SUITE: interpreter-side mirror of the switch for wrappers that
    # must SAVE and RESTORE the type where no HAL pin exists (the preview
    # parse) — see remap_subs/m600.ngc.
    self.execute("#<_webui_kinstype> = 2")
    if (x,y,z) != (None,None,None):
        log.debug('G53.3 called')
        self.execute("G0 X%s Y%s Z%s %s%f %s%f" % (x, y, z, joint_letter_secondary, degrees(theta_2), joint_letter_primary, degrees(theta_1)), lineno())
    # set twp-state to 'active' (2)
    self.execute("M68 E2 Q2")
    if not _task_mode:
        _preview_twp_state = 2  # LCNC-SUITE: preview mirror of twp-status
    yield INTERP_EXECUTE_FINISH
    # LCNC-SUITE: stamp the head-solve pose only NOW — the queued rotary
    # moves and the ACTIVE promote have completed (same post-yield HAL-only
    # shape as g683's trailing gui_update_twp). An abort anywhere above never
    # resumes this generator, so the pose pin keeps its previous value (or
    # the sentinel) and the UI honestly reports the solve as stale instead
    # of claiming an orient that never finished.
    twp_pose_a = machine_a_now
    gui_update_twp(self)
    return INTERP_OK


# Cancel an active TWP definition and reset the parameters to zero
# Note: To avoid that this python code is run prematurely by the read ahead we need a quebuster at the beginning but
# because we need self.execute() to switch the WCS properly this remap needs to be called from
# an ngc that contains a quebuster before calling this code
def twp_touchoff(self, **words):
    """M535 P<mask> I<x> J<y> K<z> - Plane-mode touch-off (LCNC-SUITE original).

    Set the WORKPIECE datum (G54) from a point touched in the tilted plane.
    Called through o<twp_touchoff> (which drains the queue first, so the
    interpreter's current position is current) by the gateway's `touchoff`
    command when the Plane jog frame is active. Semantics per selected axis
    are G10 L20's in the plane frame the DRO shows: make the current position
    read the given value. The datum is written where it lives:

        G59' = G59 + current_program - v            (plane-frame origin, per axis)
        M'   = R_tool^-1 . G59'                      (machine frame; g53x_core
                                                      built G59 = R_tool . origin)
        T'   = to_table_frame(M', live A)            (table frame - where the
                                                      table IS, stale head or not)
        G54' = T' - twp_offset                       (the plane's own origin vector)

    G54 gets G54', G59..G59.3 get G59' (so the DRO reads v at once), and the
    next Orient recomputes G59 from G54' + twp_offset = G59' - the round trip
    the live check pins. The G54 provenance rows are stamped kins 0 / A 0:
    G54' IS a table-frame point (to_storage_frame's identity path). Nothing
    moves. Bits of P: 1 = X, 2 = Y, 4 = Z; IJK carry the values because an
    M-code line cannot carry axis words.
    """
    global saved_work_offset, twp_matrix, _task_mode
    _task_mode = (self.task != 0)
    if not _task_mode:
        print("LCNC-SUITE preview: M535 (Plane touch-off) is an operator action"
              " - ignored in preview", file=sys.stderr, flush=True)
        yield INTERP_EXECUTE_FINISH
        return INTERP_OK
    mask = int(round(float(words.get('p', 0))))
    given = [l for l, bit in (('X', 1), ('Y', 2), ('Z', 4)) if mask & bit]
    vals = {'X': float(words.get('i', 0.0)), 'Y': float(words.get('j', 0.0)),
            'Z': float(words.get('k', 0.0))}
    err = None
    if not given:
        err = "M535: no axis selected (P mask 1=X 2=Y 4=Z)"
    elif not hal.get_value(twp_is_active):
        err = "Plane touch-off needs an ACTIVE plane - Orient first (G53.x)"
    elif _active_fixture_index(self.params) != 6:
        err = ("Plane touch-off expects G59 (the plane fixture) active - got"
               " fixture index %d" % _active_fixture_index(self.params))
    else:
        try:
            _metric = float(self.params["_metric"])
        except Exception:  # noqa: BLE001 - an interp without named-param access
            _metric = 1.0
        if not _metric:
            err = "Plane touch-off needs G21 (the TWP stack is metric-only)"
        elif float(self.params[G92_FLAG_PARAM]) and any(
                abs(float(self.params[G92_PARAMS[l]])) > 1e-6 for l in "XYZ"):
            err = "Plane touch-off with a G92 X/Y/Z offset in effect - G92.1 first"
        elif reserved_rows_dirty(self):
            err = ("The reserved TWP fixtures carry rotary/rotation offsets -"
                   " Orient first (it clears them)")
    if err is not None:
        log.debug(err)
        emccanon.CANON_ERROR(err)
        yield INTERP_EXECUTE_FINISH
        yield INTERP_EXIT
        return INTERP_ERROR

    row = wcs_row_params(6)
    g59 = [float(self.params[row[l]]) for l in "XYZ"]
    cur = {'X': float(self.current_x), 'Y': float(self.current_y), 'Z': float(self.current_z)}
    new59 = list(g59)
    for i, l in enumerate("XYZ"):
        if l in given:
            new59[i] = g59[i] + cur[l] - vals[l]
    # The frame the kins is USING: the pins g53x_core set_p'd (pre-rot
    # radians, the two angles degrees - upstream's asymmetry).
    th1 = radians(float(hal.get_value(kins_primary_rotation)))
    th2 = radians(float(hal.get_value(kins_secondary_rotation)))
    pr = float(hal.get_value(kins_pre_rotation))
    M = matrix_to_point(kins_calc_tool_transformation(
        self, point_to_matrix(list(new59)), th1, th2, pr, 'inv'))
    a_now = get_machine_a(self)
    if abs(a_now) > 1e-4:
        y_rot_axis, z_rot_axis = _get_rot_axis_yz()
        T = list(to_table_frame((0.0, 0.0, 1.0), (1.0, 0.0, 0.0), list(M),
                                a_now, y_rot_axis, z_rot_axis)[2])
    else:
        T = list(M)
    twp_offset = (twp_matrix[0, 3], twp_matrix[1, 3], twp_matrix[2, 3])
    g54 = [float(T[i]) - float(twp_offset[i]) for i in range(3)]
    log.info("M535: plane touch-off %s -> G59' %s, machine %s, table %s (A=%.4f),"
             " G54' %s", {l: vals[l] for l in given}, new59, list(M), T, a_now, g54)
    self.execute("G10 L2 P1 X%f Y%f Z%f" % (g54[0], g54[1], g54[2]), lineno())
    for _pn in (6, 7, 8, 9):
        self.execute("G10 L2 P%d X%f Y%f Z%f A0 B0 C0 R0" % (_pn, new59[0], new59[1], new59[2]), lineno())
    saved_work_offset = [g54[0], g54[1], g54[2]]
    # Provenance: a table-frame datum, stamped as such (kins 0, A 0). Flag
    # LAST so a partial record reads as absent.
    prov = prov_params(1)
    self.params[prov["stamped"]] = 0.0
    self.params[prov["kins"]] = 0.0
    self.params[prov["a"]] = 0.0
    self.params[prov["x"]] = g54[0]
    self.params[prov["y"]] = g54[1]
    self.params[prov["z"]] = g54[2]
    self.params[prov["stamped"]] = PROV_STAMPED
    gui_update_twp(self)
    yield INTERP_EXECUTE_FINISH
    return INTERP_OK


def g69_core(self):
    global twp_flag, saved_work_offset_number, saved_work_offset
    global _task_mode, _preview_twp_state, _preview_pre_rot
    # LCNC-SUITE: runs in preview too - resets the preview TWP mirrors so
    # a following G68.2 starts clean (the type-0 kins marker is emitted by
    # the g69remap.ngc wrapper, right at its M68 E3 Q0)
    _task_mode = (self.task != 0)
    log.info('G69 called')
    # reset the twp parameters
    reset_twp_params(self)
    gui_update_twp(self)
    # set twp-state to 'undefined' (0)
    self.execute("M68 E2 Q0")
    if not _task_mode:
        _preview_twp_state = 0
        _preview_pre_rot = 0.0
    yield INTERP_EXECUTE_FINISH
    return INTERP_OK


# define a virtual tilted-work-plane (twp) that is perpendicular to the current
# tool-orientation
def g683(self, **words):
    global twp_matrix, pre_rot, twp_flag, saved_work_offset_number, saved_work_offset
    global twp_pose_a  # LCNC-SUITE: head-solve pose
    global _task_mode, _preview_twp_state

    # LCNC-SUITE: preview runs the full plane math too (pure numpy +
    # interp params); only the HAL state check stays task-only. A stale
    # "already defined" preview mirror must not hard-error (foreign
    # previews never call webui_preview_reset) - preview overwrites.
    _task_mode = (self.task != 0)

    # ! IMPORTANT !
    #  We need to use 'yield INTERP_EXECUTE_FINISH' here to stop the read ahead
    # and avoid it executing the rest of the remap ahead of time
    ## NOTE: No 'self.execute(..)' command can be used after 'yield INTERP_EXECUTE_FINISH'
    yield INTERP_EXECUTE_FINISH

    if  _task_mode and hal.get_value(twp_is_defined):
         # reset the twp parameters
        reset_twp_params(self)
        msg =("G68.3 ERROR: TWP already defined.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # NOTE: Due to easier abort handling we currently restrict the use of twp to G54
    # as LinuxCNC seems to revert to G54 as the default system
    # get which offset is active (g54=1 .. g59.3=9)
    (n, offsets) = get_current_work_offset(self)
    if n != 1:
         # reset the twp parameters
        reset_twp_params(self)
        msg = "G68.3 ERROR: Must be in G54 to define TWP."
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # LCNC-SUITE: see the identical guard in g682 - machine-frame table capture
    if rotary_offsets_nonzero(self):
        reset_twp_params(self)
        msg = ("G68.3 ERROR: a rotary (A/B/C) work or G92 offset is in effect -"
               " it must be zero to define a TWP. Clear it (G10 L2 P1 A0 B0 C0"
               " / G92.1) and define again.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH
        yield INTERP_EXIT
        return INTERP_ERROR

    c = self.blocks[self.remap_level]
    # parse the requested origin
    x = c.x_number if c.x_flag else 0
    y = c.y_number if c.y_flag else 0
    z = c.z_number if c.z_flag else 0
    # parse the requested rotation of tool-x around the origin
    r = c.r_number if c.r_flag else 0

    twp_flag = [0, 1, 'empty'] # one call to define the twp in this mode
    theta_1, theta_2 = get_current_rotary_positions(self)
    # calculate tool-prerotation necessary to have tool-x vector in machine xy-plane
    pre_rot = kins_calc_tool_rot_c_for_horizontal_x(self, theta_1, theta_2 )
    log.info("G68.3: Pre-Rotation calculated for x-vector in machine-xy plane [deg]:  %s", pre_rot*180/pi)
    # then we need the tool transformation matrix of the current tool orientation with the
    # calculated pre-rotation to get the tool-x vector in the machine xy-plane
    # for this we take the 4x4 identity matrix and pass it through the inverse tool kinematic
    # transformation using the current rotary joint positions and calculated pre-rotation angle
    # plus the requested angle of rotation for tool-x from the machine-xy plane
    start_matrix = np.asmatrix(np.identity(4))
    log.info('G68.3: Requested origin rotation [deg]: %s', r)
    twp_matrix = kins_calc_tool_transformation(self, start_matrix, None, None, pre_rot +  radians(r), 'inv')
    log.debug("G68.3: Tool matrix with x-vector in machine xy-plane: \n%s", twp_matrix)
    # put the requested origin into the twp_matrix
    (twp_matrix[0,3], twp_matrix[1,3], twp_matrix[2,3]) = (x, y, z)
    # update the build state of the twp call
    twp_flag[2] = 'done'
    log.info("G68.3: Built twp-transformation-matrix: \n%s", twp_matrix)
    # collect the currently active work offset values (ie g54, g55 or other)
    # LCNC-SUITE (W1): see the note in g68.2 — same conversion, same reason.
    try:
        saved_work_offset, _a_touch, _prov = to_storage_frame(self, offsets, n)
    except TwpTouchoffKinsError as _e:
        reset_twp_params(self)
        msg = "G68.3 ERROR: %s" % _e
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH
        yield INTERP_EXIT
        return INTERP_ERROR
    saved_work_offset_number = n
    log.debug("G68.3: Saved work offsets: %s (touch-off A=%.6f, %s)",
              (n, saved_work_offset), _a_touch, _prov)
    # LCNC-SUITE: the table pose this definition is expressed in
    # LCNC-SUITE: g68.3 builds its matrix from the LIVE spindle rotaries, i.e.
    # a MACHINE-frame measurement — so unlike g68.2 (whose words are already
    # workpiece intent) it has to be converted into the storage frame. At
    # A = 0 this is the identity, so today's behaviour is byte-identical.
    _a_now = get_machine_a(self)
    if abs(_a_now) > 1e-4:
        _tz = to_table_frame_vector(
            [twp_matrix[0,2], twp_matrix[1,2], twp_matrix[2,2]], _a_now)
        _tx = to_table_frame_vector(
            [twp_matrix[0,0], twp_matrix[1,0], twp_matrix[2,0]], _a_now)
        # LCNC-SUITE: column 3 is a VECTOR (work offset -> twp origin, see
        # gui_update_twp and the sum in g53x_core), NOT a point — so every
        # converted quantity here is rotation-only and the pivot line never
        # enters. Pushing the vector through to_table_frame's POINT path
        # displaced the stored origin by (I - Rx(A))*pivot (~776 mm at A=20
        # with this config's pivot); the vector helper is the fix, and it
        # also drops the pivot-pin dependency from this path entirely.
        _to = to_table_frame_vector(
            [twp_matrix[0,3], twp_matrix[1,3], twp_matrix[2,3]], _a_now)
        _ty = np.cross(_tz, _tx)
        for _r in range(3):
            twp_matrix[_r,0] = _tx[_r]
            twp_matrix[_r,1] = _ty[_r]
            twp_matrix[_r,2] = _tz[_r]
            twp_matrix[_r,3] = _to[_r]
        log.info("G68.3: measured at A=%.6f, stored in the table frame", _a_now)
    # No head solve yet: staleness is a claim about the ORIENT, not the plane.
    twp_pose_a = None
    # set twp-state to 'defined' (1)
    self.execute("M68 E2 Q1")
    if not _task_mode:
        _preview_twp_state = 1  # LCNC-SUITE: preview mirror of twp-status
    yield INTERP_EXECUTE_FINISH

    gui_update_twp(self)
    return INTERP_OK


# definition of a virtual work-plane (twp) using different methods set by the 'p'-word
def g682(self, **words):
    global twp_matrix, pre_rot, twp_flag, twp_build_params, saved_work_offset_number, saved_work_offset
    global twp_pose_a  # LCNC-SUITE: head-solve pose
    global _task_mode, _preview_twp_state

    # LCNC-SUITE: preview runs the full plane math too (pure numpy +
    # interp params); only the HAL state check stays task-only. A stale
    # "already defined" preview mirror must not hard-error (foreign
    # previews never call webui_preview_reset) - preview overwrites.
    _task_mode = (self.task != 0)

    # ! IMPORTANT !
    #  We need to use 'yield INTERP_EXECUTE_FINISH' here to stop the read ahead
    # and avoid it executing the rest of the remap ahead of time
    ## NOTE: No 'self.execute(..)' command can be used after 'yield INTERP_EXECUTE_FINISH'
    yield INTERP_EXECUTE_FINISH

    if  _task_mode and hal.get_value(twp_is_defined): # ie TWP has already been defined
         # reset the twp parameters
        reset_twp_params(self)
        msg = ("G68.2: TWP already defined.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # NOTE: Due to easier abort handling we currently restrict the use of twp to G54
    # as LinuxCNC seems to revert to G54 as the default system
    (n, offsets) = get_current_work_offset(self)
    if n != 1:
         # reset the twp parameters
        reset_twp_params(self)
        msg = "G68.2 ERROR: Must be in G54 to define TWP."
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # LCNC-SUITE: the table pose is captured in the MACHINE frame (below), so a
    # rotary work/G92 offset would make that capture ambiguous - refuse loudly.
    if rotary_offsets_nonzero(self):
        reset_twp_params(self)
        msg = ("G68.2 ERROR: a rotary (A/B/C) work or G92 offset is in effect -"
               " it must be zero to define a TWP. Clear it (G10 L2 P1 A0 B0 C0"
               " / G92.1) and define again.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH
        yield INTERP_EXIT
        return INTERP_ERROR

    # collect the currently active work offset values (ie g54, g55 or other)
    saved_work_offset_number = n
    # LCNC-SUITE (W1): stored in the TABLE frame, converted through the table
    # angle the offset was RECORDED as touched off at. Identity when there is
    # no record or the record says A=0, so every pre-existing setup is
    # byte-identical.
    try:
        saved_work_offset, _a_touch, _prov = to_storage_frame(self, offsets, n)
    except TwpTouchoffKinsError as _e:
        reset_twp_params(self)
        msg = "G68.2 ERROR: %s" % _e
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH
        yield INTERP_EXIT
        return INTERP_ERROR
    log.debug("G68.2: Saved work offsets %s (touch-off A=%.6f, %s)",
              (n, saved_work_offset), _a_touch, _prov)
    # LCNC-SUITE: the table pose this definition is expressed in (see the
    # table-aware composition in g53x_core)
    # LCNC-SUITE: G68.2's words are operator intent in the WORKPIECE frame
    # (Fanuc table-type / Heidenhain 3D-ROT convention), which IS the storage
    # frame — so no conversion here, by design. The work OFFSET is a separate
    # matter and does get converted, through its recorded touch-off pose
    # (to_storage_frame, just above): that is what retired the old "touch off
    # with A at 0" precondition.
    # No head solve yet, so no staleness claim to make.
    twp_pose_a = None

    c = self.blocks[self.remap_level]
    p = c.p_number if c.p_flag else 0
    if p == 0: # true euler angles (this is the default mode)
        twp_flag = [int(p), 1, 'empty'] # one call to define the twp in this mode
        # parse requested order of rotations (default is '313' ie: ZXZ)
        q = str(int(c.q_number if c.q_flag else 313))
        if q not in ['121','131','212','232','313','323']:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.2 (P0): No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # parse the requested origin
        x = c.x_number if c.x_flag else 0
        y = c.y_number if c.y_flag else 0
        z = c.z_number if c.z_flag else 0
        # parse the requested rotation of tool-x around the origin
        r = c.r_number if c.r_flag else 0
        # parse the requested euler rotation angles
        th1 = c.i_number if c.i_flag else 0
        th2 = c.j_number if c.j_flag else 0
        th3 = c.k_number if c.k_flag else 0

        # build the translation vector of the twp_matrix
        twp_origin = [[x], [y], [z]]
        # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
        twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
        log.debug('G68.2 (P0): Twp_origin_rotation \n%s',twp_origin_rotation)
        # build the rotation matrix for the requested euler rotation
        twp_euler_rotation = twp_calc_euler_rot_matrix(th1, th2, th3, q)
        log.debug('G68.2 (P0): Twp_euler_rotation \n%s',twp_euler_rotation)
        # calculate the total twp_rotation using matrix multiplication
        twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_euler_rotation)
        # combine rotation and translation and form the 4x4 twp-transformation matrix
        twp_matrix = np.hstack((twp_rotation, twp_origin))
        twp_row_4 = [0,0,0,1]
        twp_matrix = np.vstack((twp_matrix, twp_row_4))
        twp_matrix = np.asmatrix(twp_matrix)
        # update the build state of the twp call
        twp_flag[2] = 'done'

    elif p == 1: # non-true euler angles, eg: 'pitch,roll,yaw'
        twp_flag = [int(p), 1, 'empty'] # one call to define the twp in this mode
        # parse requested order of rotations (default is '123' ie: XYZ)
        q = str(int(c.q_number if c.q_flag else 123))

        if q not in ['123','132','213','231','312','321']:
            # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.2 P1: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR


        # parse the requested origin
        x = c.x_number if c.x_flag else 0
        y = c.y_number if c.y_flag else 0
        z = c.z_number if c.z_flag else 0
        # parse the requested rotation of tool-x around the origin
        r = c.r_number if c.r_flag else 0
        # parse the requested euler rotation angles
        th1 = c.i_number if c.i_flag else 0
        th2 = c.j_number if c.j_flag else 0
        th3 = c.k_number if c.k_flag else 0

         # build the translation vector of the twp_matrix
        twp_origin = [[x], [y], [z]]
        # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
        twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
        log.debug('G68.2 P1: Twp_origin_rotation \n%s',twp_origin_rotation)
        # build the rotation matrix for the requested euler rotation
        twp_euler_rotation = twp_calc_euler_rot_matrix(th1, th2, th3, q)
        log.debug('G68.2 P1: Twp_euler_rotation \n%s',twp_euler_rotation)
        # calculate the total twp_rotation using matrix multiplication
        twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_euler_rotation)
        # combine rotation and translation and form the 4x4 twp-transformation matrix
        twp_matrix = np.hstack((twp_rotation, twp_origin))
        twp_row_4 = [0,0,0,1]
        twp_matrix = np.vstack((twp_matrix, twp_row_4))
        twp_matrix = np.asmatrix(twp_matrix)
        # update the build state of the twp call
        twp_flag[2] = 'done'

    elif p == 2: # twp defined py 3 points on the plane
        # if this is the first call for this mode reset the twp_flag flag
        if not twp_flag:
            twp_flag = [int(p), 4 , 'empty', 'empty', 'empty', 'empty'] # four calls needed
            twp_build_params = {'q0':[], 'q1':[], 'q2':[], 'q3':[]}
        # Point 1: defines the origin of the twp
        # Point 2: direction from P1 to P2 defines the positive x direction on the twp (tool-x)
        # Point 3: defines the positive y side and with P1 and P2 defines the xy work plane (tool-z)
        q = int(c.q_number if c.q_flag else 0)
        # this mode needs four calls to fill all required parameters
        if q == 0: # define new origin and rotation
            x = c.x_number if c.x_flag else 0
            y = c.y_number if c.y_flag else 0
            z = c.z_number if c.z_flag else 0
            # parse the requested rotation of tool-x around the origin
            r = c.r_number if c.r_flag else 0
            twp_build_params['q0'] = [x,y,z,r]
            twp_flag[2] = 'done'
        elif q == 1: # define point 1
            x1 = c.x_number if c.x_flag else 0
            y1 = c.y_number if c.y_flag else 0
            z1 = c.z_number if c.z_flag else 0
            twp_build_params['q1'] = [x1,y1,z1]
            twp_flag[3] = 'done'
        elif q == 2: # define point 2
            x2 = c.x_number if c.x_flag else 0
            y2 = c.y_number if c.y_flag else 0
            z2 = c.z_number if c.z_flag else 0
            twp_build_params['q2'] = [x2,y2,z2]
            twp_flag[4] = 'done'
        elif q == 3: # define point 3
            x3 = c.x_number if c.x_flag else 0
            y3 = c.y_number if c.y_flag else 0
            z3 = c.z_number if c.z_flag else 0
            twp_build_params['q3'] = [x3,y3,z3]
            twp_flag[5] = 'done'
        else:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.2 P2: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # only start calculations once all the parameters have been passed
        if twp_flag.count('done') == twp_flag[1]:
            [x, y, z, r] = twp_build_params['q0'][0:4]
            # build the translation vector of the twp_matrix
            twp_origin = [[x], [y], [z]]
            p1 = twp_build_params['q1'][0:3]
            p2 = twp_build_params['q2']
            p3 = twp_build_params['q3']
            log.debug("G68.2 P2: Point 1: %s",p1)
            log.debug("G68.2 P2: Point 2: %s",p2)
            log.debug("G68.2 P2: Point 3: %s",p3)
            # build vectors x:P1->P2 and v2:P1->P3
            twp_vect_x = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]]
            log.debug("G68.2 P2: Twp_vect_x: \n%s",twp_vect_x)
            v2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]]
            log.debug("G68.2 P2 (v2): %s",v2)
            # normalize the two vectors
            twp_vect_x = twp_vect_x / np.linalg.norm(twp_vect_x)
            v2 = v2 / np.linalg.norm(v2)
            # we can use the cross product to calculate the tool-z vector
            # note: if P3 is on the right side of the vector P1->P2
            # then the tool-z will be below the twp (ie tool-z will be downwards)
            twp_vect_z = np.cross(twp_vect_x , v2)
            log.debug("G68.2 P2: Twp_vect_z %s",twp_vect_z)
            # we can use the cross product to calculate the tool-y vector
            twp_vect_y = np.cross(twp_vect_z, twp_vect_x)
            log.debug("G68.2 P2: Twp_vect_y %s",twp_vect_y)
            # build the rotation matrix of the twp_matrix from the calculated tool-vectors
            # first stack the vectors (lists) and then flip diagonally (transpose)
            # so the vectors are now vertical
            twp_vect_rotation_t = np.vstack((twp_vect_x, twp_vect_y))
            twp_vect_rotation_t = np.vstack((twp_vect_rotation_t, twp_vect_z))
            twp_vect_rotation = np.transpose(twp_vect_rotation_t)
            log.debug("G68.2 P2: Built the twp-rotation-matrix: \n%s", twp_vect_rotation)
            # convert requested origin rotation to radians
            # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
            twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
            log.debug('G68.2 P2: Twp-origin-rotation-matrix \n%s',twp_origin_rotation)
            # calculate the total twp_rotation using matrix multiplication
            twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_vect_rotation)
            # add the origin translation on the right
            twp_matrix = np.hstack((twp_rotation, twp_origin))
            # expand to 4x4 array and make into a matrix
            twp_row_4 = [0,0,0,1]
            twp_matrix = np.vstack((twp_matrix, twp_row_4))
            twp_matrix = np.asmatrix(twp_matrix)
            log.debug("G68.2 P2: Built twp-transformation-matrix: \n%s", twp_matrix)

    elif p == 3: # two vectors (vector 1 defines the tool-x and vector 2 defines the tool-z)
        q = int(c.q_number if c.q_flag else 0)
        # if this is the first call for this mode reset the twp_flag flag
        if not twp_flag:
            log.info('first call')
            twp_flag = [int(p), 2 , 'empty', 'empty'] # two calls needed
            twp_build_params = {'q0':[], 'q1':[]}
        log.debug('twp_build_params: %s', twp_build_params)
        if q == 0: # define new origin of the twp
            x = c.x_number if c.x_flag else 0
            y = c.y_number if c.y_flag else 0
            z = c.z_number if c.z_flag else 0
            # parse the requested rotation of tool-x around the origin
            r = c.r_number if c.r_flag else 0
            # first vector (direction of x in the twp)
            i = c.i_number if c.i_flag else 0
            j = c.j_number if c.j_flag else 0
            k = c.k_number if c.k_flag else 0
            twp_build_params['q0'] = [x,y,z,i,j,k,r]
            twp_flag[2] = 'done'
        elif q == 1: # define second vector (the normal vector of the twp
            i1 = c.i_number if c.i_flag else 0
            j1 = c.j_number if c.j_flag else 0
            k1 = c.k_number if c.k_flag else 0
            twp_build_params['q1'] = [i1,j1,k1]
            twp_flag[3] = 'done'
        else:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.2 P3: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # only start calculations once all the parameters have been passed
        if twp_flag.count('done') == twp_flag[1]:
            twp_origin = (x ,y, z) = twp_build_params['q0'][0:3]
            r = twp_build_params['q0'][6]
            (i, j, k) = twp_build_params['q0'][3:6]
            (i1, j1, k1) = twp_build_params['q1']
            log.debug("(x, y, z): %s", (x, y, z))
            log.debug("(i, j, k): %s", (i, j, k))
            log.debug("(i1, j1, k1): %s", (i1, j1, k1))
            # build unit vector defining tool-x direction
            twp_vect_x = [i-x, j-y, k-z]
            twp_vect_x = twp_vect_x / np.linalg.norm(twp_vect_x)
            twp_vect_z = [i1, j1, k1]
            twp_vect_z = twp_vect_z / np.linalg.norm(twp_vect_z)
            orth = np.dot(twp_vect_x, twp_vect_z)
            log.debug("orth check: %s", orth)
            # the two vectors must be orthogonal
            if orth != 0:
                reset_twp_params(self)
                msg = ("G68.2 P3: Vectors are not orthogonal.")
                log.debug(msg)
                emccanon.CANON_ERROR(msg)
                yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
                yield INTERP_EXIT # w/o this the error does not abort a running gcode program
                return INTERP_ERROR

            # we can use the cross product to calculate the tool-y vector
            twp_vect_y = np.cross(twp_vect_z, twp_vect_x)
            log.debug("G68.2 P3: twp_vect_y %s",twp_vect_y)
            # build the rotation matrix of the twp_matrix from the calculated tool-vectors
            # first stack the vectors (lists) and then flip diagonally (transpose)
            # so the vectors are now vertical
            twp_vect_rotation_t = np.vstack((twp_vect_x, twp_vect_y))
            twp_vect_rotation_t = np.vstack((twp_vect_rotation_t, twp_vect_z))
            twp_vect_rotation = np.transpose(twp_vect_rotation_t)
            log.debug("G68.2 P3: Built twp-rotation-matrix: \n%s", twp_vect_rotation)
            # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
            try:
                twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
            except Exception as e:
                log.info('G68.2 P3: twp_origin_rotation failed, %s', e)
            log.debug('G68.2 P3: Twp-origin-rotation-matrix \n%s',twp_origin_rotation)
            # calculate the total twp_rotation using matrix multiplication
            twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_vect_rotation)
            # add the origin translation on the right
            twp_origin = [[x], [y], [z]]
            twp_matrix = np.hstack((twp_rotation, twp_origin))
            # expand to 4x4 array and make into a matrix
            twp_row_4 = [0,0,0,1]
            twp_matrix = np.vstack((twp_matrix, twp_row_4))
            twp_matrix = np.asmatrix(twp_matrix)
            log.debug("G68.2 P3: Built twp-transformation-matrix: \n%s", twp_matrix)

    else:
         # reset the twp parameters
        reset_twp_params(self)
        msg = ("G68.2: No recognised P-Word found.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    log.debug("G68.2: twp_flag: %s", twp_flag)
    log.debug("G68.2: calls required: %s", twp_flag.count('done'))
    log.debug("G68.2: number of calls made: %s", twp_flag.count('done'))

    if twp_flag.count('done') == twp_flag[1]:
        log.info('G68.2: requested rotation: %s', radians(r))
        log.info("G68.2: twp-tranformation-matrix: \n%s",twp_matrix)
        twp_origin = [twp_matrix[0,3],twp_matrix[1,3],twp_matrix[2,3]]
        log.info("G68.2: twp origin: %s", twp_origin)
        twp_vect_x = [twp_matrix[0,0],twp_matrix[1,0],twp_matrix[2,0]]
        log.info("G68.2: twp vector-x: %s", twp_vect_x)
        twp_vect_z = [twp_matrix[0,2],twp_matrix[1,2],twp_matrix[2,2]]
        log.info("G68.2: twp vector-z: %s", twp_vect_z)
        # set twp-state to 'defined' (1)
        self.execute("M68 E2 Q1")
        if not _task_mode:
            _preview_twp_state = 1  # LCNC-SUITE: preview mirror of twp-status
        yield INTERP_EXECUTE_FINISH

        gui_update_twp(self)
    return INTERP_OK

# incremental definition of  a virtual work-plane (twp) using different methods set by the 'p'-word
def g684(self, **words):
    global twp_matrix, pre_rot, twp_flag, twp_build_params, saved_work_offset_number, saved_work_offset
    global twp_pose_a  # LCNC-SUITE: an increment invalidates the head solve
    global _task_mode, _preview_twp_state

    # LCNC-SUITE: preview runs the incremental plane math too; the
    # active-state check reads HAL under task and the preview mirror
    # otherwise (an increment from nothing has no frame to build on -
    # the preview declines rather than guessing, task errors as before).
    _task_mode = (self.task != 0)

    # ! IMPORTANT !
    #  We need to use 'yield INTERP_EXECUTE_FINISH' here to stop the read ahead
    # and avoid it executing the rest of the remap ahead of time
    ## NOTE: No 'self.execute(..)' command can be used after 'yield INTERP_EXECUTE_FINISH'
    yield INTERP_EXECUTE_FINISH

    if not _task_mode and _preview_twp_state != 2:
        print("LCNC-SUITE preview: G68.4 without an active TWP - "
              "no increment applied", file=sys.stderr, flush=True)
        yield INTERP_EXECUTE_FINISH
        return INTERP_OK

    if _task_mode and not hal.get_value(twp_is_active): # ie there is currently no TWP defined
         # reset the twp parameters
        reset_twp_params(self)
        msg = ("G68.4: No TWP active to increment from. Run G68.2 or G68.3 first.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    # collect the currently active work offset values (ie g54, g55 or other)
    n = get_current_work_offset(self)[0]
    # Must be in one of the dedicated offset systems for TWP
    if False: #n < 6:
         # reset the twp parameters
        reset_twp_params(self)
        msg = ("G68.4 ERROR: Must be in G59, G59.x to increment TWP.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR


    # store the current TWP to
    twp_matrix_current = np.matrix.copy(twp_matrix)

    c = self.blocks[self.remap_level]
    p = c.p_number if c.p_flag else 0

    if p == 0: # true euler angles (this is the default mode)
        twp_flag = [int(p), 1, 'empty'] # one call to define the twp in this mode
        # parse requested order of rotations (default is '313' ie: ZXZ)
        q = str(int(c.q_number if c.q_flag else 313))

        if q not in ['121','131','212','232','313','323']:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.4 (P0): No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # parse the requested origin
        x = c.x_number if c.x_flag else 0
        y = c.y_number if c.y_flag else 0
        z = c.z_number if c.z_flag else 0
        # parse the requested rotation of tool-x around the origin
        r = c.r_number if c.r_flag else 0
        # parse requested euler angles
        th1 = c.i_number if c.i_flag else 0
        th2 = c.j_number if c.j_flag else 0
        th3 = c.k_number if c.k_flag else 0

        # build the translation vector of the twp_matrix
        twp_origin = [[x], [y], [z]]
        # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
        twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
        log.debug('G68.4 (P0): Twp_origin_rotation \n%s',twp_origin_rotation)
        # build the rotation matrix for the requested euler rotation
        twp_euler_rotation = twp_calc_euler_rot_matrix(th1, th2, th3, q)
        log.debug('G68.4 (P0): Twp_euler_rotation \n%s',twp_euler_rotation)
        # calculate the total twp_rotation using matrix multiplication
        twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_euler_rotation)
        # combine rotation and translation and form the 4x4 twp-transformation matrix
        twp_matrix = np.hstack((twp_rotation, twp_origin))
        twp_row_4 = [0,0,0,1]
        twp_matrix = np.vstack((twp_matrix, twp_row_4))
        twp_matrix = np.asmatrix(twp_matrix)
        # update the build state of the twp call
        twp_flag[2] = 'done'

    elif p == 1: # non-true euler angles, eg: 'pitch,roll,yaw'
        twp_flag = [int(p), 1, 'empty'] # one call to define the twp in this mode
        # parse requested order of rotations (default is '123' ie: XYZ)
        q = str(int(c.q_number if c.q_flag else 123))

        if q not in ['123','132','213','231','312','321']:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.4 P1: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # parse the requested origin
        x = c.x_number if c.x_flag else 0
        y = c.y_number if c.y_flag else 0
        z = c.z_number if c.z_flag else 0
        # parse the requested rotation of tool-x around the origin
        r = c.r_number if c.r_flag else 0
        # parse the requested euler rotation angles
        th1 = c.i_number if c.i_flag else 0
        th2 = c.j_number if c.j_flag else 0
        th3 = c.k_number if c.k_flag else 0

         # build the translation vector of the twp_matrix
        twp_origin = [[x], [y], [z]]
        # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
        twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
        log.debug('G68.4 P1: Twp_origin_rotation \n%s',twp_origin_rotation)
        # build the rotation matrix for the requested euler rotation
        twp_euler_rotation = twp_calc_euler_rot_matrix(th1, th2, th3, q)
        log.debug('G68.4 P1: Twp_euler_rotation \n%s',twp_euler_rotation)
        # calculate the total twp_rotation using matrix multiplication
        twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_euler_rotation)
        # combine rotation and translation and form the 4x4 twp-transformation matrix
        twp_matrix = np.hstack((twp_rotation, twp_origin))
        twp_row_4 = [0,0,0,1]
        twp_matrix = np.vstack((twp_matrix, twp_row_4))
        twp_matrix = np.asmatrix(twp_matrix)
        # update the build state of the twp call
        twp_flag[2] = 'done'

    elif p == 2: # twp defined py 3 points on the plane
        # if this is the first call for this mode reset the twp_flag flag
        if not twp_flag:
            twp_flag = [int(p), 4 , 'empty', 'empty', 'empty', 'empty'] # four calls needed
            twp_build_params = {'q0':[], 'q1':[], 'q2':[], 'q3':[]}
        # Point 1: defines the origin of the twp
        # Point 2: direction from P1 to P2 defines the positive x direction on the twp (tool-x)
        # Point 3: defines the positive y side and with P1 and P2 defines the xy work plane (tool-z)
        q = int(c.q_number if c.q_flag else 0)
        # this mode needs four calls to fill all required parameters
        if q == 0: # define new origin and rotation
            x = c.x_number if c.x_flag else 0
            y = c.y_number if c.y_flag else 0
            z = c.z_number if c.z_flag else 0
            # parse the requested rotation of tool-x around the origin
            r = c.r_number if c.r_flag else 0
            twp_build_params['q0'] = [x,y,z,r]
            twp_flag[2] = 'done'
        elif q == 1: # define point 1
            x1 = c.x_number if c.x_flag else 0
            y1 = c.y_number if c.y_flag else 0
            z1 = c.z_number if c.z_flag else 0
            twp_build_params['q1'] = [x1,y1,z1]
            twp_flag[3] = 'done'
        elif q == 2: # define point 2
            x2 = c.x_number if c.x_flag else 0
            y2 = c.y_number if c.y_flag else 0
            z2 = c.z_number if c.z_flag else 0
            twp_build_params['q2'] = [x2,y2,z2]
            twp_flag[4] = 'done'
        elif q == 3: # define point 3
            x3 = c.x_number if c.x_flag else 0
            y3 = c.y_number if c.y_flag else 0
            z3 = c.z_number if c.z_flag else 0
            twp_build_params['q3'] = [x3,y3,z3]
            twp_flag[5] = 'done'
        else:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.4 P2: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # only start calculations once all the parameters have been passed
        if twp_flag.count('done') == twp_flag[1]:
            [x, y, z, r] = twp_build_params['q0'][0:4]
            # build the translation vector of the twp_matrix
            twp_origin = [[x], [y], [z]]
            p1 = twp_build_params['q1'][0:3]
            p2 = twp_build_params['q2']
            p3 = twp_build_params['q3']
            log.debug("G68.4 P2: Point 1: %s",p1)
            log.debug("G68.4 P2: Point 2: %s",p2)
            log.debug("G68.4 P2: Point 3: %s",p3)
            # build vectors x:P1->P2 and v2:P1->P3
            twp_vect_x = [p2[0]-p1[0], p2[1]-p1[1], p2[2]-p1[2]]
            log.debug("G68.4 P2: Twp_vect_x: \n%s",twp_vect_x)
            v2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]]
            log.debug("G68.4 P2: (v2) %s", v2)
            # normalize the two vectors
            twp_vect_x = twp_vect_x / np.linalg.norm(twp_vect_x)
            v2 = v2 / np.linalg.norm(v2)
            # we can use the cross product to calculate the tool-z vector
            # note: if P3 is on the right side of the vector P1->P2
            # then the tool-z will be below the twp (ie tool-z will be downwards)
            twp_vect_z = np.cross(twp_vect_x , v2)
            log.debug("G68.4 P2: Twp_vect_z %s",twp_vect_z)
            # we can use the cross product to calculate the tool-y vector
            twp_vect_y = np.cross(twp_vect_z, twp_vect_x)
            log.debug("G68.4 P2: Twp_vect_y %s",twp_vect_y)
            # build the rotation matrix of the twp_matrix from the calculated tool-vectors
            # first stack the vectors (lists) and then flip diagonally (transpose)
            # so the vectors are now vertical
            twp_vect_rotation_t = np.vstack((twp_vect_x, twp_vect_y))
            twp_vect_rotation_t = np.vstack((twp_vect_rotation_t, twp_vect_z))
            twp_vect_rotation = np.transpose(twp_vect_rotation_t)
            log.debug("G68.4 P2: Built the twp-rotation-matrix: \n%s", twp_vect_rotation)
            # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
            try:
                twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
            except Exception as e:
                log.debug('G68.4 P2: twp_origin_rotation failed ', e)
            log.debug('G68.4 P2: Twp-origin-rotation-matrix \n%s',twp_origin_rotation)
            # calculate the total twp_rotation using matrix multiplication
            twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_vect_rotation)
            # add the origin translation on the right
            twp_matrix = np.hstack((twp_rotation, twp_origin))
            # expand to 4x4 array and make into a matrix
            twp_row_4 = [0,0,0,1]
            twp_matrix = np.vstack((twp_matrix, twp_row_4))
            twp_matrix = np.asmatrix(twp_matrix)
            log.debug("G68.4 P2: Built twp-transformation-matrix: \n%s", twp_matrix)

    elif p == 3: # two vectors (vector 1 defines the tool-x and vector 2 defines the tool-z)
        q = int(c.q_number if c.q_flag else 0)
        # if this is the first call for this mode reset the twp_flag flag
        if not twp_flag:
            twp_flag = [int(p), 2 , 'empty', 'empty'] # two calls needed
            twp_build_params = {'q0':[], 'q1':[]}
        if q == 0: # define new origin and first vector (direction of x in the twp)
            x = c.x_number if c.x_flag else 0
            y = c.y_number if c.y_flag else 0
            z = c.z_number if c.z_flag else 0
            # parse the requested rotation of tool-x around the origin
            r = c.r_number if c.r_flag else 0
            # first vector (direction of x in the twp)
            i = c.i_number if c.i_flag else 0
            j = c.j_number if c.j_flag else 0
            k = c.k_number if c.k_flag else 0
            twp_build_params['q0'] = [x,y,z,i,j,k,r]
            twp_flag[2] = 'done'
        elif q == 1: # define second vector (the normal vector of the twp
            i1 = c.i_number if c.i_flag else 0
            j1 = c.j_number if c.j_flag else 0
            k1 = c.k_number if c.k_flag else 0
            twp_build_params['q1'] = [i1,j1,k1]
            twp_flag[3] = 'done'
        else:
             # reset the twp parameters
            reset_twp_params(self)
            msg = ("G68.4 P3: No recognised Q-Word found.")
            log.debug(msg)
            emccanon.CANON_ERROR(msg)
            yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
            yield INTERP_EXIT # w/o this the error does not abort a running gcode program
            return INTERP_ERROR

        # only start calculations once all the parameters have been passed
        if twp_flag.count('done') == twp_flag[1]:
            twp_origin = (x ,y, z) = twp_build_params['q0'][0:3]
            r = twp_build_params['q0'][6]
            (i, j, k) = twp_build_params['q0'][3:6]
            (i1, j1, k1) = twp_build_params['q1']
            log.debug("(x, y, z) %s", (x, y, z))
            log.debug("(i, j, k) %s", (i, j, k))
            log.debug("(i1, j1, k1) %s", (i1, j1, k1))
            # build unit vector defining tool-x direction
            twp_vect_x = [i-x, j-y, k-z]
            twp_vect_x = twp_vect_x / np.linalg.norm(twp_vect_x)
            twp_vect_z = [i1, j1, k1]
            twp_vect_z = twp_vect_z / np.linalg.norm(twp_vect_z)
            orth = np.dot(twp_vect_x, twp_vect_z)
            log.debug("orth check: %s", orth)
            # the two vectors must be orthogonal
            if orth != 0:
                 # reset the twp parameters
                reset_twp_params(self)
                ## reset the parameter values
                #twp_flag = [int(p), 2 , 'empty', 'empty'] # two calls needed
                #twp_build_params = {'q0':[], 'q1':[]}
                msg = ("G68.4 P3: Vectors are not orthogonal.")
                log.debug(msg)
                emccanon.CANON_ERROR(msg)
                yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
                yield INTERP_EXIT # w/o this the error does not abort a running gcode program
                return INTERP_ERROR

            # we can use the cross product to calculate the tool-y vector
            twp_vect_y = np.cross(twp_vect_z, twp_vect_x)
            log.debug("G68.4 P3: twp_vect_y %s",twp_vect_y)
            # build the rotation matrix of the twp_matrix from the calculated tool-vectors
            # first stack the vectors (lists) and then flip diagonally (transpose)
            # so the vectors are now vertical
            twp_vect_rotation_t = np.vstack((twp_vect_x, twp_vect_y))
            twp_vect_rotation_t = np.vstack((twp_vect_rotation_t, twp_vect_z))
            twp_vect_rotation = np.transpose(twp_vect_rotation_t)
            log.debug("G68.4 P3: Built twp-rotation-matrix: \n%s", twp_vect_rotation)
            # we use xzx-euler rotation to create the rotation matrix for the requested origin rotation
            twp_origin_rotation = twp_calc_euler_rot_matrix(0, r, 0, '131')
            log.debug('G68.4 P3: Twp-origin-rotation-matrix \n%s',twp_origin_rotation)
            # calculate the total twp_rotation using matrix multiplication
            twp_rotation = np.asmatrix(twp_origin_rotation) * np.asmatrix(twp_vect_rotation)
            # add the origin translation on the right
            twp_origin = [[x], [y], [z]]
            twp_matrix = np.hstack((twp_rotation, twp_origin))
            # expand to 4x4 array and make into a matrix
            twp_row_4 = [0,0,0,1]
            twp_matrix = np.vstack((twp_matrix, twp_row_4))
            twp_matrix = np.asmatrix(twp_matrix)
            log.debug("G68.4 P3: Built twp-transformation-matrix: \n%s", twp_matrix)

    else:
         # reset the twp parameters
        reset_twp_params(self)
        msg = ("G68.4: No recognised P-Word found.")
        log.debug(msg)
        emccanon.CANON_ERROR(msg)
        yield INTERP_EXECUTE_FINISH # w/o this the error message is not displayed
        yield INTERP_EXIT # w/o this the error does not abort a running gcode program
        return INTERP_ERROR

    log.debug("G68.4: twp_flag: %s", twp_flag)
    log.debug("G68.4: calls required: %s", twp_flag.count('done'))
    log.debug("G68.4: number of calls made: %s", twp_flag.count('done'))

    if twp_flag.count('done') == twp_flag[1]:
        log.info('G68.4: requested rotation %s', radians(r))
        log.info("G68.4: twp_matrix_current: \n%s", twp_matrix_current)
        log.info("G68.4: incremental twp_matrix requested: \n%s",twp_matrix)
        log.info("G68.4: calculating new twp_matrix...")
        twp_matrix_new = twp_matrix_current * twp_matrix
        log.info("G68.4: twp_matrix_new: \n%s",twp_matrix_new)
        twp_origin = [twp_matrix[0,3],twp_matrix[1,3],twp_matrix[2,3]]
        log.info("G68.4: twp origin: %s", twp_origin)
        twp_vect_x = [twp_matrix[0,0],twp_matrix[1,0],twp_matrix[2,0]]
        log.info("G68.4: twp vector-x: %s", twp_vect_x)
        twp_vect_z = [twp_matrix[0,2],twp_matrix[1,2],twp_matrix[2,2]]
        log.info("G68.4: twp vector-z: %s", twp_vect_z)
        log.info("G68.4: incremented twp_matrix: \n%s", twp_matrix_new)
        twp_matrix = twp_matrix_new
        # LCNC-SUITE: the PLANE just changed, so whatever G53.x last solved
        # the head for no longer matches it. Drop the pose stamp to the
        # sentinel rather than let it vouch for a stale orient. (The
        # increment itself is frame-agnostic: it right-multiplies, i.e. it is
        # expressed in the CURRENT plane's own frame, so the result inherits
        # the table frame — which is why nothing else here needs converting.)
        twp_pose_a = None
        # set twp-state to 'defined' (1)
        self.execute("M68 E2 Q1")
        if not _task_mode:
            _preview_twp_state = 1  # LCNC-SUITE: preview mirror of twp-status
        yield INTERP_EXECUTE_FINISH

        gui_update_twp(self)
    return INTERP_OK

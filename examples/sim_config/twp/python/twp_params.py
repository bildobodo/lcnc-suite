"""Numbered-parameter layout for the nine fixtures and G92 — the FORK-side
twin of gateway_util.WCS_VAR_BASES.

Deliberately linuxcnc-free (like twp_transform / twp_prov) so remap.py can
import it on the machine and lcnc-gateway/test_twp_params.py can import it
off-machine and pin it against the gateway's copy.

Layout (RS274NGC numbered parameters):
    fixture n in 1..9 (G54=1 … G59=6 … G59.3=9): base = 5221 + (n-1)*20
    base+0..+8  X Y Z A B C U V W offsets,  base+9  R (XY rotation)
    5220        active fixture index (1..9)
    5211..5219  G92 X Y Z A B C U V W,  5210  G92 in effect flag

G59..G59.3 (6..9) are RESERVED on a TWP config: g53x_core writes them at
every orient and they hold the plane frame's origin in TOOL coordinates.
"""

LETTERS = "XYZABCUVW"
ROTARY = "ABC"
ACTIVE_INDEX_PARAM = 5220
G92_FLAG_PARAM = 5210
G92_PARAMS = {l: 5211 + i for i, l in enumerate(LETTERS)}
RESERVED_FIXTURES = (6, 7, 8, 9)


def fixture_base(index):
    """First parameter (X) of fixture `index` (1..9). ValueError outside."""
    i = int(index)
    if not 1 <= i <= 9:
        raise ValueError("fixture index out of range 1..9: %r" % (index,))
    return 5221 + (i - 1) * 20


def wcs_row_params(index):
    """{letter: param} for X..W plus "R" for fixture `index`."""
    b = fixture_base(index)
    out = {l: b + i for i, l in enumerate(LETTERS)}
    out["R"] = b + 9
    return out


def active_index(params):
    """The active fixture index from the interpreter's parameter table."""
    return int(round(float(params[ACTIVE_INDEX_PARAM])))

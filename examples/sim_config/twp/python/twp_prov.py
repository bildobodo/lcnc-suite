"""Touch-off provenance parameter layout (W1) — the FORK-side twin.

The gateway stamps every touch-off it makes into the ten parameters per
fixture that the interpreter leaves undefined (G54 uses 5221..5230; the
next ten are free and persist via the var file, provided the rows exist
there). This module is the single fork-side authority for that layout;
`gateway_util.wcs_prov_params` is the gateway-side twin, and
`lcnc-gateway/test_twp_prov.py` imports BOTH and refuses to let them
drift. Change the layout in either place and that test names the other.

Deliberately linuxcnc-free (like twp_transform) so it is importable both
by remap.py on the machine and by the gateway test suite off-machine.

Layout, per fixture index n in 1..9 (G54=1 .. G59.3=9):

    base = 5231 + (n-1)*20
    base+0  stamped flag (1 = recorded; 0 — the value a fresh var file is
            full of — means never recorded. Deliberately a FLAG and not a
            sentinel in the data: kins type 0 is a legitimate value, and a
            -1e9 sentinel round-tripped through the var file as 0.0.)
    base+1  switchkins type at touch-off (0 identity / 1 TCP / 2 TOOL)
    base+2  machine-frame A at touch-off, degrees
    base+3..5  the offset X/Y/Z as written (falsifiability: the stamp is
            believed only while these still match the live fixture row)
"""

PROV_BASE = 5231
PROV_STRIDE = 20
PROV_STAMPED = 1.0


def prov_params(index):
    """Provenance parameter numbers for fixture `index` (1..9).

    Returns {"stamped", "kins", "a", "x", "y", "z"} -> parameter number.
    Raises ValueError outside 1..9 — there is no tenth fixture, and a
    silently-wrong base would alias another fixture's rows.
    """
    i = int(index)
    if not 1 <= i <= 9:
        raise ValueError("fixture index out of range 1..9: %r" % (index,))
    b = PROV_BASE + (i - 1) * PROV_STRIDE
    return {"stamped": b, "kins": b + 1, "a": b + 2,
            "x": b + 3, "y": b + 4, "z": b + 5}

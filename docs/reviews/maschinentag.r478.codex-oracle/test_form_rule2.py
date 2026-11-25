"""Scratch, plan v2 (MT476-03): the form rule WITH the integer bounds (T, P
0-99999, Q int32), finite values and D >= 0, against the compiled upstream
reader: every admitted file reads alike; every %d field at its edges in every
spelling the gateway's parser takes."""
import math, random
from test_form_rule import form_refusal, linuxcnc, ours, F
from tool_table import parse_tool_table_bytes
I32 = (-2**31, 2**31 - 1)

def load_refusal(data):
    why = form_refusal(data)
    if why: return why
    import re
    for n, line in enumerate(data.split(b"\n"), 1):
        if line.lstrip(b" ").startswith(b"#") and any(re.match(rb"[pP][+-]?\d", t) for t in line.partition(b";")[0].split(b" ")): return ("hash", n)
    unread = []; rows = parse_tool_table_bytes(data, unread=unread)
    if unread: return ("unread", unread[0]["line"])
    for r in rows:
        if not 0 <= r["T"] <= 99999: return ("T", r["T"])
        if not 0 <= r["P"] <= 99999: return ("P", r["P"])
        if not I32[0] <= r.get("Q", 0) <= I32[1]: return ("Q", r["Q"])
        if not all(math.isfinite(float(r.get(k, 0))) for k in F): return ("finite", r["T"])
        if r["D"] < 0: return ("D", r["T"])
    return None

def spellings(n):
    s = str(abs(n)); sign = "-" if n < 0 else ""
    out = [f"{sign}{s}", f"{sign}{s}.", f"{sign}{s}.0", f"{sign}{s}.000000", f"{sign}00{s}", f"{sign}{s}." + "0" * 40]
    return out + ([f"+{s}", f"+{s}.0"] if n >= 0 else [])

EDGES = [0, 1, 5, 9, 255, 99999, 100000, 2**31-1, 2**31, 2**31+3, 2**32, 2**32+3, 2**63, 10**30, -1, -5, -2**31, -2**31-1, -2**32-3]
def test_every_integer_field_at_its_edges_in_every_spelling():
    n = {"admitted": 0, "refused": 0, "refused_differ": 0}
    for field in "TPQ":
        for v in EDGES:
            for sp in spellings(v):
                for low in (False, True):
                    f = field.lower() if low else field
                    tok = {"T": "T5", "P": "P7", "Q": "Q3"}; tok[field] = f + sp
                    data = f"{tok['T']} {tok['P']} Z-10.5 D6 {tok['Q']} ; r\nT6 P6 Z1 D2\n".encode()
                    o, _ = ours(data); l, _ = linuxcnc(data)
                    if load_refusal(data) is None:
                        n["admitted"] += 1; assert sorted(o) == sorted(l), (data, o, l)
                    else:
                        n["refused"] += 1; n["refused_differ"] += sorted(o) != sorted(l)
    print(n)

def test_fuzz_with_integers():
    rnd = random.Random(11); adm = 0; diff = 0
    ints = [x for v in EDGES for x in spellings(v)]
    reals = ["0", "-0", "1e3", ".5", "5.", "-12.000001", "1e999", "-1e999", "1e-400", "0.1", "123456.789012", "+3"]
    for _ in range(4000):
        lines = []
        for k in range(rnd.randint(1, 4)):
            toks = [rnd.choice("Tt") + (rnd.choice(ints) if rnd.random() < .3 else str(rnd.randint(0, 999))),
                    rnd.choice("Pp") + (rnd.choice(ints) if rnd.random() < .3 else str(rnd.randint(0, 999)))]
            if rnd.random() < .5: toks.append("Q" + (rnd.choice(ints) if rnd.random() < .5 else str(rnd.randint(0, 9))))
            for c in rnd.sample("XYZABCUVWDIJ", rnd.randint(0, 4)): toks.append(c + rnd.choice(reals))
            rnd.shuffle(toks); lines.append((" " * rnd.randint(0, 2)) + (" " * rnd.randint(1, 3)).join(toks) + rnd.choice(["", " ", " ; rem", ";x"]))
        data = ("\n".join(lines) + "\n").encode(); o, _ = ours(data); l, _ = linuxcnc(data)
        if load_refusal(data) is None:
            adm += 1; assert sorted(o) == sorted(l), (data, o, l)
        elif sorted(o) != sorted(l): diff += 1
    print("admitted", adm, "refused and different", diff)

def test_codex_r476():
    for q in (3, 2147483647, 2147483648, 4294967299, -2147483649):
        d = f"T5 P5 Z10 D6 Q{q}\n".encode(); print(q, load_refusal(d), ours(d)[0][0][3], linuxcnc(d)[0][0][3])
        if load_refusal(d) is None: assert ours(d)[0] == linuxcnc(d)[0]

def test_tables_on_the_vm():
    import glob, os
    seen = {}
    for pat in ("/home/cnc/lcnc-suite-tf2/examples/**/*.tbl", "/home/cnc/linuxcnc/configs/**/*.tbl", "/usr/share/doc/linuxcnc/examples/**/*.tbl"):
        for p in glob.glob(pat, recursive=True):
            if not os.path.exists(p): continue
            d = open(p, "rb").read(); w = load_refusal(d); same = sorted(ours(d)[0]) == sorted(linuxcnc(d)[0])
            seen.setdefault(("admitted" if w is None else str(w[0]), same), []).append(os.path.basename(p))
    for k, v in sorted(seen.items(), key=str): print(k, len(v), sorted(set(v))[:5])
    assert not any(k[0] == "admitted" and not k[1] for k in seen)

def indices(data):
    import subprocess, tempfile, os
    with tempfile.NamedTemporaryFile(dir="/home/cnc/claude-work/p6/tf2", delete=False) as f: f.write(data); p = f.name
    r = subprocess.run(["/home/cnc/claude-work/p6/tf2/oracle/oracle", p], capture_output=True); os.unlink(p)
    return [(int(l.split()[1]), int(l.split()[2])) for l in r.stdout.splitlines() if l.startswith(b"ROW ")]

def test_the_ith_row_is_index_i():
    rnd = random.Random(5); adm = ref = shifted = 0
    junk = ["# words", "#T5 P5 Z1", "# p5 used", "#P7", "# a ; P5", ";T5 P5", " ;x", "", "   ", "; c", "#", "#P", "# Px", "#T5 p-3", "# +P5", " #T5 P5 Z1", "   # P9 x", "\t#T5 P5", " #"]
    for _ in range(3000):
        lines = []
        for k in range(rnd.randint(1, 6)):
            lines.append(rnd.choice(junk) if rnd.random() < .4 else f"T{k+1} P{rnd.randint(0,50)} Z-{k}.5 D6")
        d = ("\n".join(lines) + "\n").encode(); o = [r[0] for r in ours(d)[0]]
        pos = [(i + 1, t) for i, t in enumerate(o)]
        if load_refusal(d) is None and o: adm += 1; assert indices(d) == pos, (d, indices(d), pos)
        else: ref += 1; shifted += indices(d) != pos
    print("admitted", adm, "refused", ref, "of them really shifted", shifted)

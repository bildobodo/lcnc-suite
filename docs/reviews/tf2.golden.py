"""The golden of TF-2 (plan v3 §1.2): what LinuxCNC's OWN table reader holds
for these bytes — index, T, P, Q and every real that is not 0 of every home
entry — from upstream v2.9.4 tooldata_common.cc compiled unchanged (sha256
ae1e5120…, the oracle of docs/reviews/tg.golden.py). Writes
scripts/test_fixtures/tool_load/golden.json (test_tool_load reads it; no test
needs the oracle): the integer fields at their edges in every spelling the
suite's reader takes, the forms of §1.2 C, Codex's nine R479 files, and
fuzzed files. `--fuzz N` checks N more without writing: every file
load_refusal admits reads the same in both.

  python3 scripts/test_support/heavy_lock.py --who tf2 -- python3 -I docs/reviews/tf2.golden.py [--fuzz N]
"""
import hashlib
import importlib.util
import json
import pathlib
import random
import re
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve()
ROOT = HERE.parents[2]
OUT = ROOT / "scripts/test_fixtures/tool_load/golden.json"
spec = importlib.util.spec_from_file_location("tg_golden", HERE.with_name("tg.golden.py"))
tg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tg)
LETTERS = "XYZABCUVWDIJ"

EDGES = [0, 5, 99999, 100000, 2 ** 31 - 1, 2 ** 31, 2 ** 32 + 3, 2 ** 63, 10 ** 30, -1, -5, -2 ** 31, -2 ** 31 - 1]
JUNK = ["# words", "#T5 P5 Z1", "# p5 used", "#P7", "# P7", "# a ; P5", ";T5 P5", " ;x", "", "   ", "; c", "#", "#P",
        "# Px", "#T5 p-3", "# +P5", " #T5 P5 Z1", "   # P9 x", "\t#T5 P5", " #", "#\tP5", "\t# P5"]
REALS = ["0", "-0", "1e3", ".5", "5.", "-12.000001", "1e999", "-1e999", "1e-400", "0.1", "123456.789012", "+3"]
NINE = {
    "plain": b"T1 P5 Z10 D6\n", "hash text first": b"# words\nT1 P5 Z10 D6\n",
    "hash pocket first": b"# words P7\nT1 P5 Z10 D6\n",
    "hash pocket between": b"T1 P5 Z10 D6\n# words P7\nT2 P6 Z20 D3\n",
    "hash pocket last": b"T1 P5 Z10 D6\n# words P7\n", "hash pocket after semicolon": b"# words ; P7\nT1 P5 Z10 D6\n",
    "semicolon pocket first": b";T9 P9\nT1 P5 Z10 D6\n",
    "indented hash pocket first": b"  # words P7\nT1 P5 Z10 D6\n",
    "indented hash pocket last": b"T1 P5 Z10 D6\n  # words P7\n"}
FORMS = {
    "crlf": b"T1 P1 Z1 D6\r\nT2 P2 Z2\r\n", "a CR in a remark": b"T1 P1 ; a\rT9 P9\nT2 P2\n",
    "255 bytes": b"T5 P5 Z1 ; " + b"r" * (254 - 11) + b"\nT2 P2\n",
    "256 bytes": b"T5 P5 Z1 ; " + b"r" * (255 - 11 - 5) + b"T9 P9\nT2 P2\n",
    "a ghost": b"T5 P5 Z1 ; " + b"r" * (255 - 11) + b"T9 P9 Z5\nT2 P2\n",
    "a tab": b"T1 P1\tZ1\nT2 P2\n", "a tab behind the ;": b"T1 P1 Z1 ;\ta\nT2 P2\n", "NUL": b"T1 P1 ; a\0b\nT2 P2\n",
    "past ASCII": "T1 P1 Zä\nT2 P2\n".encode(), "past ASCII behind the ;": "T1 P1 Z1 ; ä\nT2 P2\n".encode("utf-8"),
    "a unit": b"T1 P1 Z1mm\nT2 P2\n", "a fraction": b"T1.5 P2.5\nT2 P2\n", "T -1": b"T-1 P1\nT2 P2\n",
    "a cut exponent": b"T1 P1 Z1e\nT2 P2\n", "lower case": b"t1 p1 z1 d6\nt2 p2\n", "any order": b"P1 D6 Z1 T1\nP2 T2\n",
    "every field": b"T1 P2 X1 Y2 Z3 A4 B5 C6 U7 V8 W9 D10 I11 J12 Q13\n", "a word twice": b"T1 P1 P2\nT2 P2\n",
    "an exponent": b"T1 P1 Z1e-3 D+1.5E1\n", "comments": b";Tool  Pocket\n\n   \n# words\nT1 P1\n",
    "a # line first": b"#T9 P9\nT1 P1\n", "a # line last": b"T1 P1\n#T9 P9\n", "T0": b"T0 P0 Z1\nT2 P2\n",
    "T twice": b"T1 P1 Z1\nT1 P2 Z2\n"}


def spellings(n):
    s, sign = str(abs(n)), "-" if n < 0 else ""
    out = [f"{sign}{s}", f"{sign}{s}.0", f"{sign}00{s}", f"{sign}{s}." + "0" * 40]
    return out + ([f"+{s}"] if n >= 0 else [])


def edge_files():
    for field in "TPQ":
        for v in EDGES:
            for sp in spellings(v):
                tok = {"T": "T5", "P": "P7", "Q": "Q3"}
                tok[field] = (field.lower() if len(sp) % 2 else field) + sp
                yield f"{field}: {tok[field]}", f"{tok['T']} {tok['P']} Z-10.5 D6 {tok['Q']} ; r\nT6 P6 Z1 D2\n".encode()


def fuzz_file(rnd):
    ints = [x for v in EDGES for x in spellings(v)]
    lines = []
    for k in range(rnd.randint(1, 5)):
        if rnd.random() < .25:
            lines.append(rnd.choice(JUNK))
            continue
        toks = [rnd.choice("Tt") + (rnd.choice(ints) if rnd.random() < .1 else str(k + 1)),
                rnd.choice("Pp") + (rnd.choice(ints) if rnd.random() < .1 else str(rnd.randint(0, 999)))]
        if rnd.random() < .5:
            toks.append("Q" + (rnd.choice(ints) if rnd.random() < .2 else str(rnd.randint(0, 9))))
        for c in rnd.sample(LETTERS, rnd.randint(0, 4)):
            toks.append(c + (rnd.choice(REALS) if rnd.random() < .3 else f"{rnd.uniform(-99, 99):.6f}"))
        rnd.shuffle(toks)
        line = " " * rnd.randint(0, 2) + (" " * rnd.randint(1, 3)).join(toks) + rnd.choice(["", " ", " ; rem", ";x", "\t"])
        if rnd.random() < .1:
            at = rnd.randint(0, len(line))
            line = line[:at] + rnd.choice(tg.PIECES) + line[at:]
        lines.append(line)
    return ("\n".join(lines) + "\n").encode()


def oracle(data):
    """[[index, T, P, Q, {letter: value that is not 0}], …], None: it crashed."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(data)
    try:
        r = subprocess.run([str(tg.ORACLE / "oracle"), f.name], capture_output=True)
    finally:
        pathlib.Path(f.name).unlink()
    if r.returncode:
        return None
    out = []
    for m in re.findall(rb"ROW ([^|\n]*)\|", r.stdout):
        w = m.split()
        reals = [float(x) for x in w[3:15]]
        out.append([int(w[0]), int(w[1]), int(w[2]), int(w[15]), {k: v for k, v in zip(LETTERS, reals) if v}])
    return out


def main():
    sha = hashlib.sha256((tg.ORACLE / "tooldata_common.cc").read_bytes()).hexdigest()
    if sha != tg.SOURCE:
        raise SystemExit(f"the oracle's source is {sha}")
    if "--fuzz" in sys.argv:
        sys.path.insert(0, str(ROOT / "lcnc-gateway"))
        from test_tool_load import TestAgainstLinuxCNCsOwnReader, why
        n, admitted, differ = int(sys.argv[sys.argv.index("--fuzz") + 1]), 0, 0
        rnd = random.Random(479)
        for k in range(n):
            data = fuzz_file(rnd)
            want, ours = oracle(data), TestAgainstLinuxCNCsOwnReader.ours(data)
            if why(data=data) is None:
                admitted += 1
                if ours != want:
                    raise SystemExit(f"admitted, but differs at case {k}: {data!r}\n  LinuxCNC {want}\n  ours     {ours}")
            elif ours != want:
                differ += 1
        print(f"{n} files: {admitted} admitted, all read the same as LinuxCNC; {n - admitted} refused, {differ} of them "
              f"read otherwise; oracle source {sha[:8]}…")
        return
    cases = [[f"R479: {n}", d.decode("latin-1"), oracle(d)] for n, d in NINE.items()]
    cases += [[n, d.decode("latin-1"), oracle(d)] for n, d in edge_files()]
    cases += [[f"form: {n}", d.decode("latin-1"), oracle(d)] for n, d in FORMS.items()]
    rnd = random.Random(480)
    cases += [[f"fuzz: {k}", d.decode("latin-1"), oracle(d)] for k, d in
              enumerate(x for x in (fuzz_file(rnd) for _ in range(400)) if len(x) < 160) if k < 120]
    cases = [c for c in cases if c[2] is not None]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text('{"source": "%s",\n "cases": [\n' % sha
                   + ",\n".join(json.dumps(c, ensure_ascii=True, separators=(",", ":")) for c in cases) + "\n]}\n")
    print(f"{len(cases)} cases -> {OUT.relative_to(ROOT)}; oracle source {sha[:8]}…")


if __name__ == "__main__":
    main()

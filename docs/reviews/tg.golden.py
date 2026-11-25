"""The golden of "tool guard": what LinuxCNC's OWN table reader makes of these
bytes — index, T, P, Q of every home entry — from upstream v2.9.4
tooldata_common.cc compiled unchanged (sha256 ae1e5120…, SHA256SUMS of
~/claude-work/bg/upstream-2.9.4/src/emc/tooldata), the mmap replaced by an
array (~/claude-work/p6/tf2/oracle/main.cc). Prints the literals of
lcnc-gateway/test_tool_guard.py (CASES, FUZZ); no test needs the oracle.

  python3 -I docs/reviews/tg.golden.py [--fuzz N]     the literals / a fuzz of
                                                      home_tools against it
"""
import hashlib
import pathlib
import random
import re
import subprocess
import sys
import tempfile

ORACLE = pathlib.Path.home() / "claude-work/p6/tf2/oracle"
SOURCE = "ae1e51206f4e15778802553daf0de9bb894e1ea4de1b83f4fa4b5af60d738b0e"

#: a remark the command admits (218 characters): its line has 266 bytes, and
#: what stands behind the 255th is a line of its own
GHOST = "r" * 207 + "T9 P9 Z5 D5"
HEAD = b";Tool  Pocket Z Offset     Diameter     Remark\n"
ROW2 = b"T2     P2     Z+00020.000000  D+0002.000000   ; two\n"


def padded(n):
    """A T5 line of exactly n bytes with its newline."""
    line = b"T5     P5     Z+00050.000000  D+0005.000000   ; "
    return line + b"r" * (n - len(line) - 1) + b"\n"


CASES = {
    # what the suite's own writer wrote at 24f3bd3a
    "ghost of the writer": HEAD + b"T1     P1     Z+00010.000000  D+0006.000000   ; " + GHOST.encode() + b"\n" + ROW2,
    "no ghost, but an index taken": HEAD + b"T1     P1     Z+00010.000000  D+0006.000000   ; r" + GHOST.encode() + b"\n" + ROW2,
    "255 bytes": padded(255) + ROW2,
    "256 bytes": padded(256) + ROW2,
    "257 bytes": padded(257) + ROW2,
    "a ghost past a comment": b";" + b"-" * 254 + b"T7 P7 Z7 D7\n" + ROW2,
    "numbers past 255": ("T5     P5     Z%+013.6f  D+0005.000000\n" % 1e300).encode() + ROW2,
    "a line break in the remark": b"T5 P5 Z50 D5 ; a\nT9 P9 Z5 D5\n" + ROW2,
    "a lone CR in the remark": b"T5 P5 Z50 D5 ; a\rT9 P9 Z5 D5\n" + ROW2,
    "Q past int32": b"T5 P5 Z50 D5 Q4294967299\n" + ROW2,
    "Q at its end": b"T5 P5 Z50 D5 Q2147483647\nT6 P6 Q-2147483648\n",
    "P past int32": b"T5 P4294967301 Z50 D5\n" + ROW2,
    "T past int32": b"T4294967301 P5 Z50 D5\n" + ROW2,
    "T past int64": b"T99999999999999999999 P5 Z50 D5\n" + ROW2,
    "T -1 is no tool": b"T-1 P5 Z50 D5\n" + ROW2,
    "a # line with P takes an index": b"T1 P1 Z1 D1\n#T3 P3 Z30\n" + ROW2,
    "a # line without P takes none": b"T1 P1 Z1 D1\n# old tools\n" + ROW2,
    "# and P behind its ;": b"# old ; T3 P3\n" + ROW2,
    "#; alone": b"#;T3 P3\n" + ROW2,
    "a ; line with P takes none": b"T1 P1 Z1 D1\n;T3 P3 Z30\n" + ROW2,
    "a ; line behind a blank": b" ;T3 P3 Z30\n" + ROW2,
    "an unknown letter takes one": b"T1 P1 E5\n" + ROW2,
    "P twice takes two": b"T1 P1 P4 Z1\n" + ROW2,
    "P without a number takes none": b"T1 Px Z1\n" + ROW2,
    "no P": b"T1 Z1\n" + ROW2,
    "P alone": b"P4 Z1\n" + ROW2,
    "lower case": b"t1 p1 z1\n" + ROW2,
    "a tab before T": b"\tT1 P1 Z1\n" + ROW2,
    "a tab inside": b"T1 P1\tZ1\n" + ROW2,
    "a tab behind the letter": b"T\t1 P\t1 Z1\n" + ROW2,
    "CRLF": b"T1 P1 Z1 D6\r\n" + ROW2,
    "CRLF behind a blank": b"T1 P1 Z1 D6 \r\n" + ROW2,
    "blank lines": b"\n   \nT1 P1 Z1\n\n" + ROW2,
    "a fraction": b"T1.5 P2.5 Q3.5 Z1\n" + ROW2,
    "a unit": b"T1 P1 Z1mm\n" + ROW2,
    "a number cut at its exponent": b"T1 P1 Z1e\nT3 P3 Z1e+\n" + ROW2,
    "no newline at the end": b"T1 P1 Z1\nT3 P3 Z5",
    "an empty file": b"",
    "only the header": HEAD,
}

PIECES = ["T1", "t2", "P1", "p3", "D6", "D+6.000000", "Z-10.5", "z.5", "X1e2", "Y-3.", "Q3", "Q+2.5", "I5", "J-5", "A1",
          "W0", " ", "  ", "\t", ";", "; a rem", "\r", " ", "#", "\x0b", "T", "Zx", "T1mm", "P3.5", "P", "Px", "x" * 120,
          "; " + "y" * 250, "-", "ä", "#T5 P5", "# P7", "Z1e", "Z1e+", "Z.", "Z+", "Z-.5e", "P99999999999",
          "P4294967301", "T-1", "T2147483648", "Z1..2", "1", "P\t5", "Q\v7", "E1", "T5 P5", "P-3", "#P1 P2"]


def fuzz_file(rnd):
    lines = []
    for _ in range(rnd.randint(1, 4)):
        if rnd.random() < .5:
            t = [f"T{rnd.randint(0, 60)}", f"P{rnd.randint(0, 60)}"] + rnd.sample(
                ["D6.125", "Z-12.000001", "X1", "Y2", "Q2", "I1.5", "J2"], rnd.randint(0, 4))
            rnd.shuffle(t)
            line = " ".join(t)
            if rnd.random() < .4:
                line += rnd.choice([" ; rem", " ;", ";x ; y"])
            if rnd.random() < .4:
                at = rnd.randint(0, len(line))
                line = line[:at] + rnd.choice(PIECES) + line[at:]
        else:
            line = "".join(rnd.choice(PIECES) + rnd.choice(["", " "]) for _ in range(rnd.randint(1, 6)))
        lines.append(line)
    return ("\n".join(lines) + rnd.choice(["\n", "\n", ""])).encode()


def oracle(data):
    """[(index, T, P, Q), …] of the home entries, or None (it crashed)."""
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(data)
    try:
        r = subprocess.run([str(ORACLE / "oracle"), f.name], capture_output=True)
    finally:
        pathlib.Path(f.name).unlink()
    if r.returncode:
        return None
    # (an unrecognized last line without a newline is echoed right before the rows)
    return [tuple(int(x) for x in m) for m in
            re.findall(rb"ROW (\d+) (-?\d+) (-?\d+) [^|\n]* (-?\d+)\|", r.stdout)]


def main():
    sha = hashlib.sha256((ORACLE / "tooldata_common.cc").read_bytes()).hexdigest()
    if sha != SOURCE:
        raise SystemExit(f"the oracle's source is {sha}")
    if "--fuzz" in sys.argv:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "lcnc-gateway"))
        from tool_table import ToolTableUnreadable, home_tools
        n, unknown = int(sys.argv[sys.argv.index("--fuzz") + 1]), 0
        rnd = random.Random(476)
        for k in range(n):
            data = fuzz_file(rnd)
            want = oracle(data)
            try:
                got = [(i, t, p) for i, (t, p) in sorted(home_tools(data).items())]
            except ToolTableUnreadable:
                unknown += 1
                continue
            if want is None or got != [w[:3] for w in want]:
                raise SystemExit(f"differs at case {k}: {data!r}\n  LinuxCNC {want}\n  ours     {got}")
        print(f"{n} files, {unknown} not mirrored (refused by name), {n - unknown} read the same as LinuxCNC; "
              f"oracle source {sha[:8]}…")
        return
    print(f"#: {sha} tooldata_common.cc")
    print("CASES = {")
    for name, data in CASES.items():
        print(f"    {name!r}: (\n        {data!r},\n        {oracle(data)!r}),")
    print("}\nFUZZ = [")
    rnd, seen = random.Random(1), 0
    while seen < 40:
        data = fuzz_file(rnd)
        got = oracle(data)
        # the ones worth keeping: an index that is not the row's position
        if len(data) > 200 or not got or all(i == n for n, (i, *_r) in enumerate(got, 1)):
            continue
        print(f"    ({data!r}, {got!r}),")
        seen += 1
    print("]")


if __name__ == "__main__":
    main()

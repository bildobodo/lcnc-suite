"""Scratch: the FORM rule (plan TF-2) against upstream v2.9.4 tooldata_load
(oracle/oracle, the source compiled unchanged): a file the rule admits reads
the same in LinuxCNC and in parse_tool_table_bytes."""
import os, random, subprocess, tempfile
from tool_table import parse_tool_table_bytes, write_tool_table
ORA = "/home/cnc/claude-work/p6/tf2/oracle/oracle"
F = ("X","Y","Z","A","B","C","U","V","W","D","I","J")

def form_refusal(data):
    """None, or (line, why): LinuxCNC would not read these bytes as this reader does."""
    if b"\r" in data: return (data[:data.index(b"\r")].count(b"\n")+1, "line ends")
    if b"\0" in data: return (data[:data.index(b"\0")].count(b"\n")+1, "control")
    for n, line in enumerate(data.split(b"\n"), 1):
        if len(line) + 1 > 255: return (n, "long")
        if line.lstrip(b" ")[:1] in (b"", b";"): continue
        if line.startswith(b"#"): continue
        part = line.partition(b";")[0]
        if any(not 0x20 <= c <= 0x7e for c in part): return (n, "control")
    return None

def linuxcnc(data):
    with tempfile.NamedTemporaryFile(dir="/home/cnc/claude-work/p6/tf2", delete=False) as f:
        f.write(data); p = f.name
    r = subprocess.run([ORA, p], capture_output=True); os.unlink(p)
    rows = []
    for l in r.stdout.splitlines():
        if not l.startswith(b"ROW "): continue
        w = l.partition(b"|")[0].split()
        rows.append((int(w[2]), int(w[3]), tuple(float(x) for x in w[4:16]), int(w[16])))
    return rows, r.stdout.count(b"Unrecognized")

def ours(data):
    unread = []
    rows = [(r["T"], r["P"], tuple(float(r.get(k, 0)) for k in F), int(r.get("Q", 0))) for r in parse_tool_table_bytes(data, unread=unread)]
    return rows, unread

PIECES = ["T1","t2","P1","p3","D6","D+6.000000","Z-10.5","z.5","X1e2","Y-3.","Q3","Q+2.000000","I5","J-5","A1","W0"," ","  ","\t",";","; a rem","\r"," ","#","\x0b","T","Zx","T1mm","P3.5","\x00","x"*120,"; "+"y"*250,"-","ä"]
def test_fuzz():
    rnd = random.Random(7); admitted = 0; differ = 0; refused_but_same = 0
    for _ in range(6000):
        lines = []
        for k in range(rnd.randint(1, 3)):
            if rnd.random() < .55:
                toks = [f"T{rnd.randint(0,60)}", f"P{rnd.randint(0,60)}"] + rnd.sample(["D6.125","Z-12.000001","X1","Y2","Q2","I1.5","J2","A3","W4"], rnd.randint(0,4))
                rnd.shuffle(toks); l = " ".join(toks)
                if rnd.random() < .4: l += rnd.choice([" ; rem"," ;", ";x ; y"])
                if rnd.random() < .25:
                    at = rnd.randint(0, len(l)); l = l[:at] + rnd.choice(PIECES) + l[at:]
            else:
                l = "".join(rnd.choice(PIECES) + rnd.choice(["", " "]) for _ in range(rnd.randint(1, 6)))
            lines.append(l)
        data = ("\n".join(lines) + "\n").encode()
        rows, unread = ours(data)
        lc, _sk = linuxcnc(data)
        same = sorted(rows) == sorted(lc)
        if form_refusal(data) is None and not unread:
            admitted += 1
            assert same, (data, rows, lc)
        elif not same:
            differ += 1
        else:
            refused_but_same += 1
    print("admitted", admitted, "refused and different", differ, "refused though the same", refused_but_same)

def test_our_own_writer_long_remark(tmp_path):
    p = str(tmp_path / "t.tbl")
    probe = write_tool_table(p, [{"T": 1, "P": 1, "Z": 10.0, "D": 6.0, "remark": "r"}]).split(b"\n")[1]
    remark = "r" * (255 - (len(probe) - 1)) + "T9 P9 Z5 D5"
    assert len(remark) <= 255
    data = write_tool_table(p, [{"T": 1, "P": 1, "Z": 10.0, "D": 6.0, "remark": remark}, {"T": 2, "P": 2, "Z": 1.0, "D": 3.0}])
    print(max(len(l) for l in data.split(b"\n")), [r[:2] for r in linuxcnc(data)[0]], [r[:2] for r in ours(data)[0]], form_refusal(data))

def test_shipped_tables_pass_the_form_rule():
    import glob
    seen = {}
    for p in glob.glob("/home/cnc/lcnc-suite-tf2/examples/**/*.tbl", recursive=True) + glob.glob("/home/cnc/linuxcnc/configs/**/*.tbl", recursive=True) + glob.glob("/usr/share/doc/linuxcnc/examples/**/*.tbl", recursive=True):
        if not os.path.exists(p): continue
        with open(p, "rb") as f: d = f.read()
        why = form_refusal(d); rows, unread = ours(d); lc, _ = linuxcnc(d)
        k = ("admitted" if why is None and not unread else "refused", "same" if sorted(rows) == sorted(lc) else "differ")
        seen.setdefault(k, []).append((os.path.relpath(p, "/"), why))
    for k, v in sorted(seen.items()): print(k, len(v), v[:6] if k != ("admitted", "same") else "")
    assert ("admitted", "differ") not in seen, seen.get(("admitted", "differ"))

"""Incremental reader over EVERY trace file (trace.ndjson, .1 … .5).

Each process of the suite rotates the shared trace with its own
RotatingFileHandler: after one rotates, the others keep writing into the
renamed inode (2026-10-22: the watchdog's records were in trace.ndjson.2
while the gateway wrote trace.ndjson). A reader of the newest one or two files
misses records; this one follows every file by inode and reads only what each
gained since the last call. A file is its inode AND its first bytes: a rotation
removes `.5`, and the new trace.ndjson may get its inode number (2026-10-25:
the new file was taken for the old one read to 52 MB and skipped — the run
waited for a publish it had)."""
import glob
import json
import os

LOGS = os.path.expanduser("~/lcnc-suite/runlogs")
HEAD = 48                               # a record's first bytes: its own time


class TraceTail:
    def __init__(self, floor_ns: int, logs: str = LOGS):
        self.floor = floor_ns           # records before this are never kept
        self.logs = logs
        self.off = {}                   # inode -> (first bytes, bytes read)
        self.recs = []                  # (t_wall_ns, record), arrival order

    def poll(self):
        for path in glob.glob(os.path.join(self.logs, "trace.ndjson*")):
            try:
                st = os.stat(path)
            except OSError:
                continue
            if st.st_size < HEAD:
                continue                         # no whole record yet
            with open(path, "rb") as f:
                head = f.read(HEAD)
                known = self.off.get(st.st_ino)
                start = known[1] if known and known[0] == head else 0
                if st.st_size <= start:
                    continue
                f.seek(start)
                data = f.read(st.st_size - start)
            end = data.rfind(b"\n") + 1          # a line still being written waits
            self.off[st.st_ino] = (head, start + end)
            for raw in data[:end].splitlines():
                if not raw.startswith(b'{"t_wall_ns":'):
                    continue
                try:
                    t = int(raw[13:raw.index(b",", 13)])
                except ValueError:
                    continue
                if t < self.floor:
                    continue
                try:
                    self.recs.append((t, json.loads(raw)))
                except ValueError:
                    pass
        return self

    def since(self, t0_ns: int):
        self.poll()
        out = [r for t, r in self.recs if t >= t0_ns]
        out.sort(key=lambda r: r["t_wall_ns"])
        return out

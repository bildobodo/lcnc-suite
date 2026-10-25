"""Two extra offline checks of the opened-file contract. No live paths."""
import builtins
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from tracetail import TraceTail


def row(t, tag):
    return (json.dumps({"t_wall_ns": t, "tag": tag, "pad": "x" * 80}, separators=(",", ":")) + "\n").encode()


class OpenedFile(unittest.TestCase):
    def test_rotation_after_open_before_fstat_keeps_the_old_descriptor(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "trace.ndjson"
            q = Path(d) / "trace.ndjson.1"
            p.write_bytes(row(100, "old1"))
            tail = TraceTail(0, d)
            self.assertEqual(len(tail.since(0)), 1)
            with p.open("ab") as f:
                f.write(row(101, "old2"))
            rotated = False
            real_open = builtins.open

            def open_then_rotate(path, *args, **kwargs):
                nonlocal rotated
                f = real_open(path, *args, **kwargs)
                if Path(path) == p and not rotated:
                    rotated = True
                    p.rename(q)
                    p.write_bytes(row(102, "gcode.publish"))
                return f

            with patch("tracetail.open", side_effect=open_then_rotate, create=True):
                tail.poll()
            self.assertTrue(rotated)
            # The already-open descriptor still supplies the unread old entry.
            self.assertEqual([r[1]["tag"] for r in tail.recs], ["old1", "old2"])
            self.assertEqual([r["tag"] for r in tail.since(0)], ["old1", "old2", "gcode.publish"])
            self.assertEqual(len(tail.since(0)), 3)

    def test_disappeared_path_waits_for_the_next_glob(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "trace.ndjson"
            q = Path(d) / "trace.ndjson.1"
            p.write_bytes(row(100, "old"))
            tail = TraceTail(0, d)
            real_open = builtins.open
            moved = False

            def move_then_open(path, *args, **kwargs):
                nonlocal moved
                if Path(path) == p and not moved:
                    moved = True
                    p.rename(q)
                return real_open(path, *args, **kwargs)

            with patch("tracetail.open", side_effect=move_then_open, create=True):
                tail.poll()
            self.assertTrue(moved)
            self.assertEqual(tail.recs, [])
            self.assertEqual([r["tag"] for r in tail.since(0)], ["old"])
            self.assertEqual(len(tail.since(0)), 1)


if __name__ == "__main__":
    unittest.main()

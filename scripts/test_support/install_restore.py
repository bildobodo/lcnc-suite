"""The install probe's restore — its unit's ExecStopPost (and nothing else):
restore_lan with the probe's host, whose tree is the run's CLONE (removed as a
folder of the run, never `git worktree remove` — Codex R329 FI329-04) and
whose isolation covers the operator's home links by their target (FI329-02).

  python3 -I scripts/test_support/install_restore.py --from <run>/pre.json --out <run>/restore-post.json [--no-lock]

--no-lock: the merge gate started the unit and holds the heavy lock until
the unit has ended, this restore included."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))   # scripts/
from test_support import restore_lan as rl  # noqa: E402
from test_support.install_cases import InstallProbeHost  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="pre", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--no-lock", action="store_true")
    a = ap.parse_args(argv)
    run = a.pre.resolve().parent
    if not a.pre.is_file():
        # the probe ended before it recorded the LAN instance: nothing was
        # stopped, nothing to return (the record is written before the stop)
        print(f"install_restore: no {a.pre} — the probe recorded nothing, nothing to restore")
        return 0
    return rl.main(["--from", str(a.pre), "--out", str(a.out)] + (["--no-lock"] if a.no_lock else []),
                   host_factory=lambda pre: InstallProbeHost(pre, run=run))


if __name__ == "__main__":
    raise SystemExit(main())

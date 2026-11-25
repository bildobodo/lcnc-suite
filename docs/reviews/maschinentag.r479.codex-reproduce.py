"""Reproduce the R479 offline probe in a new /tmp archive.

No gateway import, NML or Sim. Requires g++ and LinuxCNC headers.
R478's saved original-reader sources are reused, not a downloaded binary.
The display/observation sections are plan models, not implementation tests.
"""
from pathlib import Path
import io
import shutil
import subprocess
import sys
import tarfile
import tempfile

ev=Path(__file__).resolve().parent
repo=ev.parent.parent
work=Path(tempfile.mkdtemp(prefix='r479-repro-'))
tree=work/'tree';tree.mkdir()
raw=subprocess.check_output(['git','archive','d4b9239f','lcnc-gateway',
                             'scripts/test_support/heavy_lock.py'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    archive.extractall(tree,filter='data')
ora=work/'oracle';ora.mkdir()
for src in (ev/'maschinentag.r478.codex-oracle').iterdir():
    if src.suffix=='.py':
        (work/src.name).write_text(src.read_text().replace('/home/cnc/claude-work/p6/tf2',str(work)))
    else:
        shutil.copyfile(src,ora/src.name)
probe=(ev/'maschinentag.r479.codex-probe.py').read_text()
probe=probe.replace('/tmp/r479',str(work)).replace('/home/cnc/lcnc-suite/docs/reviews',str(ev))
probe=probe.replace('/tmp/r478/oracle/oracle',str(ora/'oracle'))
(work/'probe.py').write_text(probe)
sys.path.insert(0,str(tree/'scripts/test_support'))
from heavy_lock import heavy_lock
with heavy_lock('codex-r479-reproduction',wait=50):
    subprocess.check_call(['g++','-O2','-DULAPI','-I/usr/include/linuxcnc',
        str(ora/'main.cc'),str(ora/'tooldata_common.cc'),'-o',str(ora/'oracle')],cwd=work)
    subprocess.check_call(['python3','-B',str(work/'probe.py')],cwd=work)

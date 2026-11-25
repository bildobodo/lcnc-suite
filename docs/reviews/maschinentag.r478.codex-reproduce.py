"""R478 offline reproduction in /tmp, under the common heavy_lock.

No NML, no gateway import, no live machine. Needs g++, installed LinuxCNC
headers and a non-root user (the save-denied control uses mode 0444).
The optional argument names a Python with pytest; its environment is read
only. Product sources are archived at 24f3bd3a, not checked out or changed.
"""
from pathlib import Path
import io
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile

if os.getuid()==0:
    raise SystemExit('Run as an ordinary user: root would bypass the permission probe.')
ev=Path(__file__).resolve().parent
repo=ev.parent.parent
test_python=Path(sys.argv[1] if len(sys.argv)>1 else
    '/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python')
work=Path(tempfile.mkdtemp(prefix='r478-repro-'))
tree=work/'tree';tree.mkdir()
data=subprocess.check_output(['git','archive','24f3bd3a','lcnc-gateway',
                             'scripts/test_support/heavy_lock.py'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(data)) as archive:
    archive.extractall(tree,filter='data')
ora=work/'oracle';ora.mkdir()
for src in (ev/'maschinentag.r478.codex-oracle').iterdir():
    if src.suffix=='.py':
        (work/src.name).write_text(src.read_text().replace('/home/cnc/claude-work/p6/tf2',str(work)))
    else:shutil.copyfile(src,ora/src.name)
for src,out in [('maschinentag.r478.codex-probe.py','probe.py'),
                ('maschinentag.r478.codex-contracts.py','contracts.py')]:
    (work/out).write_text((ev/src).read_text().replace('/tmp/r478',str(work)))
for src,name in [('state.cc','state'),('main.cc','oracle')]:
    subprocess.check_call(['g++','-O2','-DULAPI','-I/usr/include/linuxcnc',
        str(ora/src),str(ora/'tooldata_common.cc'),'-o',str(ora/name)],cwd=work)
lock=['python3','-I',str(tree/'scripts/test_support/heavy_lock.py'),
      '--who','codex-r478-reproduction','--wait','50','--']
print('Archive:',tree,flush=True)
subprocess.check_call(lock+['python3','-B',str(work/'probe.py')],cwd=work)
subprocess.check_call(lock+[str(test_python),'-B','-m','pytest','-p','conftest','-q','-s',
    str(work/'test_form_rule2.py')+'::test_every_integer_field_at_its_edges_in_every_spelling',
    str(work/'test_form_rule2.py')+'::test_codex_r476',
    str(work/'test_form_rule2.py')+'::test_the_ith_row_is_index_i'],cwd=tree/'lcnc-gateway')
subprocess.check_call(['python3','-B',str(work/'contracts.py')],cwd=work)

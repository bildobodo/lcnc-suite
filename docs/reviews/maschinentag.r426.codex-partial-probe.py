"""R426 plan probe: partial record recovery must cross process boundaries.

No product implementation is simulated as a tested product. This exercises
the file protocol proposed in the plan: the lock alone cannot communicate
that a previous writer failed before its newline. Only /tmp files and our
own child processes are used. RLIMIT_FSIZE is EFBIG, not an ENOSPC claim.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PARTIAL = r'''
import errno, fcntl, json, os, resource, signal, sys
from pathlib import Path
p=Path(sys.argv[1]); lock=p.with_name(p.name+'.lock').open('a')
fcntl.flock(lock,fcntl.LOCK_EX)
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
resource.setrlimit(resource.RLIMIT_FSIZE,(64,64))
fd=os.open(p,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600)
line=b'{"tag":"first","payload":"'+b'x'*100+b'"}\n'
n=os.write(fd,line)
errors=[]
for remaining in [line[n:],b'\n']:
 try: os.write(fd,remaining)
 except OSError as e: errors.append(e.errno)
assert n==64 and errors==[errno.EFBIG,errno.EFBIG]
os.close(fd)
print(json.dumps({'written':n,'failed_remainder_and_newline':errors,'local_lost':1}))
'''

APPEND = r'''
import fcntl, os, sys
from pathlib import Path
p=Path(sys.argv[1]); lock=p.with_name(p.name+'.lock').open('a')
fcntl.flock(lock,fcntl.LOCK_EX)
fd=os.open(p,os.O_RDWR|os.O_APPEND)
# A fresh process has no previous writer's local damaged flag.
if sys.argv[2]=='inspect':
 n=os.fstat(fd).st_size
 if n and os.pread(fd,1,n-1)!=b'\n': os.write(fd,b'\n')
line=b'{"tag":"next","valid":true}\n'
assert os.write(fd,line)==len(line)
os.close(fd)
'''

def classify(path):
    good=[]
    damaged=0
    for line in path.read_bytes().splitlines():
        try: good.append(json.loads(line))
        except ValueError: damaged+=1
    return {'valid_records':good,'damaged_lines':damaged,'bytes':path.stat().st_size}

results={}
with tempfile.TemporaryDirectory(prefix='r426-partial-',dir='/tmp') as d:
    root=Path(d)
    for kind in ['new_python_writer','launcher_writer','tail_inspection_control']:
        p=root/(kind+'.ndjson')
        first=subprocess.run([sys.executable,'-I','-c',PARTIAL,str(p)],check=True,text=True,capture_output=True)
        first=json.loads(first.stdout)
        if kind=='launcher_writer':
            # Same lock scope and printf shape as the R426 plan's launcher.
            shell='( flock -w 0.02 9 || exit 1; printf "%s\\n" "$2" >> "$1" ) 9>"$1.lock"'
            subprocess.run(['bash','-c',shell,'r426',str(p),'{"tag":"next","valid":true}'],check=True)
        else:
            mode='inspect' if kind=='tail_inspection_control' else 'plain'
            subprocess.run([sys.executable,'-I','-c',APPEND,str(p),mode],check=True)
        result=classify(p)
        next_kept=any(r.get('tag')=='next' for r in result['valid_records'])
        assert next_kept==(kind=='tail_inspection_control')
        assert result['damaged_lines']==1
        results[kind]={'first_writer':first,'next_writer_exit':0,'next_record_kept':next_kept,**result}

print(json.dumps({'type':'plan mechanism counterexample plus control','results':results},indent=2))

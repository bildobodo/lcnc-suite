"""R425 plan counterexamples, not an implementation test.
Only temporary files; deterministic interleavings with a second process.
"""
import fcntl, json, os, subprocess, sys, tempfile
from pathlib import Path
ROOT=Path('/tmp/codex-r425')
ROTATE='''import os,sys
from pathlib import Path
p=Path(sys.argv[1]);n=int(sys.argv[2]);backups=int(sys.argv[3])
for gen in range(n):
 old=p.with_name(p.name+'.'+str(backups))
 old.unlink(missing_ok=True)
 for i in range(backups-1,0,-1):
  src=p.with_name(p.name+'.'+str(i))
  if src.exists(): src.rename(p.with_name(p.name+'.'+str(i+1)))
 p.rename(p.with_name(p.name+'.1'))
 p.write_text('new-'+str(gen)+'\\n')
'''
def visible(p):
 return {f.name:f.read_text() for f in sorted(p.parent.glob(p.name+'*')) if not f.name.endswith('.lock')}
def rotate(p,n=2,backups=1):
 subprocess.run([sys.executable,'-c',ROTATE,str(p),str(n),str(backups)],check=True)
results={}
with tempfile.TemporaryDirectory(prefix='r425-files-',dir='/tmp') as td:
 p=Path(td)/'trace.ndjson';p.write_text('before\n')
 fd=os.open(p,os.O_WRONLY|os.O_APPEND)
 checked=os.fstat(fd).st_ino==p.stat().st_ino
 rotate(p)
 os.write(fd,b'checked-writer-late\n')
 links=os.fstat(fd).st_nlink;os.close(fd)
 view=visible(p)
 assert checked and links==0 and all('checked-writer-late' not in x for x in view.values())
 results['stat_then_write']={'same_inode_before_rotation':checked,'fd_links_at_write':links,'visible':view,'record_lost':True}
 # A shell redirection also resolves the pathname only when it opens the fd.
 fd=os.open(p,os.O_WRONLY|os.O_APPEND);rotate(p)
 os.write(fd,b'reopened-per-line-late\n');os.close(fd)
 view=visible(p);assert all('reopened-per-line-late' not in x for x in view.values())
 results['reopen_each_line']={'visible':view,'record_lost':True}
 # Actual other process owns the lock; the suggested fallback keeps writing.
 lock=p.with_name(p.name+'.lock')
 child_code='''import fcntl,sys,subprocess
from pathlib import Path
lock=Path(sys.argv[1]);f=lock.open('a');fcntl.flock(f,fcntl.LOCK_EX)
print('locked',flush=True);sys.stdin.readline()
subprocess.run([sys.executable,'-c',sys.argv[3],sys.argv[2],'2','1'],check=True)
print('rotated',flush=True);sys.stdin.readline()
'''
 child=subprocess.Popen([sys.executable,'-c',child_code,str(lock),str(p),ROTATE],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
 assert child.stdout.readline().strip()=='locked'
 mine=lock.open('a');locked=False
 try:fcntl.flock(mine,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError:locked=True
 assert locked
 fd=os.open(p,os.O_WRONLY|os.O_APPEND)
 child.stdin.write('rotate\n');child.stdin.flush();assert child.stdout.readline().strip()=='rotated'
 os.write(fd,b'fallback-late\n');links=os.fstat(fd).st_nlink;os.close(fd)
 child.stdin.write('end\n');child.stdin.flush();child.wait(timeout=5);mine.close()
 view=visible(p);assert links==0 and all('fallback-late' not in x for x in view.values())
 results['lock_busy_fallback']={'lock_refused':locked,'fd_links_at_write':links,'visible':view,'record_lost':True}
 # A rotating path list is not a snapshot: A appears twice, C is lost.
 p.write_text('A\n');p.with_name(p.name+'.1').write_text('B\n');p.with_name(p.name+'.2').write_text('C\n')
 paths=[p,p.with_name(p.name+'.1'),p.with_name(p.name+'.2')]
 read=[paths[0].read_text().strip()];rotate(p,n=1,backups=2)
 read += [x.read_text().strip() for x in paths[1:]]
 assert read==['A','A','B']
 results['reader_path_list']={'snapshot_at_enumeration':['A','B','C'],'read_by_original_names':read,'duplicate_A':True,'missing_C':True}
 # Use the current trace code with an explicitly isolated log directory.
 logs=Path(td)/'real-trace';logs.mkdir()
 trace_code='''import sys
sys.path.insert(0,sys.argv[1]);import lcnc_trace
lcnc_trace.init('r425-probe',sys.argv[2]);lcnc_trace.emit('crash.r425',level='error',msg='synthetic isolated review record')
'''
 subprocess.run([sys.executable,'-I','-c',trace_code,str(ROOT/'lcnc-gateway'),str(logs)],check=True)
 a=[x for x in (logs/'trace.ndjson').read_text().splitlines() if 'crash.r425' in x]
 b=[x for x in (logs/'crash.log').read_text().splitlines() if 'crash.r425' in x]
 assert len(a)==len(b)==1 and a==b
 results['crash_fanout']={'logical_emits':1,'trace_records':len(a),'crash_records':len(b),'identical_records':a==b}
 # RLIMIT_FSIZE is a file-size boundary; short write precedes EFBIG.
 short_code='''import errno,json,os,resource,signal,sys
signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
resource.setrlimit(resource.RLIMIT_FSIZE,(64,64))
f=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
n=os.write(f,b'{"payload":"'+b'x'*300+b'"}\\n')
err=None
try:os.write(f,b'next\\n')
except OSError as e:err=e.errno
os.close(f);print(json.dumps({'first_write_bytes':n,'second_errno':err,'EFBIG':errno.EFBIG}))
'''
 r=subprocess.run([sys.executable,'-c',short_code,str(Path(td)/'limited')],check=True,text=True,capture_output=True)
 short=json.loads(r.stdout);assert short['first_write_bytes']==64 and short['second_errno']==short['EFBIG']
 results['rlimit_fsize']=short
print(json.dumps({'kind':'deterministic plan probes, no live access','results':results},indent=2))

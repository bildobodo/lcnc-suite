"""Verify the pinned archive and native evidence before publishing the review."""
from pathlib import Path
import subprocess,json,hashlib,re,sys
repo=Path(sys.argv[1]);root=Path(sys.argv[2]);arc=root/'archive';E=root/'evidence';ctx=json.loads((E/'context.json').read_text())
rows=[]
for row in subprocess.check_output(['git','ls-tree','-rz',ctx['head']],cwd=repo).split(b'\0'):
 if row:
  meta,path=row.split(b'\t',1);mode,typ,oid=meta.decode().split()
  if typ=='blob':rows.append((path.decode(),oid,mode))
p=subprocess.Popen(['git','cat-file','--batch'],cwd=repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
same=0;lfs=[];bad=[]
for path,oid,mode in rows:
 p.stdin.write((oid+'\n').encode());p.stdin.flush();hdr=p.stdout.readline().split();body=p.stdout.read(int(hdr[2]));assert p.stdout.read(1)==b'\n'
 f=arc/path;actual=str(f.readlink()).encode() if mode=='120000' else f.read_bytes()
 if actual==body:same+=1
 elif body.startswith(b'version https://git-lfs.github.com/spec/v1'):
  h=re.search(rb'oid sha256:(\w+)',body).group(1).decode();n=int(re.search(rb'size (\d+)',body).group(1))
  if len(actual)!=n or hashlib.sha256(actual).hexdigest()!=h:bad.append(path)
  else:lfs.append(path)
 else:bad.append(path)
p.stdin.close();p.wait();assert not bad,bad
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();status=subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True)
assert head==ctx['head'] and not status,(head,status)
assert hashlib.sha256((repo/'docs/reviews/viewer-palette-fest.ideen.md').read_bytes()).hexdigest()==ctx['live_review_sha256']
native={**json.loads((E/'native.json').read_text()),**json.loads((E/'python-cases.json').read_text())}
assert len(native)==18
assert all(x['returncode']==0 and x['data']['parse_error'] is None and x['data']['mmap_unchanged'] for x in native.values())
base=json.loads((E/'baseline.json').read_text())['results'];assert len(base)==5
assert all(x['returncode']==0 and x['data']['parse_error'] is None and x['data']['mmap_unchanged'] for x in base.values())
trace=json.loads((E/'trace.json').read_text());assert len(trace)==4 and all(x['data_identical_to_untraced'] for x in trace.values())
ctx.update({'same_git_blob_files':same,'verified_lfs_files':len(lfs),'product_changes':bad,'live_head_at_finish':head,'live_status_before_evidence':status,'no_live_ports_or_machine_commands':True,'nice':19,'vitest_workers':1,'tests':{'backend':74,'client_repository':118,'native_inputs':18,'baseline_native_inputs':5,'traced_native_inputs':4,'own_client_tests':4},'build':'not repeated; product change Python only'})
(E/'context.json').write_text(json.dumps(ctx,indent=2)+'\n');print(json.dumps(ctx,indent=2))

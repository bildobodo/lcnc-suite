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
native={}
for n in ['replay','extra','motion','controls']:native.update(json.loads((E/(n+'.json')).read_text()))
assert len(native)==42
fails={k:v for k,v in native.items() if v['returncode']!=0}
expected={'python_m6_g30_zero','python_m6_quill_zero','python_m6_both_zero'}
assert set(fails)==expected
assert all('OverflowError: Python integer -1 out of bounds for uint32' in v['stderr'] for v in fails.values())
assert all(x['data']['parse_error'] is None and x['data']['mmap_unchanged'] for k,x in native.items() if k not in fails)
base=json.loads((E/'baseline.json').read_text())['results'];assert len(base)==9
assert {k for k,v in base.items() if v['returncode']!=0}==expected
assert all(x['data']['parse_error'] is None and x['data']['mmap_unchanged'] for x in base.values() if x['returncode']==0)
trace=json.loads((E/'trace.json').read_text());assert len(trace)==8 and all(x['data_identical_to_untraced'] for x in trace.values())
assert (E/'backend.txt').read_text().count('.')==500
ctx.update({'same_git_blob_files':same,'verified_lfs_files':len(lfs),'product_changes':bad,'live_head_at_finish':head,'live_status_before_evidence':status,'no_live_ports_or_machine_commands':True,'nice':19,'vitest_workers':1,'tests':{'backend':500,'client_repository':118,'native_inputs':42,'native_completed':39,'native_exceptions':sorted(fails),'baseline_native_inputs':9,'baseline_completed':6,'traced_native_inputs':8,'own_client_tests':5},'build':'not repeated; product change Python only'})
(E/'context.json').write_text(json.dumps(ctx,indent=2)+'\n');print(json.dumps(ctx,indent=2))

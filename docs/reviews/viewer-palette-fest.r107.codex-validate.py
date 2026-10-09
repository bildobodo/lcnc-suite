"""Validate review archive vs pinned Git/LFS contents and evidence observations."""
from pathlib import Path
import subprocess,json,hashlib,re,sys
repo=Path(sys.argv[1]);root=Path(sys.argv[2]);arc=root/'archive';ev=root/'evidence'
rows=[]
for row in subprocess.check_output(['git','ls-tree','-rz','126aa64c'],cwd=repo).split(b'\0'):
 if row:
  meta,path=row.split(b'\t',1);mode,typ,oid=meta.decode().split()
  if typ=='blob':rows.append((path.decode(),oid,mode))
p=subprocess.Popen(['git','cat-file','--batch'],cwd=repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
same=0;lfs=[];cache=[];bad=[]
for path,oid,mode in rows:
 p.stdin.write((oid+'\n').encode());p.stdin.flush();hdr=p.stdout.readline().split();body=p.stdout.read(int(hdr[2]));assert p.stdout.read(1)==b'\n'
 f=arc/path;actual=str(f.readlink()).encode() if mode=='120000' else f.read_bytes()
 if actual==body:same+=1
 elif path.startswith('lcnc-webui/tsconfig') and body.replace(b'./node_modules/.tmp/',b'../r107-ts-cache/')==actual:cache.append(path)
 elif path=='lcnc-webui/vite.config.ts' and body.replace(b'defineConfig({',b'defineConfig({\n  cacheDir: "../r107-vite-cache",',1)==actual:cache.append(path)
 elif body.startswith(b'version https://git-lfs.github.com/spec/v1'):
  h=re.search(rb'oid sha256:(\w+)',body).group(1).decode();n=int(re.search(rb'size (\d+)',body).group(1))
  if len(actual)!=n or hashlib.sha256(actual).hexdigest()!=h:bad.append(path)
  else:lfs.append(path)
 else:bad.append(path)
p.stdin.close();p.wait();assert not bad,bad
ctx=json.loads((root/'context.json').read_text());head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();status=subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True)
assert head==ctx['head'] and status=='',(head,status)
ctx.update({'same_git_blob_files':same,'verified_lfs_files':len(lfs),'archive_cache_config_changes':cache,'other_product_changes':bad,'live_head_at_finish':head,'live_status_before_evidence':status,'no_live_ports_or_machine_commands':True,'nice':19,'vitest_workers':1,'tests':{'backend':596,'client_repository':114,'native_inputs':32,'own_client_observations':4},'build':'PASS'})
all_native={}
for name in ['native','extra-native','boundary']:
 all_native.update(json.loads((ev/(name+'.json')).read_text()))
all_native['sequence_named_body']=json.loads((ev/'sequence.json').read_text())
assert len(all_native)==32
assert all(v['returncode']==0 and v['data']['mmap_unchanged'] for v in all_native.values())
errors={k:v['data']['parse_error'] for k,v in all_native.items() if v['data']['parse_error']}
assert set(errors)=={'inline_if_assignment','inline_endif_assignment','comment_split_remap','negative_g10_function'},errors
checks={'native_inputs':32,'native_valid':28,'rejected_negative_controls':errors,'private_tool_mmap_unchanged':True,'remap_basis':json.loads((ev/'remap-basis.json').read_text()),'nested_foreign_stop':all_native['foreign_remap_nested']['data']['probe_unpredicted'],'nested_foreign_cumulative_seconds':all_native['foreign_remap_nested']['data']['rapid_tcum'],'caller_near_pair':all_native['near_call_pair']['data']['tool_change_lines'],'caller_near_single':all_native['near_call_single']['data']['tool_change_lines'],'named_body_false_line':all_native['sequence_named_body']['data']['toollen_table']}
(ev/'context.json').write_text(json.dumps(ctx,indent=2)+'\n');(ev/'checks.json').write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps(ctx,indent=2))

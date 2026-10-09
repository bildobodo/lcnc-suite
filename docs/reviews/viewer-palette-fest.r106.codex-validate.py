"""Validate archive against git blobs/LFS; permits only local cache-path edits."""
from pathlib import Path
import subprocess,json,hashlib,re,sys
repo=Path(sys.argv[1]);root=Path(sys.argv[2]);arc=root/'archive';ev=root/'evidence'
rows=[]
for row in subprocess.check_output(['git','ls-tree','-rz','c9a9c9e1'],cwd=repo).split(b'\0'):
 if row:
  meta,path=row.split(b'\t',1);mode,typ,oid=meta.decode().split()
  if typ=='blob':rows.append((path.decode(),oid,mode))
p=subprocess.Popen(['git','cat-file','--batch'],cwd=repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
same=0;lfs=[];changed=[];bad=[]
for path,oid,mode in rows:
 p.stdin.write((oid+'\n').encode());p.stdin.flush();header=p.stdout.readline().split();body=p.stdout.read(int(header[2]));assert p.stdout.read(1)==b'\n'
 f=arc/path;actual=str(f.readlink()).encode() if mode=='120000' else f.read_bytes()
 if actual==body:same+=1
 elif path.startswith('lcnc-webui/tsconfig') and body.replace(b'./node_modules/.tmp/',b'../r106-ts-cache/')==actual:changed.append(path)
 elif path=='lcnc-webui/vite.config.ts' and body.replace(b'defineConfig({',b'defineConfig({\n  cacheDir: "../r106-vite-cache",',1)==actual:changed.append(path)
 elif body.startswith(b'version https://git-lfs.github.com/spec/v1'):
  h=re.search(rb'oid sha256:(\w+)',body).group(1).decode();n=int(re.search(rb'size (\d+)',body).group(1))
  if len(actual)!=n or hashlib.sha256(actual).hexdigest()!=h:bad.append(path)
  else:lfs.append(path)
 else:bad.append(path)
p.stdin.close();p.wait();assert not bad,bad
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip();status=subprocess.check_output(['git','status','--short'],cwd=repo,text=True)
ctx=json.loads((root/'context.json').read_text());ctx.update({'same_git_blob_files':same,'verified_lfs_files':len(lfs),'lfs_files':lfs,'archive_cache_config_changes':changed,'other_product_changes':bad,'live_head_at_finish':head,'live_status_before_evidence':status,'no_live_ports_or_machine_commands':True,'nice':19,'vitest_workers':1,'tests':{'backend':576,'client_repository':220,'own_native_cases':18,'own_client_observations':3},'build':'PASS'})
assert head==ctx['head'];assert status==''
(ev/'context.json').write_text(json.dumps(ctx,indent=2)+'\n')
for n in ['native','basis','startpaths','cancel','entry','notes','caller','extra-native','remap-basis']:json.loads((ev/(n+'.json')).read_text())
v=json.loads((ev/'native.json').read_text());assert len(v)==12
assert all(x['returncode']==0 and x['data']['parse_error'] is None and x['data']['mmap_unchanged'] for x in v.values())
checks={'native_cases':len(v),'native_parses_without_error':True,'native_tool_mmap_unchanged':True,'assignments_all_reach_x4':all(x['data']['rapid'][-1][0]==4 for n,x in v.items() if n.startswith('assign_')),'foreign_control_has_stop':bool(v['foreign_control']['data']['probe_unpredicted']),'foreign_variants_missing_stop':[n for n,x in v.items() if n.startswith('foreign_') and not x['data']['probe_unpredicted']],'task_path_fixture_matches_base':hashlib.sha256(subprocess.check_output(['git','show','9e6c9cb5:subroutines/tool_length_probe/tool_touch_off.ngc'],cwd=repo)).hexdigest()==hashlib.sha256((arc/'scripts/test_fixtures/tool_touch_off.before_preview.ngc').read_bytes()).hexdigest()}
extra=json.loads((ev/'extra-native.json').read_text())
assert len(extra)==6 and all(x['returncode']==0 and x['data']['mmap_unchanged'] for x in extra.values())
valid=['near_call_pair','near_call_single','remap_write','foreign_remap_nested']
assert all(extra[n]['data']['parse_error'] is None for n in valid)
assert all(extra[n]['data']['parse_error']=='Unexpected character after O-word' for n in ['inline_if_assignment','inline_endif_assignment'])
checks.update({'additional_valid_native_programs':valid,'additional_rejected_negative_controls':['inline_if_assignment','inline_endif_assignment'],
 'remap_write_native_x':extra['remap_write']['data']['rapid'][-1][0],
 'nested_foreign_stop':extra['foreign_remap_nested']['data']['probe_unpredicted'],
 'near_integer_call_lines':extra['near_call_pair']['data']['tool_change_lines'],
 'entry':json.loads((ev/'entry.json').read_text())['entry'],
 'remap_basis':json.loads((ev/'remap-basis.json').read_text())})
assert not checks['foreign_variants_missing_stop']
(ev/'checks.json').write_text(json.dumps(checks,indent=2)+'\n');print(json.dumps({k:v for k,v in ctx.items() if k!='lfs_files'},indent=2))

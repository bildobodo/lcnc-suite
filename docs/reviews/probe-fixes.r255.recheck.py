"""R255 offline review: original R254 probe, exact diff, each-site regression.
Usage: python recheck.py ARCHIVE_REPO LIVE_GIT_DIR OUT_DIR
Only ARCHIVE_REPO and OUT_DIR are written. No LinuxCNC import or connection.
"""
from pathlib import Path
import contextlib,hashlib,io,json,re,subprocess,sys,unittest
repo,gitroot,out=map(lambda x:Path(x).resolve(),sys.argv[1:])
out.mkdir(exist_ok=True,parents=True)
assert str(repo).startswith('/tmp/'),repo
BASE='b9e29335'; HEAD='a12c2443'
def git(*args): return subprocess.check_output(['git',*args],cwd=gitroot)
def snapshot():
    return {str(f.relative_to(repo)):hashlib.sha256(f.read_bytes()).hexdigest()
            for folder in ['subroutines','lcnc-gateway','lcnc-webui','scripts','examples']
            for f in (repo/folder).rglob('*') if f.is_file() and '__pycache__' not in f.parts}
before=snapshot()
changed=git('diff','--name-only',BASE,HEAD,'--','subroutines').decode().splitlines()
files=[p for p in changed if p.endswith('.ngc')]
assert len(files)==10,files
sites=[]
for rel in files:
    old=git('show',f'{BASE}:{rel}'); new=(repo/rel).read_bytes()
    assert new==old.replace(b'[3017]',b'[#3017]'),rel
    oldlines=old.decode().splitlines(); newlines=new.decode().splitlines()
    for number,(a,b) in enumerate(zip(oldlines,newlines),1):
        if a!=b:sites.append({'file':rel,'line':number,'old':a,'new':b})
assert len(sites)==38
assert git('diff','--name-only',BASE,HEAD,'--','lcnc-webui')==b''
# Re-run the previous round's probe verbatim, no new acceptance condition.
probe=gitroot/'docs/reviews/probe-fixes.r254.traverse-guard.py'
p=subprocess.run([sys.executable,str(probe),str(repo),str(out/'original-r254.json')],capture_output=True,text=True)
print('UNCHANGED R254 PROBE\n'+p.stdout+p.stderr); assert p.returncode==0
sys.path.insert(0,str(repo/'lcnc-gateway'))
import test_ngc_fixtures as fixture
print('REPOSITORY NGC SUITE')
res=unittest.TextTestRunner(stream=sys.stdout,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(fixture))
assert res.wasSuccessful()
# Test the repository guard itself, not a copied predicate.
def guard():
    case=fixture.TestRoutineCallArguments('test_no_call_passes_a_var_number_as_a_literal')
    case.maxDiff=None
    r=unittest.TestResult(); case.run(r)
    assert not r.errors,r.errors
    return r
mutations=[]
for s in sites:
    path=repo/s['file']; saved=path.read_bytes()
    lines=saved.decode().splitlines(keepends=True)
    assert lines[s['line']-1].rstrip('\n')==s['new']
    lines[s['line']-1]=s['old']+'\n'
    try:
        path.write_text(''.join(lines))
        r=guard(); assert len(r.failures)==1,(s,r.failures)
        assert f"{s['file']}:{s['line']}: [3017]" in r.failures[0][1],r.failures
        mutations.append({'file':s['file'],'line':s['line'],'guard':'red, exact site'})
    finally:path.write_bytes(saved)
# All original routines together: exactly the 38 previously reported errors.
saved={rel:(repo/rel).read_bytes() for rel in files}
try:
    for rel in files:(repo/rel).write_bytes(git('show',f'{BASE}:{rel}'))
    r=guard(); assert len(r.failures)==1
    details=r.failures[0][1]
    assert '38 additional elements' in details,details
    (out/'old-guard.txt').write_text(details)
finally:
    for rel,data in saved.items():(repo/rel).write_bytes(data)
assert guard().wasSuccessful()
assert before==snapshot(),'Review mutations not fully restored'
# How many real call sites the repository guard visits (not only the 112 helpers).
calls=sum(bool(fixture.TestRoutineCallArguments.CALL.search(fixture.strip_gcode_comments(line)))
          for file in fixture._ngc_files() for line in Path(file).read_text(errors='replace').splitlines())
result={'base':BASE,'head':HEAD,'kind':'offline static source + repository tests, no native motion',
        'changed_ngc_files':len(files),'exact_literal_replacements':len(sites),
        'repository_tests':res.testsRun,'r254_probe':json.loads((out/'original-r254.json').read_text()),
        'repository_call_sites_seen':calls,'single_site_mutants_rejected':len(mutations),
        'all_old_calls_rejected':38,'source_files_restored_byte_identical':len(before),
        'frontend_unchanged':True,'mutations':mutations}
(out/'results.json').write_text(json.dumps(result,indent=2))
print('SUMMARY '+json.dumps({k:v for k,v in result.items() if k not in ['mutations','r254_probe']}))

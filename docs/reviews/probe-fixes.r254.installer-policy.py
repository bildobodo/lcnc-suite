"""R254: archived example upgrade and real emitted payloads through W3.
No gateway connection or machine command; all installs live in TemporaryDirectory.
"""
import sys,json
from pathlib import Path
repo=Path(sys.argv[1]).resolve(); out=Path(sys.argv[2]).resolve()
sys.path.insert(0,str(repo/'lcnc-gateway'))
from test_example_install import ExampleInstallTest,installer,CATALOG
from command_policy import MachineLimits,validate_payload
clicks=json.loads((out/'calibration-clicks.json').read_text());assert len(clicks)==24
case=ExampleInstallTest();case.setUp();result=[]
try:
    case.install();before={}
    for index,p in enumerate(CATALOG['profiles']):
        rel=p['state_dir']+'/sim.var'; target=case.dest/rel
        lines=target.read_text().splitlines()
        lines=[l for l in lines if l.split()[0]!='3036']
        # Two missing declarations and one preexisting operator choice.
        if index==2:
            lines.append('3036\t2.000000');lines.sort(key=lambda l:int(l.split()[0]))
        lines=['5221\t765.432100' if l.split()[0]=='5221' else l for l in lines]
        target.write_text('\n'.join(lines)+'\n');before[rel]=target.read_bytes()
    report=[]; backup=installer.install(repo,case.dest,case.backups,report=report)
    for index,p in enumerate(CATALOG['profiles']):
        rel=p['state_dir']+'/sim.var';rows=(case.dest/rel).read_text().splitlines()
        values={int(l.split()[0]):float(l.split()[1]) for l in rows}
        assert values[3036]==(2 if index==2 else 0)
        assert values[5221]==765.4321
        assert (backup/'config'/rel).read_bytes()==before[rel]
        assert all(l in rows for l in before[rel].decode().splitlines())
        nums=[int(l.split()[0]) for l in rows];assert nums==sorted(set(nums))
        admitted=0; denied=0
        for item in clicks:
            command=item['command']
            for name in ['mdi','set_probe_vars']:
                assert validate_payload(name,command,MachineLimits(declared_vars=frozenset(nums)))=={}
                admitted+=1
                try:
                    validate_payload(name,command,MachineLimits(declared_vars=frozenset(nums)-{3036}))
                    raise AssertionError('missing #3036 unexpectedly accepted')
                except ValueError as exc:
                    assert '#3036 is not in' in str(exc);denied+=1
        result.append({'profile':p['state_dir'],'inserted':index!=2,'value3036':values[3036],
            'backup_exact':True,'existing_rows_kept':True,'admitted_actual_clicks_both_paths':admitted,
            'same_clicks_rejected_without3036':denied})
    assert case.install() is None
    result.append({'rerun':'no change','report':report})
finally:
    case.doCleanups()
(out/'installer-policy.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))

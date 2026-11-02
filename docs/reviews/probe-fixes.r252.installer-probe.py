"""R252: isolated installer boundary, backup, rerun and W3 checks.
Run with the archived repo path; never reads or writes a live config.
"""
import sys
import json
from pathlib import Path
from unittest.mock import patch

repo = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(repo / 'lcnc-gateway'))
from test_example_install import ExampleInstallTest, installer, CATALOG
from command_policy import MachineLimits, validate_payload

results = []
template = '2999 29\n3000 30\n3015 50\n3999 39\n4000 40\n5161 51\n5221 52\n'
local = ' 3015\t123.456\n3100 -456\n5183 789\n5221 987'
merged, added = installer.declare_template_vars(local, template)
assert added == [3000, 3999], added
assert merged == '3000 30\n 3015\t123.456\n3100 -456\n3999 39\n5183 789\n5221 987\n', merged
again, added_again = installer.declare_template_vars(merged, template)
assert again == merged and added_again == []
results.append({'boundary': 'PASS', 'added': added, 'outside_3000_3999_added': False,
                'existing_text_preserved': True, 'missing_final_newline_completed': True})

case = ExampleInstallTest()
case.setUp()
try:
    case.install()
    before = {}
    for profile in CATALOG['profiles']:
        rel = profile['state_dir'] + '/sim.var'
        var = case.dest / rel
        rows = [line for line in var.read_text().splitlines()
                if not (3015 <= int(line.split()[0]) <= 3059)]
        rows = ['3014\t7.250000' if line.split()[0] == '3014' else
                '5183\t-123.456000' if line.split()[0] == '5183' else
                '5221\t98.765000' if line.split()[0] == '5221' else line for line in rows]
        var.write_text('\n'.join(rows) + '\n')
        before[rel] = var.read_bytes()
    # The no-running-controller guard must reject before any file or backup is changed.
    prior_backups = set(case.backups.glob('*'))
    with patch.object(installer, 'assert_stopped', side_effect=RuntimeError('test: running controller')):
        try:
            case.install()
            raise AssertionError('guard not called')
        except RuntimeError as exc:
            assert str(exc) == 'test: running controller'
    assert set(case.backups.glob('*')) == prior_backups
    assert all((case.dest / rel).read_bytes() == raw for rel, raw in before.items())
    report = []
    backup = installer.install(repo, case.dest, case.backups, report=report)
    for rel, raw in before.items():
        assert (backup / 'config' / rel).read_bytes() == raw
        data = (case.dest / rel).read_text()
        assert all(line in data.splitlines() for line in raw.decode().splitlines())
        vals = {int(line.split()[0]): float(line.split()[1]) for line in data.splitlines() if line.strip()}
        keys = [int(line.split()[0]) for line in data.splitlines() if line.strip()]
        assert keys == sorted(set(keys))
        assert vals[3014] == 7.25 and vals[5183] == -123.456 and vals[5221] == 98.765
        written = {str(k): vals[k] for k in [*range(3014,3036), *range(3050,3060)]}
        limits = MachineLimits(declared_vars=frozenset(keys))
        for cmd in ['set_probe_vars', 'mdi']:
            assert validate_payload(cmd, {'cmd': cmd, 'vars': written, 'line': 'o<probe_xplus> call'}, limits) == {}
            for key in [3998, 5221]:
                try:
                    validate_payload(cmd, {'vars': {str(key): 1}}, limits)
                    raise AssertionError(f'{cmd} accepted {key}')
                except ValueError as exc:
                    assert ('not in this machine' if key == 3998 else 'reserved system') in str(exc)
        results.append({'profile': rel, 'PASS': True, 'new_rows': len(keys)-len(raw.decode().splitlines()),
                        'backup_exact': True, 'existing_rows_kept': True, 'all_32_probe_numbers_admitted': True,
                        'undeclared_and_system_writes_rejected': True})
    assert case.install() is None
    results.append({'rerun': 'no changes', 'guard_before_write_and_backup': 'PASS', 'report': report})
finally:
    case.doCleanups()
print(json.dumps(results, indent=2))

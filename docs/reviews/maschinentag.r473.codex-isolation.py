"""No pytest/conftest import. Only synthetic discovery; no host connection."""
import json,sys
from unittest.mock import patch
import session_bind
calls=[]
def pretend_host(proc_root='/proc',comm='linuxcncsvr'):
    calls.append([proc_root,comm])
    return (888,999),[(888,999)]
session_bind.discover_instance=pretend_host
import fake_linuxcnc
fake_linuxcnc.install()
first=session_bind.discover_instance
fake_linuxcnc.install()
assert session_bind.discover_instance is first
for path in ['/proc','/proc/','/proc/../proc']:
    assert session_bind.discover_instance(path)==(None,[])
assert calls==[]
assert session_bind.discover_instance('/tmp/fake-proc')==((888,999),[(888,999)])
assert calls==[['/tmp/fake-proc','linuxcncsvr']]
# The real gateway import must NOT ask a subprocess to probe the host's NML,
# nor take an instance from the synthetic discovery function above.
with patch('subprocess.run',side_effect=AssertionError('unexpected subprocess at gateway import')) as spawn:
    import gateway
    assert spawn.call_count == 0, spawn.call_args_list
assert gateway.current_link() is None
assert gateway._bound_instance is None
assert calls==[['/tmp/fake-proc','linuxcncsvr']]
print(json.dumps({'conftest_loaded':'conftest' in sys.modules,'host_discovery_calls':0,'fake_proc_calls':calls,'gateway_link':None,'gateway_bound_instance':None,'verdict':'PASS'}),flush=True)

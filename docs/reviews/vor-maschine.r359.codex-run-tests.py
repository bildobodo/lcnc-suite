import os, sys
from pathlib import Path
from unittest.mock import patch
root=Path('/tmp/codex-r359')
os.environ['LCNC_LOG_DIR']=str(root/'probes/logs')
os.environ.pop('LCNC_LAUNCHER_PID',None)
os.environ.pop('LCNC_INI_FILE',None)
sys.path.insert(0,str(root/'lcnc-gateway'))
import fake_linuxcnc
fake_linuxcnc.install()
import session_bind
with patch.object(session_bind,'discover_instance',return_value=(None,[])):
    import gateway
# Never run a native probe as an incidental side effect of a test. Tests
# which exercise connection establishment replace this seam themselves.
with patch.object(gateway,'_nml_connectable',return_value=False):
    import pytest
    raise SystemExit(pytest.main(sys.argv[1:]))

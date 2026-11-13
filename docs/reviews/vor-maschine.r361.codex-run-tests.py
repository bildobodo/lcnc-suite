import os, sys
from pathlib import Path
root=Path('/tmp/codex-r361')
os.environ['LCNC_LOG_DIR']=str(root/'probes/test-logs')
os.environ.pop('LCNC_LAUNCHER_PID',None)
os.environ.pop('LCNC_INI_FILE',None)
sys.path.insert(0,str(root/'lcnc-gateway'))
import pytest
raise SystemExit(pytest.main(sys.argv[1:]))

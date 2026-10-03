"""R71 isolated counterprobes. Fake LinuxCNC, only temporary files."""
import concurrent.futures
import json
import os
import threading
from pathlib import Path
from unittest.mock import patch
from test_macros_gateway import _Folder, gateway, _run

OUTPUT = Path(__file__).resolve().parents[1]/'evidence'/'viewer-palette-fest.r71.counterprobes.jsonl'
def record(row):
    with OUTPUT.open('a') as f: f.write(json.dumps(row)+'\n')
    print(json.dumps(row), flush=True)

class ReviewR71(_Folder):
    def test_a_nonregular_macro_file_is_rejected_without_waiting_for_a_writer(self):
        path = self.mdir/'pipe.ngc'
        os.mkfifo(path)
        entered = threading.Event()
        real_open = os.open
        def seen_open(p, flags, *a, **kw):
            if str(p)==str(path): entered.set()
            return real_open(p, flags, *a, **kw)
        def read():
            try:
                gateway._macro_bytes(self.state, str(path))
                return 'accepted'
            except Exception as e:
                return type(e).__name__+': '+str(e)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            with patch.object(gateway.os, 'open', seen_open):
                f=ex.submit(read)
                assert entered.wait(1), 'probe never reached file open'
                try:
                    response=f.result(timeout=.25)
                    blocked=False
                except concurrent.futures.TimeoutError:
                    blocked=True
                    # Unblock OUR private FIFO; no reader is left running.
                    fd=real_open(path, os.O_WRONLY | os.O_NONBLOCK)
                    os.close(fd)
                    response=f.result(timeout=1)
        record({'case':'nonregular FIFO', 'blocked_until_writer_opened':blocked,'response_after_writer':response})
        self.assertFalse(blocked, 'a file admission must not wait indefinitely to reject a named pipe')
        self.assertTrue(response.startswith('_MacroOutside'), response)

    def test_a_directory_named_ngc_is_a_bounded_admission_refusal(self):
        path=self.mdir/'dir.ngc';path.mkdir()
        code=None
        try:
            _run(gateway.get_macro(name='dir'))
            response='accepted'
        except Exception as e:
            response=type(e).__name__
            code=getattr(e,'status_code',None)
        record({'case':'nonregular directory','response':response,'status_code':code})
        self.assertEqual(code,403,'directory escaped admission as a server exception')

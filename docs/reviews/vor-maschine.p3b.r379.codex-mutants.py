from pathlib import Path
import subprocess
p=Path('/tmp/codex-r379/scripts/test_support/live_session.py')
original=p.read_text()
python='/home/cnc/lcnc-suite-link/lcnc-gateway/.venv/bin/python3'
mutants=[('send_without_record_lock', '''            with self.record_lock:
                mark((time.monotonic(), len(self.basis_history)))
                self.send({"cmd": cmd, **kwargs})''', '''            mark((time.monotonic(), len(self.basis_history)))
            self.send({"cmd": cmd, **kwargs})''', 'test_receive_cannot_stamp_between_mark_and_send'),
('mark_without_record_lock', '''        with self.record_lock:
            return time.monotonic(), len(self.basis_history)''', '''        return time.monotonic(), len(self.basis_history)''', 'test_end_mark_waits_for_a_stamped_but_not_yet_appended_frame')]
try:
 for name, old, new, test in mutants:
  assert original.count(old)==1
  p.write_text(original.replace(old,new))
  result=subprocess.run([python,'-m','pytest','-q','r379_probe.py::'+test],cwd='/tmp/codex-r379',capture_output=True,text=True,timeout=15)
  print(name, 'exit',result.returncode,flush=True)
  print(result.stdout,flush=True)
  assert result.returncode==1
finally:
 p.write_text(original)

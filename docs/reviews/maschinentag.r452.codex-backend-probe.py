"""R452 independent probes; no host LinuxCNC (pytest conftest)."""
import asyncio
import json
from pathlib import Path
from test_program_identity import _pipeline, _worker


def test_a_scheduled_file_cannot_take_the_next_loads_identity(tmp_path):
    a = tmp_path / 'A.ngc'
    a.write_text('(A)\nG0 X1\nM2\n')
    bfile = tmp_path / 'B.ngc'
    bfile.write_text('(B)\nG0 X2\nM2\n')
    b = _pipeline(str(tmp_path), admit=lambda: None)
    b.generation.new_program('load A')
    active = {'id': 'E.1'}
    b.get_active_program = lambda: active['id']
    calls = []
    b._run_gcode_worker_blocking = _worker(calls)

    async def scenario():
        tasks = []
        def spawn(coro):
            task = asyncio.create_task(coro)
            tasks.append(task)
            return task
        assert b.schedule_refresh(str(a), 'file', spawn)
        scheduled = dict(b.scheduled)
        # A command's write thread changes generation before the scheduled
        # coroutine first runs. No controller motion; B is now the load.
        b.generation.new_program('load B')
        active['id'] = 'E.2'
        await tasks[0]
        return scheduled
    scheduled = asyncio.run(scenario())
    observed = {'scheduled': scheduled, 'active': active['id'],
                'published_program': b.published_program,
                'published_file': b.last_file, 'accepted_as_active': b.published_is_active(),
                'worker_calls': len(calls)}
    Path('/tmp/r452/schedule-observation.json').write_text(json.dumps(observed, indent=2))
    assert not (b.last_file == str(a) and b.published_program == 'E.2'), observed

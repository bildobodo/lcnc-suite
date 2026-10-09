"""Observation only: Python profiler records register, tool and traverse callback entry.
Delegates to the unmodified method; no replacements of decisions or data.
Run in the archive gateway directory, <case> [payload].
"""
from pathlib import Path
import sys,json
here=Path.cwd();E=Path(__file__).resolve().parent
src=(E/'native.py').read_text()
trace='''
trace_events=[]
def trace_calls(frame,event,arg):
    if event == 'call' and frame.f_code.co_name in ('_register_write','change_tool','tool_offset','straight_traverse') and frame.f_code.co_filename.endswith('/gcode_canon.py'):
        c=frame.f_locals['self'];t=c.interp()
        trace_events.append({'callback':frame.f_code.co_name,'canon_line':c.lineno,'init':c._in_init,'started':c._program_started,'program':c._program_line(),'stale':sorted(c.stale),'main_line':c.main_line(),'in_main':c._in_main_file(),'write_mode':c.write_mode,'write_lines':c.write_lines,'filename':t.filename if t else None,'sequence_number':t.sequence_number if t else None,'remaps':list(c.remaps_running()),'offset':int(t.blocks[1].offset) if t and int(t.remap_level)>0 else None,'frames':[{'filename':t.sub_context[i].filename,'position':t.sub_context[i].position} for i in range(int(t.call_level))] if t else None})
sys.setprofile(trace_calls)
'''
# native.py invokes native_start_probe from the current archive; inject only observation.
src=src.replace('    exec(compile(src', '    src = src.replace("with contextlib.redirect_stderr(err):", '+repr(trace+'\nwith contextlib.redirect_stderr(err):')+')\n    src += '+repr('\nsys.setprofile(None)\nprint("TRACE "+json.dumps(trace_events))\n')+'\n    exec(compile(src')
exec(compile(src,str(E/'native.py'),'exec'),{'__name__':'__main__','__file__':str(E/'native.py')})

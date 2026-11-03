"""R254 static call-contract guard, NOT a LinuxCNC execution.

The fourth argument to the shipped probe_x/y_plus/minus helpers is the
traverse feed. Evaluate the simple argument forms actually used there at
three distinct configured feeds, then check their forwarding. Only source
files are read; no LinuxCNC import, controller access, or external write.
"""
import sys,re,json
from pathlib import Path
repo=Path(sys.argv[1]).resolve(); output=Path(sys.argv[2]).resolve()
directory=repo/'subroutines/probe_basic'
calls=[];bad=[]
pattern=re.compile(r'o<(probe_[xy]_(?:plus|minus))>\s+call\s*((?:\[[^\[\]]*\]\s*){4})',re.I)
for file in sorted(directory.glob('*.ngc')):
    for number,line in enumerate(file.read_text().splitlines(),1):
        match=pattern.search(line)
        if not match:continue
        callee=directory/(match[1]+'.ngc');source=callee.read_text()
        assert '#<probe_traverse_fr> = #4' in source
        feed_lines=[{'line':i,'source':l.strip()} for i,l in enumerate(source.splitlines(),1)
                    if 'G1 F[#<probe_traverse_fr>]' in l]
        assert feed_lines,callee
        expr=re.findall(r'\[([^\[\]]*)\]',match[2])[3].strip()
        observations=[]
        for configured in [123,1000,1500]:
            if expr=='#3017':value=configured
            elif expr=='#<probe_traverse_fr>':
                assert re.search(r'#<probe_traverse_fr>\s*=\s*#3017\b',file.read_text())
                value=configured
            else:value=float(expr) # actual remaining form: the literal 3017
            observations.append({'configured_3017':configured,'argument4':value,'matches':value==configured})
        record={'file':str(file.relative_to(repo)),'line':number,'call':line.strip(),'argument4_expression':expr,
                'callee':str(callee.relative_to(repo)),'feed_uses':feed_lines,'observations':observations}
        calls.append(record)
        if not all(o['matches'] for o in observations):bad.append(record)
assert calls,'No call sites found'
result={'kind':'static source call-contract, not interpreter execution','call_sites':len(calls),
        'failures':len(bad),'calibration_failures':sum('/probe_cal_' in c['file'] for c in bad),
        'affected_files':sorted({c['file'] for c in bad}),'bad_calls':bad}
output.write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='bad_calls'},indent=2))
assert not bad, f'{len(bad)} call sites ignore configured #3017; see {output}'

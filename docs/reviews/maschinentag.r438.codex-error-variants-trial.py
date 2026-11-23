"""R438: actual offline interpreter; alternate call syntax and nested files."""
import json,os,sys,subprocess,tempfile
from pathlib import Path
sys.path.insert(0,'/tmp/r438/head/lcnc-gateway')
import test_error_line_golden as golden
cases={
 'spaced_call':'G21 G90\no<bad_sub> c a l l\nM2\n',
 'comment_call':'G21 G90\no<bad_sub> c(note)a l l\nM2\n',
 'line_number':'G21 G90\nN100o<bad_sub>call\nM2\n',
 'nested_external':'G21 G90\no<outer> call\nM2\n',
 'nested_spaced':'G21 G90\no<outer> c a l l\nM2\n',
 'numeric_call':'G21 G90\no100 call\nM2\n',
 'computed_call':'G21 G90\no[100] call\nM2\n',
 'signed_call':'G21 G90\no+100 call\nM2\n',
 'decimal_call':'G21 G90\no100.0 call\nM2\n',
 'function_call':'G21 G90\noABS[-100] call\nM2\n',
 'm98_call':'G21 G90\nM98 P100\nM2\n',
 'm98_compact':'G21 G90\nN100M98P100\nM2\n',
 'm98_computed':'G21 G90\nM[98]P100\nM2\n',
 'g_remap':'G21 G90\nG88.1\nM2\n',
 'm_remap_nested':'G21 G90\nM612\nM2\n',
 'after_nested':'G21 G90\no<outer_good> call\nG1 X1 Q\nM2\n',
 'after_spaced':'G21 G90\no<good_sub> c a l l\nG1 X1 Q\nM2\n',
}
subs={**golden.SUBS,
 'outer.ngc':'o<outer> sub\no<bad_sub> call\no<outer> endsub\nM2\n',
 'outer_good.ngc':'o<outer_good> sub\no<good_sub> call\no<outer_good> endsub\nM2\n',
 '100.ngc':'o100 sub\nG0 X0\nG1 X1 Q\no100 endsub\nM2\n',
 'g881_bad.ngc':'o<g881_bad> sub\nG0 X0\nG1 X1 Q\no<g881_bad> endsub\nM2\n',
 'm612_bad.ngc':'o<m612_bad> sub\no<bad_sub> call\no<m612_bad> endsub\nM2\n',
}
with tempfile.TemporaryDirectory() as tmp:
 d=Path(tmp);(d/'subs').mkdir()
 for name,code in subs.items():(d/'subs'/name).write_text(code)
 (d/'sim.var').write_text('');(d/'tool.tbl').write_text('T1 P1 D6 Z50 ;\n')
 ini=d/'mini.ini';ini.write_text('[EMC]\nVERSION=1.1\n[RS274NGC]\nPARAMETER_FILE=sim.var\n'+f'SUBROUTINE_PATH={d / "subs"}\n'+'REMAP=M610 modalgroup=6 ngc=m610_bad\nREMAP=M612 modalgroup=6 ngc=m612_bad\nREMAP=G88.1 modalgroup=1 ngc=g881_bad\n[EMCIO]\nTOOL_TABLE=tool.tbl\n[TRAJ]\nLINEAR_UNITS=mm\nANGULAR_UNITS=degree\nCOORDINATES=X Y Z\n[KINS]\nKINEMATICS=trivkins\nJOINTS=3\n')
 paths=[]
 for name,code in cases.items():
  p=d/(name+'.ngc');p.write_text(code);paths.append(str(p))
 observer='''orig = worker.proven_error_line
def observe(canon):
    t=worker.gcode_canon.interp_this()
    val=orig(canon)
    fields={'program':os.path.basename(canon.main_file),'line':val,'seq':t.sequence_number,'call':t.call_level,'remap':t.remap_level,'filename':t.filename,'offset':t.blocks[0].offset,'mapped':canon._byte_line(int(t.blocks[0].offset)+1),'caller_file':t.sub_context[0].filename,'caller_seq':t.sub_context[0].sequence_number}
    print('__OBS__'+json.dumps(fields))
    return val
worker.proven_error_line=observe
out = {}'''
 runner=golden.RUNNER.replace('out = {}',observer)
 r=subprocess.run([sys.executable,'-c',runner,'/tmp/r438/head/lcnc-gateway',str(ini),*paths],cwd=d,capture_output=True,text=True,timeout=60,env={**os.environ,'INI_FILE_NAME':str(ini)})
 Path('/tmp/r438/error-variants.stdout.txt').write_text(r.stdout)
 Path('/tmp/r438/error-variants.stderr.txt').write_text(r.stderr)
 assert r.returncode==0,r.stderr[-500:]
 got=json.loads(next(l[len('__RESULT__'):] for l in r.stdout.splitlines() if l.startswith('__RESULT__')))
 out=[]
 for name,code in cases.items():
  error,line=got[name+'.ngc']
  out.append({'name':name,'program':code,'error':error,'line':line,'expected':3 if name.startswith('after_') else None,'reached_intended_error':error=='No characters found in reading real value'})
 print(json.dumps({'subs':subs,'cases':out},ensure_ascii=False,indent=2))

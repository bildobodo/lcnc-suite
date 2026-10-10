from pathlib import Path
import ast, json, re
root=Path(__file__).parent
p=root/'docs/reviews/viewer-palette-fest.r127.f5-probe.py'
tree=ast.parse(p.read_text())
sub=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SUB' for t in n.targets))
hal_reads=sorted({ast.literal_eval(n.args[0]) for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='halp'})
text=(root/'docs/reviews/viewer-palette-fest.r127.f5.txt').read_text()
mode=None; cases=[]
for line in text.splitlines():
 if line.startswith('## Mit dem korrigierten'):mode='500_rho02'
 elif line.startswith('## Kopie: Z-Beschleunigung'):mode='250_rho02'
 elif line.startswith('## Kopie: ohne'):mode='500_rho0'
 m=re.match(r'^F(\d+)\s+\+([\d.]+)\s+G(\d+)(\s+stop)?\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*$',line)
 if m and mode:
  f, approach, path, stop, prep, q, delta, over, model, margin=m.groups()
  f=float(f); a={'500_rho02':400,'250_rho02':200,'500_rho0':500}[mode]
  expect=f/60*.004+(f/60)**2/a
  assert abs(float(model)-expect)<=.000051
  assert float(margin)>0
  assert abs(float(over)-(-234-float(q)))<=.000101
  assert abs(float(model)-float(over)-float(margin))<=.00011
  cases.append({'config':mode,'feed':f,'approach':float(approach),'path':int(path),'stop':bool(stop),'model':float(model),'overshoot':float(over),'margin':float(margin)})
assert len(cases)==42
result={'source':'Claude supplied F5 report; arithmetic and static script audit only, no live execution',
'cases':len(cases),'min_reported_margin_mm':min(x['margin'] for x in cases),'counts':{m:sum(x['config']==m for x in cases) for m in ['500_rho02','250_rho02','500_rho0']},
'formula':'4*v*T + v*v/a, T=.001s, axis reserve applied',
'hal_reads_in_script':hal_reads,'subroutine':sub,
'contains_slow_G38_2':'G38.2' in sub,'calls_bundled_routine':bool(re.search(r'o<(?:m600|tool_touch_off)>\s+call',sub,re.I)),
'has_retract_between_fast_and_slow':False,
'missing_F5_conditions':['sim-toolsetter enable value','manual probe input value','external Z offset enable and value','plate vs #3100..#3102 comparison'],
'rows':cases}
(root/'r127.codex-f5.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['rows','subroutine']},indent=2))

from pathlib import Path
import json, sys
root=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).parent
sys.path.insert(0,str(root/'scripts/inventory'))
import py_atoms as pa
import functions as fn
base="import linuxcnc\nini = linuxcnc.ini(path)\na = ini.find('BASE', 'KEPT')\n"
cases={
 'attribute_receiver': base+"holder.cfg = linuxcnc.ini(path)\nx = holder.cfg.find('EXTRA', 'ATTRIBUTE')\n",
 'returned_receiver': base+"def make_cfg():\n    return linuxcnc.ini(path)\nx = make_cfg().find('EXTRA', 'RETURN')\n",
 'new_wrapper_other_parameter': base+"def _ini_int(cfg, section, key):\n    return int(cfg.find(section, key))\nx = _ini_int(ini, 'EXTRA', 'WRAPPER')\n",
 'reader_via_keyword': base+"other_reader(read=ini.find)\n",
 'reader_assigned': base+"read = ini.find\nx = read('EXTRA', 'ALIAS')\n",
 'registered_wrapper_added_literal': base+"def _ini_float(ini, section, key):\n    side = ini.find('EXTRA', 'BODY')\n    return float(ini.find(section, key))\nx = _ini_float(ini, 'BASE', 'KEPT')\n",
}
result=[]
for name,src in cases.items():
 a=pa.ini_adapter({'gateway.py':src},{'p.ini':'[BASE]\nKEPT=1\n'})
 result.append({'case':name,'source':src,'atoms':a['atoms'],'unresolved':a['unresolved'],'complete':fn.completeness({'adapters':{'ini':a}})['complete']})
assert all(x['atoms']==[{'id':'ini:BASE/KEPT'}] and not x['unresolved'] and x['complete'] for x in result)
print(json.dumps(result,indent=2))

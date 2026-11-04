"""Review-only, no source mutations. Argument: isolated checkout root."""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'scripts/inventory'))
import py_atoms as pa
import functions as fn

base = "import linuxcnc\nini = linuxcnc.ini(path)\na = ini.find('BASE', 'KEPT')\n"
factory = "def _g30_ini():\n    return linuxcnc.ini(path)\n"
cases = {
    'registered_factory_direct_read': base + factory + "x = _g30_ini().find('EXTRA', 'DIRECT')\n",
    'registered_factory_attribute': base + factory + "holder.cfg = _g30_ini()\nx = holder.cfg.find('EXTRA', 'ATTRIBUTE')\n",
    'registered_factory_returned': base + factory + "def get_cfg():\n    return _g30_ini()\nx = get_cfg().find('EXTRA', 'RETURNED')\n",
}
results = []
for name, source in cases.items():
    a = pa.ini_adapter({'gateway.py': source}, {'p.ini': '[BASE]\nKEPT=1\n'})
    results.append({'case': name, 'source': source, 'atoms': a['atoms'], 'unresolved': a['unresolved'],
                    'complete': fn.completeness({'adapters': {'ini': a}})['complete'],
                    'captured_or_refused': bool(a['unresolved']) or len(a['atoms']) > 1})
print(json.dumps(results, indent=2))
sys.exit(0 if all(r['captured_or_refused'] for r in results) else 1)

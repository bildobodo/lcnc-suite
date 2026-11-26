from pathlib import Path
root=Path('/tmp/r497/tree/lcnc-webui')
src=(root/'src/viewer/collision.ts').read_text()
needle='    holeWork.checks[site]++;'
assert src.count(needle)==1
forced=src.replace(needle,needle+'''\n    if (site === 3) {\n      (globalThis as any).__R497_forced++;\n      if ((yield frac(sweptTo)) === true) { aborted = true; return "end"; }\n      lastYield = clock(); holeSince = 0; return "yielded";\n    }''')
(root/'src/viewer/collisionR497Forced.ts').write_text(forced)
needle='            if (hc === "yielded") poseVertex(lastReal);\n'
assert forced.count(needle)==1
(root/'src/viewer/collisionR497NoRestore.ts').write_text(forced.replace(needle,''))

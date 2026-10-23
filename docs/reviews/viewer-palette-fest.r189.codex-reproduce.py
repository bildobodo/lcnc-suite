"""Reproduce Codex R189 entirely offline from the preserved evidence.
Usage: python3 viewer-palette-fest.r189.codex-reproduce.py [docs/reviews]
Creates only a new /tmp directory. No live logs, sockets, driver, or machine.
"""
import gzip,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
DOCS=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else Path(__file__).resolve().parent
OUT=Path(tempfile.mkdtemp(prefix='codex-r189-reproduce-'))
(OUT/'raw').mkdir();(OUT/'tools').mkdir()
for target,source in [('bpc.py','viewer-palette-fest.r182.browser-pc-bpc.py'),('bpc2.py','viewer-palette-fest.r189.browser-pc-report2.py')]:
 shutil.copyfile(DOCS/source,OUT/'tools'/target)
for target,source in [('trace.ndjson','events.jsonl.gz'),('rss.jsonl','rss.jsonl.gz')]:
 with gzip.open(DOCS/f'viewer-palette-fest.r188.codex-{source}','rb') as src,(OUT/'raw'/target).open('wb') as dst:shutil.copyfileobj(src,dst)
logs=json.loads((DOCS/'viewer-palette-fest.r188.codex-heartbeat-logs.json').read_text())
buf=bytearray(b' ' * logs['gateway_file_bytes'])
for r in logs['gateway_heartbeat_lines']:
 raw=(r['line']+'\n').encode();assert len(raw)==r['bytes'];buf[r['offset']:r['offset']+r['bytes']]=raw
(OUT/'raw/gateway.log').write_bytes(buf)
(OUT/'raw/hal_watchdog.log').write_text(logs['watchdog_text'])
env=dict(os.environ,R189_ROOT=str(OUT),R189_DOCS=str(DOCS),PYTHONDONTWRITEBYTECODE='1')
subprocess.run([sys.executable,str(DOCS/'viewer-palette-fest.r189.codex-probes.py')],env=env,check=True)
print('Audit output:',OUT)

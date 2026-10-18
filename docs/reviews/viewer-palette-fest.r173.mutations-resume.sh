#!/usr/bin/env bash
# R173 resumed after an accidental second run in ~/lcnc-suite-mut (16:45-16:48) overlapped R170's and R169's sets:
# the tree restored by byte copy, a re-runs from R170 on, plus R173's three re-anchored rules; b went on in its own tree
set -u
O=/home/cnc/claude-work/form1
cd $O
echo "resume $(date +%H:%M:%S) up $(cut -d' ' -f1 /proc/uptime)"
for w in ~/lcnc-suite-mut ~/lcnc-suite-mut2 ~/lcnc-suite-p2; do echo "$w: $(git -C $w log --oneline -1 | cut -c1-12) $(git -C $w status --short | wc -l) changed"; done
python3 mutations-r173.py u_held_ignored_r173 u_pairs_unordered_r173 d_card_raw_r173 > mutations-r173-reanchor.txt 2>&1
python3 mutations-r170.py > mutations-r170-at-r173.txt 2>&1
python3 mutations-r169.py > mutations-r169-at-r173.txt 2>&1
python3 mutations-r168-at-r169.py > mutations-r168-at-r173.txt 2>&1
python3 mutations-r166.py > mutations-r166-at-r173.txt 2>&1
python3 mutations-r157-at-r165.py > mutations-r157-at-r173.txt 2>&1
until ! systemctl --user is-active --quiet r173-mut-b; do sleep 20; done
$O/run-r173-mut.sh e
for f in r173 r173-reanchor r172-at-r173 r171-at-r173 r170-at-r173 r169-at-r173 r168-at-r173 r166-at-r173 r157-at-r173 r164-at-r173 r163-at-r173 r162-at-r173 r162-e2e-at-r173 r161-at-r173 slow-at-r173 r160-at-r173 r159-at-r173 r158-at-r173; do
  echo "== $f: $(sed 's/\x1b\[[0-9;]*m//g' mutations-$f.txt | awk '{print $2}' | sort | uniq -c | tr '\n' ' ')"
  sed 's/\x1b\[[0-9;]*m//g' mutations-$f.txt | grep -v " RED \| ok " | cut -c1-220
done
echo "mutations end $(date +%H:%M:%S) up $(cut -d' ' -f1 /proc/uptime)"
# Codex's R168 and R169 probes, unchanged, at the head (copied in, removed after)
( cd ~/lcnc-suite-mut/lcnc-webui && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r168.codex-rapid.test.ts src/viewer/zz_codex_r168_rapid.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r168.codex-sweep.test.ts src/viewer/zz_codex_r168_sweep.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r169.codex-index.test.ts src/viewer/zz_codex_r169_index.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r170.codex-undecidable.test.ts src/viewer/zz_codex_r170_undecidable.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r170.codex-delta-budget.test.ts src/viewer/zz_codex_r170_delta.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r171.codex-notes.test.ts src/viewer/zz_codex_r171_notes.test.ts \
  && cp ~/lcnc-suite-partb/docs/reviews/viewer-palette-fest.r172.codex-side-notes.test.ts src/viewer/zz_codex_r172_side.test.ts \
  && mkdir -p $O/r173-codex-out && echo "head $(git log --oneline -1)" > $O/r173-codex-probes.txt \
  && R168_OUT=$O/r173-codex-out R169_OUT=$O/r173-codex-out R170_OUT=$O/r173-codex-out R171_OUT=$O/r173-codex-out R172_OUT=$O/r173-codex-out npx vitest run src/viewer/zz_codex_r168_rapid.test.ts src/viewer/zz_codex_r168_sweep.test.ts src/viewer/zz_codex_r169_index.test.ts src/viewer/zz_codex_r170_undecidable.test.ts src/viewer/zz_codex_r170_delta.test.ts src/viewer/zz_codex_r171_notes.test.ts src/viewer/zz_codex_r172_side.test.ts >> $O/r173-codex-probes.txt 2>&1; \
  rm -f src/viewer/zz_codex_r168_rapid.test.ts src/viewer/zz_codex_r168_sweep.test.ts src/viewer/zz_codex_r169_index.test.ts src/viewer/zz_codex_r170_undecidable.test.ts src/viewer/zz_codex_r170_delta.test.ts src/viewer/zz_codex_r171_notes.test.ts src/viewer/zz_codex_r172_side.test.ts; echo "probes: $(sed 's/\x1b\[[0-9;]*m//g' $O/r173-codex-probes.txt | grep -E 'Tests ' | tr -s ' ')" )
for w in ~/lcnc-suite-mut ~/lcnc-suite-mut2 ~/lcnc-suite-p2; do echo "$w: $(git -C $w log --oneline -1 | cut -c1-12) $(git -C $w status --short | wc -l) changed"; done
ss -ltnp 2>/dev/null | grep -E ":417[34]\b" && { echo "ports busy — stop"; exit 1; }
cd ~/lcnc-suite-p2/lcnc-webui
systemd-run --user --unit=r173-gate --collect --setenv=PATH="$PATH" --setenv=HOME="$HOME" --working-directory=$PWD /home/cnc/claude-work/gate-frontend.sh $PWD $O/gate-r173.json "R173: VP-I125/I126, folded notes by their own track, no raw line without a table (4cd751b5..$(git log --format=%h -1))"
sleep 5; until ! systemctl --user is-active --quiet r173-gate; do sleep 30; done
python3 -c "import json; d=json.load(open('$O/gate-r173.json')); print(d['head'], d['uncommitted'], [(g['name'], g['status'], g['seconds'], g.get('tests')) for g in d['gates']])"
echo "end $(date +%H:%M:%S) up $(cut -d' ' -f1 /proc/uptime)"

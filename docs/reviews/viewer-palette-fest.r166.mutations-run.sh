#!/usr/bin/env bash
# R166 mutations at the head: a = the new rules and R157's (~/lcnc-suite-mut, browser rules too);
# b = R164's … R158's and the slow four, unit rules only (~/lcnc-suite-mut2) — beside a;
# R162's one browser rule afterwards, alone (two Playwright runs share :4173/:4174 and serve each other's build)
set -u
cd /home/cnc/claude-work/form1 || exit 2
if [ "$1" = a ]; then
  python3 mutations-r166.py > mutations-r166.txt 2>&1
  python3 mutations-r157-at-r165.py > mutations-r157-at-r166.txt 2>&1
elif [ "$1" = b ]; then
  for f in r164 r163 r162 r161 slow r160 r159 r158; do MUT_KIND=ts python3 mutations-$f-at-r165.py > mutations-$f-at-r166.txt 2>&1; done
else
  MUT_KIND=e2e python3 mutations-r162-at-r165.py > mutations-r162-e2e-at-r166.txt 2>&1
fi

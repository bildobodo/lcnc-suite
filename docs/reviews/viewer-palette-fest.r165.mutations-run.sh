#!/usr/bin/env bash
# R165 mutations at the head: a = the new rules and R157's (~/lcnc-suite-mut, browser rules too);
# b = R164's … R158's and the slow four, unit rules only (~/lcnc-suite-mut2) — beside a;
# R162's one browser rule afterwards, alone (two Playwright runs share :4173/:4174 and serve each other's build)
set -u
cd /home/cnc/claude-work/form1 || exit 2
if [ "$1" = a ]; then
  for f in r165 r157-at-r165; do python3 mutations-$f.py > mutations-$f.txt 2>&1; done
elif [ "$1" = b ]; then
  for f in r164-at-r165 r163-at-r165 r162-at-r165 r161-at-r165 slow-at-r165 r160-at-r165 r159-at-r165 r158-at-r165; do MUT_KIND=ts python3 mutations-$f.py > mutations-$f.txt 2>&1; done
else
  MUT_KIND=e2e python3 mutations-r162-at-r165.py > mutations-r162-e2e-at-r165.txt 2>&1
fi

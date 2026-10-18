#!/usr/bin/env bash
# R171 mutations at the head (VP-I123/I124): a = R171's rules, C2's (R170), R169's, R168's (C1), R166's and R157's (browser rules too) in ~/lcnc-suite-mut;
# b = R164 … R158 and the slow four, unit rules only, in ~/lcnc-suite-mut2 beside a; then R162's browser rule alone
set -u
cd /home/cnc/claude-work/form1 || exit 2
if [ "$1" = a ]; then
  python3 mutations-r171.py > mutations-r171.txt 2>&1
  python3 mutations-r170.py > mutations-r170-at-r171.txt 2>&1
  python3 mutations-r169.py > mutations-r169-at-r171.txt 2>&1
  python3 mutations-r168-at-r169.py > mutations-r168-at-r171.txt 2>&1
  python3 mutations-r166.py > mutations-r166-at-r171.txt 2>&1
  python3 mutations-r157-at-r165.py > mutations-r157-at-r171.txt 2>&1
elif [ "$1" = b ]; then
  for f in r164 r163 r162 r161 slow r160 r159 r158; do MUT_KIND=ts python3 mutations-$f-at-r165.py > mutations-$f-at-r171.txt 2>&1; done
else
  MUT_KIND=e2e python3 mutations-r162-at-r165.py > mutations-r162-e2e-at-r171.txt 2>&1
fi

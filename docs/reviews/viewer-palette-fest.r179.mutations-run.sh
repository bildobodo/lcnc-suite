#!/usr/bin/env bash
# R179 mutations at the head (VP-I130 rest, VP-I131): a = R179's rules, R178's, R177's, R176's, R175's, R174's, R173's, R172's (C3), R171's, C2's (R170), R169's, R168's (C1), R166's and R157's (browser rules too) in ~/lcnc-suite-mut;
# b = R164 … R158 and the slow four, unit rules only, in ~/lcnc-suite-mut2 beside a; then R162's browser rule alone
set -u
cd /home/cnc/claude-work/form1 || exit 2
if [ "$1" = a ]; then
  python3 mutations-r179.py > mutations-r179.txt 2>&1
  python3 mutations-r178.py > mutations-r178-at-r179.txt 2>&1
  python3 mutations-r177.py > mutations-r177-at-r179.txt 2>&1
  python3 mutations-r176.py > mutations-r176-at-r179.txt 2>&1
  python3 mutations-r175.py > mutations-r175-at-r179.txt 2>&1
  python3 mutations-r174.py > mutations-r174-at-r179.txt 2>&1
  python3 mutations-r173.py > mutations-r173-at-r179.txt 2>&1
  python3 mutations-r172.py > mutations-r172-at-r179.txt 2>&1
  python3 mutations-r171.py > mutations-r171-at-r179.txt 2>&1
  python3 mutations-r170.py > mutations-r170-at-r179.txt 2>&1
  python3 mutations-r169.py > mutations-r169-at-r179.txt 2>&1
  python3 mutations-r168-at-r169.py > mutations-r168-at-r179.txt 2>&1
  python3 mutations-r166.py > mutations-r166-at-r179.txt 2>&1
  python3 mutations-r157-at-r165.py > mutations-r157-at-r179.txt 2>&1
elif [ "$1" = b ]; then
  for f in r164 r163 r162 r161 slow r160 r159 r158; do MUT_KIND=ts python3 mutations-$f-at-r165.py > mutations-$f-at-r179.txt 2>&1; done
else
  MUT_KIND=e2e python3 mutations-r162-at-r165.py > mutations-r162-e2e-at-r179.txt 2>&1
fi

#!/usr/bin/env bash
# R181 mutations at the head (the placeless limit row's words): R181's rules and the limit sets that
# touch the same files (R180, R179, R178, R177) in ~/lcnc-suite-mut, unit and browser rules in turn
set -u
cd /home/cnc/claude-work/form1 || exit 2
python3 mutations-r181.py > mutations-r181.txt 2>&1
python3 mutations-r180.py > mutations-r180-at-r181.txt 2>&1
python3 mutations-r179.py > mutations-r179-at-r181.txt 2>&1
python3 mutations-r178.py > mutations-r178-at-r181.txt 2>&1
python3 mutations-r177.py > mutations-r177-at-r181.txt 2>&1

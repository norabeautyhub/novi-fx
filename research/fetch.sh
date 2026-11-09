#!/bin/bash
# usage: fetch.sh PAIR SCALE YEAR...
pair=$1; scale=$2; shift 2
for y in "$@"; do
  d=/tmp/fxd/$pair-$y
  rm -rf $d
  git clone -q --depth 1 -b $pair-$y https://github.com/FX-Data/FX-Data-$pair-DS $d 2>&1 | tail -1
  python3 agg.py $d data/${pair}_$y.csv $scale
  rm -rf $d
done

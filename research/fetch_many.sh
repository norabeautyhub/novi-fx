#!/bin/bash
# usage: fetch_many.sh PAIR... (years 2015-2018, scale 1; rescale later if needed)
for pair in "$@"; do
  for y in 2015 2016 2017 2018; do
    [ -f data/${pair}_$y.csv ] && continue
    d=/tmp/fxd/$pair-$y; rm -rf $d
    git clone -q --depth 1 -b $pair-$y https://github.com/FX-Data/FX-Data-$pair-DS $d 2>&1 | tail -1
    python3 agg.py $d data/${pair}_$y.csv 1
    rm -rf $d
  done
done

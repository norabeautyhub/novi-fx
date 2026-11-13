import sys, pandas as pd, os
for f in sys.argv[1:]:
    mk = f + '.scaled'
    if os.path.exists(mk): continue
    d = pd.read_csv(f)
    if d['close'].iloc[0] > 20: open(mk,'w').close(); continue
    for c in ['open','high','low','close','spread']: d[c] = d[c]*100
    d.to_csv(f, index=False); open(mk,'w').close(); print(f, d['close'].iloc[0])

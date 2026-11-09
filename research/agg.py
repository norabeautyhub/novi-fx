# Aggregate FX-Data tick CSVs (one clone dir) into 15-minute OHLC + avg spread
import sys, glob, os, pandas as pd
src, out, scale = sys.argv[1], sys.argv[2], float(sys.argv[3])
files = sorted(glob.glob(os.path.join(src, '**', '*_ticks.csv'), recursive=True))
parts = []
for f in files:
    try:
        d = pd.read_csv(f, header=None, usecols=[0,1,2], names=['t','ask','bid'])
    except Exception as e:
        continue
    if d.empty: continue
    d['t'] = pd.to_datetime(d['t'], format='%Y.%m.%d %H:%M:%S.%f', errors='coerce')
    d = d.dropna()
    d['mid'] = (d['ask'] + d['bid']) / 2 * scale
    d['spr'] = (d['ask'] - d['bid']).abs() * scale
    g = d.set_index('t').resample('15min')
    b = pd.DataFrame({'open': g['mid'].first(), 'high': g['mid'].max(), 'low': g['mid'].min(), 'close': g['mid'].last(), 'spread': g['spr'].mean(), 'ticks': g['mid'].count()}).dropna()
    parts.append(b)
df = pd.concat(parts).sort_index()
df = df[~df.index.duplicated()]
df.to_csv(out)
print(out, len(df), df.index.min(), df.index.max(), 'spread', round(df['spread'].median(), 5))

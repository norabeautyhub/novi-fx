"""Export model v2: final LightGBM on all 4 years + thresholds matched by trade rate + JS parity sample."""
import json, sys, numpy as np, pandas as pd, lightgbm as lgb
import scalp_ml as S, scalp_ml2 as V
from engine import load

ci = int(sys.argv[1]) if len(sys.argv) > 1 else 1
cfg = S.CFG[ci]
D = V.build(cfg)
feats = [c for c in D.columns if c not in ('y', 'exitk', 'year', 'i')]
# walk-forward predictions → thresholds per trade-rate level
P = V.walk(D, feats)
wf = V.by_rate(P, 'wf')
best_wf = P.groupby(['pair', 'year', 'i'])['pred'].max()
final = lgb.LGBMRegressor(**V.PARAMS, random_state=1)
final.fit(D[feats], D.y.clip(-1.5, 3))
D['pred'] = final.predict(D[feats])
best_fin = D.groupby(['pair', 'year', 'i'])['pred'].max()
def match(thr):
    r = (best_wf > thr).mean(); return float(np.quantile(best_fin, 1 - r))
LEV = [('safe', 'ආරක්ෂිත', 0.5), ('normal', 'සාමාන්‍ය', 1), ('more', 'වැඩි trades', 2)]
levels = []
for key, name, rate in LEV:
    w = wf[rate]
    levels.append(dict(key=key, name=name, thr=round(match(w['thr']), 4), wfThr=w['thr'],
        research=dict(perDay=w['rate'], wr=w['wr'], pf=w['pf'], net=w['net'], years=f"{sum(v > 0 for v in w['years'].values())}/3 ලාභ")))
print(levels)
imp = sorted(zip(final.booster_.feature_importance('gain'), feats), reverse=True)
print('top', [(f, round(g)) for g, f in imp[:15]])
untr = S.stats(S.simulate_pick(P.assign(pred=1.0), 0.0), 780)
dump = final.booster_.dump_model()
old = json.load(open('/home/claude/novi-fx/src/scalp-model.json'))
M = dict(version=2, trainedOn='15m candles 2015–2018, 12 markets, %d inputs' % len(feats), cfg=cfg, feats=feats, pairs=S.PAIRS,
         dirMeta=dict(signed=V.SIGNED, flip100=V.FLIP100, flip1=V.FLIP1, swap=V.SWAP),
         threshold=levels[1]['thr'], levels=levels, spreadMedian=old['spreadMedian'], refPrice=old['refPrice'],
         research=dict(walkForward='2016–2018 (unseen years)', untrained=untr, importance=[(f, round(float(g))) for g, f in imp[:20]]),
         trees=dump['tree_info'])
json.dump(M, open('/home/claude/novi-fx/src/scalp-model.json', 'w'))
# parity sample
df = load('XAUUSD', [2018], '15m').iloc[-1500:]
X, a = V.features2(df)
rows = []
for d in (1, -1):
    Z = V.directional(X, d); Z['pair'] = 0; Z = Z[feats]
    rows.append(dict(dir=d, X=Z.iloc[-40:].values.tolist(), pred=final.predict(Z.iloc[-40:]).tolist()))
cand = [dict(time=int(t.timestamp()), open=o, high=h, low=l, close=c) for t, o, h, l, c in zip(df.index, df.open, df.high, df.low, df.close)]
json.dump(dict(candles=cand, spreads=df.spread.values.tolist(), rows=rows, feats=feats), open('/tmp/scalp_parity2.json', 'w'), allow_nan=True)
print('exported', len(dump['tree_info']), 'trees')

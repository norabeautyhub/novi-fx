"""Train the scalping bot: LightGBM learns which 15m entries (long or short) reach TP before SL.
Every closed 15m bar is a candidate in both directions. Label = trade result in R net of costs
(TP=tp*ATR, SL=sl*ATR, time stop T bars). Model predicts expected R; bot trades when pred > thr.
Walk-forward by year (train on earlier years, all markets pooled; test on the next year).
Final evaluation simulates one open position per market (no overlapping trades)."""
import json, sys, numpy as np, pandas as pd, lightgbm as lgb
from engine import load, ema, rsi, atr, macd_hist, adx
from scalp_research import FLOOR

PAIRS = ['XAUUSD', 'EURUSD', 'XAGUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'GBPJPY', 'EURJPY', 'NZDUSD', 'EURGBP']
YEARS = [2015, 2016, 2017, 2018]
CFG = [dict(tp=1.0, sl=1.0, T=16), dict(tp=1.5, sl=1.0, T=32), dict(tp=0.75, sl=1.5, T=16), dict(tp=2.0, sl=1.5, T=48)]

def features(df):
    c, h, l, o = df.close.values, df.high.values, df.low.values, df.open.values
    a = atr(h, l, c); r = rsi(c); ad, pdi, ndi = adx(h, l, c); m = macd_hist(c)
    e20, e50, e80, e200 = ema(c, 20), ema(c, 50), ema(c, 80), ema(c, 200)
    s = pd.Series(c)
    X = pd.DataFrame({
        'hour': df.index.hour, 'dow': df.index.dayofweek,
        'atr_sp': a / np.maximum(df.spread.values, 1e-9),           # how big moves are vs cost
        'atr_rel': a / pd.Series(a).rolling(96).mean().values,        # volatility now vs last day
        'rsi': r, 'rsi7': rsi(c, 7), 'adx': ad, 'di': (pdi - ndi),
        'd20': (c - e20) / a, 'd50': (c - e50) / a, 'd200': (c - e200) / a,
        'tr1h': np.sign(e80 - e200), 's20': (e20 - np.r_[e20[:4], e20[:-4]]) / a,
        'macd': m / a, 'r1': (c - s.shift(1).values) / a, 'r4': (c - s.shift(4).values) / a, 'r16': (c - s.shift(16).values) / a,
        'r96': (c - s.shift(96).values) / a, 'rng': (h - l) / a, 'body': (c - o) / a,
        'hi20': (s.rolling(20).max().values - c) / a, 'lo20': (c - s.rolling(20).min().values) / a,
        'bbz': (c - s.rolling(20).mean().values) / s.rolling(20).std().values,
    }, index=df.index)
    return X, a

def labels(df, a, cfg, floor):
    """R result for long and short entries at next open, net of costs."""
    o, h, l, c = df.open.values, df.high.values, df.low.values, df.close.values
    n = len(c); T = cfg['T']; sp = np.maximum(df.spread.values, floor) * 1.2
    out = {}
    for d in (1, -1):
        res = np.full(n, np.nan); ex = np.full(n, -1)
        e = np.r_[o[1:], np.nan]; risk = cfg['sl'] * a
        tpp = e + d * cfg['tp'] * a; slp = e - d * risk
        first_tp = np.full(n, T + 1); first_sl = np.full(n, T + 1)
        for k in range(1, T + 1):
            idx = np.arange(n) + k
            ok = idx < n; ii = np.where(ok, idx, n - 1)
            hit_tp = ((h[ii] >= tpp) if d > 0 else (l[ii] <= tpp)) & ok
            hit_sl = ((l[ii] <= slp) if d > 0 else (h[ii] >= slp)) & ok
            first_tp = np.where((first_tp > T) & hit_tp, k, first_tp)
            first_sl = np.where((first_sl > T) & hit_sl, k, first_sl)
        last = np.minimum(np.arange(n) + T, n - 1)
        timed = d * (c[last] - e) / risk
        res = np.where(first_sl <= first_tp, np.where(first_sl <= T, -1.0, timed), cfg['tp'] / cfg['sl'])
        res = np.where((first_sl > T) & (first_tp > T), timed, res)
        exitk = np.minimum(np.minimum(first_tp, first_sl), T)
        res = res - sp / risk
        res[-T - 1:] = np.nan
        out[d] = (res, exitk)
    return out

def build(cfg):
    rows = []
    for p in PAIRS:
        df = load(p, YEARS, '15m')
        X, a = features(df)
        L = labels(df, a, cfg, FLOOR[p])
        for d in (1, -1):
            Z = X.copy(); Z['dir'] = d; Z['pair'] = PAIRS.index(p)
            for col in ['d20', 'd50', 'd200', 'tr1h', 's20', 'macd', 'r1', 'r4', 'r16', 'r96', 'body', 'bbz', 'di']:
                Z[col] = Z[col] * d                                   # direction-aware features
            Z['rsi_d'] = np.where(d > 0, Z['rsi'], 100 - Z['rsi']); Z['rsi7_d'] = np.where(d > 0, Z['rsi7'], 100 - Z['rsi7'])
            Z['hi_d'] = np.where(d > 0, Z['hi20'], Z['lo20']); Z['lo_d'] = np.where(d > 0, Z['lo20'], Z['hi20'])
            Z = Z.drop(columns=['rsi', 'rsi7', 'hi20', 'lo20'])
            Z['y'] = L[d][0]; Z['exitk'] = L[d][1]; Z['year'] = df.index.year; Z['i'] = np.arange(len(df))
            Z = Z.iloc[300:]
            rows.append(Z)
    D = pd.concat(rows); D = D[np.isfinite(D.y)]
    return D

FEATS = None

def simulate_pick(P, thr):
    """one open position per market: walk in time, take best-direction signal if pred>thr while flat"""
    res = []; days = set()
    for (p,), g in P.groupby(['pair']):
        g = g.sort_values('i')
        best = g.loc[g.groupby('i')['pred'].idxmax()] if g.index.is_unique else g.sort_values('pred').groupby('i').tail(1)
        best = best.sort_values('i')
        free_at = -1
        for i, pr, y, k in zip(best.i.values, best.pred.values, best.y.values, best.exitk.values):
            if i < free_at or pr <= thr: continue
            res.append(y); free_at = i + 1 + k
    return np.array(res)

def stats(a, ndays):
    if not len(a): return dict(n=0)
    g, L = a[a > 0].sum(), -a[a < 0].sum()
    return dict(n=len(a), wr=round(float((a > 0).mean() * 100), 1), exp=round(float(a.mean()), 3), pf=round(float(g / L), 2) if L else 99, net=round(float(a.sum()), 1), perDay=round(len(a) / ndays, 1))

if __name__ == '__main__':
    out = {}
    for ci, cfg in enumerate(CFG):
        D = build(cfg)
        feats = [c for c in D.columns if c not in ('y', 'exitk', 'year', 'i')]
        P_all = []
        for ty in YEARS[1:]:
            tr = D[D.year < ty]; te = D[D.year == ty].copy()
            mdl = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.03, num_leaves=31, min_child_samples=500, subsample=0.7, subsample_freq=1, colsample_bytree=0.7, verbose=-1)
            mdl.fit(tr[feats], tr.y.clip(-1.5, 3))
            te['pred'] = mdl.predict(te[feats]); P_all.append(te)
        P = pd.concat(P_all).reset_index(drop=True)
        ndays = 3 * 260
        print(f"\nCFG {cfg}  baseline all candidates exp {P.y.mean():+.3f}R", flush=True)
        res_cfg = {}
        for thr in [0.0, 0.05, 0.1, 0.15, 0.2, 0.3]:
            a = simulate_pick(P, thr)
            s = stats(a, ndays); res_cfg[thr] = s
            by = {int(y): round(float(simulate_pick(P[P.year == y], thr).sum()), 1) for y in YEARS[1:]}
            print(f"  thr {thr:.2f}: {s} years {by}", flush=True)
        # per pair at thr 0.1
        pp = {}
        for p in range(len(PAIRS)):
            a = simulate_pick(P[P.pair == p], 0.1); pp[PAIRS[p]] = stats(a, ndays)
        print('  per pair @0.1:', {k: (v.get('n'), v.get('exp'), v.get('pf')) for k, v in pp.items()}, flush=True)
        out[str(cfg)] = dict(thr=res_cfg, pairs=pp)
        json.dump(out, open('scalp_ml_results.json', 'w'), indent=1, default=str)

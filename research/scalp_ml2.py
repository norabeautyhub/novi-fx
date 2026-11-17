"""Model v2: the bot learns from ~60 inputs — every common indicator, candlestick patterns,
bigger-timeframe context (1h/4h proxies on 15m) — then walk-forward vs v1.
Direction handling is generic (metadata exported for JS):
  SIGNED  → value × dir           FLIP100 → dir>0 ? x : 100 − x
  FLIP1   → dir>0 ? x : 1 − x      SWAP    → pairs swapped for SELL"""
import json, sys, numpy as np, pandas as pd, lightgbm as lgb
from engine import load, ema, rsi, atr, macd_hist, adx, wilder
import scalp_ml as S

def sma(x, n): return pd.Series(x).rolling(n).mean().values
def rstd(x, n): return pd.Series(x).rolling(n).std().values
def rmax(x, n): return pd.Series(x).rolling(n).max().values
def rmin(x, n): return pd.Series(x).rolling(n).min().values

def supertrend(h, l, c, n=10, m=3.0):
    a = atr(h, l, c, n); hl2 = (h + l) / 2; ub = hl2 + m * a; lb = hl2 - m * a
    fu = ub.copy(); fl = lb.copy(); d = np.ones(len(c))
    for i in range(1, len(c)):
        fu[i] = ub[i] if (ub[i] < fu[i - 1] or c[i - 1] > fu[i - 1]) else fu[i - 1]
        fl[i] = lb[i] if (lb[i] > fl[i - 1] or c[i - 1] < fl[i - 1]) else fl[i - 1]
        d[i] = 1 if c[i] > fu[i - 1] else -1 if c[i] < fl[i - 1] else d[i - 1]
    return d, np.where(d > 0, fl, fu)

def run_len(sign):
    out = np.zeros(len(sign))
    for i in range(len(sign)):
        if sign[i] == 0: out[i] = 0
        elif i and np.sign(out[i - 1]) == sign[i]: out[i] = out[i - 1] + sign[i]
        else: out[i] = sign[i]
    return out

SIGNED = ['d20', 'd50', 'd200', 'tr1h', 's20', 'macd', 'r1', 'r4', 'r16', 'r96', 'body', 'bbz', 'di',
          'cci', 'x921', 'g921', 'st_dir', 'st_dist', 'macdl', 'd800', 's200', 'di56', 'engulf', 'pin', 'star', 'runlen', 'body1', 'body2', 'tr4h']
FLIP100 = ['rsi', 'rsi7', 'stk', 'std_', 'wr', 'rsi56', 'rsi224']
FLIP1 = ['don']
SWAP = [('hi20', 'lo20'), ('hh96', 'll96'), ('uw', 'lw')]

def features2(df):
    c, h, l, o = df.close.values, df.high.values, df.low.values, df.open.values
    a = atr(h, l, c); r = rsi(c); ad, pdi, ndi = adx(h, l, c); m = macd_hist(c)
    e9, e20, e21, e50, e80, e200, e800 = (ema(c, n) for n in (9, 20, 21, 50, 80, 200, 800))
    s = pd.Series(c)
    rng = np.where(h - l == 0, 1e-12, h - l)
    hh14, ll14 = rmax(h, 14), rmin(l, 14)
    kraw = np.where(hh14 - ll14 == 0, 50, 100 * (c - ll14) / np.where(hh14 - ll14 == 0, 1, hh14 - ll14))
    stk = sma(kraw, 3); std_ = sma(stk, 3)
    tp = (h + l + c) / 3; smtp = sma(tp, 20)
    mad = pd.Series(tp).rolling(20).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True).values
    cci = (tp - smtp) / (0.015 * np.where(mad == 0, 1e-12, mad))
    st_dir, st_line = supertrend(h, l, c)
    hh55, ll55 = rmax(h, 55), rmin(l, 55)
    ml = ema(c, 12) - ema(c, 26)
    ad56, p56, n56 = adx(h, l, c, 56)
    bull = c > o; bear = c < o
    po, pc_ = np.r_[np.nan, o[:-1]], np.r_[np.nan, c[:-1]]
    engulf = np.where(bull & (pc_ < po) & (c >= po) & (o <= pc_), 1, np.where(bear & (pc_ > po) & (c <= po) & (o >= pc_), -1, 0))
    bodyabs = np.abs(c - o); uw = h - np.maximum(o, c); lw = np.minimum(o, c) - l
    pin = np.where((lw >= 2 * bodyabs) & (uw <= bodyabs + 1e-12) & (lw > 0), 1, np.where((uw >= 2 * bodyabs) & (lw <= bodyabs + 1e-12) & (uw > 0), -1, 0))
    o2, c2 = np.r_[np.nan, np.nan, o[:-2]], np.r_[np.nan, np.nan, c[:-2]]
    o1, c1 = po, pc_
    a1 = np.r_[np.nan, a[:-1]]
    small1 = np.abs(c1 - o1) < 0.3 * a1
    star = np.where((c2 < o2) & small1 & bull & (c > (o2 + c2) / 2), 1, np.where((c2 > o2) & small1 & bear & (c < (o2 + c2) / 2), -1, 0))
    inside = ((h <= np.r_[np.inf, h[:-1]]) & (l >= np.r_[-np.inf, l[:-1]])).astype(float)
    X = pd.DataFrame({
        'hour': df.index.hour, 'dow': df.index.dayofweek,
        'atr_sp': a / np.maximum(df.spread.values, 1e-9), 'atr_rel': a / sma(a, 96),
        'rsi': r, 'rsi7': rsi(c, 7), 'adx': ad, 'di': (pdi - ndi),
        'd20': (c - e20) / a, 'd50': (c - e50) / a, 'd200': (c - e200) / a,
        'tr1h': np.sign(e80 - e200), 's20': (e20 - np.r_[e20[:4], e20[:-4]]) / a,
        'macd': m / a, 'r1': (c - s.shift(1).values) / a, 'r4': (c - s.shift(4).values) / a, 'r16': (c - s.shift(16).values) / a,
        'r96': (c - s.shift(96).values) / a, 'rng': (h - l) / a, 'body': (c - o) / a,
        'hi20': (rmax(c, 20) - c) / a, 'lo20': (c - rmin(c, 20)) / a,
        'bbz': (c - sma(c, 20)) / rstd(c, 20),
        # --- v2: more indicators ---
        'stk': stk, 'std_': std_, 'wr': kraw, 'cci': cci,
        'x921': np.sign(e9 - e21), 'g921': (e9 - e21) / a, 'bbw': 4 * rstd(c, 20) / a,
        'st_dir': st_dir, 'st_dist': (c - st_line) / a, 'don': (c - ll55) / np.where(hh55 - ll55 == 0, 1e-12, hh55 - ll55),
        'macdl': ml / a, 'atr7_28': atr(h, l, c, 7) / atr(h, l, c, 28),
        # --- bigger timeframe context (1h ≈ ×4, 4h ≈ ×16 on 15m) ---
        'rsi56': rsi(c, 56), 'rsi224': rsi(c, 224), 'adx56': ad56, 'di56': p56 - n56,
        'd800': (c - e800) / a, 's200': (e200 - np.r_[e200[:16], e200[:-16]]) / a, 'tr4h': np.sign(e200 - e800),
        'hh96': (rmax(h, 96) - c) / a, 'll96': (c - rmin(l, 96)) / a,
        # --- candlesticks ---
        'engulf': engulf, 'pin': pin, 'star': star, 'inside': inside, 'doji': (bodyabs / rng < 0.1).astype(float),
        'uw': uw / rng, 'lw': lw / rng, 'bodyr': bodyabs / rng, 'runlen': run_len(np.sign(c - o)),
        'body1': (c1 - o1) / a, 'body2': (c2 - o2) / a,
    }, index=df.index)
    return X, a

def directional(X, d):
    Z = X.copy()
    for k in SIGNED: Z[k] = Z[k] * d
    for k in FLIP100: Z[k] = Z[k] if d > 0 else 100 - Z[k]
    for k in FLIP1: Z[k] = Z[k] if d > 0 else 1 - Z[k]
    if d < 0:
        for x, y in SWAP: Z[x], Z[y] = X[y].values, X[x].values
    Z['dir'] = d
    return Z

def build(cfg):
    rows = []
    for p in S.PAIRS:
        df = load(p, S.YEARS, '15m')
        X, a = features2(df)
        L = S.labels(df, a, cfg, S.FLOOR[p])
        for d in (1, -1):
            Z = directional(X, d); Z['pair'] = S.PAIRS.index(p)
            Z['y'] = L[d][0]; Z['exitk'] = L[d][1]; Z['year'] = df.index.year; Z['i'] = np.arange(len(df))
            rows.append(Z.iloc[900:])
    D = pd.concat(rows); D = D[np.isfinite(D.y)]
    return D

PARAMS = dict(n_estimators=400, learning_rate=0.03, num_leaves=31, min_child_samples=500, subsample=0.7, subsample_freq=1, colsample_bytree=0.6, verbose=-1)

def walk(D, feats, params=PARAMS):
    P_all = []
    for ty in S.YEARS[1:]:
        tr = D[D.year < ty]; te = D[D.year == ty].copy()
        m = lgb.LGBMRegressor(**params); m.fit(tr[feats], tr.y.clip(-1.5, 3))
        te['pred'] = m.predict(te[feats]); P_all.append(te)
    return pd.concat(P_all).reset_index(drop=True)

def by_rate(P, label):
    """compare models at the same number of trades per day"""
    out = {}
    for thr in np.arange(-0.05, 0.4, 0.01):
        a = S.simulate_pick(P, thr)
        if not len(a): break
        rate = len(a) / 780
        for target in (0.5, 1, 2, 3, 4):
            if abs(rate - target) < abs(out.get(target, {}).get('rate', 99) - target):
                by = {int(y): round(float(S.simulate_pick(P[P.year == y], thr).sum()), 1) for y in S.YEARS[1:]}
                out[target] = dict(thr=round(float(thr), 2), rate=round(rate, 2), **S.stats(a, 780), years=by)
    for t, v in sorted(out.items()): print(f"  {label} ~{t}/day: thr {v['thr']} n {v['n']} win {v['wr']}% PF {v['pf']} net {v['net']}R years {v['years']}", flush=True)
    return out

if __name__ == '__main__':
    cfg = S.CFG[int(sys.argv[1]) if len(sys.argv) > 1 else 1]
    D = build(cfg)
    v2 = [c for c in D.columns if c not in ('y', 'exitk', 'year', 'i')]
    v1 = ['hour', 'dow', 'atr_sp', 'atr_rel', 'adx', 'di', 'd20', 'd50', 'd200', 'tr1h', 's20', 'macd', 'r1', 'r4', 'r16', 'r96', 'rng', 'body', 'bbz', 'dir', 'pair', 'rsi', 'rsi7', 'hi20', 'lo20']
    print('CFG', cfg, 'features v1', len(v1), 'v2', len(v2), flush=True)
    res = {'v1': by_rate(walk(D, v1, dict(PARAMS, n_estimators=300, colsample_bytree=0.7)), 'v1'), 'v2': by_rate(walk(D, v2), 'v2')}
    json.dump(res, open(f'scalp_v2_cfg{S.CFG.index(cfg)}.json', 'w'), indent=1, default=str)

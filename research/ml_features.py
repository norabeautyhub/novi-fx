"""Feature + label builder for ML research (no look-ahead in features)."""
import numpy as np, pandas as pd
from engine import load, ema, wilder, atr, rsi, adx, macd_hist, rolling_max, rolling_min, features as base_features

def _htf(df, rule, fn):
    """compute a feature on completed higher-TF bars and forward-fill to base bars"""
    h = df.resample(rule).agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last'}).dropna()
    out = fn(h)
    out.index = out.index + pd.Timedelta(rule)
    return out.reindex(df.index, method='ffill')

def stoch(h, l, c, n=14):
    hh = pd.Series(h).rolling(n).max().values; ll = pd.Series(l).rolling(n).min().values
    k = 100 * (c - ll) / np.where(hh - ll == 0, 1e-12, hh - ll)
    k3 = pd.Series(k).rolling(3).mean().values
    return k3, pd.Series(k3).rolling(3).mean().values

def build(pair, years, tf='1h'):
    df = load(pair, years, tf)
    o, h, l, c = (df[k].values for k in ('open', 'high', 'low', 'close'))
    F = base_features(df)
    a = F['atr']; a100 = pd.Series(a).rolling(100).mean().values
    X = {}
    for n in (1, 3, 6, 12, 24, 48):
        X[f'ret{n}'] = (c - np.r_[np.full(n, np.nan), c[:-n]]) / a
    for n in (20, 50, 200):
        e = F[f'ema{n}']
        X[f'dist_ema{n}'] = (c - e) / a
        X[f'slope_ema{n}'] = (e - np.r_[np.full(5, np.nan), e[:-5]]) / a
    X['rsi'] = F['rsi']; X['rsi_d3'] = F['rsi'] - np.r_[np.full(3, np.nan), F['rsi'][:-3]]
    X['macd'] = macd_hist(c) / a
    X['adx'] = F['adx']; X['di'] = F['pdi'] - F['ndi']
    k, d = stoch(h, l, c); X['stoch_k'] = k; X['stoch_kd'] = k - d
    m20 = pd.Series(c).rolling(20).mean().values; sd = pd.Series(c).rolling(20).std().values
    X['bb_pb'] = (c - (m20 - 2 * sd)) / np.where(sd == 0, 1e-12, 4 * sd); X['bb_w'] = 4 * sd / a
    X['atr_pct'] = a / c * 100; X['atr_ratio'] = a / a100
    for n in (20, 55):
        hh = rolling_max(h, n); ll = rolling_min(l, n)
        X[f'don{n}'] = (c - ll) / np.where(hh - ll == 0, 1e-12, hh - ll)
    X['htf4'] = F['htf4']; X['htfD'] = F['htfD']
    rng = np.where(h - l == 0, 1e-12, h - l)
    X['body'] = (c - o) / rng; X['upw'] = (h - np.maximum(o, c)) / rng; X['low'] = (np.minimum(o, c) - l) / rng
    for j in (1, 2, 3):
        X[f'dir{j}'] = np.sign(np.r_[np.full(j, np.nan), (c - o)[:-j]])
    hr = df.index.hour.values; dw = df.index.dayofweek.values
    X['hr_s'] = np.sin(2 * np.pi * hr / 24); X['hr_c'] = np.cos(2 * np.pi * hr / 24); X['dow'] = dw
    # higher timeframe features (completed bars only)
    X['rsi_4h'] = _htf(df, '4h', lambda x: pd.Series(rsi(x.close.values), index=x.index)).values
    X['dist_ema50_4h'] = _htf(df, '4h', lambda x: pd.Series((x.close.values - ema(x.close.values, 50)) / atr(x.high.values, x.low.values, x.close.values), index=x.index)).values
    X['adx_4h'] = _htf(df, '4h', lambda x: pd.Series(adx(x.high.values, x.low.values, x.close.values)[0], index=x.index)).values
    X['rsi_d'] = _htf(df, '1D', lambda x: pd.Series(rsi(x.close.values), index=x.index)).values
    X['dist_ema20_d'] = _htf(df, '1D', lambda x: pd.Series((x.close.values - ema(x.close.values, 20)) / atr(x.high.values, x.low.values, x.close.values), index=x.index)).values
    X = pd.DataFrame(X, index=df.index)
    return df, F, X

def labels(F, k_sl=1.5, tp_r=1.0, H=48, cost=0.0):
    """Triple barrier from next open: +1 if TP hit before SL (SL checked first), 0 otherwise.
    Returns y_long, y_short and realised R for each (incl. cost) to evaluate trading."""
    o, h, l, c, a, spr = F['o'], F['h'], F['l'], F['c'], F['atr'], F['spread']
    n = len(c)
    yl = np.full(n, np.nan); ys = np.full(n, np.nan); rl = np.full(n, np.nan); rs = np.full(n, np.nan)
    xl = np.zeros(n, int); xs = np.zeros(n, int)
    for i in range(250, n - H - 1):
        e = o[i + 1]; risk = k_sl * a[i]
        if not risk > 0: continue
        cr = cost * spr[i] / risk
        for d, Y, R, XI in ((1, yl, rl, xl), (-1, ys, rs, xs)):
            stop = e - d * risk; tp = e + d * tp_r * risk; out = None
            for j in range(i + 1, i + 1 + H):
                if (l[j] <= stop) if d == 1 else (h[j] >= stop): out = -1.0; break
                if (h[j] >= tp) if d == 1 else (l[j] <= tp): out = tp_r; break
            if out is None: out = d * (c[i + H] - e) / risk; j = i + H
            Y[i] = 1.0 if out > 0 else 0.0; R[i] = out - cr; XI[i] = j
    return yl, ys, rl, rs, xl, xs

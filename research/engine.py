"""Strategy research engine: indicators, strategies, cost-aware trade simulator."""
import numpy as np, pandas as pd

# ---------------- data ----------------
def load(pair, years, tf):
    dfs = [pd.read_csv(f'data/{pair}_{y}.csv', parse_dates=['t'], index_col='t') for y in years]
    df = pd.concat(dfs).sort_index()
    df = df[~df.index.duplicated()]
    rule = {'15m': '15min', '1h': '1h', '4h': '4h'}[tf]
    o = df.resample(rule).agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'spread': 'mean', 'ticks': 'sum'}).dropna()
    o = o[o.high > o.low]
    return o

# ---------------- indicators ----------------
def ema(x, n): return pd.Series(x).ewm(span=n, adjust=False).mean().values
def wilder(x, n): return pd.Series(x).ewm(alpha=1 / n, adjust=False).mean().values

def atr(h, l, c, n=14):
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum(h - l, np.maximum(abs(h - pc), abs(l - pc)))
    return wilder(tr, n)

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0])
    g = wilder(np.clip(d, 0, None), n); l = wilder(np.clip(-d, 0, None), n)
    return 100 - 100 / (1 + g / np.where(l == 0, 1e-12, l))

def adx(h, l, c, n=14):
    up = np.diff(h, prepend=h[0]); dn = -np.diff(l, prepend=l[0])
    pdm = np.where((up > dn) & (up > 0), up, 0.0); ndm = np.where((dn > up) & (dn > 0), dn, 0.0)
    a = atr(h, l, c, n)
    pdi = 100 * wilder(pdm, n) / a; ndi = 100 * wilder(ndm, n) / a
    dx = 100 * abs(pdi - ndi) / np.where(pdi + ndi == 0, 1e-12, pdi + ndi)
    return wilder(dx, n), pdi, ndi

def macd_hist(c):
    m = ema(c, 12) - ema(c, 26)
    return m - ema(m, 9)

def rolling_max(x, n): return pd.Series(x).rolling(n).max().values
def rolling_min(x, n): return pd.Series(x).rolling(n).min().values

def htf_trend(df, rule='4h', n=50):
    """Higher-timeframe trend from COMPLETED higher bars only (no look-ahead)."""
    h = df.resample(rule).agg({'close': 'last'}).dropna()
    e = pd.Series(ema(h.close.values, n), index=h.index)
    tr = np.sign(h.close - e) * (e.diff() * np.sign(h.close - e) > 0)   # price side of EMA AND EMA sloping that way
    # a 4h bar labelled 08:00 closes at 12:00 → shift index by one bar length before ffill
    tr.index = tr.index + pd.Timedelta(rule)
    return tr.reindex(df.index, method='ffill').fillna(0).values

def features(df):
    o, h, l, c = (df[k].values for k in ('open', 'high', 'low', 'close'))
    F = dict(o=o, h=h, l=l, c=c, spread=df.spread.values, idx=df.index)
    F['atr'] = atr(h, l, c); F['rsi'] = rsi(c); F['adx'], F['pdi'], F['ndi'] = adx(h, l, c)
    for n in (20, 50, 200): F[f'ema{n}'] = ema(c, n)
    F['hist'] = macd_hist(c)
    F['hour'] = df.index.hour.values
    F['htf4'] = htf_trend(df, '4h', 50)
    F['htfD'] = htf_trend(df, '1D', 20)
    return F

# ---------------- strategies: return (signal[-1/0/1], stop_distance) ----------------
def s_baseline(F, p):
    """The current app engine (confluence score)."""
    c, e20, e50, e200, r, hi, a = F['c'], F['ema20'], F['ema50'], F['ema200'], F['rsi'], F['hist'], F['atr']
    sc = np.zeros(len(c))
    sc += np.where((c > e200) & (e50 > e200), 2, np.where((c < e200) & (e50 < e200), -2, 0))
    sc += np.where(e20 > e50, 1, -1)
    sc += np.where(hi > 0, 1, -1)
    hp = np.r_[0, hi[:-1]]
    sc += np.where((hi > 0) & (hp <= 0), 1, 0) - np.where((hi < 0) & (hp >= 0), 1, 0)
    rp = np.r_[50, r[:-1]]
    sc += np.where(r > 70, -1, np.where(r < 30, 1, np.where((r > 50) & (r > rp), 1, np.where((r < 50) & (r < rp), -1, 0))))
    sig = np.where(sc >= 4, 1, np.where(sc <= -4, -1, 0))
    return sig, 1.5 * a

def s_pullback(F, p):
    """Trend pullback: HTF trend + price pulls back to EMA20/50 band, then momentum resumes."""
    c, l, h, e20, e50, e200, r, a, adx_ = F['c'], F['l'], F['h'], F['ema20'], F['ema50'], F['ema200'], F['rsi'], F['atr'], F['adx']
    htf = F[p.get('htf', 'htf4')]
    up = (htf > 0) & (e20 > e50) & (e50 > e200) & (adx_ > p['adx'])
    dn = (htf < 0) & (e20 < e50) & (e50 < e200) & (adx_ > p['adx'])
    lb = p.get('lookback', 5)
    touched_dn = rolling_min(l - e20, lb) <= p['touch'] * a     # low came within touch*ATR of EMA20 recently
    touched_up = rolling_max(e20 - h, lb) <= p['touch'] * a
    rp = np.r_[50, r[:-1]]
    trig_up = (r > p['rsi']) & (rp <= p['rsi']) & (c > e20)
    trig_dn = (r < 100 - p['rsi']) & (rp >= 100 - p['rsi']) & (c < e20)
    sig = np.where(up & touched_dn & trig_up, 1, np.where(dn & touched_up & trig_dn, -1, 0))
    return sig, p['sl'] * a

def s_breakout(F, p):
    """Donchian breakout in HTF trend direction, optional session filter."""
    c, h, l, a, adx_ = F['c'], F['h'], F['l'], F['atr'], F['adx']
    n = p['n']
    hh = np.r_[np.nan, rolling_max(h, n)[:-1]]; ll = np.r_[np.nan, rolling_min(l, n)[:-1]]
    htf = F[p.get('htf', 'htf4')]
    sess = np.isin(F['hour'], p['hours']) if p.get('hours') is not None else np.ones(len(c), bool)
    cp = np.r_[c[0], c[:-1]]
    up = (c > hh) & (cp <= hh) & (htf > 0) & sess & (adx_ > p.get('adx', 0))
    dn = (c < ll) & (cp >= ll) & (htf < 0) & sess & (adx_ > p.get('adx', 0))
    return np.where(up, 1, np.where(dn, -1, 0)), p['sl'] * a

def s_meanrev(F, p):
    """Range mean reversion: low ADX, RSI extreme back inside, against short stretch."""
    c, r, a, adx_, e50 = F['c'], F['rsi'], F['atr'], F['adx'], F['ema50']
    rp = np.r_[50, r[:-1]]
    rng = adx_ < p['adx']
    up = rng & (rp < p['lo']) & (r >= p['lo'])
    dn = rng & (rp > 100 - p['lo']) & (r <= 100 - p['lo'])
    return np.where(up, 1, np.where(dn, -1, 0)), p['sl'] * a

STRATS = {'baseline': s_baseline, 'pullback': s_pullback, 'breakout': s_breakout, 'meanrev': s_meanrev}

# ---------------- simulator ----------------
def simulate(F, sig, sld, tp_r=2.0, be_r=None, max_bars=None, cost_mult=1.2, trail_atr=None):
    """Enter next bar open. SL checked before TP inside a bar (conservative).
    Cost = cost_mult * spread (round trip), expressed in R. Returns array of R results and entry indices."""
    o, h, l, c, spr, a = F['o'], F['h'], F['l'], F['c'], F['spread'], F['atr']
    n = len(c); res = []; ent = []
    i = 250
    while i < n - 1:
        s = sig[i]
        if s == 0 or not np.isfinite(sld[i]) or sld[i] <= 0: i += 1; continue
        d = s; e = o[i + 1]; risk = sld[i]
        stop = e - d * risk; tp = e + d * tp_r * risk
        cost_r = cost_mult * spr[i] / risk
        moved_be = False; j = i + 1; out = None
        while j < n:
            if d == 1:
                if l[j] <= stop: out = (stop - e) / risk; break
                if h[j] >= tp: out = tp_r; break
            else:
                if h[j] >= stop: out = (e - stop) / risk; break
                if l[j] <= tp: out = tp_r; break
            fav = d * ((h[j] if d == 1 else l[j]) - e) / risk
            if be_r is not None and not moved_be and fav >= be_r:
                stop = e; moved_be = True
            if trail_atr is not None and fav >= 1:
                cand = (c[j] - trail_atr * a[j]) if d == 1 else (c[j] + trail_atr * a[j])
                stop = max(stop, cand) if d == 1 else min(stop, cand)
            if max_bars is not None and j - i >= max_bars:
                out = d * (c[j] - e) / risk; break
            j += 1
        if out is None: break
        res.append(out - cost_r); ent.append(i)
        i = j  # one trade at a time
    return np.array(res), np.array(ent)

def stats(r):
    if len(r) == 0: return dict(n=0, wr=0, net=0, pf=0, dd=0, exp=0)
    eq = np.cumsum(r); dd = np.max(np.maximum.accumulate(eq) - eq)
    gw = r[r > 0].sum(); gl = -r[r < 0].sum()
    return dict(n=len(r), wr=round(100 * (r > 0).mean(), 1), net=round(eq[-1], 1), pf=round(gw / gl, 2) if gl else 99,
                dd=round(dd, 1), exp=round(r.mean(), 3))

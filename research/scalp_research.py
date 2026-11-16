"""Scalping bot research: frequent entries on 15m, small take-profit, fixed stop, time stop.
Entry rules (decided on a closed 15m bar, filled at next open, spread*1.2 cost):
  pull : 1h trend (EMA80/EMA200 on 15m) + RSI crosses 50 in trend direction
  score: |trend + price>EMA20 + EMA20>EMA50 + RSI>50 + MACD hist| >= 4  (continuous)
  brk  : 1h trend + close breaks 20-bar high/low
  dip  : 1h trend up and RSI<35 → buy (mirror for sell)
Exits: TP = tp×ATR, SL = sl×ATR, time stop T bars. Same-bar TP&SL → counted as SL.
Result per trade in R (R = stop distance) so $ = R × risk."""
import itertools, json, sys, numpy as np, pandas as pd
from engine import load, ema, rsi, atr, macd_hist, rolling_max, rolling_min
from verify_markets import FLOOR as F0

FLOOR = dict(F0, XAUUSD=0.25, EURUSD=0.00012)
YEARS = {'XAUUSD': [2015, 2016, 2017, 2018], 'EURUSD': [2015, 2016, 2017, 2018]}

def feats(df, floor):
    c, h, l, o = df.close.values, df.high.values, df.low.values, df.open.values
    e20, e50, e80, e200 = ema(c, 20), ema(c, 50), ema(c, 80), ema(c, 200)
    r = rsi(c); a = atr(h, l, c); m = macd_hist(c)
    trend = np.sign(e80 - e200)
    hi20 = np.r_[np.nan, rolling_max(h, 20)[:-1]]; lo20 = np.r_[np.nan, rolling_min(l, 20)[:-1]]
    rp = np.r_[50, r[:-1]]
    sig = {}
    sig['pull'] = np.where((trend > 0) & (rp < 50) & (r >= 50), 1, np.where((trend < 0) & (rp > 50) & (r <= 50), -1, 0))
    sc = trend + np.sign(c - e20) + np.sign(e20 - e50) + np.sign(r - 50) + np.sign(m)
    sig['score'] = np.where(sc >= 4, 1, np.where(sc <= -4, -1, 0))
    sig['brk'] = np.where((trend > 0) & (c > hi20), 1, np.where((trend < 0) & (c < lo20), -1, 0))
    sig['dip'] = np.where((trend > 0) & (r < 35), 1, np.where((trend < 0) & (r > 65), -1, 0))
    for k in sig: sig[k][:250] = 0
    spread = np.maximum(df.spread.values, floor)
    return dict(o=o, h=h, l=l, c=c, a=a, spread=spread, sig=sig, t=df.index)

def sim(F, s, tp, sl, T):
    o, h, l, c, a, sp = F['o'], F['h'], F['l'], F['c'], F['a'], F['spread']
    n = len(c); res = []; ent = []; i = 0
    while i < n - 2:
        d = s[i]
        if d == 0: i += 1; continue
        e = o[i + 1]; risk = sl * a[i]
        if risk <= 0: i += 1; continue
        cost = sp[i] * 1.2 / risk
        tpp = e + d * tp * a[i]; slp = e - d * risk
        out = None
        for j in range(i + 1, min(n, i + 1 + T)):
            hit_sl = (l[j] <= slp) if d > 0 else (h[j] >= slp)
            hit_tp = (h[j] >= tpp) if d > 0 else (l[j] <= tpp)
            if hit_sl: out = (-1.0, j); break
            if hit_tp: out = (tp / sl, j); break
        if out is None:
            j = min(n - 1, i + T); out = (d * (c[j] - e) / risk, j)
        res.append(out[0] - cost); ent.append(i)
        i = out[1] + 1  # next entry only after this one is closed (one position per market)
    return np.array(res), np.array(ent, dtype=int)

def st(a, days):
    if len(a) == 0: return dict(n=0, wr=0, exp=0, pf=0, net=0, perDay=0)
    g, L = a[a > 0].sum(), -a[a < 0].sum()
    return dict(n=len(a), wr=round((a > 0).mean() * 100, 1), exp=round(a.mean(), 3), pf=round(g / L, 2) if L else 99, net=round(a.sum(), 1), perDay=round(len(a) / days, 1))

GRID = list(itertools.product(['pull', 'score', 'brk', 'dip'], [0.5, 0.75, 1.0, 1.5, 2.0], [1.0, 1.5, 2.0], [16, 48]))

def run(pair):
    yrs = YEARS.get(pair, [2015, 2016, 2017, 2018])
    FY = {}
    for y in yrs:
        try: df = load(pair, [x for x in yrs if x in (y - 1, y)], '15m')
        except Exception: continue
        F = feats(df, FLOOR[pair]); m = (df.index.year == y)
        FY[y] = (F, m, max(1, len(np.unique(df.index[m].date))))
    R = {}
    for g in GRID:
        strat, tp, sl, T = g
        per = {}
        for y, (F, m, days) in FY.items():
            r, e = sim(F, F['sig'][strat], tp, sl, T)
            per[y] = r[m[e]] if len(e) else r
        R[g] = per
    ys = sorted(FY)
    oos = []
    for k in range(1, len(ys)):
        best, bs = None, -9
        for g, per in R.items():
            a = np.concatenate([per[y] for y in ys[:k]])
            if len(a) >= 100 and a.mean() > bs: bs, best = a.mean(), g
        if best: oos.append(R[best][ys[k]])
    days_oos = sum(FY[y][2] for y in ys[1:])
    wf = st(np.concatenate(oos), days_oos) if oos else st(np.array([]), 1)
    alld = sum(v[2] for v in FY.values())
    ranked = sorted(((np.concatenate(list(p.values())).mean(), g) for g, p in R.items() if len(np.concatenate(list(p.values()))) >= 200), reverse=True)
    top = ranked[0][1]
    a = np.concatenate(list(R[top].values()))
    out = dict(wf=wf, best=dict(strat=top[0], tp=top[1], sl=top[2], T=top[3], **st(a, alld), years={y: round(float(R[top][y].sum()), 1) for y in ys}))
    # the "small profit" settings the user asked about: TP 0.5 ATR with each stop, best entry
    small = {}
    for sl in [1.0, 1.5, 2.0]:
        cand = [(np.concatenate(list(R[(s_, 0.5, sl, T)].values())).mean(), (s_, 0.5, sl, T)) for s_ in ['pull', 'score', 'brk', 'dip'] for T in [16, 48]]
        g = max(cand)[1]; small[f'sl{sl}'] = dict(strat=g[0], T=g[3], **st(np.concatenate(list(R[g].values())), alld))
    out['smallTP'] = small
    print(f"{pair}: WF {wf} | best {out['best']} | smallTP {small}", flush=True)
    return out

if __name__ == '__main__':
    pairs = sys.argv[1:] or ['XAUUSD', 'EURUSD', 'XAGUSD', 'GBPUSD', 'AUDUSD', 'USDJPY', 'USDCAD', 'USDCHF', 'GBPJPY', 'EURJPY', 'NZDUSD', 'EURGBP']
    allr = {}
    try: allr = json.load(open('scalp_results.json'))
    except Exception: pass
    for p in pairs:
        allr[p] = run(p); json.dump(allr, open('scalp_results.json', 'w'), default=str, indent=1)

"""Win-rate research: trade management + filters + limit entries on the verified strategies.
Walk-forward: pick settings on earlier years, judge on later years. Costs included."""
import itertools, json, numpy as np, pandas as pd
from engine import load, features, STRATS, stats

LONDON_NY = list(range(7, 17))
SETUPS = {
    'XAU_1h': ('XAUUSD', '1h', [2014, 2015, 2016, 2017, 2018], 0.35, 'pullback', dict(adx=25, htf='htfD', rsi=50, sl=1.5, touch=0.3)),
    'XAU_4h': ('XAUUSD', '4h', [2014, 2015, 2016, 2017, 2018], 0.35, 'breakout', dict(n=55, sl=1.5, htf='htfD', hours=LONDON_NY, adx=20)),
    'EUR_4h': ('EURUSD', '4h', [2017, 2018, 2019, 2020, 2021], 0.00012, 'pullback', dict(adx=15, htf='htf4', rsi=50, sl=2.0, touch=0.0)),
}

def sim2(F, sig, sld, tp=3.0, part=0.0, p1=1.0, be=None, trail=None, entry='market', lim=0.3, lim_bars=3, cost_mult=1.2, start=250):
    """part = fraction closed at p1 R; be = move SL to entry after `be` R; trail = ATR trail after 1R;
    entry='limit': wait up to lim_bars for price to come back lim*ATR, else skip."""
    o, h, l, c, a, spr = F['o'], F['h'], F['l'], F['c'], F['atr'], F['spread']
    n = len(c); R = []; i = start
    while i < n - 2:
        d = sig[i]
        if d == 0 or not sld[i] > 0: i += 1; continue
        risk = sld[i]
        if entry == 'market':
            e = o[i + 1]; j0 = i + 1
        else:
            target = c[i] - d * lim * a[i]; j0 = None
            for j in range(i + 1, min(n, i + 1 + lim_bars)):
                if (l[j] <= target) if d == 1 else (h[j] >= target): j0 = j; break
            if j0 is None: i += 1; continue
            e = target
            risk = max(risk - lim * a[i], 0.5 * a[i])   # stop stays at the same price → smaller risk
        stop = e - d * risk; tpp = e + d * tp * risk; p1p = e + d * p1 * risk
        cost_r = cost_mult * spr[i] / risk
        got_part = False; res = 0.0; moved = False; out = None; j = j0
        while j < n:
            # same candle: stop first (conservative)
            if (l[j] <= stop) if d == 1 else (h[j] >= stop):
                rem = (stop - e) / risk * d
                out = (part * p1 if got_part else 0) + (1 - (part if got_part else 0)) * rem; break
            if part > 0 and not got_part and ((h[j] >= p1p) if d == 1 else (l[j] <= p1p)):
                got_part = True
            if (h[j] >= tpp) if d == 1 else (l[j] <= tpp):
                out = (part * p1 if got_part else 0) + (1 - (part if got_part else 0)) * tp; break
            fav = d * ((h[j] if d == 1 else l[j]) - e) / risk
            if be is not None and not moved and fav >= be: stop = e + d * 0.05 * risk; moved = True   # +0.05R covers costs a bit
            if trail is not None and fav >= 1:
                cand = c[j] - d * trail * a[j]
                stop = max(stop, cand) if d == 1 else min(stop, cand)
            j += 1
        if out is None: break
        R.append(out - cost_r); i = j
    return np.array(R)

def filters(F, sig, name):
    s = sig.copy()
    if 'sess' in name: s[~np.isin(F['hour'], LONDON_NY)] = 0
    if 'vol' in name:
        a = F['atr']; ar = a / pd.Series(a).rolling(100).mean().values
        s[~((ar > 0.7) & (ar < 1.6))] = 0
    if 'mtf' in name: s[np.sign(F['htf4']) != s] = 0
    return s

MGMT = []
for tp, part, be, trail in itertools.product([1.5, 2, 3], [0, 0.5], [None, 1.0], [None, 2.0]):
    if part and tp <= 1.0: continue
    MGMT.append(dict(tp=tp, part=part, p1=1.0, be=be, trail=trail))
ENTRY = [dict(entry='market'), dict(entry='limit', lim=0.3, lim_bars=3), dict(entry='limit', lim=0.5, lim_bars=4)]
FILT = ['none', 'sess', 'vol', 'mtf', 'sess+vol', 'sess+mtf', 'vol+mtf']

def key(m, e, f): return json.dumps({**m, **e, 'filter': f}, sort_keys=True)

if __name__ == '__main__':
    report = {}
    for name, (pair, tf, years, floor, strat, sp) in SETUPS.items():
        # per-year features (with previous year for warm-up)
        FY = {}
        for y in years:
            yrs = [x for x in years if x in (y - 1, y)]
            df = load(pair, yrs, tf); F = features(df); F['spread'] = np.maximum(F['spread'], floor)
            m = df.index.year == y; st = max(0, int(np.argmax(m)) - 250)
            FY[y] = {k: (v[st:] if hasattr(v, '__len__') and len(v) == len(df) else v) for k, v in F.items()}
        res = {}
        for f in FILT:
            for e in ENTRY:
                for mg in MGMT:
                    per = {}
                    for y in years:
                        F = FY[y]; sig, sl = STRATS[strat](F, sp)
                        per[y] = sim2(F, filters(F, sig, f), sl, **mg, **e)
                    res[key(mg, e, f)] = per
        base = res[key(dict(tp=3, part=0, p1=1.0, be=None, trail=None), dict(entry='market'), 'none')]
        def summ(per):
            a = np.concatenate(list(per.values())); st = stats(a)
            st['pos'] = sum(v.sum() > 0 for v in per.values()); st['be'] = int((np.abs(a) < 0.1).sum())
            st['maxL'] = 0; L = 0
            for r in a: L = L + 1 if r <= 0 else 0; st['maxL'] = max(st['maxL'], L)
            return st
        print(f'\n################ {name} ({strat}) ################')
        print('BASELINE           ', summ(base))
        rows = [(k, summ(v)) for k, v in res.items()]
        good = [r for r in rows if r[1]['n'] >= 40 and r[1]['exp'] > 0 and r[1]['pos'] >= 4]
        print('-- highest WIN RATE (profitable, >=4/5 years positive):')
        for k, s in sorted(good, key=lambda r: -r[1]['wr'])[:8]: print(f"  wr {s['wr']:5.1f}% n {s['n']:4d} net {s['net']:+6.1f}R pf {s['pf']:.2f} pos {s['pos']}/5 maxL {s['maxL']} | {k}")
        print('-- highest PROFIT:')
        for k, s in sorted(good, key=lambda r: -r[1]['net'])[:5]: print(f"  wr {s['wr']:5.1f}% n {s['n']:4d} net {s['net']:+6.1f}R pf {s['pf']:.2f} pos {s['pos']}/5 maxL {s['maxL']} | {k}")
        # walk-forward: choose on years before test year, objective = win-rate among configs with expectancy >= 0.6 * best expectancy
        oos = {'wr_pick': [], 'exp_pick': []}
        for ti in range(2, len(years)):
            tr, te = years[:ti], years[ti]
            cand = []
            for k, per in res.items():
                a = np.concatenate([per[y] for y in tr])
                if len(a) < 25: continue
                cand.append((k, a.mean(), (a > 0).mean()))
            if not cand: continue
            best_exp = max(c[1] for c in cand)
            k_exp = max(cand, key=lambda c: c[1])[0]
            pool = [c for c in cand if c[1] >= 0.6 * best_exp and c[1] > 0]
            k_wr = max(pool, key=lambda c: c[2])[0] if pool else k_exp
            oos['wr_pick'].append(res[k_wr][te]); oos['exp_pick'].append(res[k_exp][te])
        bt = np.concatenate([base[y] for y in years[2:]])
        for nm, lst in oos.items():
            a = np.concatenate(lst) if lst else np.array([])
            s = stats(a)
            print(f"WALK-FORWARD {nm:8s} (test {years[2:]}): wr {s['wr']}% n {s['n']} net {s['net']:+}R pf {s['pf']} | baseline same years: wr {stats(bt)['wr']}% net {stats(bt)['net']:+}R pf {stats(bt)['pf']}")
        report[name] = {'baseline': summ(base), 'top_wr': [(k, s) for k, s in sorted(good, key=lambda r: -r[1]['wr'])[:15]], 'top_net': [(k, s) for k, s in sorted(good, key=lambda r: -r[1]['net'])[:15]]}
    json.dump(report, open('wr_report.json', 'w'), default=str, indent=1)

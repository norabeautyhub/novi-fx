"""Grid search + walk-forward validation across instruments, timeframes and years."""
import itertools, json, sys, numpy as np
from engine import *

YEARS = {'XAUUSD': [2014, 2015, 2016, 2017, 2018], 'EURUSD': [2017, 2018, 2019, 2020, 2021]}
LONDON_NY = list(range(7, 17))  # UTC hours

def grid(name):
    if name == 'baseline':
        for tp, be in itertools.product([1.5, 2, 3], [None, 1.0]):
            yield {}, dict(tp_r=tp, be_r=be)
    if name == 'pullback':
        for adx_, touch, r, sl, htf, tp, be in itertools.product([15, 20, 25], [0.0, 0.3], [45, 50], [1.5, 2.0], ['htf4', 'htfD'], [1.5, 2, 3], [None, 1.0]):
            yield dict(adx=adx_, touch=touch, rsi=r, sl=sl, htf=htf), dict(tp_r=tp, be_r=be)
    if name == 'breakout':
        for n, sl, htf, hours, adx_, tp, trail in itertools.product([20, 55], [1.5, 2.5], ['htf4', 'htfD'], [None, LONDON_NY], [0, 20], [2, 3], [None, 2.0]):
            yield dict(n=n, sl=sl, htf=htf, hours=hours, adx=adx_), dict(tp_r=tp, trail_atr=trail)
    if name == 'meanrev':
        for adx_, lo, sl, tp in itertools.product([15, 20], [25, 30], [1.0, 1.5], [1.0, 1.5]):
            yield dict(adx=adx_, lo=lo, sl=sl), dict(tp_r=tp, max_bars=24)

def key(sp, mp):
    return json.dumps({**sp, **{k: v for k, v in mp.items()}}, sort_keys=True, default=str)

# cache features per (pair, tf, year)
FEAT = {}
def feats(pair, tf, y):
    k = (pair, tf, y)
    if k not in FEAT:
        # load the previous year too so indicators are warmed up, then cut to year y
        yrs = [yy for yy in YEARS[pair] if yy in (y - 1, y)]
        df = load(pair, yrs, tf)
        F = features(df)
        # realistic retail costs: never below a typical retail spread (+ commission)
        F['spread'] = np.maximum(F['spread'], {'XAUUSD': 0.35, 'EURUSD': 0.00012}[pair])
        m = df.index.year == y
        start = max(0, np.argmax(m) - 250)
        FEAT[k] = {kk: (v[start:] if hasattr(v, '__len__') and len(v) == len(df) else v) for kk, v in F.items()}
    return FEAT[k]

def run(pair, tf, y, strat, sp, mp):
    F = feats(pair, tf, y)
    sig, sl = STRATS[strat](F, sp)
    r, _ = simulate(F, sig, sl, **mp)
    return r

if __name__ == '__main__':
    tfs = sys.argv[1].split(',') if len(sys.argv) > 1 else ['1h', '4h']
    results = {}
    for strat in ['baseline', 'pullback', 'breakout', 'meanrev']:
        for sp, mp in grid(strat):
            k = key(sp, mp)
            per = {}
            for pair, yrs in YEARS.items():
                for tf in tfs:
                    for y in yrs:
                        per[f'{pair}|{tf}|{y}'] = run(pair, tf, y, strat, sp, mp)
            results[(strat, k)] = per
        print('done', strat, flush=True)

    # ---------- walk-forward: pick best params on PAST years (by expectancy, min trades), test on next year ----------
    print('\n=== WALK-FORWARD (out-of-sample) per strategy / pair / tf ===')
    wf = {}
    for strat in ['baseline', 'pullback', 'breakout', 'meanrev']:
        for pair, yrs in YEARS.items():
            for tf in tfs:
                oos = []
                for ti in range(2, len(yrs)):           # need >=2 training years
                    train, test = yrs[:ti], yrs[ti]
                    best, bscore = None, -9
                    for (s, k), per in results.items():
                        if s != strat: continue
                        r = np.concatenate([per[f'{pair}|{tf}|{yy}'] for yy in train])
                        if len(r) < 30: continue
                        sc = r.mean()
                        if sc > bscore: bscore, best = sc, k
                    if best is None: continue
                    oos.append(results[(strat, best)][f'{pair}|{tf}|{test}'])
                r = np.concatenate(oos) if oos else np.array([])
                wf[(strat, pair, tf)] = stats(r)
                print(f'{strat:9s} {pair} {tf}: {stats(r)}')

    # ---------- robust single parameter set: good on ALL pair/tf/year combos ----------
    print('\n=== MOST ROBUST SINGLE PARAMETER SETS (all pairs, tfs, years) ===')
    rows = []
    for (s, k), per in results.items():
        yearly = [v.sum() for v in per.values()]
        allr = np.concatenate(list(per.values()))
        if len(allr) < 100: continue
        st = stats(allr)
        rows.append((sum(1 for v in yearly if v > 0) / len(yearly), st['exp'], s, k, st))
    rows.sort(key=lambda x: (x[0], x[1]), reverse=True)
    for row in rows[:15]:
        print(f'{row[0]:.2f} pos-years | {row[2]:9s} {row[4]} {row[3]}')
    json.dump([(r[0], r[1], r[2], r[3], r[4]) for r in rows[:60]], open('robust.json', 'w'), default=str)

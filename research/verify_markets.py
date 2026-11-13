"""Verify new markets: Pullback + Breakout grids on 1h & 4h, costs, walk-forward.
Verified if: walk-forward (unseen years) net > 0 and PF >= 1.2, final config >= 30 trades,
>= 3 of 4 years profitable, PF >= 1.2."""
import itertools, json, sys, numpy as np
from engine import load, features, STRATS, simulate, stats

LONDON_NY = list(range(7, 17))
FLOOR = {'XAGUSD': 0.025, 'GBPUSD': 0.00015, 'AUDUSD': 0.00014, 'USDJPY': 0.015, 'USDCAD': 0.0002, 'USDCHF': 0.0002,
         'GBPJPY': 0.03, 'EURJPY': 0.025, 'NZDUSD': 0.0002, 'EURGBP': 0.00015}
YEARS = [2015, 2016, 2017, 2018]

def grid():
    for adx, touch, sl, htf, tp in itertools.product([15, 20, 25], [0.0, 0.3], [1.5, 2.0], ['htf4', 'htfD'], [2, 3]):
        yield 'pullback', dict(adx=adx, htf=htf, rsi=50, sl=sl, touch=touch), dict(tp_r=tp)
    for n, sl, htf, hours, adx, tp in itertools.product([20, 55], [1.5, 2.5], ['htf4', 'htfD'], [None, LONDON_NY], [0, 20], [2, 3]):
        yield 'breakout', dict(n=n, sl=sl, htf=htf, hours=hours, adx=adx), dict(tp_r=tp)

def run_pair(pair):
    out = {}
    for tf in ['1h', '4h']:
        FY = {}
        for y in YEARS:
            yrs = [x for x in YEARS if x in (y - 1, y)]
            df = load(pair, yrs, tf); F = features(df); F['spread'] = np.maximum(F['spread'], FLOOR[pair])
            m = df.index.year == y; st = max(0, int(np.argmax(m)) - 250)
            FY[y] = {k: (v[st:] if hasattr(v, '__len__') and len(v) == len(df) else v) for k, v in F.items()}
        res = []
        for strat, sp, mp in grid():
            per = {}
            for y in YEARS:
                sig, sl = STRATS[strat](FY[y], sp)
                per[y], _ = simulate(FY[y], sig, sl, cost_mult=1.2, **mp)
            res.append((strat, sp, mp, per))
        # walk-forward of the selection rule (best expectancy, >= 15 train trades)
        oos = []
        for ti in range(1, len(YEARS)):
            tr, te = YEARS[:ti], YEARS[ti]
            best, bs = None, -9
            for r in res:
                a = np.concatenate([r[3][y] for y in tr])
                if len(a) >= 15 and a.mean() > bs: bs, best = a.mean(), r
            if best: oos.append(best[3][te])
        wf = stats(np.concatenate(oos)) if oos else stats(np.array([]))
        # final config on all years
        cands = []
        for r in res:
            a = np.concatenate(list(r[3].values()))
            if len(a) < 30: continue
            st = stats(a); pos = sum(v.sum() > 0 for v in r[3].values())
            cands.append((pos >= 3, st['exp'], r, st, pos))
        cands.sort(key=lambda c: (c[0], c[1]), reverse=True)
        top = cands[0] if cands else None
        verified = bool(top and top[0] and top[3]['pf'] >= 1.2 and wf['net'] > 0 and wf['pf'] >= 1.2)
        weak = bool(not verified and top and top[3]['net'] > 0 and wf['net'] > 0)
        out[tf] = {
            'status': 'verified' if verified else 'weak' if weak else 'disabled',
            'wf': wf, 'strategy': top[2][0] if top else None, 'params': top[2][1] if top else None, 'exits': top[2][2] if top else None,
            'full': top[3] if top else None, 'pos': top[4] if top else 0,
            'years': {y: round(float(top[2][3][y].sum()), 1) for y in YEARS} if top else None,
        }
        t = out[tf]
        print(f"{pair} {tf}: {t['status'].upper():9s} WF net {wf['net']:+.1f}R pf {wf['pf']} n {wf['n']} | final {t['strategy']} {t['params']} {t['exits']} full {t['full']} pos {t['pos']}/4 years {t['years']}", flush=True)
    return out

if __name__ == '__main__':
    pairs = sys.argv[1:] or list(FLOOR)
    allres = {}
    try: allres = json.load(open('verify_results.json'))
    except Exception: pass
    for p in pairs:
        allres[p] = run_pair(p)
        json.dump(allres, open('verify_results.json', 'w'), default=str, indent=1)

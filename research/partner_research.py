"""Does partner-market agreement improve signals?
For each signal on market A, check partner B at the same (closed) bar:
  htf4  : B 4h trend agrees      htfD : B daily trend agrees
  ema   : B EMA20 vs EMA50 agrees   mom : B 24-bar momentum agrees
Report confirmed vs not-confirmed (win rate, expectancy R, PF) for
 (1) the preset config and (2) every config of the grid (pooled, per-config medians)."""
import json, sys, numpy as np, pandas as pd
from engine import load, features, STRATS, simulate, stats
from verify_markets import grid, FLOOR

FLOOR = dict(FLOOR, XAUUSD=0.25, EURUSD=0.00012)
PAIRS = [('XAUUSD', 'XAGUSD', 1), ('XAGUSD', 'XAUUSD', 1), ('EURUSD', 'GBPUSD', 1), ('GBPUSD', 'EURUSD', 1),
         ('EURUSD', 'USDCHF', -1), ('USDCHF', 'EURUSD', -1), ('NZDUSD', 'AUDUSD', 1), ('AUDUSD', 'NZDUSD', 1)]
YEARS = [2015, 2016, 2017, 2018]
LONDON_NY = list(range(7, 17))
PRESET = {  # app presets (src/profiles.js) for the verified/weak ones
    ('XAUUSD', '1h'): ('pullback', dict(adx=25, htf='htfD', rsi=50, sl=1.5, touch=0.3), 3),
    ('XAUUSD', '4h'): ('breakout', dict(n=55, sl=1.5, htf='htfD', hours=LONDON_NY, adx=20), 3),
    ('EURUSD', '4h'): ('pullback', dict(adx=15, htf='htf4', rsi=50, sl=2.0, touch=0.0), 3),
}
VR = json.load(open('verify_results.json'))
for p, tfs in VR.items():
    for tf, t in tfs.items():
        if t['status'] in ('verified', 'weak'):
            PRESET[(p, tf)] = (t['strategy'], t['params'], t['exits']['tp_r'])

def partner_state(A_idx, Bdf):
    FB = features(Bdf)
    st = {
        'htf4': FB['htf4'], 'htfD': FB['htfD'],
        'ema': np.sign(FB['ema20'] - FB['ema50']),
        'mom': np.sign(FB['c'] - pd.Series(FB['c']).shift(24).values),
    }
    return {k: pd.Series(v, index=Bdf.index).reindex(A_idx, method='ffill').fillna(0).values for k, v in st.items()}

def split(res, ent, sig, PS, sign):
    out = {}
    si = ent
    d = sig[si]
    for k, v in PS.items():
        agree = (v[si] * sign == d)
        out[k] = (res[agree], res[~agree])
    return out

def s(a): st = stats(a); return f"n {st['n']:4d} win {st['wr']:5.1f}% exp {np.mean(a) if len(a) else 0:+.3f}R pf {st['pf']}"

report = {}
for A, B, sign in PAIRS:
    for tf in ['1h', '4h']:
        yrs = [y for y in YEARS if True]
        try:
            Adf = load(A, yrs, tf); Bdf = load(B, yrs, tf)
        except Exception as e:
            print(A, B, tf, 'no data', e); continue
        lo = max(Adf.index[0], Bdf.index[0]); Adf = Adf[Adf.index >= lo]; Bdf = Bdf[Bdf.index >= lo]
        F = features(Adf); F['spread'] = np.maximum(F['spread'], FLOOR[A])
        PS = partner_state(Adf.index, Bdf)
        key = f'{A}<-{B} {tf}'
        rep = {}
        # (2) whole grid: per-config difference in expectancy (confirmed - not)
        diffs = {k: [] for k in PS}; pool = {k: ([], []) for k in PS}
        for strat, sp, mp in grid():
            sig, sl = STRATS[strat](F, sp)
            res, ent = simulate(F, sig, sl, cost_mult=1.2, **mp)
            if len(res) < 30: continue
            for k, (yes, no) in split(res, np.array(ent), sig, PS, sign).items():
                pool[k][0].append(yes); pool[k][1].append(no)
                if len(yes) >= 10 and len(no) >= 10: diffs[k].append(yes.mean() - no.mean())
        print(f'\n=== {key} ({Adf.index[0].date()} → {Adf.index[-1].date()})')
        for k in PS:
            dd = np.array(diffs[k]); y = np.concatenate(pool[k][0]); n = np.concatenate(pool[k][1])
            better = (dd > 0).mean() * 100 if len(dd) else 0
            print(f"  GRID {k:5s} confirmed {s(y)} | not {s(n)} | configs where confirm better: {better:.0f}% of {len(dd)}")
            rep[f'grid_{k}'] = dict(yes=stats(y), no=stats(n), better_pct=round(better), configs=len(dd))
        if (A, tf) in PRESET:
            strat, sp, tp = PRESET[(A, tf)]
            sig, sl = STRATS[strat](F, sp)
            res, ent = simulate(F, sig, sl, cost_mult=1.2, tp_r=tp)
            print(f"  PRESET {strat} all {s(res)}")
            for k, (yes, no) in split(res, np.array(ent), sig, PS, sign).items():
                print(f"  PRESET {k:5s} confirmed {s(yes)} | not {s(no)}")
                rep[f'preset_{k}'] = dict(yes=stats(yes), no=stats(no))
        report[key] = rep
        json.dump(report, open('partner_results.json', 'w'), default=str, indent=1)

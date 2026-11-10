"""Walk-forward ML research: LightGBM, MLP (deep NN), LSTM (sequence NN).
Modes: (a) ML standalone signals, (b) ML as filter on the researched strategy, (c) strategy alone."""
import sys, json, warnings, numpy as np, pandas as pd, torch, torch.nn as nn
import lightgbm as lgb
from ml_features import build, labels
from engine import STRATS, simulate, stats
warnings.filterwarnings('ignore'); torch.set_num_threads(2); torch.manual_seed(0); np.random.seed(0)

CFG = {
    'XAUUSD': dict(years=[2014, 2015, 2016, 2017, 2018], tests=[2016, 2017, 2018], floor=0.35,
                   strat=('pullback', dict(adx=25, htf='htfD', rsi=50, sl=1.5, touch=0.3), dict(tp_r=3))),
    'EURUSD': dict(years=[2017, 2018, 2019, 2020, 2021], tests=[2019, 2020, 2021], floor=0.00012,
                   strat=('pullback', dict(adx=15, htf='htf4', rsi=50, sl=2.0, touch=0.0), dict(tp_r=3))),
}
H = 48
SEQ_FEATS = ['ret1', 'ret3', 'dist_ema20', 'dist_ema50', 'rsi', 'macd', 'adx', 'di', 'bb_pb', 'atr_ratio', 'body', 'don20']
SEQ_LEN = 32

# ---------------- models ----------------
def fit_lgb(Xtr, ytr, Xva, yva):
    m = lgb.LGBMClassifier(n_estimators=600, learning_rate=0.02, num_leaves=15, min_child_samples=200, subsample=0.7, subsample_freq=1,
                           colsample_bytree=0.7, reg_lambda=5, verbose=-1)
    m.fit(Xtr, ytr, eval_set=[(Xva, yva)], callbacks=[lgb.early_stopping(50, verbose=False)])
    return lambda X: m.predict_proba(X)[:, 1]

class MLP(nn.Module):
    def __init__(s, d):
        super().__init__()
        s.n = nn.Sequential(nn.Linear(d, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, 64), nn.ReLU(), nn.Dropout(0.3), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))
    def forward(s, x): return s.n(x).squeeze(-1)

class LSTM(nn.Module):
    def __init__(s, d):
        super().__init__()
        s.l = nn.LSTM(d, 32, num_layers=1, batch_first=True); s.h = nn.Linear(32, 1)
    def forward(s, x): o, _ = s.l(x); return s.h(o[:, -1]).squeeze(-1)

def fit_torch(model, Xtr, ytr, Xva, yva, epochs=60, bs=256):
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-3)
    lossf = nn.BCEWithLogitsLoss()
    Xt, yt, Xv, yv = map(lambda a: torch.tensor(a, dtype=torch.float32), (Xtr, ytr, Xva, yva))
    best, bstate, bad = 1e9, None, 0
    for ep in range(epochs):
        model.train(); perm = torch.randperm(len(Xt))
        for k in range(0, len(Xt), bs):
            idx = perm[k:k + bs]; opt.zero_grad(); l = lossf(model(Xt[idx]), yt[idx]); l.backward(); opt.step()
        model.eval()
        with torch.no_grad(): vl = lossf(model(Xv), yv).item()
        if vl < best - 1e-4: best, bstate, bad = vl, {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            bad += 1
            if bad >= 6: break
    model.load_state_dict(bstate); model.eval()
    def pred(X):
        with torch.no_grad(): return torch.sigmoid(model(torch.tensor(X, dtype=torch.float32))).numpy()
    return pred

def seqs(Xn, idx):
    return np.stack([Xn[i - SEQ_LEN + 1:i + 1] for i in idx])

# ---------------- trading with model probabilities ----------------
def trade_probs(pl, ps, rl, rs, xl, xs, idx, thr):
    """one position at a time; enter when max(pl,ps) >= thr"""
    out, k, busy_until = [], 0, -1
    for t, i in enumerate(idx):
        if i <= busy_until: continue
        if pl[t] >= thr and pl[t] >= ps[t]: out.append(rl[i]); busy_until = xl[i]
        elif ps[t] >= thr and ps[t] > pl[t]: out.append(rs[i]); busy_until = xs[i]
    return np.array(out)

def pick_thr(pl, ps, rl, rs, xl, xs, idx):
    best = (None, -9)
    for q in (0.6, 0.7, 0.8, 0.9, 0.95):
        thr = np.quantile(np.maximum(pl, ps), q)
        r = trade_probs(pl, ps, rl, rs, xl, xs, idx, thr)
        if len(r) >= 30 and r.mean() > best[1]: best = (thr, r.mean())
    return best[0] if best[0] is not None else np.quantile(np.maximum(pl, ps), 0.9)

def run(pair, tp_r):
    C = CFG[pair]
    df, F, X = build(pair, C['years'], '1h')
    F['spread'] = np.maximum(F['spread'], C['floor'])
    yl, ys, rl, rs, xl, xs = labels(F, 1.5, tp_r, H, 1.2)
    cols = list(X.columns)
    Xv = X.values.astype(np.float64)
    ok = ~np.isnan(Xv).any(1) & ~np.isnan(yl) & ~np.isnan(ys)
    ok[:SEQ_LEN + 250] = False
    years = df.index.year.values
    res = {m: [] for m in ['lgb', 'mlp', 'lstm', 'ens']}
    filt = {m: [] for m in ['strategy', 'lgb', 'mlp', 'lstm', 'ens']}
    sname, sp, mp = C['strat']
    ssig, ssl = STRATS[sname](F, sp)
    for ty in C['tests']:
        test_start = np.argmax(years == ty)
        tr = np.where(ok & (years < ty))[0]; tr = tr[tr < test_start - H]          # embargo
        te = np.where(ok & (years == ty))[0]
        cut = int(len(tr) * 0.8); va = tr[cut:]; tr2 = tr[:cut - H]
        mu, sd = Xv[tr2].mean(0), Xv[tr2].std(0) + 1e-9
        Xn = np.nan_to_num((Xv - mu) / sd)
        P = {}
        for side, y in (('l', yl), ('s', ys)):
            P[('lgb', side)] = fit_lgb(Xv[tr2], y[tr2], Xv[va], y[va])
            P[('mlp', side)] = fit_torch(MLP(len(cols)), Xn[tr2], y[tr2], Xn[va], y[va])
            sf = [cols.index(f) for f in SEQ_FEATS]
            Sn = Xn[:, sf]
            lstm = fit_torch(LSTM(len(sf)), seqs(Sn, tr2), y[tr2], seqs(Sn, va), y[va], epochs=12, bs=512)
            P[('lstm', side)] = (lambda m, S=Sn: (lambda idx: m(seqs(S, idx))))(lstm)
        def probs(m, idx):
            if m == 'ens':
                pl = np.mean([probs(k, idx)[0] for k in ('lgb', 'mlp', 'lstm')], 0); ps = np.mean([probs(k, idx)[1] for k in ('lgb', 'mlp', 'lstm')], 0)
                return pl, ps
            if m == 'lstm': return P[(m, 'l')](idx), P[(m, 's')](idx)
            return P[(m, 'l')](Xv[idx] if m == 'lgb' else Xn[idx]), P[(m, 's')](Xv[idx] if m == 'lgb' else Xn[idx])
        for m in res:
            pvl, pvs = probs(m, va)
            thr = pick_thr(pvl, pvs, rl, rs, xl, xs, va)
            ptl, pts = probs(m, te)
            r = trade_probs(ptl, pts, rl, rs, xl, xs, te, thr)
            acc_l = ((ptl > 0.5) == (yl[te] > 0.5)).mean()
            res[m].append(dict(year=ty, r=r, thr=thr, acc=acc_l))
            # (b) filter strategy signals: keep only if model prob in the trade direction >= median prob on validation
            med_l, med_s = np.median(pvl), np.median(pvs)
            sig = np.zeros_like(ssig)
            yrmask = years == ty
            for i in np.where((ssig != 0) & yrmask & ok)[0]:
                pl_i, ps_i = probs(m, np.array([i]))
                if (ssig[i] == 1 and pl_i[0] >= med_l) or (ssig[i] == -1 and ps_i[0] >= med_s): sig[i] = ssig[i]
            Fy = F
            rr, _ = simulate(Fy, sig, ssl, cost_mult=1.2, **mp)
            filt[m].append(dict(year=ty, r=rr))
        base = np.where(yrmask, ssig, 0)
        rb, _ = simulate(F, base, ssl, cost_mult=1.2, **mp)
        filt['strategy'].append(dict(year=ty, r=rb))
        print(pair, tp_r, ty, 'done', flush=True)
    return res, filt

def summarize(name, lst):
    allr = np.concatenate([x['r'] for x in lst]) if lst else np.array([])
    st = stats(allr)
    per = ' '.join(f"{x['year']}:{x['r'].sum():+.1f}R/{len(x['r'])}t/{(100*(x['r']>0).mean() if len(x['r']) else 0):.0f}%" for x in lst)
    return f"{name:10s} n={st['n']:4d} win={st['wr']:5.1f}% PF={st['pf']:5.2f} net={st['net']:+6.1f}R | {per}"

if __name__ == '__main__':
    out = {}
    for pair in ['XAUUSD', 'EURUSD']:
        for tp in [1.0, 2.0]:
            res, filt = run(pair, tp)
            print(f'\n===== {pair} 1h · SL 1.5 ATR · TP {tp}R · test years {CFG[pair]["tests"]} =====')
            print('(a) ML standalone:')
            for m, lst in res.items(): print('   ', summarize(m, lst), '| acc', ' '.join(f"{x['acc']:.3f}" for x in lst))
            if tp == 1.0:
                print('(b/c) Strategy signals, unfiltered vs ML-filtered:')
                for m, lst in filt.items(): print('   ', summarize(m if m != 'strategy' else 'STRATEGY', lst))
            sys.stdout.flush()
